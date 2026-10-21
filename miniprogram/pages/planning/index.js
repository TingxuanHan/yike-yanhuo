const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { cleanBook, emptyBook } = require("../../shared/life.js");
const {
  PlanningSession,
  planningFields,
  planningTasks,
  aiPresets,
  planningBook,
} = require("../../shared/planning-ui.js");
Page({
  data: {
    ready: false,
    careMode: false,
    error: "",
    fields: [],
    taskRows: [],
    presets: aiPresets,
    returnChoices: ["保留原设置", "是", "否"],
  },
  onLoad() {
    this.session = new PlanningSession({
      get: (k) => platform.get(k),
      set: (k, v) => platform.set(k, v),
      request: (p, m, b) => api.request(p, m, b),
      notify: (s) => this.render(s),
    });
    this.setData({ ready: true, careMode: !!platform.get("yike-care-mode") });
    this.session.emit();
  },
  onShow() {
    if (this.session) {
      this.session.reopen();
      void this.session.refresh();
    }
  },
  onHide() {
    this.session?.hideKey();
  },
  onUnload() {
    this.session?.close();
  },
  render(s) {
    this.setData({
      ...s,
      fields: planningFields.map((f) => ({ ...f, value: s.form[f.key] })),
      taskRows: planningTasks.map((t) => ({
        ...t,
        checked: s.tasks.includes(t.id),
      })),
      returnIndex: ["", "yes", "no"].indexOf(s.returnChoice),
    });
  },
  field(e) {
    this.session.set(e.currentTarget.dataset.key, e.detail.value);
  },
  mode(e) {
    this.session.mode(e.currentTarget.dataset.mode);
    if (e.currentTarget.dataset.mode === "manual")
      this.setData({}, () => platform.reveal?.(".review"));
  },
  task(e) {
    this.session.task(e.currentTarget.dataset.id);
  },
  returnChange(e) {
    this.session.set("returnChoice", ["", "yes", "no"][Number(e.detail.value)]);
  },
  settings() {
    this.session.toggleSettings();
  },
  preset(e) {
    this.session.preset(Number(e.currentTarget.dataset.index));
  },
  async parse() {
    await this.session.parse();
    if (this.data.reviewed)
      this.setData({}, () => platform.reveal?.(".review"));
  },
  saveSettings() {
    return this.session.saveSettings();
  },
  testSettings() {
    return this.session.testSettings();
  },
  async removeSettings() {
    if (await platform.confirm("删除当前设备的API设置？"))
      await this.session.removeSettings();
  },
  care() {
    const v = !this.data.careMode;
    platform.set("yike-care-mode", v);
    this.setData({ careMode: v });
  },
  async apply(e) {
    try {
      const p = this.session.confirm(),
        target = e.currentTarget.dataset.target;
      if (!["errands", "shopping", "trip"].includes(target)) return;
      if (
        !(await platform.confirm(
          target === "shopping" && p.items.length
            ? "应用确认的条件，并用这些商品名称替换购物草稿？原价格记录保留。"
            : "应用确认的出发时刻、步速和步行目标，进入下一步核算？",
        ))
      )
        return;
      const book = planningBook(
        cleanBook(platform.get("yike-life") || emptyBook()),
        p,
      );
      platform.set("yike-life", book);
      if (book.movement) platform.set("yike-movement-draft", book.movement);
      platform.set("yike-planning-handoff", { target, draft: p });
      if (target === "trip") await platform.openTrip();
      else if (target === "shopping") await platform.openShopping();
      else await platform.openOutings();
    } catch (e) {
      this.session.message(e.message);
    }
  },
  transcript(e) {
    this.session.set("text", e.detail.text);
  },
});
