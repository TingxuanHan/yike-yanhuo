const platform = require("../../platform/index.js");
const { cleanBook, emptyBook } = require("../../shared/life.js");
const { MovementSession } = require("../../shared/movement-ui.js");
Page({
  data: {
    ready: false,
    careMode: false,
    error: "",
    openLeg: "",
    showNotes: false,
  },
  onLoad() {
    try {
      this.session = new MovementSession(
        cleanBook(platform.get("yike-life") || emptyBook()),
        platform.get("yike-movement-trip") || null,
        {
          get: (k) => platform.get(k),
          set: (k, v) => platform.set(k, v),
          save: (b) => platform.set("yike-life", cleanBook(b)),
          notify: (s) => this.setData(s),
        },
      );
      this.setData({
        ...this.session.state,
        ready: true,
        careMode: !!platform.get("yike-care-mode"),
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShow() {
    if (this.session) {
      this.session.reopen();
      try {
        this.session.sync(cleanBook(platform.get("yike-life") || emptyBook()));
      } catch (e) {
        this.session.message(e.message, true);
      }
    }
  },
  onUnload() {
    this.session?.close();
  },
  care() {
    const value = !this.data.careMode;
    platform.set("yike-care-mode", value);
    this.setData({ careMode: value });
  },
  field(e) {
    this.session.change(e.currentTarget.dataset.key, e.detail.value);
  },
  mode(e) {
    this.session.change("mode", e.currentTarget.dataset.mode);
  },
  returnEasy() {
    this.session.change("returnEasy", !this.data.settings.returnEasy);
  },
  advanced() {
    this.session.toggle();
  },
  calculate() {
    this.session.calculate();
    if (this.data.preview) platform.reveal?.(".movement-result");
  },
  save() {
    this.session.save();
  },
  async load() {
    if (await platform.confirm("载入保存的步行偏好，会替换当前设置。"))
      this.session.load();
  },
  leg(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ openLeg: this.data.openLeg === id ? "" : id });
  },
  notes() {
    this.setData({ showNotes: !this.data.showNotes });
  },
  async copy() {
    try {
      await platform.clipboard(this.session.copyText());
      this.session.message("步行安排已复制。");
    } catch (e) {
      this.session.message(e.message || "复制失败，请重试。", true);
    }
  },
});
