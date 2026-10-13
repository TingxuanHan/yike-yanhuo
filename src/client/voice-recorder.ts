import type { RecorderHandle, VoiceClip } from "../mini/voice.js";
export async function webRecorder(): Promise<RecorderHandle> {
  if (
    !window.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia ||
    !window.MediaRecorder
  )
    throw new Error("录音需要HTTPS或本机localhost，以及支持录音的浏览器。");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1 },
    video: false,
  });
  let recorder: MediaRecorder;
  try {
    const type = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, {
      ...(type ? { mimeType: type } : {}),
      audioBitsPerSecond: 64000,
    });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: Blob[] = [];
  let cancelled = false,
    resolve: (v: Blob) => void,
    reject: (e: Error) => void;
  const stopped = new Promise<Blob>((r, j) => {
    resolve = r;
    reject = j;
  });
  void stopped.catch(() => {});
  recorder.ondataavailable = (e) => {
    if (!cancelled && e.data.size) chunks.push(e.data);
  };
  const end = () => stream.getTracks().forEach((t) => t.stop());
  recorder.onerror = () => {
    end();
    reject(new Error("录音中断。"));
  };
  recorder.onstop = () => {
    end();
    if (cancelled) reject(new Error("录音已取消。"));
    else resolve(new Blob(chunks, { type: recorder.mimeType }));
  };
  try {
    recorder.start(1000);
  } catch (e) {
    end();
    throw e;
  }
  return {
    cancel() {
      cancelled = true;
      chunks.length = 0;
      if (recorder.state !== "inactive") recorder.stop();
      end();
    },
    async finish() {
      if (recorder.state !== "inactive") recorder.stop();
      const blob = await stopped;
      if (cancelled || blob.size > 4 * 1024 * 1024)
        throw new Error("录音过长。");
      return wavClip(await blob.arrayBuffer());
    },
  };
}
export async function wavClip(data: ArrayBuffer): Promise<VoiceClip> {
  const context = new OfflineAudioContext(1, 16000 * 46, 16000),
    decoded = await context.decodeAudioData(data);
  if (decoded.duration > 46 || decoded.duration < 0.1)
    throw new Error("录音时长需在45秒以内。");
  const samples = decoded.length,
    buffer = new ArrayBuffer(44 + samples * 2),
    view = new DataView(buffer);
  const chars = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  chars(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  chars(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  chars(36, "data");
  view.setUint32(40, samples * 2, true);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
    decoded.getChannelData(i),
  );
  for (let i = 0; i < samples; i++) {
    const x = Math.max(
      -1,
      Math.min(1, channels.reduce((v, c) => v + c[i], 0) / channels.length),
    );
    view.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
  }
  let raw = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { mime: "audio/wav", audio: btoa(raw) };
}
