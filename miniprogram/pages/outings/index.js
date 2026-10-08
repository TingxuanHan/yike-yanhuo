const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { emptyBook, cleanBook } = require("../../shared/life.js");
const { cleanJourney } = require("../../shared/journey.js");
const outing = require("../../shared/outings-ui.js");
const experience = require("../../shared/experience.js");
const blankStep = () => ({ title: "", instruction: "" });
Page({
  data: {
    tab: "errands",
    tabs: [
      { id: "errands", label: "一趟办齐" },
      { id: "familiar", label: "家人带过的路" },
      { id: "rest", label: "走走歇歇" },
      { id: "impact", label: "补点看变化" },
    ],
    demo: true,
    hasReal: false,
    careMode: false,
    busy: false,
    error: "",
    status: "",
    label: "",
    date: "",
    showPrivacy: false,
    privacyError: "",
    prefs: emptyBook().preferences,
    budget: 45,
    taskRows: outing.taskOptions.map((o) => ({
      ...o,
      checked: ["market", "pharmacy"].includes(o.id),
    })),
    candidates: [],
    plans: [],
    targetIndex: -1,
    targetNames: [],
    continuous: 6,
    restMinutes: 2,
    restRows: [],
    restPlans: [],
    restList: [],
    placeIndex: 0,
    placeNames: [],
    restChecked: outing.todayLocal(),
    restUntil: outing.todayLocal(),
    restNote: "",
    impactCategory: "pharmacy",
    impactCategories: [
      { id: "pharmacy", label: "药店" },
      { id: "market", label: "菜市场" },
      { id: "school", label: "小学" },
    ],
    impactCategoryIndex: 0,
    newIndex: 0,
    newNames: [],
    baselineNames: "",
    sampleCount: 0,
    impact: null,
    routeName: "",
    checkedOn: outing.todayLocal(),
    steps: [blankStep(), blankStep()],
    routeList: [],
    card: null,
    cardIndex: 0,
    cardStep: null,
    hasUndo: false,
    showRouteEditor: true,
    showSettings: false,
    showOpenings: false,
  },
  onLoad() {
    this.alive = true;
    this.cancelled = false;
    this.editing = null;
    this.restIds = null;
    try {
      this.book = cleanBook(platform.get("yike-life") || emptyBook());
      this.cache = new outing.OutingRouteCache(
        platform.get("yike-outing-routes") || [],
      );
      const raw = platform.get("yike-last-report");
      this.report = raw
        ? experience.parseResultFile(JSON.stringify(raw))
        : null;
      this.setData({
        prefs: cleanJourney(this.book.preferences),
        demo: this.report?.mode !== "baidu",
        hasReal: this.report?.mode === "baidu",
        careMode: !!platform.get("yike-care-mode"),
      });
      this.refreshBook();
      this.setData({ showRouteEditor: !this.book.familiarRoutes?.length });
      this.rebuild();
      const draft = platform.get("yike-familiar-draft");
      if (draft) {
        const restored = outing.cleanFamiliarDraft(draft);
        this.editing = restored.id;
        this.setData({
          routeName: restored.name,
          checkedOn: restored.checkedOn,
          steps: restored.steps,
        });
      }
    } catch (e) {
      this.book = this.book || emptyBook();
      this.cache = this.cache || new outing.OutingRouteCache();
      this.setData({ error: e.message, demo: true });
      this.rebuild();
    }
  },
  onShow() {
    this.releasePrivacy?.();
    this.releasePrivacy = platform.watchPrivacy?.(this);
  },
  onHide() {
    this.releasePrivacy?.();
    this.releasePrivacy = null;
  },
  async shopping() {
    try {
      await platform.openShopping();
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onUnload() {
    this.alive = false;
    this.cancelled = true;
    this.releasePrivacy?.();
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
  clearResults() {
    this.setData({ plans: [], restPlans: [], impact: null });
  },
  rebuild() {
    this.scene = this.data.demo
      ? outing.demoScene()
      : outing.sceneFromReport(this.report, this.book);
    const scene = this.scene,
      targetIndex = Math.min(
        this.data.targetIndex < 0
          ? Math.max(
              0,
              scene.facilities.findIndex((n) => n.category === "park"),
            )
          : this.data.targetIndex,
        Math.max(0, scene.facilities.length - 1),
      );
    const selected =
      this.restIds ??
      scene.rests
        .filter((r) => r.validUntil >= outing.todayLocal())
        .slice(0, 3)
        .map((r) => r.id);
    this.setData({
      label: scene.label,
      date: scene.date.slice(0, 10),
      targetNames: scene.facilities.map((n) => n.name),
      targetIndex,
      restRows: scene.rests.map((r) => ({
        ...r,
        checked: selected.includes(r.id),
        expired: r.validUntil < outing.todayLocal(),
      })),
      newNames: scene.proposed.map((n) => n.name),
      newIndex: Math.min(
        this.data.newIndex,
        Math.max(0, scene.proposed.length - 1),
      ),
      sampleCount: scene.samples.length,
    });
    this.updateCandidates();
    this.updateBaseline();
  },
  updateCandidates() {
    try {
      const { nodes } = this.selection();
      const old = new Map(this.data.candidates.map((n) => [n.id, n]));
      this.setData({
        candidates: nodes.slice(1).map((n) => ({
          ...n,
          open: old.get(n.id)?.open || "",
          close: old.get(n.id)?.close || "",
        })),
      });
    } catch {
      this.setData({ candidates: [] });
    }
  },
  updateBaseline() {
    this.setData({
      baselineNames:
        this.scene.facilities
          .filter((n) => n.category === this.data.impactCategory)
          .slice(0, 3)
          .map((n) => n.name)
          .join("、") || "当前结果没有同类设施",
    });
  },
  selection() {
    return outing.errandSelection(
      this.scene,
      this.data.taskRows.filter((t) => t.checked).map((t) => t.id),
      Object.fromEntries(this.data.taskRows.map((t) => [t.id, Number(t.stay)])),
    );
  },
  refreshBook() {
    this.setData({
      routeList: (this.book.familiarRoutes || []).map((r) => ({
        id: r.id,
        name: r.name,
        checkedOn: r.checkedOn,
        count: r.steps.length,
      })),
      placeNames: this.book.places.map((p) => p.name),
      restList: (this.book.restPoints || []).map((r) => ({
        id: r.id,
        name: r.name,
        validUntil: r.validUntil,
      })),
    });
  },
  saveBook(value) {
    const valid = cleanBook(value);
    platform.set("yike-life", valid);
    this.book = valid;
    this.refreshBook();
    this.rebuild();
  },
  async action(fn) {
    if (this.data.busy) return;
    this.cancelled = false;
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
  tab(e) {
    if (this.data.busy) return;
    this.setData(
      { tab: e.currentTarget.dataset.tab, error: "", status: "" },
      () => platform.reveal?.(".outing-heading"),
    );
  },
  toggle(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.busy && ["showSettings", "showOpenings"].includes(key))
      this.setData({ [key]: !this.data[key] });
  },
  source(e) {
    if (this.data.busy) return;
    this.restIds = null;
    this.setData({
      demo:
        e.currentTarget.dataset.demo === true ||
        e.currentTarget.dataset.demo === "true",
      targetIndex: -1,
      newIndex: 0,
      candidates: [],
    });
    this.clearResults();
    this.rebuild();
  },
  care() {
    const value = !this.data.careMode;
    platform.set("yike-care-mode", value);
    this.setData({ careMode: value });
  },
  field(e) {
    const { key, number } = e.currentTarget.dataset;
    this.setData({ [key]: number ? Number(e.detail.value) : e.detail.value });
    this.clearResults();
    if (["routeName", "checkedOn"].includes(key)) this.stash();
  },
  task(e) {
    const { index } = e.currentTarget.dataset,
      rows = this.data.taskRows.map((r, i) =>
        i === Number(index) ? { ...r, checked: !r.checked } : r,
      );
    if (rows.filter((r) => r.checked).length > 3) {
      this.setData({ error: "一次最多安排3件事。" });
      return;
    }
    this.setData({ taskRows: rows });
    this.clearResults();
    this.updateCandidates();
  },
  stay(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({
      taskRows: this.data.taskRows.map((r, i) =>
        i === index ? { ...r, stay: Number(e.detail.value) } : r,
      ),
    });
    this.clearResults();
  },
  window(e) {
    const i = Number(e.currentTarget.dataset.index),
      key = e.currentTarget.dataset.key;
    this.setData({
      candidates: this.data.candidates.map((r, j) =>
        i === j ? { ...r, [key]: e.detail.value } : r,
      ),
    });
    this.clearResults();
  },
  clearWindow(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({
      candidates: this.data.candidates.map((r, j) =>
        i === j ? { ...r, open: "", close: "" } : r,
      ),
    });
    this.clearResults();
  },
  stop() {
    this.cancelled = true;
    this.setData({ status: "正在停止，保留已读取路线。" });
  },
  async routes(nodes, pairs) {
    const count = this.cache.pending(nodes, pairs).length;
    if (this.scene.mode === "baidu" && count) {
      if (
        !(await platform.confirm(
          `本次最多读取${count}段路线；每段最多重试一次，继续沿用账户预算和串行限速。`,
        ))
      )
        throw new Error("已取消读取路线。");
      const q = await api.request("/api/quota");
      if (q.limits.route - q.used.route < count * 2)
        throw new Error("剩余预算不足，请减少候选地点或打开示例。");
    }
    return this.cache.obtain(
      nodes,
      pairs,
      (b) => api.request("/api/outings/routes", "POST", b),
      (done, total) => {
        platform.set("yike-outing-routes", this.cache.snapshot());
        if (this.alive)
          this.setData({
            status: `已读取 ${done}/${total} 段路线${this.data.demo ? " · 示例不消耗地图额度" : ""}`,
          });
      },
      () => this.cancelled,
    );
  },
  errands() {
    return this.action(async () => {
      const s = this.selection(),
        prefs = cleanJourney(this.data.prefs),
        windows = {};
      for (const c of this.data.candidates)
        if (c.open || c.close) {
          if (!c.open || !c.close)
            throw new Error("请一起填写开门和关门时间，或都留空。");
          windows[c.id] = { start: c.open, end: c.close };
        }
      outing.planErrands(
        { nodes: s.nodes, edges: [], mode: this.scene.mode, generatedAt: "" },
        this.scene.origin.id,
        s.tasks,
        prefs,
        this.data.budget,
        windows,
      );
      const r = outing.planErrands(
        await this.routes(s.nodes, outing.allPairs(s.nodes)),
        this.scene.origin.id,
        s.tasks,
        prefs,
        this.data.budget,
        windows,
      );
      this.setData(
        {
          plans: r.plans.map(outing.itineraryText),
          status: r.plans.length
            ? "已计入返程、停留和所填的营业时间。"
            : "当前候选中没有符合时间预算的方案；可延长时间、减少任务或检查缺失路线。",
        },
        () => platform.reveal?.(r.plans.length ? ".outing-result" : ".notice"),
      );
    });
  },
  restToggle(e) {
    const id = e.currentTarget.dataset.id,
      current = this.data.restRows.filter((r) => r.checked).map((r) => r.id),
      next = current.includes(id)
        ? current.filter((v) => v !== id)
        : [...current, id];
    if (next.length > 3) {
      this.setData({ error: "最多选择3个休息点。" });
      return;
    }
    this.restIds = next;
    this.clearResults();
    this.rebuild();
  },
  target(e) {
    this.setData({ targetIndex: Number(e.detail.value) });
    this.clearResults();
  },
  restJourney() {
    return this.action(async () => {
      const target = this.scene.facilities[this.data.targetIndex];
      if (!target) throw new Error("请先选择目的地。");
      const rests = this.data.restRows.filter(
          (r) => r.checked && !r.expired && r.id !== target.id,
        ),
        nodes = [this.scene.origin, target, ...rests];
      outing.planRestJourney(
        { nodes, edges: [], mode: this.scene.mode, generatedAt: "" },
        this.scene.origin.id,
        target.id,
        rests,
        this.data.prefs,
        this.data.continuous,
        this.data.restMinutes,
      );
      const r = outing.planRestJourney(
        await this.routes(nodes, outing.allPairs(nodes)),
        this.scene.origin.id,
        target.id,
        rests,
        this.data.prefs,
        this.data.continuous,
        this.data.restMinutes,
      );
      this.setData(
        {
          restPlans: r.plans.map((p) => ({
            summary: `${outing.minutesText(p.totalMinutes)} · 歇脚${p.restCount}次`,
            detail: `最长连续步行${outing.minutesText(p.longestMinutes)}，预计${p.finish}到达。`,
            rows: p.visits.map(
              (v) =>
                `${v.arrival} ${v.name} · 走${outing.minutesText(v.walkMinutes)}${v.stayMinutes ? `，休息${outing.minutesText(v.stayMinutes)}` : ""}`,
            ),
          })),
          status: r.plans.length
            ? "已找到符合连续步行上限的走法。"
            : "当前路线和已核验休息点暂时无法满足条件，请调整上限或补充休息点。",
        },
        () => platform.reveal?.(r.plans.length ? ".outing-result" : ".notice"),
      );
    });
  },
  place(e) {
    this.setData({ placeIndex: Number(e.detail.value) });
  },
  saveRest() {
    return this.action(() => {
      const p = this.book.places[this.data.placeIndex];
      if (!p) throw new Error("请先在地点簿记录休息点的位置。");
      const r = outing.cleanRestPoint({
        ...p,
        id: `rest-${p.id}`,
        checkedOn: this.data.restChecked,
        validUntil: this.data.restUntil,
        note: this.data.restNote,
      });
      this.saveBook({
        ...this.book,
        restPoints: [
          ...(this.book.restPoints || []).filter((v) => v.id !== r.id),
          r,
        ],
      });
      this.clearResults();
      this.setData({
        status: "已保存本人的休息点核验记录。真实地点需在当前真实报告中查看。",
      });
    });
  },
  deleteRest(e) {
    return this.action(() => {
      const removed = this.book.restPoints?.find(
        (r) => r.id === e.currentTarget.dataset.id,
      );
      if (!removed) return;
      this.saveBook({
        ...this.book,
        restPoints: (this.book.restPoints || []).filter(
          (r) => r.id !== e.currentTarget.dataset.id,
        ),
      });
      this.undoEntry = { key: "restPoints", value: removed };
      this.setData({ hasUndo: true, status: "已移除，可撤销。" });
      this.clearResults();
    });
  },
  category(e) {
    const i = Number(e.detail.value);
    this.setData({
      impactCategoryIndex: i,
      impactCategory: this.data.impactCategories[i].id,
    });
    this.clearResults();
    this.updateBaseline();
  },
  newPlace(e) {
    this.setData({ newIndex: Number(e.detail.value) });
    this.clearResults();
  },
  impact() {
    return this.action(async () => {
      const baseline = this.scene.facilities
          .filter((p) => p.category === this.data.impactCategory)
          .slice(0, 3),
        proposed = this.scene.proposed[this.data.newIndex];
      if (!baseline.length || !proposed)
        throw new Error(
          "请先准备同类现有设施和新增候选位置。真实候选位置从私人地点簿读取。",
        );
      const nodes = [...this.scene.samples, ...baseline, proposed],
        pairs = this.scene.samples.flatMap((s) =>
          [...baseline, proposed].map((t) => [s.id, t.id]),
        );
      const prefs = cleanJourney(this.data.prefs);
      outing.compareAddition(
        { nodes, edges: [], mode: this.scene.mode, generatedAt: "" },
        this.scene.samples.map((p) => p.id),
        baseline.map((p) => p.id),
        proposed.id,
        prefs,
      );
      const r = outing.compareAddition(
        await this.routes(nodes, pairs),
        this.scene.samples.map((p) => p.id),
        baseline.map((p) => p.id),
        proposed.id,
        prefs,
      );
      this.setData(
        {
          impact: {
            ...r,
            averageSavedText: outing.minutesText(r.averageSavedMinutes),
            rows: r.rows.map((v) => ({
              ...v,
              beforeText: outing.minutesText(v.beforeMinutes),
              afterText: outing.minutesText(v.afterMinutes),
            })),
          },
          status: "对比完成，原始体检未改变。",
        },
        () => platform.reveal?.(".outing-result"),
      );
    });
  },
  stash() {
    try {
      platform.set("yike-familiar-draft", {
        id: this.editing,
        name: this.data.routeName,
        checkedOn: this.data.checkedOn,
        steps: this.data.steps,
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  step(e) {
    const i = Number(e.currentTarget.dataset.index),
      key = e.currentTarget.dataset.key;
    this.setData({
      steps: this.data.steps.map((s, j) =>
        i === j ? { ...s, [key]: e.detail.value } : s,
      ),
    });
    this.stash();
  },
  addStep() {
    if (this.data.steps.length < 8) {
      this.setData({ steps: [...this.data.steps, blankStep()] });
      this.stash();
    }
  },
  moveStep(e) {
    const i = Number(e.currentTarget.dataset.index),
      to = i + Number(e.currentTarget.dataset.offset),
      steps = [...this.data.steps];
    if (to < 0 || to >= steps.length) return;
    [steps[i], steps[to]] = [steps[to], steps[i]];
    this.setData({ steps });
    this.stash();
  },
  removeStep(e) {
    this.setData({
      steps: this.data.steps.filter(
        (_, i) => i !== Number(e.currentTarget.dataset.index),
      ),
    });
    this.stash();
  },
  photo(e) {
    return this.action(async () => {
      const i = Number(e.currentTarget.dataset.index),
        photo = await platform.choosePhoto();
      this.setData({
        steps: this.data.steps.map((s, j) => (i === j ? { ...s, photo } : s)),
      });
      this.stash();
    });
  },
  removePhoto(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({
      steps: this.data.steps.map((s, j) => {
        if (i !== j) return s;
        const value = { ...s };
        delete value.photo;
        return value;
      }),
    });
    this.stash();
  },
  saveRoute() {
    return this.action(() => {
      const r = outing.cleanFamiliarRoute({
        id:
          this.editing ||
          `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: this.data.routeName,
        checkedOn: this.data.checkedOn,
        steps: this.data.steps,
      });
      this.saveBook({
        ...this.book,
        familiarRoutes: [
          ...(this.book.familiarRoutes || []).filter((v) => v.id !== r.id),
          r,
        ],
      });
      this.editing = r.id;
      platform.remove("yike-familiar-draft");
      this.showCard(r);
      this.setData({ showRouteEditor: false });
      this.setData({
        status: "熟路卡已保存到本机，可从“我的”同步给已配对设备。",
      });
    });
  },
  showCard(r) {
    this.card = r;
    this.setData(
      {
        card: {
          id: r.id,
          name: r.name,
          checkedOn: r.checkedOn,
          count: r.steps.length,
        },
        cardIndex: 0,
        cardStep: r.steps[0],
      },
      () => platform.reveal?.(".familiar-card"),
    );
  },
  openRoute(e) {
    const r = this.book.familiarRoutes?.find(
      (v) => v.id === e.currentTarget.dataset.id,
    );
    if (r) this.showCard(r);
  },
  closeCard() {
    this.card = null;
    this.setData({ card: null, cardStep: null });
  },
  continueDraft() {
    this.setData({ showRouteEditor: true });
  },
  cardNext(e) {
    const i = this.data.cardIndex + Number(e.currentTarget.dataset.offset);
    if (this.card && i >= 0 && i < this.card.steps.length)
      this.setData({ cardIndex: i, cardStep: this.card.steps[i] });
  },
  copyRoute() {
    return this.action(async () => {
      if (this.card) {
        await platform.clipboard(outing.familiarText(this.card));
        this.setData({ status: "熟路文字已复制，可交给家人或社区人员打印。" });
      }
    });
  },
  editRoute(e) {
    return this.action(async () => {
      if (
        this.hasDraft() &&
        !(await platform.confirm("用这条熟路替换当前编辑草稿？"))
      )
        return;
      const r = this.book.familiarRoutes?.find(
        (v) => v.id === e.currentTarget.dataset.id,
      );
      if (!r) return;
      this.editing = r.id;
      this.setData({
        showRouteEditor: true,
        routeName: r.name,
        checkedOn: r.checkedOn,
        steps: r.steps,
      });
      this.stash();
    });
  },
  newRoute() {
    return this.action(async () => {
      if (
        this.hasDraft() &&
        !(await platform.confirm("清空当前编辑草稿，开始另一条熟路？"))
      )
        return;
      this.editing = null;
      this.setData({
        routeName: "",
        checkedOn: outing.todayLocal(),
        steps: [blankStep(), blankStep()],
      });
      platform.remove("yike-familiar-draft");
    });
  },
  deleteRoute(e) {
    return this.action(() => {
      const id = e.currentTarget.dataset.id;
      const removed = this.book.familiarRoutes?.find((r) => r.id === id);
      if (!removed) return;
      this.saveBook({
        ...this.book,
        familiarRoutes: (this.book.familiarRoutes || []).filter(
          (r) => r.id !== id,
        ),
      });
      this.undoEntry = { key: "familiarRoutes", value: removed };
      if (this.card?.id === id) this.setData({ card: null, cardStep: null });
      this.setData({ hasUndo: true, status: "已移除，可撤销。" });
    });
  },
  hasDraft() {
    return !!(
      this.data.routeName ||
      this.data.steps.some((s) => s.title || s.instruction || s.photo)
    );
  },
  undoRestore() {
    return this.action(() => {
      if (this.undoEntry) {
        const { key, value } = this.undoEntry,
          current = this.book[key] || [];
        if (current.some((r) => r.id === value.id))
          throw new Error("同编号的记录已经存在，请核对后再恢复。");
        this.saveBook({ ...this.book, [key]: [...current, value] });
        this.undoEntry = null;
        this.setData({
          hasUndo: false,
          status: "已恢复移除的记录，其他修改保留。",
        });
      }
    });
  },
});
