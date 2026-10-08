import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import { emptyBook, cleanBook } from "../src/shared/life.js";
import { ShoppingSession } from "../src/mini/shopping.js";
const event = (dataset: Record<string, unknown> = {}, value?: unknown) => ({
  currentTarget: { dataset },
  detail: { value },
});
test("native shopping plans offline, persists a draft and records price preferences with undo", async () => {
  const storage = new Map<string, any>(),
    page = miniRuntime(storage).page("shopping");
  page.onLoad();
  assert.equal(page.data.error, "");
  assert.equal(page.data.ready, true);
  await page.calculate();
  assert.equal(page.data.error, "");
  assert.ok(page.data.plans.length > 0);
  assert.match(page.data.plans[0].coverage, /全部安排/);
  assert.match(page.data.plans[0].rows.at(-1).title, /回到/);
  page.item(event({ index: 0, key: "quantity" }, 2));
  assert.equal(page.data.plans.length, 0);
  page.saveList();
  assert.equal(
    cleanBook(storage.get("yike-life")).shopping?.items[0].quantity,
    2,
  );
  page.reprice(event({ id: "demo-price-0-0" }));
  page.form(event({ key: "low" }, "10.50"));
  page.savePrice();
  assert.equal(page.data.error, "");
  const stored = storage.get("yike-life").shopping.prices[0];
  assert.equal(stored.low, 10.5);
  assert.equal(stored.source, "paid");
  page.block(event({ id: stored.id }));
  assert.equal(storage.get("yike-life").shopping.blocked.length, 1);
  page.removePrice(event({ id: stored.id }));
  assert.equal(storage.get("yike-life").shopping.prices.length, 0);
  page.undo();
  assert.equal(storage.get("yike-life").shopping.prices.length, 1);
  page.removeItem(event({ index: 0 }));
  page.undo();
  assert.equal(page.data.items.length, 3);
  page.onUnload();
  const again = miniRuntime(storage).page("shopping");
  again.onLoad();
  assert.equal(
    again.data.items.find((i: any) => i.name === "鸡蛋").quantity,
    2,
  );
  again.onUnload();
});
test("native invalid and unpriced real requests make no route calls; storage failure retains price draft", async () => {
  const storage = new Map<string, any>(),
    page = miniRuntime(storage).page("shopping");
  page.onLoad();
  page.field(event({ key: "minutes" }, 0));
  await page.calculate();
  assert.match(page.data.error, /整趟分钟数/);
  page.field(event({ key: "minutes" }, 45));
  page.mode(event({ demo: false }));
  await page.calculate();
  assert.match(page.data.error, /先保存出发点/);
  page.onUnload();
  const book = emptyBook();
  book.places = [0, 1].map((i) => ({
    id: `p${i}`,
    name: `真实地点${i}`,
    source: "personal",
    address: "",
    landmark: "",
    note: "",
    visitedOn: "",
    position: { system: "gcj02", lng: 121.5 + i / 1000, lat: 31.2 },
  }));
  const real = miniRuntime(new Map([["yike-life", book]])).page("shopping");
  real.onLoad();
  real.mode(event({ demo: false }));
  await real.calculate();
  assert.match(real.data.error, /尚未读取路线/);
  real.onUnload();
  const failed = miniRuntime(new Map(), {
    setStorageSync: () => {
      throw new Error("storage full");
    },
  }).page("shopping");
  failed.onLoad();
  failed.reprice(event({ id: "demo-price-0-0" }));
  failed.form(event({ key: "low" }, "9"));
  failed.savePrice();
  assert.equal(failed.data.form.low, "9");
  assert.match(failed.data.error, /尚未保存/);
  assert.ok(!failed.data.status.includes("价格记录已保存"));
  failed.onUnload();
});
test("shopping route requests are serialized and cached; cancelled results do not replace input", async () => {
  const storage = new Map<string, any>();
  let active = 0,
    peak = 0,
    calls = 0;
  const book = emptyBook();
  book.places = [0, 1, 2].map((i) => ({
    id: `p${i}`,
    name: `地点${i}`,
    source: "personal",
    address: "",
    landmark: "",
    note: "",
    visitedOn: "",
    position: { system: "gcj02", lng: 121.5 + i / 1000, lat: 31.2 },
  }));
  const session = new ShoppingSession(book, null, {
    get: (k) => storage.get(k),
    set: (k, v) => storage.set(k, v),
    save: (b) => storage.set("yike-life", b),
    notify: () => {},
    request: async <T>(
      path: string,
      _method?: string,
      body?: any,
    ): Promise<T> => {
      if (path === "/api/quota")
        return { limits: { route: 100 }, used: { route: 0 } } as T;
      active++;
      peak = Math.max(peak, active);
      calls++;
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return {
        nodes: body.nodes,
        edges: body.pairs.map(([from, to]: string[]) => ({
          from,
          to,
          travel: { status: "ok", meters: 100, seconds: 100 },
        })),
        mode: "baidu",
        generatedAt: new Date().toISOString(),
      } as T;
    },
  });
  session.change("demo", false);
  session.state.items = [
    {
      id: "a",
      name: "豆腐",
      spec: "300克",
      unit: "盒",
      brand: "",
      quantity: 1,
      alternatives: false,
    },
  ];
  for (const store of session.state.stores) {
    session.newPrice();
    for (const [k, v] of Object.entries({
      storeId: store.id,
      name: "豆腐",
      spec: "300克",
      unit: "盒",
      low: "3",
    }))
      session.form(k, v);
    session.savePrice();
  }
  await session.calculate();
  assert.equal(session.state.error, "");
  assert.ok(session.state.plans.length);
  assert.equal(peak, 1);
  const first = calls;
  await session.calculate();
  assert.equal(calls, first);
  session.state.stores[0].position = { system: "gcj02", lng: 122, lat: 31 };
  session.state.items[0].quantity = 3;
  const pending = session.calculate();
  session.stop();
  await pending;
  assert.equal(session.state.items[0].quantity, 3);
  assert.deepEqual(session.state.plans, []);
  assert.match(session.state.error, /已停止计算/);
  session.close();
});
