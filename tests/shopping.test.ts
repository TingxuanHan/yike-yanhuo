import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanPrice,
  cleanShopping,
  defaultShopping,
  matchingQuotes,
  planShopping,
  productKey,
  validateShopping,
  type PriceRecord,
  type ShoppingBook,
  type ShoppingStore,
} from "../src/shared/shopping.js";
import {
  allPairs,
  todayLocal,
  type RouteBundle,
} from "../src/shared/outings.js";
import { DEFAULT_JOURNEY } from "../src/shared/journey.js";
import { cleanBook, emptyBook, mergeBooks } from "../src/shared/life.js";
const home = {
  id: "home",
  name: "家",
  position: { system: "demo" as const, x: 0, y: 0 },
};
const stores: ShoppingStore[] = [1, 2].map((i) => ({
  id: `s${i}`,
  name: `店${i}`,
  position: { system: "demo", x: i * 100, y: 0 },
}));
const product = { name: "牛奶", spec: "250毫升×12盒", unit: "箱", brand: "甲" };
const item = { ...product, id: "milk", quantity: 1, alternatives: false };
const record = (
  i: number,
  low: number | null,
  extra: Partial<PriceRecord> = {},
): PriceRecord => ({
  id: `q${i}`,
  store: stores[i - 1],
  product,
  kind: "item",
  low,
  high: low,
  observedOn: todayLocal(),
  validDays: 7,
  stock: "seen",
  source: "paid",
  liked: false,
  ...extra,
});
const data = (): ShoppingBook => ({
  ...defaultShopping(),
  items: [item],
  prices: [record(1, 28), record(2, 20)],
});
const bundle = (): RouteBundle => {
  const nodes = [home, ...stores];
  return {
    nodes,
    mode: "demo",
    generatedAt: new Date().toISOString(),
    edges: allPairs(nodes).map(([from, to]) => ({
      from,
      to,
      travel: {
        status: "ok",
        seconds: 60,
        meters: from === "s2" || to === "s2" ? 500 : 100,
      },
    })),
  };
};

test("shopping compares a full basket, includes directional return and never treats missing price as zero", () => {
  const b = data(),
    routes = bundle();
  b.options.stay = 3;
  const result = planShopping(routes, home, stores, b, DEFAULT_JOURNEY);
  assert.ok(
    result.plans.some((r) => r.labels.includes("少花一点") && r.low === 20),
  );
  assert.equal(result.plans[0].visits.at(-1)?.id, "home");
  routes.edges.find((e) => e.from === "s1" && e.to === "home")!.travel = {
    status: "ok",
    seconds: 1,
    meters: 1000,
  };
  assert.ok(
    planShopping(routes, home, stores, b, DEFAULT_JOURNEY).plans[0]
      .walkingMinutes > 10,
  );
  b.prices = [record(1, null), record(2, null)];
  const unknown = planShopping(bundle(), home, stores, b, DEFAULT_JOURNEY);
  assert.equal(unknown.plans.length, 1);
  assert.equal(unknown.plans[0].budget, "unknown");
  assert.equal(unknown.plans[0].unknown, 1);
  assert.ok(!unknown.plans[0].labels.includes("少花一点"));
});
test("newer out-of-stock and expired records override old low quotes, and units or brands must be comparable", () => {
  const old = record(1, 5, { observedOn: "2020-01-01" }),
    fresh = record(1, 40, { id: "new", stock: "out" });
  assert.equal(matchingQuotes(item, stores, [old, fresh], []).length, 0);
  assert.equal(matchingQuotes(item, stores, [old], [])[0].known, false);
  assert.equal(
    matchingQuotes(
      item,
      stores,
      [record(1, 5, { product: { ...product, unit: "盒" } })],
      [],
    ).length,
    0,
  );
  const alt = record(1, 10, { product: { ...product, brand: "乙" } });
  assert.equal(matchingQuotes(item, stores, [alt], []).length, 0);
  assert.equal(
    matchingQuotes({ ...item, alternatives: true }, stores, [alt], []).length,
    1,
  );
  assert.equal(
    matchingQuotes(
      { ...item, alternatives: true },
      stores,
      [alt],
      [productKey(alt.product)],
    ).length,
    0,
  );
  assert.equal(
    matchingQuotes(item, stores, [record(1, 30, { kind: "person" })], [])
      .length,
    0,
  );
});
test("missing items and incomplete routes do not earn cheapest labels or conceal budget overrun", () => {
  const b = data();
  b.items.push({ ...item, id: "eggs", name: "鸡蛋" });
  const partial = planShopping(bundle(), home, stores, b, DEFAULT_JOURNEY);
  assert.deepEqual(partial.plans[0].missing, ["鸡蛋"]);
  assert.deepEqual(partial.plans[0].labels, ["先买到这些"]);
  b.items.pop();
  b.options.money = 10;
  assert.ok(
    planShopping(bundle(), home, stores, b, DEFAULT_JOURNEY).plans.every(
      (p) => p.budget === "over",
    ),
  );
  const routes = bundle();
  routes.edges.forEach((e) => {
    if (e.to === "home") e.travel = { status: "unknown", reason: "fixture" };
  });
  assert.equal(
    planShopping(routes, home, stores, b, DEFAULT_JOURNEY).plans.length,
    0,
  );
});
test("shopping enforces opening windows, cumulative walking and bounded inputs before requesting routes", () => {
  const b = data();
  b.options.continuous = 2;
  assert.equal(
    planShopping(bundle(), home, stores, b, DEFAULT_JOURNEY).plans.length,
    0,
  );
  b.options.continuous = 0;
  b.options.minutes = 15;
  assert.equal(
    planShopping(
      bundle(),
      home,
      stores.map((s) => ({ ...s, open: "18:00", close: "20:00" })),
      b,
      DEFAULT_JOURNEY,
    ).plans.length,
    0,
  );
  assert.throws(
    () =>
      validateShopping(
        b.items,
        b.options,
        [{ ...stores[0], open: "10:00", close: "10:00" }],
        home,
      ),
    /不能相同/,
  );
  assert.throws(() => cleanPrice(record(1, -1)), /单价/);
  assert.throws(() => cleanPrice(record(1, 1.001)), /两位小数/);
  assert.throws(
    () => cleanShopping({ ...b, items: Array(6).fill(item) }),
    /最多5项/,
  );
  assert.throws(() => cleanShopping({ ...b, items: [item, item] }), /重复/);
});
test("price ranges and integer quantities are counted once; shopping survives validated book merge", () => {
  const b = data();
  b.items[0].quantity = 3;
  b.prices = [record(1, 0.1, { high: 0.2 })];
  const p = planShopping(bundle(), home, stores, b, DEFAULT_JOURNEY).plans[0];
  assert.equal(p.low, 0.3);
  assert.equal(p.high, 0.6);
  const a = cleanBook({ ...emptyBook(), shopping: b }),
    incoming = cleanBook({
      ...emptyBook(),
      shopping: { ...data(), prices: [record(2, 20)] },
    });
  const merged = mergeBooks(a, incoming);
  assert.equal(merged.shopping?.items[0].quantity, 3);
  assert.equal(merged.shopping?.prices.length, 2);
  assert.equal(cleanBook(emptyBook()).shopping, undefined);
});
