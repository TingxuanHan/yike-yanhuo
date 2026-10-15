import {
  CATEGORIES,
  type AnalysisResult,
  type XY,
  type Travel,
} from "./types.js";
import { cleanEvidence } from "./facility-review.js";
import { reconcileEvidence } from "../core/poi-evidence.js";
import { cleanJourney, journeyBands } from "./journey.js";
import { utf8Bytes } from "./life.js";

export const MAX_RESULT_BYTES = 2_000_000;
const categories = new Set(CATEGORIES.map((c) => c.id));
const object = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value: unknown, max = 1e8): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;
const point = (value: unknown): value is XY =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((v) => finite(v, 100_000));
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const list = (value: unknown, max: number): value is any[] =>
  Array.isArray(value) && value.length <= max;
function travel(value: unknown): value is Travel {
  return (
    object(value) &&
    (value.status === "ok"
      ? finite(value.seconds) &&
        value.seconds >= 0 &&
        finite(value.meters) &&
        value.meters >= 0 &&
        (value.recordedSeconds === undefined ||
          (finite(value.recordedSeconds) && value.recordedSeconds >= 0))
      : ["unknown", "unreachable"].includes(value.status) &&
        text(value.reason, 300))
  );
}
const fail = (): never => {
  throw new Error("这不是有效的体检结果文件，请选择本项目导出的 JSON。");
};

// Validate every field used for rendering, cap geometry, and discard foreign fields.
export function parseResultFile(raw: string): AnalysisResult {
  if (utf8Bytes(raw) > MAX_RESULT_BYTES)
    throw new Error("结果文件超过2MB，请选择单份体检结果。");
  let r: any;
  try {
    r = JSON.parse(raw);
  } catch {
    return fail();
  }
  if (
    !object(r) ||
    r.schemaVersion !== 1 ||
    !["demo", "baidu"].includes(r.mode) ||
    !text(r.id, 100) ||
    !r.id ||
    !text(r.generatedAt, 50) ||
    !Number.isFinite(Date.parse(r.generatedAt)) ||
    !object(r.center) ||
    !text(r.center.label, 200) ||
    !point(r.center.point)
  )
    return fail();
  if (
    r.mode === "baidu" &&
    (!object(r.center.geo) ||
      !finite(r.center.geo.lng, 180) ||
      !finite(r.center.geo.lat, 90))
  )
    return fail();
  let vertices = 0;
  let scenario: AnalysisResult["scenario"];
  if (r.scenario !== undefined) {
    if (
      !object(r.scenario) ||
      !text(r.scenario.sourceId, 100) ||
      !text(r.scenario.createdAt, 50) ||
      !Number.isFinite(Date.parse(r.scenario.createdAt))
    )
      return fail();
    scenario = {
      preferences: cleanJourney(r.scenario.preferences),
      sourceId: r.scenario.sourceId,
      createdAt: r.scenario.createdAt,
    };
  }
  const bands = scenario
    ? journeyBands(scenario.preferences.minutes)
    : [5, 10, 15];
  if (
    !list(r.contours, 3) ||
    r.contours.length !== bands.length ||
    new Set(r.contours.map((c: any) => c?.minutes)).size !== bands.length ||
    r.contours.some(
      (c: any) =>
        !object(c) ||
        !bands.includes(c.minutes) ||
        !finite(c.areaKm2) ||
        c.areaKm2 < 0 ||
        typeof c.clipped !== "boolean" ||
        !list(c.polygons, 500) ||
        c.polygons.some(
          (p: any) =>
            !list(p, 30) ||
            !p.length ||
            p.some(
              (ring: any) =>
                !list(ring, 5000) ||
                ring.length < 4 ||
                ring.some((p: unknown) => !point(p)) ||
                (vertices += ring.length) > 30_000,
            ),
        ),
    )
  )
    return fail();
  if (
    !list(r.samples, 2000) ||
    r.samples.some(
      (p: any) => !object(p) || !point(p.point) || !travel(p.travel),
    )
  )
    return fail();
  if (
    !list(r.facilities, 1000) ||
    r.facilities.some(
      (p: any) =>
        !object(p) ||
        !text(p.id, 300) ||
        !text(p.name, 200) ||
        !categories.has(p.category) ||
        !point(p.point) ||
        !text(p.address, 500) ||
        (p.evidence !== undefined &&
          (!list(p.evidence, 30) ||
            p.evidence.some((e: unknown) => {
              try {
                cleanEvidence(e);
                return false;
              } catch {
                return true;
              }
            }))) ||
        (p.travel !== undefined && !travel(p.travel)) ||
        (p.geo !== undefined &&
          (!object(p.geo) ||
            !finite(p.geo.lng, 180) ||
            !finite(p.geo.lat, 90))),
    )
  )
    return fail();
  if (
    !object(r.complete) ||
    CATEGORIES.some((c) => typeof r.complete[c.id] !== "boolean") ||
    !list(r.gaps, 6000) ||
    r.gaps.some(
      (g: any) =>
        !object(g) ||
        !point(g.point) ||
        !["market", "pharmacy", "school"].includes(g.category) ||
        !["missing", "unknown"].includes(g.status),
    ) ||
    !list(r.warnings, 100) ||
    r.warnings.some((w: any) => !text(w, 1000))
  )
    return fail();
  for (const group of ["usage", "parameters", "quality"])
    if (!object(r[group])) return fail();
  if (
    r.derivedFrom !== undefined &&
    (!object(r.derivedFrom) ||
      !text(r.derivedFrom.sourceId, 100) ||
      !text(r.derivedFrom.sourceGeneratedAt, 50) ||
      !Number.isFinite(Date.parse(r.derivedFrom.sourceGeneratedAt)) ||
      !Number.isInteger(r.derivedFrom.reusedTravelPoints) ||
      r.derivedFrom.reusedTravelPoints < 0 ||
      !Number.isInteger(r.derivedFrom.addedTravelPoints) ||
      r.derivedFrom.addedTravelPoints < 0)
  )
    return fail();
  for (const key of [
    "requests",
    "routePairs",
    "searchRequests",
    "cacheHits",
    "retries",
  ])
    if (!Number.isInteger(r.usage[key]) || r.usage[key] < 0) return fail();
  for (const key of [
    "radiusMeters",
    "coarseStepMeters",
    "refinedStepMeters",
    "refinementPoints",
    "searchRadiusMeters",
    "gapDistanceMeters",
  ])
    if (!finite(r.parameters[key]) || r.parameters[key] < 0) return fail();
  if (
    r.parameters.coarseStepMeters <= 0 ||
    (r.parameters.meshVersion !== undefined &&
      !text(r.parameters.meshVersion, 100)) ||
    !text(r.parameters.gapDistanceDefinition, 500) ||
    !finite(r.elapsedMs) ||
    r.elapsedMs < 0
  )
    return fail();
  for (const key of [
    "knownSamples",
    "totalSamples",
    "unknownFacilities",
    "skippedTriangles",
  ])
    if (!Number.isInteger(r.quality[key]) || r.quality[key] < 0) return fail();
  return reconcileEvidence({
    schemaVersion: 1,
    id: r.id,
    mode: r.mode,
    generatedAt: r.generatedAt,
    center: {
      label: r.center.label,
      point: r.center.point,
      ...(r.mode === "baidu"
        ? { geo: { lng: r.center.geo.lng, lat: r.center.geo.lat } }
        : {}),
    },
    contours: r.contours.map(
      ({ minutes, polygons, areaKm2, clipped }: any) => ({
        minutes,
        polygons,
        areaKm2,
        clipped,
      }),
    ),
    samples: r.samples.map(({ point, travel }: any) => ({
      point,
      travel: cleanTravel(travel),
    })),
    facilities: r.facilities.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      point: p.point,
      address: p.address,
      ...(text(p.uid, 200) ? { uid: p.uid } : {}),
      ...(p.geo ? { geo: { lng: p.geo.lng, lat: p.geo.lat } } : {}),
      ...(p.travel ? { travel: cleanTravel(p.travel) } : {}),
      ...(p.evidence ? { evidence: p.evidence.map(cleanEvidence) } : {}),
    })),
    complete: Object.fromEntries(
      CATEGORIES.map((c) => [c.id, r.complete[c.id]]),
    ) as AnalysisResult["complete"],
    gaps: r.gaps.map(({ point, category, status }: any) => ({
      point,
      category,
      status,
    })),
    warnings: r.warnings,
    elapsedMs: r.elapsedMs,
    ...(scenario ? { scenario } : {}),
    ...(r.derivedFrom
      ? {
          derivedFrom: {
            sourceId: r.derivedFrom.sourceId,
            sourceGeneratedAt: r.derivedFrom.sourceGeneratedAt,
            reusedTravelPoints: r.derivedFrom.reusedTravelPoints,
            addedTravelPoints: r.derivedFrom.addedTravelPoints,
          },
        }
      : {}),
    usage: Object.fromEntries(
      ["requests", "routePairs", "searchRequests", "cacheHits", "retries"].map(
        (k) => [k, r.usage[k]],
      ),
    ) as AnalysisResult["usage"],
    parameters: {
      ...Object.fromEntries(
        [
          "radiusMeters",
          "coarseStepMeters",
          "refinedStepMeters",
          "refinementPoints",
          "searchRadiusMeters",
          "gapDistanceMeters",
          "gapDistanceDefinition",
        ].map((k) => [k, r.parameters[k]]),
      ),
      ...(r.parameters.meshVersion
        ? { meshVersion: r.parameters.meshVersion }
        : {}),
    } as AnalysisResult["parameters"],
    quality: Object.fromEntries(
      [
        "knownSamples",
        "totalSamples",
        "unknownFacilities",
        "skippedTriangles",
      ].map((k) => [k, r.quality[k]]),
    ) as AnalysisResult["quality"],
  });
}
function cleanTravel(value: Travel): Travel {
  return value.status === "ok"
    ? {
        status: "ok",
        seconds: value.seconds,
        meters: value.meters,
        ...(value.recordedSeconds !== undefined
          ? { recordedSeconds: value.recordedSeconds }
          : {}),
      }
    : { status: value.status, reason: value.reason };
}
