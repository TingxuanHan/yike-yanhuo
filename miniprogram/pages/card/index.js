const api = require("../../services/api.js");
const platform = require("../../platform/index.js");
const { cleanPlace, placeCardText } = require("../../shared/life.js");
const { mapPosition } = require("../../shared/experience.js");
Page({
  data: {
    place: null,
    error: "",
    loading: true,
    expires: "",
    showPrivacy: false,
    privacyError: "",
  },
  onShow() {
    this.releasePrivacy?.();
    this.releasePrivacy = platform.watchPrivacy?.(this);
  },
  onHide() {
    this.releasePrivacy?.();
    this.releasePrivacy = null;
  },
  privacyAgree() {
    this.resolvePrivacy?.(true);
  },
  privacyDecline() {
    this.resolvePrivacy?.(false);
  },
  async privacyContract() {
    try {
      await platform.privacyContract();
    } catch (e) {
      this.setData({ privacyError: e.message });
    }
  },
  onLoad(options) {
    this.shareToken = options.share;
    this.server = options.server;
    this.alive = true;
    return this.load();
  },
  onUnload() {
    this.releasePrivacy?.();
    this.alive = false;
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const value = await api.readSharedCard(this.shareToken, this.server);
      const place = cleanPlace(value.place);
      if (this.alive)
        this.setData({ place, expires: value.expiresAt.slice(0, 10) });
    } catch (e) {
      if (this.alive) this.setData({ error: e.message, place: null });
    } finally {
      if (this.alive) this.setData({ loading: false });
    }
  },
  async copy() {
    try {
      await platform.clipboard(placeCardText(this.data.place));
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async directions() {
    try {
      const p = this.data.place,
        geo = mapPosition(p.position);
      if (!geo)
        throw new Error(
          p.position.system === "demo"
            ? "这是模拟地点，不能用于真实导航。"
            : "请复制地址后在地图中查找。",
        );
      await platform.openLocation({ ...geo, name: p.name, address: p.address });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShareAppMessage() {
    return {
      title: this.data.place
        ? `去${this.data.place.name}，认准这个入口`
        : "家人的地点卡",
      path: `/pages/card/index?share=${encodeURIComponent(this.shareToken || "")}&server=${encodeURIComponent(this.server || "")}`,
    };
  },
});
