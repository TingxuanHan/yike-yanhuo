import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { randomBytes } from "node:crypto";
import { publicAddress, type ModelConfig } from "./ai-transport.js";
import { ServiceError } from "./baidu.js";
export const VOICE_MODEL = "FunAudioLLM/SenseVoiceSmall";
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export interface AudioClip {
  mime: "audio/wav" | "audio/mpeg";
  bytes: Buffer;
}
export function cleanAudio(value: unknown): AudioClip {
  const v = value as { mime: string; audio: string };
  const bad = () =>
    new ServiceError("请使用45秒以内、2MB以内的WAV或MP3录音。", 400);
  if (
    !v ||
    !["audio/wav", "audio/mpeg"].includes(v.mime) ||
    typeof v.audio !== "string" ||
    v.audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      v.audio,
    )
  )
    throw bad();
  const b = Buffer.from(v.audio, "base64");
  if (b.length < 44 || b.length > MAX_AUDIO_BYTES) throw bad();
  let seconds = 0;
  if (v.mime === "audio/wav") {
    if (
      b.toString("ascii", 0, 4) !== "RIFF" ||
      b.toString("ascii", 8, 12) !== "WAVE" ||
      b.readUInt32LE(4) + 8 !== b.length
    )
      throw bad();
    let rate = 0,
      data = 0;
    for (let i = 12; i + 8 <= b.length;) {
      const n = b.readUInt32LE(i + 4),
        tag = b.toString("ascii", i, i + 4);
      if (i + 8 + n > b.length) throw bad();
      if (tag === "fmt ") {
        if (
          n < 16 ||
          b.readUInt16LE(i + 8) !== 1 ||
          b.readUInt16LE(i + 10) !== 1 ||
          b.readUInt16LE(i + 22) !== 16 ||
          b.readUInt16LE(i + 20) !== 2
        )
          throw bad();
        rate = b.readUInt32LE(i + 12);
        if (rate !== 16000 || b.readUInt32LE(i + 16) !== 32000) throw bad();
      }
      if (tag === "data") data += n;
      i += 8 + n + (n % 2);
    }
    if (!rate || !data || data % 2) throw bad();
    seconds = data / (rate * 2);
  } else {
    let i = 0;
    if (b.toString("ascii", 0, 3) === "ID3") {
      if (b.subarray(6, 10).some((v) => v > 127)) throw bad();
      i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
    }
    let frames = 0;
    while (i + 4 <= b.length) {
      if (b.length - i === 128 && b.toString("ascii", i, i + 3) === "TAG") {
        i = b.length;
        break;
      }
      const h = b.readUInt32BE(i);
      if (h >>> 21 !== 0x7ff) throw bad();
      const version = (h >>> 19) & 3,
        layer = (h >>> 17) & 3,
        bi = (h >>> 12) & 15,
        si = (h >>> 10) & 3;
      if (version === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3)
        throw bad();
      const kbps = (
          version === 3
            ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
            : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
        )[bi],
        rate =
          [44100, 48000, 32000][si] /
          (version === 3 ? 1 : version === 2 ? 2 : 4),
        size =
          Math.floor(((version === 3 ? 144000 : 72000) * kbps) / rate) +
          ((h >>> 9) & 1);
      if (size < 4 || i + size > b.length) throw bad();
      seconds += (version === 3 ? 1152 : 576) / rate;
      i += size;
      frames++;
    }
    if (!frames || i !== b.length) throw bad();
  }
  if (seconds < 0.1 || seconds > 46) throw bad();
  return { mime: v.mime as AudioClip["mime"], bytes: b };
}
export type VoiceTransport = (
  config: ModelConfig,
  clip: AudioClip,
  signal: AbortSignal,
) => Promise<string>;
export const voiceTransport: VoiceTransport = async (config, clip, signal) => {
  if (
    config.baseUrl !== "https://api.siliconflow.cn/v1" ||
    config.model !== VOICE_MODEL
  )
    throw new ServiceError("语音服务配置无效。", 503);
  const url = new URL(config.baseUrl + "/audio/transcriptions"),
    records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw new ServiceError("语音服务地址不可用。", 503);
  signal.throwIfAborted();
  const chosen = records[0],
    boundary = "yike-" + randomBytes(18).toString("hex"),
    body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${VOICE_MODEL}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${clip.mime === "audio/wav" ? "wav" : "mp3"}"\r\nContent-Type: ${clip.mime}\r\n\r\n`,
      ),
      clip.bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  return new Promise((resolve, reject) => {
    const fail = (s = "语音识别失败或超时，可重新录制或打字。") =>
      new ServiceError(s, 502);
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        signal,
        headers: {
          authorization: `Bearer ${config.key}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": body.length,
        },
        lookup: (_h, o, cb) =>
          o.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.destroy();
          reject(
            fail(
              res.statusCode === 429 ? "语音服务限流，请稍后再试。" : undefined,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (b: Buffer) => {
          size += b.length;
          if (size > 16000) {
            req.destroy();
            reject(fail());
          } else chunks.push(b);
        });
        res.on("error", () => reject(fail()));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            if (raw.includes(config.key)) throw new Error();
            const text = JSON.parse(raw).text;
            if (typeof text !== "string" || !text.trim() || text.length > 600)
              throw new Error();
            resolve(text.trim());
          } catch {
            reject(
              fail("没有识别到600字以内的有效内容，请说短一些或手工填写。"),
            );
          }
        });
      },
    );
    req.on("error", () => reject(fail()));
    req.end(body);
  });
};
