import {
  cleanJourney,
  clockMinute,
  type JourneyPreferences,
} from "./journey.js";
import {
  cleanNode,
  cleanRestPoint,
  formatClock,
  leg,
  openingDelay,
  todayLocal,
  validDate,
  type OutingNode,
  type RestPoint,
  type RouteBundle,
  type Visit,
} from "./outings.js";

export interface Product {
  name: string;
  spec: string;
  unit: string;
  brand: string;
}
export interface ShoppingItem extends Product {
  id: string;
  quantity: number;
  alternatives: boolean;
}
export interface PriceRecord {
  id: string;
  store: OutingNode;
  product: Product;
  kind: "item" | "person" | "visit";
  low: number | null;
  high: number | null;
  observedOn: string;
  validDays: number;
  stock: "seen" | "unknown" | "out";
  source: "paid" | "noted";
  liked: boolean;
}
export interface ShoppingOptions {
  money: number;
  minutes: number;
  maxShops: number;
  detour: number;
  stay: number;
  continuous: number;
  rest: number;
}
export interface ShoppingBook {
  items: ShoppingItem[];
  options: ShoppingOptions;
  prices: PriceRecord[];
  blocked: string[];
}
export interface ShoppingStore extends OutingNode {
  open?: string;
  close?: string;
}
export interface Purchase {
  item: ShoppingItem;
  quote: PriceRecord | null;
  known: boolean;
  reason: string;
}
export interface ShoppingPlan {
  visits: Visit[];
  purchases: Purchase[];
  missing: string[];
  low: number;
  high: number;
  unknown: number;
  completePrice: boolean;
  budget: "within" | "over" | "unknown";
  totalMinutes: number;
  walkingMinutes: number;
  finish: string;
  labels: string[];
  comparison: string;
  unknownOpening: string[];
}
export const defaultShopping = (): ShoppingBook => ({
  items: [],
  prices: [],
  blocked: [],
  options: {
    money: 50,
    minutes: 45,
    maxShops: 2,
    detour: 8,
    stay: 5,
    continuous: 0,
    rest: 2,
  },
});
const str = (v: unknown, max: number, required = true): string => {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw new Error("请补齐商品名称、规格和单位，并检查文字长度。");
  return v.trim();
};
const num = (v: unknown, min: number, max: number, label: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`${label}需为${min}—${max}。`);
  return v;
};
const integer = (v: unknown, min: number, max: number, label: string) => {
  const n = num(v, min, max, label);
  if (!Number.isInteger(n)) throw new Error(`${label}请填写整数。`);
  return n;
};
const ident = (v: unknown) => {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(v))
    throw new Error("购物记录编号无效。");
  return v;
};
export function cleanProduct(v: unknown, partial = false): Product {
  const p = v as Product;
  if (!p) throw new Error("商品资料不完整。");
  return {
    name: str(p.name, 60, !partial),
    spec: str(p.spec, 80, !partial),
    unit: str(p.unit, 12, !partial),
    brand: str(p.brand, 40, false),
  };
}
export const productKey = (p: Product) =>
  JSON.stringify(
    [p.name, p.spec, p.unit, p.brand].map((v) => v.trim().toLowerCase()),
  );
export function cleanShoppingItem(v: unknown, partial = false): ShoppingItem {
  const i = v as ShoppingItem;
  if (!i || typeof i.alternatives !== "boolean")
    throw new Error("购物清单格式无效。");
  return {
    ...cleanProduct(i, partial),
    id: ident(i.id),
    quantity: integer(i.quantity, 1, 99, "购买数量"),
    alternatives: i.alternatives,
  };
}
export function cleanShoppingOptions(v: unknown): ShoppingOptions {
  const o = v as ShoppingOptions;
  if (!o) throw new Error("请设置购物预算。");
  return {
    money: num(o.money, 1, 10000, "消费预算"),
    minutes: num(o.minutes, 5, 180, "整趟分钟数"),
    maxShops: integer(o.maxShops, 1, 3, "最多到店数"),
    detour: num(o.detour, 0, 60, "额外绕路分钟数"),
    stay: num(o.stay, 0, 30, "每店停留分钟数"),
    continuous: num(o.continuous, 0, 60, "连续步行分钟数（0为不限）"),
    rest: num(o.rest, 1, 30, "休息分钟数"),
  };
}
export function cleanPrice(v: unknown): PriceRecord {
  const r = v as PriceRecord;
  if (
    !r ||
    !["item", "person", "visit"].includes(r.kind) ||
    !["seen", "unknown", "out"].includes(r.stock) ||
    !["paid", "noted"].includes(r.source) ||
    typeof r.liked !== "boolean"
  )
    throw new Error("价格记录类型无效。");
  if (!validDate(r.observedOn) || r.observedOn > todayLocal())
    throw new Error("记录日期无效，不能填写未来日期。");
  const low = r.low === null ? null : num(r.low, 0, 10000, "单价"),
    high = r.high === null ? null : num(r.high, 0, 10000, "单价上限");
  if (
    (low === null) !== (high === null) ||
    (low !== null &&
      high !== null &&
      (low > high ||
        Math.abs(low * 100 - Math.round(low * 100)) > 1e-6 ||
        Math.abs(high * 100 - Math.round(high * 100)) > 1e-6))
  )
    throw new Error("价格区间无效，请填写最多两位小数；未知价格请两项都留空。");
  return {
    id: ident(r.id),
    store: cleanNode(r.store),
    product: cleanProduct(r.product),
    kind: r.kind,
    low,
    high,
    observedOn: r.observedOn,
    validDays: integer(r.validDays, 1, 90, "价格参考有效天数"),
    stock: r.stock,
    source: r.source,
    liked: r.liked,
  };
}
export function cleanShopping(v: unknown): ShoppingBook {
  const b = v as ShoppingBook;
  if (
    !b ||
    !Array.isArray(b.items) ||
    b.items.length > 5 ||
    !Array.isArray(b.prices) ||
    b.prices.length > 150 ||
    !Array.isArray(b.blocked) ||
    b.blocked.length > 100
  )
    throw new Error("购物清单最多5项，价格记录最多150条，排除商品最多100项。");
  const items = b.items.map((i) => cleanShoppingItem(i)),
    prices = b.prices.map(cleanPrice),
    blocked = b.blocked.map((s) => str(s, 500));
  if (
    new Set(items.map((i) => i.id)).size !== items.length ||
    new Set(items.map(productKey)).size !== items.length ||
    new Set(prices.map((r) => r.id)).size !== prices.length
  )
    throw new Error("购物记录重复，请合并相同商品的数量。");
  return {
    items,
    prices,
    blocked: [...new Set(blocked)],
    options: cleanShoppingOptions(b.options),
  };
}
export function mergeShopping(a?: ShoppingBook, b?: ShoppingBook) {
  if (!a && !b) return undefined;
  if (!a || !b) return cleanShopping(a ?? b);
  return cleanShopping({
    ...a,
    prices: [
      ...new Map([...b.prices, ...a.prices].map((r) => [r.id, r])).values(),
    ],
    blocked: [...new Set([...a.blocked, ...b.blocked])],
  });
}
export const priceFresh = (q: PriceRecord, date = todayLocal()) =>
  validDate(date) &&
  q.observedOn <= date &&
  (Date.parse(date) - Date.parse(q.observedOn)) / 86400000 < q.validDays;
export const sameStore = (a: OutingNode, b: OutingNode) =>
  a.id === b.id && JSON.stringify(a.position) === JSON.stringify(b.position);
export function latestPrices(prices: PriceRecord[]) {
  const map = new Map<string, PriceRecord>();
  for (const r of prices) {
    const key = JSON.stringify([
        r.store.id,
        r.store.position,
        r.kind,
        productKey(r.product),
      ]),
      old = map.get(key);
    if (!old || r.observedOn >= old.observedOn) map.set(key, r);
  }
  return [...map.values()];
}
export function matchingQuotes(
  item: ShoppingItem,
  stores: OutingNode[],
  prices: PriceRecord[],
  blocked: string[],
  date = todayLocal(),
) {
  const norm = (s: string) => s.trim().toLowerCase();
  return latestPrices(prices)
    .filter(
      (q) =>
        q.kind === "item" &&
        q.stock !== "out" &&
        !blocked.includes(productKey(q.product)) &&
        stores.some((s) => sameStore(s, q.store)) &&
        norm(item.name) === norm(q.product.name) &&
        norm(item.spec) === norm(q.product.spec) &&
        norm(item.unit) === norm(q.product.unit) &&
        (item.alternatives || norm(item.brand) === norm(q.product.brand)),
    )
    .map((quote) => ({
      quote,
      known: priceFresh(quote, date) && quote.low !== null,
      reason: `${quote.source === "paid" ? "曾实际买过" : "记录的标价"} · ${quote.observedOn}${priceFresh(quote, date) ? "" : " · 价格已过期"}${quote.liked ? " · 你喜欢的商品" : ""}${quote.product.brand !== item.brand ? " · 已允许其他品牌" : ""} · 当前库存待确认`,
    }))
    .sort(
      (a, b) =>
        Number(b.known) - Number(a.known) ||
        (a.known ? a.quote.high! - b.quote.high! : 0) ||
        Number(b.quote.liked) - Number(a.quote.liked) ||
        b.quote.observedOn.localeCompare(a.quote.observedOn),
    );
}
export function validateShopping(
  items: ShoppingItem[],
  options: ShoppingOptions,
  stores: ShoppingStore[],
  origin: OutingNode,
  rest?: RestPoint | null,
) {
  const clean = cleanShopping({ ...defaultShopping(), items, options });
  if (!clean.items.length) throw new Error("请先添加1—5项要买的商品。");
  if (!stores.length || stores.length > 5 || (rest && stores.length > 4))
    throw new Error(
      rest
        ? "使用休息点时最多比较4家店，请取消一家候选店。"
        : "请选择1—5家候选店。",
    );
  [origin, ...stores, ...(rest ? [rest] : [])].forEach(cleanNode);
  const nodes = [origin, ...stores, ...(rest ? [rest] : [])];
  if (
    new Set(nodes.map((s) => s.id)).size !== nodes.length ||
    new Set(nodes.map((s) => s.position.system === "demo")).size !== 1
  )
    throw new Error("出发点、候选店和休息点不能重复或混用示例位置。");
  for (const s of stores) {
    if (!!s.open !== !!s.close)
      throw new Error("营业时间请同时填写开门和关门时刻，未知则都留空。");
    if (s.open && s.close && clockMinute(s.open) === clockMinute(s.close))
      throw new Error("开门和关门时间不能相同。");
  }
  if (rest) {
    const r = cleanRestPoint(rest);
    if (r.validUntil < todayLocal())
      throw new Error("休息点核验已过期，请更换或重新核验。");
  }
  return clean;
}
export function planShopping(
  bundle: RouteBundle,
  origin: OutingNode,
  stores: ShoppingStore[],
  data: ShoppingBook,
  preferences: JourneyPreferences,
  rest?: RestPoint | null,
) {
  const b = cleanShopping(data),
    p = cleanJourney(preferences),
    o = b.options;
  validateShopping(b.items, o, stores, origin, rest);
  if (
    [origin, ...stores, ...(rest ? [rest] : [])].some(
      (n) => !bundle.nodes.some((s) => sameStore(n, s)),
    )
  )
    throw new Error("路线与当前地点位置不一致，请重新计算。");
  const plans: ShoppingPlan[] = [];
  const visit = (
    at: string,
    elapsed: number,
    used: ShoppingStore[],
    rested: boolean,
    continuous: number,
    visits: Visit[],
    walked: number,
  ) => {
    if (used.length) {
      const back = leg(bundle, at, origin.id, p, elapsed);
      if (
        back &&
        elapsed + back.total <= o.minutes + 1e-8 &&
        (!o.continuous || continuous + back.walk <= o.continuous + 1e-8)
      ) {
        const purchases: Purchase[] = b.items.map((item) => {
          const hit = matchingQuotes(item, used, b.prices, b.blocked)[0];
          return {
            item,
            quote: hit?.quote ?? null,
            known: hit?.known ?? false,
            reason: hit?.reason ?? "尚无可比商品记录",
          };
        });
        // Every chosen store must serve at least one item; an unused store must not add detours or apparent rest.
        if (
          used.every((s) => purchases.some((r) => r.quote?.store.id === s.id))
        ) {
          const lowCents = purchases.reduce(
              (v, r) =>
                v +
                (r.known
                  ? Math.round(r.quote!.low! * 100) * r.item.quantity
                  : 0),
              0,
            ),
            highCents = purchases.reduce(
              (v, r) =>
                v +
                (r.known
                  ? Math.round(r.quote!.high! * 100) * r.item.quantity
                  : 0),
              0,
            );
          const missing = purchases
              .filter((r) => !r.quote)
              .map((r) => r.item.name),
            unknown = purchases.filter((r) => r.quote && !r.known).length;
          const completePrice = !missing.length && !unknown;
          const end = elapsed + back.total;
          plans.push({
            visits: [
              ...visits,
              {
                id: origin.id,
                name: `回到${origin.name}`,
                arrival: formatClock(clockMinute(p.departure) + end),
                departure: formatClock(clockMinute(p.departure) + end),
                walkMinutes: back.walk,
                waitMinutes: back.wait,
                stayMinutes: 0,
                meters: back.meters,
              },
            ],
            purchases,
            missing,
            low: lowCents / 100,
            high: highCents / 100,
            unknown,
            completePrice,
            budget: completePrice
              ? highCents <= Math.round(o.money * 100)
                ? "within"
                : "over"
              : "unknown",
            totalMinutes: end,
            walkingMinutes: walked + back.walk,
            finish: formatClock(clockMinute(p.departure) + end),
            labels: [],
            comparison: "",
            unknownOpening: used.filter((s) => !s.open).map((s) => s.name),
          });
        }
      }
    }
    for (const dest of [
      ...(used.length < o.maxShops
        ? stores.filter((s) => !used.some((u) => u.id === s.id))
        : []),
      ...(!rested && rest ? [rest] : []),
    ]) {
      const isRest = dest.id === rest?.id,
        path = leg(bundle, at, dest.id, p, elapsed);
      if (
        !path ||
        (o.continuous && continuous + path.walk > o.continuous + 1e-8)
      )
        continue;
      const stay = isRest ? o.rest : o.stay,
        s = dest as ShoppingStore,
        delay =
          !isRest && s.open && s.close
            ? openingDelay(
                clockMinute(p.departure) + elapsed + path.total,
                stay,
                { start: s.open, end: s.close },
              )
            : 0;
      const end = elapsed + path.total + delay + stay;
      if (end > o.minutes) continue;
      visit(
        dest.id,
        end,
        isRest ? used : [...used, s],
        rested || isRest,
        isRest ? 0 : continuous + path.walk,
        [
          ...visits,
          {
            id: dest.id,
            name: isRest ? `${dest.name}（歇脚）` : dest.name,
            arrival: formatClock(
              clockMinute(p.departure) + elapsed + path.total,
            ),
            departure: formatClock(clockMinute(p.departure) + end),
            walkMinutes: path.walk,
            waitMinutes: path.wait + delay,
            stayMinutes: stay,
            meters: path.meters,
          },
        ],
        walked + path.walk,
      );
    }
  };
  visit(origin.id, 0, [], false, 0, [], 0);
  const complete = plans.filter((r) => !r.missing.length),
    known = complete.filter((r) => r.completePrice),
    inBudget = known.filter((r) => r.budget === "within");
  const comparable = inBudget.length ? inBudget : known;
  const pool = complete.length
    ? inBudget.length
      ? complete.filter((r) => r.budget !== "over")
      : complete
    : plans;
  const fastest = [...pool].sort(
    (a, b) =>
      a.missing.length - b.missing.length ||
      a.totalMinutes - b.totalMinutes ||
      Number(b.completePrice) - Number(a.completePrice),
  )[0];
  const fastKnown = [...comparable].sort(
    (a, b) => a.totalMinutes - b.totalMinutes,
  )[0];
  const cheapest = [...comparable].sort(
    (a, b) => a.high - b.high || a.totalMinutes - b.totalMinutes,
  )[0];
  const balanced = fastKnown
    ? [...comparable]
        .filter(
          (r) => r.totalMinutes <= fastKnown.totalMinutes + o.detour + 1e-8,
        )
        .sort((a, b) => a.high - b.high || a.totalMinutes - b.totalMinutes)[0]
    : undefined;
  const chosen: ShoppingPlan[] = [];
  for (const [plan, label] of [
    [fastest, complete.length ? "少走一点" : "先买到这些"],
    [cheapest, "少花一点"],
    [balanced, "均衡安排"],
  ] as const) {
    if (!plan) continue;
    const key = JSON.stringify([
        plan.visits.map((v) => v.id),
        plan.purchases.map((r) => r.quote?.id),
      ]),
      old = chosen.find(
        (r) =>
          JSON.stringify([
            r.visits.map((v) => v.id),
            r.purchases.map((v) => v.quote?.id),
          ]) === key,
      );
    if (old) old.labels.push(label);
    else {
      plan.labels = [label];
      chosen.push(plan);
    }
  }
  for (const r of chosen)
    if (r.completePrice && fastKnown) {
      const minutes = Math.max(0, r.totalMinutes - fastKnown.totalMinutes),
        low = Math.round((fastKnown.low - r.high) * 100) / 100,
        high = Math.round((fastKnown.high - r.low) * 100) / 100;
      r.comparison =
        minutes > 0.1
          ? `比完整报价中最快方案多用${minutes.toFixed(1)}分钟；${low > 0 ? `预计少花${low.toFixed(2)}—${high.toFixed(2)}元` : "价格区间重叠，节省金额不确定"}。`
          : "与完整报价中最快方案用时相当。";
    }
  return {
    plans: chosen,
    evaluated: plans.length,
    missingRoutes: bundle.edges.filter((e) => e.travel.status !== "ok").length,
    note: !plans.length
      ? "当前时间或连续步行条件下没有可行方案。可增加时间、选择休息点或补充商品记录。"
      : !complete.length
        ? "没有买齐全部清单的方案，以下只列出可买到的部分，不参与省钱排名。"
        : !known.length
          ? "价格尚不完整，暂不提供省钱排名，也不能确认整趟在预算内。"
          : !inBudget.length
            ? "已知完整报价都超过预算；下列结果标出超预算金额或待确认项。"
            : "仅比较所选店铺与记录中的同规格商品；价格和到店库存仍需确认。",
  };
}
