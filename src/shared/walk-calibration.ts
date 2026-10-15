export type WalkDistanceSource = "measured" | "map" | "demo";
export interface WalkTrial {
  id: string;
  label: string;
  startedAt: string;
  meters: number;
  distanceSource: WalkDistanceSource;
  usual: boolean;
  baselineMps: number;
  calibratedMps: number | null;
  trainingIds: string[];
  completedAt: string | null;
  elapsedSeconds: number | null;
  stoppedSeconds: number | null;
  excludedReason: string;
}
const DAY = 86400000;
const bounded = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const idOk = (v: unknown): v is string =>
  typeof v === "string" && /^walk-[a-z0-9-]{1,75}$/.test(v);
const timeOk = (v: unknown): v is string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const round = (v: number) => Math.round(v * 100) / 100;
export const WALK_SOURCE_LABELS: Record<WalkDistanceSource, string> = {
  measured: "已量距离 · 本人填报",
  map: "地图估算距离",
  demo: "模拟练习",
};
export function cleanWalkTrial(value: unknown): WalkTrial {
  const v = value as WalkTrial;
  if (
    !v ||
    !idOk(v.id) ||
    typeof v.label !== "string" ||
    !v.label.trim() ||
    v.label.trim().length > 60 ||
    !timeOk(v.startedAt) ||
    !bounded(v.meters, 50, 5000) ||
    !["measured", "map", "demo"].includes(v.distanceSource) ||
    typeof v.usual !== "boolean" ||
    !bounded(v.baselineMps, 0.3, 2) ||
    !Array.isArray(v.trainingIds) ||
    v.trainingIds.length > 30 ||
    v.trainingIds.some((id) => !idOk(id) || id === v.id) ||
    new Set(v.trainingIds).size !== v.trainingIds.length ||
    (v.calibratedMps !== null &&
      (!bounded(v.calibratedMps, 0.3, 2) ||
        v.trainingIds.length < 3 ||
        v.distanceSource !== "measured" ||
        !v.usual)) ||
    (v.calibratedMps === null && v.trainingIds.length !== 0) ||
    typeof v.excludedReason !== "string" ||
    v.excludedReason.length > 120
  )
    throw new Error("请核对路段名称、50—5000米的距离及距离来源。");
  if (v.completedAt === null) {
    if (v.elapsedSeconds !== null || v.stoppedSeconds !== null)
      throw new Error("尚未完成的记录不能包含实走用时。");
  } else if (
    !timeOk(v.completedAt) ||
    Date.parse(v.completedAt) < Date.parse(v.startedAt) ||
    !bounded(v.elapsedSeconds, 1, 14400) ||
    !bounded(v.stoppedSeconds, 0, v.elapsedSeconds - 1)
  )
    throw new Error("请填写有效的总用时和停留秒数；停留须少于总用时。");
  return {
    id: v.id,
    label: v.label.trim(),
    startedAt: v.startedAt,
    meters: v.meters,
    distanceSource: v.distanceSource,
    usual: v.usual,
    baselineMps: v.baselineMps,
    calibratedMps: v.calibratedMps,
    trainingIds: [...v.trainingIds],
    completedAt: v.completedAt,
    elapsedSeconds: v.elapsedSeconds,
    stoppedSeconds: v.stoppedSeconds,
    excludedReason: v.excludedReason.trim(),
  };
}
export function walkSeconds(v: WalkTrial) {
  return v.elapsedSeconds === null || v.stoppedSeconds === null
    ? null
    : v.elapsedSeconds - v.stoppedSeconds;
}
export function walkExclusion(v: WalkTrial, now = Date.now()): string {
  if (v.excludedReason) return `已排除：${v.excludedReason}`;
  if (!v.completedAt) return "等待走完补记";
  if (v.distanceSource !== "measured") return "距离未经实量，不纳入校准";
  if (!v.usual) return "路况或走法不同，不纳入日常步速";
  if (Date.parse(v.completedAt) > now || Date.parse(v.startedAt) > now)
    return "记录时间在未来，请检查设备时间";
  if (now - Date.parse(v.completedAt) > 90 * DAY)
    return "超过90天，建议重新测量";
  const speed = v.meters / walkSeconds(v)!;
  if (!bounded(speed, 0.3, 2))
    return "换算步速超出0.3—2米/秒，请核对距离与用时";
  return "";
}
export function calibrationSummary(input: WalkTrial[], now = Date.now()) {
  const rows = input.map(cleanWalkTrial);
  const valid = rows.filter((v) => !walkExclusion(v, now));
  const speeds = valid
    .map((v) => v.meters / walkSeconds(v)!)
    .sort((a, b) => a - b);
  const count = valid.length;
  const meters = valid.reduce((sum, v) => sum + v.meters, 0);
  const median = count
    ? (speeds[Math.floor((count - 1) / 2)]! + speeds[Math.floor(count / 2)]!) /
      2
    : null;
  const spread = count > 1 && speeds.at(-1)! / speeds[0]! > 1.5;
  const ready = count >= 3 && meters >= 300 && !spread;
  // Predictions are captured before this observation. Never fit and score the same trial.
  const evaluation = valid.filter((v) => {
    if (v.calibratedMps === null) return false;
    const training = v.trainingIds.map((id) => rows.find((r) => r.id === id));
    if (
      training.some(
        (r) =>
          !r ||
          !r.completedAt ||
          Date.parse(r.completedAt) >= Date.parse(v.startedAt) ||
          walkExclusion(r, Date.parse(v.startedAt)),
      )
    )
      return false;
    const values = (training as WalkTrial[])
      .map((r) => r.meters / walkSeconds(r)!)
      .sort((a, b) => a - b);
    const total = (training as WalkTrial[]).reduce(
      (sum, r) => sum + r.meters,
      0,
    );
    const mid =
      (values[Math.floor((values.length - 1) / 2)]! +
        values[Math.floor(values.length / 2)]!) /
      2;
    return (
      total >= 300 &&
      values.at(-1)! / values[0]! <= 1.5 &&
      round(mid) === v.calibratedMps
    );
  });
  const meanError = (key: "baselineMps" | "calibratedMps") =>
    evaluation.length
      ? round(
          evaluation.reduce(
            (sum, v) => sum + Math.abs(v.meters / v[key]! - walkSeconds(v)!),
            0,
          ) / evaluation.length,
        )
      : null;
  return {
    count,
    meters,
    total: rows.length,
    ready,
    medianMps: median === null ? null : round(median),
    lowMps: count ? round(speeds[0]!) : null,
    highMps: count ? round(speeds.at(-1)!) : null,
    sampleIds: valid.map((v) => v.id),
    reason: ready
      ? "可以试用这组实走记录的建议步速。"
      : spread
        ? "几次步速差异较大，请核对停留时间，或在相近路况再测。"
        : `还需积累至少3次、合计300米的有效记录（当前${count}次、${meters}米）。`,
    evaluationCount: evaluation.length,
    baselineMaeSeconds: meanError("baselineMps"),
    calibratedMaeSeconds: meanError("calibratedMps"),
  };
}
export function prepareWalk(
  fields: Pick<WalkTrial, "label" | "meters" | "distanceSource" | "usual">,
  baselineMps: number,
  prior: WalkTrial[],
  now = Date.now(),
  id = `walk-${now}-${Math.random().toString(36).slice(2, 9)}`,
): WalkTrial {
  // A previously completed observation must strictly predate the prediction.
  const history = prior.filter(
    (v) => v.completedAt && Date.parse(v.completedAt) < now,
  );
  const summary = calibrationSummary(history, now);
  const eligible =
    summary.ready && fields.distanceSource === "measured" && fields.usual;
  return cleanWalkTrial({
    ...fields,
    id,
    startedAt: new Date(now).toISOString(),
    baselineMps,
    calibratedMps: eligible ? summary.medianMps : null,
    trainingIds: eligible ? summary.sampleIds : [],
    completedAt: null,
    elapsedSeconds: null,
    stoppedSeconds: null,
    excludedReason: "",
  });
}
export function finishWalk(
  trial: WalkTrial,
  elapsedSeconds: number,
  stoppedSeconds: number,
  now = Date.now(),
) {
  if (trial.completedAt)
    throw new Error("这条记录已经完成，请另建一条记录，不覆盖原来的预测。");
  return cleanWalkTrial({
    ...trial,
    elapsedSeconds,
    stoppedSeconds,
    completedAt: new Date(now).toISOString(),
  });
}
export function mergeWalks(local: WalkTrial[], incoming: WalkTrial[]) {
  const result = new Map(incoming.map((v) => [v.id, v]));
  for (const v of local) {
    const other = result.get(v.id);
    if (other) {
      const prediction = (r: WalkTrial) =>
        JSON.stringify([
          r.label,
          r.startedAt,
          r.meters,
          r.distanceSource,
          r.usual,
          r.baselineMps,
          r.calibratedMps,
          [...r.trainingIds].sort(),
        ]);
      if (prediction(v) !== prediction(other))
        throw new Error(
          "同一实走记录的准备信息不同，请分别备份，不能覆盖原预测。",
        );
      if (
        v.completedAt &&
        other.completedAt &&
        (v.completedAt !== other.completedAt ||
          v.elapsedSeconds !== other.elapsedSeconds ||
          v.stoppedSeconds !== other.stoppedSeconds)
      )
        throw new Error(
          "两台设备对同一实走记录补记不同，请分别备份后选择保留的版本。",
        );
    }
    // A stale pending copy must not replace an already completed observation.
    result.set(v.id, other?.completedAt && !v.completedAt ? other : v);
  }
  return [...result.values()].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
}
export function calibrationExport(trials: WalkTrial[], now = Date.now()) {
  return {
    format: "yike-walk-validation-v1",
    exportedAt: new Date(now).toISOString(),
    method:
      "准备时固定预测；仅先前已完成的本人填报实量记录参与中位数校准；后续记录成对比较纯步行绝对误差。",
    limitations: [
      "距离与用时由用户填报，未经独立核验。",
      "样本步速范围不是置信区间，不保证以后用时。",
      "剔除记录与有效条件保留在明细，结论仅适用于本人的相近路况。",
      "不含坐标、电话、照片或完整地点簿。",
    ],
    summary: calibrationSummary(trials, now),
    trials: trials.map((v) => ({
      ...cleanWalkTrial(v),
      exclusion: walkExclusion(v, now),
    })),
  };
}
