import clip from "polygon-clipping";
import { parseResultFile } from "../shared/result-file.js";
import { utf8Bytes } from "../shared/life.js";
import {
  compareSitingConditions,
  SITING_CONDITIONS_VERSION,
} from "./siting-conditions.js";
import { detourAudit } from "./detour-audit.js";
import { polygonArea } from "./contours.js";
import type { MultiPolygon } from "../shared/types.js";

// Recompute all values from the bounded original report; imported conclusions
// and shapes are claims to verify, never inputs to the calculation.
export function replayPlanningEvidence(raw: string) {
  if (utf8Bytes(raw) > 8_000_000) throw new Error("依据文件超过8MB。");
  const file = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const report = parseResultFile(JSON.stringify(file.report));
  const requireEqual = (a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error("来源、条件或比较结论与复算不一致。");
  };
  let maxErrorSquareMeters = 0;
  const near = (a: number, b: unknown) => {
    const error = typeof b === "number" ? Math.abs(a - b) : Infinity;
    if (!Number.isFinite(error) || error >= 0.001)
      throw new Error("面积或用时数值与复算不一致。");
    maxErrorSquareMeters = Math.max(maxErrorSquareMeters, error);
  };
  const geometry = (a: MultiPolygon, b: MultiPolygon) => {
    if (!Array.isArray(b)) throw new Error("缺少导出的几何范围。");
    const error = polygonArea(
      a.length && b.length
        ? (clip.xor(a, b) as MultiPolygon)
        : a.length
          ? a
          : b,
    );
    near(0, error);
  };
  if (file.schema === "yike-detour-audit-v1") {
    const audit = detourAudit(report, file.audit.minutes);
    requireEqual(audit, file.audit);
    requireEqual(
      file.evidence,
      report.mode === "demo" ? "simulation" : "api-report-diagnostic",
    );
    return {
      schema: file.schema,
      evidence: file.evidence,
      verifiedPoints: audit.counts.nearPoints,
      hotspots: audit.hotspots.length,
      externalApiCalls: 0,
    };
  }
  if (
    file.schema !== "yike-siting-conditions-v1" ||
    file.comparison?.version !== SITING_CONDITIONS_VERSION
  )
    throw new Error("不是支持的多条件补点依据文件。");
  const saved = file.comparison;
  if (
    !Array.isArray(saved.candidates) ||
    saved.candidates.length > 3 ||
    !Array.isArray(saved.plans)
  )
    throw new Error("候选方案格式无效。");
  const actual = compareSitingConditions(
    report,
    saved.category,
    saved.minutes,
    saved.candidates.map((c: { id: string }) => c.id),
    saved.input,
  );
  for (const key of [
    "sourceId",
    "sourceGeneratedAt",
    "baseGeneratedAt",
    "input",
    "candidates",
    "groups",
    "distinctConditions",
  ] as const)
    requireEqual(actual[key], saved[key]);
  requireEqual(
    file.evidence,
    report.mode === "demo" ? "simulation" : "api-report-scenarios",
  );
  near(actual.domainSquareMeters, saved.domainSquareMeters);
  geometry(actual.domain, saved.domain);
  requireEqual(actual.conditions.length, saved.conditions?.length);
  actual.conditions.forEach((c, i) => {
    const s = saved.conditions[i];
    for (const key of ["id", "label", "preferences", "clipped"] as const)
      requireEqual(c[key], s[key]);
    for (const key of [
      "domainSquareMeters",
      "gapSquareMeters",
      "unknownSquareMeters",
    ] as const)
      near(c[key], s[key]);
    geometry(c.domain, s.domain);
  });
  requireEqual(actual.plans.length, saved.plans.length);
  actual.plans.forEach((p, i) => {
    const s = saved.plans[i];
    for (const key of ["id", "label", "siteCount", "siteIds"] as const)
      requireEqual(p[key], s[key]);
    for (const key of [
      "worstGainSquareMeters",
      "maxRegretSquareMeters",
      "stableGainSquareMeters",
      "variableGainSquareMeters",
    ] as const)
      near(p[key], s[key]);
    requireEqual(p.values.length, s.values?.length);
    p.values.forEach((v, j) => {
      requireEqual(v.conditionId, s.values[j].conditionId);
      for (const key of [
        "gainSquareMeters",
        "unknownSquareMeters",
        "regretSquareMeters",
        "bestGainSquareMeters",
      ] as const)
        near(v[key], s.values[j][key]);
    });
    geometry(p.stable, s.stable);
    geometry(p.variable, s.variable);
  });
  return {
    schema: file.schema,
    evidence: file.evidence,
    verifiedConditions: actual.conditions.length,
    verifiedPlans: actual.plans.length,
    maxErrorSquareMeters,
    externalApiCalls: 0,
  };
}
