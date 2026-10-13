import { cleanEntrance, type EntranceGuide } from "./entrance.js";
export { cleanEntrance, type EntranceGuide } from "./entrance.js";
import { remainingTrip, type ActiveTrip } from "./trip.js";
import { tripBasis, type TripAdjustment } from "./trip-adjust.js";

export interface AssistSnapshot {
  tripId: string;
  basis: string;
  mode: "demo" | "baidu";
  currentId: string;
  phase: ActiveTrip["phase"];
  confirmedAt: number;
  stops: { id: string; name: string }[];
  homeId: string;
  remaining: string[];
  speedMps: number;
  finish: string;
  request: string;
  guide: EntranceGuide | null;
}
export interface AssistProposal {
  id: string;
  kind: "message" | "plan" | "entrance";
  helper: string;
  note: string;
  snapshotVersion: number;
  change: TripAdjustment | null;
  marker: { x: number; y: number } | null;
}
export interface AssistView {
  id: string;
  revision: number;
  snapshotVersion: number;
  expiresAt: number;
  updatedAt: number;
  snapshot: AssistSnapshot;
  proposal: AssistProposal | null;
  outcome: string;
}
const str = (v: unknown, max: number, required = true) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new Error("协助内容无效或文字过长。");
  return v.trim();
};
const number = (v: unknown, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error("协助数据中的数值无效。");
  return v;
};
export function cleanAssistSnapshot(value: unknown): AssistSnapshot {
  const v = value as AssistSnapshot;
  if (
    !v ||
    !["demo", "baidu"].includes(v.mode) ||
    !["at", "walking", "resting", "finished"].includes(v.phase) ||
    !Array.isArray(v.stops) ||
    v.stops.length < 1 ||
    v.stops.length > 6 ||
    !Array.isArray(v.remaining) ||
    v.remaining.length > 6
  )
    throw new Error("请从进行中的行程发起协助。");
  const stops = v.stops.map((n) => ({
      id: str(n.id, 80),
      name: str(n.name, 80),
    })),
    ids = stops.map((n) => n.id);
  if (
    new Set(ids).size !== ids.length ||
    ![v.currentId, v.homeId, ...v.remaining].every((id) => ids.includes(id)) ||
    new Set(v.remaining).size !== v.remaining.length
  )
    throw new Error("协助地点与当前行程不匹配。");
  const guide = v.guide ? cleanEntrance(v.guide) : null;
  if (guide && !ids.includes(guide.id))
    throw new Error("只可分享本次行程的入口照片。");
  return {
    tripId: str(v.tripId, 100),
    basis: str(v.basis, 1500),
    mode: v.mode,
    currentId: v.currentId,
    homeId: v.homeId,
    phase: v.phase,
    confirmedAt: number(v.confirmedAt, 0, 9e15),
    stops,
    remaining: v.remaining.map((id) => str(id, 80)),
    speedMps: number(v.speedMps, 0.3, 2),
    finish: str(v.finish, 80),
    request: str(v.request, 240, false),
    guide,
  };
}
export function makeAssistSnapshot(
  a: ActiveTrip,
  request: string,
  guide: EntranceGuide | null = null,
): AssistSnapshot {
  // No coordinates, complete book, prices, tokens or API settings leave the device.
  const ids = new Set([a.currentId, a.input.origin.id, ...a.remaining]);
  return cleanAssistSnapshot({
    tripId: a.id,
    basis: tripBasis(a),
    mode: a.input.bundle.mode,
    currentId: a.currentId,
    homeId: a.input.origin.id,
    phase: a.phase,
    confirmedAt: [...a.events]
      .reverse()
      .find((e) => e.kind === "arrive" || e.kind === "start")!.at,
    stops: [a.input.origin, ...a.input.stops]
      .filter((n) => ids.has(n.id))
      .map((n) => ({ id: n.id, name: n.name })),
    remaining: a.remaining,
    speedMps: a.input.draft.speedMps ?? a.input.preferences.speedMps,
    finish: remainingTrip(a).finish,
    request,
    guide: guide && ids.has(guide.id) ? guide : null,
  });
}
export function cleanAssistProposal(
  value: unknown,
  view: AssistView,
): AssistProposal {
  const v = value as AssistProposal,
    s = view.snapshot;
  if (
    !v ||
    !["message", "plan", "entrance"].includes(v.kind) ||
    v.snapshotVersion !== view.snapshotVersion
  )
    throw new Error("行程已更新，请刷新后重新提出建议。");
  let change: TripAdjustment | null = null,
    marker: AssistProposal["marker"] = null;
  if (v.kind === "plan") {
    if (
      s.phase !== "at" ||
      !v.change ||
      !Array.isArray(v.change.remaining) ||
      v.change.remaining.length > 5 ||
      new Set(v.change.remaining).size !== v.change.remaining.length ||
      !v.change.remaining.every(
        (id) => id !== s.homeId && s.remaining.includes(id),
      )
    )
      throw new Error("请等对方确认到达后，再建议调整尚未前往的地点。");
    change = {
      remaining: v.change.remaining.map((id) => str(id, 80)),
      speedMps: number(v.change.speedMps, 0.3, 2),
    };
  }
  if (v.kind === "entrance") {
    if (!s.guide || !v.marker)
      throw new Error("请等对方分享照片，再标记入口。");
    marker = { x: number(v.marker.x, 0, 1), y: number(v.marker.y, 0, 1) };
  }
  return {
    id: str(v.id, 80),
    helper: str(v.helper, 30),
    note: str(v.note, 240),
    kind: v.kind,
    snapshotVersion: view.snapshotVersion,
    change,
    marker,
  };
}
