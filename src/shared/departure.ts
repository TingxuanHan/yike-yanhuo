import {
  cleanPlanning,
  type PlanningDraft,
  planningTasks,
} from "./planning-draft.js";
import { cleanNode, type OutingNode } from "./outings.js";
import { cleanPhoto } from "./entrance.js";
import {
  cleanWalkingGuide,
  guideKey,
  type WalkingGuide,
  type WalkingLeg,
} from "./walking-guide.js";
import type { LifeBook } from "./life.js";
import {
  remainingTrip,
  type ActiveTrip,
  type TripInput,
  type TripPlan,
} from "./trip.js";

export interface TripRoutine {
  id: string;
  name: string;
  savedAt: number;
  origin: OutingNode;
  stops: OutingNode[];
  draft: PlanningDraft;
}
const str = (v: unknown, max: number) => {
  if (typeof v !== "string" || v.length > max)
    throw new Error("出门卡文字无效或过长。");
  return v.trim();
};
const timestamp = (v: unknown) => {
  if (
    typeof v !== "number" ||
    !Number.isSafeInteger(v) ||
    v <= 0 ||
    v > 8_640_000_000_000_000
  )
    throw new Error("保存时间无效。");
  return v;
};
export function cleanRoutine(raw: unknown): TripRoutine {
  const r = raw as TripRoutine;
  if (
    !r ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) ||
    !Array.isArray(r.stops) ||
    !r.stops.length ||
    r.stops.length > 5
  )
    throw new Error("常用方案需包含1—5个候选地点。");
  const origin = cleanNode(r.origin),
    stops = r.stops.map(cleanNode),
    name = str(r.name, 40);
  if (
    !name ||
    new Set([origin.id, ...stops.map((n) => n.id)]).size !== stops.length + 1 ||
    stops.some(
      (n) =>
        (n.position.system === "demo") !== (origin.position.system === "demo"),
    )
  )
    throw new Error("常用方案的名称或地点有误。");
  return {
    id: r.id,
    name,
    savedAt: timestamp(r.savedAt),
    origin,
    stops,
    draft: { ...cleanPlanning(r.draft), departure: null, speedMps: null },
  };
}
export function routineFrom(
  input: TripInput,
  plan: TripPlan,
  now: number,
): TripRoutine {
  return cleanRoutine({
    id: `routine-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name:
      input.draft.tasks
        .map((t) => planningTasks.find((x) => x.id === t)?.label)
        .filter(Boolean)
        .join("＋") || "我的出门安排",
    savedAt: now,
    origin: input.origin,
    stops: input.stops.filter((n) => plan.stopIds.includes(n.id)),
    draft: input.draft,
  });
}

export interface DeparturePlace {
  id: string;
  name: string;
  address: string;
  landmark: string;
  photo: string;
  marker: { x: number; y: number } | null;
  freshness: string;
  opening: string;
}
export interface DeparturePack {
  version: 1;
  preparedAt: number;
  basis: string;
  demo: boolean;
  finish: string;
  phone: string;
  returnPlace: DeparturePlace;
  places: DeparturePlace[];
  schedule: string[];
  checks: string[];
  guides: WalkingGuide[];
  guideMissing: string[];
}
export const DEPARTURE_KEY = "yike-departure-pack";
export function tripWalkingLegs(
  input: TripInput,
  plan: TripPlan,
  active?: ActiveTrip,
): WalkingLeg[] {
  const nodes = [input.origin, ...input.stops];
  const ids = active
    ? [active.currentId, ...active.remaining]
    : [input.origin.id, ...plan.stopIds, input.origin.id];
  return ids
    .slice(1)
    .map((id, i) => ({
      from: nodes.find((n) => n.id === ids[i])!,
      to: nodes.find((n) => n.id === id)!,
    }))
    .filter(
      (l) =>
        l.from &&
        l.to &&
        l.from.id !== l.to.id &&
        JSON.stringify(l.from.position) !== JSON.stringify(l.to.position),
    )
    .map((l) => ({ from: cleanNode(l.from), to: cleanNode(l.to) }));
}
export function departureBasis(
  input: TripInput,
  plan: TripPlan,
  active?: ActiveTrip,
) {
  return JSON.stringify([
    input.origin,
    input.stops,
    input.draft,
    input.bundle.generatedAt,
    plan,
    active && active.events.length > 1
      ? [
          active.currentId,
          active.remaining,
          active.phase,
          active.lastAt,
          active.skipped,
        ]
      : null,
  ]);
}
export function prepareDeparture(
  input: TripInput,
  plan: TripPlan,
  book: LifeBook,
  phone: unknown,
  now = Date.now(),
  active?: ActiveTrip,
  guides: WalkingGuide[] = [],
): DeparturePack {
  const place = (node: OutingNode): DeparturePlace => {
    const p = book.places.find(
      (p) =>
        (p.id === node.id || `p-${p.id}` === node.id) &&
        JSON.stringify(p.position) === JSON.stringify(node.position),
    );
    // Entrance guides use the matching scene's ID; never mix real and demo records.
    const g =
      input.bundle.mode === "baidu"
        ? book.entrances?.find((g) => g.id === node.id)
        : undefined;
    const stop = input.stops.find((s) => s.id === node.id);
    return {
      id: node.id,
      name: node.name,
      address: p?.address || "地址待补充",
      landmark: g?.instruction || p?.landmark || "入口地标待补充",
      photo: g?.photo || p?.photo || "",
      marker: g ? { x: g.x, y: g.y } : null,
      freshness: g
        ? `${g.observedOn}记录 · ${g.source === "helper" ? "家人提供，待现场确认" : "本人记录，开放情况待确认"}`
        : p?.visitedOn
          ? `${p.visitedOn}到访记录 · 入口待确认`
          : "尚无带日期的入口记录",
      opening: p?.openingHours
        ? `记录营业时间：${p.openingHours} · 今日营业待确认`
        : stop?.opening
          ? `记录营业时间：${stop.opening.start}—${stop.opening.end} · 今日营业待确认`
          : "营业时间待确认",
    };
  };
  const progressed = active && active.events.length > 1 ? active : null;
  const estimate = progressed ? remainingTrip(progressed, now) : null;
  const selected = progressed
    ? progressed.remaining.filter((id) => id !== input.origin.id)
    : plan.stopIds;
  const name = (id: string) =>
    [input.origin, ...input.stops].find((n) => n.id === id)?.name ||
    "地点待核对";
  const legs = tripWalkingLegs(input, plan, active);
  const matching = legs
    .map((l) => guides.find((g) => guideKey(g) === guideKey(l)))
    .filter((g): g is WalkingGuide => !!g);
  return cleanDeparture({
    version: 1,
    preparedAt: now,
    basis: departureBasis(input, plan, active),
    demo: input.bundle.mode === "demo",
    finish: estimate?.finish ?? plan.finish,
    phone:
      typeof phone === "string" && /^\+?\d{3,19}$/.test(phone) ? phone : "",
    guides: matching,
    guideMissing: legs
      .filter((l) => !matching.some((g) => guideKey(l) === guideKey(g)))
      .map((l) => `${l.from.name} → ${l.to.name}`),
    returnPlace: place(input.origin),
    places: selected.map((id) => place(input.stops.find((s) => s.id === id)!)),
    schedule: progressed
      ? [
          `最后本人确认：${name(progressed.currentId)}；${progressed.phase === "walking" ? "正在路上，精确位置未知" : "以现场情况为准"}`,
          ...progressed.remaining.map(
            (id) =>
              `接下来：${name(id)}${id === input.origin.id ? "（返程地点）" : ""}`,
          ),
        ]
      : plan.legs.map(
          (l) =>
            `${l.arrival} ${l.name} · 走${l.walking.toFixed(1)}分钟，停留${l.stay}分钟`,
        ),
    checks: [
      ...(active?.replacements?.length
        ? [
            "本趟已更换地点；下面保留出发时的价格记录，新地点商品、价格与通行情况需重新确认。",
          ]
        : []),
      estimate
        ? `保存时的返程估计：${estimate.finish}。${estimate.note}`
        : `按${input.draft.departure ?? input.preferences.departure}出发估算：整趟约${plan.minutes.toFixed(1)}分钟，预计${plan.finish}返回；含办事、等候与返程。`,
      ...(plan.missed.length ? [`尚未安排：${plan.missed.join("、")}`] : []),
      `${progressed ? "出发时的" : ""}${plan.priceComplete ? "清单估价" : "仅已知部分"} ¥${plan.low.toFixed(2)}—${plan.high.toFixed(2)}${plan.budget === "over" ? "，预计超预算" : plan.budget === "unknown" ? "，价格未齐，预算待确认" : ""}。${progressed ? "已购、取消及剩余消费需另行核对。" : "未记录消费另算。"}`,
      ...plan.purchases.map(
        (x) => `${x.item.name}：${x.reason}；售价与库存以现场为准。`,
      ),
      "地点顺序和时间供参考；仅收录已获取路段的文字步骤，不跟踪定位。路线可能沿用缓存，等灯按手动假设计算。",
    ],
  });
}
export function cleanDeparture(raw: unknown): DeparturePack {
  const p = raw as DeparturePack;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.demo !== "boolean" ||
    JSON.stringify(raw).length > 500_000
  )
    throw new Error("出门卡无效或容量过大，请重新准备。");
  const place = (x: DeparturePlace): DeparturePlace => {
    if (!x) throw new Error("出门卡地点缺失。");
    const m = x.marker;
    if (
      m &&
      ![m.x, m.y].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      )
    )
      throw new Error("入口标记无效。");
    return {
      id: str(x.id, 80),
      name: str(x.name, 80),
      address: str(x.address, 240),
      landmark: str(x.landmark, 300),
      photo: cleanPhoto(x.photo) || "",
      marker: m ? { x: m.x, y: m.y } : null,
      freshness: str(x.freshness, 160),
      opening: str(x.opening, 200),
    };
  };
  const list = (xs: unknown, max: number) => {
    if (!Array.isArray(xs) || xs.length > max)
      throw new Error("出门卡条目过多。");
    return xs.map((x) => str(x, 600));
  };
  if (
    !Array.isArray(p.places) ||
    p.places.length > 5 ||
    typeof p.phone !== "string" ||
    !/^\+?\d{3,19}$|^$/.test(p.phone)
  )
    throw new Error("出门卡地点、电话或返程时间无效。");
  return {
    version: 1,
    preparedAt: timestamp(p.preparedAt),
    basis: str(p.basis, 100000),
    demo: p.demo,
    finish: str(p.finish, 80),
    phone: p.phone,
    returnPlace: place(p.returnPlace),
    places: p.places.map(place),
    schedule: list(p.schedule, 7),
    checks: list(p.checks, 12),
    guides:
      p.guides === undefined
        ? []
        : (() => {
            if (!Array.isArray(p.guides) || p.guides.length > 6)
              throw new Error("出门卡最多保存6段指引。");
            return p.guides.map(cleanWalkingGuide);
          })(),
    guideMissing: list(p.guideMissing ?? [], 6),
  };
}
export function departureAge(pack: DeparturePack, now = Date.now()) {
  return new Date(pack.preparedAt).toDateString() ===
    new Date(now).toDateString()
    ? "今日保存的快照，营业与价格仍需确认"
    : "不是今天的安排，请重新核算后准备";
}
