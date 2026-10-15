import { cleanNode } from "./outings.js";
import type { PlacePosition } from "./life.js";

export const NOTICE_KINDS = [
  { id: "closed_now", label: "这次到店未开门", hours: 6 },
  { id: "entrance_blocked", label: "入口暂时受阻", hours: 12 },
  { id: "construction", label: "路段施工或受阻", hours: 48 },
  { id: "steps", label: "有台阶或较高门槛", hours: 168 },
  { id: "rough_surface", label: "路面不平或难走", hours: 72 },
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number]["id"];
export type ObservationState = "present" | "clear" | "unsure";
export type NoticeState =
  "unverified" | "supported" | "conflict" | "clear" | "expired" | "withdrawn";
export interface NoticeTarget {
  name: string;
  position: PlacePosition;
  detail?: {
    kind: "entrance" | "segment";
    label: string;
    side: "unknown" | "east" | "west" | "south" | "north";
  };
}
export const NOTICE_SIDES = [
  { id: "unknown", label: "方向未确认" },
  { id: "east", label: "东侧" },
  { id: "west", label: "西侧" },
  { id: "south", label: "南侧" },
  { id: "north", label: "北侧" },
] as const;
export function targetDetail(t: NoticeTarget) {
  const d = t.detail;
  return d
    ? `${d.kind === "entrance" ? "入口" : "路段"}：${d.label} · ${NOTICE_SIDES.find((s) => s.id === d.side)!.label}（参考点，未实测边界）`
    : "地点附近的参考点，具体入口尚未区分";
}
export interface Observation {
  state: ObservationState;
  basis: "seen" | "heard";
  at: number;
  note: string;
}
export interface NoticeRecord extends Observation {
  actor: string;
  version: number;
  receivedAt: number;
  withdrawn: boolean;
}
export interface NoticeSummary {
  state: NoticeState;
  label: string;
  present: number;
  clear: number;
  unsure: number;
  hearsay: number;
  lastObserved: number | null;
  nextChangeAt: number | null;
  reason: string;
}
export interface NoticeView extends NoticeSummary {
  id: string;
  kind: NoticeKind;
  kindLabel: string;
  target: NoticeTarget;
  demo: boolean;
  distance: number;
  relation: string;
  mine: (Observation & { version: number; withdrawn: boolean }) | null;
  notes: (Observation & { receivedAt: number })[];
}
export interface NoticeQuery {
  target: NoticeTarget;
  path?: PlacePosition[];
  stepsOnly?: boolean;
}
export interface NoticeFeed {
  asOf: number;
  notices: NoticeView[];
  truncated: boolean;
}
export const NOTICE_DRAFT_KEY = "yike-neighborhood-draft";
export function noticeKind(v: unknown) {
  const k = NOTICE_KINDS.find((k) => k.id === v);
  if (!k) throw new Error("请选择要报告的具体情况。");
  return k;
}
export function noticeTarget(v: unknown): NoticeTarget {
  const t = v as NoticeTarget;
  const node = cleanNode({
    id: "notice",
    name: t?.name,
    position: t?.position,
  });
  if (/[<>\u0000-\u001f]/.test(node.name))
    throw new Error("地点名称含有无效字符。");
  const d = t.detail;
  if (
    d !== undefined &&
    (!d ||
      !["entrance", "segment"].includes(d.kind) ||
      typeof d.label !== "string" ||
      !d.label.trim() ||
      d.label.length > 80 ||
      /[<>\u0000-\u001f]/.test(d.label) ||
      !NOTICE_SIDES.some((s) => s.id === d.side))
  )
    throw new Error("请填写具体入口或路段说明，并核对方向。");
  return {
    name: node.name,
    position: node.position,
    ...(d
      ? { detail: { kind: d.kind, label: d.label.trim(), side: d.side } }
      : {}),
  };
}
export function cleanObservation(v: unknown, now: number): Observation {
  const o = v as Observation;
  if (
    !o ||
    !["present", "clear", "unsure"].includes(o.state) ||
    !["seen", "heard"].includes(o.basis) ||
    !Number.isSafeInteger(o.at) ||
    o.at > now + 120000 ||
    o.at < now - 30 * 86400000 ||
    typeof o.note !== "string" ||
    o.note.trim().length < 2 ||
    o.note.length > 240 ||
    /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(o.note)
  )
    throw new Error(
      "请填写具体情况、发生时间和亲见或转述；时间不能晚于现在或早于30天前。",
    );
  return {
    state: o.state,
    basis: o.basis,
    at: Math.min(o.at, now),
    note: o.note.trim(),
  };
}
// Compare Baidu and mini-program points locally. WGS84 stays separate: do not guess its offset.
export function noticePosition(p: PlacePosition): PlacePosition {
  if (p.system !== "bd09") return p;
  const x = p.lng - 0.0065,
    y = p.lat - 0.006;
  const z =
    Math.sqrt(x * x + y * y) - 0.00002 * Math.sin((y * Math.PI * 3000) / 180);
  const theta =
    Math.atan2(y, x) - 0.000003 * Math.cos((x * Math.PI * 3000) / 180);
  return {
    system: "gcj02",
    lng: z * Math.cos(theta),
    lat: z * Math.sin(theta),
  };
}
export function targetKey(t: NoticeTarget): string {
  const p = noticePosition(t.position);
  return JSON.stringify([
    t.name,
    p.system,
    p.system === "demo"
      ? [p.x, p.y]
      : [Number(p.lng.toFixed(5)), Number(p.lat.toFixed(5))],
    ...(t.detail ? [t.detail.kind, t.detail.label, t.detail.side] : []),
  ]);
}
function offset(
  p: PlacePosition,
  origin: PlacePosition,
): [number, number] | null {
  p = noticePosition(p);
  origin = noticePosition(origin);
  if (p.system !== origin.system) return null;
  if (p.system === "demo" && origin.system === "demo")
    return [p.x - origin.x, p.y - origin.y];
  if (p.system === "demo" || origin.system === "demo") return null;
  return [
    (p.lng - origin.lng) * 111320 * Math.cos((origin.lat * Math.PI) / 180),
    (p.lat - origin.lat) * 111320,
  ];
}
export function noticeDistance(a: PlacePosition, b: PlacePosition) {
  const d = offset(a, b);
  return d ? Math.hypot(...d) : Infinity;
}
export function pathDistance(p: PlacePosition, path: PlacePosition[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = offset(path[i - 1], p),
      b = offset(path[i], p);
    if (!a || !b) continue;
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const dot = dx * dx + dy * dy;
    const t = dot
      ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / dot))
      : 0;
    best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return best;
}
export function cleanNoticeQuery(v: unknown): NoticeQuery {
  const q = v as NoticeQuery;
  const target = noticeTarget(q?.target);
  let path: PlacePosition[] | undefined;
  if (q.path !== undefined) {
    if (!Array.isArray(q.path) || q.path.length < 2 || q.path.length > 2000)
      throw new Error("路线坐标不完整，请重新获取步行步骤。");
    path = q.path.map(
      (position) => noticeTarget({ name: "路段", position }).position,
    );
    if (
      path.some(
        (p) =>
          noticePosition(p).system !== noticePosition(target.position).system,
      ) ||
      path
        .slice(1)
        .reduce((sum, p, i) => sum + noticeDistance(p, path![i]), 0) > 35000
    )
      throw new Error("路线坐标不一致或超出邻里提醒的范围。");
  }
  return { target, ...(path ? { path } : {}), stepsOnly: q.stepsOnly === true };
}
export function summarizeNotice(
  kind: NoticeKind,
  records: NoticeRecord[],
  now: number,
): NoticeSummary {
  const ttl = noticeKind(kind).hours * 3600000;
  const latest = new Map<string, NoticeRecord>();
  for (const r of records)
    if (!latest.has(r.actor) || r.version > latest.get(r.actor)!.version)
      latest.set(r.actor, r);
  const kept = [...latest.values()].filter((r) => !r.withdrawn);
  const fresh = kept.filter((r) => r.at <= now && r.at + ttl > now);
  const observed = fresh.filter((r) => r.basis === "seen");
  const present = observed.filter((r) => r.state === "present").length;
  const clear = observed.filter((r) => r.state === "clear").length;
  const unsure = observed.filter((r) => r.state === "unsure").length;
  const hearsay = fresh.length - observed.length;
  const state: NoticeState = !kept.length
    ? "withdrawn"
    : !fresh.length
      ? "expired"
      : present && clear
        ? "conflict"
        : present >= 2
          ? "supported"
          : present
            ? "unverified"
            : clear
              ? "clear"
              : "unverified";
  const labels: Record<NoticeState, string> = {
    withdrawn: "反馈已撤回",
    expired: "已过有效期，待复核",
    conflict: "近期反馈有分歧",
    supported: "多份近期反馈",
    unverified: "有人反馈，待核实",
    clear: "有恢复反馈，待核实",
  };
  return {
    state,
    label: labels[state],
    present,
    clear,
    unsure,
    hearsay,
    lastObserved: kept.length ? Math.max(...kept.map((r) => r.at)) : null,
    nextChangeAt: fresh.length
      ? Math.min(...fresh.map((r) => r.at + ttl))
      : null,
    reason:
      state === "expired"
        ? "没有仍在有效期内的反馈；过期不等于已经恢复。"
        : state === "withdrawn"
          ? "目前没有保留的反馈。"
          : `${present}份亲见问题、${clear}份亲见恢复、${unsure}份待确认、${hearsay}份转述。同一私人空间只计一份，不代表已核验的独立人数。`,
  };
}
export function noticeRelation(
  target: NoticeTarget,
  kind: NoticeKind,
  query: NoticeQuery,
) {
  if (query.stepsOnly && kind !== "steps") return null;
  const distance = noticeDistance(target.position, query.target.position);
  if (distance <= 100)
    return {
      distance: Math.round(distance),
      relation: `地点附近约${Math.round(distance)}米，请核对入口`,
    };
  const along =
    query.path && kind !== "closed_now"
      ? pathDistance(target.position, query.path)
      : Infinity;
  if (along !== undefined && along <= 40)
    return {
      distance: Math.round(along),
      relation: `路线附近约${Math.round(along)}米，不保证在同一侧道路`,
    };
  return null;
}
