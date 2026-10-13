import { useEffect, useState } from "react";
import { VoiceSession, type VoiceView } from "../mini/voice.js";
import { webRecorder } from "./voice-recorder.js";
import { request } from "./api.js";
export function VoiceInput({
  useText,
  disabled = false,
}: {
  useText: (text: string) => void;
  disabled?: boolean;
}) {
  const [view, setView] = useState<VoiceView | null>(null),
    [s] = useState(
      () =>
        new VoiceSession({
          capture: webRecorder,
          request: <T,>(p: string, m = "GET", b?: unknown) =>
            request<T>(p, {
              method: m,
              ...(b ? { body: JSON.stringify(b) } : {}),
            }),
          notify: setView,
        }),
    );
  useEffect(() => {
    s.reopen();
    void s.refresh();
    const hide = () => {
      if (document.hidden) s.cancel();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      s.close();
    };
  }, [s]);
  const v = view ?? s.state;
  return (
    <details className="voice-input">
      <summary>用语音说一说</summary>
      <p className="muted">
        主动开启麦克风，最多45秒。点击“发送录音识别”才会把音频交给硅基流动；本应用不保存音频。识别文字可修改，确认后填入需求框。
      </p>
      {!v.configured && (
        <p>先连接私人空间和基础AI服务；现在也可用键盘语音输入。</p>
      )}
      <div className="planning-actions">
        {["idle", "review", "ready"].includes(v.stage) && (
          <button
            className="secondary"
            disabled={disabled || !v.configured}
            onClick={() => void s.start()}
          >
            开始录音
          </button>
        )}
        {v.stage === "recording" && (
          <button className="primary" onClick={() => void s.stop()}>
            结束录音
          </button>
        )}
        {v.stage === "ready" && (
          <button
            className="primary"
            disabled={disabled}
            onClick={() => void s.transcribe()}
          >
            发送录音识别
          </button>
        )}
        {v.stage !== "idle" && (
          <button className="secondary" onClick={() => s.cancel()}>
            取消语音
          </button>
        )}
      </div>
      <p role="status">
        {
          {
            idle: "",
            requesting: "正在准备录音…",
            recording: "正在录音，结束后可以选择是否发送。",
            ready: "录音已就绪，尚未上传。",
            transcribing: "正在识别…",
            review: "请核对识别文字，特别是金额和时间。",
          }[v.stage]
        }
      </p>
      {v.error && <p role="alert">{v.error}</p>}
      {v.stage === "review" && (
        <>
          <label>
            语音识别文字
            <textarea
              aria-label="语音识别文字"
              maxLength={600}
              value={v.text}
              onChange={(e) => s.text(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={disabled || !v.text.trim()}
            onClick={() => {
              useText(v.text);
              s.cancel();
            }}
          >
            确认文字，填入需求
          </button>
        </>
      )}
    </details>
  );
}
