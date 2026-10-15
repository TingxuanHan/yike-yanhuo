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
  if (
    e.nextReviewAt !== undefined &&
    (typeof e.nextReviewAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
        e.nextReviewAt,
      ) ||
      !Number.isFinite(Date.parse(e.nextReviewAt)) ||
      new Date(e.nextReviewAt).toISOString().slice(0, 19) !==
        e.nextReviewAt.slice(0, 19) ||
      Date.parse(e.nextReviewAt) <= Date.parse(e.checkedAt!))
  )
    throw new Error("下次复核时间须为有效的ISO时间，并晚于本次核查时间。");
  return {
    source: e.source!.trim(),
    recordId: e.recordId!.trim(),
    checkedAt: new Date(e.checkedAt!).toISOString(),
    status: e.status!,
    basis: e.basis!.trim(),
    ...(e.nextReviewAt === undefined
      ? {}
      : { nextReviewAt: new Date(e.nextReviewAt).toISOString() }),
  };
}

function latestEvidence(facility: Facility): FacilityEvidence[] {
  // IDs are meaningful only within their own source. Keep the newest record
  // per source ID; simultaneous contradictions and different sources conflict.
  const latest = new Map<string, FacilityEvidence[]>();
  for (const e of facility.evidence ?? []) {
    const key = JSON.stringify([e.source, e.recordId]);
    const previous = latest.get(key);
    const time = Date.parse(e.checkedAt);
    if (!previous || time > Date.parse(previous[0].checkedAt))
      latest.set(key, [e]);
    else if (time === Date.parse(previous[0].checkedAt)) previous.push(e);
  }
  return [...latest.values()].flat();
}

export function reviewState(facility: Facility): ReviewState {
  if (!facility.evidence?.length) return "unreviewed";
  const states = new Set(latestEvidence(facility).map((e) => e.status));
  return states.size === 1 ? [...states][0] : "conflict";
}

const DAY = 86_400_000;
export function reviewSchedule(facility: Facility, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("复核提醒需要有效的当前时间。");
  const latest = latestEvidence(facility);
  const entry = latest
    .filter((e) => e.nextReviewAt)
    .sort(
      (a, b) => Date.parse(a.nextReviewAt!) - Date.parse(b.nextReviewAt!),
    )[0];
  const due = entry ? Date.parse(entry.nextReviewAt!) : Infinity;
  const state = !latest.length
    ? "unreviewed"
    : !entry
      ? "unscheduled"
      : due <= now
        ? "due"
        : due - now <= 7 * DAY
          ? "soon"
          : "scheduled";
  const label = {
    unreviewed: "尚未核查",
    unscheduled: "未设复核日期",
    due: "已到复核日期",
    soon: "7天内需复核",
    scheduled: "已设复核日期",
  }[state];
  return { state, label, entry };
}

function localDateTime(iso: string) {
  const d = new Date(iso),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function reviewReminders(facilities: Facility[], now = Date.now()) {
  const schedules = facilities.map((f) => ({
    facility: f,
    ...reviewSchedule(f, now),
  }));
  const items = schedules
    .filter((s) => s.state === "due" || s.state === "soon")
    .map((s) => ({
      facilityId: s.facility.id,
      name: s.facility.name,
      state: s.state,
      label: s.label,
      reviewLabel: REVIEW_LABELS[reviewState(s.facility)],
      entry: s.entry!,
      dueLabel: localDateTime(s.entry!.nextReviewAt!),
      checkedLabel: localDateTime(s.entry!.checkedAt),
    }))
    .sort(
      (a, b) =>
        Date.parse(a.entry.nextReviewAt!) - Date.parse(b.entry.nextReviewAt!),
    );
  return {
    items,
    due: schedules.filter((s) => s.state === "due").length,
    soon: schedules.filter((s) => s.state === "soon").length,
    unscheduled: schedules.filter((s) => s.state === "unscheduled").length,
    unreviewed: schedules.filter((s) => s.state === "unreviewed").length,
    asOf: localDateTime(new Date(now).toISOString()),
  };
}

export function usableFacility(facility: Facility): boolean {
  return ["unreviewed", "confirmed"].includes(reviewState(facility));
}
