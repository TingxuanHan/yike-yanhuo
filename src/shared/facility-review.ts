import type { Facility, FacilityEvidence } from "./types.js";

export type ReviewState =
  "unreviewed" | "confirmed" | "closed" | "uncertain" | "conflict";
export const REVIEW_LABELS: Record<ReviewState, string> = {
  unreviewed: "未核查",
  confirmed: "记录可用",
  closed: "记录停用",
  uncertain: "待核查",
  conflict: "来源冲突",
};

export function cleanEvidence(value: unknown): FacilityEvidence {
  const e = value as Partial<FacilityEvidence> | null;
  const validText = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (
    !e ||
    typeof e !== "object" ||
    !validText(e.source, 120) ||
    !validText(e.recordId, 200) ||
    !validText(e.basis, 500) ||
    !validText(e.checkedAt, 50) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      e.checkedAt!,
    ) ||
    !Number.isFinite(Date.parse(e.checkedAt!)) ||
    !["confirmed", "closed", "uncertain"].includes(e.status ?? "")
  )
    throw new Error("核查记录需提供有效的来源、来源内编号、时间、状态和依据。");
  return {
    source: e.source!.trim(),
    recordId: e.recordId!.trim(),
    checkedAt: new Date(e.checkedAt!).toISOString(),
    status: e.status!,
    basis: e.basis!.trim(),
  };
}

export function reviewState(facility: Facility): ReviewState {
  if (!facility.evidence?.length) return "unreviewed";
  // IDs are meaningful only within their own source. Keep the newest record
  // per source ID; simultaneous contradictions and different sources conflict.
  const latest = new Map<string, FacilityEvidence[]>();
  for (const e of facility.evidence) {
    const key = JSON.stringify([e.source, e.recordId]);
    const previous = latest.get(key);
    const time = Date.parse(e.checkedAt);
    if (!previous || time > Date.parse(previous[0].checkedAt))
      latest.set(key, [e]);
    else if (time === Date.parse(previous[0].checkedAt)) previous.push(e);
  }
  const states = new Set([...latest.values()].flat().map((e) => e.status));
  return states.size === 1 ? [...states][0] : "conflict";
}

export function usableFacility(facility: Facility): boolean {
  return ["unreviewed", "confirmed"].includes(reviewState(facility));
}
