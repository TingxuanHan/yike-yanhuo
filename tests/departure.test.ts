import test from "node:test";
import assert from "node:assert/strict";
import { TripSession } from "../src/mini/trip.js";
import { cleanBook, emptyBook, mergeBooks } from "../src/shared/life.js";
import {
  cleanRoutine,
  cleanDeparture,
  DEPARTURE_KEY,
  departureAge,
} from "../src/shared/departure.js";
import { departureHtml } from "../src/client/offline-departure.js";
import { miniRuntime } from "./helpers/mini.js";

function session(storage = new Map<string, unknown>(), initial = emptyBook()) {
  let book = initial;
  const s = new TripSession(book, null, {
    get: (k) => storage.get(k),
    set: (k, v) => storage.set(k, structuredClone(v)),
    save: (b) => {
      book = cleanBook(b);
      storage.set("yike-life", structuredClone(book));
    },
    request: async () => {
      throw new Error("unexpected network");
    },
    confirm: async () => true,
    notify: () => {},
  });
  return { s, storage, book: () => book };
}
test("routine sync retains only reusable conditions and recalculates with current clock and pace", async (t) => {
  const x = session();
  t.after(() => x.s.close());
  await x.s.calculate();
  assert.ok(x.s.state.plans.length);
  const plan = x.s.state.plans[0];
  x.s.offerRoutine(plan.id);
  x.s.routineName("买菜＋取药");
  x.s.saveRoutine();
  const routine = x.book().routines![0];
  assert.equal(routine.draft.departure, null);
  assert.equal(routine.draft.speedMps, null);
  assert.equal(JSON.stringify(routine).includes('"prices"'), false);
  assert.equal(JSON.stringify(routine).includes('"edges"'), false);
  const incoming = mergeBooks(emptyBook(), x.book());
  incoming.preferences.speedMps = 0.8;
  const y = session(new Map(), incoming);
  t.after(() => y.s.close());
  await y.s.useRoutine(routine.id);
  assert.equal(y.s.state.form.speedMps, "0.8");
  assert.match(y.s.state.status, /按当前时间/);
  assert.ok(y.s.state.plans.length);
  assert.equal(y.s.state.active, null);
  assert.deepEqual(
    y.s.state.candidates
      .filter((c) => c.checked)
      .map((c) => c.id)
      .sort(),
    routine.stops.map((s) => s.id).sort(),
  );
});
test("routine does not substitute missing or shifted places, or mix a different origin", async (t) => {
  const x = session();
  t.after(() => x.s.close());
  await x.s.calculate();
  x.s.offerRoutine(x.s.state.plans[0].id);
  x.s.saveRoutine();
  const b = x.book(),
    r = b.routines![0];
  r.stops[0].id = "missing-place";
  const y = session(new Map(), b);
  t.after(() => y.s.close());
  await y.s.useRoutine(r.id);
  assert.match(y.s.state.error, /不在当前地点记录/);
  assert.equal(y.s.state.plans.length, 0);
  const b2 = structuredClone(b);
  b2.routines![0].origin.position = { system: "demo", x: 77, y: 99 };
  const z = session(new Map(), b2);
  t.after(() => z.s.close());
  await z.s.useRoutine(r.id);
  assert.match(z.s.state.error, /出发点.*不同/);
  assert.equal(z.s.state.plans.length, 0);
  assert.throws(
    () =>
      cleanBook({
        ...b,
        routines: Array.from({ length: 9 }, (_, i) => ({ ...r, id: `r-${i}` })),
      }),
    /数量/,
  );
  assert.throws(() => cleanRoutine({ ...r, stops: [r.origin] }), /地点/);
});
test("departure snapshot remains offline, includes return and contact, and changes invalidate its current-trip claim", async (t) => {
  const x = session(new Map([["yike-help-phone", "10086"]]));
  t.after(() => x.s.close());
  await x.s.calculate();
  let p = x.s.state.plans[0];
  x.s.prepare(p.id);
  x.s.set("tripMinutes", "60");
  assert.equal(x.s.state.packOutdated, true);
  await x.s.calculate();
  assert.equal(x.s.state.packOutdated, true);
  p = x.s.state.plans[0];
  x.s.prepare(p.id);
  assert.equal(x.s.state.packOutdated, false);
  assert.equal(x.s.state.error, "");
  const pack = x.s.state.pack!;
  assert.equal(pack.phone, "10086");
  assert.ok(pack.schedule.at(-1)?.includes("回到"));
  assert.ok(pack.checks.some((c) => c.includes("库存")));
  assert.equal(cleanDeparture(x.storage.get(DEPARTURE_KEY)).basis, pack.basis);
  await x.s.start(p.id);
  assert.equal(x.s.state.packOutdated, false);
  await x.s.step("leave");
  await x.s.step("arrive");
  await x.s.step("return");
  assert.equal(x.s.state.packOutdated, true);
  x.s.prepare();
  assert.equal(x.s.state.packOutdated, false);
  assert.equal(x.s.state.pack!.places.length, 0);
  assert.match(
    x.s.state.pack!.checks[2] ?? x.s.state.pack!.checks[1],
    /原|出发时|库存/,
  );
  const restored = session(x.storage, x.book());
  t.after(() => restored.s.close());
  assert.equal(restored.s.state.pack?.phone, "10086");
  assert.match(departureAge(pack, pack.preparedAt + 86400000), /不是今天/);
  await x.s.finish();
  assert.ok(x.s.state.routineSuggestion);
  x.s.offerRoutine();
  x.s.saveRoutine();
  assert.equal(x.book().routines?.length, 1);
});
test("failed local save retains old departure card and offline HTML escapes every user string with no remote resources", async (t) => {
  const store = new Map<string, unknown>();
  const x = session(store);
  t.after(() => x.s.close());
  await x.s.calculate();
  x.s.prepare(x.s.state.plans[0].id);
  const old = x.s.state.pack!;
  const bad = new TripSession(emptyBook(), null, {
    get: (k) => store.get(k),
    set: (k, v) => {
      if (k === DEPARTURE_KEY) throw new Error("quota");
      store.set(k, structuredClone(v));
    },
    save: () => {},
    request: async () => {
      throw new Error("network");
    },
    confirm: async () => true,
    notify: () => {},
  });
  t.after(() => bad.close());
  await bad.calculate();
  assert.ok(bad.state.plans.length);
  bad.prepare(bad.state.plans[0].id);
  assert.match(bad.state.error, /quota/);
  assert.deepEqual(bad.state.pack, old);
  assert.deepEqual(store.get(DEPARTURE_KEY), old);
  const html = departureHtml({
    ...old,
    returnPlace: {
      ...old.returnPlace,
      name: '<img src=x onerror="alert(1)">',
      landmark: "</p><script>bad()</script>",
    },
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("default-src 'none'"));
  assert.equal(/src=["']https?:/i.test(html), false);
  assert.equal(/invite|yike-token|Authorization/.test(html), false);
});
test("native page saves, reuses and reopens preparation without a server", async (t) => {
  const store = new Map<string, any>([["yike-help-phone", "10086"]]);
  const p = miniRuntime(store).page("trip");
  p.onLoad();
  p.onShow();
  t.after(() => p.onUnload());
  await p.calculate();
  const id = p.data.plans[0].id;
  p.offerRoutine({ currentTarget: { dataset: { id } } });
  p.routineName({ detail: { value: "常走的买菜路" } });
  p.saveRoutine();
  p.prepare({ currentTarget: { dataset: { id } } });
  assert.equal(p.data.pack.phone, "10086");
  assert.equal(p.data.showPack, true);
  const q = miniRuntime(store).page("trip");
  q.onLoad();
  q.onShow();
  t.after(() => q.onUnload());
  assert.equal(q.data.pack.phone, "10086");
  assert.equal(q.data.routines[0].name, "常走的买菜路");
  await q.useRoutine({
    currentTarget: { dataset: { id: q.data.routines[0].id } },
  });
  assert.ok(q.data.plans.length);
  assert.equal(q.data.active, null);
});
