import test from "node:test";
import assert from "node:assert/strict";
import {
  calibrationSummary,
  cleanWalkTrial,
  prepareWalk,
  finishWalk,
  calibrationExport,
  type WalkTrial,
} from "../src/shared/walk-calibration.js";
import { cleanBook, emptyBook, mergeBooks } from "../src/shared/life.js";
import { CalibrationSession } from "../src/mini/calibration.js";
import { createApp } from "../src/server/app.js";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
const time = Date.parse("2026-10-16T00:00:00.000Z");
function trial(
  i: number,
  total = 120,
  stopped = 20,
  patch: Partial<WalkTrial> = {},
) {
  return finishWalk(
    {
      ...prepareWalk(
        {
          label: "构造步道",
          meters: 100,
          distanceSource: "measured",
          usual: true,
        },
        1.2,
        [],
        time + i * 1000000,
        `walk-${i}`,
      ),
      ...patch,
    },
    total,
    stopped,
    time + i * 1000000 + 200000,
  );
}
test("three matching measured walks yield a median; subtraction keeps waiting out of walking speed", () => {
  const records = [trial(0), trial(1, 125), trial(2, 115)];
  const s = calibrationSummary(records, time + 4000000);
  assert.equal(s.ready, true);
  assert.equal(s.medianMps, 1);
  assert.equal(s.lowMps, 0.95);
  assert.equal(s.highMps, 1.05);
  assert.equal(
    s.evaluationCount,
    0,
    "training records must not become their own test evidence",
  );
  assert.equal(
    calibrationSummary(records.slice(0, 2), time + 4000000).ready,
    false,
  );
  assert.equal(
    calibrationSummary(
      records.map((v) => ({ ...v, meters: 50, elapsedSeconds: 70 })),
      time + 4000000,
    ).ready,
    false,
  );
});
test("predictions are frozen before later observations; the same later trials compare both methods", () => {
  const history = [trial(0), trial(1), trial(2)];
  const pending = prepareWalk(
    {
      label: "构造后续步道",
      meters: 200,
      distanceSource: "measured",
      usual: true,
    },
    1.2,
    history,
    time + 4000000,
    "walk-holdout",
  );
  assert.equal(pending.calibratedMps, 1);
  assert.deepEqual(
    pending.trainingIds,
    history.map((v) => v.id),
  );
  const complete = finishWalk(pending, 220, 10, time + 4500000);
  const s = calibrationSummary([...history, complete], time + 5000000);
  assert.equal(s.evaluationCount, 1);
  assert.equal(s.baselineMaeSeconds, 43.33);
  assert.equal(s.calibratedMaeSeconds, 10);
  assert.equal(complete.calibratedMps, 1);
  assert.throws(() => finishWalk(complete, 180, 0), /已经完成/);
  const forged = {
    ...complete,
    trainingIds: [history[0].id, history[1].id, "walk-later"],
  };
  assert.equal(
    calibrationSummary(
      [...history, forged, trial(6, 120, 20, { id: "walk-later" })],
      time + 8000000,
    ).evaluationCount,
    0,
  );
  assert.equal(
    calibrationSummary(
      [...history, { ...complete, calibratedMps: 1.8 }],
      time + 5000000,
    ).evaluationCount,
    0,
  );
});
test("demo, estimated distances, unusual walking, stale records and anomalous speeds never calibrate", () => {
  const records = [
    trial(0, 120, 20, { distanceSource: "demo" }),
    trial(1, 120, 20, { distanceSource: "map" }),
    trial(2, 120, 20, { usual: false }),
    trial(3, 20, 0),
    trial(4, 120, 20, { excludedReason: "距离记错" }),
  ];
  assert.equal(calibrationSummary(records, time + 6000000).count, 0);
  assert.equal(calibrationSummary([trial(0)], time + 91 * 86400000).count, 0);
  assert.equal(calibrationSummary([trial(5)], time).count, 0);
  const unstable = calibrationSummary(
    [trial(0, 200, 0), trial(1, 100, 0), trial(2, 50, 0)],
    time + 4000000,
  );
  assert.equal(unstable.ready, false);
  assert.match(unstable.reason, /差异较大/);
});
test("strict records reject invalid duration, date, provenance and unsafe fields", () => {
  const v = trial(0);
  for (const change of [
    { meters: 0 },
    { stoppedSeconds: 120 },
    { elapsedSeconds: NaN },
    { startedAt: "2026-02-30" },
    { distanceSource: "gps" },
    { trainingIds: [v.id] },
    { calibratedMps: 1 },
  ])
    assert.throws(() => cleanWalkTrial({ ...v, ...change }));
  assert.equal("token" in cleanWalkTrial({ ...v, token: "sensitive" }), false);
  assert.throws(() => cleanBook({ ...emptyBook(), walks: [v, v] }));
  const report = calibrationExport([v], time + 4000000);
  assert.equal(report.format, "yike-walk-validation-v1");
  assert.equal(report.trials[0].distanceSource, "measured");
  assert.ok(report.limitations.some((s) => s.includes("未经独立核验")));
});
test("merge keeps completed observations over stale pending copies and rejects conflicting completions", () => {
  const complete = trial(0);
  const pending = {
    ...complete,
    completedAt: null,
    elapsedSeconds: null,
    stoppedSeconds: null,
  };
  const local = { ...emptyBook(), walks: [pending] },
    incoming = { ...emptyBook(), walks: [complete] };
  assert.deepEqual(mergeBooks(local, incoming).walks, [complete]);
  assert.deepEqual(mergeBooks(incoming, local).walks, [complete]);
  assert.throws(
    () =>
      mergeBooks(incoming, {
        ...local,
        walks: [{ ...complete, elapsedSeconds: 121 }],
      }),
    /补记不同/,
  );
  assert.throws(
    () =>
      mergeBooks(incoming, { ...local, walks: [{ ...pending, meters: 200 }] }),
    /准备信息不同/,
  );
  assert.throws(
    () =>
      cleanBook({
        ...emptyBook(),
        walks: Array.from({ length: 31 }, (_, i) => trial(i)),
      }),
    /数量/,
  );
});
test("session failure preserves draft and original book; applying is explicit and affects only the saved pace", () => {
  let current = { ...emptyBook(), walks: [trial(0), trial(1), trial(2)] };
  let now = time + 4000000,
    fail = true;
  const s = new CalibrationSession(current, {
    now: () => now,
    save: (b) => {
      if (fail) throw new Error("本机空间不足");
      current = b as typeof current;
    },
    notify: () => {},
  });
  s.field("usual", true);
  s.prepare();
  assert.match(s.state.error, /空间不足/);
  assert.equal(s.state.pending, "");
  assert.equal(s.state.form.usual, true);
  fail = false;
  s.prepare();
  assert.ok(s.state.pending);
  assert.equal(current.preferences.speedMps, 1.2);
  s.field("elapsed", "125");
  s.field("stopped", "25");
  fail = true;
  now += 100000;
  s.finish();
  assert.equal(s.state.elapsed, "125");
  assert.ok(s.state.pending);
  fail = false;
  s.finish();
  assert.equal(s.state.summary.evaluationCount, 1);
  s.apply();
  assert.equal(current.preferences.speedMps, 1);
  assert.equal(current.preferences.minutes, 15);
  s.exclude(current.walks[0].id);
  assert.match(s.state.error, /排除原因/);
  s.field("exclusion", "构造误记");
  s.exclude(current.walks[0].id);
  assert.equal(current.walks.length, 4);
  assert.match(s.state.status, /原始数据仍保留/);
  s.exclude(current.walks[0].id);
  assert.equal(current.walks[0].excludedReason, "");
  fail = true;
  s.clear();
  assert.equal(current.walks.length, 4);
  fail = false;
  s.clear();
  assert.equal(current.walks.length, 0);
  assert.equal(current.preferences.speedMps, 1);
});

test("paired HTTP devices share measured records and fixed prediction lineage without leaking them to another space", async (t) => {
  const app = createApp({ PERSONAL_DATA_PATH: ":memory:" });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => {
    app.closeAllConnections();
    app.close();
  });
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const call = (path: string, method = "GET", body?: unknown, token?: string) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const owner = (await (
    await call("/api/life/create", "POST", { client: "mini" })
  ).json()) as any;
  const records = [trial(0), trial(1), trial(2)];
  const book = {
    ...emptyBook(),
    walks: [
      ...records,
      prepareWalk(
        {
          label: "构造次日步道",
          meters: 100,
          distanceSource: "measured",
          usual: true,
        },
        1.2,
        records,
        time + 4000000,
        "walk-http",
      ),
    ],
  };
  assert.equal(
    (await call("/api/life", "PUT", { revision: 0, book }, owner.token)).status,
    200,
  );
  const code = (await (
    await call("/api/life/pair", "POST", {}, owner.token)
  ).json()) as any;
  const paired = (await (
    await call("/api/life/redeem", "POST", { code: code.code, client: "mini" })
  ).json()) as any;
  assert.ok(paired.token);
  const snapshot = (await (
    await call("/api/life", "GET", undefined, paired.token)
  ).json()) as any;
  assert.deepEqual(snapshot.book.walks, book.walks);
  const other = (await (
    await call("/api/life/create", "POST", { client: "mini" })
  ).json()) as any;
  const isolated = (await (
    await call("/api/life", "GET", undefined, other.token)
  ).json()) as any;
  assert.equal(isolated.book.walks, undefined);
  assert.equal(
    (await call("/api/life", "PUT", { revision: 0, book }, paired.token))
      .status,
    409,
  );
  const invalid = { ...book, walks: [{ ...records[0], stoppedSeconds: 1000 }] };
  assert.equal(
    (
      await call(
        "/api/life",
        "PUT",
        { revision: 1, book: invalid },
        paired.token,
      )
    ).status,
    400,
  );
});
