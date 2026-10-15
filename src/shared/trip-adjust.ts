import { cleanActiveTrip, remainingTrip, type ActiveTrip } from "./trip.js";

export interface TripAdjustment {
  remaining: string[];
  speedMps: number;
}
export const tripBasis = (a: ActiveTrip) =>
  JSON.stringify({
    id: a.id,
    at: a.lastAt,
    count: a.events.length,
    phase: a.phase,
    here: a.currentId,
    remaining: a.remaining,
    speed: a.input.draft.speedMps,
    replacements: a.replacements ?? [],
  });
export function adjustTrip(
  value: ActiveTrip,
  change: TripAdjustment,
  now = Date.now(),
) {
  const a: ActiveTrip = JSON.parse(JSON.stringify(cleanActiveTrip(value)));
  if (a.phase !== "at")
    throw new Error("请先到达并确认一个地点，结束歇脚后再调整行程。");
  if (
    !Number.isFinite(now) ||
    now < a.lastAt ||
    now - a.startedAt > 86400000 ||
    a.events.length >= 200
  )
    throw new Error("这趟记录已过期或时钟有变化，请先结束记录。");
  const home = a.input.origin.id;
  if (
    !Array.isArray(change.remaining) ||
    change.remaining.length > 5 ||
    new Set(change.remaining).size !== change.remaining.length ||
    !change.remaining.every((id) => id !== home && a.remaining.includes(id))
  )
    throw new Error("只能调整尚未前往的地点，返程会自动保留。");
  if (
    !Number.isFinite(change.speedMps) ||
    change.speedMps < 0.3 ||
    change.speedMps > 2
  )
    throw new Error("请填写0.3—2米/秒的舒适步速。");
  if (!change.remaining.length && a.currentId === home)
    throw new Error("尚未离开出发点，请保留一个目的地或结束这趟记录。");
  const skipped = a.remaining.filter(
    (id) => id !== home && !change.remaining.includes(id),
  );
  a.skipped = [...new Set([...a.skipped, ...skipped])];
  a.remaining = [...change.remaining, home];
  a.input.draft.speedMps = change.speedMps;
  a.lastAt = now;
  a.events.push({
    kind: change.remaining.length ? "replan" : "return",
    at: now,
    placeId: a.currentId,
  });
  const estimate = remainingTrip(a, now);
  if (estimate.minutes === null) throw new Error(estimate.note);
  const name = (id: string) =>
    a.input.stops.find((n) => n.id === id)?.name ?? "出发点";
  const unfinished = value.plan.purchases
    .filter((p) => p.quote && skipped.includes(p.quote.store.id))
    .map((p) => p.item.name);
  return {
    active: a,
    estimate,
    before: tripBasis(value),
    changes: [
      `剩余顺序：${change.remaining.map(name).concat(`回到${a.input.origin.name}`).join(" → ")}`,
      `本次舒适步速：${change.speedMps}米/秒`,
      ...(skipped.length ? [`取消：${skipped.map(name).join("、")}`] : []),
      ...(unfinished.length
        ? [
            `原计划在取消地点购买的商品尚未安排：${[...new Set(unfinished)].join("、")}`,
          ]
        : []),
      `预计${estimate.finish}返回${estimate.late > 0 ? `，比整趟上限晚约${estimate.late.toFixed(1)}分钟` : ""}`,
      "已到达记录和原预算保留；购物完成情况与实际花费仍由本人确认。",
    ],
  };
}
