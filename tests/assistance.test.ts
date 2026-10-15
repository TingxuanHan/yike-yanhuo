import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { LifeStore } from "../src/server/life-store.js";
import { createApp } from "../src/server/app.js";
import { TripSession } from "../src/mini/trip.js";
import { AssistanceSession, HelperSession } from "../src/mini/assistance.js";
import { emptyBook, cleanBook, mergeBooks } from "../src/shared/life.js";
import {
  makeAssistSnapshot,
  cleanAssistSnapshot,
  cleanEntrance,
} from "../src/shared/assistance.js";
import { adjustTrip, tripBasis } from "../src/shared/trip-adjust.js";
import { stepTrip } from "../src/shared/trip.js";

async function outing() {
  const storage = new Map<string, unknown>();
  const session = new TripSession(emptyBook(), null, {
    get: (k) => storage.get(k),
    set: (k, v) => storage.set(k, v),
    save: () => {},
    confirm: async () => true,
    request: async () => {
      throw new Error("No map or AI calls expected");
    },
    notify: () => {},
  });
  await session.calculate();
  await session.start(session.state.plans[0].id);
  return { session, storage, active: session.state.active! };
}
test("assistance stores only a selected snapshot and scoped helper capability cannot read the private book", async () => {
  const { active } = await outing();
  let now = Date.now();
  const db = new LifeStore(":memory:", () => now);
  try {
    const device = db.create(),
      owner = db.authenticate(device.token),
      other = db.authenticate(db.create().token);
    const payload = {
      ...makeAssistSnapshot(active, "请看看入口"),
      book: { secret: "private" },
      apiKey: "not-shared",
    };
    const { view, invite } = db.assistance.create(owner, payload);
    assert.equal(JSON.stringify(view).includes("private"), false);
    assert.equal(JSON.stringify(view).includes("apiKey"), false);
    assert.throws(() => db.authenticate(invite));
    assert.throws(() => db.assistance.read(view.id, other));
    assert.throws(() => db.assistance.read(view.id, undefined, "wrong"));
    assert.equal(
      db.assistance.read(view.id, undefined, invite).snapshot.tripId,
      active.id,
    );
    const proposed = db.assistance.propose(view.id, invite, view.revision, {
      id: "suggestion1",
      helper: "家人",
      kind: "message",
      note: "先在原地等一下",
      snapshotVersion: 1,
      evil: "drop",
    });
    assert.equal(JSON.stringify(proposed).includes("evil"), false);
    assert.equal(proposed.proposal?.kind, "message");
    assert.throws(() =>
      db.assistance.resolve(
        view.id,
        other,
        proposed.revision,
        "suggestion1",
        "accepted",
      ),
    );
    const progressed = stepTrip(active, "leave", active.lastAt + 1000);
    const changed = db.assistance.update(
      view.id,
      owner,
      proposed.revision,
      makeAssistSnapshot(progressed, "请看看入口"),
    );
    assert.equal(changed.proposal, null);
    assert.throws(() =>
      db.assistance.propose(view.id, invite, changed.revision, {
        id: "old",
        kind: "message",
        helper: "家人",
        note: "old",
        snapshotVersion: 1,
      }),
    );
    assert.throws(() =>
      db.assistance.update(view.id, owner, changed.revision - 1, payload),
    );
    now += 3600001;
    assert.throws(() => db.assistance.read(view.id, undefined, invite));
    assert.equal(db.assistance.list(owner).length, 0);
  } finally {
    db.close();
  }
});
test("end immediately revokes helper reads and writes, including after a successful suggestion", async () => {
  const { active } = await outing(),
    db = new LifeStore();
  try {
    const owner = db.authenticate(db.create().token),
      { view, invite } = db.assistance.create(
        owner,
        makeAssistSnapshot(active, ""),
      );
    const body = {
      id: "suggestion1",
      helper: "女儿",
      kind: "plan",
      note: "少去一站",
      snapshotVersion: 1,
      change: {
        remaining: active.remaining
          .filter((id) => id !== active.input.origin.id)
          .slice(0, 1),
        speedMps: 0.8,
      },
    };
    const p = db.assistance.propose(view.id, invite, 1, body);
    assert.deepEqual(db.assistance.propose(view.id, invite, 1, body), p);
    assert.throws(() =>
      db.assistance.propose(view.id, invite, p.revision, {
        ...body,
        id: "second",
      }),
    );
    db.assistance.resolve(view.id, owner, p.revision, body.id, "rejected");
    db.assistance.close(view.id, owner);
    db.assistance.close(view.id, owner);
    assert.throws(() => db.assistance.read(view.id, undefined, invite));
    assert.throws(() => db.assistance.propose(view.id, invite, 1, body));
  } finally {
    db.close();
  }
});
test("mid-trip adjustments keep completed evidence, preserve budgets, require known roads and cannot teleport", async () => {
  const { active } = await outing();
  const walking = stepTrip(active, "leave", active.lastAt + 1000);
  assert.throws(() =>
    adjustTrip(
      walking,
      { remaining: [], speedMps: 0.8 },
      walking.lastAt + 1000,
    ),
  );
  const at = stepTrip(walking, "arrive", walking.lastAt + 60000),
    before = JSON.stringify(at);
  const changed = adjustTrip(
    at,
    { remaining: [], speedMps: 0.7 },
    at.lastAt + 1000,
  );
  assert.deepEqual(changed.active.remaining, [at.input.origin.id]);
  assert.deepEqual(changed.active.completed, at.completed);
  assert.deepEqual(changed.active.events.slice(0, at.events.length), at.events);
  assert.equal(
    changed.active.input.draft.shoppingBudget,
    at.input.draft.shoppingBudget,
  );
  assert.equal(changed.active.startedAt, at.startedAt);
  assert.equal(JSON.stringify(at), before);
  assert.notEqual(tripBasis(changed.active), tripBasis(at));
  const missing = JSON.parse(before);
  missing.input.bundle.edges = missing.input.bundle.edges.filter(
    (e: any) => !(e.from === at.currentId && e.to === at.input.origin.id),
  );
  assert.throws(() =>
    adjustTrip(missing, { remaining: [], speedMps: 0.7 }, at.lastAt + 1000),
  );
  assert.throws(() =>
    adjustTrip(
      at,
      { remaining: [at.currentId], speedMps: 0.7 },
      at.lastAt + 1000,
    ),
  );
});
test("entrance photos survive private sync cleaning and sharing rejects unsafe formats and unrelated places", async () => {
  const { active } = await outing(),
    id = active.remaining[0];
  const guide = cleanEntrance({
    id,
    name: "入口",
    photo: "data:image/png;base64,iVBORw0KGgo=",
    x: 0.2,
    y: 0.7,
    instruction: "蓝色门框",
    observedOn: "2026-10-14",
    source: "self",
    secret: "omit",
  });
  const b = cleanBook({ ...emptyBook(), entrances: [guide] });
  assert.deepEqual(b.entrances, [guide]);
  const incoming = cleanBook({
    ...emptyBook(),
    entrances: Array.from({ length: 12 }, (_, i) => ({
      ...guide,
      id: `other-${i}`,
    })),
  });
  const original = JSON.stringify(b);
  assert.throws(() => mergeBooks(b, incoming), /容量/);
  assert.equal(JSON.stringify(b), original);
  assert.throws(() => cleanEntrance({ ...guide, x: 2 }));
  assert.throws(() => cleanEntrance({ ...guide, observedOn: "2026-02-30" }));
  assert.throws(() =>
    cleanEntrance({ ...guide, photo: "https://example.com/image.png" }),
  );
  const snap = makeAssistSnapshot(active, "入口在哪", guide);
  assert.throws(() =>
    cleanAssistSnapshot({ ...snap, guide: { ...guide, id: "not-in-trip" } }),
  );
  assert.equal(JSON.stringify(snap).includes("position"), false);
});

test("ending during creation or refresh revokes the invitation even after the page is hidden", async () => {
  const { active } = await outing();
  for (const blockedMethod of ["POST", "GET"]) {
    const db = new LifeStore(),
      owner = db.authenticate(db.create().token);
    const storage = new Map<string, unknown>();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const session = new AssistanceSession({
      active: () => active,
      get: (k) => storage.get(k),
      set: (k, v) => {
        storage.set(k, v);
      },
      notify: () => {},
      confirm: async () => true,
      apply: async () => {},
      request: async <T>(
        path: string,
        method = "GET",
        body?: any,
      ): Promise<T> => {
        const id = path.split("/").at(-1)!;
        let result: unknown;
        if (method === "POST")
          result = db.assistance.create(owner, body.snapshot);
        if (method === "GET") result = db.assistance.read(id, owner);
        if (method === "DELETE") db.assistance.close(id, owner);
        if (method === blockedMethod) {
          started();
          await gate;
        }
        return result as T;
      },
    });
    try {
      const creating = session.start("帮忙看看", null);
      const operation =
        blockedMethod === "POST"
          ? creating
          : creating.then(() => session.refresh());
      await entered;
      await session.end();
      session.close();
      release();
      await operation;
      assert.equal(db.assistance.list(owner).length, 0);
      assert.equal(session.state.view, null);
      assert.equal(storage.get("yike-assistance"), null);
    } finally {
      session.close();
      db.close();
    }
  }
});

test("lost owner acknowledgements can be retried without applying a suggestion twice", async () => {
  const { active } = await outing();
  for (const lostAfterSave of [false, true]) {
    const db = new LifeStore(),
      owner = db.authenticate(db.create().token);
    const storage = new Map<string, unknown>();
    let applied = 0,
      failOnce = true;
    const session = new AssistanceSession({
      active: () => active,
      get: (k) => storage.get(k),
      set: (k, v) => {
        storage.set(k, v);
      },
      notify: () => {},
      confirm: async () => true,
      apply: async () => {
        applied++;
      },
      request: async <T>(
        path: string,
        method = "GET",
        body?: any,
      ): Promise<T> => {
        if (path === "/api/life/assistance")
          return db.assistance.create(owner, body.snapshot) as T;
        const id = path.split("/")[4];
        if (path.endsWith("/decision")) {
          if (failOnce && !lostAfterSave) {
            failOnce = false;
            throw new Error("离线");
          }
          const result = db.assistance.resolve(
            id,
            owner,
            body.revision,
            body.proposalId,
            body.decision,
          );
          if (failOnce) {
            failOnce = false;
            throw new Error("响应丢失");
          }
          return result as T;
        }
        return db.assistance.read(id, owner) as T;
      },
    });
    try {
      await session.start("帮忙看看", null);
      const v = session.state.view!;
      db.assistance.propose(v.id, session.state.invite, v.revision, {
        id: "once",
        kind: "message",
        helper: "家人",
        note: "原地等候",
        snapshotVersion: 1,
      });
      await session.refresh();
      await session.decide(true);
      assert.equal(applied, 1);
      assert.ok(session.state.error);
      assert.ok(storage.get("yike-assist-decision"));
      await session.decide(true);
      assert.equal(applied, 1);
      assert.equal(session.state.view!.proposal, null);
      assert.equal(storage.get("yike-assist-decision"), null);
    } finally {
      session.close();
      db.close();
    }
  }
});
test("helper polling resumes after a slow send and stops with hidden content on expiry", async (t) => {
  const { active } = await outing(),
    db = new LifeStore(),
    owner = db.authenticate(db.create().token);
  const { view } = db.assistance.create(owner, makeAssistSnapshot(active, ""));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0,
    expired = false,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const helper = new HelperSession(
    async <T>(method = "GET"): Promise<T> => {
      if (method === "POST") await gate;
      else reads++;
      if (expired)
        throw Object.assign(new Error("协助已到期"), { status: 410 });
      return structuredClone(view) as T;
    },
    () => {},
  );
  try {
    helper.reopen();
    await Promise.resolve();
    helper.field("note", "慢一点走");
    const send = helper.send();
    t.mock.timers.tick(5001);
    release();
    await send;
    expired = true;
    t.mock.timers.tick(5001);
    await Promise.resolve();
    assert.equal(reads, 2);
    assert.equal(helper.state.view, null);
    assert.match(helper.state.error, /到期/);
    t.mock.timers.tick(10001);
    assert.equal(reads, 2);
  } finally {
    helper.close();
    db.close();
  }
});

test("editing during a delayed helper refresh preserves a stale draft until explicit reset", async () => {
  const { active } = await outing(),
    db = new LifeStore(),
    owner = db.authenticate(db.create().token);
  const { view } = db.assistance.create(owner, makeAssistSnapshot(active, ""));
  let current = structuredClone(view),
    delay: Promise<void> | undefined,
    release!: () => void,
    sent = 0,
    sentVersion = 0;
  const helper = new HelperSession(
    async <T>(method = "GET", body?: unknown): Promise<T> => {
      if (method === "POST") {
        sent++;
        sentVersion = (body as { proposal: { snapshotVersion: number } })
          .proposal.snapshotVersion;
      } else if (delay) await delay;
      return structuredClone(current) as T;
    },
    () => {},
  );
  try {
    helper.reopen();
    await Promise.resolve();
    assert.equal(helper.state.view?.snapshotVersion, 1);
    current = { ...current, snapshotVersion: 2, revision: 2 };
    delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = helper.refresh();
    assert.equal(helper.state.busy, true);
    helper.field("note", "按刚才的入口进去");
    release();
    await refresh;
    assert.equal(helper.state.stale, true);
    assert.equal(helper.state.note, "按刚才的入口进去");
    assert.equal(helper.state.view?.snapshotVersion, 2);
    await helper.send();
    assert.equal(sent, 0);
    helper.reset();
    assert.equal(helper.state.stale, false);
    assert.equal(helper.state.note, "");
    helper.field("note", "已核对新进度，请在原地等我");
    await helper.send();
    assert.equal(sent, 1);
    assert.equal(sentVersion, 2);
  } finally {
    helper.close();
    db.close();
  }
});

test("HTTP assistance needs owner authentication, helper requests omit owner access, rejects stale changes and hostile origins", async (t) => {
  const server = createApp({
    PERSONAL_DATA_PATH: ":memory:",
    HOST: "127.0.0.1",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const { active } = await outing();
  assert.equal((await call("/api/life/assistance")).status, 401);
  const created = await (
    await call("/api/life/create", "POST", { client: "mini" })
  ).json();
  const owner = { authorization: `Bearer ${created.token}` };
  const r = await call(
    "/api/life/assistance",
    "POST",
    { snapshot: makeAssistSnapshot(active, "") },
    owner,
  );
  assert.equal(r.status, 201);
  const { view, invite } = await r.json(),
    helper = { "X-Yike-Assist": invite };
  assert.equal(
    (await call(`/api/assistance/${view.id}`, "GET", undefined, helper)).status,
    200,
  );
  assert.equal((await call("/api/life", "GET", undefined, helper)).status, 401);
  assert.equal(
    (await call(`/api/life/assistance/${view.id}`, "DELETE", undefined, helper))
      .status,
    401,
  );
  assert.equal(
    (
      await call(`/api/life/assistance/${view.id}`, "DELETE", undefined, {
        ...owner,
        origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/api/assistance/${view.id}`,
        "POST",
        { revision: 1, proposal: { kind: "plan", snapshotVersion: 1 } },
        helper,
      )
    ).status,
    400,
  );
  await call(`/api/life/assistance/${view.id}`, "DELETE", undefined, owner);
  assert.equal(
    (await call(`/api/assistance/${view.id}`, "GET", undefined, helper)).status,
    410,
  );
});
