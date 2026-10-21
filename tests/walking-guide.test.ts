import test from "node:test";
import assert from "node:assert/strict";
import {
  WalkingGuideSession,
  demoWalkingGuide,
} from "../src/mini/walking-guide.js";
import {
  cleanWalkingGuide,
  cleanWalkingLeg,
  guideKey,
  guideAge,
  WALKING_GUIDES_KEY,
  type WalkingLeg,
  type WalkingGuide,
} from "../src/shared/walking-guide.js";
import { cleanNode } from "../src/shared/outings.js";
import { emptyBook } from "../src/shared/life.js";
import { TripSession } from "../src/mini/trip.js";
import { prepareDeparture } from "../src/shared/departure.js";
import { departureHtml } from "../src/client/offline-departure.js";
import { readWalkingGuide } from "../src/server/walking-guide.js";
import { BaiduGateway } from "../src/server/baidu.js";
import { QuotaLedger } from "../src/server/quota.js";
import { miniRuntime } from "./helpers/mini.js";

const leg: WalkingLeg = {
  from: {
    id: "home",
    name: "公开测试起点",
    position: { system: "bd09", lng: 121.516498, lat: 31.283734 },
  },
  to: {
    id: "f-market:example",
    name: "公开测试终点",
    position: { system: "bd09", lng: 121.517832, lat: 31.282418 },
  },
};
const demo: WalkingLeg = {
  from: {
    id: "home",
    name: "模拟起点",
    position: { system: "demo", x: -400, y: 0 },
  },
  to: {
    id: "shop",
    name: "模拟菜场",
    position: { system: "demo", x: -600, y: -200 },
  },
};
const fixture = (): WalkingGuide => ({
  ...structuredClone(leg),
  version: 1,
  source: "baidu",
  obtainedAt: Date.now(),
  meters: 300,
  seconds: 250,
  steps: [
    { instruction: "沿测试道路向前走。", meters: 200 },
    { instruction: "右转到测试地点。", meters: 100 },
  ],
});
function session(
  options: {
    confirm?: () => Promise<boolean>;
    request?: () => Promise<WalkingGuide>;
    failSave?: boolean;
  } = {},
) {
  const store = new Map<string, unknown>();
  let calls = 0;
  const s = new WalkingGuideSession({
    get: (k) => store.get(k),
    set: (k, v) => {
      if (options.failSave) throw new Error("full");
      store.set(k, structuredClone(v));
    },
    confirm: options.confirm ?? (async () => true),
    request: async <T>() => {
      calls++;
      return (await (options.request?.() ?? fixture())) as T;
    },
    notify: () => {},
    now: Date.now,
  });
  return { s, store, calls: () => calls };
}
test("walking steps bind to exact ordered endpoints, keep facility IDs and reject incomplete guidance", () => {
  assert.equal(cleanNode(leg.to).id, "f-market:example");
  assert.throws(() => cleanNode({ ...leg.to, id: "../../other" }));
  assert.notEqual(guideKey(leg), guideKey({ from: leg.to, to: leg.from }));
  assert.throws(() => cleanWalkingLeg({ from: leg.from, to: leg.from }));
  assert.throws(() => cleanWalkingGuide({ ...fixture(), steps: [] }));
  assert.throws(() =>
    cleanWalkingGuide({
      ...fixture(),
      steps: [{ meters: 1, instruction: "<img src=x>" }],
    }),
  );
  assert.throws(() => cleanWalkingGuide({ ...fixture(), source: "demo" }));
  assert.match(guideAge(fixture(), Date.now() + 86400001), /24小时/);
});
test("walking endpoint uses shared serialized gateway, preserves coordinate order and cleans provider HTML", async () => {
  const requests: URL[] = [];
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    fetcher: async (url) => {
      requests.push(new URL(String(url)));
      return new Response(
        JSON.stringify({
          status: 0,
          result: {
            routes: [
              {
                distance: 300,
                duration: 250,
                steps: [
                  {
                    distance: 300,
                    instruction:
                      "沿<b>测试道路</b>&nbsp;走300米<script>bad()</script>",
                  },
                ],
              },
            ],
          },
        }),
      );
    },
  });
  const insufficient = new QuotaLedger({
    route: 1,
    search: 0,
    map: 0,
    other: 0,
  });
  await assert.rejects(
    readWalkingGuide(leg, gateway, insufficient, new AbortController().signal),
    /预算/,
  );
  assert.equal(requests.length, 0);
  const quota = new QuotaLedger({ route: 10, search: 0, map: 0, other: 10 });
  const g = await readWalkingGuide(
    leg,
    gateway,
    quota,
    new AbortController().signal,
  );
  assert.equal(g.steps[0].instruction, "沿测试道路 走300米");
  assert.equal(requests[0].pathname, "/directionlite/v1/walking");
  assert.equal(requests[0].searchParams.get("origin"), "31.283734,121.516498");
  assert.equal(requests[0].searchParams.get("coord_type"), "bd09ll");
  assert.equal(requests[0].searchParams.get("steps_info"), "1");
  await readWalkingGuide(leg, gateway, quota, new AbortController().signal);
  assert.equal(
    requests.length,
    1,
    "identical cached leg must not call provider again",
  );
  const gcj = {
    from: { ...leg.from, position: { ...leg.from.position, system: "gcj02" } },
    to: { ...leg.to, position: { ...leg.to.position, system: "gcj02" } },
  };
  await readWalkingGuide(gcj, gateway, quota, new AbortController().signal);
  assert.equal(requests.at(-1)?.searchParams.get("coord_type"), "gcj02");
});
test("missing provider steps fail explicitly rather than inventing instructions", async () => {
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    fetcher: async () =>
      new Response(
        JSON.stringify({
          status: 0,
          result: { routes: [{ distance: 300, duration: 250 }] },
        }),
      ),
  });
  await assert.rejects(
    readWalkingGuide(
      leg,
      gateway,
      new QuotaLedger({ route: 10, other: 10, search: 0, map: 0 }),
      new AbortController().signal,
    ),
    /未返回完整/,
  );
});
test("guide consent, single flight, stale response discard, cache binding and failed save are explicit", async () => {
  const denied = session({ confirm: async () => false });
  denied.s.show([leg]);
  await denied.s.load();
  assert.equal(denied.calls(), 0);
  let finish!: (g: WalkingGuide) => void;
  const x = session({
    request: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  x.s.show([leg]);
  const pending = x.s.load();
  await Promise.resolve();
  await x.s.load();
  assert.equal(x.calls(), 1);
  x.s.close();
  finish(fixture());
  await pending;
  assert.equal(x.store.size, 0);
  assert.equal(x.s.state.guide, null);
  const y = session();
  y.s.show([leg]);
  await y.s.load();
  assert.ok(y.store.has(WALKING_GUIDES_KEY));
  y.s.close();
  y.s.show([leg]);
  assert.ok(y.s.state.guide);
  assert.equal(y.calls(), 1);
  y.s.show([
    {
      ...leg,
      to: { ...leg.to, position: { system: "bd09", lng: 121.6, lat: 31.2 } },
    },
  ]);
  assert.equal(y.s.state.guide, null);
  const z = session({ failSave: true });
  z.s.show([leg]);
  await z.s.load();
  assert.match(z.s.state.status, /保存未完成/);
  assert.ok(z.s.state.guide);
});
test("failed refresh retains saved route; bad endpoint reply never poisons offline cache", async () => {
  const x = session({
    request: async () => {
      throw new Error("网络不可用");
    },
  });
  x.store.set(WALKING_GUIDES_KEY, [fixture()]);
  x.s.show([leg]);
  const old = x.s.state.guide;
  await x.s.load();
  assert.deepEqual(x.s.state.guide, old);
  assert.match(x.s.state.error, /网络/);
  const y = session({
    request: async () => ({ ...fixture(), from: leg.to, to: leg.from }),
  });
  y.s.show([leg]);
  await y.s.load();
  assert.equal(y.store.size, 0);
  assert.match(y.s.state.error, /不匹配/);
});
test("demo follows the barrier graph and reading steps never changes trip or family position", async (t) => {
  const across = {
    from: { ...demo.from, position: { system: "demo" as const, x: 400, y: 0 } },
    to: { ...demo.to, position: { system: "demo" as const, x: 600, y: 0 } },
  };
  assert.equal(demoWalkingGuide(across, Date.now()).meters, 1400);
  const store = new Map<string, unknown>();
  const s = new TripSession(emptyBook(), null, {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, structuredClone(v)),
    save: () => {},
    request: async () => {
      throw Error("Unexpected network");
    },
    confirm: async () => true,
    notify: () => {},
  });
  t.after(() => s.close());
  await s.calculate();
  const id = s.state.plans[0].id;
  await s.start(id);
  s.openGuide();
  await s.walking.load();
  const before = JSON.stringify([
    s.state.active,
    store.get("yike-location-record"),
  ]);
  s.walking.turn(1);
  assert.equal(
    JSON.stringify([s.state.active, store.get("yike-location-record")]),
    before,
  );
  s.prepare();
  assert.equal(s.state.pack?.guides.length, 1);
  assert.ok(s.state.pack?.guideMissing.length);
  const html = departureHtml(s.state.pack!);
  assert.ok(html.includes("沿模拟道路"));
  assert.ok(!/src=["']https?:/i.test(html));
  assert.ok(!html.includes('"position"'));
  await s.step("leave");
  assert.equal(s.state.guide.open, false);
});
test("native page opens steps, persists offline card and restores without server", async (t) => {
  const store = new Map<string, unknown>();
  const p = miniRuntime(store).page("trip");
  p.onLoad();
  p.onShow();
  t.after(() => p.onUnload());
  await p.calculate();
  const event = { currentTarget: { dataset: { id: p.data.plans[0].id } } };
  p.openGuide(event);
  await p.guideLoad();
  assert.ok(p.data.guide.guide.steps.length);
  p.guideTurn({ currentTarget: { dataset: { delta: "1" } } });
  assert.equal(p.data.active, null);
  p.prepare(event);
  assert.equal(p.data.pack.guides.length, 1);
  const q = miniRuntime(store).page("trip");
  q.onLoad();
  t.after(() => q.onUnload());
  assert.equal(q.data.packGuides.length, 1);
  assert.ok(q.data.packGuides[0].steps.length);
});
test("personal place scene prefix still includes exact matching entrance information in departure card", async (t) => {
  const s = new TripSession(emptyBook(), null, {
    get: () => null,
    set: () => {},
    save: () => {},
    request: async () => {
      throw Error("network");
    },
    confirm: async () => true,
    notify: () => {},
  });
  t.after(() => s.close());
  await s.calculate();
  await s.start(s.state.plans[0].id);
  const a = structuredClone(s.state.active!),
    node = a.input.stops.find((n) => a.plan.stopIds.includes(n.id))!,
    old = node.id;
  node.id = "p-private-place";
  a.plan.stopIds = a.plan.stopIds.map((id) => (id === old ? node.id : id));
  const b = emptyBook();
  b.places = [
    {
      id: "private-place",
      name: node.name,
      position: node.position,
      source: "personal",
      address: "测试门牌",
      landmark: "测试侧门",
      note: "",
      visitedOn: "2026-10-01",
    },
  ];
  const p = prepareDeparture(a.input, a.plan, b, "");
  assert.equal(p.places.find((p) => p.id === node.id)?.landmark, "测试侧门");
  b.places[0].position = { system: "demo", x: 300, y: 300 };
  assert.notEqual(
    prepareDeparture(a.input, a.plan, b, "").places.find(
      (p) => p.id === node.id,
    )?.landmark,
    "测试侧门",
  );
});
