import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanFamily,
  cleanLocation,
  latestLocation,
  locationSummary,
  tripLocation,
  LOCATION_KEY,
} from "../src/shared/family.js";
import { FamilySession } from "../src/mini/family.js";
import { LifeStore } from "../src/server/life-store.js";
const now = Date.now();
const record = {
  source: "confirmed" as const,
  name: "测试街角（构造）",
  at: now - 600_000,
  accuracyM: null,
  position: { system: "gcj02" as const, lng: 121.5, lat: 31.2 },
};
test("location evidence only retains explicit real observations, never demo, future or planned visits", () => {
  assert.throws(() =>
    cleanLocation({ ...record, position: { system: "demo", x: 1, y: 2 } }, now),
  );
  assert.throws(() => cleanLocation({ ...record, at: now + 120_000 }, now));
  assert.throws(() =>
    cleanLocation(
      { ...record, position: { system: "gcj02", lng: 200, lat: 20 } },
      now,
    ),
  );
  const clean = cleanFamily(
    {
      record: { ...record, phone: "private", book: { hidden: true } },
      speedMps: 1.2,
      token: "private",
    },
    now,
  );
  assert.equal(JSON.stringify(clean).includes("private"), false);
  const active: any = {
    input: {
      bundle: { mode: "baidu" },
      origin: { id: "home", name: "home", position: record.position },
      stops: [],
    },
    events: [{ kind: "start", at: now, placeId: "home" }],
  };
  assert.equal(tripLocation(active, now), null);
  active.events.push({ kind: "arrive", at: now, placeId: "home" });
  assert.equal(tripLocation(active, now)?.at, now);
  active.input.bundle.mode = "demo";
  assert.equal(tripLocation(active, now), null);
});
test("walking envelope widens with elapsed time and stops after 30 minutes, uncertain accuracy never gets a fake radius", () => {
  const snapshot = { record, speedMps: 0.5 };
  const first = locationSummary(snapshot, now);
  assert.equal(first.radiusM, 1300);
  assert.ok(locationSummary(snapshot, now + 60_000).radiusM! > first.radiusM!);
  assert.match(first.detail, /乘车、跑步时不适用/);
  assert.equal(locationSummary(snapshot, now + 1201_000).radiusM, null);
  assert.match(locationSummary(snapshot, now + 1201_000).detail, /超过30分钟/);
  assert.equal(
    locationSummary(
      { record: { ...record, source: "device", accuracyM: null }, speedMps: 1 },
      now,
    ).radiusM,
    null,
  );
  assert.equal(
    locationSummary(
      { record: { ...record, source: "device", accuracyM: 1500 }, speedMps: 1 },
      now,
    ).radiusM,
    null,
  );
  assert.equal(
    latestLocation([record, { ...record, at: now }, {}], now)?.at,
    now,
  );
});
test("position links only disclose one allowlisted observation, are owner scoped, replace old links, and erase bodies after revocation/expiry", () => {
  let clock = now;
  const db = new LifeStore(":memory:", () => clock);
  try {
    const owner = db.authenticate(db.create().token),
      other = db.authenticate(db.create().token);
    const a = db.family.create(owner, { record, speedMps: 1.2 });
    assert.equal(
      db.family.read(a.view.id, undefined, a.invite).snapshot.record.name,
      record.name,
    );
    assert.throws(() => db.authenticate(a.invite));
    assert.throws(() => db.family.read(a.view.id, other));
    assert.throws(() => db.family.close(a.view.id, other));
    assert.throws(() => db.family.read(a.view.id, undefined, "bad"));
    const b = db.family.create(owner, { record, speedMps: 1.2 });
    assert.throws(
      () => db.family.read(a.view.id, undefined, a.invite),
      /停止或到期/,
    );
    db.family.close(b.view.id, owner);
    db.family.close(b.view.id, owner);
    assert.throws(
      () => db.family.read(b.view.id, undefined, b.invite),
      /停止或到期/,
    );
    const c = db.family.create(owner, { record, speedMps: 1.2 });
    clock += 3600001;
    assert.throws(
      () => db.family.read(c.view.id, undefined, c.invite),
      /停止或到期/,
    );
    assert.throws(
      () =>
        db.family.create(owner, {
          record: { ...record, at: clock - 86400001 },
          speedMps: 1.2,
        }),
      /超过一天/,
    );
  } finally {
    db.close();
  }
});
test("denied permission keeps last observation and phone usable; sharing and copying require an explicit confirmation", async (t) => {
  const storage = new Map<string, any>([
    [LOCATION_KEY, record],
    ["yike-help-phone", "10086"],
  ]);
  let network = 0,
    consent = false,
    copied = "";
  const s = new FamilySession({
    get: (k) => storage.get(k),
    set: (k, v) => {
      storage.set(k, v);
    },
    locate: async () => {
      throw new Error("denied");
    },
    confirm: async () => consent,
    request: async () => {
      network++;
      throw new Error("offline");
    },
    notify: () => {},
    speedMps: 1.2,
    now: () => now,
  });
  t.after(() => s.close());
  s.reopen();
  await s.locate();
  assert.equal(s.state.phone, "10086");
  assert.equal(s.state.snapshot?.record.at, record.at);
  assert.equal(s.state.locationFailed, true);
  assert.equal(network, 0);
  await s.share();
  await s.copyText(async (t) => {
    copied = t;
  });
  assert.equal(network, 0);
  assert.equal(copied, "");
  consent = true;
  await s.copyText(async (t) => {
    copied = t;
  });
  assert.match(copied, /GCJ02/);
  assert.match(copied, /不是实时定位/);
  await s.share();
  assert.equal(network, 1);
  assert.match(s.state.error, /offline/);
  assert.equal(s.state.snapshot?.record.at, record.at);
});
test("location arriving after a page closes is discarded; repeated clicks do not request duplicate fixes", async (t) => {
  let resolve!: (v: typeof record) => void,
    calls = 0;
  const storage = new Map<string, any>();
  const s = new FamilySession({
    get: (k) => storage.get(k),
    set: (k, v) => {
      storage.set(k, v);
    },
    locate: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
    confirm: async () => true,
    request: async () => {
      throw new Error("unexpected");
    },
    notify: () => {},
    speedMps: 1.2,
    now: () => now,
  });
  t.after(() => s.close());
  s.reopen();
  const pending = s.locate();
  await s.locate();
  assert.equal(calls, 1);
  s.close();
  resolve(record);
  await pending;
  assert.equal(storage.has(LOCATION_KEY), false);
  assert.equal(s.state.snapshot, null);
});
test("stop while a share is being created revokes the new link after creation", async (t) => {
  let resolve!: (v: any) => void;
  const paths: string[] = [],
    storage = new Map<string, any>([[LOCATION_KEY, record]]);
  const s = new FamilySession({
    get: (k) => storage.get(k),
    set: (k, v) => {
      storage.set(k, v);
    },
    locate: async () => record,
    confirm: async () => true,
    request: async <T>(p: string, m?: string) => {
      paths.push(m + p);
      return (
        m === "POST"
          ? await new Promise((r) => {
              resolve = r;
            })
          : {}
      ) as T;
    },
    notify: () => {},
    speedMps: 1.2,
    now: () => now,
  });
  t.after(() => s.close());
  s.reopen();
  const pending = s.share();
  await new Promise<void>((r) => setImmediate(r));
  await s.end();
  resolve({
    view: { id: "abc", expiresAt: now + 3600000, snapshot: s.state.snapshot },
    invite: "test",
  });
  await pending;
  assert.ok(paths.includes("DELETE/api/life/family/abc"));
  assert.equal(s.state.share, null);
});
