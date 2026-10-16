import clip from "polygon-clipping";
import {
  areaLabel,
  coverageArea,
  positiveCoverageFootprint,
  type CoverageArea,
} from "./coverage-area.js";
import { coveragePoints, type GapCategory } from "./coverage.js";
import { polygonArea } from "./contours.js";
import { pointKey, toGeo } from "./geo.js";
import {
  CATEGORIES,
  type AnalysisResult,
  type MultiPolygon,
  type XY,
} from "../shared/types.js";

export const SITING_VERSION = "conservative-gap-gain-v1";
export const SITING_STATES = [
  "existing",
  "gapGain",
  "unknownAssumption",
  "remainingGap",
  "remainingUnknown",
] as const;
export type SitingState = (typeof SITING_STATES)[number];
export const SITING_LABELS: Record<SitingState, string> = {
  existing: "原有设施覆盖",
  gapGain: "假设补足的原缺口",
  unknownAssumption: "待核查区内的假设覆盖",
  remainingGap: "原缺口未计入补足",
  remainingUnknown: "其余待核查区域",
};
export const SITING_COLORS: Record<SitingState, string> = {
  existing: "#2f806d",
  gapGain: "#286ca8",
  unknownAssumption: "#826b9a",
  remainingGap: "#59666c",
  remainingUnknown: "#c38b35",
};
export interface SitingCandidate {
  id: string;
  name: string;
  point: XY;
}
export interface SitingScenario {
  id: string;
  label: string;
  siteIds: string[];
  siteCount: number;
  regions: Record<SitingState, MultiPolygon>;
  squareMeters: Record<SitingState, number>;
  duplicateGapSquareMeters: number;
}
export interface SitingComparison {
  version: string;
  sourceId: string;
  sourceGeneratedAt: string;
  category: GapCategory;
  minutes: number;
  baseline: CoverageArea;
  candidates: (SitingCandidate & { letter: string })[];
  scenarios: SitingScenario[];
}
const intersection = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? (clip.intersection(a, b) as MultiPolygon) : [];
const difference = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? (clip.difference(a, b) as MultiPolygon) : a;

// A measured point is a reproducible location hypothesis, not a proposed shop
// entrance, available property or planning approval.
export function sitingOptions(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
) {
  const priority = { missing: 0, unknown: 1, covered: 2 };
  return coveragePoints(result, category, minutes)
    .map((p) => {
      const dx = Math.round(p.point[0] - result.center.point[0]);
      const dy = Math.round(p.point[1] - result.center.point[1]);
      const direction = [
        dx ? `${dx < 0 ? "西" : "东"}${Math.abs(dx)}米` : "",
        dy ? `${dy < 0 ? "南" : "北"}${Math.abs(dy)}米` : "",
      ]
        .filter(Boolean)
        .join("、");
      return {
        id: `sample:${pointKey(p.point)}`,
        point: [...p.point] as XY,
        name: `核查点${p.number} · ${direction || "出发点"}`,
        label: `点${p.number} · ${p.label} · ${direction || "出发点"}`,
        status: p.status,
      };
    })
    .sort((a, b) => priority[a.status] - priority[b.status]);
}

export function compareFacilitySites(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
  candidates: SitingCandidate[],
): SitingComparison {
  if (
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > 3
  )
    throw new Error("请选择1至3处候选位置，再比较方案。");
  const ids = new Set<string>(),
    points = new Set<string>();
  for (const c of candidates) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      c.id.length > 120 ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 120 ||
      !Array.isArray(c.point) ||
      c.point.length !== 2 ||
      !c.point.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6)
    )
      throw new Error("候选位置无效，请重新选择核查点。");
    const key = pointKey(c.point);
    if (ids.has(c.id) || points.has(key))
      throw new Error("候选位置重复，请选择不同的核查点。");
    ids.add(c.id);
    points.add(key);
  }
  const baseline = coverageArea(result, category, minutes);
  if (!baseline.totalSquareMeters)
    throw new Error("当前时长没有可比较的范围，请先选择有轮廓的时长。");
  const sites = candidates.map((c, i) => ({
    id: c.id,
    name: c.name.trim(),
    point: [...c.point] as XY,
    letter: String.fromCharCode(65 + i),
  }));
  const singleFootprints = sites.map((s) =>
    positiveCoverageFootprint([s.point], baseline.distanceMeters),
  );
  const singleGains = singleFootprints.map((shape) =>
    polygonArea(intersection(baseline.regions.missing, shape)),
  );
  const scenarios: SitingScenario[] = [];
  for (let mask = 1; mask < 1 << sites.length; mask++) {
    const indexes = sites.map((_, i) => i).filter((i) => mask & (1 << i));
    const shapes = indexes.map((i) => singleFootprints[i]);
    const footprint =
      shapes.length === 1
        ? shapes[0]
        : (clip.union(shapes[0], ...shapes.slice(1)) as MultiPolygon);
    const regions: Record<SitingState, MultiPolygon> = {
      existing: baseline.regions.covered,
      gapGain: intersection(baseline.regions.missing, footprint),
      unknownAssumption: intersection(baseline.regions.unknown, footprint),
      // Keep the conservative distance band here. The label deliberately does
      // not assert that a hypothetical facility fails to cover every point.
      remainingGap: difference(baseline.regions.missing, footprint),
      remainingUnknown: difference(baseline.regions.unknown, footprint),
    };
    const squareMeters = Object.fromEntries(
      SITING_STATES.map((state) => [state, polygonArea(regions[state])]),
    ) as Record<SitingState, number>;
    const letters = indexes.map((i) => sites[i].letter);
    scenarios.push({
      id: letters.join(""),
      label: letters.join(" + "),
      siteIds: indexes.map((i) => sites[i].id),
      siteCount: indexes.length,
      regions,
      squareMeters,
      duplicateGapSquareMeters: Math.max(
        0,
        indexes.reduce((sum, i) => sum + singleGains[i], 0) -
          squareMeters.gapGain,
      ),
    });
  }
  // Compare only equal-size plans; never rank three facilities against one as
  // though they had the same resource cost. Unknown evidence is not a gain.
  scenarios.sort(
    (a, b) =>
      a.siteCount - b.siteCount ||
      b.squareMeters.gapGain - a.squareMeters.gapGain ||
      a.id.localeCompare(b.id),
  );
  return {
    version: SITING_VERSION,
    sourceId: result.id,
    sourceGeneratedAt: result.generatedAt,
    category,
    minutes,
    baseline,
    candidates: sites,
    scenarios,
  };
}

export function compareSelectedSites(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
  selectedIds: string[],
) {
  const available = sitingOptions(result, category, minutes);
  const candidates = selectedIds.filter(Boolean).map((id) => {
    const site = available.find((p) => p.id === id);
    if (!site) throw new Error("候选位置已不在当前报告或时长内，请重新选择。");
    return { id: site.id, name: site.name, point: site.point };
  });
  return compareFacilitySites(result, category, minutes, candidates);
}

export function sitingView(
  result: AnalysisResult,
  comparison: SitingComparison,
  selected = comparison.scenarios[0].id,
  before = false,
) {
  const current = comparison.scenarios.find((s) => s.id === selected);
  if (!current) throw new Error("所选方案已变化，请重新比较。");
  const base = comparison.baseline;
  const domain = result.contours.find(
    (c) => c.minutes === comparison.minutes,
  )!.polygons;
  let extentX = 1,
    extentY = 1;
  const coordinates = [
    ...domain.flat(2),
    ...comparison.candidates.map((c) => c.point),
  ];
  for (const [x, y] of coordinates) {
    extentX = Math.max(extentX, Math.abs(x - result.center.point[0]));
    extentY = Math.max(extentY, Math.abs(y - result.center.point[1]));
  }
  const scale = Math.min(140 / extentX, 100 / extentY);
  const plot = ([x, y]: XY) => ({
    x: 160 + (x - result.center.point[0]) * scale,
    y: 120 - (y - result.center.point[1]) * scale,
  });
  const regions = before
    ? {
        existing: base.regions.covered,
        gapGain: [],
        unknownAssumption: [],
        remainingGap: base.regions.missing,
        remainingUnknown: base.regions.unknown,
      }
    : current.regions;
  return {
    title: before ? "补点前" : `假设补点后 · ${current.label}`,
    currentId: current.id,
    categoryLabel: CATEGORIES.find((c) => c.id === comparison.category)!.label,
    minutes: comparison.minutes,
    distanceMeters: base.distanceMeters,
    totalArea: areaLabel(base.totalSquareMeters),
    baselineGap: areaLabel(base.squareMeters.missing),
    baselineUnknown: areaLabel(base.squareMeters.unknown),
    noProvenGap: base.squareMeters.missing === 0,
    clipped: base.clipped,
    before,
    groups: [1, 2, 3]
      .filter((count) => count <= comparison.candidates.length)
      .map((count) => ({
        count,
        label: ["", "只增加一处", "增加两处", "增加三处"][count],
        plans: comparison.scenarios
          .filter((s) => s.siteCount === count)
          .map((s) => ({
            id: s.id,
            label: s.label,
            gapGain: areaLabel(s.squareMeters.gapGain),
            unknownAssumption: areaLabel(s.squareMeters.unknownAssumption),
            remainingGap: areaLabel(s.squareMeters.remainingGap),
          })),
      })),
    rows: SITING_STATES.map((state) => ({
      state,
      label: SITING_LABELS[state],
      color: SITING_COLORS[state],
      area: areaLabel(polygonArea(regions[state])),
    })),
    duplicateGap: areaLabel(current.duplicateGapSquareMeters),
    candidates: comparison.candidates.map((c) => ({
      ...c,
      coordinates:
        result.mode === "baidu" && result.center.geo
          ? (() => {
              const p = toGeo(c.point, result.center.geo!);
              return `百度坐标 ${p.lng.toFixed(6)}, ${p.lat.toFixed(6)}`;
            })()
          : `模拟坐标 ${c.point[0]}, ${c.point[1]} 米`,
    })),
    hasHoles: SITING_STATES.some((s) => regions[s].some((p) => p.length > 1)),
    sketch: {
      plain: true,
      rings: [],
      places: before
        ? []
        : comparison.candidates
            .filter((c) => current.siteIds.includes(c.id))
            .map((c) => ({ ...plot(c.point), label: c.letter })),
      bands: SITING_STATES.map((state) => ({
        color: SITING_COLORS[state],
        polygons: regions[state].map((p) => p.map((r) => r.map(plot))),
      })),
    },
  };
}

export function sitingEvidence(
  result: AnalysisResult,
  comparison: SitingComparison,
) {
  return {
    schema: "yike-facility-siting-v1",
    coordinateSystem: "report-local-meters",
    evidence: result.mode === "demo" ? "simulation" : "api-and-user-review",
    hypothesisOnly: true,
    report: result,
    comparison,
    limitations: [
      "候选位置仅为测时点上的规划假设，不代表真实开店、入口可用、用地许可或最优选址。",
      "只将原候选缺口中的保守覆盖计入补足；待核查区域内的假设覆盖单列，不当作已证实缺口。",
      "距离圆边界不计入确定补足；剩余原缺口不是对假设新增设施的精确不可覆盖断言。",
      "面积不是受益人数或到店步行距离。原报告及公共设施未被改变。",
    ],
  };
}

export function sitingSummary(
  result: AnalysisResult,
  comparison: SitingComparison,
) {
  return [
    `一刻烟火 · ${comparison.minutes}分钟范围 · ${CATEGORIES.find((c) => c.id === comparison.category)!.label}补点方案`,
    result.mode === "demo"
      ? "构造演示，不代表真实社区。"
      : "百度API及已有核查记录，未现场验证。",
    "规划假设：候选测时点未核实入口或用地。按相同新增数量比较，不代表最优选址。",
    `直线核查距离${comparison.baseline.distanceMeters}米；原候选缺口约${areaLabel(comparison.baseline.squareMeters.missing)}km²。`,
    ...sitingView(result, comparison).candidates.map(
      (s) => `${s.letter}：${s.name}（${s.coordinates}）`,
    ),
    ...comparison.scenarios.map(
      (s) =>
        `${s.label}：假设补足原缺口约${areaLabel(s.squareMeters.gapGain)}km²；待核查区假设覆盖约${areaLabel(s.squareMeters.unknownAssumption)}km²；原缺口未计入补足约${areaLabel(s.squareMeters.remainingGap)}km²。`,
    ),
    "组合方案已扣除重复覆盖。待核查区的假设覆盖不计入缺口改善；面积不代表受益人数或到店步行距离。",
    `原始报告：${result.generatedAt}；${comparison.version}`,
  ].join("\n");
}
