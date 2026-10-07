import test from "node:test";
import assert from "node:assert/strict";
import {
  planErrands,
  planRestJourney,
  compareAddition,
  cleanRouteRequest,
  todayLocal,
  type RouteBundle,
  type OutingNode,
} from "../src/shared/outings.js";
import { DEFAULT_JOURNEY } from "../src/shared/journey.js";
import { cleanBook, emptyBook, mergeBooks } from "../src/shared/life.js";
import {
  OutingRouteCache,
  demoScene,
  errandSelection,
} from "../src/mini/outings.js";
import { BaiduGateway } from "../src/server/baidu.js";
import { readOutingRoutes } from "../src/server/outing-routes.js";
import { QuotaLedger } from "../src/server/quota.js";
const node = (id: string, x = 0): OutingNode => ({
  id,
  name: id,
  position: { system: "demo", x, y: 0 },
});
const bundle = (rows: [string, string, number | null][]): RouteBundle => ({
  nodes: [...new Set(rows.flatMap((r) => r.slice(0, 2) as string[]))].map(
    (id) => node(id),
  ),
  mode: "demo",
  generatedAt: new Date().toISOString(),
  edges: rows.map(([from, to, m]) => ({
    from,
    to,
    travel:
      m === null
        ? { status: "unknown", reason: "missing" }
        : { status: "ok", seconds: m, meters: m },
  })),
});
const prefs = { ...DEFAULT_JOURNEY, speedMps: 1 };

test("errands use directed return costs, stops and optional partial plans", () => {
  const b = bundle([
    ["home", "a", 60],
    ["a", "home", 600],
    ["home", "b", 60],
    ["b", "home", 60],
    ["a", "b", 60],
    ["b", "a", 600],
  ]);
  const tasks = [
    { id: "buy", label: "买菜", candidates: ["a"], stayMinutes: 1 },
    { id: "med", label: "取药", candidates: ["b"], stayMinutes: 1 },
  ];
  assert.equal(
    planErrands(b, "home", tasks, prefs, 5).plans[0].completed.length,
    2,
  );
  assert.deepEqual(
    planErrands(b, "home", tasks, prefs, 5).plans[0].visits.map((v) => v.id),
    ["a", "b", "home"],
  );
  const only = planErrands(b, "home", [tasks[0]], prefs, 5);
  assert.equal(only.plans.length, 0);
  assert.equal(
    planErrands(
      b,
      "home",
      [{ ...tasks[0], stayMinutes: 10 }, tasks[1]],
      prefs,
      5,
    ).plans[0].skipped[0],
    "买菜",
  );
  b.edges.find((e) => e.from === "b" && e.to === "home")!.travel = {
    status: "unknown",
    reason: "missing",
  };
  assert.equal(planErrands(b, "home", tasks, prefs, 5).plans.length, 0);
});
test("arrival windows include waiting, completion before closing and midnight", () => {
  const b = bundle([
      ["home", "a", 120],
      ["a", "home", 60],
    ]),
    task = [{ id: "buy", label: "买菜", candidates: ["a"], stayMinutes: 3 }];
  const r = planErrands(b, "home", task, { ...prefs, departure: "23:58" }, 20, {
    a: { start: "00:02", end: "00:10" },
  }).plans[0];
  assert.equal(r.waitingMinutes, 2);
  assert.equal(r.totalMinutes, 8);
  assert.equal(r.finish, "次日 00:06");
  assert.equal(
    planErrands(b, "home", task, { ...prefs, departure: "23:58" }, 20, {
      a: { start: "23:00", end: "00:01" },
    }).plans.length,
    0,
  );
});
test("rests bound continuous walking and exclude expired or moved confirmations", () => {
  const b = bundle([
    ["home", "dest", 600],
    ["home", "bench", 240],
    ["bench", "dest", 240],
  ]);
  const rest = {
    ...node("bench"),
    checkedOn: "2026-01-01",
    validUntil: "2026-02-01",
    note: "已看过座椅",
  };
  const r = planRestJourney(
    b,
    "home",
    "dest",
    [rest],
    prefs,
    5,
    2,
    "2026-01-20",
  );
  assert.equal(r.plans[0].totalMinutes, 10);
  assert.equal(r.plans[0].longestMinutes, 4);
  assert.equal(r.plans[0].restCount, 1);
  assert.equal(
    planRestJourney(b, "home", "dest", [rest], prefs, 5, 2, "2026-02-02").plans
      .length,
    0,
  );
  assert.equal(
    planRestJourney(
      b,
      "home",
      "dest",
      [{ ...rest, position: { system: "demo", x: 200, y: 0 } }],
      prefs,
      5,
      2,
      "2026-01-20",
    ).plans.length,
    0,
  );
});
test("addition counts sampled points only and missing baseline routes cannot create a gain", () => {
  const b = bundle([
    ["s1", "old", 1200],
    ["s1", "new", 300],
    ["s2", "old", null],
    ["s2", "new", 120],
  ]);
  const before = JSON.stringify(b),
    r = compareAddition(b, ["s1", "s2"], ["old"], "new", prefs);
  assert.equal(r.newlyCovered, 1);
  assert.equal(r.unknown, 1);
  assert.equal(r.averageSavedMinutes, 15);
  assert.equal(JSON.stringify(b), before);
});
test("familiar routes and rest points survive book validation and merging with old clients", () => {
  const route = {
    id: "familiar",
    name: "回家的路",
    checkedOn: todayLocal(),
    steps: [
      { title: "东门", instruction: "从东门出" },
      { title: "药房", instruction: "蓝色门帘" },
    ],
  };
  const b = cleanBook({
    ...emptyBook(),
    familiarRoutes: [route],
    restPoints: [
      {
        ...node("bench"),
        checkedOn: todayLocal(),
        validUntil: todayLocal(),
        note: "示例",
      },
    ],
  });
  assert.equal(mergeBooks(emptyBook(), b).familiarRoutes?.[0].name, "回家的路");
  assert.equal(
    mergeBooks({ ...b, familiarRoutes: [{ ...route, name: "本机版本" }] }, b)
      .familiarRoutes?.[0].name,
    "本机版本",
  );
  assert.throws(
    () =>
      cleanBook({
        ...b,
        familiarRoutes: [{ ...route, steps: [route.steps[0]] }],
      }),
    /2—8/,
  );
});
test("route cache reuses only matching coordinates and all batch requests remain bounded", async () => {
  const cache = new OutingRouteCache(),
    scene = demoScene(),
    selection = errandSelection(scene, ["market", "pharmacy"], {});
  let network = 0;
  const pairs: [[string, string]] = [["home", "market-a"]];
  await cache.obtain(
    selection.nodes,
    pairs,
    async () => {
      network++;
      throw new Error();
    },
    () => {},
  );
  assert.equal(network, 0);
  assert.equal(cache.pending(selection.nodes, pairs).length, 0);
  selection.nodes[0] = node("home", 200);
  assert.equal(cache.pending(selection.nodes, pairs).length, 1);
  await assert.rejects(
    cache.obtain(
      selection.nodes,
      pairs,
      async () => {
        throw new Error();
      },
      () => {},
      () => true,
    ),
    /停止/,
  );
  assert.throws(
    () =>
      cleanRouteRequest({
        nodes: [node("a"), node("b")],
        pairs: Array(7).fill(["a", "b"]),
      }),
    /6段/,
  );
});
test("server routes use the shared gateway and reject insufficient retry budget before calling", async () => {
  let calls = 0;
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    fetcher: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          status: 0,
          result: [{ distance: { value: 500 }, duration: { value: 600 } }],
        }),
      );
    },
  });
  const nodes = [
    {
      id: "a",
      name: "起点",
      position: { system: "bd09", lng: 121.5, lat: 31.2 },
    },
    {
      id: "b",
      name: "终点",
      position: { system: "bd09", lng: 121.51, lat: 31.2 },
    },
  ];
  await assert.rejects(
    readOutingRoutes(
      { nodes, pairs: [["a", "b"]] },
      gateway,
      new QuotaLedger({ route: 1, other: 50, search: 1, map: 1 }),
      new AbortController().signal,
    ),
    /预算/,
  );
  assert.equal(calls, 0);
  const r = await readOutingRoutes(
    { nodes, pairs: [["a", "b"]] },
    gateway,
    new QuotaLedger({ route: 10, other: 50, search: 1, map: 1 }),
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.equal(r.edges[0].travel.status, "ok");
  assert.equal(r.usage?.routePairs, 1);
});
