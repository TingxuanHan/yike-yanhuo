import clipping from "polygon-clipping";
import { personalize } from "./personalize.js";
import { polygonArea } from "./contours.js";
import { usableFacility } from "../shared/facility-review.js";
import { cleanJourney, DEFAULT_JOURNEY } from "../shared/journey.js";
import {
  CATEGORIES,
  type AnalysisResult,
  type MultiPolygon,
  type XY,
} from "../shared/types.js";

export interface ComparisonInput {
  minutes: number;
  speedMps: number;
  waiting: "same" | "fixed";
  waitSeconds: number;
  crossingsPerKm: number;
}
export function comparisonDefaults(
  source: AnalysisResult,
  minutes: number,
): ComparisonInput {
  const speed =
    source.scenario?.preferences.speedMps ?? DEFAULT_JOURNEY.speedMps;
  return {
    minutes,
    speedMps: Math.max(0.3, Math.round(speed * 0.75 * 100) / 100),
    waiting: "same",
    waitSeconds: 30,
    crossingsPerKm: 2,
  };
}

export function compareJourneys(
  source: AnalysisResult,
  input: ComparisonInput,
) {
  if (!input || !["same", "fixed"].includes(input.waiting))
    throw new Error("请选择有效的等灯比较方式。");
  if (
    !Number.isFinite(input.waitSeconds) ||
    input.waitSeconds < 0 ||
    input.waitSeconds > 300 ||
    !Number.isFinite(input.crossingsPerKm) ||
    input.crossingsPerKm < 0 ||
    input.crossingsPerKm > 10
  )
    throw new Error("等灯时长须为0—300秒，每公里假设路口数须为0—10。");
  const baselinePrefs = cleanJourney({
    ...(source.scenario?.preferences ?? DEFAULT_JOURNEY),
    minutes: input.minutes,
  });
  const candidatePrefs = cleanJourney({
    ...baselinePrefs,
    speedMps: input.speedMps,
    signals:
      input.waiting === "same"
        ? baselinePrefs.signals
        : {
            ...baselinePrefs.signals,
            enabled: true,
            crossingsPerKm: input.crossingsPerKm,
            offPeakSeconds: input.waitSeconds,
            peakSeconds: input.waitSeconds,
          },
  });
  const make = (prefs: typeof baselinePrefs, suffix: string) =>
    personalize(source, prefs, {
      id: `comparison-${suffix}`,
      createdAt: source.generatedAt,
    });
  const baseline = make(baselinePrefs, "base"),
    candidate = make(candidatePrefs, "candidate");
  const a = baseline.contours.find((c) => c.minutes === input.minutes)!;
  const b = candidate.contours.find((c) => c.minutes === input.minutes)!;
  const common =
    a.polygons.length && b.polygons.length
      ? (clipping.intersection(a.polygons, b.polygons) as MultiPolygon)
      : [];
  const lost = !a.polygons.length
    ? []
    : b.polygons.length
      ? (clipping.difference(a.polygons, b.polygons) as MultiPolygon)
      : a.polygons;
  const gained = !b.polygons.length
    ? []
    : a.polygons.length
      ? (clipping.difference(b.polygons, a.polygons) as MultiPolygon)
      : b.polygons;
  const nextById = new Map(candidate.facilities.map((f) => [f.id, f]));
  const facilities = baseline.facilities.map((f) => {
    const next = nextById.get(f.id)!;
    const beforeSeconds = f.travel?.status === "ok" ? f.travel.seconds : null;
    const afterSeconds =
      next.travel?.status === "ok" ? next.travel.seconds : null;
    const before =
      beforeSeconds !== null && beforeSeconds <= input.minutes * 60;
    const after = afterSeconds !== null && afterSeconds <= input.minutes * 60;
    const change = !usableFacility(f)
      ? "excluded"
      : beforeSeconds === null || afterSeconds === null
        ? "unknown"
        : before && after
          ? "kept"
          : before
            ? "lost"
            : after
              ? "gained"
              : "outside";
    return {
      id: f.id,
      name: f.name,
      category: f.category,
      categoryLabel: CATEGORIES.find((c) => c.id === f.category)!.label,
      beforeSeconds,
      afterSeconds,
      change,
    };
  });
  const count = (change: string) =>
    facilities.filter((f) => f.change === change).length;
  const counts = {
    kept: count("kept"),
    lost: count("lost"),
    gained: count("gained"),
    unknown: count("unknown"),
    excluded: count("excluded"),
  };
  const layers = [
    {
      kind: "common",
      label: "两种条件都可达",
      color: "#6f9487",
      polygons: common,
    },
    { kind: "lost", label: "对比后超出时长", color: "#c46136", polygons: lost },
    {
      kind: "gained",
      label: "对比后新增可达",
      color: "#226f9c",
      polygons: gained,
    },
  ];
  const points = [...a.polygons, ...b.polygons].flat(2);
  const radius = points.reduce(
    (max, p) =>
      Math.max(
        max,
        Math.abs(p[0] - source.center.point[0]),
        Math.abs(p[1] - source.center.point[1]),
      ),
    80,
  );
  const plot = (p: XY) => ({
    x: 160 + ((p[0] - source.center.point[0]) * 100) / radius,
    y: 120 - ((p[1] - source.center.point[1]) * 100) / radius,
  });
  return {
    sourceId: source.id,
    generatedAt: source.generatedAt,
    mode: source.mode,
    centerLabel: source.center.label,
    minutes: input.minutes,
    baselinePrefs,
    candidatePrefs,
    counts,
    facilities,
    layers,
    baseline: {
      areaKm2: a.areaKm2,
      count: counts.kept + counts.lost,
      clipped: a.clipped,
    },
    candidate: {
      areaKm2: b.areaKm2,
      count: counts.kept + counts.gained,
      clipped: b.clipped,
    },
    lostAreaKm2: polygonArea(lost) / 1e6,
    gainedAreaKm2: polygonArea(gained) / 1e6,
    unknownSamples: source.samples.filter((s) => s.travel.status !== "ok")
      .length,
    incompleteSearch: Object.values(source.complete).some((v) => !v),
    sketch: {
      plain: true,
      rings: [],
      places: [],
      bands: layers.map((l) => ({
        color: l.color,
        polygons: l.polygons.map((p) => p.map((r) => r.map(plot))),
      })),
    },
  };
}
export type JourneyComparison = ReturnType<typeof compareJourneys>;
