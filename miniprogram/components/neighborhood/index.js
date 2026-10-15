const {
  NeighborhoodSession,
  NOTICE_KINDS,
} = require("../../shared/neighborhood-ui.js");
const api = require("../../services/api.js");
const platform = require("../../platform/index.js");
Component({
  properties: {
    large: { type: Boolean, value: false },
    context: { type: Object, value: null },
    choices: { type: Array, value: [] },
  },
  data: {
    ready: false,
    history: false,
    kindLabels: NOTICE_KINDS.map((k) => k.label),
    ages: [
      "刚刚",
      "约15分钟前",
      "约1小时前",
      "约3小时前",
      "约12小时前",
      "约1天前",
    ],
    sources: ["我亲眼看到", "听说或转述"],
  },
  observers: {
    "context, choices"() {
      this.setup();
    },
  },
  lifetimes: {
    attached() {
      this.setup();
      this.startClock();
    },
    detached() {
      clearInterval(this.clock);
      this.session?.dispose();
    },
  },
  pageLifetimes: {
    show() {
      this.startClock();
      this.session?.tick();
    },
    hide() {
      clearInterval(this.clock);
    },
  },
  methods: {
    setup() {
      const key = JSON.stringify([
        this.properties.context,
        this.properties.choices,
      ]);
      if (this.key === key || !this.properties.context) return;
      this.key = key;
      this.session?.dispose();
      try {
        this.session = new NeighborhoodSession(
          this.properties.context,
          this.properties.choices || [],
          {
            request: api.request,
            get: (key) => platform.get(key),
            set: (key, value) => platform.set(key, value),
            confirm: platform.confirm,
            notify: (s) => this.render(s),
          },
        );
        this.render(this.session.state);
      } catch {
        this.setData({ ready: false });
      }
    },
    startClock() {
      clearInterval(this.clock);
      this.clock = setInterval(() => this.session?.tick(), 30000);
    },
    render(s) {
      const active = s.notices.filter(
        (n) => !["expired", "clear", "withdrawn"].includes(n.state),
      );
      this.setData({
        ...s,
        ready: true,
        activeCount: active.length,
        oldCount: s.notices.length - active.length,
        visible: this.data.history ? s.notices : active,
        choiceLabels: s.choices.map((c) => c.label),
        kindIndex: NOTICE_KINDS.findIndex((k) => k.id === s.kind),
        sourceIndex: s.basis === "seen" ? 0 : 1,
        ageIndex: [0, 15, 60, 180, 720, 1440].indexOf(s.age),
        observationLabel:
          s.observation === "present"
            ? "仍有问题"
            : s.observation === "clear"
              ? "已经恢复"
              : "不能确定",
      });
    },
    toggle() {
      this.session?.toggle();
    },
    refresh() {
      return this.session?.refresh();
    },
    begin(e) {
      this.session?.begin(
        e.currentTarget.dataset.id,
        e.currentTarget.dataset.state || "present",
      );
    },
    field(e) {
      this.session?.field(e.currentTarget.dataset.key, e.detail.value);
    },
    share(e) {
      this.session?.field("share", e.detail.value.includes("share"));
    },
    source(e) {
      this.session?.field(
        "basis",
        Number(e.detail.value) === 0 ? "seen" : "heard",
      );
    },
    kind(e) {
      this.session?.field("kind", NOTICE_KINDS[Number(e.detail.value)].id);
    },
    ageChange(e) {
      this.session?.age([0, 15, 60, 180, 720, 1440][Number(e.detail.value)]);
    },
    choiceChange(e) {
      this.session?.choose(Number(e.detail.value));
    },
    filter(e) {
      this.session?.filter(e.detail.value.includes("steps"));
    },
    historyToggle() {
      this.setData({ history: !this.data.history });
      this.session?.tick();
    },
    restore() {
      this.session?.restore();
    },
    saveDraft() {
      this.session?.saveDraft();
    },
    cancel() {
      this.session?.cancel();
    },
    submit() {
      return this.session?.submit();
    },
    withdraw(e) {
      return this.session?.withdraw(e.currentTarget.dataset.id);
    },
  },
});
