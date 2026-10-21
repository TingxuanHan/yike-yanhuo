import { distance, pointKey, toGeo } from "./geo.js";
import { DEFAULT_JOURNEY } from "../shared/journey.js";
import { usableFacility } from "../shared/facility-review.js";
import type { AnalysisResult, Travel, XY } from "../shared/types.js";

export const DETOUR_VERSION = "observed-distance-diagnostic-v1";
// Review triggers, not confidence levels or evidence of a particular barrier.
export const DETOUR_THRESHOLDS = {
  minimumDirectMeters: 80,
  extraMeters: 200,
  ratio: 1.5,
};
export function detourAudit(result: AnalysisResult, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 30)
    throw new Error("请选择5—30分钟的核查时长。");
  const speed =
    result.scenario?.preferences.speedMps ?? DEFAULT_JOURNEY.speedMps;
  const byPoint = new Map<
    string,
    { point: XY; names: string[]; records: (Travel | undefined)[] }
  >();
  const add = (point: XY, name: string, travel?: Travel) => {
    const key = pointKey(point),
      row = byPoint.get(key) ?? {
        point: [...point] as XY,
        names: [],
        records: [],
      };
    row.names.push(name);
    row.records.push(travel);
    byPoint.set(key, row);
  };
  // Prefer a familiar facility name; co-located observations remain auditable.
  for (const f of result.facilities.filter(usableFacility))
    add(f.point, f.name, f.travel);
  result.samples.forEach((s, i) => add(s.point, `测时点${i + 1}`, s.travel));
  let nearPoints = 0,
    knownPoints = 0,
    unknownPoints = 0,
    unreachablePoints = 0,
    conflictPoints = 0,
    inconsistentPoints = 0,
    excludedNearOrigin = 0,
    timeExceeded = 0;
  const rows: {
    id: string;
    name: string;
    point: XY;
    straightMeters: number;
    routeMeters: number;
    extraMeters: number;
    ratio: number;
    seconds: number;
    outsideTime: boolean;
    recordCount: number;
  }[] = [];
  for (const [key, p] of byPoint) {
    const straight = distance(result.center.point, p.point);
    if (straight / speed > minutes * 60) continue;
    if (straight < DETOUR_THRESHOLDS.minimumDirectMeters) {
      excludedNearOrigin++;
      continue;
    }
    nearPoints++;
    const known = p.records.filter(
      (t): t is Extract<Travel, { status: "ok" }> => t?.status === "ok",
    );
    const unreachable = p.records.some((t) => t?.status === "unreachable");
    if (!known.length) {
      if (unreachable) unreachablePoints++;
      else unknownPoints++;
      continue;
    }
    const first = known[0];
    if (
      unreachable ||
      known.some(
        (t) =>
          Math.abs(t.meters - first.meters) >
            Math.max(20, first.meters * 0.02) ||
          Math.abs(t.seconds - first.seconds) >
            Math.max(30, first.seconds * 0.02),
      )
    ) {
      conflictPoints++;
      continue;
    }
    if (
      !Number.isFinite(first.meters) ||
      !Number.isFinite(first.seconds) ||
      first.meters + 20 < straight ||
      first.seconds < 0
    ) {
      inconsistentPoints++;
      continue;
    }
    knownPoints++;
    if (first.seconds > minutes * 60) timeExceeded++;
    const extra = first.meters - straight,
      ratio = first.meters / straight;
    if (
      extra >= DETOUR_THRESHOLDS.extraMeters &&
      ratio >= DETOUR_THRESHOLDS.ratio
    )
      rows.push({
        id: key,
        name: p.names[0],
        point: p.point,
        straightMeters: straight,
        routeMeters: first.meters,
        extraMeters: extra,
        ratio,
        seconds: first.seconds,
        outsideTime: first.seconds > minutes * 60,
        recordCount: p.records.length,
      });
  }
  rows.sort(
    (a, b) =>
      b.extraMeters - a.extraMeters ||
      b.ratio - a.ratio ||
      a.id.localeCompare(b.id),
  );
  return {
    version: DETOUR_VERSION,
    sourceId: result.id,
    sourceGeneratedAt: result.generatedAt,
    baseGeneratedAt: result.baseGeneratedAt ?? result.generatedAt,
    minutes,
    speedMps: speed,
    straightComparisonMeters: speed * minutes * 60,
    thresholds: DETOUR_THRESHOLDS,
    counts: {
      nearPoints,
      knownPoints,
      unknownPoints,
      unreachablePoints,
      conflictPoints,
      inconsistentPoints,
      excludedNearOrigin,
      timeExceeded,
    },
    hotspots: rows,
  };
}
export function detourView(result: AnalysisResult, minutes: number) {
  const audit = detourAudit(result, minutes);
  return {
    ...audit.counts,
    count: audit.hotspots.length,
    headline: audit.hotspots.length
      ? `发现${audit.hotspots.length}处明显绕行的核查线索`
      : "现有已测点中未发现符合条件的绕行线索",
    sourceLabel:
      result.mode === "demo"
        ? "构造路网 · 非真实社区"
        : "已有百度路线记录 · 原因待现场核查",
    timeLabel: result.scenario
      ? "用时沿用当前个人试算"
      : result.mode === "demo"
        ? "用时来自构造路网"
        : "用时来自报告中的地图测时",
    minutes,
    speedMps: audit.speedMps,
    directRadius: Math.round(audit.straightComparisonMeters),
    baseGeneratedAt: audit.baseGeneratedAt,
    rows: audit.hotspots.slice(0, 8).map((r, i) => ({
      ...r,
      number: i + 1,
      direct: Math.round(r.straightMeters),
      route: Math.round(r.routeMeters),
      extra: Math.round(r.extraMeters),
      ratioLabel: r.ratio.toFixed(1),
      time: (r.seconds / 60).toFixed(1),
      coordinates:
        result.mode === "baidu" && result.center.geo
          ? (() => {
              const g = toGeo(r.point, result.center.geo!);
              return `百度坐标 ${g.lng.toFixed(6)}, ${g.lat.toFixed(6)}`;
            })()
          : `模拟坐标 ${r.point.join(", ")} 米`,
    })),
  };
}
export const DETOUR_LIMITS = [
  "只核对已有点：以当前步速、不计等灯的直线距离圈作为对照筛选，不把它当作路网等时圈。点数不表示面积、人口或社区发生率。",
  "线索门槛为直线至少80米、路线至少多200米且达到直线1.5倍；这是现场核查优先级，未按真实障碍标注校准。",
  "同坐标重复记录合并；明显距离或用时分歧、无法连接与缺测分别保留，不判作绕行。缺测点不参与已测用时比较。",
  "没有路线形状、围挡或入口证据，不能由绕行倍数推断障碍原因、具体位置或可用捷径。核查时应确认道路连通、过街设施与入口。",
  "原路线长度和时间来自报告，可能受地图起终点吸附、入口、坐标及数据时间影响。不会补造道路、修改报告或自动绕路。",
];
export function detourEvidence(result: AnalysisResult, minutes: number) {
  return {
    schema: "yike-detour-audit-v1",
    evidence: result.mode === "demo" ? "simulation" : "api-report-diagnostic",
    report: result,
    audit: detourAudit(result, minutes),
    limitations: DETOUR_LIMITS,
  };
}
export function detourSummary(result: AnalysisResult, minutes: number) {
  const view = detourView(result, minutes);
  return [
    `一刻烟火 · ${minutes}分钟绕行核查`,
    view.sourceLabel,
    view.headline,
    `按${view.speedMps}米/秒、不计等灯的直线对照范围约${view.directRadius}米。去重后${view.knownPoints}处已有有效测时，${view.timeExceeded}处超出所选时长。`,
    `缺测${view.unknownPoints}处；未能连接${view.unreachablePoints}处；记录分歧${view.conflictPoints}处；距离异常${view.inconsistentPoints}处。`,
    ...view.rows.map(
      (r) =>
        `${r.number}. ${r.name}：直线${r.direct}米，路线${r.route}米，多走${r.extra}米（${r.ratioLabel}倍）；约${r.time}分钟；${r.coordinates}。`,
    ),
    view.timeLabel,
    `仅列前8处；基础记录${view.baseGeneratedAt}。`,
    ...DETOUR_LIMITS,
  ].join("\n");
}
