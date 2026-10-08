import {
  cleanJourney,
  clockMinute,
  signalWaitSeconds,
  type JourneyPreferences,
} from "./journey.js";
import {
  formatClock,
  openingDelay,
  todayLocal,
  validDate,
  type OpeningWindow,
  type Visit,
  type RestPoint,
} from "./outings.js";

export interface MovementSettings {
  mode: "easy" | "alternating";
  easyMps: number;
  briskMps: number;
  targetMinutes: number;
  maxExtraMinutes: number;
  warmMinutes: number;
  briskMinutes: number;
  recoverMinutes: number;
  returnEasy: boolean;
  continuousMinutes: number;
}
export const defaultMovement = (speed = 1.2): MovementSettings => ({
  mode: "easy",
  easyMps: speed,
  briskMps: Math.min(2, speed + 0.2),
  targetMinutes: 20,
  maxExtraMinutes: 10,
  warmMinutes: 2,
  briskMinutes: 2,
  recoverMinutes: 2,
  returnEasy: true,
  continuousMinutes: 0,
});
const number = (v: unknown, low: number, high: number, name: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < low || v > high)
    throw new Error(`${name}需为${low}—${high}。`);
  return v;
};
const text = (v: unknown, limit = 100) => {
  if (typeof v !== "string" || !v.trim() || v.length > limit)
    throw new Error("行程名称或格式无效，请重新选择方案。");
  return v.trim();
};
export function cleanMovement(value: unknown): MovementSettings {
  const s = value as MovementSettings;
  if (
    !s ||
    !["easy", "alternating"].includes(s.mode) ||
    typeof s.returnEasy !== "boolean"
  )
    throw new Error("请选择步行节奏。");
  const easyMps = number(s.easyMps, 0.3, 2, "轻松步速（米/秒）"),
    briskMps = number(s.briskMps, 0.3, 2, "稍快步速（米/秒）");
  if (s.mode === "alternating" && briskMps <= easyMps)
    throw new Error("交替走的稍快步速应高于轻松步速，也可以改用全程轻松走。");
  return {
    mode: s.mode,
    easyMps,
    briskMps,
    targetMinutes: number(s.targetMinutes, 1, 90, "希望步行分钟数"),
    maxExtraMinutes: number(s.maxExtraMinutes, 0, 60, "最多额外用时"),
    warmMinutes: number(s.warmMinutes, 0, 10, "舒缓开走分钟数"),
    briskMinutes: number(s.briskMinutes, 1, 10, "每段稍快走分钟数"),
    recoverMinutes: number(s.recoverMinutes, 1, 10, "每段轻松走分钟数"),
    returnEasy: s.returnEasy,
    continuousMinutes: number(
      s.continuousMinutes,
      0,
      60,
      "连续步行上限（0为不限）",
    ),
  };
}
export interface MovementStop {
  id: string;
  name: string;
  meters: number;
  stayMinutes: number;
  opening?: OpeningWindow;
  rest?: { checkedOn: string; validUntil: string };
}
export interface MovementTrip {
  source: "errands" | "shopping" | "example";
  mode: "demo" | "baidu";
  origin: string;
  generatedAt: string;
  originalMinutes: number;
  budgetMinutes: number;
  prefs: JourneyPreferences;
  stops: MovementStop[];
}
export function cleanMovementTrip(value: unknown): MovementTrip {
  const t = value as MovementTrip;
  if (
    !t ||
    !["errands", "shopping", "example"].includes(t.source) ||
    !["demo", "baidu"].includes(t.mode) ||
    !Array.isArray(t.stops) ||
    t.stops.length < 2 ||
    t.stops.length > 6 ||
    typeof t.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(t.generatedAt))
  )
    throw new Error("请先选择包含返程的办事或购物方案。");
  const stops = t.stops.map((s): MovementStop => {
    if (!s) throw new Error("行程路段缺失。");
    let opening: OpeningWindow | undefined;
    if (s.opening) {
      if (clockMinute(s.opening.start) === clockMinute(s.opening.end))
        throw new Error("营业窗口无效。");
      opening = { start: s.opening.start, end: s.opening.end };
    }
    if (
      s.rest &&
      (!validDate(s.rest.checkedOn) ||
        !validDate(s.rest.validUntil) ||
        s.rest.checkedOn > todayLocal() ||
        s.rest.validUntil < s.rest.checkedOn ||
        Date.parse(s.rest.validUntil) - Date.parse(s.rest.checkedOn) >
          90 * 86400000)
    )
      throw new Error("休息点核验记录无效。");
    return {
      id: text(s.id, 80),
      name: text(s.name),
      meters: number(s.meters, 0, 50000, "路段距离"),
      stayMinutes: number(s.stayMinutes, 0, 60, "停留分钟数"),
      ...(opening ? { opening } : {}),
      ...(s.rest
        ? {
            rest: {
              checkedOn: s.rest.checkedOn,
              validUntil: s.rest.validUntil,
            },
          }
        : {}),
    };
  });
  if (
    new Set(stops.map((s) => s.id)).size !== stops.length ||
    stops.at(-1)!.stayMinutes ||
    stops.at(-1)!.opening ||
    stops.at(-1)!.rest ||
    stops.reduce((v, s) => v + s.meters, 0) > 50000
  )
    throw new Error("往返行程重复或过长，请重新选择较短的方案。");
  return {
    source: t.source,
    mode: t.mode,
    origin: text(t.origin),
    generatedAt: t.generatedAt,
    originalMinutes: number(t.originalMinutes, 0, 180, "原行程用时"),
    budgetMinutes: number(t.budgetMinutes, 5, 180, "整趟预算分钟数"),
    prefs: cleanJourney(t.prefs),
    stops,
  };
}
export function movementTrip(
  visits: Visit[],
  context: Omit<MovementTrip, "stops" | "generatedAt">,
  openings: Record<string, OpeningWindow> = {},
  rest?: RestPoint | null,
) {
  return cleanMovementTrip({
    ...context,
    generatedAt: new Date().toISOString(),
    stops: visits.map((v, i) => ({
      id: v.id,
      name: v.name,
      meters: v.meters,
      stayMinutes: v.stayMinutes,
      ...(i < visits.length - 1 && openings[v.id]
        ? { opening: openings[v.id] }
        : {}),
      ...(rest?.id === v.id
        ? { rest: { checkedOn: rest.checkedOn, validUntil: rest.validUntil } }
        : {}),
    })),
  });
}
export interface MovementPhase {
  kind: "easy" | "brisk" | "wait";
  label: string;
  seconds: number;
  meters: number;
  speed: number | null;
}
export interface MovementLeg {
  name: string;
  arrival: string;
  departure: string;
  phases: MovementPhase[];
  walking: number;
  signalWait: number;
  openingWait: number;
  stay: number;
  rests: boolean;
  meters: number;
}
export function planMovement(input: MovementTrip, settings: MovementSettings) {
  const trip = cleanMovementTrip(input),
    s = cleanMovement(settings),
    p = trip.prefs;
  let walked = 0,
    brisk = 0,
    elapsed = 0,
    continuous = 0,
    longest = 0,
    allWait = 0,
    allStay = 0;
  const legs: MovementLeg[] = [],
    issues: string[] = [],
    notes: string[] = [];
  const start = clockMinute(p.departure);
  for (let index = 0; index < trip.stops.length; index++) {
    const stop = trip.stops[index],
      returning = index === trip.stops.length - 1;
    const phases: MovementPhase[] = [];
    const crossings = p.signals.enabled
      ? Math.floor((stop.meters * p.signals.crossingsPerKm) / 1000)
      : 0;
    let distance = 0,
      seconds = 0,
      wait = 0,
      nextCrossing = 1;
    while (distance < stop.meters - 1e-7) {
      let kind: MovementPhase["kind"] = "easy",
        label = "轻松走",
        phaseRemaining = Infinity;
      if (returning && s.returnEasy) label = "轻松返程";
      else if (s.mode === "alternating") {
        const active = walked + seconds,
          warm = s.warmMinutes * 60;
        if (active < warm - 1e-6) {
          label = "舒缓开走";
          phaseRemaining = warm - active;
        } else {
          const cycle = (s.briskMinutes + s.recoverMinutes) * 60,
            briskEnd = s.briskMinutes * 60,
            raw = Math.max(0, active - warm) % cycle;
          // Snap only sub-microsecond errors at a phase boundary to its next phase.
          const progress =
            raw < 1e-6 || cycle - raw < 1e-6
              ? 0
              : Math.abs(raw - briskEnd) < 1e-6
                ? briskEnd
                : raw;
          if (progress < briskEnd) {
            kind = "brisk";
            label = "稍快走";
            phaseRemaining = briskEnd - progress;
          } else {
            label = "轻松调整";
            phaseRemaining = cycle - progress;
          }
        }
      }
      const speed = kind === "brisk" ? s.briskMps : s.easyMps;
      const boundary =
        nextCrossing <= crossings
          ? (nextCrossing * 1000) / p.signals.crossingsPerKm
          : Infinity;
      const meters = Math.min(
        stop.meters - distance,
        phaseRemaining * speed,
        boundary - distance,
      );
      if (meters < 1e-7)
        throw new Error("节奏计算无法继续，请调整步速后重试。");
      const duration = meters / speed;
      const previous = phases.at(-1);
      if (previous?.kind === kind && previous.label === label) {
        previous.seconds += duration;
        previous.meters += meters;
      } else phases.push({ kind, label, seconds: duration, meters, speed });
      distance += meters;
      seconds += duration;
      if (kind === "brisk") brisk += duration;
      if (Math.abs(distance - boundary) < 1e-6) {
        const delay = signalWaitSeconds(p, elapsed + seconds + wait);
        if (delay)
          phases.push({
            kind: "wait",
            label: "等灯预估",
            seconds: delay,
            meters: 0,
            speed: null,
          });
        wait += delay;
        nextCrossing++;
      }
      if (phases.length > 240 || seconds > 180 * 60)
        throw new Error("这段路按当前步速过长，请缩短行程或调整安排。");
    }
    continuous += seconds;
    longest = Math.max(longest, continuous);
    walked += seconds;
    const arrival = elapsed + seconds + wait;
    const opening =
      openingDelay(start + arrival / 60, stop.stayMinutes, stop.opening) * 60;
    const closed = !Number.isFinite(opening);
    const openingWait = closed ? 0 : opening,
      stay = closed ? 0 : stop.stayMinutes;
    if (closed) {
      issues.push(`${stop.name}的停留无法放进所填营业时段。`);
    }
    const rests =
      !closed &&
      !!stop.rest &&
      stop.rest.validUntil >= todayLocal() &&
      stop.stayMinutes >= 1;
    if (!returning && !stop.rest && !stop.opening)
      notes.push(`${stop.name}的营业时间尚未确认。`);
    if (stop.rest && !rests)
      notes.push(`${stop.name}的休息核验已过期或停留不足，未当作歇脚。`);
    if (rests) continuous = 0;
    elapsed = arrival + openingWait + stay * 60;
    allWait += wait + openingWait;
    allStay += stay * 60;
    legs.push({
      name: stop.name,
      arrival: formatClock(start + arrival / 60),
      departure: formatClock(start + elapsed / 60),
      phases,
      walking: seconds / 60,
      signalWait: wait / 60,
      openingWait: openingWait / 60,
      stay,
      rests,
      meters: stop.meters,
    });
    if (closed) break;
  }
  const extra = elapsed / 60 - trip.originalMinutes;
  if (elapsed / 60 > trip.budgetMinutes + 1e-7)
    issues.push(
      `整趟超出原定时间${(elapsed / 60 - trip.budgetMinutes).toFixed(1)}分钟。`,
    );
  if (extra > s.maxExtraMinutes + 1e-7)
    issues.push(
      `比原方案多用${extra.toFixed(1)}分钟，超过允许的${s.maxExtraMinutes}分钟。`,
    );
  if (s.continuousMinutes && longest / 60 > s.continuousMinutes + 1e-7)
    issues.push(
      `最长连续步行${(longest / 60).toFixed(1)}分钟，超过设定上限；请从原行程增加已核验的休息点。`,
    );
  if (legs.length !== trip.stops.length && !issues.length)
    issues.push("未能核算完整返程。");
  const missing = Math.max(0, s.targetMinutes - walked / 60);
  return {
    legs,
    complete: legs.length === trip.stops.length,
    feasible: !issues.length,
    issues,
    notes,
    walkingMinutes: walked / 60,
    briskMinutes: brisk / 60,
    waitingMinutes: allWait / 60,
    stayMinutes: allStay / 60,
    totalMinutes: elapsed / 60,
    finish: formatClock(start + elapsed / 60),
    extraMinutes: extra,
    longestMinutes: longest / 60,
    targetMissing: missing,
    meters: trip.stops.reduce((v, r) => v + r.meters, 0),
    mode: trip.mode,
  };
}
export function demoMovementTrip(): MovementTrip {
  return cleanMovementTrip({
    source: "example",
    mode: "demo",
    origin: "里巷中心",
    generatedAt: new Date().toISOString(),
    originalMinutes: 1600 / 1.2 / 60 + 7,
    budgetMinutes: 45,
    prefs: {
      minutes: 15,
      speedMps: 1.2,
      departure: "09:00",
      signals: {
        enabled: false,
        crossingsPerKm: 2,
        offPeakSeconds: 20,
        peakSeconds: 50,
        morningStart: "07:00",
        morningEnd: "09:00",
        eveningStart: "17:00",
        eveningEnd: "19:00",
      },
    },
    stops: [
      { id: "market", name: "示例菜场", meters: 600, stayMinutes: 5 },
      {
        id: "seat",
        name: "示例歇脚点",
        meters: 200,
        stayMinutes: 2,
        rest: { checkedOn: todayLocal(), validUntil: todayLocal() },
      },
      { id: "home", name: "回到里巷中心", meters: 800, stayMinutes: 0 },
    ],
  });
}
