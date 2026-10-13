const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { cleanBook, emptyBook } = require("../../shared/life.js");
const { parseResultFile } = require("../../shared/experience.js");
const {
  TripSession,
  planningFields,
  planningTasks,
} = require("../../shared/trip-ui.js");
Page({
  data: { ready: false, error: "", careMode: false },
  onLoad() {
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
    if (!this.session) return;
    if (
      JSON.stringify(platform.get("yike-life") || emptyBook()) !==
      this.bookStamp
    )
      this.load();
    else this.session.reopen();
  },
  onHide() {
    this.session?.close();
  },
  onUnload() {
    this.session?.close();
  },
  render(s) {
    const active = s.active;
    this.setData({
      ...s,
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
});
