const { VoiceSession } = require("../../shared/voice-ui.js");
const api = require("../../services/api.js");
const { capture } = require("../../platform/voice.js");
const platform = require("../../platform/index.js");
Component({
  properties: { disabled: { type: Boolean, value: false } },
  data: {
    stage: "idle",
    configured: false,
    text: "",
    error: "",
    showPrivacy: false,
    privacyError: "",
  },
  lifetimes: {
    attached() {
      this.voice = new VoiceSession({
        capture,
        request: api.request,
        notify: (v) => this.setData(v),
      });
      this.releasePrivacy = platform.watchPrivacy?.(this);
      void this.voice.refresh();
    },
    detached() {
      this.releasePrivacy?.();
      this.voice?.close();
    },
  },
  pageLifetimes: {
    show() {
      this.releasePrivacy?.();
      this.releasePrivacy = platform.watchPrivacy?.(this);
    },
    hide() {
      this.releasePrivacy?.();
      this.releasePrivacy = null;
      this.voice?.cancel();
    },
  },
  methods: {
    start() {
      return this.voice.start();
    },
    stop() {
      return this.voice.stop();
    },
    transcribe() {
      return this.voice.transcribe();
    },
    cancel() {
      this.resolvePrivacy?.(false);
      this.voice.cancel();
    },
    text(e) {
      this.voice.text(e.detail.value);
    },
    use() {
      this.triggerEvent("transcript", { text: this.data.text });
      this.voice.cancel();
    },
    privacyAgree() {
      this.resolvePrivacy?.(true);
    },
    privacyDecline() {
      this.resolvePrivacy?.(false);
      this.voice.cancel();
    },
    async privacyContract() {
      try {
        await platform.privacyContract();
      } catch (e) {
        this.setData({ privacyError: e.message });
      }
    },
  },
});
