import {
  holdoutPoints,
  coarseContours,
  pointInPolygons,
  HOLDOUT_PROTOCOL,
} from "./benchmark.js";
import { reportTriangles } from "./verification.js";
import { gridTriangles } from "./mesh.js";
import { pointKey, toGeo } from "./geo.js";
import { parseResultFile } from "../shared/result-file.js";
import { utf8Bytes } from "../shared/life.js";
import type {
  AnalysisResult,
  Provider,
  Triangle,
  Travel,
  Usage,
  XY,
} from "../shared/types.js";
import type {
  AuditModel,
  ContourAuditPlan,
  ContourAuditObservation,
  ContourAuditResult,
} from "../shared/contour-audit.js";

const MODELS: { model: AuditModel; label: string }[] = [
  { model: "current", label: "当前轮廓" },
  { model: "coarse", label: "原规则网格" },
  { model: "circle", label: "直线圆（1.2米/秒）" },
];
// Opposite pairs, two (then four) points per radius. No outcome-dependent choice.
const ORDER = [0, 12, 16, 4, 8, 20, 2, 14, 18, 6, 10, 22];
function inTriangle(p: XY, t: Triangle) {
  const signs = t.map((v, i) => {
    const next = t[(i + 1) % 3].point;
    return (
      (next[0] - v.point[0]) * (p[1] - v.point[1]) -
      (next[1] - v.point[1]) * (p[0] - v.point[0])
    );
  });
  return signs.every((v) => v >= -1e-6) || signs.every((v) => v <= 1e-6);
}
function supported(point: XY, triangles: Triangle[]) {
  const touching = triangles.filter((t) => inTriangle(point, t));
  return (
    touching.length > 0 &&
    touching.every((t) => t.every((v) => v.travel.status === "ok"))
  );
}
export function contourAuditPlan(
  report: AnalysisResult,
  minutes: number,
  count: number,
): ContourAuditPlan {
  if (report.scenario)
    throw new Error(
      "请先打开原始测时报告；个人步速或等灯试算不与地图原耗时直接比较。",
    );
  if (
    ![5, 10, 15].includes(minutes) ||
    !report.contours.some((c) => c.minutes === minutes)
  )
    throw new Error("请选择原报告已有的5、10或15分钟范围。");
  if (count !== 6 && count !== 12) throw new Error("请选择固定6点或12点复核。");
  const all = holdoutPoints(report),
    coarse = coarseContours(report),
    triangles = reportTriangles(report),
    coarseTriangles = gridTriangles(
      report.center.point,
      report.parameters.radiusMeters,
      report.parameters.coarseStepMeters,
      new Map(report.samples.map((s) => [pointKey(s.point), s])),
    ),
    contour = report.contours.find((c) => c.minutes === minutes)!,
    coarseContour = coarse.contours.find((c) => c.minutes === minutes)!;
  return {
    version: "fixed-polar-holdout-v1",
    sourceId: report.id,
    sourceGeneratedAt: report.generatedAt,
    minutes,
    count,
    minimumSeparationMeters: HOLDOUT_PROTOCOL.minimumTrainingSeparationMeters,
    circleSpeedMps: HOLDOUT_PROTOCOL.circleSpeedMetersPerSecond,
    points: ORDER.slice(0, count).map((index, i) => {
      const point = all[index];
      return {
        number: i + 1,
        point,
        predictions: {
          current: supported(point, triangles)
            ? pointInPolygons(point, contour.polygons)
            : null,
          coarse: supported(point, coarseTriangles)
            ? pointInPolygons(point, coarseContour.polygons)
            : null,
          circle:
            Math.hypot(
              point[0] - report.center.point[0],
              point[1] - report.center.point[1],
            ) <=
            minutes * 60 * HOLDOUT_PROTOCOL.circleSpeedMetersPerSecond,
        },
      };
    }),
    // The existing gateway permits one retry; this is the preflight upper bound.
    maxRouteUnits: count * 2,
  };
}
function cleanTravel(value: Travel): Travel {
  if (
    value?.status === "ok" &&
    Number.isFinite(value.seconds) &&
    value.seconds >= 0 &&
    value.seconds <= 86400 &&
    Number.isFinite(value.meters) &&
    value.meters >= 0 &&
    value.meters <= 1_000_000
  )
    return { status: "ok", seconds: value.seconds, meters: value.meters };
  if (
    (value?.status === "unknown" || value?.status === "unreachable") &&
    typeof value.reason === "string" &&
    value.reason.length <= 300
  )
    return { status: value.status, reason: value.reason };
  throw new Error("复核测时格式无效，不能用于比较。");
}
function iso(value: string) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("复核时间格式无效。");
  return value;
}
export function summarizeContourAudit(
  report: AnalysisResult,
  plan: ContourAuditPlan,
  observations: ContourAuditObservation[],
  plannedAt: string,
  completedAt: string,
  usage: Usage,
): ContourAuditResult {
  const actualPlan = contourAuditPlan(report, plan.minutes, plan.count);
  if (JSON.stringify(plan) !== JSON.stringify(actualPlan))
    throw new Error("原报告或固定复核方案已变化。");
  iso(plannedAt);
  iso(completedAt);
  if (
    plannedAt > completedAt ||
    !Array.isArray(observations) ||
    observations.length !== plan.count
  )
    throw new Error("复核点尚未完整返回，或时间顺序无效。");
  const records = observations.map((o, i) => {
    if (
      o.number !== plan.points[i].number ||
      JSON.stringify(o.point) !== JSON.stringify(plan.points[i].point) ||
      iso(o.readAt) < plannedAt ||
      o.readAt > completedAt
    )
      throw new Error("复核位置或读取时间与预先方案不一致。");
    return {
      number: o.number,
      point: [...o.point] as XY,
      travel: cleanTravel(o.travel),
      readAt: o.readAt,
    };
  });
  for (const key of [
    "requests",
    "routePairs",
    "searchRequests",
    "cacheHits",
    "retries",
  ] as const)
    if (!Number.isInteger(usage[key]) || usage[key] < 0 || usage[key] > 1000)
      throw new Error("复核用量格式无效。");
  if (usage.searchRequests !== 0) throw new Error("独立抽点不应新增设施检索。");
  const metrics = MODELS.map(({ model, label }) => {
    let evaluated = 0,
      agreement = 0,
      falseReachable = 0,
      missedReachable = 0,
      observationUnknown = 0,
      predictionUnknown = 0;
    records.forEach((o, i) => {
      if (o.travel.status === "unknown") {
        observationUnknown++;
        return;
      }
      const predicted = plan.points[i].predictions[model];
      if (predicted === null) {
        predictionUnknown++;
        return;
      }
      const actual =
        o.travel.status === "ok" && o.travel.seconds <= plan.minutes * 60;
      evaluated++;
      if (predicted === actual) agreement++;
      else if (predicted) falseReachable++;
      else missedReachable++;
    });
    return {
      model,
      label,
      evaluated,
      agreement,
      falseReachable,
      missedReachable,
      observationUnknown,
      predictionUnknown,
    };
  });
  const paired = { evaluated: 0, currentAgreement: 0, circleAgreement: 0 };
  records.forEach((o, i) => {
    const p = plan.points[i].predictions;
    if (
      o.travel.status === "unknown" ||
      p.current === null ||
      p.circle === null
    )
      return;
    const actual =
      o.travel.status === "ok" && o.travel.seconds <= plan.minutes * 60;
    paired.evaluated++;
    if (p.current === actual) paired.currentAgreement++;
    if (p.circle === actual) paired.circleAgreement++;
  });
  return {
    schema: "yike-contour-audit-v1",
    evidence: report.mode === "demo" ? "simulation" : "api-holdout",
    report,
    plan: actualPlan,
    plannedAt,
    completedAt,
    observations: records,
    metrics,
    paired,
    usage: { ...usage },
  };
}
export async function executeContourAudit(
  report: AnalysisResult,
  plan: ContourAuditPlan,
  provider: Provider,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  now = () => new Date().toISOString(),
) {
  if (provider.mode !== report.mode)
    throw new Error("复核来源与报告模式不一致。");
  // Freeze a JSON copy before any asynchronous read, including caller mutations.
  const frozen = parseResultFile(JSON.stringify(report));
  const fixed = contourAuditPlan(frozen, plan.minutes, plan.count);
  if (JSON.stringify(fixed) !== JSON.stringify(plan))
    throw new Error("固定复核方案已变化。");
  const plannedAt = now(),
    observations: ContourAuditObservation[] = [];
  const initial = { ...provider.usage };
  for (const p of fixed.points) {
    signal?.throwIfAborted();
    const [travel] = await provider.route(
      frozen.center.point,
      [p.point],
      signal,
    );
    signal?.throwIfAborted();
    observations.push({
      number: p.number,
      point: p.point,
      travel: cleanTravel(
        travel ?? { status: "unknown", reason: "本次测时未返回" },
      ),
      readAt: now(),
    });
    onProgress?.(observations.length, fixed.count);
  }
  const usage = Object.fromEntries(
    Object.entries(provider.usage).map(([k, v]) => [
      k,
      v - initial[k as keyof Usage],
    ]),
  ) as unknown as Usage;
  return summarizeContourAudit(
    frozen,
    fixed,
    observations,
    plannedAt,
    now(),
    usage,
  );
}
export function parseContourAudit(raw: string): ContourAuditResult {
  if (utf8Bytes(raw) > 8_000_000) throw new Error("复核依据超过8MB。");
  const file = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (file.schema !== "yike-contour-audit-v1")
    throw new Error("不是支持的等时圈复核文件。");
  const report = parseResultFile(JSON.stringify(file.report));
  const actual = summarizeContourAudit(
    report,
    file.plan,
    file.observations,
    file.plannedAt,
    file.completedAt,
    file.usage,
  );
  if (
    JSON.stringify(actual.metrics) !== JSON.stringify(file.metrics) ||
    JSON.stringify(actual.paired) !== JSON.stringify(file.paired) ||
    actual.evidence !== file.evidence
  )
    throw new Error("复核结论与原始点记录不一致。");
  return actual;
}
export const CONTOUR_AUDIT_LIMITS = [
  "6或12个预定义极坐标点，与原采样及设施点至少相隔10米，不按结果挑点；不是社区随机抽样，样本一致数不代表整体准确率。",
  "先冻结原报告与预测，再读取每个点的路线；测时不回填训练或修改原轮廓，未知预测与缺测分别单列。",
  "真实模式为同一百度接口的留出点对照，不是现场真值；缓存命中、读取时间和真实请求用量保留。",
  "预测缺少有效网格支持时不计作不可达；比较模型时先看各自有效样本数，当前轮廓与直线圆另列共同样本。",
  "误判表示预测可达但测时超限或未连接；漏判表示预测不在圈内但测时可达。不自动调整模型或换掉不利结果。",
];
const predictionLabel = (p: boolean | null) =>
  p === null ? "资料不足" : p ? "圈内" : "圈外";
export function contourAuditView(audit: ContourAuditResult) {
  const metric = audit.metrics[0];
  return {
    sourceLabel:
      audit.evidence === "simulation"
        ? "构造路网对照 · 非真实社区"
        : "百度留出点对照 · 非现场实测",
    minutes: audit.plan.minutes,
    count: audit.plan.count,
    headline: metric.evaluated
      ? `当前轮廓与测时一致${metric.agreement}/${metric.evaluated}`
      : "本轮没有可比较的有效点",
    metrics: audit.metrics,
    paired: audit.paired,
    usage: audit.usage,
    plannedAt: audit.plannedAt,
    completedAt: audit.completedAt,
    rows: audit.plan.points.map((p, i) => {
      const o = audit.observations[i],
        t = o.travel;
      const actual =
        t.status === "unknown"
          ? null
          : t.status === "ok" && t.seconds <= audit.plan.minutes * 60;
      const verdict =
        t.status === "unknown"
          ? "测时缺失"
          : p.predictions.current === null
            ? "预测资料不足"
            : actual === p.predictions.current
              ? "一致"
              : p.predictions.current
                ? "误判可达"
                : "漏判可达";
      const g = audit.report.center.geo
        ? toGeo(p.point, audit.report.center.geo)
        : null;
      return {
        number: p.number,
        point: p.point,
        coordinates: g
          ? `百度坐标 ${g.lng.toFixed(6)}, ${g.lat.toFixed(6)}`
          : `模拟坐标 ${p.point.join(", ")} 米`,
        current: predictionLabel(p.predictions.current),
        coarse: predictionLabel(p.predictions.coarse),
        circle: predictionLabel(p.predictions.circle),
        observed:
          t.status === "ok"
            ? `${(t.seconds / 60).toFixed(1)}分钟`
            : t.status === "unreachable"
              ? "未能连接"
              : "测时缺失",
        reason: t.status === "ok" ? "" : t.reason,
        verdict,
        readAt: o.readAt,
      };
    }),
  };
}
export function contourAuditSummary(audit: ContourAuditResult) {
  const v = contourAuditView(audit);
  return [
    `一刻烟火 · ${v.minutes}分钟独立抽点复核`,
    v.sourceLabel,
    v.headline,
    ...v.metrics.map(
      (m) =>
        `${m.label}：一致${m.agreement}/${m.evaluated}，误判${m.falseReachable}，漏判${m.missedReachable}，测时缺失${m.observationUnknown}，预测不足${m.predictionUnknown}。`,
    ),
    `共同${v.paired.evaluated}点：当前一致${v.paired.currentAgreement}，直线圆一致${v.paired.circleAgreement}。`,
    ...v.rows.map(
      (r) =>
        `点${r.number}：当前${r.current}，规则网格${r.coarse}，直线圆${r.circle}；读取${r.observed}；${r.verdict}；${r.coordinates}。`,
    ),
    `来源${audit.plan.sourceId}；预测冻结${v.plannedAt}；完成${v.completedAt}；实际路线计数${v.usage.routePairs}、缓存命中${v.usage.cacheHits}。`,
    ...CONTOUR_AUDIT_LIMITS,
  ].join("\n");
}
