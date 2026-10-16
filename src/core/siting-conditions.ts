import clip from "polygon-clipping";
import { polygonArea } from "./contours.js";
import { areaLabel, coverageArea } from "./coverage-area.js";
import {
  compareFacilitySites,
  compareSelectedSites,
} from "./facility-siting.js";
import { personalize } from "./personalize.js";
import type { GapCategory } from "./coverage.js";
import { cleanJourney, DEFAULT_JOURNEY } from "../shared/journey.js";
import {
  CATEGORIES,
  type AnalysisResult,
  type MultiPolygon,
  type XY,
} from "../shared/types.js";

export const SITING_CONDITIONS_VERSION = "equal-count-regret-v1";
// Numerical tolerance only; the display scale below is deliberately separate.
const EPS = 0.001;
export const SITING_DISPLAY_AREA = 1000;
export interface SitingConditionInput {
  speedMps: number;
  departure: string;
  waitSeconds: number;
  crossingsPerKm: number;
}
export function sitingConditionDefaults(
  source: AnalysisResult,
): SitingConditionInput {
  const p = source.scenario?.preferences ?? DEFAULT_JOURNEY;
  return {
    speedMps: Math.max(0.3, Math.round(p.speedMps * 75) / 100),
    departure: p.departure,
    waitSeconds: 30,
    crossingsPerKm: 2,
  };
}
const intersect = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? (clip.intersection(a, b) as MultiPolygon) : [];
const subtract = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? (clip.difference(a, b) as MultiPolygon) : a;
const union = (shapes: MultiPolygon[]): MultiPolygon => {
  const nonempty = shapes.filter((s) => s.length);
  return nonempty.length
    ? (clip.union(nonempty[0], ...nonempty.slice(1)) as MultiPolygon)
    : [];
};

export function compareSitingConditions(
  source: AnalysisResult,
  category: GapCategory,
  minutes: number,
  selectedIds: string[],
  input: SitingConditionInput,
) {
  // Re-resolve candidates against the source. Do not trust imported coordinates.
  const original = compareSelectedSites(source, category, minutes, selectedIds);
  const base = cleanJourney({
    ...(source.scenario?.preferences ?? DEFAULT_JOURNEY),
    minutes,
  });
  const changed = cleanJourney({
    ...base,
    speedMps: input?.speedMps,
    departure: input?.departure,
  });
  const waiting = cleanJourney({
    ...changed,
    signals: {
      ...changed.signals,
      enabled: true,
      crossingsPerKm: input?.crossingsPerKm,
      offPeakSeconds: input?.waitSeconds,
      peakSeconds: input?.waitSeconds,
    },
  });
  const conditions = [
    { id: "base", label: "原步速与时段", preferences: base },
    { id: "pace", label: "对照步速与时段", preferences: changed },
    { id: "wait", label: "对照步速＋设定等灯", preferences: waiting },
  ];
  const evaluated = conditions.map((condition) => {
    const report = personalize(source, condition.preferences, {
      id: `siting-condition-${condition.id}`,
      createdAt: source.generatedAt,
    });
    const contour = report.contours.find((c) => c.minutes === minutes)!;
    const comparison = contour.polygons.length
      ? compareFacilitySites(report, category, minutes, original.candidates)
      : null;
    return {
      ...condition,
      report,
      contour,
      comparison,
      baseline: comparison?.baseline ?? coverageArea(report, category, minutes),
    };
  });
  const domain = union(evaluated.map((c) => c.contour.polygons));
  const plans = original.scenarios.map((plan) => {
    const values = evaluated.map((condition) => {
      const current = condition.comparison?.scenarios.find(
        (s) => s.id === plan.id,
      );
      const peers =
        condition.comparison?.scenarios.filter(
          (s) => s.siteCount === plan.siteCount,
        ) ?? [];
      const best = Math.max(0, ...peers.map((s) => s.squareMeters.gapGain));
      const gain = current?.squareMeters.gapGain ?? 0;
      return {
        conditionId: condition.id,
        gainSquareMeters: gain,
        unknownSquareMeters: current?.squareMeters.unknownAssumption ?? 0,
        regretSquareMeters: Math.max(0, best - gain),
        bestGainSquareMeters: best,
        gainRegion: current?.regions.gapGain ?? ([] as MultiPolygon),
      };
    });
    const stable = values
      .slice(1)
      .reduce(
        (shape, value) => intersect(shape, value.gainRegion),
        values[0].gainRegion,
      );
    const variable = subtract(union(values.map((v) => v.gainRegion)), stable);
    return {
      id: plan.id,
      label: plan.label,
      siteCount: plan.siteCount,
      siteIds: plan.siteIds,
      values: values.map(({ gainRegion: _, ...v }) => v),
      worstGainSquareMeters: Math.min(...values.map((v) => v.gainSquareMeters)),
      maxRegretSquareMeters: Math.max(
        ...values.map((v) => v.regretSquareMeters),
      ),
      stableGainSquareMeters: polygonArea(stable),
      variableGainSquareMeters: polygonArea(variable),
      stable,
      variable,
    };
  });
  // No probabilities, weighted votes, or cross-count competition. Duplicate
  // conditions do not gain extra weight in this minimax comparison.
  plans.sort(
    (a, b) =>
      a.siteCount - b.siteCount ||
      a.maxRegretSquareMeters - b.maxRegretSquareMeters ||
      a.id.localeCompare(b.id),
  );
  const groups = [...new Set(plans.map((p) => p.siteCount))].map((count) => {
    const peers = plans.filter((p) => p.siteCount === count);
    const positive = evaluated.map((_, i) =>
      peers
        .filter(
          (p) =>
            p.values[i].bestGainSquareMeters > EPS &&
            p.values[i].regretSquareMeters <= EPS,
        )
        .map((p) => p.id),
    );
    const informative = positive.filter((ids) => ids.length);
    const changedWinner =
      informative.length > 1 &&
      !informative[0].some((id) =>
        informative.every((ids) => ids.includes(id)),
      );
    const hasGain = peers.some((p) =>
      p.values.some((v) => v.gainSquareMeters > EPS),
    );
    return {
      count,
      hasGain,
      changedWinner,
      planIds: peers.map((p) => p.id),
      closeIds:
        hasGain && peers.length > 1
          ? peers
              .filter(
                (p) =>
                  p.maxRegretSquareMeters - peers[0].maxRegretSquareMeters <
                  SITING_DISPLAY_AREA,
              )
              .map((p) => p.id)
          : [],
    };
  });
  return {
    version: SITING_CONDITIONS_VERSION,
    sourceId: source.id,
    sourceGeneratedAt: source.generatedAt,
    baseGeneratedAt: source.baseGeneratedAt ?? source.generatedAt,
    category,
    minutes,
    candidates: original.candidates,
    input: {
      speedMps: changed.speedMps,
      departure: changed.departure,
      waitSeconds: waiting.signals.peakSeconds,
      crossingsPerKm: waiting.signals.crossingsPerKm,
    },
    conditions: evaluated.map((c) => ({
      id: c.id,
      label: c.label,
      preferences: c.preferences,
      domain: c.contour.polygons,
      domainSquareMeters: c.baseline.totalSquareMeters,
      gapSquareMeters: c.baseline.squareMeters.missing,
      unknownSquareMeters: c.baseline.squareMeters.unknown,
      clipped: c.contour.clipped,
    })),
    distinctConditions: new Set(
      conditions.map((c) => JSON.stringify(c.preferences)),
    ).size,
    domain,
    domainSquareMeters: polygonArea(domain),
    plans,
    groups,
  };
}
export type SitingConditions = ReturnType<typeof compareSitingConditions>;

export function sitingConditionsView(
  source: AnalysisResult,
  comparison: SitingConditions,
  selected = comparison.plans[0].id,
) {
  if (
    comparison.sourceId !== source.id ||
    comparison.sourceGeneratedAt !== source.generatedAt
  )
    throw new Error("报告已变化，请重新检查条件。");
  const plan = comparison.plans.find((p) => p.id === selected);
  if (!plan) throw new Error("方案已变化，请重新检查条件。");
  const group = comparison.groups.find((g) => g.count === plan.siteCount)!;
  const label = (id: string) =>
    comparison.plans.find((p) => p.id === id)!.label;
  const headline =
    comparison.distinctConditions === 1
      ? "三组设置相同，请调整条件后再比较"
      : !group.hasGain
        ? "现有资料不足以按缺口收益推荐方案"
        : group.planIds.length === 1
          ? "这个新增数量只有一种组合，暂不能比较优劣"
          : group.closeIds.length > 1
            ? `方案 ${group.closeIds.map(label).join("、")} 的最大落后面积接近`
            : `同样增加${group.count}处，方案 ${label(group.planIds[0])} 的最大落后面积较小`;
  let radiusX = 1,
    radiusY = 1;
  for (const p of [
    ...comparison.domain.flat(2),
    ...comparison.candidates.map((c) => c.point),
  ]) {
    radiusX = Math.max(radiusX, Math.abs(p[0] - source.center.point[0]));
    radiusY = Math.max(radiusY, Math.abs(p[1] - source.center.point[1]));
  }
  const scale = Math.min(140 / radiusX, 100 / radiusY);
  const plot = (p: XY) => ({
    x: 160 + (p[0] - source.center.point[0]) * scale,
    y: 120 - (p[1] - source.center.point[1]) * scale,
  });
  const layers = [
    { color: "#dce4df", polygons: comparison.domain },
    { color: "#c38b35", polygons: plan.variable },
    { color: "#286ca8", polygons: plan.stable },
  ];
  return {
    currentId: plan.id,
    label: plan.label,
    headline,
    sourceLabel:
      source.mode === "demo"
        ? "构造情景 · 非真实社区"
        : "基于已有报告的条件假设 · 未现场验证",
    changedWinner: group.changedWinner,
    distinctConditions: comparison.distinctConditions,
    clipped: comparison.conditions.some((c) => c.clipped),
    emptyConditions: comparison.conditions
      .filter((c) => c.domainSquareMeters <= EPS)
      .map((c) => c.label)
      .join("、"),
    maxRegret: areaLabel(plan.maxRegretSquareMeters),
    worstGain: areaLabel(plan.worstGainSquareMeters),
    stableGain: areaLabel(plan.stableGainSquareMeters),
    variableGain: areaLabel(plan.variableGainSquareMeters),
    worstConditions: plan.values
      .filter(
        (v) =>
          Math.abs(v.regretSquareMeters - plan.maxRegretSquareMeters) <= EPS,
      )
      .map(
        (v) => comparison.conditions.find((c) => c.id === v.conditionId)!.label,
      )
      .join("、"),
    groups: comparison.groups.map((g) => ({
      count: g.count,
      label: `增加${g.count}处`,
      plans: g.planIds.map((id) => ({ id, label: label(id) })),
    })),
    conditions: comparison.conditions.map((c, i) => {
      const s = c.preferences.signals;
      const signals =
        !s.enabled || !s.crossingsPerKm
          ? "不计等灯"
          : s.peakSeconds === s.offPeakSeconds
            ? `假设每公里${s.crossingsPerKm}处，每处等${s.peakSeconds}秒`
            : `沿用原等灯假设：每公里${s.crossingsPerKm}处，峰${s.peakSeconds}/谷${s.offPeakSeconds}秒`;
      return {
        id: c.id,
        label: c.label,
        description: `${c.preferences.speedMps}米/秒 · ${c.preferences.departure}出发 · ${signals}`,
        range: areaLabel(c.domainSquareMeters),
        gap: areaLabel(c.gapSquareMeters),
        unknown: areaLabel(c.unknownSquareMeters),
        gain: areaLabel(plan.values[i].gainSquareMeters),
        regret: areaLabel(plan.values[i].regretSquareMeters),
        unknownGain: areaLabel(plan.values[i].unknownSquareMeters),
        clipped: c.clipped,
      };
    }),
    hasHoles: layers.some((l) => l.polygons.some((p) => p.length > 1)),
    sketch: {
      plain: true,
      rings: [],
      places: comparison.candidates
        .filter((c) => plan.siteIds.includes(c.id))
        .map((c) => ({ ...plot(c.point), label: c.letter })),
      bands: layers.map((l) => ({
        color: l.color,
        polygons: l.polygons.map((p) => p.map((r) => r.map(plot))),
      })),
    },
  };
}

export const SITING_CONDITION_LIMITS = [
  "三种明确假设，不是概率、实时信号或适用于所有人的保证。基础组也按路线距离与原步速重算，不直接使用地图原耗时。",
  "只在所选位置和同一新增数量内比较；最大落后面积取各条件下相对该条件同数量最好方案的差值最大值，不代表全局最优。",
  "三组都补足取空间交集，不用最小面积冒充同一片区域；图底为三组范围并集。各组范围、缺口及未知单独列出，不用不同分母的百分比比较。",
  "设施仍按原报告的直线核查距离计算，步速仅改变从出发点能到达的分析范围；未计算每个居民到店的步行路程或受益人数。",
  "待核查不计收益；未采样区不外推，入口、用地、营业和现场条件需核实。当前报告和私人偏好未被修改。",
];
export function sitingConditionsEvidence(
  source: AnalysisResult,
  comparison: SitingConditions,
) {
  sitingConditionsView(source, comparison);
  return {
    schema: "yike-siting-conditions-v1",
    evidence: source.mode === "demo" ? "simulation" : "api-report-scenarios",
    report: source,
    comparison,
    limitations: SITING_CONDITION_LIMITS,
  };
}
export function sitingConditionsSummary(
  source: AnalysisResult,
  comparison: SitingConditions,
  selected = comparison.plans[0].id,
) {
  const view = sitingConditionsView(source, comparison, selected);
  return [
    `一刻烟火 · ${comparison.minutes}分钟 · ${CATEGORIES.find((c) => c.id === comparison.category)!.label}补点多条件检查`,
    view.sourceLabel,
    view.headline,
    `所选方案 ${view.label}；三组都补足约${view.stableGain}km²；仅部分条件计入约${view.variableGain}km²；最大落后约${view.maxRegret}km²。`,
    ...view.conditions.map(
      (c) =>
        `${c.label}：${c.description}；分析范围${c.range}km²，原缺口${c.gap}km²，待核查${c.unknown}km²；本方案补足${c.gain}km²，落后${c.regret}km²；未知区假设覆盖${c.unknownGain}km²。${c.clipped ? "范围截断。" : ""}`,
    ),
    ...comparison.candidates.map(
      (c) => `${c.letter}：${c.name}（报告局部米坐标${c.point.join(",")}）`,
    ),
    ...SITING_CONDITION_LIMITS,
    `基础记录：${comparison.baseGeneratedAt}；报告：${comparison.sourceGeneratedAt}；${comparison.version}`,
  ].join("\n");
}
