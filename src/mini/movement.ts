import { cleanBook, type LifeBook } from "../shared/life.js";
import {
  cleanMovement,
  cleanMovementTrip,
  defaultMovement,
  demoMovementTrip,
  planMovement,
  type MovementSettings,
  type MovementTrip,
} from "../shared/movement.js";
export * from "../shared/movement.js";
const minutes = (value: number) =>
  `${(Math.round(value * 10) / 10).toFixed(1)}分钟`;
export function movementView(report: ReturnType<typeof planMovement>) {
  return {
    feasible: report.feasible,
    complete: report.complete,
    summary: report.complete
      ? `这一趟计划步行${minutes(report.walkingMinutes)}`
      : "行程尚未核算完整",
    returnText: report.complete
      ? `整趟${minutes(report.totalMinutes)} · ${report.finish}返回`
      : "当前营业条件无法完成原定行程",
    brisk: `稍快走${minutes(report.briskMinutes)}`,
    other: `等待${minutes(report.waitingMinutes)} · 停留${minutes(report.stayMinutes)}`,
    extra:
      report.extraMinutes >= 0
        ? `比原方案多用${minutes(report.extraMinutes)}`
        : `比原方案少用${minutes(-report.extraMinutes)}`,
    goal: report.complete
      ? report.targetMissing > 0.05
        ? `距离步行目标还差${minutes(report.targetMissing)}；可以另选较长行程。`
        : "计划达到本次步行时长目标。"
      : "请先调整行程，再核对步行目标。",
    issues: report.issues,
    notes: report.notes,
    legs: report.legs.map((l, i) => ({
      id: `leg-${i}`,
      name: l.name,
      time: `${l.arrival}到达 · ${Math.round(l.meters)}米`,
      stop: `步行${minutes(l.walking)}${l.signalWait ? ` · 等灯预估${minutes(l.signalWait)}` : ""}${l.openingWait ? ` · 等开门${minutes(l.openingWait)}` : ""}${l.stay ? ` · ${l.rests ? "歇脚" : "停留"}${minutes(l.stay)}` : ""}`,
      phases: l.phases.map((p, j) => ({
        id: `p-${j}`,
        kind: p.kind,
        label: p.label,
        detail: `${minutes(p.seconds / 60)}${p.speed === null ? "" : ` · ${p.speed}米/秒 · 约${Math.round(p.meters)}米`}`,
      })),
    })),
  };
}
type Preview = ReturnType<typeof movementView>;
export interface MovementView {
  settings: MovementSettings;
  preview: Preview | null;
  error: string;
  status: string;
  source: string;
  route: string;
  original: string;
  demo: boolean;
  advanced: boolean;
}
interface Dependencies {
  get: (k: string) => unknown;
  set: (k: string, v: unknown) => void;
  save: (b: LifeBook) => void;
  notify: (v: MovementView) => void;
}
export class MovementSession {
  state: MovementView;
  private book: LifeBook;
  private trip: MovementTrip;
  private alive = true;
  constructor(
    book: LifeBook,
    input: MovementTrip | null,
    private deps: Dependencies,
  ) {
    this.book = cleanBook(book);
    this.trip = cleanMovementTrip(input ?? demoMovementTrip());
    this.state = {
      settings: {
        ...(book.movement ?? defaultMovement(book.preferences.speedMps)),
      },
      preview: null,
      error: "",
      status: "",
      advanced: false,
      demo: this.trip.mode === "demo",
      source:
        this.trip.mode === "demo"
          ? "离线示例 · 人工构造行程"
          : "基于已选行程 · 沿用已读取的路段距离",
      route: `${this.trip.origin} → ${this.trip.stops.map((s) => s.name).join(" → ")}`,
      original: `原方案${minutes(this.trip.originalMinutes)} · 整趟上限${minutes(this.trip.budgetMinutes)}`,
    };
    try {
      const raw = deps.get("yike-movement-draft");
      if (raw) {
        if (JSON.stringify(raw).length > 3000)
          throw new Error("步行设置草稿过大。");
        const draft = raw as Record<string, unknown>;
        for (const key of Object.keys(
          this.state.settings,
        ) as (keyof MovementSettings)[]) {
          const value = draft[key];
          if (key === "mode" && (value === "easy" || value === "alternating"))
            this.state.settings.mode = value;
          else if (key === "returnEasy" && typeof value === "boolean")
            this.state.settings.returnEasy = value;
          else if (
            key !== "mode" &&
            key !== "returnEasy" &&
            typeof value === "number" &&
            Number.isFinite(value)
          )
            this.state.settings[key] = value;
        }
      }
    } catch {
      this.state.error = "步行草稿未能恢复，已载入保存的偏好。";
    }
  }
  close() {
    this.alive = false;
  }
  reopen() {
    this.alive = true;
  }
  emit() {
    if (this.alive)
      this.deps.notify({ ...this.state, settings: { ...this.state.settings } });
  }
  message(text: string, error = false) {
    if (error) this.state.error = text;
    else this.state.status = text;
    this.emit();
  }
  private run(fn: () => void) {
    this.state.error = "";
    this.state.status = "";
    try {
      fn();
    } catch (e) {
      this.state.error = (e as Error).message;
    }
    this.emit();
  }
  change(key: string, value: unknown) {
    this.run(() => {
      if (!Object.prototype.hasOwnProperty.call(this.state.settings, key))
        return;
      if (key === "mode") {
        if (value !== "easy" && value !== "alternating")
          throw new Error("请选择步行节奏。");
        this.state.settings.mode = value;
      } else if (key === "returnEasy") this.state.settings.returnEasy = !!value;
      else
        this.state.settings[
          key as Exclude<keyof MovementSettings, "mode" | "returnEasy">
        ] = Number(value);
      this.state.preview = null;
      try {
        this.deps.set("yike-movement-draft", this.state.settings);
      } catch {
        throw new Error("草稿尚未保存，请检查本机空间；当前输入仍保留。");
      }
    });
  }
  toggle() {
    this.state.advanced = !this.state.advanced;
    this.emit();
  }
  calculate() {
    this.run(() => {
      this.state.preview = null;
      this.state.preview = movementView(
        planMovement(this.trip, this.state.settings),
      );
    });
  }
  save() {
    this.run(() => {
      const next = cleanBook({
        ...this.book,
        movement: cleanMovement(this.state.settings),
      });
      this.deps.save(next);
      this.book = next;
      this.state.status = "步行偏好已保存，可随地点簿同步。";
    });
  }
  sync(book: LifeBook) {
    this.book = cleanBook(book);
  }
  load() {
    this.run(() => {
      this.state.settings = {
        ...(this.book.movement ??
          defaultMovement(this.book.preferences.speedMps)),
      };
      this.state.preview = null;
      this.deps.set("yike-movement-draft", this.state.settings);
      this.state.status = "已载入地点簿中的步行偏好。";
    });
  }
  copyText() {
    const p = this.state.preview;
    if (!p?.feasible) throw new Error("请先得到符合时间与步行上限的完整方案。");
    return [
      "顺路动一动 · 计划参考",
      this.state.source,
      this.state.route,
      p.summary,
      p.returnText,
      p.brisk,
      p.other,
      p.goal,
      ...p.legs.flatMap((l) => [
        `${l.time} ${l.name}`,
        l.stop,
        ...l.phases.map((s) => `${s.label}：${s.detail}`),
      ]),
      "不是实际运动记录或逐路口导航；路口和拥挤路段按现场情况通行。",
    ].join("\n");
  }
}
