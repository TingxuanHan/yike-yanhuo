export interface TripFeedback {
  id: string;
  date: string;
  mode: "demo" | "baidu";
  origin: string;
  completed: string[];
  difficult: string[];
  totalMinutes: number;
  walkingMinutes: number | null;
  meters: number;
  spent: number | null;
  note: string;
}
export function cleanTripFeedback(value: unknown): TripFeedback {
  const f = value as TripFeedback;
  const bounded = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (
    !f ||
    !/^trip-[a-z0-9-]{1,75}$/.test(f.id) ||
    !["demo", "baidu"].includes(f.mode) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(f.date) ||
    !Number.isFinite(Date.parse(f.date)) ||
    new Date(f.date).toISOString().slice(0, 10) !== f.date ||
    typeof f.origin !== "string" ||
    f.origin.length > 80 ||
    !Array.isArray(f.completed) ||
    f.completed.length > 6 ||
    f.completed.some((id) => typeof id !== "string" || id.length > 80) ||
    !Array.isArray(f.difficult) ||
    f.difficult.length > 6 ||
    f.difficult.some((id) => !f.completed.includes(id)) ||
    !bounded(f.totalMinutes, 0, 1440) ||
    !bounded(f.meters, 0, 50000) ||
    (f.walkingMinutes !== null &&
      !bounded(f.walkingMinutes, 0.1, f.totalMinutes)) ||
    (f.spent !== null && !bounded(f.spent, 0, 100000)) ||
    typeof f.note !== "string" ||
    f.note.length > 300
  )
    throw new Error("请核对实际步行分钟、实付金额和行后记录。");
  return {
    id: f.id,
    date: f.date,
    mode: f.mode,
    origin: f.origin,
    completed: [...new Set(f.completed)],
    difficult: [...new Set(f.difficult)],
    totalMinutes: f.totalMinutes,
    walkingMinutes: f.walkingMinutes,
    meters: f.meters,
    spent: f.spent,
    note: f.note.trim(),
  };
}
export function feedbackPace(f: TripFeedback) {
  if (f.mode === "demo" || !f.walkingMinutes || f.meters <= 0) return null;
  const pace = Math.round((f.meters / (f.walkingMinutes * 60)) * 100) / 100;
  return pace >= 0.3 && pace <= 2 ? pace : null;
}
