import {
  cleanActiveTrip,
  remainingTrip,
  type ActiveTrip,
  type TripStop,
} from "./trip.js";
import { cleanNode, type RouteBundle } from "./outings.js";
import { matchingQuotes } from "./shopping.js";
import { tripBasis } from "./trip-adjust.js";
import { noticeDistance } from "./neighborhood.js";

export type AlternativeKind = "place" | "entrance";
export function alternativeInput(
  value: ActiveTrip,
  candidate: TripStop,
  kind: AlternativeKind,
) {
  const a = JSON.parse(JSON.stringify(cleanActiveTrip(value))) as ActiveTrip;
  if (a.phase !== "at" || a.remaining.length < 2)
    throw new Error("请在已确认地点、结束歇脚后，再替换尚未前往的下一站。");
  if (!a.remaining.length || (a.replacements?.length ?? 0) >= 5)
    throw new Error("这趟替换记录已满，请结束记录后重新规划。");
  const old = a.input.stops.find((n) => n.id === a.remaining[0])!;
  const node = cleanNode(candidate);
  if (
    !["place", "entrance"].includes(kind) ||
    candidate.category !== old.category ||
    node.id === a.currentId ||
    node.id === a.input.origin.id ||
    a.remaining.includes(node.id) ||
    a.completed.includes(node.id) ||
    a.skipped.includes(node.id) ||
    (node.position.system === "demo") !== (a.input.bundle.mode === "demo")
  )
    throw new Error("请选未安排的同类地点，或你确认属于原目的地的入口。");
  const distance = noticeDistance(node.position, old.position);
  if (
    !Number.isFinite(distance) ||
    distance > (kind === "entrance" ? 500 : 2000)
  )
    throw new Error(
      kind === "entrance"
        ? "入口参考点应在原地点500米以内，且坐标系统可比较。"
        : "请选原地点2公里内、坐标系统可比较的同类候选地点。",
    );
  const existing = a.input.stops.find((n) => n.id === node.id);
  if (
    existing &&
    JSON.stringify(existing.position) !== JSON.stringify(node.position)
  )
    throw new Error("候选地点的位置已变化，请重新打开对应报告。");
  if (!existing) {
    // Remove only unused comparison candidates, never a planned or visited place.
    const protectedIds = new Set([
      a.currentId,
      ...a.remaining,
      ...a.completed,
      ...a.skipped,
      ...a.plan.stopIds,
      ...a.events.map((e) => e.placeId),
    ]);
    if (a.input.stops.length >= 5) {
      const unused = a.input.stops.find((n) => !protectedIds.has(n.id));
      if (!unused)
        throw new Error(
          "这趟已保留五个行程地点，无法再加入新点；可选择已核算的备选地点或取消下一站。",
        );
      a.input.stops = a.input.stops.filter((n) => n.id !== unused.id);
    }
    a.input.stops.push({
      ...node,
      category: candidate.category,
      stay: candidate.stay,
      ...(candidate.opening ? { opening: candidate.opening } : {}),
    });
  }
  const nodes = [a.input.origin, ...a.input.stops];
  const pairs: [string, string][] = [
    [a.currentId, node.id],
    [node.id, a.remaining[1]],
  ];
  return { active: a, old, nodes, pairs };
}

export function alternativePrice(a: ActiveTrip) {
  const visitedAndRemaining = new Set([
    ...a.completed,
    a.currentId,
    ...a.remaining,
  ]);
  const stores = a.input.stops.filter((n) => visitedAndRemaining.has(n.id));
  let low = 0,
    high = 0,
    missing = 0;
  for (const item of a.input.shopping.items) {
    const q = matchingQuotes(
      item,
      stores,
      a.input.shopping.prices,
      a.input.shopping.blocked,
    )[0];
    if (q?.known) {
      low += q.quote.low! * item.quantity;
      high += q.quote.high! * item.quantity;
    } else missing++;
  }
  const budget = a.input.draft.shoppingBudget;
  return {
    low,
    high,
    missing,
    label: !a.input.shopping.items.length
      ? "没有购物清单"
      : missing === a.input.shopping.items.length
        ? `${missing}项均缺价，预算待确认`
        : `${missing ? "仅已知部分" : "清单参考价"} ¥${low.toFixed(2)}—${high.toFixed(2)}${missing ? `；${missing}项缺价，预算待确认` : budget !== null && high > budget ? "；预计超出购物预算" : ""}`,
  };
}

export function replaceNextStop(
  value: ActiveTrip,
  candidate: TripStop,
  kind: AlternativeKind,
  routes: RouteBundle,
  now = Date.now(),
) {
  const {
    active: a,
    old,
    nodes,
    pairs,
  } = alternativeInput(value, candidate, kind);
  if (
    !Number.isFinite(now) ||
    now < a.lastAt ||
    now - a.startedAt > 86400000 ||
    a.events.length >= 200
  )
    throw new Error("行程记录已过期或时钟变化，请先结束记录。");
  if (
    routes.mode !== a.input.bundle.mode ||
    pairs.some(([from, to]) => {
      const ends = [from, to];
      return (
        ends.some(
          (id) =>
            JSON.stringify(routes.nodes.find((n) => n.id === id)?.position) !==
            JSON.stringify(nodes.find((n) => n.id === id)?.position),
        ) ||
        !routes.edges.some(
          (e) =>
            e.from === from &&
            e.to === to &&
            e.travel.status === "ok" &&
            Number.isFinite(e.travel.meters) &&
            e.travel.meters >= 0 &&
            e.travel.meters <= 50000,
        )
      );
    })
  )
    throw new Error("备选去程或接续路线缺失；原行程保留，请稍后重试。");
  const extra = pairs.map(([from, to]) =>
    routes.edges.find((e) => e.from === from && e.to === to)!,
  );
  a.input.bundle = {
    ...a.input.bundle,
    nodes,
    generatedAt: routes.generatedAt,
    edges: [
      ...a.input.bundle.edges.filter(
        (e) =>
          nodes.some((n) => n.id === e.from) &&
          nodes.some((n) => n.id === e.to) &&
          !extra.some((x) => x.from === e.from && x.to === e.to),
      ),
      ...extra,
    ],
  };
  a.remaining[0] = candidate.id;
  a.skipped = [...a.skipped, old.id];
  a.lastAt = now;
  a.events.push({ kind: "replan", at: now, placeId: a.currentId });
  a.replacements = [
    ...(a.replacements ?? []),
    { from: old.id, to: candidate.id, kind, at: now },
  ];
  cleanActiveTrip(a);
  const beforeEstimate = remainingTrip(value, now),
    estimate = remainingTrip(a, now);
  if (estimate.minutes === null) throw new Error(estimate.note);
  const price = alternativePrice(a),
    oldPrice = alternativePrice(value);
  const meters = (trip: ActiveTrip) =>
    [trip.currentId, ...trip.remaining].slice(1).reduce((sum, id, i) => {
      const t = trip.input.bundle.edges.find(
        (e) => e.from === [trip.currentId, ...trip.remaining][i] && e.to === id,
      )?.travel;
      return t?.status === "ok" ? sum + t.meters : NaN;
    }, 0);
  return {
    active: a,
    before: tripBasis(value),
    estimate,
    price,
    changes: [
      `${old.name} → ${candidate.name}${kind === "entrance" ? "（本人选择的另一入口，尚待确认通行）" : ""}`,
      `剩余路程：${Number.isFinite(meters(value)) ? Math.round(meters(value)) + "米" : "待补充"} → ${Math.round(meters(a))}米`,
      `剩余用时：${beforeEstimate.minutes === null ? "待确认" : beforeEstimate.minutes.toFixed(1) + "分钟"} → ${estimate.minutes.toFixed(1)}分钟；预计${estimate.finish}返回${estimate.late! > 0 ? `，超出整趟上限约${estimate.late!.toFixed(1)}分钟` : ""}`,
      `原安排：${oldPrice.label}。替换后：${price.label}。`,
      "按整张清单和已记录标价比较，实际已购与花费待本人确认；原店价格不自动套给新地点。",
      "这里只更换目的地，不会自动绕过反馈路段；请获取新路段指引并核对邻里提醒。",
    ],
  };
}
