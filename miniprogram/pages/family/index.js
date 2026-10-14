const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { FamilySession, locationSummary } = require("../../shared/family-ui.js");
const { emptyBook, cleanBook } = require("../../shared/life.js");
const { mapPosition } = require("../../shared/experience.js");
Page({
  data: {
    ready: false,
    viewer: false,
    showLocation: false,
    showPhone: false,
    showManual: false,
    showMap: false,
    showText: false,
    error: "",
    status: "",
    places: [],
    selectedPlace: 0,
    hasTrip: false,
    phone: "",
    showPrivacy: false,
    privacyError: "",
  },
  onLoad(options = {}) {
    this.options = options;
    this.setData({ viewer: !!options.id });
    if (options.id) return;
    try {
      this.book = cleanBook(platform.get("yike-life") || emptyBook());
      this.setData({
        places: this.book.places.filter((p) => p.position.system !== "demo"),
        hasTrip: !!platform.get("yike-active-trip"),
      });
      this.session = new FamilySession({
        get: platform.get,
        set: platform.set,
        locate: platform.currentLocation,
        confirm: platform.confirm,
        request: api.request,
        speedMps: this.book.preferences.speedMps,
        notify: (s) => this.render(s),
      });
      this.render(this.session.state);
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShow() {
    this.alive = true;
    this.releasePrivacy?.();
    this.releasePrivacy = platform.watchPrivacy?.(this);
    if (this.data.viewer) void this.refreshViewer();
    else this.session?.reopen();
  },
  onHide() {
    this.alive = false;
    this.session?.close();
    clearTimeout(this.timer);
    this.releasePrivacy?.();
    this.releasePrivacy = null;
    if (this.data.viewer)
      this.setData({
        ready: false,
        snapshot: null,
        summary: null,
        showMap: false,
        markers: [],
        circles: [],
      });
  },
  onUnload() {
    this.onHide();
  },
  render(s) {
    this.setData({
      ...s,
      ready: true,
      expires: s.share ? new Date(s.share.expiresAt).toLocaleTimeString() : "",
    });
    this.renderMap();
  },
  async refreshViewer() {
    if (!this.alive || this.reading) return;
    clearTimeout(this.timer);
    this.reading = true;
    let ended = false;
    try {
      const r = await api.familyRequest(
        this.options.id,
        this.options.key,
        this.options.server,
      );
      if (!this.alive) return;
      this.setData({
        ready: true,
        snapshot: r.snapshot,
        summary: locationSummary(r.snapshot),
        expires: new Date(r.expiresAt).toLocaleTimeString(),
        error: "",
      });
      this.renderMap();
    } catch (e) {
      if (!this.alive) return;
      ended = e.status === 410 || e.status === 404;
      this.setData({
        ready: false,
        snapshot: null,
        summary: null,
        showMap: false,
        markers: [],
        circles: [],
        error: e.message,
      });
    } finally {
      this.reading = false;
      if (this.alive && !ended)
        this.timer = setTimeout(() => void this.refreshViewer(), 15000);
    }
  },
  renderMap() {
    const p = this.data.snapshot?.record.position,
      geo = p ? mapPosition(p) : null;
    const radius = this.data.summary?.radiusM;
    this.setData({
      mapAvailable: !!geo,
      center: geo ? { longitude: geo.lng, latitude: geo.lat } : null,
      markers: geo
        ? [
            {
              id: 1,
              longitude: geo.lng,
              latitude: geo.lat,
              title: "最后记录点",
              width: 28,
              height: 28,
              callout: { content: "最后记录点，非实时位置", display: "ALWAYS" },
            },
          ]
        : [],
      circles:
        geo && radius !== null && radius !== undefined
          ? [
              {
                longitude: geo.lng,
                latitude: geo.lat,
                radius,
                color: "#78948aAA",
                fillColor: "#78948a22",
                strokeWidth: 2,
              },
            ]
          : [],
      mapScale: radius > 3000 ? 11 : radius > 1000 ? 13 : 15,
    });
  },
  toggle(e) {
    const k = e.currentTarget.dataset.key;
    if (
      [
        "showLocation",
        "showPhone",
        "showManual",
        "showMap",
        "showText",
      ].includes(k)
    )
      this.setData({ [k]: !this.data[k] });
  },
  phone(e) {
    this.session.phone(e.detail.value);
  },
  savePhone() {
    this.session.savePhone();
    if (this.session.state.phone) this.setData({ showPhone: false });
  },
  async call() {
    try {
      await platform.callFamily(this.data.phone);
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  locate() {
    this.setData({ showLocation: true });
    return this.session.locate();
  },
  async settings() {
    try {
      await platform.locationSettings();
      this.session.message("设置完成后，请再点击获取一次位置。");
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  choosePlace(e) {
    this.setData({ selectedPlace: Number(e.detail.value) });
  },
  confirmPlace() {
    const p = this.data.places[this.data.selectedPlace];
    if (p) return this.session.confirmPlace(p.name, p.position);
  },
  copy() {
    return this.session.copyText((t) => platform.clipboard(t));
  },
  share() {
    return this.session.share();
  },
  end() {
    return this.session.end();
  },
  async copyLink() {
    try {
      await platform.clipboard(
        `${api.serverAddress()}/#family=${this.data.share.id}&key=${this.data.invite}`,
      );
      this.session.message("链接已复制，请只发给信任的家人。");
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  trip() {
    wx.navigateTo({ url: "/pages/trip/index?help=1" });
  },
  onShareAppMessage() {
    if (!this.data.viewer && this.data.share && this.data.invite)
      return {
        title: "请帮我确认位置 · 非实时定位",
        path: `/pages/family/index?id=${encodeURIComponent(this.data.share.id)}&key=${encodeURIComponent(this.data.invite)}&server=${encodeURIComponent(api.serverAddress())}`,
      };
    return { title: "一刻烟火", path: "/pages/home/index" };
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
});
