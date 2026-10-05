const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { emptyBook, cleanBook, cleanPlace } = require("../../shared/life.js");
const { cleanJourney } = require("../../shared/journey.js");
const { usableFacility } = require("../../shared/facility-review.js");
Page({
  data: {
    tab: "places",
    book: emptyBook(),
    server: "",
    connected: false,
    revision: null,
    incoming: null,
    busy: false,
    error: "",
    status: "",
    code: "",
    pairCode: "",
    invite: "",
    form: { name: "", address: "", landmark: "", note: "", visitedOn: "" },
    position: null,
    editing: null,
    card: null,
    reports: [],
    result: null,
    areas: [],
    undo: null,
  },
  onLoad() {
    this.alive = true;
    let book = emptyBook(),
      error = "";
    try {
      const saved = platform.get("yike-life");
      if (saved) book = cleanBook(saved);
    } catch {
      error = "本机记录无法读取，请从服务器或私人备份恢复。";
    }
    this.setData({
      book,
      error,
      server: platform.get("yike-server") || "http://127.0.0.1:8787",
      connected: !!platform.get("yike-token"),
    });
  },
  onUnload() {
    this.alive = false;
    clearTimeout(this.pollTimer);
    if (this.rejectPoll) this.rejectPoll(new Error("页面已关闭"));
    if (this.jobId)
      void api.request(`/api/analyses/${this.jobId}`, "DELETE").catch(() => {});
  },
  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },
  field(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },
  pref(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`book.preferences.${key}`]: ["minutes", "speedMps"].includes(key)
        ? Number(e.detail.value)
        : e.detail.value,
    });
  },
  signal(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`book.preferences.signals.${key}`]:
        key === "enabled"
          ? e.detail.value
          : ["crossingsPerKm", "offPeakSeconds", "peakSeconds"].includes(key)
            ? Number(e.detail.value)
            : e.detail.value,
    });
  },
  async action(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "", status: "" });
    try {
      await fn();
    } catch (e) {
      if (this.alive)
        this.setData({ error: e.message || "操作未完成，请重试。" });
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  save(book) {
    const valid = cleanBook(book);
    platform.set("yike-life", valid);
    this.setData({ book: valid });
  },
  choose() {
    return this.action(async () => {
      const p = await platform.choosePlace();
      this.setData({
        position: p.position,
        "form.name": p.name,
        "form.address": p.address,
      });
    });
  },
  remember() {
    return this.action(() => {
      if (!this.data.position) throw new Error("请先选取小店入口位置。");
      const p = cleanPlace({
        ...this.data.form,
        id:
          this.data.editing ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        position: this.data.position,
        source: "personal",
      });
      this.save({
        ...this.data.book,
        places: [...this.data.book.places.filter((x) => x.id !== p.id), p],
      });
      this.setData({
        card: p,
        position: null,
        editing: null,
        form: { name: "", address: "", landmark: "", note: "", visitedOn: "" },
        status: "地点已记在本机，可在连接页手动同步。",
      });
    });
  },
  card(e) {
    this.setData({
      card: this.data.book.places.find(
        (p) => p.id === e.currentTarget.dataset.id,
      ),
    });
  },
  closeCard() {
    this.setData({ card: null });
  },
  edit(e) {
    const p = this.data.book.places.find(
      (p) => p.id === e.currentTarget.dataset.id,
    );
    this.setData({
      form: {
        name: p.name,
        address: p.address,
        landmark: p.landmark,
        note: p.note,
        visitedOn: p.visitedOn,
      },
      position: p.position,
      editing: p.id,
    });
  },
  remove(e) {
    return this.action(() => {
      this.setData({ undo: this.data.book });
      this.save({
        ...this.data.book,
        places: this.data.book.places.filter(
          (p) => p.id !== e.currentTarget.dataset.id,
        ),
      });
      this.setData({ card: null, status: "本机地点已移除，可撤销。" });
    });
  },
  undo() {
    return this.action(() => {
      if (this.data.undo) {
        this.save(this.data.undo);
        this.setData({ undo: null, status: "已恢复本机记录。" });
      }
    });
  },
  savePrefs() {
    return this.action(() => {
      this.save({
        ...this.data.book,
        preferences: cleanJourney(this.data.book.preferences),
      });
      this.setData({ status: "出行偏好已保存。" });
    });
  },
  applyIncoming(e) {
    return this.action(() => {
      const s = this.data.incoming;
      if (!s) return;
      this.setData({ undo: this.data.book });
      let book = s.book;
      if (e.currentTarget.dataset.merge) {
        const places = new Map(s.book.places.map((p) => [p.id, p]));
        this.data.book.places.forEach((p) => places.set(p.id, p));
        book = { ...this.data.book, places: [...places.values()] };
      }
      this.save(book);
      this.setData({
        revision: s.revision,
        incoming: null,
        status: "内容已保留到本机；合并冲突保留本机值，请核对后同步。",
      });
    });
  },
  async ensureServer() {
    const server = this.data.server.replace(/\/$/, "");
    if (!api.validServer(server))
      throw new Error("请填写HTTPS服务器地址，本机调试可用localhost。");
    if (platform.get("yike-server") !== server) {
      platform.remove("yike-token");
      this.setData({
        connected: false,
        revision: null,
        incoming: null,
        pairCode: "",
        reports: [],
        result: null,
        areas: [],
      });
    }
    platform.set("yike-server", server);
  },
  connect() {
    return this.action(async () => {
      await this.ensureServer();
      const v = await api.request("/api/life/redeem", "POST", {
        code: this.data.code,
        client: "mini",
      });
      platform.set("yike-token", v.token);
      this.setData({
        connected: true,
        revision: null,
        incoming: v.snapshot,
        code: "",
        status: "已连接，请读取或合并服务器版本。",
      });
    });
  },
  create() {
    return this.action(async () => {
      await this.ensureServer();
      const v = await api.request("/api/life/create", "POST", {
        invite: this.data.invite,
        client: "mini",
      });
      platform.set("yike-token", v.token);
      this.setData({
        connected: true,
        revision: v.snapshot.revision,
        invite: "",
        status: "私人地点簿已创建，可同步本机修改。",
      });
    });
  },
  pull() {
    return this.action(async () => {
      await this.ensureServer();
      this.setData({ incoming: await api.request("/api/life") });
    });
  },
  push() {
    return this.action(async () => {
      if (this.data.revision === null || this.data.incoming)
        throw new Error("请先读取或合并服务器版本。");
      this.save(this.data.book);
      const v = await api.request("/api/life", "PUT", {
        revision: this.data.revision,
        book: this.data.book,
      });
      this.setData({
        revision: v.revision,
        status: "已同步到服务器，Web可以读取。",
      });
    });
  },
  pair() {
    return this.action(async () => {
      const v = await api.request("/api/life/pair", "POST", {});
      this.setData({
        pairCode: v.code,
        status: "配对码5分钟内有效，仅可用一次，请只交给信任的人。",
      });
    });
  },
  copyPair() {
    return this.action(() => platform.clipboard(this.data.pairCode));
  },
  disconnect() {
    return this.action(async () => {
      await api.request("/api/life/session", "DELETE");
      platform.remove("yike-token");
      this.setData({
        connected: false,
        revision: null,
        incoming: null,
        pairCode: "",
        reports: [],
        status: "已断开此设备，本机记录仍保留。",
      });
    });
  },
  setResult(result) {
    const minutes = result.scenario ? result.scenario.preferences.minutes : 15;
    this.setData({
      result,
      nearby: result.facilities
        .filter(
          (p) =>
            usableFacility(p) &&
            p.travel &&
            p.travel.status === "ok" &&
            p.travel.seconds <= minutes * 60,
        )
        .slice(0, 30)
        .map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          minutes: Math.ceil(p.travel.seconds / 60),
        })),
      areas: result.contours.map((c) => ({
        minutes: c.minutes,
        area: c.areaKm2.toFixed(2),
        clipped: c.clipped,
      })),
      tab: "journey",
    });
  },
  cancelAnalysis() {
    if (this.jobId)
      void api
        .request(`/api/analyses/${this.jobId}`, "DELETE")
        .catch((e) => this.setData({ error: e.message }));
  },
  async poll(id) {
    this.jobId = id;
    while (this.alive) {
      const job = await api.request(`/api/analyses/${id}`);
      if (job.status === "done") {
        this.jobId = null;
        return job.result;
      }
      if (job.status !== "running")
        throw new Error(job.error || "体检已取消。");
      this.setData({
        status: `${job.progress.stage} ${job.progress.done}/${job.progress.total}`,
      });
      await new Promise((resolve, reject) => {
        this.rejectPoll = reject;
        this.pollTimer = setTimeout(resolve, 1000);
      });
    }
    throw new Error("页面已关闭");
  },
  demo() {
    return this.action(async () => {
      await this.ensureServer();
      const job = await api.request("/api/analyses", "POST", { mode: "demo" });
      this.setResult(await this.poll(job.id));
      this.setData({ status: "模拟体检完成，可按个人偏好试算。" });
    });
  },
  analyzePlace(e) {
    return this.action(async () => {
      const p = this.data.book.places.find(
        (p) => p.id === e.currentTarget.dataset.id,
      );
      let input;
      if (p.position.system === "demo") {
        input = {
          mode: "demo",
          label: p.name,
          point: [p.position.x, p.position.y],
        };
      } else {
        const c = p.position;
        const geo =
          c.system === "bd09"
            ? { lng: c.lng, lat: c.lat }
            : (
                await api.request("/api/convert", "POST", {
                  geo: { lng: c.lng, lat: c.lat },
                  from: c.system === "gcj02" ? 3 : 1,
                })
              ).geo;
        input = { mode: "baidu", label: p.name, geo };
      }
      const job = await api.request("/api/analyses", "POST", input);
      this.setResult(await this.poll(job.id));
      this.setData({ status: "体检完成，可保存为共享报告。" });
    });
  },
  scenario() {
    return this.action(async () => {
      if (!this.data.result)
        throw new Error("请先打开共享报告或完成一次体检。");
      this.save(this.data.book);
      this.setResult(
        await api.request("/api/personalize", "POST", {
          result: this.data.result,
          preferences: this.data.book.preferences,
        }),
      );
      this.setData({ status: "试算完成，未新增百度路线调用。" });
    });
  },
  loadReports() {
    return this.action(async () => {
      this.setData({ reports: await api.request("/api/life/reports") });
    });
  },
  openReport(e) {
    return this.action(async () =>
      this.setResult(
        await api.request(
          `/api/life/reports/${encodeURIComponent(e.currentTarget.dataset.id)}`,
        ),
      ),
    );
  },
  shareReport() {
    return this.action(async () => {
      await api.request("/api/life/reports", "POST", {
        result: this.data.result,
      });
      this.setData({ status: "报告已保存，Web和配对设备可以读取。" });
    });
  },
});
