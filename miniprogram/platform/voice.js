function capture() {
  return new Promise((resolve, reject) => {
    if (!wx.getRecorderManager)
      return reject(new Error("当前设备不支持录音。"));
    const recorder = wx.getRecorderManager();
    let cancelled = false,
      finishResolve,
      finishReject,
      started = false;
    const stopped = new Promise((r, j) => {
      finishResolve = r;
      finishReject = j;
    });
    stopped.catch(() => {});
    const cleanup = () => {
      recorder.offStart?.(onStart);
      recorder.offStop?.(onStop);
      recorder.offError?.(onError);
    };
    const onError = () => {
      cleanup();
      const e = new Error("录音未完成，请检查麦克风权限。");
      if (!started) reject(e);
      finishReject(e);
    };
    const onStop = (r) => {
      cleanup();
      const fs = wx.getFileSystemManager();
      const remove = () => {
        if (r.tempFilePath)
          fs.unlink?.({ filePath: r.tempFilePath, fail: () => {} });
      };
      if (cancelled) {
        remove();
        finishReject(new Error("录音已取消。"));
        return;
      }
      if (!r.tempFilePath || r.fileSize > 2 * 1024 * 1024) {
        remove();
        finishReject(new Error("录音过大，请缩短。"));
        return;
      }
      fs.readFile({
        filePath: r.tempFilePath,
        encoding: "base64",
        success: (value) => {
          remove();
          finishResolve({ mime: "audio/mpeg", audio: value.data });
        },
        fail: () => {
          remove();
          finishReject(new Error("录音读取失败。"));
        },
      });
    };
    const onStart = () => {
      started = true;
      resolve({
        finish: () => {
          recorder.stop();
          return stopped;
        },
        cancel: () => {
          cancelled = true;
          recorder.stop();
        },
      });
    };
    recorder.onStart(onStart);
    recorder.onStop(onStop);
    recorder.onError(onError);
    const start = () =>
      recorder.start({
        duration: 45000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    if (wx.requirePrivacyAuthorize)
      wx.requirePrivacyAuthorize({ success: start, fail: onError });
    else start();
  });
}
module.exports = { capture };
