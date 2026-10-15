import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { LifeStore } from "../src/server/life-store.js";
import { createApp } from "../src/server/app.js";
import {
  cleanNoticeQuery,
  noticeRelation,
  summarizeNotice,
  noticeDistance,
  NOTICE_DRAFT_KEY,
  type NoticeRecord,
  type NoticeFeed,
} from "../src/shared/neighborhood.js";
import { NeighborhoodSession } from "../src/mini/neighborhood.js";
import { miniRuntime } from "./helpers/mini.js";
import { demoWalkingGuide } from "../src/mini/walking-guide.js";

const target = {
  name: "模拟东入口",
  position: { system: "demo" as const, x: 0, y: 0 },
};
let serial = 0;
const report = (now: number, extra: Record<string, unknown> = {}) => ({
  share: true,
  requestId: `testing_notice_${++serial}`,
  target,
  kind: "entrance_blocked",
  version: 0,
  observation: {
    state: "present",
    basis: "seen",
    at: now,
    note: "东入口围挡，西侧入口未确认。",
  },
  ...extra,
});
function owner(db: LifeStore) {
  return db.authenticate(db.create().token);
}
test("reports aggregate per space, keep conflicting observations, and never disclose actors or private books", () => {
  const now = Date.now(),
    db = new LifeStore(":memory:", () => now);
  try {
    const a = owner(db),
      b = owner(db),
      c = owner(db);
    const request = report(now),
      n = db.neighborhood.write(a, null, request);
    assert.equal(n.state, "unverified");
    assert.equal(
      db.neighborhood.write(a, null, request).present,
      1,
      "a lost-response retry must not add weight",
    );
    assert.throws(
      () => db.neighborhood.write(a, null, { ...request, kind: "steps" }),
      /内容已变化/,
    );
    const sameSpace = db.authenticate(db.redeem(db.pair(a).code).token);
    const twoDevices = db.neighborhood.write(
      sameSpace,
      n.id,
      report(now, { version: 1 }),
    );
    assert.equal(twoDevices.present, 1);
    assert.throws(
      () => db.neighborhood.write(a, n.id, report(now, { version: 1 })),
      /另一台设备/,
    );
    const two = db.neighborhood.write(b, null, report(now));
    assert.equal(two.id, n.id, "identical anchor and issue reuse the event");
    assert.equal(two.state, "supported");
    const conflict = db.neighborhood.write(
      c,
      n.id,
      report(now, {
        observation: {
          state: "clear",
          basis: "seen",
          at: now,
          note: "东入口现在可以通过。",
        },
      }),
    );
    assert.equal(conflict.state, "conflict");
    const view = db.neighborhood.query(c, { target });
    for (const secret of [a, b, c, "actor", "token", "book", "target_key"])
      assert.ok(!JSON.stringify(view).includes(secret));
    assert.equal(db.reports(a).length, 0);
    assert.equal(
      db.neighborhood.write(
        c,
        n.id,
        report(now, { version: 1, withdraw: true }),
      ).state,
      "supported",
    );
    assert.equal(db.neighborhood.query(b, { target }).notices[0].present, 2);
    assert.throws(
      () =>
        db.neighborhood.write(owner(db), n.id, report(now, { withdraw: true })),
      /没有可撤回/,
    );
  } finally {
    db.close();
  }
});
test("time decay uses observed time, not upload time; restored and withdrawn reports are explicit", () => {
  let now = Date.now();
  const db = new LifeStore(":memory:", () => now);
  try {
    const a = owner(db),
      b = owner(db);
    const n = db.neighborhood.write(
      a,
      null,
      report(now, { kind: "closed_now" }),
    );
    now += 6 * 3600000;
    assert.equal(
      db.neighborhood.query(b, { target }).notices[0].state,
      "expired",
    );
    const old = db.neighborhood.write(
      a,
      n.id,
      report(now, {
        version: 1,
        observation: {
          state: "present",
          basis: "seen",
          at: now - 6 * 3600000,
          note: "这是六小时前的观察。",
        },
      }),
    );
    assert.equal(old.state, "expired");
    const restored = db.neighborhood.write(
      a,
      n.id,
      report(now, {
        version: 2,
        observation: {
          state: "clear",
          basis: "seen",
          at: now,
          note: "刚刚看到已经开门。",
        },
      }),
    );
    assert.equal(restored.state, "clear");
    assert.equal(restored.label, "有恢复反馈，待核实");
    db.neighborhood.write(a, n.id, report(now, { version: 3, withdraw: true }));
    assert.equal(db.neighborhood.query(b, { target }).notices.length, 0);
    assert.equal(
      db.neighborhood.query(a, { target }).notices[0].state,
      "withdrawn",
    );
    assert.throws(
      () => db.neighborhood.write(a, null, report(now + 300000)),
      /发生时间/,
    );
  } finally {
    db.close();
  }
});
test("hearsay and unknown observations do not create corroborated eyewitness evidence", () => {
  const now = Date.now();
  const records: NoticeRecord[] = ["a", "b", "c"].map((actor) => ({
    actor,
    at: now,
    receivedAt: now,
    version: 1,
    withdrawn: false,
    basis: "heard",
    state: "present",
    note: "听说附近在施工。",
  }));
  const summary = summarizeNotice("construction", records, now);
  assert.equal(summary.state, "unverified");
  assert.equal(summary.present, 0);
  assert.equal(summary.hearsay, 3);
  assert.equal(
    summarizeNotice(
      "steps",
      [...records, { ...records[0], basis: "seen", version: 2 }],
      now,
    ).present,
    1,
  );
});
test("matching follows saved geometry, keeps simulation separate and limits store warnings to destinations", () => {
  const query = cleanNoticeQuery({
    target: { name: "终点", position: { system: "demo", x: 1000, y: 1000 } },
    path: [
      { system: "demo", x: 0, y: 0 },
      { system: "demo", x: 0, y: 1000 },
      { system: "demo", x: 1000, y: 1000 },
    ],
  });
  assert.ok(
    noticeRelation(
      { name: "路口", position: { system: "demo", x: 20, y: 500 } },
      "construction",
      query,
    ),
  );
  assert.equal(
    noticeRelation(
      { name: "对角线", position: { system: "demo", x: 500, y: 500 } },
      "construction",
      query,
    ),
    null,
  );
  assert.equal(noticeRelation(target, "closed_now", query), null);
  assert.equal(
    noticeRelation(target, "construction", { ...query, path: undefined }),
    null,
  );
  assert.equal(
    noticeRelation(target, "construction", { ...query, stepsOnly: true }),
    null,
  );
  assert.equal(
    noticeRelation(
      { name: "真实", position: { system: "gcj02", lng: 121.5, lat: 31.2 } },
      "construction",
      query,
    ),
    null,
  );
  assert.ok(
    noticeDistance(
      { system: "bd09", lng: 121.5065, lat: 31.206 },
      { system: "gcj02", lng: 121.5, lat: 31.2 },
    ) < 60,
  );
  assert.throws(() =>
    cleanNoticeQuery({
      target,
      path: [
        { system: "demo", x: 0, y: 0 },
        { system: "gcj02", lng: 121.5, lat: 31.2 },
      ],
    }),
  );
  assert.throws(() =>
    cleanNoticeQuery({
      target,
      path: [
        { system: "demo", x: -20000, y: 0 },
        { system: "demo", x: 20000, y: 0 },
      ],
    }),
  );
  const g = demoWalkingGuide(
    {
      from: {
        id: "a",
        name: "起点",
        position: { system: "demo", x: -400, y: 0 },
      },
      to: {
        id: "b",
        name: "终点",
        position: { system: "demo", x: -600, y: -200 },
      },
    },
    Date.now(),
  );
  assert.ok(g.path && g.path.length > 2);
  assert.ok(g.steps[0].position);
});
test("neighborhood observations persist across restart and enforce explicit sharing and daily limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "yike-neighbor-")),
    path = join(dir, "life.sqlite"),
    now = Date.now();
  let db = new LifeStore(path, () => now);
  try {
    const a = owner(db);
    assert.throws(
      () => db.neighborhood.write(a, null, report(now, { share: false })),
      /确认/,
    );
    const n = db.neighborhood.write(a, null, report(now));
    db.close();
    db = new LifeStore(path, () => now);
    assert.equal(db.neighborhood.query(a, { target }).notices[0].id, n.id);
    for (let version = 1; version < 40; version++)
      db.neighborhood.write(a, n.id, report(now, { version }));
    assert.throws(
      () => db.neighborhood.write(a, n.id, report(now, { version: 40 })),
      /今天/,
    );
  } finally {
    db.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true });
  }
});
test("session preserves drafts and retry identity, ignores departed reads and marks stale snapshots", async () => {
  let now = Date.now(),
    loseResponse = true;
  const db = new LifeStore(":memory:", () => now),
    a = owner(db);
  const storage = new Map<string, unknown>(),
    posted: any[] = [];
  const deps = {
    now: () => now,
    get: (k: string) => storage.get(k),
    set: (k: string, v: unknown) => storage.set(k, structuredClone(v)),
    confirm: async () => true,
    notify: () => {},
    request: async <T>(
      path: string,
      _method?: string,
      body?: any,
    ): Promise<T> => {
      if (path.endsWith("query")) return db.neighborhood.query(a, body) as T;
      posted.push(body);
      const result = db.neighborhood.write(
        a,
        path.endsWith("events") ? null : path.split("/").at(-1)!,
        body,
      );
      if (loseResponse) {
        loseResponse = false;
        throw new Error("网络中断");
      }
      return result as T;
    },
  };
  try {
    const s = new NeighborhoodSession({ target }, [], deps);
    s.begin();
    s.field("note", "刚刚看到东入口围挡。");
    s.saveDraft();
    assert.equal(posted.length, 0);
    assert.ok(storage.has(NOTICE_DRAFT_KEY));
    await s.submit();
    assert.match(s.state.error, /共享范围/);
    s.field("share", true);
    await s.submit();
    assert.match(s.state.error, /网络中断/);
    assert.equal(s.state.note, "刚刚看到东入口围挡。");
    await s.submit();
    assert.equal(posted[0].requestId, posted[1].requestId);
    assert.match(s.state.status, /已共享/);
    await s.refresh();
    assert.equal(s.state.feed!.notices[0].present, 1);
    now += 300001;
    s.tick();
    assert.equal(s.state.stale, true);
    s.begin();
    s.field("note", "新的未完成草稿");
    s.saveDraft();
    const restored = new NeighborhoodSession({ target }, [], deps);
    restored.restore();
    assert.equal(restored.state.note, "新的未完成草稿");
    assert.equal(restored.state.share, false);
    const failedStorage = new NeighborhoodSession({ target }, [], {
      ...deps,
      set: () => {
        throw new Error("full");
      },
    });
    failedStorage.begin();
    failedStorage.saveDraft();
    assert.match(failedStorage.state.error, /保存失败/);
    let resolveRead!: (v: NoticeFeed) => void;
    const late = new NeighborhoodSession({ target }, [], {
      ...deps,
      request: <T>() =>
        new Promise((r) => {
          resolveRead = r as (v: NoticeFeed) => void;
        }) as Promise<T>,
    });
    const pending = late.refresh();
    late.dispose();
    resolveRead({ asOf: now, notices: [], truncated: false });
    await pending;
    assert.equal(late.state.feed, null);
  } finally {
    db.close();
  }
});
test("real HTTP and native component share reports without sharing private data or allowing anonymous writes", async (t) => {
  const app = createApp({});
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => {
    app.closeAllConnections();
    app.close();
  });
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const call = (path: string, data: any, token?: string) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
  assert.equal(
    (await call("/api/neighborhood/events", report(Date.now()))).status,
    401,
  );
  assert.equal((await call("/api/neighborhood/query", { target })).status, 401);
  const a = (await (
    await call("/api/life/create", { client: "mini" })
  ).json()) as any;
  const b = (await (
    await call("/api/life/create", { client: "mini" })
  ).json()) as any;
  const storage = new Map<string, any>([
    ["yike-server", base],
    ["yike-token", a.token],
  ]);
  const runtime = miniRuntime(storage, {
    request: (o: any) =>
      void fetch(o.url, {
        method: o.method,
        headers: o.header,
        body: JSON.stringify(o.data),
      })
        .then(async (r) =>
          o.success({ statusCode: r.status, data: await r.json() }),
        )
        .catch(o.fail),
  });
  const c = runtime.component("neighborhood", {
    context: { target },
    choices: [],
  });
  t.after(() => c.lifetimes.detached.call(c));
  c.begin({ currentTarget: { dataset: {} } });
  c.field({
    currentTarget: { dataset: { key: "note" } },
    detail: { value: "现场看到东入口有围挡。" },
  });
  c.share({ detail: { value: ["share"] } });
  await c.submit();
  assert.match(c.data.status, /已共享/);
  const visible = (await (
    await call("/api/neighborhood/query", { target }, b.token)
  ).json()) as NoticeFeed;
  assert.equal(visible.notices.length, 1);
  assert.equal(visible.notices[0].mine, null);
  assert.equal(visible.notices[0].present, 1);
  const n = visible.notices[0];
  const feedback = await call(
    `/api/neighborhood/events/${n.id}`,
    report(Date.now(), {
      observation: {
        state: "clear",
        basis: "seen",
        at: Date.now(),
        note: "刚看到围挡移走了。",
      },
    }),
    b.token,
  );
  assert.equal(feedback.status, 200);
  await c.refresh();
  assert.equal(c.data.notices[0].state, "conflict");
  assert.ok(!JSON.stringify(c.data).includes(b.token));
  const blocked = await fetch(base + "/api/neighborhood/events", {
    method: "POST",
    headers: {
      authorization: `Bearer ${b.token}`,
      "content-type": "application/json",
      origin: "https://untrusted.test",
    },
    body: JSON.stringify(report(Date.now())),
  });
  assert.equal(blocked.status, 403);
});
