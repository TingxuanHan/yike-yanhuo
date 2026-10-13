import {
  cleanJourney,
  clockMinute,
  type JourneyPreferences,
} from "./journey.js";
import {
  cleanNode,
  formatClock,
  type OutingNode,
  type RouteBundle,
  type OpeningWindow,
} from "./outings.js";
import {
  cleanMovement,
  defaultMovement,
  planMovement,
  type MovementSettings,
} from "./movement.js";
import {
  cleanShopping,
  matchingQuotes,
  type ShoppingBook,
  type Purchase,
} from "./shopping.js";
import {
  cleanPlanning,
  planningTasks,
  type PlanningDraft,
} from "./planning.js";

export interface TripStop extends OutingNode {
  category: string;
  stay: number;
  opening?: OpeningWindow;
}
export interface TripInput {
  origin: OutingNode;
  stops: TripStop[];
  bundle: RouteBundle;
  draft: PlanningDraft;
  shopping: ShoppingBook;
  preferences: JourneyPreferences;
  movement: MovementSettings;
}
export interface TripPlan {
  id: string;
  labels: string[];
  stopIds: string[];
  legs: ReturnType<typeof planMovement>["legs"];
  minutes: number;
  walking: number;
  meters: number;
  finish: string;
  gap: number;
  purchases: Purchase[];
  low: number;
  high: number;
  priceComplete: boolean;
  budget: "within" | "over" | "unknown" | "unset";
  missed: string[];
  notes: string[];
}
export function tripPreferences(p: JourneyPreferences, d: PlanningDraft) {
  return cleanJourney({
    ...p,
    speedMps: d.speedMps ?? p.speedMps,
    departure: d.departure ?? p.departure,
  });
}
export function tripMovement(m: MovementSettings, d: PlanningDraft) {
  const easyMps = d.speedMps ?? m.easyMps;
  return cleanMovement({
    ...m,
    easyMps,
    mode: m.briskMps <= easyMps ? "easy" : m.mode,
    targetMinutes: d.walkingMinutes ?? m.targetMinutes,
    returnEasy: d.returnEasy ?? m.returnEasy,
  });
}
export function solveTrip(input: TripInput) {
  const d = cleanPlanning(input.draft),
    shopping = cleanShopping(input.shopping),
    p = tripPreferences(input.preferences, d),
    m = tripMovement(input.movement, d),
    budget = d.tripMinutes ?? 45;
  const nodes = [input.origin, ...input.stops];
  nodes.forEach(cleanNode);
  for (const stop of input.stops) {
    if (
      !Number.isFinite(stop.stay) ||
      stop.stay < 0 ||
      stop.stay > 60 ||
      typeof stop.category !== "string" ||
      stop.category.length > 40
    )
      throw new Error("请核对候选地点类别和0—60分钟的停留时间。");
    if (stop.opening) openingDelayForRemaining(0, stop.stay, stop.opening);
  }
  if (
    input.stops.length > 5 ||
    new Set(nodes.map((n) => n.id)).size !== nodes.length ||
    nodes.some(
      (n) =>
        !input.bundle.nodes.some(
          (b) =>
            b.id === n.id &&
            JSON.stringify(b.position) === JSON.stringify(n.position),
        ),
    ) ||
    new Set(nodes.map((n) => n.position.system === "demo")).size > 1
  )
    throw new Error("请选择最多五个不同的候选地点，并重新读取匹配的路线。");
  const edge = (a: string, b: string) =>
    input.bundle.edges.find((e) => e.from === a && e.to === b)?.travel;
  const plans: TripPlan[] = [];
  let evaluated = 0;
  const visit = (used: TripStop[]) => {
    if (used.length) {
      const all = [
        ...used,
        {
          ...input.origin,
          name: `回到${input.origin.name}`,
          stay: 0,
          category: "home",
        },
      ];
      const distances = all.map((n, i) =>
        edge(i ? all[i - 1].id : input.origin.id, n.id),
      );
      if (
        distances.every(
          (t) =>
            t?.status === "ok" &&
            Number.isFinite(t.meters) &&
            t.meters >= 0 &&
            t.meters <= 50000,
        )
      ) {
        evaluated++;
        const movement = planMovement(
          {
            source: "errands",
            mode: input.bundle.mode,
            origin: input.origin.name,
            generatedAt: input.bundle.generatedAt,
            originalMinutes: budget,
            budgetMinutes: budget,
            prefs: p,
            stops: all.map((n, i) => ({
              id: n.id,
              name: n.name,
              meters: distances[i]!.status === "ok" ? distances[i]!.meters : 0,
              stayMinutes: n.stay,
              ...(n.opening ? { opening: n.opening } : {}),
            })),
          },
          m,
        );
        if (movement.feasible) {
          const purchases: Purchase[] = shopping.items.map((item) => {
            const hit = matchingQuotes(
              item,
              used,
              shopping.prices,
              shopping.blocked,
            )[0];
            return {
              item,
              quote: hit?.quote ?? null,
              known: hit?.known ?? false,
              reason: hit?.reason ?? "没有匹配规格的商品记录",
            };
          });
          const low =
              purchases.reduce(
                (v, r) =>
                  v +
                  (r.known
                    ? Math.round(r.quote!.low! * 100) * r.item.quantity
                    : 0),
                0,
              ) / 100,
            high =
              purchases.reduce(
                (v, r) =>
                  v +
                  (r.known
                    ? Math.round(r.quote!.high! * 100) * r.item.quantity
                    : 0),
                0,
              ) / 100,
            priceComplete = purchases.every((r) => r.known),
            missed = [
              ...d.tasks
                .filter((t) => !used.some((n) => n.category === t))
                .map((t) => planningTasks.find((x) => x.id === t)!.label),
              ...purchases
                .filter((r) => !r.quote)
                .map((r) => `购买${r.item.name}`),
            ];
          const shops = new Set(
            purchases.filter((r) => r.quote).map((r) => r.quote!.store.id),
          );
          // Optional detours must be an explicitly selected park or serve a task/purchase.
          if (
            shops.size <= shopping.options.maxShops &&
            used.every(
              (n) =>
                shops.has(n.id) ||
                d.tasks.includes(n.category) ||
                (n.category === "park" && d.walkingMinutes !== null),
            )
          )
            plans.push({
              id: used.map((n) => n.id).join(">"),
              labels: [],
              stopIds: used.map((n) => n.id),
              legs: movement.legs,
              minutes: movement.totalMinutes,
              walking: movement.walkingMinutes,
              meters: movement.meters,
              finish: movement.finish,
              gap: d.walkingMinutes === null ? 0 : movement.targetMissing,
              purchases,
              low,
              high,
              priceComplete,
              budget: !priceComplete
                ? "unknown"
                : d.shoppingBudget === null
                  ? "unset"
                  : high <= d.shoppingBudget
                    ? "within"
                    : "over",
              missed,
              notes: movement.notes,
            });
        }
      }
    }
    for (const n of input.stops.filter((n) => !used.some((u) => u.id === n.id)))
      visit([...used, n]);
  };
  visit([]);
  if (!plans.length)
    return {
      plans: [],
      evaluated,
      note: "当前地点、时间或连续步行限制下没有可核算的往返方案。请调整条件或补充路线；不会用直线距离代替缺失道路。",
    };
  const leastMissed = Math.min(...plans.map((p) => p.missed.length));
  let pool = plans.filter((p) => p.missed.length === leastMissed);
  if (pool.some((p) => p.budget !== "over"))
    pool = pool.filter((p) => p.budget !== "over");
  const fast = [...pool].sort((a, b) => a.minutes - b.minutes)[0];
  const cheap = [...pool]
    .filter((p) => p.priceComplete && p.purchases.length)
    .sort((a, b) => a.high - b.high || a.minutes - b.minutes)[0];
  const active = [...pool].sort(
    (a, b) => a.gap - b.gap || a.minutes - b.minutes,
  )[0];
  const chosen: TripPlan[] = [];
  for (const [plan, label] of [
    [fast, "早点回来"],
    [cheap, "少花一点"],
    [d.walkingMinutes ? active : undefined, "兼顾步行"],
  ] as const) {
    if (!plan) continue;
    const old = chosen.find((p) => p.id === plan.id);
    if (old) old.labels.push(label);
    else chosen.push({ ...plan, labels: [label] });
  }
  return {
    plans: chosen,
    evaluated,
    note: "只比较勾选地点和已记录商品。同规格报价未必是实时售价；营业时间未知的地点需出发前确认。",
  };
}

export interface TripEvent {
  kind:
    | "start"
    | "arrive"
    | "leave"
    | "rest"
    | "resume"
    | "skip"
    | "return"
    | "replan";
  at: number;
  placeId: string;
}
export interface ActiveTrip {
  version: 1;
  id: string;
  input: TripInput;
  plan: TripPlan;
  startedAt: number;
  lastAt: number;
  currentId: string;
  remaining: string[];
  completed: string[];
  skipped: string[];
  phase: "walking" | "at" | "resting" | "finished";
  events: TripEvent[];
}
export function startTrip(
  input: TripInput,
  plan: TripPlan,
  now = Date.now(),
): ActiveTrip {
  if (!solveTrip(input).plans.some((p) => p.id === plan.id))
    throw new Error("方案已变化，请重新计算后选择。");
  return {
    version: 1,
    id: `trip-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    input,
    plan,
    startedAt: now,
    lastAt: now,
    currentId: input.origin.id,
    remaining: [...plan.stopIds, input.origin.id],
    completed: [],
    skipped: [],
    phase: "at",
    events: [{ kind: "start", at: now, placeId: input.origin.id }],
  };
}
export function cleanActiveTrip(value: unknown): ActiveTrip {
  const a = value as ActiveTrip;
  if (
    !a ||
    a.version !== 1 ||
    !/^trip-[a-z0-9-]+$/.test(a.id) ||
    !["walking", "at", "resting", "finished"].includes(a.phase) ||
    !Number.isFinite(a.startedAt) ||
    !Number.isFinite(a.lastAt) ||
    a.lastAt < a.startedAt ||
    !Array.isArray(a.events) ||
    a.events.length > 200 ||
    !Array.isArray(a.remaining) ||
    !Array.isArray(a.completed) ||
    !Array.isArray(a.skipped)
  )
    throw new Error("进行中的行程记录无效，请清除本机行程后重新选择。");
  solveTrip(a.input);
  const ids = [a.input.origin.id, ...a.input.stops.map((n) => n.id)];
  if (
    ![a.currentId, ...a.remaining, ...a.completed, ...a.skipped].every((id) =>
      ids.includes(id),
    ) ||
    new Set(a.remaining).size !== a.remaining.length ||
    a.events.some(
      (e) =>
        !Number.isFinite(e.at) ||
        e.at < a.startedAt ||
        !ids.includes(e.placeId),
    ) ||
    !a.plan ||
    !Array.isArray(a.plan.legs)
  )
    throw new Error("进行中的地点记录无效。");
  return a;
}
export function stepTrip(
  value: ActiveTrip,
  kind: Exclude<TripEvent["kind"], "start" | "replan">,
  now = Date.now(),
): ActiveTrip {
  const a = structuredCopy(value);
  if (!["arrive", "leave", "rest", "resume", "skip", "return"].includes(kind))
    throw new Error("未知的行程操作。");
  if (
    !Number.isFinite(now) ||
    now < a.lastAt ||
    now - a.startedAt > 24 * 3600_000
  )
    throw new Error("记录时钟有变化或行程已超过一天，请先结束并记录。");
  if (a.phase === "finished" || a.events.length >= 200)
    throw new Error("这趟行程已结束或记录过多。");
  if (kind === "arrive") {
    if (a.phase !== "walking" || !a.remaining.length)
      throw new Error("请先开始前往下一站。");
    a.currentId = a.remaining.shift()!;
    a.completed.push(a.currentId);
    a.phase = a.currentId === a.input.origin.id ? "finished" : "at";
  } else if (kind === "leave") {
    if (a.phase !== "at" || !a.remaining.length)
      throw new Error("先确认当前位置，再前往下一站。");
    a.phase = "walking";
  } else if (kind === "rest") {
    if (a.phase !== "at")
      throw new Error("到达已确认地点、找到可安全停留的位置后再记录歇脚。");
    a.phase = "resting";
  } else if (kind === "resume") {
    if (a.phase !== "resting") throw new Error("当前没有歇脚记录。");
    a.phase = "at";
  } else if (kind === "skip") {
    if (a.phase !== "at" || a.remaining.length < 2)
      throw new Error("只能在已确认地点取消尚未前往的一站，返程不能取消。");
    a.skipped.push(a.remaining.shift()!);
  } else if (kind === "return") {
    if (a.phase !== "at" || a.currentId === a.input.origin.id)
      throw new Error("请到达并确认一个地点，再计算从该处返程。");
    a.skipped.push(...a.remaining.filter((id) => id !== a.input.origin.id));
    a.remaining = [a.input.origin.id];
  }
  a.lastAt = now;
  a.events.push({ kind, at: now, placeId: a.currentId });
  return a;
}
const structuredCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function currentStay(a: ActiveTrip, now: number) {
  if (a.phase === "walking" || a.currentId === a.input.origin.id) return 0;
  const stop = a.input.stops.find((n) => n.id === a.currentId);
  let index = -1;
  a.events.forEach((e, i) => {
    if (e.kind === "arrive") index = i;
  });
  if (
    !stop ||
    index < 0 ||
    a.events.slice(index + 1).some((e) => e.kind === "return")
  )
    return 0;
  const arrival = a.events[index].at,
    date = new Date(arrival);
  const delay = openingDelayForRemaining(
    date.getHours() * 60 + date.getMinutes(),
    stop.stay,
    stop.opening,
  );
  if (!Number.isFinite(delay)) return Infinity;
  const availableAt = arrival + delay * 60000;
  let cursor = arrival,
    resting = false,
    activeMs = 0;
  for (const event of [
    ...a.events.slice(index + 1),
    { kind: "now", at: now },
  ]) {
    if (!resting)
      activeMs += Math.max(0, event.at - Math.max(cursor, availableAt));
    if (event.kind === "rest") resting = true;
    if (event.kind === "resume") resting = false;
    cursor = event.at;
  }
  const stay = Math.max(0, stop.stay - activeMs / 60000),
    current = new Date(now);
  if (stay === 0) return 0;
  return (
    stay +
    openingDelayForRemaining(
      current.getHours() * 60 + current.getMinutes(),
      stay,
      stop.opening,
    )
  );
}
export function remainingTrip(a: ActiveTrip, now = Date.now()) {
  if (a.phase === "finished")
    return {
      finish: "已回到出发点",
      minutes: 0,
      late: 0,
      note: "到达由你手动确认。",
    };
  const spent = Math.max(0, (now - a.startedAt) / 60000),
    start = new Date(now),
    p = tripPreferences(a.input.preferences, a.input.draft);
  p.departure = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  let elapsed = currentStay(a, now),
    at = a.currentId;
  if (!Number.isFinite(elapsed))
    return {
      finish: "营业时间不匹配",
      minutes: null,
      late: null,
      note: "当前地点的剩余停留无法放进记录的营业窗口，可直接返程或重新规划。",
    };
  const m = tripMovement(a.input.movement, a.input.draft);
  for (const id of a.remaining) {
    const edge = a.input.bundle.edges.find(
      (e) => e.from === at && e.to === id,
    )?.travel;
    if (edge?.status !== "ok")
      return {
        finish: "路线待补充",
        minutes: null,
        late: null,
        note: "没有当前地点到下一站的已知道路，不能估计返程。",
      };
    const dest = a.input.stops.find((n) => n.id === id),
      returning = id === a.input.origin.id;
    // Remaining estimates use the user's comfortable pace after a manual stop.
    const speed = m.easyMps;
    const e = estimateLeg(edge.meters, p, elapsed, speed);
    const stay = returning ? 0 : (dest?.stay ?? 0);
    const delay = dest?.opening
      ? openingDelayForRemaining(
          clockMinute(p.departure) + elapsed + e,
          stay,
          dest.opening,
        )
      : 0;
    if (!Number.isFinite(delay))
      return {
        finish: "营业时间不匹配",
        minutes: null,
        late: null,
        note: "下一站的停留无法放进记录的营业窗口，请取消该站或重新规划。",
      };
    elapsed += e + stay + delay;
    at = id;
  }
  return {
    finish: formatClock(clockMinute(p.departure) + elapsed),
    minutes: elapsed,
    late: Math.max(0, spent + elapsed - (a.input.draft.tripMinutes ?? 45)),
    note:
      a.phase === "walking"
        ? "以最后确认地点重新估计整段，未跟踪实时位置；到达后会更新。"
        : "从当前确认地点按舒适步速重新估计，含尚未完成的计划停留；歇脚不算办事时间，之后额外歇脚需另计。",
  };
}
import { estimateJourney } from "./journey.js";
import { openingDelay as openingDelayForRemaining } from "./outings.js";
function estimateLeg(
  meters: number,
  p: JourneyPreferences,
  elapsed: number,
  speed: number,
) {
  return (
    estimateJourney(meters, { ...p, speedMps: speed }, elapsed * 60).seconds /
    60
  );
}

export {
  cleanTripFeedback,
  feedbackPace,
  type TripFeedback,
} from "./trip-feedback.js";
