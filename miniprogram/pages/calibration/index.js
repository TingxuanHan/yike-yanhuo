const platform = require("../../platform/index.js");
const { cleanBook, emptyBook } = require("../../shared/life.js");
const {
  CalibrationSession,
  walkSources,
} = require("../../shared/calibration-ui.js");
Page({
  data: {
    ready: false,
    careMode: false,
    error: "",
    showEvidence: false,
    sources: walkSources.map((s) => s.label),
    sourceIndex: 0,
  },
  onLoad() {
    try {
      this.session = new CalibrationSession(
        cleanBook(platform.get("yike-life") || emptyBook()),
        {
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
    try {
      this.session?.sync(cleanBook(platform.get("yike-life") || emptyBook()));
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  field(e) {
    this.session.field(e.currentTarget.dataset.key, e.detail.value);
  },
  source(e) {
    const index = Number(e.detail.value);
    if (!walkSources[index]) return;
    this.setData({ sourceIndex: index });
    this.session.field("source", walkSources[index].id);
  },
  usual() {
    this.session.field("usual", !this.data.form.usual);
  },
  prepare() {
    this.session.prepare();
  },
  finish() {
    this.session.finish();
  },
  exclude(e) {
    this.session.exclude(e.currentTarget.dataset.id);
  },
  apply() {
    this.session.apply();
  },
  evidence() {
    this.setData({ showEvidence: !this.data.showEvidence });
  },
  care() {
    try {
      const careMode = !this.data.careMode;
      platform.set("yike-care-mode", careMode);
      this.setData({ careMode });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async copy() {
    try {
      const s = this.data;
      await platform.clipboard(
        `实走步速记录摘要\n有效${s.summary.count}次，共${s.summary.meters}米。\n${s.summary.reason}\n${s.kilometer}\n${s.evaluation}\n距离与用时为本人填报，未经独立核验；记录范围不保证以后用时。`,
      );
      this.setData({ status: "对照摘要已复制，不含路段简称。", error: "" });
    } catch (e) {
      this.setData({ error: e.message || "复制失败，请重试。" });
    }
  },
  async backup() {
    try {
      await platform.clipboard(JSON.stringify(this.session.export(), null, 2));
      this.setData({
        status: "完整记录已复制，请粘贴到文件中保存；分享前检查路段简称。",
        error: "",
      });
      this.archive = JSON.stringify(this.session.export().trials);
    } catch (e) {
      this.setData({ error: e.message || "备份复制失败，请重试。" });
    }
  },
  async resetRecords() {
    if (this.archive !== JSON.stringify(this.session.export().trials)) {
      this.setData({ error: "请先复制当前完整记录，并粘贴到文件中保存。" });
      return;
    }
    if (
      await platform.confirm(
        "确认已保存完整记录？清空本机全部实走记录后重新积累；日常步速与地点保留。",
      )
    ) {
      this.session.clear();
      this.archive = null;
    }
  },
});
