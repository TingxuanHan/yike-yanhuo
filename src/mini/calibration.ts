import { cleanBook, type LifeBook } from "../shared/life.js";
import {
  calibrationExport,
  calibrationSummary,
  finishWalk,
  prepareWalk,
  WALK_SOURCE_LABELS,
  walkExclusion,
  walkSeconds,
  type WalkDistanceSource,
} from "../shared/walk-calibration.js";

export const walkSources = [
  { id: "measured", label: "已量好距离，如标有长度的步道" },
  { id: "map", label: "地图估算，仅留作记录" },
  { id: "demo", label: "模拟练习，不作为实走" },
] as const;
const seconds = (n: number) => `${Math.round(n)}秒`;
export function calibrationView(book: LifeBook, now = Date.now()) {
  const trials = book.walks ?? [];
  const summary = calibrationSummary(trials, now);
  const fast = summary.highMps ? (1000 / summary.highMps / 60).toFixed(1) : "";
  const slow = summary.lowMps ? (1000 / summary.lowMps / 60).toFixed(1) : "";
  return {
    summary,
    current: `${book.preferences.speedMps}米/秒`,
    kilometer: summary.ready
      ? `按这几次步速，1公里纯步行约${fast === slow ? fast : `${fast}—${slow}`}分钟；等灯、停留另算。`
      : "达到记录条件后，再给出建议和用时参考。",
    evaluation: summary.evaluationCount
      ? `${summary.evaluationCount}次后续记录：当时设置平均误差${seconds(summary.baselineMaeSeconds!)}，事先建议平均误差${seconds(summary.calibratedMaeSeconds!)}。`
      : "尚无可对照的后续记录。得到建议后再准备下一次，才能检验建议。",
    pending: trials.find((v) => !v.completedAt && !v.excludedReason)?.id ?? "",
    rows: [...trials].reverse().map((v) => ({
      id: v.id,
      label: v.label,
      source: WALK_SOURCE_LABELS[v.distanceSource],
      date: new Date(v.startedAt).toLocaleString("zh-CN", { hour12: false }),
      prediction: `${v.meters}米 · 当时设置预计${seconds(v.meters / v.baselineMps)}${v.calibratedMps ? ` · 事先建议预计${seconds(v.meters / v.calibratedMps)}` : ""}`,
      observation: v.completedAt
        ? `填报总用时${seconds(v.elapsedSeconds!)} − 停留${seconds(v.stoppedSeconds!)} = 纯步行${seconds(walkSeconds(v)!)} · ${(v.meters / walkSeconds(v)!).toFixed(2)}米/秒`
        : "走完后在安全位置补记；可以离开本页。",
      reason: walkExclusion(v, now) || "已纳入日常步速参考 · 本人填报",
      excluded: !!v.excludedReason,
      complete: !!v.completedAt,
    })),
  };
}
export interface CalibrationState extends ReturnType<typeof calibrationView> {
  form: {
    label: string;
    meters: string;
    source: WalkDistanceSource;
    usual: boolean;
  };
  elapsed: string;
  stopped: string;
  exclusion: string;
  status: string;
  error: string;
}
export class CalibrationSession {
  state: CalibrationState;
  private book: LifeBook;
  constructor(
    book: LifeBook,
    private deps: {
      save: (b: LifeBook) => void;
      notify: (s: CalibrationState) => void;
      now?: () => number;
    },
  ) {
    this.book = cleanBook(book);
    this.state = {
      ...calibrationView(this.book, this.now()),
      form: {
        label: "平地步道",
        meters: "100",
        source: "measured",
        usual: false,
      },
      elapsed: "",
      stopped: "0",
      exclusion: "",
      status: "",
      error: "",
    };
  }
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  private emit() {
    this.deps.notify({ ...this.state, form: { ...this.state.form } });
  }
  sync(book: LifeBook) {
    this.book = cleanBook(book);
    Object.assign(this.state, calibrationView(this.book, this.now()));
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
  private save(book: LifeBook) {
    const next = cleanBook(book);
    this.deps.save(next);
    this.book = next;
    Object.assign(this.state, calibrationView(next, this.now()));
  }
  field(key: string, value: string | boolean) {
    this.run(() => {
      if (key === "usual") this.state.form.usual = value === true;
      else if (key === "source" && walkSources.some((s) => s.id === value))
        this.state.form.source = value as WalkDistanceSource;
      else if (key === "label" || key === "meters")
        this.state.form[key] = String(value);
      else if (key === "elapsed" || key === "stopped" || key === "exclusion")
        this.state[key] = String(value);
    });
  }
  prepare() {
    this.run(() => {
      if (this.state.pending)
        throw new Error("请先补完当前记录，或填写原因将它排除。");
      if ((this.book.walks?.length ?? 0) >= 30)
        throw new Error(
          "已保存30条记录。请先导出，暂不新增；不会自动删除历史依据。",
        );
      const f = this.state.form;
      const trial = prepareWalk(
        {
          label: f.label,
          meters: Number(f.meters),
          distanceSource: f.source,
          usual: f.usual,
        },
        this.book.preferences.speedMps,
        this.book.walks ?? [],
        this.now(),
      );
      this.save({ ...this.book, walks: [...(this.book.walks ?? []), trial] });
      this.state.elapsed = "";
      this.state.stopped = "0";
      this.state.status =
        "准备记录已保存，预计用时已固定。走完后再补记实际情况。";
    });
  }
  finish() {
    this.run(() => {
      const trial = this.book.walks?.find((v) => v.id === this.state.pending);
      if (!trial) throw new Error("请先准备一条记录。");
      if (!this.state.elapsed.trim() || !this.state.stopped.trim())
        throw new Error("请填写总用时和停留秒数；没有停留请填0。");
      const updated = finishWalk(
        trial,
        Number(this.state.elapsed),
        Number(this.state.stopped),
        this.now(),
      );
      this.save({
        ...this.book,
        walks: this.book.walks!.map((v) => (v.id === updated.id ? updated : v)),
      });
      this.state.status =
        "实走情况已保存。步速尚未修改，可继续积累或确认采用建议。";
    });
  }
  exclude(id: string) {
    this.run(() => {
      const trial = this.book.walks?.find((v) => v.id === id);
      if (!trial) throw new Error("记录已变化，请重新打开。");
      if (!trial.excludedReason && !this.state.exclusion.trim())
        throw new Error("请先填写排除原因，例如距离记错或当天负重较多。");
      if (trial.excludedReason && !trial.completedAt && this.state.pending)
        throw new Error("请先完成当前待补记，再恢复这一条。");
      const reason = trial.excludedReason ? "" : this.state.exclusion.trim();
      this.save({
        ...this.book,
        walks: this.book.walks!.map((v) =>
          v.id === id ? { ...v, excludedReason: reason } : v,
        ),
      });
      this.state.exclusion = "";
      this.state.status = reason
        ? "已排除这条记录，原始数据仍保留，可以恢复。"
        : "记录已恢复，建议已重新核对。";
    });
  }
  apply() {
    this.run(() => {
      const summary = calibrationSummary(this.book.walks ?? [], this.now());
      if (!summary.ready) throw new Error(summary.reason);
      this.save({
        ...this.book,
        preferences: { ...this.book.preferences, speedMps: summary.medianMps! },
      });
      this.state.status = `已将日常步速设为${summary.medianMps}米/秒。已有方案保持原样，请重新试算后使用。`;
    });
  }
  clear() {
    this.run(() => {
      this.save({ ...this.book, walks: [] });
      this.state.status =
        "本机实走记录已清空，日常步速和地点保留。如需更新其他设备，请到同步页同步本机修改。";
    });
  }
  export() {
    return calibrationExport(this.book.walks ?? [], this.now());
  }
}
