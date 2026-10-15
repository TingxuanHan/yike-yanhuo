import test from "node:test";
import assert from "node:assert/strict";
import { TripSession } from "../src/mini/trip.js";
import { cleanBook, emptyBook, mergeBooks } from "../src/shared/life.js";
import {
  cleanActiveTrip,
  stepTrip,
  type ActiveTrip,
} from "../src/shared/trip.js";
import {
  alternativeInput,
  replaceNextStop,
  alternativePrice,
} from "../src/shared/trip-alternative.js";
import { cleanMobility } from "../src/shared/mobility.js";
import { prepareDeparture } from "../src/shared/departure.js";
import { LifeStore } from "../src/server/life-store.js";
import {
  noticeTarget,
  targetKey,
  type NoticeFeed,
} from "../src/shared/neighborhood.js";
import { NeighborhoodSession } from "../src/mini/neighborhood.js";
import { miniRuntime } from "./helpers/mini.js";

async function sessionFixture() {
  const storage = new Map<string, unknown>();
  let now = Date.now(),
    accept = true,
    confirmDelay = 0;
  const session = new TripSession(emptyBook(), null, {
    get: (k) => storage.get(k),
    set: (k, v) => storage.set(k, structuredClone(v)),
    save: (b) => storage.set("yike-life", b),
    request: async () => {
      throw new Error("No paid request in demo");
    },
    notify: () => {},
    confirm: async () => {
      now += confirmDelay;
      return accept;
    },
    now: () => now,
  });
  await session.calculate();
  assert.ok(session.state.plans.length, session.state.error);
  await session.start(session.state.plans[0].id);
  return {
    session,
    storage,
    later: () => (now += 300001),
    consent: (v: boolean) => (accept = v),
    delayConfirmation: (ms: number) => (confirmDelay = ms),
  };
}
test("alternative preview does not change history, cancellation preserves it, apply invalidates the old card", async () => {
  const f = await sessionFixture(),
    s = f.session,
    original = structuredClone(s.state.active!);
  s.prepare();
  const pack = s.state.pack;
  assert.ok(pack);
  s.openAlternatives();
  assert.ok(s.state.alternative!.candidates.length);
  await s.previewAlternative();
  assert.ok(s.state.alternative!.changes.length, s.state.error);
  assert.deepEqual(s.state.active, original);
  f.consent(false);
  await s.applyAlternative();
  assert.deepEqual(s.state.active, original);
  const selected = s.state.alternative!.selected;
  f.consent(true);
  await s.applyAlternative();
  const a = s.state.active!;
  assert.equal(a.remaining[0], selected);
  assert.deepEqual(a.events.slice(0, -1), original.events);
  assert.deepEqual(a.plan, original.plan);
  assert.deepEqual(a.completed, original.completed);
  assert.ok(a.skipped.includes(original.remaining[0]));
  assert.equal(a.replacements!.length, 1);
  assert.equal(s.state.packOutdated, true);
  assert.doesNotThrow(() => cleanActiveTrip(f.storage.get("yike-active-trip")));
  const card = prepareDeparture(
    a.input,
    a.plan,
    emptyBook(),
    "",
    Date.now(),
    a,
  );
  assert.equal(card.places[0].id, selected);
  assert.match(card.checks.join(""), /已更换地点/);
  s.offerRoutine();
  assert.match(s.state.error, /换过地点/);
  await s.finish();
  assert.equal(s.state.routineSuggestion, null);
  assert.equal(f.storage.get("yike-last-routine"), null);
  assert.equal(s.state.active, null);
  s.close();
});
test("expired comparisons and changed trip basis cannot overwrite newer progress", async () => {
  const f = await sessionFixture(),
    s = f.session;
  s.openAlternatives();
  await s.previewAlternative();
  const before = structuredClone(s.state.active);
  f.later();
  await s.applyAlternative();
  assert.match(s.state.error, /过期/);
  assert.deepEqual(s.state.active, before);
  await s.previewAlternative();
  f.delayConfirmation(300001);
  await s.applyAlternative();
  assert.match(s.state.error, /过期/);
  assert.deepEqual(s.state.active, before);
  f.delayConfirmation(0);
  await s.previewAlternative();
  await s.step("leave");
  await s.applyAlternative();
  assert.equal(s.state.active!.phase, "walking");
  assert.equal(s.state.active!.replacements, undefined);
  s.close();
});
test("replacement rejects missing roads, coordinate changes, other categories and invented distant entrances", async () => {
  const { session: s } = await sessionFixture();
  s.openAlternatives();
  const a = s.state.active!,
    c = s.state.alternative!.candidates[0];
  const { nodes, pairs } = alternativeInput(a, c, "place");
  const routes = {
    nodes,
    edges: pairs.map(([from, to]) => ({
      from,
      to,
      travel: { status: "ok" as const, meters: 180, seconds: 160 },
    })),
    mode: "demo" as const,
    generatedAt: new Date().toISOString(),
  };
  assert.throws(
    () =>
      replaceNextStop(a, c, "place", {
        ...routes,
        edges: routes.edges.slice(0, 1),
      }),
    /路线缺失/,
  );
  assert.throws(
    () =>
      replaceNextStop(a, c, "place", {
        ...routes,
        nodes: nodes.map((n) =>
          n.id === c.id
            ? { ...n, position: { system: "demo" as const, x: 999, y: 999 } }
            : n,
        ),
      }),
    /路线缺失/,
  );
  assert.throws(
    () => alternativeInput(a, { ...c, category: "hospital" }, "place"),
    /同类/,
  );
  assert.throws(
    () =>
      alternativeInput(
        a,
        { ...c, position: { system: "demo", x: 3000, y: 3000 } },
        "entrance",
      ),
    /500米/,
  );
  assert.throws(
    () => alternativeInput(stepTrip(a, "leave"), c, "place"),
    /已确认/,
  );
  s.close();
});
test("another entrance remains an explicitly selected point and inherits no old shop prices", async () => {
  const { session: s } = await sessionFixture();
  // Use the market first to ensure the replaced store had matching quotes.
  const a = s.state.active!;
  a.remaining = ["market-a", a.input.origin.id];
  a.input.stops = a.input.stops.filter((n) => n.id !== "shop-c");
  s.openAlternatives("entrance");
  assert.ok(s.state.alternative!.candidates.length);
  await s.previewAlternative();
  assert.match(s.state.alternative!.changes.join(""), /缺价/);
  await s.applyAlternative();
  assert.equal(alternativePrice(s.state.active!).missing, 3);
  assert.equal(
    s.state.active!.input.draft.shoppingBudget,
    a.input.draft.shoppingBudget,
  );
  s.close();
});
test("mobility preferences survive sync, entrance directions stay separate and relevance never upgrades evidence", async () => {
  const needs = { avoidSteps: true, stroller: true, needRest: true };
  const book = cleanBook({ ...emptyBook(), mobility: needs });
  assert.deepEqual(mergeBooks(emptyBook(), book).mobility, needs);
  assert.throws(() => cleanMobility({ avoidSteps: "true" }), /无效/);
  const now = Date.now(),
    db = new LifeStore(":memory:", () => now);
  try {
    const owner = db.authenticate(db.create().token);
    const base = {
      name: "模拟菜场",
      position: { system: "demo" as const, x: 0, y: 0 },
    };
    const east = noticeTarget({
      ...base,
      detail: { kind: "entrance", label: "东门", side: "east" },
    });
    const west = noticeTarget({
      ...base,
      detail: { kind: "entrance", label: "西门", side: "west" },
    });
    assert.notEqual(targetKey(east), targetKey(west));
    const put = (target: unknown, kind: string, id: string) =>
      db.neighborhood.write(owner, null, {
        share: true,
        version: 0,
        requestId: id,
        target,
        kind,
        observation: {
          state: "present",
          basis: "seen",
          at: now,
          note: "人工构造反馈，仅供测试",
        },
      });
    put(west, "closed_now", "testing_west_12345");
    put(east, "steps", "testing_east_12345");
    const feed = db.neighborhood.query(owner, { target: base });
    assert.equal(feed.notices.length, 2);
    const n = new NeighborhoodSession(
      { target: base },
      [],
      {
        get: () => null,
        set: () => {},
        confirm: async () => true,
        notify: () => {},
        request: async <T>() => feed as T,
      },
      needs,
    );
    await n.refresh();
    assert.equal(n.state.notices[0].kind, "steps");
    assert.match(n.state.notices[0].personalReason, /推车/);
    assert.match(n.state.notices[0].locationLabel, /东门/);
    assert.equal(n.state.notices[0].state, "unverified");
    n.dispose();
  } finally {
    db.close();
  }
});
test("native page performs the same alternative confirmation and preference flow without live services", async () => {
  const runtime = miniRuntime(),
    p = runtime.page("trip");
  p.onLoad();
  await p.session.calculate();
  await p.session.start(p.session.state.plans[0].id);
  p.session.openAlternatives();
  await p.alternativePreview();
  assert.ok(p.data.alternative.changes.length, p.data.error);
  const selected = p.data.alternative.selected;
  await p.alternativeApply();
  assert.equal(p.data.active.remaining[0], selected);
  p.mobilityNeed({ currentTarget: { dataset: { key: "avoidSteps" } } });
  assert.equal(p.data.mobility.avoidSteps, true);
  p.onUnload();
});
