import type { PlacePosition } from "./life.js";
import type { Travel, Usage } from "./types.js";
import {
  cleanJourney,
  clockMinute,
  estimateJourney,
  type JourneyPreferences,
} from "./journey.js";

export interface OutingNode {
  id: string;
  name: string;
  position: PlacePosition;
}
export interface RouteEdge {
  from: string;
  to: string;
  travel: Travel;
}
export interface RouteBundle {
  nodes: OutingNode[];
  edges: RouteEdge[];
  generatedAt: string;
  mode: "demo" | "baidu";
  usage?: Usage;
}
export interface FamiliarStep {
  title: string;
  instruction: string;
  photo?: string;
}
export interface FamiliarRoute {
  id: string;
  name: string;
  checkedOn: string;
  steps: FamiliarStep[];
}
export interface FamiliarDraft {
  id: string | null;
  name: string;
  checkedOn: string;
  steps: FamiliarStep[];
}
export interface RestPoint extends OutingNode {
  checkedOn: string;
  validUntil: string;
  note: string;
}
export interface ErrandTask {
  id: string;
  label: string;
  candidates: string[];
  stayMinutes: number;
}
export interface OpeningWindow {
  start: string;
  end: string;
}
export interface Visit {
  id: string;
  name: string;
  arrival: string;
  departure: string;
  walkMinutes: number;
  waitMinutes: number;
  stayMinutes: number;
  meters: number;
}
export interface Itinerary {
  visits: Visit[];
  completed: string[];
  skipped: string[];
  totalMinutes: number;
  walkingMinutes: number;
  waitingMinutes: number;
  stayMinutes: number;
  meters: number;
  finish: string;
  unknownOpening: string[];
}
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const validDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const text = (v: unknown, max: number, required = true) => {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw new Error("请补齐名称、日期和指引，并检查文字长度。");
  return v.trim();
};
const bounded = (v: number, min: number, max: number, message: string) => {
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(message);
  return v;
};
export function cleanNode(v: unknown): OutingNode {
  const p = v as OutingNode;
  if (!p || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id))
    throw new Error("地点编号无效。");
  const c = p.position;
  let position: PlacePosition;
  if (c?.system === "demo")
    position = {
      system: "demo",
      x: bounded(c.x, -4000, 4000, "示例位置超出范围。"),
      y: bounded(c.y, -4000, 4000, "示例位置超出范围。"),
    };
  else if (c && ["bd09", "gcj02", "wgs84"].includes(c.system) && "lng" in c)
    position = {
      system: c.system,
      lng: bounded(c.lng, 73, 136, "地点经度无效。"),
      lat: bounded(c.lat, 3, 54, "地点纬度无效。"),
    };
  else throw new Error("请先选择地点位置。");
  return { id: p.id, name: text(p.name, 80), position };
}
export function cleanFamiliarRoute(v: unknown): FamiliarRoute {
  const r = v as FamiliarRoute;
  if (
    !r ||
    typeof r.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) ||
    !validDate(r.checkedOn) ||
    r.checkedOn > todayLocal() ||
    !Array.isArray(r.steps) ||
    r.steps.length < 2 ||
    r.steps.length > 8
  )
    throw new Error("熟路卡需2—8个关键点，并填写不晚于今天的走访日期。");
  return {
    id: r.id,
    name: text(r.name, 80),
    checkedOn: r.checkedOn,
    steps: r.steps.map((s) => {
      if (
        !s ||
        (s.photo !== undefined &&
          (typeof s.photo !== "string" ||
            s.photo.length > 64000 ||
            !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(
              s.photo,
            )))
      )
        throw new Error("熟路照片须为压缩后的JPEG或PNG。");
      return {
        title: text(s.title, 80),
        instruction: text(s.instruction, 300),
        ...(s.photo ? { photo: s.photo } : {}),
      };
    }),
  };
}
export const emptyFamiliarDraft = (): FamiliarDraft => ({
  id: null,
  name: "",
  checkedOn: todayLocal(),
  steps: [
    { title: "", instruction: "" },
    { title: "", instruction: "" },
  ],
});
export function cleanFamiliarDraft(value: unknown): FamiliarDraft {
  const d = value as FamiliarDraft;
  if (
    !d ||
    (d.id !== null &&
      (typeof d.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(d.id))) ||
    !validDate(d.checkedOn) ||
    !Array.isArray(d.steps) ||
    d.steps.length > 8
  )
    throw new Error("熟路草稿格式无效，请检查本机保存内容。");
  return {
    id: d.id,
    name: text(d.name, 80, false),
    checkedOn: d.checkedOn,
    steps: d.steps.map((s) => {
      const validated = cleanFamiliarRoute({
        id: "draft",
        name: "草稿",
        checkedOn: todayLocal(),
        steps: [
          {
            ...s,
            title: s?.title || "待填写",
            instruction: s?.instruction || "待填写",
          },
          { title: "待填写", instruction: "待填写" },
        ],
      }).steps[0];
      return {
        ...validated,
        title: text(s.title, 80, false),
        instruction: text(s.instruction, 300, false),
      };
    }),
  };
}
export function cleanRestPoint(v: unknown): RestPoint {
  const r = v as RestPoint,
    node = cleanNode(v);
  if (
    !validDate(r.checkedOn) ||
    !validDate(r.validUntil) ||
    r.checkedOn > todayLocal() ||
    r.validUntil < r.checkedOn ||
    Date.parse(r.validUntil) - Date.parse(r.checkedOn) > 90 * 86400000
  )
    throw new Error("休息点需填写核验日期及有效期，有效期最长90天。");
  return {
    ...node,
    checkedOn: r.checkedOn,
    validUntil: r.validUntil,
    note: text(r.note, 300, false),
  };
}
export function cleanRouteRequest(v: unknown) {
  const b = v as { nodes: OutingNode[]; pairs: string[][] };
  if (
    !b ||
    !Array.isArray(b.nodes) ||
    b.nodes.length < 2 ||
    b.nodes.length > 12 ||
    !Array.isArray(b.pairs) ||
    !b.pairs.length ||
    b.pairs.length > 6
  )
    throw new Error("每次最多读取6段路线和12个地点。");
  const nodes = b.nodes.map(cleanNode),
    ids = new Set(nodes.map((n) => n.id));
  if (
    ids.size !== nodes.length ||
    new Set(nodes.map((n) => n.position.system === "demo")).size !== 1
  )
    throw new Error("地点编号重复，或混入了模拟位置。");
  const pairs = b.pairs.map((p) => {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !ids.has(p[0]) ||
      !ids.has(p[1]) ||
      p[0] === p[1]
    )
      throw new Error("路线起终点无效。");
    return [p[0], p[1]] as [string, string];
  });
  if (new Set(pairs.map((p) => p.join(">"))).size !== pairs.length)
    throw new Error("路线重复，请重新选择。");
  return { nodes, pairs };
}
export const allPairs = (nodes: OutingNode[]) =>
  nodes.flatMap((a) =>
    nodes
      .filter((b) => b.id !== a.id)
      .map((b) => [a.id, b.id] as [string, string]),
  );
export const formatClock = (minute: number) => {
  const rounded = Math.ceil(minute),
    day = Math.floor(rounded / 1440),
    m = ((rounded % 1440) + 1440) % 1440;
  return `${day ? `次日${day > 1 ? `+${day - 1}` : ""} ` : ""}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
function edgeTravel(bundle: RouteBundle, from: string, to: string) {
  if (from === to) return { status: "ok", seconds: 0, meters: 0 } as const;
  const t = bundle.edges.find((e) => e.from === from && e.to === to)?.travel;
  return t?.status === "ok" &&
    Number.isFinite(t.meters) &&
    t.meters >= 0 &&
    t.meters <= 100000
    ? t
    : null;
}
export function leg(
  bundle: RouteBundle,
  from: string,
  to: string,
  p: JourneyPreferences,
  elapsed: number,
) {
  const t = edgeTravel(bundle, from, to);
  if (!t) return null;
  const e = estimateJourney(t.meters, p, elapsed * 60);
  return {
    meters: t.meters,
    walk: e.walkingSeconds / 60,
    wait: e.waitingSeconds / 60,
    total: e.seconds / 60,
  };
}
export function openingDelay(at: number, stay: number, w?: OpeningWindow) {
  if (!w) return 0;
  const a = clockMinute(w.start),
    b = clockMinute(w.end);
  if (a === b) throw new Error("开门和关门时间不能相同；未知营业时间请留空。");
  let best = Infinity;
  for (
    let day = Math.floor(at / 1440) - 1;
    day <= Math.floor(at / 1440) + 1;
    day++
  ) {
    const start = day * 1440 + a,
      end = day * 1440 + b + (b < a ? 1440 : 0),
      arrival = Math.max(at, start);
    if (arrival + stay <= end) best = Math.min(best, arrival - at);
  }
  return best;
}
export function planErrands(
  bundle: RouteBundle,
  origin: string,
  tasks: ErrandTask[],
  prefs: JourneyPreferences,
  budget: number,
  openings: Record<string, OpeningWindow> = {},
) {
  const p = cleanJourney(prefs);
  bounded(budget, 5, 180, "整趟时间需为5—180分钟。");
  if (
    !tasks.length ||
    tasks.length > 3 ||
    new Set(tasks.map((t) => t.id)).size !== tasks.length
  )
    throw new Error("请选择1—3件事。");
  const names = new Map(bundle.nodes.map((n) => [n.id, n.name]));
  if (!names.has(origin)) throw new Error("出发点缺失。");
  for (const w of Object.values(openings)) {
    if (!w || clockMinute(w.start) === clockMinute(w.end))
      throw new Error("开门和关门时间不能相同；未知营业时间请留空。");
  }
  for (const t of tasks) {
    bounded(t.stayMinutes, 0, 60, "每站停留需为0—60分钟。");
    if (
      !t.candidates.length ||
      t.candidates.length > 2 ||
      new Set(t.candidates).size !== t.candidates.length ||
      t.candidates.some((id) => !names.has(id) || id === origin)
    )
      throw new Error("每件事请选择1—2个有效候选地点。");
  }
  const plans: Itinerary[] = [];
  const visit = (
    at: string,
    elapsed: number,
    chosen: string[],
    visits: Visit[],
    walk: number,
    wait: number,
    stay: number,
    meters: number,
    unknown: string[],
  ) => {
    if (chosen.length) {
      const back = leg(bundle, at, origin, p, elapsed);
      if (back && elapsed + back.total <= budget + 1e-8)
        plans.push({
          visits: [
            ...visits,
            {
              id: origin,
              name: `回到${names.get(origin)}`,
              arrival: formatClock(
                clockMinute(p.departure) + elapsed + back.total,
              ),
              departure: formatClock(
                clockMinute(p.departure) + elapsed + back.total,
              ),
              walkMinutes: back.walk,
              waitMinutes: back.wait,
              stayMinutes: 0,
              meters: back.meters,
            },
          ],
          completed: chosen,
          skipped: tasks
            .filter((t) => !chosen.includes(t.id))
            .map((t) => t.label),
          totalMinutes: elapsed + back.total,
          walkingMinutes: walk + back.walk,
          waitingMinutes: wait + back.wait,
          stayMinutes: stay,
          meters: meters + back.meters,
          finish: formatClock(clockMinute(p.departure) + elapsed + back.total),
          unknownOpening: unknown,
        });
    }
    for (const t of tasks.filter((t) => !chosen.includes(t.id)))
      for (const id of t.candidates) {
        if (visits.some((v) => v.id === id)) continue;
        const path = leg(bundle, at, id, p, elapsed);
        if (!path) continue;
        const arrive = elapsed + path.total,
          delay = openingDelay(
            clockMinute(p.departure) + arrive,
            t.stayMinutes,
            openings[id],
          );
        const leave = arrive + delay + t.stayMinutes;
        if (leave > budget) continue;
        visit(
          id,
          leave,
          [...chosen, t.id],
          [
            ...visits,
            {
              id,
              name: names.get(id)!,
              arrival: formatClock(clockMinute(p.departure) + arrive),
              departure: formatClock(clockMinute(p.departure) + leave),
              walkMinutes: path.walk,
              waitMinutes: path.wait + delay,
              stayMinutes: t.stayMinutes,
              meters: path.meters,
            },
          ],
          walk + path.walk,
          wait + path.wait + delay,
          stay + t.stayMinutes,
          meters + path.meters,
          openings[id] ? unknown : [...unknown, names.get(id)!],
        );
      }
  };
  visit(origin, 0, [], [], 0, 0, 0, 0, []);
  plans.sort(
    (a, b) =>
      b.completed.length - a.completed.length ||
      a.totalMinutes - b.totalMinutes ||
      a.meters - b.meters,
  );
  return {
    plans: plans.slice(0, 3),
    evaluated: plans.length,
    missingRoutes: bundle.edges.filter((e) => e.travel.status !== "ok").length,
  };
}
export function planRestJourney(
  bundle: RouteBundle,
  origin: string,
  destination: string,
  rests: RestPoint[],
  prefs: JourneyPreferences,
  maxWalkingMinutes: number,
  restMinutes: number,
  date = todayLocal(),
) {
  const p = cleanJourney(prefs);
  bounded(maxWalkingMinutes, 1, 60, "连续步行上限需为1—60分钟。");
  bounded(restMinutes, 1, 30, "每次休息需为1—30分钟。");
  if (
    origin === destination ||
    !bundle.nodes.some((n) => n.id === origin) ||
    !bundle.nodes.some((n) => n.id === destination)
  )
    throw new Error("请选择不同的出发点和目的地。");
  if (rests.length > 3) throw new Error("一次最多比较3个休息点。");
  const valid = rests
    .map(cleanRestPoint)
    .filter(
      (r) =>
        r.checkedOn <= date &&
        r.validUntil >= date &&
        r.id !== origin &&
        r.id !== destination &&
        bundle.nodes.some(
          (n) =>
            n.id === r.id &&
            JSON.stringify(n.position) === JSON.stringify(r.position),
        ),
    );
  const names = new Map(bundle.nodes.map((n) => [n.id, n.name]));
  const plans: {
    visits: Visit[];
    totalMinutes: number;
    longestMinutes: number;
    restCount: number;
    meters: number;
    finish: string;
  }[] = [];
  const walk = (
    at: string,
    elapsed: number,
    used: string[],
    visits: Visit[],
    longest: number,
    meters: number,
  ) => {
    for (const to of [
      destination,
      ...valid.filter((r) => !used.includes(r.id)).map((r) => r.id),
    ]) {
      const l = leg(bundle, at, to, p, elapsed);
      if (!l || l.walk > maxWalkingMinutes + 1e-8) continue;
      const rest = to === destination ? 0 : restMinutes,
        end = elapsed + l.total + rest;
      const next = [
        ...visits,
        {
          id: to,
          name: names.get(to)!,
          arrival: formatClock(clockMinute(p.departure) + elapsed + l.total),
          departure: formatClock(clockMinute(p.departure) + end),
          walkMinutes: l.walk,
          waitMinutes: l.wait,
          stayMinutes: rest,
          meters: l.meters,
        },
      ];
      if (to === destination)
        plans.push({
          visits: next,
          totalMinutes: end,
          longestMinutes: Math.max(longest, l.walk),
          restCount: used.length,
          meters: meters + l.meters,
          finish: formatClock(clockMinute(p.departure) + end),
        });
      else
        walk(
          to,
          end,
          [...used, to],
          next,
          Math.max(longest, l.walk),
          meters + l.meters,
        );
    }
  };
  walk(origin, 0, [], [], 0, 0);
  plans.sort((a, b) => a.totalMinutes - b.totalMinutes);
  return {
    plans: plans.slice(0, 3),
    excluded: rests
      .filter((r) => !valid.some((v) => v.id === r.id))
      .map((r) => r.name),
  };
}
export function compareAddition(
  bundle: RouteBundle,
  samples: string[],
  baseline: string[],
  added: string,
  prefs: JourneyPreferences,
) {
  const p = cleanJourney(prefs);
  if (
    !samples.length ||
    samples.length > 6 ||
    !baseline.length ||
    baseline.length > 3 ||
    new Set(samples).size !== samples.length ||
    new Set(baseline).size !== baseline.length ||
    baseline.includes(added) ||
    samples.some((s) => baseline.includes(s) || s === added)
  )
    throw new Error("补点对比需1—6个测试点、1—3处现有设施及一处新增设施。");
  const ids = new Set(bundle.nodes.map((n) => n.id));
  if ([...samples, ...baseline, added].some((id) => !ids.has(id)))
    throw new Error("对比地点不完整。");
  const rows = samples.map((id) => {
    const old = baseline.map((to) => leg(bundle, id, to, p, 0)),
      fresh = leg(bundle, id, added, p, 0);
    const known = old.filter((v): v is NonNullable<typeof v> => v !== null);
    const min = known.length ? Math.min(...known.map((v) => v.total)) : null;
    // A missing route may conceal a closer facility; do not count a new coverage gain.
    const complete = old.every((v) => v !== null),
      before = complete ? min : null;
    const after =
      fresh && complete ? Math.min(before ?? Infinity, fresh.total) : null;
    return {
      id,
      name: bundle.nodes.find((n) => n.id === id)!.name,
      beforeMinutes: before,
      afterMinutes: after,
      addedMinutes: fresh?.total ?? null,
      gain:
        before !== null &&
        after !== null &&
        before > p.minutes &&
        after <= p.minutes,
      improved: before !== null && after !== null && after < before - 1e-8,
    };
  });
  const comparable = rows.filter(
    (r) => r.beforeMinutes !== null && r.afterMinutes !== null,
  );
  return {
    rows,
    newlyCovered: rows.filter((r) => r.gain).length,
    improved: rows.filter((r) => r.improved).length,
    unknown: rows.length - comparable.length,
    averageSavedMinutes: comparable.length
      ? comparable.reduce((n, r) => n + r.beforeMinutes! - r.afterMinutes!, 0) /
        comparable.length
      : null,
  };
}
