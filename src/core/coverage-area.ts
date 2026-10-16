import clip from "polygon-clipping";
import { polygonArea } from "./contours.js";
import { GAP_CATEGORIES, type GapCategory } from "./coverage.js";
import { usableFacility } from "../shared/facility-review.js";
import { searchWindows } from "./search-evidence.js";
import {
  CATEGORIES,
  type AnalysisResult,
  type MultiPolygon,
  type XY,
} from "../shared/types.js";

// Bracket each distance circle instead of labelling its polygon approximation
// as exact. Coordinates are in the report's existing local metre projection.
export const COVERAGE_AREA_VERSION = "distance-brackets-v1";
export const COVERAGE_SIDES = 128;
const PAD = 0.001;
export const AREA_STATES = ["covered", "missing", "unknown"] as const;
export type AreaState = (typeof AREA_STATES)[number];
export const AREA_LABELS = {
  covered: "已找到设施",
  missing: "候选缺口",
  unknown: "待核查",
};
export const AREA_COLORS = {
  covered: "#2f806d",
  missing: "#59666c",
  unknown: "#c38b35",
};
export interface CoverageArea {
  version: string;
  category: GapCategory;
  minutes: number;
  regions: Record<AreaState, MultiPolygon>;
  squareMeters: Record<AreaState, number>;
  totalSquareMeters: number;
  complete: boolean;
  clipped: boolean;
  distanceMeters: number;
  boundaryBandMeters: number;
  searchInsetErrorMeters: number;
  facilitiesConsidered: number;
  facilitiesUsed: number;
  unknownReasons: {
    searchEdge: number;
    incomplete: number;
    distanceBand: number;
  };
}
const intersect = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? (clip.intersection(a, b) as MultiPolygon) : [];
const subtract = (a: MultiPolygon, b: MultiPolygon): MultiPolygon =>
  a.length && b.length ? (clip.difference(a, b) as MultiPolygon) : a;
function circle(center: XY, radius: number): MultiPolygon {
  if (radius <= 0) return [];
  const ring: XY[] = Array.from({ length: COVERAGE_SIDES }, (_, i) => {
    const a = (i * 2 * Math.PI) / COVERAGE_SIDES;
    return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
  });
  ring.push([...ring[0]]);
  return [[ring]];
}
function union(shapes: MultiPolygon[]): MultiPolygon {
  if (!shapes.length) return [];
  // Bound the number of arguments without silently dropping any facility.
  let joined: MultiPolygon = [];
  for (let i = 0; i < shapes.length; i += 24) {
    const batch = shapes.slice(i, i + 24);
    joined = clip.union(
      joined.length ? joined : batch.shift()!,
      ...batch,
    ) as MultiPolygon;
  }
  return joined;
}

// Positive evidence only: a point inside this footprint is within the distance
// threshold. Its complement cannot prove absence near the polygon boundary.
export function positiveCoverageFootprint(
  centers: XY[],
  distanceMeters: number,
): MultiPolygon {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= PAD)
    throw new Error("设施核查距离无效。");
  return union(centers.map((p) => circle(p, distanceMeters - PAD)));
}

export function coverageArea(
  result: AnalysisResult,
  category: GapCategory,
  minutes = result.scenario?.preferences.minutes ?? 15,
): CoverageArea {
  const contour = result.contours.find((c) => c.minutes === minutes);
  const d = result.parameters.gapDistanceMeters;
  const searchRadius = result.parameters.searchRadiusMeters;
  if (
    !GAP_CATEGORIES.includes(category) ||
    !Number.isFinite(d) ||
    d <= PAD ||
    !Number.isFinite(searchRadius) ||
    searchRadius < 0 ||
    !result.center.point.every(Number.isFinite)
  )
    throw new Error("这份报告的核查距离或检索范围无效，请重新导入完整报告。");
  if (!contour)
    throw new Error("当前时长没有可复用的步行范围，请重新选择时长。");
  const domain = contour.polygons;
  const total = polygonArea(domain);
  const cos = Math.cos(Math.PI / COVERAGE_SIDES);
  const innerRadius = d - PAD;
  const outerRadius = (d + PAD) / cos;
  const searchCoreRadius = Math.max(0, searchRadius - d - PAD);
  const output: CoverageArea = {
    version: COVERAGE_AREA_VERSION,
    category,
    minutes,
    regions: { covered: [], missing: [], unknown: [] },
    squareMeters: { covered: 0, missing: 0, unknown: 0 },
    totalSquareMeters: total,
    complete: result.complete[category],
    clipped: contour.clipped,
    distanceMeters: d,
    boundaryBandMeters: outerRadius - innerRadius * cos,
    searchInsetErrorMeters:
      Math.max(0, searchRadius - d) - searchCoreRadius * cos,
    facilitiesConsidered: 0,
    facilitiesUsed: 0,
    unknownReasons: { searchEdge: 0, incomplete: 0, distanceBand: 0 },
  };
  if (!domain.length || total === 0) return output;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const polygon of domain)
    for (const ring of polygon)
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new Error("步行范围坐标无效。");
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  const centers = new Map<string, XY>();
  for (const p of result.facilities.filter(
    (f) => f.category === category && usableFacility(f),
  )) {
    output.facilitiesConsidered++;
    const [x, y] = p.point;
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("设施坐标无效。");
    // The bounding rectangle is only a broad phase; final classification uses
    // polygon intersection, including holes and disconnected components.
    const dx = Math.max(minX - x, 0, x - maxX),
      dy = Math.max(minY - y, 0, y - maxY);
    if (Math.hypot(dx, dy) > outerRadius) continue;
    centers.set(`${x},${y}`, p.point);
  }
  output.facilitiesUsed = centers.size;
  const inner = positiveCoverageFootprint([...centers.values()], d);
  const outer = union([...centers.values()].map((p) => circle(p, outerRadius)));
  const covered = intersect(domain, inner);
  const possible = intersect(domain, outer);
  const unobserved = subtract(domain, possible);
  const windows = searchWindows(result, category);
  const core = (w: (typeof windows)[number]) =>
    circle(w.center, Math.max(0, w.radiusMeters - d - PAD));
  const searchCore = union(windows.map(core));
  const completeCore = union(windows.filter((w) => w.complete).map(core));
  const insideSearch = intersect(unobserved, searchCore);
  const missing = intersect(unobserved, completeCore);
  const unknown = subtract(subtract(domain, covered), missing);
  output.regions = { covered, missing, unknown };
  for (const state of AREA_STATES)
    output.squareMeters[state] = polygonArea(output.regions[state]);
  // A disjoint explanation of the unknown area, not percentages of people.
  output.unknownReasons = {
    distanceBand: polygonArea(subtract(possible, covered)),
    searchEdge: polygonArea(subtract(unobserved, searchCore)),
    incomplete: polygonArea(subtract(insideSearch, missing)),
  };
  return output;
}

export const areaLabel = (squareMeters: number) =>
  squareMeters === 0
    ? "0"
    : squareMeters < 1000
      ? "<0.001"
      : (squareMeters / 1e6).toFixed(3);

// A failed overlay must never leave an old category's grey regions on screen.
export function coverageOverlay(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
) {
  try {
    return coverageArea(result, category, minutes).regions;
  } catch {
    return {
      covered: [],
      missing: [],
      unknown:
        result.contours.find((c) => c.minutes === minutes)?.polygons ?? [],
    };
  }
}

export function coverageAreaView(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
) {
  const value = coverageArea(result, category, minutes);
  let extentX = 1,
    extentY = 1;
  for (const state of AREA_STATES)
    for (const polygon of value.regions[state])
      for (const ring of polygon)
        for (const [x, y] of ring) {
          extentX = Math.max(extentX, Math.abs(x - result.center.point[0]));
          extentY = Math.max(extentY, Math.abs(y - result.center.point[1]));
        }
  const scale = Math.min(140 / extentX, 100 / extentY);
  const plot = ([x, y]: XY) => ({
    x: 160 + (x - result.center.point[0]) * scale,
    y: 120 - (y - result.center.point[1]) * scale,
  });
  return {
    categoryLabel: CATEGORIES.find((c) => c.id === category)!.label,
    minutes,
    distanceMeters: value.distanceMeters,
    totalArea: areaLabel(value.totalSquareMeters),
    empty: value.totalSquareMeters === 0,
    clipped: value.clipped,
    complete: value.complete,
    rows: AREA_STATES.map((state) => ({
      state,
      label: AREA_LABELS[state],
      color: AREA_COLORS[state],
      area: areaLabel(value.squareMeters[state]),
      percent: value.totalSquareMeters
        ? ((100 * value.squareMeters[state]) / value.totalSquareMeters).toFixed(
            1,
          )
        : "0.0",
    })),
    reasons: [
      {
        label: "距离边界保留带",
        area: areaLabel(value.unknownReasons.distanceBand),
      },
      {
        label: "完整核查范围超出检索边界",
        area: areaLabel(value.unknownReasons.searchEdge),
      },
      {
        label: "类别返回结果不完整",
        area: areaLabel(value.unknownReasons.incomplete),
      },
    ],
    boundaryBand: value.boundaryBandMeters.toFixed(3),
    hasHoles: AREA_STATES.some((s) =>
      value.regions[s].some((p) => p.length > 1),
    ),
    sketch: {
      plain: true,
      rings: [],
      places: [],
      bands: AREA_STATES.map((s) => ({
        color: AREA_COLORS[s],
        polygons: value.regions[s].map((p) => p.map((r) => r.map(plot))),
      })),
    },
  };
}
