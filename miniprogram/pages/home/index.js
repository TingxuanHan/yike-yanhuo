const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const {
  emptyBook,
  cleanBook,
  cleanPlace,
  placeCardText,
  utf8Bytes,
  mergeBooks,
} = require("../../shared/life.js");
const { cleanJourney } = require("../../shared/journey.js");
const experience = require("../../shared/experience.js");
const example = require("../../shared/demo.js");
const config = require("../../config.js");
const blankForm = () => ({
  name: "",
  address: "",
  landmark: "",
  note: "",
  visitedOn: "",
  openingHours: "",
  photo: "",
  favorite: false,
});
Page({
  data: {
    showPrivacy: false,
    privacyError: "",
    tab: "nearby",
    category: "all",
    categories: experience.categories,
    timePresets: [10, 15, 20],
    searchQuery: "",
    favoritesOnly: false,
    placeItems: [],
    showEditor: false,
    editorMore: false,
    hasDraft: false,
    careMode: false,
    simpleMode: true,
    reviewMode: false,
    reviewPanel: "places",
    showReviewTools: false,
    showReminders: false,
    reviewStudy: experience.shanghaiStudy,
    showStudy: false,
    familyPhone: "",
    showAdvanced: false,
    showConnection: false,
    showReportDetails: false,
    showCoverage: false,
    showComparison: false,
    comparisonInput: {
      speedMps: "0.9",
      waiting: "same",
      waitSeconds: "30",
      crossingsPerKm: "2",
    },
    comparison: null,
    comparisonError: "",
    reminders: null,
    coverageCategory: "school",
    coverageCategories: experience.coverageCategories,
    coverageCategoryIndex: 2,
    coverageIndex: 0,
    coveragePoints: [],
    coverageOptions: [],
    coverageSelected: null,
    selectedFacility: null,
    nearby: [],
    minutes: 15,
    calibrationSeconds: "",
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
    form: blankForm(),
    position: null,
    editing: null,
    card: null,
    reports: [],
    sharedCards: [],
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
      server: platform.get("yike-server") || config.apiBaseUrl,
      connected: !!platform.get("yike-token"),
      careMode: !!platform.get("yike-care-mode"),
      simpleMode: platform.get("yike-simple-mode") !== false,
      familyPhone: platform.get("yike-help-phone") || "",
    });
    this.setData({ placeItems: experience.placeList(book.places) });
    const draft = platform.get("yike-place-draft");
    if (draft?.form && typeof draft.form.name === "string")
      this.setData({
        form: { ...blankForm(), ...draft.form },
        position: draft.position || null,
        editing: draft.editing || null,
        hasDraft: true,
      });
    let result = example;
    try {
      const cached = platform.get("yike-last-report");
      if (cached) result = experience.parseResultFile(JSON.stringify(cached));
    } catch {
      this.setData({
        status: "上次结果未能恢复，已打开离线示例。地点簿仍保留。",
      });
    }
    try {
      this.setResult(experience.scenario(result, book.preferences));
    } catch {
      this.setResult(example);
    }
  },
  onReady() {
    this.drawMap();
  },
  onShow() {
    this.refreshReminders();
    try {
      this.setData({
        familyPhone: platform.get("yike-help-phone") || "",
        simpleMode: this.data.reviewMode
          ? false
          : platform.get("yike-simple-mode") !== false,
      });
      const saved = platform.get("yike-life");
      if (saved && !this.data.reviewMode) {
        const book = cleanBook(saved);
        this.setData({ book });
        this.setData({
          placeItems: experience.placeList(
            book.places,
            this.data.searchQuery,
            this.data.favoritesOnly,
          ),
        });
      }
    } catch (e) {
      this.setData({ error: e.message });
    }
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
  onUnload() {
    this.releasePrivacy?.();
    this.alive = false;
    clearTimeout(this.pollTimer);
    if (this.rejectPoll) this.rejectPoll(new Error("页面已关闭"));
    if (this.jobId)
      void api.request(`/api/analyses/${this.jobId}`, "DELETE").catch(() => {});
  },
  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.drawMap();
  },
  simple() {
    return this.action(async () => {
      const value = !this.data.simpleMode;
      platform.set("yike-simple-mode", value);
      this.setData({ simpleMode: value });
      if (!value) this.drawMap();
    });
  },
  openReview() {
    if (this.data.busy || this.data.reviewMode) return;
    this.reviewSnapshot = {
      result: this.data.result,
      simpleMode: this.data.simpleMode,
      tab: this.data.tab,
      category: this.data.category,
      timePresets: this.data.timePresets,
    };
    this.setData({
      reviewMode: true,
      reviewPanel: "places",
      showComparison: false,
      simpleMode: false,
      tab: "nearby",
      timePresets: [5, 10, 15],
      status: "",
    });
    this.drawMap();
  },
  closeReview() {
    if (this.data.busy || !this.reviewSnapshot) return;
    const previous = this.reviewSnapshot;
    this.setData({ category: previous.category });
    this.setResult(previous.result, false);
    this.setData({
      reviewMode: false,
      simpleMode: previous.simpleMode,
      tab: previous.tab,
      timePresets: previous.timePresets,
      showCoverage: false,
      showReportDetails: false,
      showComparison: false,
      status: "已回到原来的日常页面。",
    });
    this.reviewSnapshot = null;
    this.drawMap();
  },
  reviewExample() {
    if (this.data.busy) return;
    this.setResult(example, false);
    this.setData({ status: "当前为构造道路与设施，不是上海社区。" });
  },
  reviewOriginal() {
    if (this.data.busy || !this.reviewSnapshot?.result) return;
    this.setResult(this.reviewSnapshot.result, false);
    this.setData({ status: "已打开进入演示前的报告，原始记录时间保留。" });
  },
  reviewStep(e) {
    const step = e.currentTarget.dataset.step;
    this.setData({
      reviewPanel: step === "coverage" ? "coverage" : "places",
      showCoverage: step === "coverage",
      showComparison: false,
      showReportDetails: step === "report",
    });
    this.updateCoverage();
    wx.pageScrollTo?.({
      selector:
        step === "coverage"
          ? ".coverage-section"
          : step === "report"
            ? ".report-section"
            : ".map-section",
      duration: 0,
    });
  },
  reviewDetail(e) {
    const panel = e.currentTarget.dataset.panel;
    if (!["places", "coverage", "compare"].includes(panel)) return;
    this.setData(
      {
        reviewPanel: panel,
        showCoverage: panel === "coverage",
        showComparison: panel === "compare",
      },
      () => {
        this.updateCoverage();
        this.drawComparison();
      },
    );
  },
  family() {
    wx.navigateTo({ url: "/pages/family/index" });
  },
  familyCall() {
    return this.action(() => platform.callFamily(this.data.familyPhone));
  },
  openOutings() {
    return this.action(() => platform.openOutings());
  },
  openPlanning() {
    return this.action(() => platform.openPlanning());
  },
  openTrip() {
    return this.action(() => platform.openTrip());
  },
  field(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
    if (e.currentTarget.dataset.key.startsWith("form.")) this.stashDraft();
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
    this.setData({
      placeItems: experience.placeList(
        valid.places,
        this.data.searchQuery,
        this.data.favoritesOnly,
      ),
    });
  },
  drawMap() {
    if (this.data.tab === "nearby" && this.data.sketch && !this.data.mapNative)
      platform.drawSketch?.(this.data.sketch, this);
    if (this.data.tab === "nearby") this.drawComparison();
  },
  toggle(e) {
    const key = e.currentTarget.dataset.key;
    if (
      ![
        "showAdvanced",
        "editorMore",
        "showConnection",
        "showReportDetails",
        "showStudy",
        "showReviewTools",
        "showReminders",
      ].includes(key)
    )
      return;
    this.setData({ [key]: !this.data[key] });
  },
  care() {
    return this.action(() => {
      const value = !this.data.careMode;
      platform.set("yike-care-mode", value);
      this.setData({
        careMode: value,
        status: value ? "大字模式已开启。" : "已恢复标准字号。",
      });
    });
  },
  openEditor() {
    this.setData({ showEditor: true, tab: "places", card: null });
  },
  closeEditor() {
    if (this.stashDraft())
      this.setData({
        showEditor: false,
        status: "草稿已留在本机，稍后可继续填写。",
      });
  },
  stashDraft() {
    try {
      platform.set("yike-place-draft", {
        form: this.data.form,
        position: this.data.position,
        editing: this.data.editing,
      });
      this.setData({ hasDraft: true });
      return true;
    } catch (e) {
      this.setData({ error: e.message });
      return false;
    }
  },
  discardDraft() {
    return this.action(async () => {
      if (
        !(await platform.confirm(
          "清除这份尚未保存的草稿？已记住的地点不受影响。",
        ))
      )
        return;
      platform.remove("yike-place-draft");
      this.setData({
        form: blankForm(),
        position: null,
        editing: null,
        hasDraft: false,
        showEditor: false,
      });
    });
  },
  search(e) {
    this.setData({
      searchQuery: e.detail.value,
      placeItems: experience.placeList(
        this.data.book.places,
        e.detail.value,
        this.data.favoritesOnly,
      ),
    });
  },
  favorites() {
    const only = !this.data.favoritesOnly;
    this.setData({
      favoritesOnly: only,
      placeItems: experience.placeList(
        this.data.book.places,
        this.data.searchQuery,
        only,
      ),
    });
  },
  favorite(e) {
    return this.action(() =>
      this.save({
        ...this.data.book,
        places: this.data.book.places.map((p) =>
          p.id === e.currentTarget.dataset.id
            ? { ...p, favorite: !p.favorite }
            : p,
        ),
      }),
    );
  },
  photo() {
    return this.action(async () => {
      const photo = await platform.choosePhoto();
      this.setData({ "form.photo": photo, editorMore: true });
      this.stashDraft();
    });
  },
  removePhoto() {
    this.setData({ "form.photo": "" });
    this.stashDraft();
  },
  filter(e) {
    this.setData({
      category: e.currentTarget.dataset.id,
      selectedFacility: null,
    });
    this.setResult(this.data.result, false, this.data.minutes);
  },
  coverageToggle() {
    this.setData({ showCoverage: !this.data.showCoverage });
    this.updateCoverage();
  },
  comparisonToggle() {
    this.setData({ showComparison: !this.data.showComparison });
    this.drawComparison();
  },
  refreshReminders() {
    if (this.data.result)
      this.setData({
        reminders: experience.reviewReminders(this.data.result.facilities),
      });
  },
  comparisonField(e) {
    const key = e.currentTarget.dataset.key;
    if (!["speedMps", "waitSeconds", "crossingsPerKm"].includes(key)) return;
    this.setData({
      [`comparisonInput.${key}`]: e.detail.value,
      comparison: null,
      comparisonError: "",
    });
  },
  comparisonWaiting(e) {
    this.setData({
      "comparisonInput.waiting": e.detail.value ? "fixed" : "same",
      comparison: null,
      comparisonError: "",
    });
  },
  compareJourney() {
    try {
      const input = this.data.comparisonInput;
      if (
        [input.speedMps, input.waitSeconds, input.crossingsPerKm].some(
          (v) => String(v).trim() === "",
        )
      )
        throw new Error("请完整填写对比条件。");
      const raw = experience.compareJourneys(this.data.result, {
        minutes: this.data.minutes,
        speedMps: Number(input.speedMps),
        waiting: input.waiting,
        waitSeconds: Number(input.waitSeconds),
        crossingsPerKm: Number(input.crossingsPerKm),
      });
      // Keep only display data in setData; full geometry stays in the shared calculation.
      const comparison = {
        counts: raw.counts,
        baselineCount: raw.baseline.count,
        candidateCount: raw.candidate.count,
        baselineArea: raw.baseline.areaKm2.toFixed(2),
        candidateArea: raw.candidate.areaKm2.toFixed(2),
        baselineSpeed: raw.baselinePrefs.speedMps,
        candidateSpeed: raw.candidatePrefs.speedMps,
        clipped: raw.baseline.clipped || raw.candidate.clipped,
        incompleteSearch: raw.incompleteSearch,
        unknownSamples: raw.unknownSamples,
        sketch: raw.sketch,
        legend: raw.layers.map((l) => ({ color: l.color, label: l.label })),
        changes: raw.facilities
          .filter((f) => ["lost", "gained", "unknown"].includes(f.change))
          .map((f) => ({
            id: f.id,
            name: f.name,
            label:
              f.change === "lost"
                ? "超出时长"
                : f.change === "gained"
                  ? "新增可达"
                  : "缺少可用路线",
            before:
              f.beforeSeconds === null
                ? "未知"
                : `${Math.ceil(f.beforeSeconds / 60)}分`,
            after:
              f.afterSeconds === null
                ? "未知"
                : `${Math.ceil(f.afterSeconds / 60)}分`,
          })),
      };
      if (utf8Bytes(JSON.stringify(comparison)) > 900_000)
        throw new Error("对比图过大，请在Web查看。原结果仍保留。");
      this.setData({ comparison, comparisonError: "" }, () => {
        this.drawComparison();
        wx.pageScrollTo?.({ selector: ".comparison-result", duration: 0 });
      });
    } catch (e) {
      this.setData({
        comparison: null,
        comparisonError:
          e.message || "这份报告暂不能对比，请换用完整体检结果。",
      });
    }
  },
  drawComparison() {
    if (
      this.data.tab === "nearby" &&
      !this.data.simpleMode &&
      (!this.data.reviewMode || this.data.reviewPanel === "compare") &&
      this.data.showComparison &&
      this.data.comparison
    )
      platform.drawSketch(
        this.data.comparison.sketch,
        this,
        "comparison-sketch",
      );
  },
  coverageCategoryChange(e) {
    const index = Number(e.detail.value);
    const category = this.data.coverageCategories[index];
    if (!category) return;
    this.setData({
      coverageCategory: category.id,
      coverageCategoryIndex: index,
    });
    this.updateCoverage();
  },
  coveragePointChange(e) {
    const index = Number(e.detail.value);
    const point = this.data.coveragePoints[index];
    if (point) this.setData({ coverageIndex: index, coverageSelected: point });
  },
  updateCoverage() {
    if (!this.data.result || !this.data.showCoverage) return;
    const view = experience.coverageView(
      this.data.result,
      this.data.coverageCategory,
      this.data.minutes,
    );
    const index = Math.max(
      0,
      view.coveragePoints.findIndex((p) => p.status !== "covered"),
    );
    this.setData({
      ...view,
      coverageIndex: index,
      coverageSelected: view.coveragePoints[index] || null,
    });
  },
  selectFacility(e) {
    const id = e.currentTarget.dataset.id;
    this.selectPlace(this.data.nearby.find((p) => p.id === id) || null, true);
  },
  selectPlace(place, reveal = false) {
    this.setData(
      {
        selectedFacility: place,
        noticeContext: place
          ? { target: experience.facilityPlace(this.data.result, place.id) }
          : null,
        mapMarkers: (this.data.mapMarkers || []).map((marker) => ({
          ...marker,
          callout: {
            ...marker.callout,
            display:
              marker.id === 0 || marker.id === place?.markerId
                ? "ALWAYS"
                : "BYCLICK",
          },
        })),
      },
      () => {
        if (reveal) platform.revealSelected?.();
      },
    );
  },
  marker(e) {
    this.selectPlace(
      this.data.nearby.find((p) => p.markerId === Number(e.detail.markerId)) ||
        null,
    );
  },
  rememberFacility() {
    return this.action(async () => {
      if (!this.data.selectedFacility) return;
      if (
        this.data.hasDraft &&
        !(await platform.confirm(
          "已有一份未完成的地点草稿，改为记录当前选中的地点？",
        ))
      )
        return;
      const p = experience.facilityPlace(
        this.data.result,
        this.data.selectedFacility.id,
      );
      this.setData({
        form: { ...blankForm(), ...p },
        position: p.position,
        editing: null,
        showEditor: true,
        editorMore: false,
        tab: "places",
      });
      this.stashDraft();
    });
  },
  directions() {
    return this.action(async () => {
      const p =
        this.data.card ||
        (this.data.selectedFacility &&
          experience.facilityPlace(
            this.data.result,
            this.data.selectedFacility.id,
          ));
      if (!p) return;
      const geo = experience.mapPosition(p.position);
      if (!geo)
        throw new Error(
          p.position.system === "demo"
            ? "这是模拟地点，不能用于真实导航。"
            : "此坐标类型暂不能直接打开，请复制地址在地图中查找。",
        );
      await platform.openLocation({ ...geo, name: p.name, address: p.address });
    });
  },
  copyCard() {
    return this.action(() => platform.clipboard(placeCardText(this.data.card)));
  },
  prepareShare() {
    return this.action(async () => {
      if (!this.data.card) return;
      if (
        !(await platform.confirm(
          "生成后，持有链接的人可在7天内查看这个地点的名称、地址、照片和提醒，也可转发。卡片只读，不会分享整个地点簿。继续？",
        ))
      )
        return;
      await this.ensureServer();
      const value = await api.request("/api/life/cards", "POST", {
        place: this.data.card,
      });
      await platform.openCard(value.token, this.data.server);
    });
  },
  loadCards() {
    return this.action(async () =>
      this.setData({ sharedCards: await api.request("/api/life/cards") }),
    );
  },
  revokeCard(e) {
    return this.action(async () => {
      if (
        !(await platform.confirm(
          "撤销后，这张分享卡的已有链接将失效。已保存的文字或截图无法收回。",
        ))
      )
        return;
      await api.request(
        `/api/life/cards/${encodeURIComponent(e.currentTarget.dataset.id)}`,
        "DELETE",
      );
      this.setData({
        sharedCards: await api.request("/api/life/cards"),
        status: "分享卡已撤销。",
      });
    });
  },
  chooseStart() {
    return this.action(async () => {
      await this.ensureServer();
      const place = await platform.choosePlace();
      await this.analyzePosition(place.position, place.name || "出发点");
    });
  },
  async analyzePosition(position, name) {
    await this.ensureServer();
    if (
      !(await platform.confirm(
        "将为这个起点查询步行范围，使用受每日预算保护的百度接口额度。继续计算？",
      ))
    )
      return;
    const geo =
      position.system === "bd09"
        ? { lng: position.lng, lat: position.lat }
        : (
            await api.request("/api/convert", "POST", {
              geo: { lng: position.lng, lat: position.lat },
              from: position.system === "gcj02" ? 3 : 1,
            })
          ).geo;
    this.setData({ analyzing: true });
    try {
      const job = await api.request("/api/analyses", "POST", {
        mode: "baidu",
        label: name,
        geo,
      });
      const result = await this.poll(job.id);
      this.setResult(experience.scenario(result, this.data.book.preferences));
      this.setData({ status: "步行范围已更新，可保存为家庭共享报告。" });
    } finally {
      this.setData({ analyzing: false });
    }
  },
  quickTime(e) {
    if (this.data.reviewMode) {
      const minutes = Number(e.currentTarget.dataset.minutes);
      if (this.data.result?.contours.some((c) => c.minutes === minutes))
        this.setResult(this.data.result, false, minutes);
      else
        this.setData({
          status: "这份报告没有该时长的轮廓，请体验模拟社区查看5、10、15分钟。",
        });
      return;
    }
    this.setData({
      "book.preferences.minutes": Number(e.currentTarget.dataset.minutes),
    });
    return this.scenario();
  },
  calibrate() {
    return this.action(() => {
      const seconds = Number(this.data.calibrationSeconds);
      if (!Number.isFinite(seconds) || seconds < 50 || seconds > 333)
        throw new Error(
          "请填写平地走100米的实际用时，支持50—333秒；不含等灯和休息。",
        );
      this.setData({
        "book.preferences.speedMps": Math.round(10000 / seconds) / 100,
      });
      this.save(this.data.book);
      this.setData({
        status: "已按100米实走用时保存步速，可回到附近重新试算。",
      });
    });
  },
  choose() {
    return this.action(async () => {
      const p = await platform.choosePlace();
      this.setData({
        position: p.position,
        "form.name": p.name,
        "form.address": p.address,
      });
      this.stashDraft();
    });
  },
  remember() {
    return this.action(() => {
      if (!this.data.form.name.trim())
        throw new Error("先给这个地方起个名字。");
      if (!this.data.position) {
        if (this.stashDraft())
          this.setData({
            status:
              "已保存地址草稿。补充入口位置后，就能记入地点簿和分享给家人。",
          });
        return;
      }
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
        form: blankForm(),
        hasDraft: false,
        showEditor: false,
        status: "地点已记在本机，可在连接页手动同步。",
      });
      platform.remove("yike-place-draft");
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
    return this.action(async () => {
      const p = this.data.book.places.find(
        (p) => p.id === e.currentTarget.dataset.id,
      );
      if (!p) throw new Error("地点已不存在，请重新选择。");
      if (
        this.data.hasDraft &&
        !(await platform.confirm(
          "改为编辑这个地点？当前尚未保存的草稿将被替换。",
        ))
      )
        return;
      this.setData({
        form: {
          ...blankForm(),
          ...p,
          name: p.name,
          address: p.address,
          landmark: p.landmark,
          note: p.note,
          visitedOn: p.visitedOn,
        },
        position: p.position,
        editing: p.id,
        showEditor: true,
        editorMore: true,
        tab: "places",
        card: null,
      });
      this.stashDraft();
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
        book = mergeBooks(this.data.book, s.book);
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
    if (!api.validServer(server)) {
      this.setData({ showConnection: true });
      throw new Error(
        "云端服务尚未连接。先使用离线示例和地点簿，或到“我的 → 连接设置”填写已部署的服务地址。",
      );
    }
    if (platform.get("yike-server") !== server) {
      platform.remove("yike-token");
      this.setData({
        connected: false,
        revision: null,
        incoming: null,
        pairCode: "",
        reports: [],
        sharedCards: [],
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
  setResult(result, cache = true, minutes) {
    if (!result) return;
    const view = experience.reportView(result, this.data.category, minutes);
    if (utf8Bytes(JSON.stringify({ result, ...view })) > 900_000)
      throw new Error(
        "这份报告较大，请在Web打开，或选择范围较小的报告。原结果仍保留。",
      );
    this.setData(
      {
        result,
        ...view,
        tab: "nearby",
        selectedFacility: null,
        comparison: null,
        comparisonError: "",
        comparisonInput: {
          ...experience.comparisonDefaults(result, view.minutes),
          speedMps: String(
            experience.comparisonDefaults(result, view.minutes).speedMps,
          ),
          waitSeconds: "30",
          crossingsPerKm: "2",
        },
      },
      () => {
        this.drawMap();
        this.updateCoverage();
        this.refreshReminders();
      },
    );
    if (cache && !this.data.reviewMode) {
      try {
        platform.set("yike-last-report", result);
      } catch {
        this.setData({
          status: "结果已显示，但本机空间不足，未能保存离线副本。",
        });
      }
    }
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
      this.setResult(experience.scenario(example, this.data.book.preferences));
      this.setData({
        status: "已打开离线示例，可调整时间和步速；示例不代表真实社区。",
      });
    });
  },
  analyzePlace(e) {
    return this.action(async () => {
      const p = this.data.book.places.find(
        (p) => p.id === e.currentTarget.dataset.id,
      );
      if (!p) throw new Error("地点已不存在，请重新选择。");
      if (p.position.system === "demo") {
        this.setResult(
          experience.scenario(example, this.data.book.preferences),
        );
        this.setData({ status: "已打开示例街区的生活圈。" });
        return;
      } else {
        await this.analyzePosition(p.position, p.name);
      }
    });
  },
  scenario() {
    return this.action(async () => {
      if (!this.data.result)
        throw new Error("请先打开共享报告或完成一次体检。");
      this.save(this.data.book);
      this.setResult(
        experience.scenario(this.data.result, this.data.book.preferences),
      );
      this.setData({ status: "已按你的时间和步速更新，使用已有路线数据。" });
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
