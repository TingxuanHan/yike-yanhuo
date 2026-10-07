import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import { emptyBook, cleanBook } from "../src/shared/life.js";
import {
  todayLocal,
  cleanFamiliarDraft,
  cleanFamiliarRoute,
} from "../src/shared/outings.js";
const event = (dataset: Record<string, unknown> = {}, value?: unknown) => ({
  currentTarget: { dataset },
  detail: { value },
});
const field = (page: any, key: string, value: unknown) =>
  page.field(event({ key }, value));

test("native outings run offline, clear old results, honor all rest deselections and reject invalid input before routes", async () => {
  const runtime = miniRuntime(),
    page = runtime.page("outings");
  page.onLoad();
  await page.errands();
  assert.equal(page.data.error, "");
  assert.ok(page.data.plans.length > 0);
  assert.match(page.data.plans[0].summary, /完成2件事/);
  assert.match(page.data.plans[0].rows.at(-1), /回到/);
  field(page, "budget", 5);
  assert.equal(page.data.plans.length, 0);
  await page.errands();
  assert.equal(page.data.plans.length, 0);
  field(page, "budget", 45);
  page.window(event({ index: 0, key: "open" }, "09:00"));
  page.window(event({ index: 0, key: "close" }, "09:00"));
  const original = page.routes;
  page.routes = () => {
    throw new Error("unexpected route read");
  };
  await page.errands();
  assert.match(page.data.error, /不能相同/);
  page.clearWindow(event({ index: 0 }));
  assert.equal(page.data.candidates[0].open, "");
  page.routes = original;
  await page.restJourney();
  assert.equal(page.data.error, "");
  assert.ok(page.data.restPlans.length > 0);
  for (const r of [...page.data.restRows]) page.restToggle(event({ id: r.id }));
  assert.equal(page.data.restRows.filter((r: any) => r.checked).length, 0);
  await page.restJourney();
  assert.equal(page.data.restPlans.length, 0);
  await page.impact();
  assert.equal(page.data.error, "");
  assert.equal(page.data.impact.rows.length, 6);
  assert.ok(page.data.impact.improved > 0);
  assert.ok(runtime.storage.has("yike-outing-routes"));
  page.onUnload();
});

test("familiar drafts survive navigation and removal undo preserves later edits in the same book", async () => {
  const storage = new Map<string, any>(),
    page = miniRuntime(storage).page("outings");
  page.onLoad();
  field(page, "routeName", "家到菜场");
  page.step(event({ index: 0, key: "title" }, "小区东门"));
  page.step(
    event({ index: 0, key: "instruction" }, "从东门出来，沿有雨棚的人行道走。"),
  );
  page.step(event({ index: 1, key: "title" }, "菜场蓝色招牌"));
  page.step(event({ index: 1, key: "instruction" }, "从南侧入口进入。"));
  page.onUnload();
  const again = miniRuntime(storage).page("outings");
  again.onLoad();
  assert.equal(again.data.routeName, "家到菜场");
  assert.equal(again.data.steps[1].title, "菜场蓝色招牌");
  await again.saveRoute();
  assert.equal(again.data.error, "");
  assert.equal(again.data.showRouteEditor, false);
  assert.equal(again.data.cardIndex, 0);
  again.cardNext(event({ offset: 1 }));
  assert.equal(again.data.cardStep.title, "菜场蓝色招牌");
  const firstId = again.data.card.id;
  await again.deleteRoute(event({ id: firstId }));
  assert.equal(again.data.routeList.length, 0);
  const saved = storage.get("yike-life");
  again.saveBook({
    ...saved,
    preferences: { ...saved.preferences, speedMps: 0.8 },
  });
  await again.undoRestore();
  assert.equal(again.data.routeList.length, 1);
  assert.equal(storage.get("yike-life").preferences.speedMps, 0.8);
  const home = miniRuntime(storage).page();
  home.onLoad();
  home.onShow();
  assert.equal(home.data.book.familiarRoutes[0].id, firstId);
  home.onUnload();
  again.onUnload();
});

test("native rest registration persists, rejects future confirmation and undo keeps other records", async () => {
  const book = emptyBook();
  book.places = [
    {
      id: "bench",
      name: "巷口长椅",
      address: "测试巷",
      landmark: "北门",
      note: "",
      visitedOn: todayLocal(),
      source: "personal",
      position: { system: "gcj02", lng: 121.5, lat: 31.2 },
    },
  ];
  const storage = new Map<string, any>([["yike-life", book]]),
    page = miniRuntime(storage).page("outings");
  page.onLoad();
  field(page, "restChecked", "2099-01-01");
  await page.saveRest();
  assert.match(page.data.error, /核验日期/);
  assert.equal(storage.get("yike-life").restPoints, undefined);
  field(page, "restChecked", todayLocal());
  await page.saveRest();
  assert.equal(page.data.restList.length, 1);
  await page.deleteRest(event({ id: page.data.restList[0].id }));
  await page.undoRestore();
  assert.equal(
    cleanBook(storage.get("yike-life")).restPoints?.[0].name,
    "巷口长椅",
  );
  page.onUnload();
});

test("partial familiar drafts are bounded and a missing route id is rejected", () => {
  const draft = {
    id: null,
    name: "未写完",
    checkedOn: todayLocal(),
    steps: [{ title: "", instruction: "" }],
  };
  assert.equal(cleanFamiliarDraft(draft).steps[0].title, "");
  assert.throws(
    () =>
      cleanFamiliarDraft({
        ...draft,
        steps: [
          { title: "", instruction: "", photo: "data:text/html;base64,AAAA" },
        ],
      }),
    /照片/,
  );
  assert.throws(
    () =>
      cleanFamiliarRoute({
        name: "没有编号",
        checkedOn: todayLocal(),
        steps: [
          { title: "a", instruction: "a" },
          { title: "b", instruction: "b" },
        ],
      }),
    /关键点/,
  );
});
