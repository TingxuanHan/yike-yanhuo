import { randomUUID } from "node:crypto";
import {
  contoursFromTriangles,
  crossesThreshold,
  polygonArea,
} from "./contours.js";
import { distance, midpoint, pointKey } from "./geo.js";
import { deduplicate, findGaps } from "./facilities.js";
import type {
  AnalysisResult,
  Center,
  Progress,
  Provider,
  Sample,
  Triangle,
  XY,
} from "../shared/types.js";

export interface AnalysisOptions {
  radius?: number;
  step?: number;
  maxRefinement?: number;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}
export async function analyze(
  provider: Provider,
  center: Center,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const started = performance.now();
  const radius = options.radius ?? 1600;
  const step = options.step ?? 400;
  const maxRefinement = options.maxRefinement ?? 96;
  if (radius <= 0 || step <= 0 || (radius / step) % 1 !== 0)
    throw new Error("采样范围与间距不匹配");
  const progress = (stage: string, done: number, total: number) =>
    options.onProgress?.({ stage, done, total });
  const searchRadius = Math.ceil(Math.SQRT2 * radius + 1000);
  progress("查找周边设施", 0, 1);
  options.signal?.throwIfAborted();
  const search = await provider.search(
    center.point,
    searchRadius,
    options.signal,
  );
  const facilities = deduplicate(search.facilities);
  const samples = new Map<string, Sample>();
  const query = async (points: XY[], stage: string) => {
    const pending = [
      ...new Map(
        points
          .filter((p) => !samples.has(pointKey(p)))
          .map((p) => [pointKey(p), p]),
      ).values(),
    ];
    for (let i = 0; i < pending.length; i += 12) {
      options.signal?.throwIfAborted();
      progress(stage, i, pending.length);
      const batch = pending.slice(i, i + 12);
      const values = await provider.route(center.point, batch, options.signal);
      batch.forEach((point, j) =>
        samples.set(pointKey(point), {
          point,
          travel: values[j] ?? { status: "unknown", reason: "测时结果缺失" },
        }),
      );
    }
    progress(stage, pending.length, pending.length);
  };
  const points: XY[] = [];
  for (let x = -radius; x <= radius; x += step)
    for (let y = -radius; y <= radius; y += step)
      points.push([center.point[0] + x, center.point[1] + y]);
  await query(points, "测量步行时间");
  const get = (p: XY) => samples.get(pointKey(p))!;
  const base: Triangle[] = [];
  for (let x = -radius; x < radius; x += step)
    for (let y = -radius; y < radius; y += step) {
      const a: XY = [center.point[0] + x, center.point[1] + y];
      const b: XY = [a[0] + step, a[1]];
      const c: XY = [a[0] + step, a[1] + step];
      const d: XY = [a[0], a[1] + step];
      base.push([get(a), get(b), get(c)], [get(a), get(c), get(d)]);
    }
  const refine = new Set<Triangle>();
  const additions = new Map<string, XY>();
  const candidates = base
    .filter(crossesThreshold)
    .sort(
      (a, b) =>
        distance(a[0].point, center.point) - distance(b[0].point, center.point),
    );
  for (const triangle of candidates) {
    const mids = triangle.map((p, i) =>
      midpoint(p.point, triangle[(i + 1) % 3].point),
    );
    const missing = mids.filter(
      (p) => !samples.has(pointKey(p)) && !additions.has(pointKey(p)),
    );
    if (additions.size + missing.length > maxRefinement) continue;
    missing.forEach((p) => additions.set(pointKey(p), p));
    refine.add(triangle);
  }
  await query([...additions.values()], "细化可达范围");
  const triangles = base.flatMap((t): Triangle[] => {
    if (!refine.has(t)) return [t];
    const [a, b, c] = t;
    const ab = get(midpoint(a.point, b.point));
    const bc = get(midpoint(b.point, c.point));
    const ca = get(midpoint(c.point, a.point));
    return [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
      [ab, bc, ca],
    ];
  });
  await query(
    facilities.map((p) => p.point),
    "核对设施步行时间",
  );
  facilities.forEach((p) => {
    p.travel = get(p.point).travel;
  });
  const gridSamples = [...samples.values()].filter(
    (p) =>
      points.some((q) => pointKey(q) === pointKey(p.point)) ||
      additions.has(pointKey(p.point)),
  );
  const contours = ([5, 10, 15] as const).map((minutes) => {
    const polygons = contoursFromTriangles(triangles, minutes * 60);
    const clipped = gridSamples.some(
      (s) =>
        (Math.abs(s.point[0] - center.point[0]) === radius ||
          Math.abs(s.point[1] - center.point[1]) === radius) &&
        s.travel.status === "ok" &&
        s.travel.seconds <= minutes * 60,
    );
    return { minutes, polygons, areaKm2: polygonArea(polygons) / 1e6, clipped };
  });
  const skippedTriangles = triangles.filter((t) =>
    t.some((s) => s.travel.status !== "ok"),
  ).length;
  const knownSamples = gridSamples.filter(
    (s) => s.travel.status === "ok",
  ).length;
  const warnings = [
    ...search.warnings,
    "可达范围由有限测时点插值，跨河、围墙与出入口附近仍需逐点核验。",
  ];
  if (provider.mode === "demo")
    warnings.unshift(
      "本报告采用人工构造的道路与设施，不代表上海四平路街道的实际情况。",
    );
  if (knownSamples < gridSamples.length)
    warnings.push(
      "部分采样点未获得有效步行时间，对应区域留空，不能解释为没有道路。",
    );
  if (contours.some((c) => c.clipped))
    warnings.push("可达范围触及采样边界，面积可能低估，需扩大采样范围复核。");
  if (refine.size < candidates.length)
    warnings.push("部分边界仍采用较粗采样，未超过本次加密预算。");
  progress("生成体检报告", 1, 1);
  return {
    schemaVersion: 1,
    id: randomUUID(),
    mode: provider.mode,
    generatedAt: new Date().toISOString(),
    center,
    contours,
    samples: gridSamples,
    facilities,
    complete: search.complete,
    gaps: findGaps(
      gridSamples
        .filter((s) => s.travel.status === "ok" && s.travel.seconds <= 900)
        .map((s) => s.point),
      center.point,
      facilities,
      search.complete,
      search.radiusMeters,
    ),
    warnings,
    usage: { ...provider.usage },
    elapsedMs: Math.round(performance.now() - started),
    parameters: {
      radiusMeters: radius,
      coarseStepMeters: step,
      refinedStepMeters: step / 2,
      refinementPoints: additions.size,
      searchRadiusMeters: search.radiusMeters,
      gapDistanceMeters: 1000,
      gapDistanceDefinition:
        "局部平面直线距离，非步行距离；仅检查15分钟可达采样点",
    },
    quality: {
      knownSamples,
      totalSamples: gridSamples.length,
      unknownFacilities: facilities.filter((p) => p.travel?.status !== "ok")
        .length,
      skippedTriangles,
    },
  };
}
