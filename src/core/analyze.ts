import { randomUUID } from "node:crypto";
import { contoursFromTriangles, polygonArea } from "./contours.js";
import { pointKey } from "./geo.js";
import { adaptiveMesh, MESH_VERSION } from "./mesh.js";
import { deduplicate, findGaps } from "./facilities.js";
import type {
  AnalysisResult,
  Center,
  Progress,
  Provider,
  Sample,
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
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(step) ||
    radius <= 0 ||
    step <= 0 ||
    (radius / step) % 1 !== 0 ||
    radius / step > 20 ||
    !Number.isInteger(maxRefinement) ||
    maxRefinement < 0 ||
    maxRefinement > 500
  )
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
    return points.map((p) => samples.get(pointKey(p))!);
  };
  const mesh = await adaptiveMesh(
    center.point,
    radius,
    step,
    maxRefinement,
    query,
  );
  const get = (p: XY) => samples.get(pointKey(p))!;
  const triangles = mesh.triangles;
  await query(
    facilities.map((p) => p.point),
    "核对设施步行时间",
  );
  facilities.forEach((p) => {
    p.travel = get(p.point).travel;
  });
  const gridSamples = mesh.samples;
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
  if (mesh.limited)
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
      refinedStepMeters: step / 2 ** mesh.passes,
      refinementPoints: mesh.additions,
      meshVersion: MESH_VERSION,
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
