import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPlanningEdit,
  planningDiff,
} from "../src/shared/planning-edit.js";
import { emptyPlanning } from "../src/shared/planning.js";
import { emptyBook, cleanBook, mergeBooks } from "../src/shared/life.js";
import { defaultMovement } from "../src/shared/movement.js";
import { defaultShopping } from "../src/shared/shopping.js";
import { allPairs, todayLocal } from "../src/shared/outings.js";
import {
  solveTrip,
  startTrip,
  stepTrip,
  remainingTrip,
  cleanTripFeedback,
  feedbackPace,
  type TripInput,
} from "../src/shared/trip.js";
import { TripSession } from "../src/mini/trip.js";
import { miniRuntime } from "./helpers/mini.js";
const fixture = (): TripInput => {
  const origin = {
      id: "home",
      name: "家",
      position: { system: "demo" as const, x: 0, y: 0 },
    },
    stops = [
      {
        id: "market",
        name: "菜场",
        category: "market",
        stay: 5,
        position: { system: "demo" as const, x: 200, y: 0 },
      },
      {
        id: "pharmacy",
        name: "药房",
        category: "pharmacy",
        stay: 3,
        position: { system: "demo" as const, x: 400, y: 0 },
      },
      {
        id: "park",
        name: "公园",
        category: "park",
        stay: 2,
        position: { system: "demo" as const, x: 900, y: 0 },
      },
    ];
  const nodes = [origin, ...stops],
    item = {
      id: "eggs",
      name: "鸡蛋",
      spec: "6枚",
      unit: "盒",
      brand: "",
      quantity: 2,
      alternatives: false,
    };
  return {
    origin,
    stops,
    bundle: {
      nodes,
      mode: "demo",
      generatedAt: new Date().toISOString(),
      edges: allPairs(nodes).map(([from, to]) => ({
        from,
        to,
        travel: {
          status: "ok",
          meters: Math.abs(
            nodes.find((n) => n.id === from)!.position.x -
              nodes.find((n) => n.id === to)!.position.x,
          ),
          seconds: 1,
        },
      })),
    },
    draft: {
      ...emptyPlanning(),
      tripMinutes: 45,
      shoppingBudget: 30,
      walkingMinutes: 20,
      tasks: ["market", "pharmacy"],
      items: ["鸡蛋"],
    },
    shopping: {
      ...defaultShopping(),
      items: [item],
      prices: [
        {
          id: "q",
          store: stops[0],
          product: item,
          kind: "item",
          low: 10,
          high: 12,
          observedOn: todayLocal(),
          validDays: 7,
          stock: "unknown",
          source: "noted",
          liked: false,
        },
      ],
    },
    preferences: emptyBook().preferences,
    movement: defaultMovement(),
  };
};
test("unified solver combines one market stop, errands, shopping and a full return with computed prices", () => {
  const r = solveTrip(fixture());
  assert.ok(r.plans.length);
  const p = r.plans.find((p) => p.labels.includes("早点回来"))!;
  assert.equal(p.missed.length, 0);
  assert.equal(p.low, 20);
  assert.equal(p.high, 24);
  assert.equal(p.budget, "within");
  assert.equal(p.stopIds.filter((id) => id === "market").length, 1);
  assert.equal(p.legs.at(-1)!.name, "回到家");
  assert.ok(p.minutes <= 45);
  assert.ok(Math.abs(p.minutes - p.walking - 8) < 1e-6);
  assert.ok(p.gap > 0);
  const active = r.plans.find((p) => p.labels.includes("兼顾步行"))!;
  assert.ok(active.gap < p.gap);
  assert.ok(active.stopIds.includes("park"));
});
test("missing roads are not replaced with straight lines and missing prices are not zero cost", () => {
  const a = fixture();
  a.bundle.edges = a.bundle.edges.filter((e) => e.to !== "home");
  assert.equal(solveTrip(a).plans.length, 0);
  const b = fixture();
  b.shopping.prices[0].observedOn = "2020-01-01";
  const p = solveTrip(b).plans[0];
  assert.equal(p.priceComplete, false);
  assert.equal(p.budget, "unknown");
  b.shopping.prices[0].stock = "out";
  assert.ok(solveTrip(b).plans.every((p) => p.missed.includes("购买鸡蛋")));
});
test("time includes stays, signals, closing windows and return; incomplete errands stay visible", () => {
  const a = fixture();
  a.draft.tripMinutes = 10;
  const p = solveTrip(a).plans;
  assert.ok(p.every((x) => x.minutes <= 10));
  assert.ok(p.every((x) => x.missed.length > 0));
  const b = fixture();
  b.stops[1].opening = { start: "09:00", end: "09:01" };
  assert.ok(solveTrip(b).plans.every((p) => p.missed.includes("取药")));
  const c = fixture();
  c.preferences.signals.enabled = true;
  c.preferences.signals.offPeakSeconds = 90;
  c.preferences.signals.peakSeconds = 90;
  c.preferences.signals.crossingsPerKm = 5;
  assert.ok(
    solveTrip(c).plans[0].minutes > solveTrip(fixture()).plans[0].minutes,
  );
});
test("conversational edits preserve unspecified values, support removal and reject invented items", () => {
  const current = fixture().draft;
  const next = applyPlanningEdit(
    current,
    "预算改为20元，不取药了",
    JSON.stringify({ set: { shoppingBudget: 20 }, removeTasks: ["pharmacy"] }),
  );
  assert.equal(next.tripMinutes, current.tripMinutes);
  assert.deepEqual(next.items, current.items);
  assert.deepEqual(next.tasks, ["market"]);
  assert.equal(planningDiff(current, next).length, 2);
  assert.throws(() =>
    applyPlanningEdit(current, "便宜一点", '{"addItems":["牛奶"]}'),
  );
  assert.throws(() =>
    applyPlanningEdit(current, "更快", '{"set":{"route":"fake"}}'),
  );
  const clear = applyPlanningEdit(
    current,
    "取消预算上限",
    '{"set":{"shoppingBudget":null}}',
  );
  assert.equal(clear.shoppingBudget, null);
});
test("manual trip events never guess an in-transit position; resting and early return update estimates", () => {
  const i = fixture(),
    p = solveTrip(i).plans[0];
  let now = new Date("2026-10-13T09:00:00+08:00").getTime(),
    a = startTrip(i, p, now);
  assert.equal(a.phase, "at");
  a = stepTrip(a, "leave", now);
  assert.throws(() => stepTrip(a, "return", now));
  assert.throws(() => stepTrip(a, "rest", now));
  now += 5 * 60000;
  a = stepTrip(a, "arrive", now);
  assert.equal(a.currentId, p.stopIds[0]);
  a = stepTrip(a, "rest", now);
  now += 15 * 60000;
  a = stepTrip(a, "resume", now);
  assert.match(remainingTrip(a, now).note, /确认地点/);
  a = stepTrip(a, "return", now);
  assert.deepEqual(a.remaining, ["home"]);
  assert.equal(a.skipped.length, p.stopIds.length - 1);
  a = stepTrip(a, "leave", now);
  a = stepTrip(a, "arrive", now + 5 * 60000);
  assert.equal(a.phase, "finished");
  assert.equal(remainingTrip(a).minutes, 0);
});
test("feedback stays private, rejects invalid time, merges across devices and never calibrates from demo", () => {
  const f = {
    id: "trip-test-1",
    date: todayLocal(),
    mode: "baidu" as const,
    origin: "出发点",
    completed: ["market"],
    difficult: ["market"],
    totalMinutes: 25,
    walkingMinutes: 20,
    meters: 1200,
    spent: 24,
    note: "入口有台阶",
  };
  assert.equal(feedbackPace(cleanTripFeedback(f)), 1);
  assert.equal(feedbackPace({ ...f, mode: "demo" }), null);
  assert.throws(() => cleanTripFeedback({ ...f, walkingMinutes: 30 }));
  assert.throws(() => cleanTripFeedback({ ...f, date: "2026-02-30" }));
  assert.throws(() => cleanTripFeedback({ ...f, difficult: ["unvisited"] }));
  const clean = cleanBook({
    ...emptyBook(),
    trips: [{ ...f, audio: "must-not-survive" }],
  });
  assert.equal("audio" in clean.trips![0], false);
  assert.deepEqual(mergeBooks(emptyBook(), clean).trips, clean.trips);
});
test("remaining ETA keeps unfinished errands, excludes rests from task time and cancels the stay on early return", () => {
  const i = fixture();
  i.stops = [i.stops[0]];
  i.draft.tasks = ["market"];
  i.draft.walkingMinutes = null;
  const plan = solveTrip(i).plans[0];
  let now = new Date(2026, 9, 13, 9).getTime(),
    a = startTrip(i, plan, now);
  a = stepTrip(a, "leave", now);
  now += 4 * 60000;
  a = stepTrip(a, "arrive", now);
  const atArrival = remainingTrip(a, now).minutes!;
  const roadMinutes = 200 / i.movement.easyMps / 60;
  assert.ok(Math.abs(atArrival - roadMinutes - 5) < 1e-6);
  now += 2 * 60000;
  a = stepTrip(a, "rest", now);
  now += 10 * 60000;
  a = stepTrip(a, "resume", now);
  assert.ok(Math.abs(remainingTrip(a, now).minutes! - atArrival + 2) < 1e-6);
  a = stepTrip(a, "return", now);
  assert.ok(Math.abs(remainingTrip(a, now).minutes! - roadMinutes) < 1e-6);
  i.stops[0].stay = -1;
  assert.throws(() => solveTrip(i), /停留/);
});
test("draft edits survive page changes and clearing return preference preserves the inherited value", () => {
  const store = new Map<string, unknown>();
  const book = emptyBook();
  book.movement = { ...defaultMovement(), returnEasy: false };
  const deps = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, structuredClone(v)),
    save: () => {},
    request: async <T>() => ({}) as T,
    confirm: async () => true,
    notify: () => {},
  };
  const s = new TripSession(book, null, deps, {
    ...fixture().draft,
    returnEasy: null,
  });
  assert.equal(s.draft().returnEasy, null);
  assert.equal(s.state.returnEasy, false);
  s.set("shoppingBudget", "35");
  const removed = s.state.candidates.find((n) => n.checked)!.id;
  s.candidate(removed);
  const second = new TripSession(book, null, deps);
  assert.equal(second.draft().shoppingBudget, 35);
  assert.equal(second.draft().returnEasy, null);
  assert.equal(
    second.state.candidates.find((n) => n.id === removed)!.checked,
    false,
  );
});
test("trip session confirms edits, clears stale plans, persists execution and feedback without network on examples", async () => {
  const store = new Map<string, unknown>();
  let calls = 0,
    book = emptyBook(),
    now = Date.now();
  const deps = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, structuredClone(v)),
    save: (b: typeof book) => {
      book = b;
    },
    request: async <T>() => {
      calls++;
      return { draft: { ...fixture().draft, shoppingBudget: 20 } } as T;
    },
    confirm: async () => true,
    notify: () => {},
    now: () => now,
  };
  const s = new TripSession(book, null, deps);
  await s.calculate();
  assert.ok(s.state.plans.length);
  assert.equal(calls, 0);
  s.set("text", "预算20元");
  await s.edit();
  assert.equal(s.state.form.shoppingBudget, "50");
  assert.ok(s.state.pending);
  s.reject();
  assert.ok(s.state.plans.length);
  await s.edit();
  s.accept();
  assert.equal(s.state.form.shoppingBudget, "20");
  assert.equal(s.state.plans.length, 0);
  s.set("items", "鸡蛋");
  await s.calculate();
  assert.ok(s.state.plans.length);
  await s.start(s.state.plans[0].id);
  await s.step("leave");
  now += 5 * 60000;
  await s.step("arrive");
  const restored = new TripSession(book, null, deps);
  assert.equal(restored.state.active?.currentId, s.state.active?.currentId);
  restored.feedbackField("spent", "12");
  now += 10 * 60000;
  await restored.finish();
  assert.equal(book.trips!.length, 1);
  assert.equal(book.trips![0].spent, 12);
  assert.equal(store.get("yike-active-trip"), null);
  assert.equal(restored.state.pace, null);
});
test("native trip page executes real shared algorithms and restores the local trip", async () => {
  const store = new Map<string, any>([["yike-life", emptyBook()]]);
  const page = miniRuntime(store).page("trip");
  page.onLoad();
  await page.calculate();
  assert.ok(page.data.plans.length, page.data.error);
  assert.equal(page.data.activeDemo, true);
  await page.start({
    currentTarget: { dataset: { id: page.data.plans[0].id } },
  });
  assert.equal(page.data.active.phase, "at");
  await page.step({ currentTarget: { dataset: { kind: "leave" } } });
  assert.equal(page.data.active.phase, "walking");
  page.onUnload();
  const second = miniRuntime(store).page("trip");
  second.onLoad();
  assert.equal(second.data.active.phase, "walking");
  await second.step({ currentTarget: { dataset: { kind: "arrive" } } });
  second.feedback({
    currentTarget: { dataset: { key: "spent" } },
    detail: { value: "10" },
  });
  await second.finish();
  assert.equal(store.get("yike-life").trips[0].spent, 10);
  assert.equal(second.data.active, null);
  second.onUnload();
});
