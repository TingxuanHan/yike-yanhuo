import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import { emptyBook } from "../src/shared/life.js";
import { emptyPlanning } from "../src/shared/planning.js";

const field = (key: string, value: string) => ({
  currentTarget: { dataset: { key } },
  detail: { value },
});
test("native planning confirms before handing time, pace and movement constraints to errands", async () => {
  const store = new Map<string, any>([["yike-life", emptyBook()]]);
  let navigation = "";
  const runtime = miniRuntime(store, {
      navigateTo: (o: any) => {
        navigation = o.url;
        o.success();
      },
    }),
    page = runtime.page("planning");
  page.onLoad();
  page.mode({ currentTarget: { dataset: { mode: "manual" } } });
  page.field(field("tripMinutes", "60"));
  page.field(field("walkingMinutes", "25"));
  page.field(field("speedMps", "1.1"));
  page.field(field("departure", "10:30"));
  page.task({ currentTarget: { dataset: { id: "park" } } });
  assert.equal(store.get("yike-life").preferences.departure, "09:00");
  await page.apply({ currentTarget: { dataset: { target: "errands" } } });
  assert.match(navigation, /outings/);
  const errands = miniRuntime(store).page("outings");
  errands.onLoad();
  assert.equal(errands.data.budget, 60);
  assert.equal(errands.data.prefs.speedMps, 1.1);
  assert.equal(errands.data.prefs.departure, "10:30");
  assert.deepEqual(
    Array.from(
      errands.data.taskRows.filter((t: any) => t.checked),
      (t: any) => t.id,
    ),
    ["park"],
  );
  assert.equal(store.get("yike-life").movement.targetMinutes, 25);
  assert.equal(store.has("yike-planning-handoff"), false);
  page.onUnload();
  errands.onUnload();
});
test("native planning applies shopping names as incomplete drafts, preserving saved prices and blocking blind calculation", async () => {
  const store = new Map<string, any>([["yike-life", emptyBook()]]);
  const page = miniRuntime(store, { navigateTo: (o: any) => o.success() }).page(
    "planning",
  );
  page.onLoad();
  page.mode({ currentTarget: { dataset: { mode: "manual" } } });
  page.field(field("shoppingBudget", "80"));
  page.field(field("items", "鸡蛋、牛奶"));
  await page.apply({ currentTarget: { dataset: { target: "shopping" } } });
  const shopping = miniRuntime(store).page("shopping");
  shopping.onLoad();
  assert.equal(shopping.data.options.money, 80);
  assert.equal(shopping.data.items[0].name, "鸡蛋");
  assert.equal(shopping.data.items[0].spec, "");
  await shopping.session.calculate();
  assert.ok(shopping.session.state.error);
  assert.equal(store.has("yike-planning-handoff"), false);
  page.onUnload();
  shopping.onUnload();
});
test("native API request sends only typed text and wipes transient key without storing it", async () => {
  const store = new Map<string, any>([
    ["yike-server", "http://127.0.0.1:9999"],
  ]);
  let sent: any;
  const page = miniRuntime(store, {
    request: (o: any) => {
      sent = o.data;
      o.success({
        statusCode: 200,
        data: o.url.endsWith("parse")
          ? {
              draft: { ...emptyPlanning(), tripMinutes: 40 },
              model: "fixture-model",
            }
          : {
              free: { configured: true, remaining: 3, limit: 3 },
              own: { configured: false },
            },
      });
    },
  }).page("planning");
  page.onLoad();
  page.field(field("text", "40分钟内回来"));
  await page.parse();
  assert.equal(page.data.form.tripMinutes, "40");
  page.field(field("key", "fixture-sensitive-key"));
  page.onHide();
  assert.equal(page.data.key, "");
  assert.equal(
    JSON.stringify([...store]).includes("fixture-sensitive-key"),
    false,
  );
  assert.equal(store.has("yike-life"), false);
  page.onUnload();
});
