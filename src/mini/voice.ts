export interface VoiceClip {
  mime: string;
  audio: string;
}
export interface RecorderHandle {
  finish: () => Promise<VoiceClip>;
  cancel: () => void;
}
export interface VoiceView {
  stage:
    "idle" | "requesting" | "recording" | "ready" | "transcribing" | "review";
  configured: boolean;
  text: string;
  error: string;
}
export class VoiceSession {
  state: VoiceView = { stage: "idle", configured: false, text: "", error: "" };
  private handle: RecorderHandle | null = null;
  private clip: VoiceClip | null = null;
  private epoch = 0;
  private alive = true;
  private lifetime = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private deps: {
      capture: () => Promise<RecorderHandle>;
      request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
      notify: (v: VoiceView) => void;
    },
  ) {}
  emit() {
    if (this.alive) this.deps.notify({ ...this.state });
  }
  async refresh() {
    const lifetime = this.lifetime;
    try {
      const r = await this.deps.request<{ configured: boolean }>(
        "/api/ai/voice",
      );
      if (!this.alive || lifetime !== this.lifetime) return;
      this.state.configured = r.configured;
    } catch {
      if (!this.alive || lifetime !== this.lifetime) return;
      this.state.configured = false;
    }
    this.emit();
  }
  async start() {
    if (
      !this.alive ||
      !this.state.configured ||
      !["idle", "review", "ready"].includes(this.state.stage)
    )
      return;
    this.cancel();
    const epoch = this.epoch;
    this.state.stage = "requesting";
    this.state.text = "";
    this.state.error = "";
    this.emit();
    try {
      const h = await this.deps.capture();
      if (epoch !== this.epoch) {
        h.cancel();
        return;
      }
      this.handle = h;
      this.state.stage = "recording";
      this.timer = setTimeout(() => void this.stop(), 45000);
      this.emit();
    } catch {
      if (epoch === this.epoch) {
        this.state.stage = "idle";
        this.state.error = "麦克风未能开启。请检查权限，或直接打字。";
        this.emit();
      }
    }
  }
  async stop() {
    if (this.state.stage !== "recording" || !this.handle) return;
    clearTimeout(this.timer);
    const epoch = this.epoch;
    this.state.stage = "requesting";
    this.emit();
    try {
      const clip = await this.handle.finish();
      if (epoch !== this.epoch) return;
      this.clip = clip;
      this.handle = null;
      this.state.stage = "ready";
    } catch {
      if (epoch !== this.epoch) return;
      this.handle?.cancel();
      this.handle = null;
      this.clip = null;
      this.state.stage = "idle";
      this.state.error = "录音未完成，请重新录制或打字。";
    }
    this.emit();
  }
  async transcribe() {
    if (this.state.stage !== "ready" || !this.clip) return;
    const epoch = this.epoch,
      clip = this.clip;
    this.state.stage = "transcribing";
    this.state.error = "";
    this.emit();
    try {
      const r = await this.deps.request<{ text: string }>(
        "/api/ai/voice",
        "POST",
        {
          ...clip,
          requestId: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        },
      );
      if (epoch !== this.epoch) return;
      if (typeof r.text !== "string" || r.text.length > 600)
        throw new Error("识别内容无效。");
      this.state.text = r.text;
      this.state.stage = "review";
      this.clip = null;
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.state.error = (e as Error).message;
      this.state.stage = "ready";
    }
    this.emit();
  }
  text(value: string) {
    this.state.text = value.slice(0, 600);
    this.emit();
  }
  cancel() {
    this.epoch++;
    clearTimeout(this.timer);
    this.handle?.cancel();
    this.handle = null;
    this.clip = null;
    this.state.stage = "idle";
    this.emit();
  }
  close() {
    this.alive = false;
    this.lifetime++;
    this.cancel();
  }
  reopen() {
    this.alive = true;
    this.emit();
  }
}
