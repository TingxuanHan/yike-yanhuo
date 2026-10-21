import { cleanBook, type LifeBook } from "../shared/life.js";
import {
  cleanPlanning,
  emptyPlanning,
  planningTasks,
  type PlanningDraft,
} from "../shared/planning.js";
import { planningDiff } from "../shared/planning-edit.js";
import {
  cleanRoutine,
  routineFrom,
  prepareDeparture,
  cleanDeparture,
  departureBasis,
  departureAge,
  tripWalkingLegs,
  DEPARTURE_KEY,
  type TripRoutine,
  type DeparturePack,
} from "../shared/departure.js";
import { allPairs, todayLocal, type RouteBundle } from "../shared/outings.js";
import {
  cleanShopping,
  defaultShopping,
  type ShoppingBook,
} from "../shared/shopping.js";
import { defaultMovement } from "../shared/movement.js";
import {
  cleanActiveTrip,
  cleanTripFeedback,
  feedbackPace,
  remainingTrip,
  solveTrip,
  startTrip,
  stepTrip,
  type ActiveTrip,
  type TripFeedback,
  type TripInput,
  type TripPlan,
  type TripStop,
  type TripEvent,
} from "../shared/trip.js";
import { demoScene, sceneFromReport, OutingRouteCache } from "./outings.js";
import { demoShopping } from "./shopping.js";
import { WalkingGuideSession, type GuideView } from "./walking-guide.js";
import type { AnalysisResult } from "../shared/types.js";
import { planningFields } from "./planning.js";
import { AssistanceSession, type AssistState } from "./assistance.js";
import {
  tripLocation,
  latestLocation,
  LOCATION_KEY,
} from "../shared/family.js";
import {
  cleanEntrance,
  type EntranceGuide,
  type AssistProposal,
  type AssistSnapshot,
} from "../shared/assistance.js";
import {
  adjustTrip,
  tripBasis,
  type TripAdjustment,
} from "../shared/trip-adjust.js";
import {
  cleanMobility,
  MOBILITY_OPTIONS,
  type MobilityNeeds,
} from "../shared/mobility.js";
import {
  alternativeInput,
  replaceNextStop,
  type AlternativeKind,
} from "../shared/trip-alternative.js";
export { MOBILITY_OPTIONS };
export { planningFields, planningTasks };
export * from "../shared/trip.js";
interface Deps {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  save: (book: LifeBook) => void;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  confirm: (message: string) => Promise<boolean>;
  notify: (view: TripView) => void;
  now?: () => number;
}
export interface TripView {
  text: string;
  mode: "free" | "own";
  form: Record<string, string>;
  tasks: string[];
  items: string;
  returnEasy: boolean;
  returnInherited: boolean;
  candidates: (TripStop & { checked: boolean; difficult: boolean })[];
  origin: string;
  demo: boolean;
  pending: PlanningDraft | null;
  changes: string[];
  busy: boolean;
  error: string;
  status: string;
  plans: TripPlan[];
  active: ActiveTrip | null;
  remaining: ReturnType<typeof remainingTrip> | null;
  next: string;
  here: string;
  feedback: {
    walking: string;
    spent: string;
    note: string;
    difficult: string[];
  };
  recent: TripFeedback[];
  pace: number | null;
  shoppingSummary: string;
  movementSummary: string;
  assistance: AssistState;
  helpRequest: string;
  adjust: { remaining: string[]; speed: string } | null;
  adjustPreview: string[];
  entrance: EntranceGuide | null;
  entrances: EntranceGuide[];
  routines: TripRoutine[];
  routineDraft: TripRoutine | null;
  routineSuggestion: TripRoutine | null;
  pack: DeparturePack | null;
  packAge: string;
  packOutdated: boolean;
  guide: GuideView;
  mobility: MobilityNeeds;
  alternative: {
    kind: AlternativeKind;
    candidates: TripStop[];
    selected: string;
    changes: string[];
    note: string;
  } | null;
}
export class TripSession {
  state: TripView;
  assistance: AssistanceSession;
  walking: WalkingGuideSession;
  private book: LifeBook;
  private scene: ReturnType<typeof demoScene>;
  private shopping: ShoppingBook;
  private cache: OutingRouteCache;
  private input: TripInput | null = null;
  private packInvalidated = false;
  private alive = true;
  private generation = 0;
  private now: () => number;
  private alternativePreview: {
    candidate: TripStop;
    kind: AlternativeKind;
    routes: RouteBundle;
    basis: string;
    at: number;
  } | null = null;
  constructor(
    book: LifeBook,
    report: AnalysisResult | null,
    private deps: Deps,
    seed?: PlanningDraft,
  ) {
    this.book = cleanBook(book);
    this.now = deps.now ?? Date.now;
    this.walking = new WalkingGuideSession({
      ...deps,
      now: this.now,
      notify: (guide) => {
        this.state.guide = guide;
        this.emit();
      },
    });
    this.scene =
      report?.mode === "baidu"
        ? sceneFromReport(report, this.book)
        : demoScene();
    const demo = this.scene.mode === "demo",
      sample = demoShopping();
    this.shopping = cleanShopping(
      demo
        ? {
            ...(book.shopping ?? defaultShopping()),
            items: book.shopping?.items ?? sample.items,
            prices: [
              ...sample.prices,
              ...(book.shopping?.prices ?? []).filter(
                (q) => q.store.position.system === "demo",
              ),
            ],
          }
        : (book.shopping ?? defaultShopping()),
    );
    const stores = demo
      ? sample.stores
      : this.shopping.prices
          .map((q) => q.store)
          .filter((n) => n.position.system !== "demo");
    const candidates: TripView["candidates"] = [];
    for (const n of [...this.scene.facilities, ...stores]) {
      if (
        n.id === this.scene.origin.id ||
        candidates.some((s) => s.id === n.id)
      )
        continue;
      const category = "category" in n ? String(n.category) : "personal";
      candidates.push({
        ...n,
        category,
        stay:
          category === "park"
            ? 5
            : category === "pharmacy"
              ? 3
              : this.shopping.options.stay,
        checked: false,
        difficult:
          !demo &&
          (book.trips ?? [])
            .filter((t) => t.mode === "baidu")
            .slice(0, 5)
            .some((t) => t.difficult.includes(n.id)),
      });
    }
    this.state = {
      text: "",
      mode: "free",
      form: {},
      tasks: ["market", "pharmacy"],
      items: this.shopping.items.map((i) => i.name).join("、"),
      returnEasy: true,
      returnInherited: false,
      candidates: candidates.slice(0, 30),
      origin: this.scene.origin.name,
      demo,
      pending: null,
      changes: [],
      busy: false,
      error: "",
      status: "",
      plans: [],
      active: null,
      remaining: null,
      next: "",
      here: "",
      feedback: { walking: "", spent: "", note: "", difficult: [] },
      recent: book.trips ?? [],
      pace: null,
      shoppingSummary: "",
      movementSummary: "",
      assistance: {
        view: null,
        invite: "",
        busy: false,
        error: "",
        status: "",
      },
      helpRequest: "找不到入口，想请家人帮忙看看。",
      adjust: null,
      adjustPreview: [],
      entrance: null,
      entrances: book.entrances ?? [],
      routines: book.routines ?? [],
      routineDraft: null,
      routineSuggestion: null,
      pack: null,
      packAge: "",
      packOutdated: false,
      guide: this.walking.state,
      mobility: cleanMobility(this.book.mobility),
      alternative: null,
    };
    this.cache = new OutingRouteCache(deps.get("yike-outing-routes"));
    try {
      const saved = deps.get("yike-trip-draft") as {
        draft: PlanningDraft;
        text: string;
        selectedIds?: string[];
        sceneKey?: string;
      } | null;
      const d = cleanPlanning(
        seed ??
          saved?.draft ?? {
            ...emptyPlanning(),
            tripMinutes: 45,
            shoppingBudget: 50,
            departure: book.preferences.departure,
            speedMps: book.preferences.speedMps,
            walkingMinutes: 20,
            returnEasy: true,
            tasks: ["market", "pharmacy"],
            items: this.shopping.items.map((i) => i.name),
          },
      );
      this.fill(d);
      if (typeof saved?.text === "string")
        this.state.text = saved.text.slice(0, 600);
      const priorities = [
        ...d.tasks.map((t) =>
          this.state.candidates.find((n) => n.category === t),
        ),
        ...stores.map((s) => this.state.candidates.find((n) => n.id === s.id)),
        this.state.candidates.find((n) => n.category === "park"),
      ].filter((n): n is TripView["candidates"][number] => !!n);
      const chosen = [...new Set(priorities.map((n) => n.id))].slice(0, 5);
      const selected =
        !seed &&
        saved?.sceneKey === JSON.stringify(this.scene.origin) &&
        Array.isArray(saved.selectedIds) &&
        saved.selectedIds.length <= 5
          ? saved.selectedIds
          : chosen;
      this.state.candidates.forEach(
        (n) => (n.checked = selected.includes(n.id)),
      );
      const raw = deps.get("yike-active-trip");
      if (raw && JSON.stringify(raw).length < 300_000)
        this.state.active = cleanActiveTrip(raw);
      const pack = deps.get(DEPARTURE_KEY);
      if (pack) this.state.pack = cleanDeparture(pack);
      const suggestion = deps.get("yike-last-routine");
      if (suggestion) this.state.routineSuggestion = cleanRoutine(suggestion);
    } catch (e) {
      this.state.error = (e as Error).message;
    }
    this.assistance = new AssistanceSession({
      ...deps,
      active: () => this.state.active,
      notify: (state) => {
        this.state.assistance = state;
        this.emit();
      },
      apply: (p, s) => this.applyHelp(p, s),
    });
    this.summaries();
    this.refreshProgress();
  }
  private fill(d: PlanningDraft) {
    this.state.form = Object.fromEntries(
      planningFields.map((f) => [
        f.key,
        d[f.key] === null ? "" : String(d[f.key]),
      ]),
    );
    this.state.tasks = [...d.tasks];
    this.state.items = d.items.join("、");
    this.state.returnInherited = d.returnEasy === null;
    this.state.returnEasy =
      d.returnEasy ??
      this.book.movement?.returnEasy ??
      defaultMovement().returnEasy;
  }
  draft() {
    return cleanPlanning({
      ...Object.fromEntries(
        planningFields.map((f) => [
          f.key,
          this.state.form[f.key]?.trim()
            ? f.key === "departure"
              ? this.state.form[f.key]
              : Number(this.state.form[f.key])
            : null,
        ]),
      ),
      tasks: this.state.tasks,
      items: this.state.items
        .split(/[、,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      returnEasy: this.state.returnInherited ? null : this.state.returnEasy,
    });
  }
  emit() {
    const p = this.state.pack,
      a = this.state.active;
    this.state.packAge = p ? departureAge(p, this.now()) : "";
    this.state.packOutdated = !!(
      p &&
      (a
        ? p.basis !== departureBasis(a.input, a.plan, a)
        : this.packInvalidated ||
          (this.input &&
            this.state.plans.every(
              (plan) => p.basis !== departureBasis(this.input!, plan),
            )))
    );
    if (this.alive)
      this.deps.notify({
        ...this.state,
        form: { ...this.state.form },
        candidates: this.state.candidates.map((n) => ({ ...n })),
      });
  }
  close() {
    this.walking.close();
    this.assistance?.close();
    this.alive = false;
    this.generation++;
  }
  reopen() {
    this.alive = true;
    this.assistance?.reopen();
    this.refreshProgress();
    this.emit();
  }
  message(text: string) {
    this.state.error = text;
    this.emit();
  }
  private summaries() {
    this.state.shoppingSummary =
      this.shopping.items
        .map((i) => `${i.name} ${i.spec} ×${i.quantity}${i.unit}`)
        .join("；") || "尚无规格记录，可先安排办事。";
    const m =
      this.book.movement ?? defaultMovement(this.book.preferences.speedMps);
    this.state.movementSummary =
      m.mode === "alternating"
        ? `沿用交替步行：舒适${m.easyMps}、稍快${m.briskMps}米/秒；返程按下方选择。`
        : `按舒适步速安排，沿用已保存的连续步行限制${m.continuousMinutes || "（未设置）"}分钟。`;
  }
  set(key: string, value: string) {
    if (this.state.busy) return;
    if (key === "text") {
      this.state.text = value.slice(0, 600);
      this.saveValidDraft();
      this.emit();
      return;
    }
    if (this.state.active)
      return this.message("请先完成或结束当前行程，再修改出门条件。");
    if (key in this.state.form) this.state.form[key] = value.slice(0, 10);
    else if (key === "items") this.state.items = value.slice(0, 150);
    else if (key === "mode" && ["free", "own"].includes(value))
      this.state.mode = value as "free" | "own";
    this.invalidate();
  }
  private invalidate() {
    this.walking.close();
    this.packInvalidated = !!this.state.pack;
    this.state.plans = [];
    this.input = null;
    this.state.pending = null;
    this.state.changes = [];
    this.state.error = "";
    this.state.status = "";
    this.saveValidDraft();
    this.emit();
  }
  task(id: string) {
    if (
      this.state.busy ||
      this.state.active ||
      !planningTasks.some((t) => t.id === id)
    )
      return;
    const t = this.state.tasks;
    this.state.tasks = t.includes(id)
      ? t.filter((v) => v !== id)
      : t.length < 3
        ? [...t, id]
        : t;
    this.invalidate();
  }
  toggleReturn() {
    if (this.state.busy || this.state.active) return;
    this.state.returnEasy = !this.state.returnEasy;
    this.state.returnInherited = false;
    this.invalidate();
  }
  candidate(id: string) {
    if (this.state.busy || this.state.active) return;
    const n = this.state.candidates.find((n) => n.id === id);
    if (!n) return;
    if (
      !n.checked &&
      this.state.candidates.filter((n) => n.checked).length >= 5
    )
      return this.message("最多比较五个地点，先取消一个再选择。");
    n.checked = !n.checked;
    this.invalidate();
  }
  async edit() {
    if (this.state.busy || this.state.active) return;
    if (!this.state.text.trim())
      return this.message("写下想改变的条件，例如预算改成30元、药先不取了。");
    await this.action(async () => {
      const current = this.draft(),
        generation = this.generation;
      const r = await this.deps.request<{ draft: PlanningDraft }>(
        "/api/ai/parse",
        "POST",
        {
          text: this.state.text,
          current,
          mode: this.state.mode,
          requestId: `trip-edit-${this.now()}-${Math.random().toString(36).slice(2, 9)}`,
        },
      );
      if (!this.alive || generation !== this.generation) return;
      this.state.pending = cleanPlanning(r.draft);
      this.state.changes = planningDiff(current, this.state.pending);
      this.state.status = this.state.changes.length
        ? "以下修改尚未应用。未提到的条件保留，确认后才重新计算。"
        : "没有识别到明确修改。可补充金额、时间，或直接改表单。";
    });
  }
  accept() {
    if (!this.state.pending || this.state.busy) return;
    const d = this.state.pending;
    this.fill(d);
    this.invalidate();
    this.state.status = "已应用修改，原计算结果已清除。请核算新的整趟行程。";
    this.persistDraft();
    this.emit();
  }
  reject() {
    this.state.pending = null;
    this.state.changes = [];
    this.state.status = "保留原条件和原方案。";
    this.emit();
  }
  private persistDraft() {
    this.deps.set("yike-trip-draft", {
      draft: this.draft(),
      text: this.state.text,
      selectedIds: this.state.candidates
        .filter((n) => n.checked)
        .map((n) => n.id),
      sceneKey: JSON.stringify(this.scene.origin),
    });
  }
  private saveValidDraft() {
    // Partial numeric input remains editable; only a complete valid draft replaces storage.
    try {
      this.persistDraft();
    } catch {
      /* Validate visibly on calculate or edit. */
    }
  }
  async calculate() {
    if (this.state.busy || this.state.active) return;
    await this.action(async () => {
      const d = this.draft();
      if (d.walkingMinutes && d.tripMinutes && d.walkingMinutes > d.tripMinutes)
        throw new Error("步行目标不能超过整趟时间。");
      if (!d.tasks.length && !d.items.length && !d.walkingMinutes)
        throw new Error("请选择要办的事、商品或步行目标。");
      const unresolved = d.items.filter(
        (n) => !this.shopping.items.some((i) => i.name === n),
      );
      if (unresolved.length)
        throw new Error(
          `请先在“购物清单”补全${unresolved.join("、")}的规格、数量，再返回本页；不会替你猜商品。`,
        );
      const shopping = cleanShopping({
        ...this.shopping,
        items: this.shopping.items.filter((i) => d.items.includes(i.name)),
      });
      const stops = this.state.candidates.filter((n) => n.checked),
        nodes = [this.scene.origin, ...stops];
      if (!stops.length) throw new Error("请至少选择一个候选地点。");
      const pairs = allPairs(nodes),
        pending = this.cache.pending(nodes, pairs).length;
      if (
        !this.state.demo &&
        pending &&
        !(await this.deps.confirm(
          `需要串行读取${pending}段百度步行路线，受原有配额保护。继续？`,
        ))
      )
        return;
      this.persistDraft();
      const generation = this.generation;
      const bundle = await this.cache.obtain(
        nodes,
        pairs,
        (b) => this.deps.request<RouteBundle>("/api/outings/routes", "POST", b),
        (n, total) => {
          this.state.status = `核算道路 ${n}/${total}`;
          this.emit();
        },
        () => !this.alive || generation !== this.generation,
      );
      this.deps.set("yike-outing-routes", this.cache.snapshot());
      if (!this.alive) return;
      const input = {
        origin: this.scene.origin,
        stops,
        bundle,
        draft: d,
        shopping,
        preferences: this.book.preferences,
        movement:
          this.book.movement ?? defaultMovement(this.book.preferences.speedMps),
      };
      const solved = solveTrip(input);
      this.input = input;
      this.state.plans = solved.plans;
      this.state.status = solved.note;
    });
  }
  async useRoutine(id: string) {
    if (this.state.busy || this.state.active) return;
    const r = this.state.routines.find((r) => r.id === id);
    if (!r) return;
    if (
      JSON.stringify(r.origin.position) !==
      JSON.stringify(this.scene.origin.position)
    )
      return this.message(
        "这份方案的出发点与当前社区不同，请先打开对应地点的报告。模拟方案不能用于真实出行。",
      );
    const now = new Date(this.now());
    this.fill({
      ...r.draft,
      departure: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      speedMps: this.book.preferences.speedMps,
    });
    const matches = r.stops.filter((n) =>
      this.state.candidates.some(
        (c) =>
          c.id === n.id &&
          JSON.stringify(c.position) === JSON.stringify(n.position),
      ),
    );
    this.state.candidates.forEach(
      (c) => (c.checked = matches.some((n) => n.id === c.id)),
    );
    this.invalidate();
    const missing = r.stops.filter((n) => !matches.some((m) => m.id === n.id));
    if (missing.length)
      return this.message(
        `已带入条件，但${missing.map((n) => n.name).join("、")}不在当前地点记录中。请展开更多条件重新选择；尚未核算，也未替换成其他地点。`,
      );
    await this.calculate();
    if (!this.state.error && this.state.plans.length) {
      this.state.status = `已按当前时间${this.state.form.departure}和当前步速重新核算“${r.name}”。营业、库存与价格仍需确认。`;
      this.emit();
    }
  }
  offerRoutine(id?: string) {
    try {
      if (this.state.busy) return;
      const a = this.state.active;
      if (a?.replacements?.length)
        throw new Error(
          "这趟已经换过地点，请结束后重新核算，再保存新的常用方案。",
        );
      const plan = id ? this.state.plans.find((p) => p.id === id) : null;
      this.state.routineDraft = a
        ? routineFrom(a.input, a.plan, this.now())
        : plan && this.input
          ? routineFrom(this.input, plan, this.now())
          : this.state.routineSuggestion
            ? cleanRoutine(this.state.routineSuggestion)
            : null;
      this.state.error = "";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  routineName(name: string) {
    if (this.state.routineDraft)
      this.state.routineDraft = {
        ...this.state.routineDraft,
        name: name.slice(0, 40),
      };
    this.emit();
  }
  cancelRoutine() {
    this.state.routineDraft = null;
    this.emit();
  }
  saveRoutine() {
    try {
      if (!this.state.routineDraft) return;
      const r = cleanRoutine(this.state.routineDraft);
      const next = cleanBook({
        ...this.book,
        routines: [
          r,
          ...(this.book.routines ?? []).filter((x) => x.id !== r.id),
        ],
      });
      this.deps.save(next);
      this.book = next;
      this.state.routines = next.routines!;
      this.state.routineDraft = null;
      this.state.error = "";
      this.state.status =
        "已保存常用方案，可随私人地点簿同步。下次使用会重新核算。";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  async removeRoutine(id: string) {
    if (
      this.state.busy ||
      !(await this.deps.confirm("移除这份常用方案？已保存的行程和地点仍保留。"))
    )
      return;
    try {
      const next = cleanBook({
        ...this.book,
        routines: (this.book.routines ?? []).filter((r) => r.id !== id),
      });
      this.deps.save(next);
      this.book = next;
      this.state.routines = next.routines ?? [];
      this.state.status = "已移除常用方案。";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  openGuide(id?: string) {
    try {
      const a = this.state.active,
        input = a?.input ?? this.input;
      const plan = id ? this.state.plans.find((p) => p.id === id) : a?.plan;
      if (!input || !plan || this.state.busy) return;
      const legs = tripWalkingLegs(input, plan, a ?? undefined);
      if (!legs.length) return this.message("当前没有需要查看的步行路段。");
      this.walking.show(legs);
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  prepare(id?: string) {
    try {
      const a = this.state.active,
        plan = id ? this.state.plans.find((p) => p.id === id) : a?.plan;
      const input = a?.input ?? this.input;
      if (!input || !plan || this.state.busy) return;
      const pack = prepareDeparture(
        input,
        plan,
        this.book,
        String(this.deps.get("yike-help-phone") || ""),
        this.now(),
        a ?? undefined,
        this.walking.saved(tripWalkingLegs(input, plan, a ?? undefined)),
      );
      this.deps.set(DEPARTURE_KEY, pack);
      const stored = cleanDeparture(this.deps.get(DEPARTURE_KEY));
      if (JSON.stringify(stored) !== JSON.stringify(pack))
        throw new Error("未能确认出门卡保存成功，请清理本机空间后重试。");
      this.state.pack = stored;
      this.packInvalidated = false;
      this.state.error = "";
      this.state.status =
        "出门卡已保存在本机，未发送给家人。请核对下方待确认项。";
      this.emit();
    } catch (e) {
      this.message(`保存未完成，原出门卡仍可查看。${(e as Error).message}`);
    }
  }
  async removePack() {
    if (
      !(await this.deps.confirm("移除本机出门卡？已下载的离线文件需另行删除。"))
    )
      return;
    try {
      this.deps.set(DEPARTURE_KEY, null);
      this.state.pack = null;
      this.state.status = "本机出门卡已移除。";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  private async action(fn: () => Promise<void>) {
    this.state.busy = true;
    this.state.error = "";
    this.emit();
    try {
      await fn();
    } catch (e) {
      this.state.error = (e as Error).message;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  async start(id: string) {
    if (this.state.busy || this.state.active) return;
    const input = this.input,
      plan = this.state.plans.find((p) => p.id === id);
    if (!input || !plan) return;
    if (
      !(await this.deps.confirm(
        `${this.state.demo ? "这是模拟行程，仅演示操作。" : ""}开始记录这趟出门？位置依靠你手动确认，不跟踪定位，也不提供逐路口导航。`,
      ))
    )
      return;
    try {
      this.storeActive(startTrip(input, plan, this.now()));
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  private storeActive(a: ActiveTrip | null) {
    this.walking.close();
    this.deps.set("yike-active-trip", a);
    this.state.active = a;
    const location = tripLocation(a, this.now());
    if (location) {
      try {
        this.deps.set(
          LOCATION_KEY,
          latestLocation([this.deps.get(LOCATION_KEY), location], this.now()),
        );
      } catch {
        this.state.status = "行程已保存，但最近地点未能保存到本机。";
      }
    }
    this.state.adjust = null;
    this.state.adjustPreview = [];
    this.state.alternative = null;
    this.alternativePreview = null;
    this.refreshProgress();
    this.emit();
  }
  refreshProgress() {
    const a = this.state.active;
    this.state.remaining = a ? remainingTrip(a, this.now()) : null;
    const name = (id: string) =>
      id === a?.input.origin.id
        ? `出发点·${a.input.origin.name}`
        : (a?.input.stops.find((n) => n.id === id)?.name ?? "");
    this.state.next = a?.remaining.length
      ? name(a.remaining[0])
      : "已回到出发点";
    this.state.here = a ? name(a.currentId) : "";
    this.emit();
  }
  async step(kind: Exclude<TripEvent["kind"], "start" | "replan">) {
    if (!this.state.active || this.state.busy) return;
    if (
      ["skip", "return", "rest"].includes(kind) &&
      !(await this.deps.confirm(
        kind === "rest"
          ? "已在当前位置找到安全可停留的地方？只记录歇脚，不代表该地点已核验无障碍。"
          : "更新剩余行程？会保留已确认到达的记录。",
      ))
    )
      return;
    try {
      this.storeActive(stepTrip(this.state.active, kind, this.now()));
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  feedbackField(key: string, value: string) {
    if (["walking", "spent", "note"].includes(key))
      this.state.feedback[key as "walking" | "spent" | "note"] = value.slice(
        0,
        key === "note" ? 300 : 12,
      );
    this.emit();
  }
  difficult(id: string) {
    const f = this.state.feedback;
    if (this.state.active?.completed.includes(id))
      f.difficult = f.difficult.includes(id)
        ? f.difficult.filter((x) => x !== id)
        : [...f.difficult, id];
    this.emit();
  }
  async finish() {
    const a = this.state.active;
    if (!a || this.state.busy) return;
    await this.action(async () => {
      if (
        a.phase !== "finished" &&
        !(await this.deps.confirm(
          "结束记录？只保存已经手动确认到达的部分，不会算作已完成整趟。",
        ))
      )
        return;
      let at = a.input.origin.id,
        meters = 0;
      for (const e of a.events.filter((e) => e.kind === "arrive")) {
        const t = a.input.bundle.edges.find(
          (r) => r.from === at && r.to === e.placeId,
        )?.travel;
        if (t?.status === "ok") meters += t.meters;
        at = e.placeId;
      }
      const f = this.state.feedback,
        record = cleanTripFeedback({
          id: a.id,
          date: todayLocal(),
          mode: a.input.bundle.mode,
          origin: a.input.origin.name,
          completed: a.completed,
          difficult: f.difficult,
          totalMinutes: Math.max(
            0.01,
            ((a.phase === "finished" ? a.lastAt : this.now()) - a.startedAt) /
              60000,
          ),
          walkingMinutes: f.walking.trim() ? Number(f.walking) : null,
          meters,
          spent: f.spent.trim() ? Number(f.spent) : null,
          note: f.note,
        });
      const next = cleanBook({
        ...this.book,
        trips: [
          record,
          ...(this.book.trips ?? []).filter((t) => t.id !== record.id),
        ].slice(0, 30),
      });
      this.deps.save(next);
      this.book = next;
      this.state.recent = next.trips!;
      this.state.routineSuggestion = null;
      try {
        if (!a.replacements?.length)
          this.state.routineSuggestion = routineFrom(
            a.input,
            a.plan,
            this.now(),
          );
        this.deps.set("yike-last-routine", this.state.routineSuggestion);
      } catch {
        /* The saved feedback is independent of this optional shortcut. */
      }
      this.state.pace = a.phase === "walking" ? null : feedbackPace(record);
      this.storeActive(null);
      void this.assistance.end();
      this.state.feedback = { walking: "", spent: "", note: "", difficult: [] };
      this.state.status =
        "行后记录已保存到私人地点簿，可随地点簿同步。实付总额不会被拆成商品单价；步速也尚未修改。";
    });
  }
  helpRequest(value: string) {
    this.state.helpRequest = value.slice(0, 240);
    this.emit();
  }
  mobilityNeed(key: keyof MobilityNeeds) {
    if (this.state.busy || !MOBILITY_OPTIONS.some((o) => o.key === key)) return;
    try {
      const mobility = cleanMobility({
        ...this.state.mobility,
        [key]: !this.state.mobility[key],
      });
      const next = cleanBook({ ...this.book, mobility });
      this.deps.save(next);
      this.book = next;
      this.state.mobility = mobility;
      this.state.status =
        "已保存通行偏好，用于突出相关提醒；不代表路线已核验无障碍。";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  openAlternatives(kind: AlternativeKind = "place") {
    if (this.state.busy) return;
    const a = this.state.active;
    if (!a || a.phase !== "at" || a.remaining.length < 2)
      return this.message(
        "请在已确认地点结束歇脚后，再为尚未前往的下一站选择备选。路上位置未确认时不会假定你已到达。",
      );
    const old = a.input.stops.find((n) => n.id === a.remaining[0])!;
    const pool: TripStop[] =
      kind === "place"
        ? [
            ...a.input.stops,
            ...this.state.candidates.filter((n) => n.category === old.category),
          ]
        : a.input.bundle.mode === "demo" && old.position.system === "demo"
          ? [
              {
                id: `${old.id}-entrance-demo`,
                name: `${old.name}·示例另一入口`,
                category: old.category,
                stay: old.stay,
                position: {
                  system: "demo",
                  x: old.position.x - 200,
                  y: old.position.y,
                },
              },
            ]
          : this.book.places
              .filter((p) => p.position.system !== "demo")
              .map((p) => ({
                id: `p-${p.id}`,
                name: p.name,
                position: p.position,
                category: old.category,
                stay: old.stay,
              }));
    const seen = new Set<string>();
    const candidates = pool
      .filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        try {
          alternativeInput(a, n, kind);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 8);
    this.alternativePreview = null;
    this.state.alternative = {
      kind,
      candidates,
      selected: candidates[0]?.id ?? "",
      changes: [],
      note:
        kind === "entrance"
          ? "从已记录地点中选择你确认属于这家店的另一入口；照片上的圈点不等于地图坐标。通行和营业仍待确认。"
          : "比较原地点2公里内、未安排的同类候选地点；只读取去程和接续路线。",
    };
    this.state.error = "";
    this.emit();
  }
  selectAlternative(id: string) {
    const v = this.state.alternative;
    if (!this.state.busy && v?.candidates.some((n) => n.id === id)) {
      v.selected = id;
      v.changes = [];
      this.alternativePreview = null;
      this.emit();
    }
  }
  closeAlternatives() {
    if (this.state.busy) return;
    this.state.alternative = null;
    this.alternativePreview = null;
    this.emit();
  }
  async previewAlternative() {
    if (this.state.busy) return;
    await this.action(async () => {
      const v = this.state.alternative,
        a = this.state.active;
      const candidate = v?.candidates.find((n) => n.id === v.selected);
      if (!a || !v || !candidate)
        throw new Error(
          "当前没有可用备选，请先记录明确的入口或选择其他已核算地点。",
        );
      this.alternativePreview = null;
      v.changes = [];
      const basis = tripBasis(a),
        generation = this.generation;
      const { nodes, pairs } = alternativeInput(a, candidate, v.kind);
      const pending = this.cache.pending(nodes, pairs).length;
      if (
        a.input.bundle.mode !== "demo" &&
        pending &&
        !(await this.deps.confirm(
          `串行读取${pending}段百度步行路线来比较备选？仍受原有额度保护。`,
        ))
      )
        return;
      const routes = await this.cache.obtain(
        nodes,
        pairs,
        (b) => this.deps.request<RouteBundle>("/api/outings/routes", "POST", b),
        (n, total) => {
          this.state.status = `比较备选道路 ${n}/${total}`;
          this.emit();
        },
        () => !this.alive || generation !== this.generation,
      );
      this.deps.set("yike-outing-routes", this.cache.snapshot());
      if (
        !this.alive ||
        !this.state.active ||
        tripBasis(this.state.active) !== basis
      )
        throw new Error("行程已变化，请重新比较。原行程保留。");
      const preview = replaceNextStop(a, candidate, v.kind, routes, this.now());
      v.changes = preview.changes;
      this.alternativePreview = {
        candidate,
        kind: v.kind,
        routes,
        basis,
        at: this.now(),
      };
      this.state.status =
        "已完成备选比较，尚未替换。请核对时间、价格和通行情况。";
    });
  }
  async applyAlternative() {
    if (this.state.busy) return;
    await this.action(async () => {
      const p = this.alternativePreview,
        a = this.state.active;
      if (
        !p ||
        !a ||
        tripBasis(a) !== p.basis ||
        this.now() < p.at ||
        this.now() - p.at > 300000
      )
        throw new Error("比较结果已过期或行程变化，请先重新核算备选。");
      const r = replaceNextStop(a, p.candidate, p.kind, p.routes, this.now());
      if (
        !(await this.deps.confirm(
          r.changes.join("\n") + "\n确认只替换尚未前往的下一站？",
        ))
      )
        return;
      if (
        !this.alive ||
        !this.state.active ||
        tripBasis(this.state.active) !== p.basis ||
        this.now() < p.at ||
        this.now() - p.at > 300000
      )
        throw new Error("确认期间行程有变化或比较已过期，未替换，请重新比较。");
      this.storeActive(
        replaceNextStop(
          this.state.active,
          p.candidate,
          p.kind,
          p.routes,
          this.now(),
        ).active,
      );
      this.state.status =
        "已替换下一站，原到达记录与购物依据保留。请查看新路段指引、刷新邻里提醒，并重新准备出门卡。";
    });
  }
  async startHelp() {
    await this.assistance.start(this.state.helpRequest, null);
  }
  editRemaining() {
    const a = this.state.active;
    if (!a) return;
    this.state.adjust = {
      remaining: a.remaining.filter((id) => id !== a.input.origin.id),
      speed: String(a.input.draft.speedMps ?? a.input.preferences.speedMps),
    };
    this.state.adjustPreview = [];
    this.emit();
  }
  adjustSpeed(value: string) {
    if (this.state.adjust) this.state.adjust.speed = value;
    this.state.adjustPreview = [];
    this.emit();
  }
  adjustStop(id: string) {
    const d = this.state.adjust,
      a = this.state.active;
    if (!d || !a || !a.remaining.includes(id) || id === a.input.origin.id)
      return;
    d.remaining = d.remaining.includes(id)
      ? d.remaining.filter((v) => v !== id)
      : [...d.remaining, id];
    this.state.adjustPreview = [];
    this.emit();
  }
  moveStop(id: string) {
    const d = this.state.adjust;
    if (!d) return;
    const i = d.remaining.indexOf(id);
    if (i > 0)
      [d.remaining[i - 1], d.remaining[i]] = [
        d.remaining[i],
        d.remaining[i - 1],
      ];
    this.state.adjustPreview = [];
    this.emit();
  }
  previewRemaining() {
    try {
      const d = this.state.adjust;
      if (!d || !this.state.active) return;
      this.state.adjustPreview = adjustTrip(
        this.state.active,
        { remaining: d.remaining, speedMps: Number(d.speed) },
        this.now(),
      ).changes;
      this.state.error = "";
    } catch (e) {
      this.message((e as Error).message);
    }
    this.emit();
  }
  async applyRemaining() {
    const d = this.state.adjust;
    if (!d || !this.state.active) return;
    try {
      await this.commitAdjustment(
        { remaining: d.remaining, speedMps: Number(d.speed) },
        tripBasis(this.state.active),
      );
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  private async commitAdjustment(change: TripAdjustment, basis: string) {
    const a = this.state.active;
    if (!a || tripBasis(a) !== basis)
      throw new Error("行程已变化，请重新核对建议。");
    const preview = adjustTrip(a, change, this.now());
    if (
      !(await this.deps.confirm(
        preview.changes.join("\n") + "\n确认使用这个安排？",
      ))
    )
      throw new Error("尚未采纳，原行程已保留。");
    if (!this.state.active || tripBasis(this.state.active) !== basis)
      throw new Error("确认期间行程已变化，请重新核对。");
    this.storeActive(adjustTrip(this.state.active, change, this.now()).active);
    this.state.status = "已更新剩余行程，之前的到达记录已保留。";
    this.emit();
  }
  selectEntrance(id: string) {
    const a = this.state.active,
      n = a
        ? [a.input.origin, ...a.input.stops].find((n) => n.id === id)
        : null;
    if (!n) return;
    const existing = this.book.entrances?.find((g) => g.id === id),
      place = this.book.places.find((p) => p.id === id);
    this.state.entrance = existing
      ? { ...existing }
      : {
          id,
          name: n.name,
          photo: place?.photo ?? "",
          x: 0.5,
          y: 0.5,
          instruction: place?.landmark ?? "",
          observedOn: todayLocal(),
          source: "self",
        };
    this.emit();
  }
  entranceField(key: string, value: string | number) {
    const g = this.state.entrance;
    if (!g) return;
    if (key === "x" || key === "y")
      g[key] = Math.max(0, Math.min(1, Number(value)));
    if (key === "photo") {
      g.photo = String(value);
      g.x = 0.5;
      g.y = 0.5;
    }
    if (key === "instruction") g.instruction = String(value).slice(0, 240);
    if (key === "observedOn") g.observedOn = String(value);
    this.emit();
  }
  private saveEntrance(guide: EntranceGuide) {
    const next = cleanBook({
      ...this.book,
      entrances: [
        guide,
        ...(this.book.entrances ?? []).filter((g) => g.id !== guide.id),
      ],
    });
    this.deps.save(next);
    this.book = next;
    this.state.entrance = guide;
    this.state.entrances = next.entrances!;
    this.emit();
  }
  saveEntranceDraft() {
    try {
      this.saveEntrance(
        cleanEntrance({ ...this.state.entrance, source: "self" }),
      );
      this.state.status = "入口卡已保存到私人地点簿，可随地点簿同步。";
      this.state.error = "";
    } catch (e) {
      this.message((e as Error).message);
    }
    this.emit();
  }
  async shareEntrance() {
    try {
      await this.assistance.sharePhoto(cleanEntrance(this.state.entrance));
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  async removeEntrance() {
    const g = this.state.entrance;
    if (!g) return;
    if (
      !(await this.deps.confirm(
        `移除私人入口卡“${g.name}”？已分享的协助照片需另行结束协助。`,
      ))
    )
      return;
    try {
      const next = cleanBook({
        ...this.book,
        entrances: (this.book.entrances ?? []).filter((x) => x.id !== g.id),
      });
      this.deps.save(next);
      this.book = next;
      this.state.entrances = next.entrances!;
      this.state.entrance = null;
      this.state.status = "私人入口卡已移除。";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
  private async applyHelp(p: AssistProposal, s: AssistSnapshot) {
    if (p.kind === "plan" && p.change)
      return this.commitAdjustment(p.change, s.basis);
    if (
      !(await this.deps.confirm(
        `${p.note}\n${p.kind === "entrance" ? "保存家人圈出的入口和说明？这条建议尚未经过现场核实。" : "确认已看过这条提醒？"}`,
      ))
    )
      throw new Error("尚未采纳，原安排已保留。");
    if (!this.state.active || tripBasis(this.state.active) !== s.basis)
      throw new Error("行程已变化，请重新核对。");
    if (p.kind === "entrance" && s.guide && p.marker)
      this.saveEntrance(
        cleanEntrance({
          ...s.guide,
          ...p.marker,
          instruction: p.note,
          source: "helper",
        }),
      );
  }
  async applyPace() {
    const pace = this.state.pace;
    if (
      !pace ||
      !(await this.deps.confirm(
        `按记录路程与填写的纯步行时间，估算${pace}米/秒。道路距离不是实测轨迹。确认用它更新舒适步速？`,
      ))
    )
      return;
    const next = cleanBook({
      ...this.book,
      preferences: { ...this.book.preferences, speedMps: pace },
      movement: {
        ...(this.book.movement ?? defaultMovement(pace)),
        easyMps: pace,
        mode: "easy",
      },
    });
    try {
      this.deps.save(next);
      this.book = next;
      this.state.form.speedMps = String(pace);
      this.state.pace = null;
      this.invalidate();
      this.state.status = "已确认更新舒适步速，下次核算使用新值。";
      this.emit();
    } catch (e) {
      this.message((e as Error).message);
    }
  }
}
