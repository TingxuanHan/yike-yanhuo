const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { adjustTrip, tripBasis } = require("../../shared/trip-adjust.js");
const { cleanBook, emptyBook } = require("../../shared/life.js");
const { parseResultFile } = require("../../shared/experience.js");
const {
  TripSession,
  planningFields,
  planningTasks,
} = require("../../shared/trip-ui.js");
Page({
  data: {
    ready: false,
    error: "",
    careMode: false,
    simpleMode: false,
    showMore: false,
  },
  onLoad(options = {}) {
    this.helpRequested = options.help === "1";
    this.setData({ simpleMode: platform.get("yike-simple-mode") !== false });
    this.load();
  },
  load() {
    try {
      const book = cleanBook(platform.get("yike-life") || emptyBook()),
        raw = platform.get("yike-last-report"),
        report = raw ? parseResultFile(JSON.stringify(raw)) : null,
        handoff = platform.get("yike-planning-handoff");
      this.session?.close();
      this.bookStamp = JSON.stringify(book);
      this.session = new TripSession(
        book,
        report,
        {
          get: (k) => platform.get(k),
          set: (k, v) => platform.set(k, v),
          save: (b) => {
            platform.set("yike-life", cleanBook(b));
            this.bookStamp = JSON.stringify(b);
          },
          request: api.request,
          confirm: platform.confirm,
          notify: (s) => this.render(s),
        },
        handoff?.target === "trip" ? handoff.draft : undefined,
      );
      if (handoff?.target === "trip") platform.remove("yike-planning-handoff");
      this.setData({ ready: true, careMode: !!platform.get("yike-care-mode") });
      this.session.emit();
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShow() {
    this.releasePrivacy?.();
    this.releasePrivacy = platform.watchPrivacy?.(this);
    if (!this.session) return;
    if (
      JSON.stringify(platform.get("yike-life") || emptyBook()) !==
      this.bookStamp
    )
      this.load();
    else this.session.reopen();
    if (this.helpRequested) {
      this.helpRequested = false;
      platform.reveal("#trip-assistance");
    }
  },
  onHide() {
    this.releasePrivacy?.();
    this.releasePrivacy = null;
    this.session?.close();
  },
  onUnload() {
    this.releasePrivacy?.();
    this.session?.close();
  },
  more() {
    this.setData({ showMore: !this.data.showMore });
  },
  family() {
    wx.navigateTo({ url: "/pages/family/index" });
  },
  render(s) {
    const active = s.active;
    const nodes = active ? [active.input.origin, ...active.input.stops] : [],
      name = (id) => nodes.find((n) => n.id === id)?.name || id;
    const proposal = s.assistance.view?.proposal;
    let helpChanges = [];
    if (proposal?.change && active) {
      try {
        if (s.assistance.view.snapshot.basis !== tripBasis(active))
          throw new Error("行程已变化，请先刷新协助。");
        helpChanges = adjustTrip(active, proposal.change).changes;
      } catch (e) {
        helpChanges = [e.message];
      }
    }
    this.setData({
      ...s,
      helpChanges,
      helpExpires: s.assistance.view
        ? new Date(s.assistance.view.expiresAt).toLocaleTimeString()
        : "",
      helpUpdated: s.assistance.view
        ? new Date(s.assistance.view.updatedAt).toLocaleTimeString()
        : "",
      entrancePlaces: active
        ? [...new Set([active.currentId, ...active.remaining])].map((id) => ({
            id,
            name: name(id),
          }))
        : [],
      entranceX: (s.entrance?.x || 0) * 100,
      entranceY: (s.entrance?.y || 0) * 100,
      suggestionX: (proposal?.marker?.x || 0) * 100,
      suggestionY: (proposal?.marker?.y || 0) * 100,
      adjustChoices: active
        ? active.remaining
            .filter((id) => id !== active.input.origin.id)
            .map((id) => ({
              id,
              name: name(id),
              checked: s.adjust?.remaining.includes(id) || false,
            }))
        : [],
      adjustOrdered:
        s.adjust?.remaining.map((id, i) => ({
          id,
          name: name(id),
          first: i === 0,
        })) || [],
      fields: planningFields.map((f) => ({ ...f, value: s.form[f.key] })),
      taskRows: planningTasks.map((t) => ({
        ...t,
        checked: s.tasks.includes(t.id),
      })),
      plans: s.plans.map((p) => ({
        ...p,
        minutes: p.minutes.toFixed(1),
        walking: p.walking.toFixed(1),
        low: p.low.toFixed(2),
        high: p.high.toFixed(2),
        gap: p.gap.toFixed(1),
        label: p.labels.join(" · "),
        missedText: p.missed.join("、"),
        legs: p.legs.map((l, i) => ({
          ...l,
          walking: l.walking.toFixed(1),
          phasesText: [
            ...new Set(
              l.phases
                .filter((x) => x.kind !== "wait")
                .map((x) => `${x.label} ${x.speed}米/秒`),
            ),
          ].join("，"),
          buy: p.purchases
            .filter((x) => x.quote?.store.id === p.stopIds[i])
            .map((x) => `${x.item.name} ×${x.item.quantity}${x.item.unit}`)
            .join("、"),
        })),
      })),
      activeDemo: active ? active.input.bundle.mode === "demo" : s.demo,
      late: (s.remaining?.late ?? 0).toFixed(1),
      feedbackPlaces: active
        ? active.input.stops
            .filter((n) => active.completed.includes(n.id))
            .map((n) => ({
              id: n.id,
              name: n.name,
              checked: s.feedback.difficult.includes(n.id),
            }))
        : [],
      recent: s.recent
        .slice(0, 5)
        .map((t) => ({ ...t, totalMinutes: t.totalMinutes.toFixed(1) })),
    });
  },
  field(e) {
    this.session.set(e.currentTarget.dataset.key, e.detail.value);
  },
  task(e) {
    this.session.task(e.currentTarget.dataset.id);
  },
  candidate(e) {
    this.session.candidate(e.currentTarget.dataset.id);
  },
  returnChange() {
    this.session.toggleReturn();
  },
  mode(e) {
    this.session.set("mode", e.currentTarget.dataset.mode);
  },
  transcript(e) {
    this.session.set("text", e.detail.text);
  },
  edit() {
    return this.session.edit();
  },
  accept() {
    this.session.accept();
  },
  reject() {
    this.session.reject();
  },
  async calculate() {
    await this.session.calculate();
    this.setData({}, () =>
      platform.reveal?.(
        this.data.error
          ? ".error"
          : this.data.plans.length
            ? ".trip-result"
            : ".status",
      ),
    );
  },
  start(e) {
    return this.session.start(e.currentTarget.dataset.id);
  },
  step(e) {
    return this.session.step(e.currentTarget.dataset.kind);
  },
  refresh() {
    this.session.refreshProgress();
  },
  feedback(e) {
    this.session.feedbackField(e.currentTarget.dataset.key, e.detail.value);
  },
  difficult(e) {
    this.session.difficult(e.currentTarget.dataset.id);
  },
  finish() {
    return this.session.finish();
  },
  toggleFeedback() {
    this.setData({ showFeedback: !this.data.showFeedback });
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
  phonePanel() {
    this.setData({
      showPhone: !this.data.showPhone,
      helpPhone: platform.get("yike-help-phone") || "",
    });
  },
  phone(e) {
    const value = e.detail.value.replace(/[^+0-9]/g, "").slice(0, 20);
    this.setData({ helpPhone: value });
    try {
      platform.set("yike-help-phone", value);
    } catch (e) {
      this.session.message(e.message);
    }
  },
  async callFamily() {
    try {
      await platform.callFamily?.(this.data.helpPhone);
    } catch (e) {
      this.session.message(e.message);
    }
  },
  applyPace() {
    return this.session.applyPace();
  },
  shopping() {
    return platform.openShopping();
  },
  care() {
    const careMode = !this.data.careMode;
    platform.set("yike-care-mode", careMode);
    this.setData({ careMode });
  },
  helpRequest(e) {
    this.session.helpRequest(e.detail.value);
  },
  startHelp() {
    return this.session.startHelp();
  },
  restoreHelp() {
    return this.session.assistance.restore();
  },
  refreshHelp() {
    return this.session.assistance.refresh();
  },
  endHelp() {
    return this.session.assistance.end();
  },
  acceptHelp() {
    return this.session.assistance.decide(true);
  },
  rejectHelp() {
    return this.session.assistance.decide(false);
  },
  async copyHelp() {
    try {
      const h = this.data.assistance;
      await platform.clipboard(
        `${api.serverAddress()}/#assist=${h.view.id}&key=${h.invite}`,
      );
      this.setData({ helpCopy: "链接已复制，请发给信任的家人。" });
    } catch (e) {
      this.session.message(e.message);
    }
  },
  onShareAppMessage() {
    const h = this.data.assistance;
    return h?.view && h.invite
      ? {
          title: "家人想请你帮忙看看这趟行程",
          path: `/pages/assistance/index?id=${encodeURIComponent(h.view.id)}&key=${encodeURIComponent(h.invite)}&server=${encodeURIComponent(api.serverAddress())}`,
        }
      : { title: "一刻烟火", path: "/pages/home/index" };
  },
  editRemaining() {
    this.setData({ showAdjust: !this.data.showAdjust });
    if (this.data.showAdjust) this.session.editRemaining();
  },
  adjustStop(e) {
    this.session.adjustStop(e.currentTarget.dataset.id);
  },
  moveStop(e) {
    this.session.moveStop(e.currentTarget.dataset.id);
  },
  adjustSpeed(e) {
    this.session.adjustSpeed(e.detail.value);
  },
  previewRemaining() {
    this.session.previewRemaining();
  },
  applyRemaining() {
    return this.session.applyRemaining();
  },
  showEntrance() {
    this.setData({ entranceOpen: !this.data.entranceOpen });
    const a = this.data.active;
    if (this.data.entranceOpen && !this.data.entrance && a)
      this.session.selectEntrance(a.remaining[0] || a.currentId);
  },
  selectEntrance(e) {
    this.session.selectEntrance(e.currentTarget.dataset.id);
  },
  entranceField(e) {
    this.session.entranceField(e.currentTarget.dataset.key, e.detail.value);
  },
  async chooseEntrancePhoto() {
    try {
      this.session.entranceField("photo", await platform.choosePhoto());
    } catch (e) {
      this.session.message(e.message);
    }
  },
  markEntrance(e) {
    wx.createSelectorQuery()
      .in(this)
      .select("#entrance-photo")
      .boundingClientRect((r) => {
        if (r?.width && r.height) {
          this.session.entranceField("x", (e.detail.x - r.left) / r.width);
          this.session.entranceField("y", (e.detail.y - r.top) / r.height);
        }
      })
      .exec();
  },
  saveEntrance() {
    this.session.saveEntranceDraft();
  },
  removeEntrance() {
    return this.session.removeEntrance();
  },
  shareEntrance() {
    return this.session.shareEntrance();
  },
});
