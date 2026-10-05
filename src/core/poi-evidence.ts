import { findGaps } from "./facilities.js";
import { cleanEvidence, usableFacility } from "../shared/facility-review.js";
import type { AnalysisResult, FacilityEvidence } from "../shared/types.js";

export const MAX_EVIDENCE_BYTES = 500_000;
export interface EvidenceEntry {
  facilityId: string;
  evidence: FacilityEvidence;
}
export interface EvidenceFile {
  format: "yike-poi-evidence-v1";
  resultId: string;
  entries: EvidenceEntry[];
}

export function parseEvidenceFile(
  raw: string,
  result: AnalysisResult,
): EvidenceFile {
  if (new TextEncoder().encode(raw).length > MAX_EVIDENCE_BYTES)
    throw new Error("核查文件超过500KB。");
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("核查文件不是有效的JSON。");
  }
  if (
    !value ||
    value.format !== "yike-poi-evidence-v1" ||
    value.resultId !== result.id
  )
    throw new Error("核查文件不属于当前报告，请先打开对应体检结果。");
  if (
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.length > 500
  )
    throw new Error("一次需导入1至500条核查记录。");
  const ids = new Set(result.facilities.map((f) => f.id));
  if (ids.size !== result.facilities.length)
    throw new Error("当前报告含重复设施编号，无法准确关联核查记录。");
  const entries = value.entries.map((v: any): EvidenceEntry => {
    if (!v || !ids.has(v.facilityId))
      throw new Error("核查文件包含当前报告中不存在的设施。");
    return { facilityId: v.facilityId, evidence: cleanEvidence(v.evidence) };
  });
  return { format: "yike-poi-evidence-v1", resultId: result.id, entries };
}

export function applyEvidenceFile(
  result: AnalysisResult,
  file: EvidenceFile,
): AnalysisResult {
  // Validate programmatic form input as strictly as uploaded files.
  const checked = parseEvidenceFile(JSON.stringify(file), result);
  const updated = structuredClone(result);
  for (const entry of checked.entries) {
    const facility = updated.facilities.find((f) => f.id === entry.facilityId)!;
    const records = facility.evidence ?? [];
    const encoded = JSON.stringify(entry.evidence);
    if (!records.some((r) => JSON.stringify(r) === encoded))
      records.push(entry.evidence);
    if (records.length > 30)
      throw new Error("单个设施最多保存30条核查记录，请保留原始文件后整理。");
    facility.evidence = records;
  }
  return reconcileEvidence(updated);
}

export function reconcileEvidence(result: AnalysisResult): AnalysisResult {
  if (!result.scenario && !result.facilities.some((f) => f.evidence?.length))
    return result;
  const complete = { ...result.complete };
  for (const f of result.facilities)
    if (!usableFacility(f)) complete[f.category] = false;
  return {
    ...result,
    complete,
    gaps: findGaps(
      result.samples
        .filter(
          (s) =>
            s.travel.status === "ok" &&
            s.travel.seconds <=
              (result.scenario?.preferences.minutes ?? 15) * 60,
        )
        .map((s) => s.point),
      result.center.point,
      result.facilities,
      complete,
      result.parameters.searchRadiusMeters,
    ),
  };
}

export function evidenceFile(result: AnalysisResult): EvidenceFile {
  return {
    format: "yike-poi-evidence-v1",
    resultId: result.id,
    entries: result.facilities.flatMap((f) =>
      (f.evidence ?? []).map((evidence) => ({ facilityId: f.id, evidence })),
    ),
  };
}
