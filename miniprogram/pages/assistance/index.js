const api = require("../../services/api.js");
const platform = require("../../platform/index.js");
const { HelperSession } = require("../../shared/assistance-ui.js");
Page({
  data: { view: null, error: "", busy: false, careMode: false },
  onLoad(options) {
    this.session = new HelperSession(
      (method, body) =>
        api.assistRequest(
          options.id,
          options.key,
          options.server,
          method,
          body,
        ),
      (s) => this.render(s),
    );
    this.setData({ careMode: !!platform.get("yike-care-mode") });
  },
  onShow() {
    this.session?.reopen();
  },
  onHide() {
    this.session?.close();
  },
  onUnload() {
    this.session?.close();
  },
  render(s) {
    const p = s.view?.snapshot,
      name = (id) => p?.stops.find((n) => n.id === id)?.name || id;
    this.setData({
      ...s,
      here: p ? name(p.currentId) : "",
      remainingText: p?.remaining.map(name).join(" → ") || "已回到出发点",
      confirmed: p ? new Date(p.confirmedAt).toLocaleString() : "",
      expires: s.view ? new Date(s.view.expiresAt).toLocaleTimeString() : "",
      candidates: p
        ? p.remaining
            .filter((id) => id !== p.homeId)
            .map((id) => ({
              id,
              name: name(id),
              checked: s.remaining.includes(id),
            }))
        : [],
      ordered: s.remaining.map((id, i) => ({
        id,
        name: name(id),
        first: i === 0,
      })),
      markerX: (s.kind === "entrance" ? s.x : p?.guide?.x || 0) * 100,
      markerY: (s.kind === "entrance" ? s.y : p?.guide?.y || 0) * 100,
    });
  },
  field(e) {
    this.session.field(e.currentTarget.dataset.key, e.detail.value);
  },
  kind(e) {
    this.session.field("kind", e.currentTarget.dataset.kind);
  },
  stop(e) {
    this.session.stop(e.currentTarget.dataset.id);
  },
  move(e) {
    this.session.move(e.currentTarget.dataset.id);
  },
  reset() {
    this.session.reset();
  },
  refresh() {
    return this.session.refresh();
  },
  send() {
    return this.session.send();
  },
  mark(e) {
    if (this.data.kind !== "entrance") return;
    wx.createSelectorQuery()
      .in(this)
      .select("#help-photo")
      .boundingClientRect((r) => {
        if (!r?.width || !r.height) return;
        this.session.field("x", (e.detail.x - r.left) / r.width);
        this.session.field("y", (e.detail.y - r.top) / r.height);
      })
      .exec();
  },
});
