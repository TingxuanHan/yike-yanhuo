import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  contourAuditPlan,
  executeContourAudit,
  summarizeContourAudit,
  parseContourAudit,
  contourAuditView,
} from "../src/core/contour-audit.js";
import { ContourAuditSession } from "../src/mini/contour-audit.js";
import { holdoutPoints } from "../src/core/benchmark.js";
import { distance } from "../src/core/geo.js";
import { personalize } from "../src/core/personalize.js";
import { DEFAULT_JOURNEY } from "../src/shared/journey.js";
import { parseResultFile } from "../src/shared/result-file.js";
import { emptyUsage, type AnalysisResult } from "../src/shared/types.js";

const promise = analyze(new DemoProvider(), DEMO_CENTERS[0]);
const base = async () => structuredClone(await promise);
const fixed = "2026-10-16T06:00:00.000Z";

test("cancelling before a job acknowledgement deletes the late job and never reveals its result", async () => {
  const source = await base();
  source.mode = "baidu";
  source.center.geo = { lng: 121.5, lat: 31.2 };
  const deleted: string[] = [];
  let release: (value: any) => void = () => {};
  const session = new ContourAuditSession({
    notify: () => {},
    request: (path, method) => {
      if (method === "DELETE") {
        deleted.push(path);
        return Promise.resolve({}) as any;
      }
      if (path.endsWith("/preview"))
        return Promise.resolve({
          plan: contourAuditPlan(source, 15, 6),
          fingerprint: "a".repeat(64),
        }) as any;
      return new Promise((resolve) => (release = resolve));
    },
  });
  session.setInput(source, 15, 6);
  await session.preview();
  const running = session.run();
  session.stop();
  release({ id: "late-contour-audit" });
  await running;
  assert.deepEqual(deleted, ["/api/analyses/late-contour-audit"]);
  assert.equal(session.state.view, null);
  assert.equal(session.state.busy, false);
  session.dispose();
});

test("audit points are fixed before observation, nested 6/12, separated from all training locations, and unsupported scenarios fail", async () => {
  const source = await base(),
    raw = JSON.stringify(source);
  const six = contourAuditPlan(source, 15, 6),
    twelve = contourAuditPlan(source, 15, 12);
  assert.deepEqual(twelve.points.slice(0, 6), six.points);
  const all = holdoutPoints(source);
  assert.deepEqual(
    six.points.map((p) => p.point),
    [0, 12, 16, 4, 8, 20].map((i) => all[i]),
  );
  for (const p of twelve.points)
    for (const s of [...source.samples, ...source.facilities])
      assert.ok(distance(p.point, s.point) >= 10);
  assert.equal(six.maxRouteUnits, 12);
  assert.equal(JSON.stringify(source), raw);
  const near = structuredClone(source);
  near.samples[0].point = six.points[0].point;
  assert.throws(() => contourAuditPlan(near, 15, 6), /独立/);
  assert.throws(() => contourAuditPlan(source, 15, 7), /6点/);
  assert.throws(() => contourAuditPlan(source, 20, 6), /5、10或15/);
  assert.throws(
    () => contourAuditPlan(personalize(source, DEFAULT_JOURNEY), 15, 6),
    /原始测时/,
  );
});
test("execution freezes caller data before upstream reads and never trains with held-out observations", async () => {
  const source = await base(),
    original = JSON.stringify(source),
    plan = contourAuditPlan(source, 15, 6),
    provider = new DemoProvider();
  const route = provider.route.bind(provider);
  let calls = 0;
  provider.search = async () => {
    throw new Error("no search");
  };
  provider.route = async (...args) => {
    calls++;
    assert.equal(args[1].length, 1);
    source.contours[2].polygons = [];
    return route(...args);
  };
  const audit = await executeContourAudit(
    source,
    plan,
    provider,
    undefined,
    undefined,
    () => fixed,
  );
  assert.equal(calls, 6);
  assert.deepEqual(audit.report, parseResultFile(original));
  assert.equal(audit.observations.length, 6);
  assert.deepEqual(audit.plan, plan);
  assert.equal(audit.usage.searchRequests, 0);
  assert.equal(audit.evidence, "simulation");
  assert.deepEqual(parseContourAudit(JSON.stringify(audit)), audit);
});
test("missing support remains unknown, unreachable is a known comparison, and denominators and common samples are explicit", async () => {
  const source = await base();
  source.samples.forEach(
    (s) => (s.travel = { status: "unknown", reason: "constructed missing" }),
  );
  const plan = contourAuditPlan(source, 15, 6);
  assert.ok(
    plan.points.every(
      (p) => p.predictions.current === null && p.predictions.coarse === null,
    ),
  );
  const observations = plan.points.map((p, i) => ({
    number: p.number,
    point: p.point,
    readAt: fixed,
    travel:
      i === 0
        ? { status: "unknown" as const, reason: "timeout" }
        : i === 1
          ? { status: "unreachable" as const, reason: "no link" }
          : { status: "ok" as const, seconds: 60, meters: 100 },
  }));
  const audit = summarizeContourAudit(
    source,
    plan,
    observations,
    fixed,
    fixed,
    emptyUsage(),
  );
  assert.equal(audit.metrics[0].evaluated, 0);
  assert.equal(audit.metrics[0].predictionUnknown, 5);
  assert.equal(audit.metrics[0].observationUnknown, 1);
  assert.equal(audit.metrics[2].evaluated, 5);
  assert.equal(audit.paired.evaluated, 0);
  assert.match(contourAuditView(audit).headline, /没有可比较/);
  assert.ok(
    contourAuditView(audit).rows.some((r) => r.verdict === "预测资料不足"),
  );
});
test("confusion categories have a direct oracle and evidence rejects changed plans, totals, positions and timestamps", async () => {
  const source = await base(),
    plan = contourAuditPlan(source, 15, 6);
  const observations = plan.points.map((p, i) => ({
    number: p.number,
    point: p.point,
    readAt: fixed,
    travel: { status: "ok" as const, seconds: i % 2 ? 1200 : 300, meters: 900 },
  }));
  const audit = summarizeContourAudit(
    source,
    plan,
    observations,
    fixed,
    fixed,
    emptyUsage(),
  );
  for (const m of audit.metrics) {
    const valid = plan.points.filter((p) => p.predictions[m.model] !== null);
    assert.equal(m.evaluated, valid.length);
    assert.equal(
      m.falseReachable,
      valid.filter(
        (p) =>
          p.predictions[m.model] &&
          observations[p.number - 1].travel.seconds > 900,
      ).length,
    );
    assert.equal(
      m.missedReachable,
      valid.filter(
        (p) =>
          !p.predictions[m.model] &&
          observations[p.number - 1].travel.seconds <= 900,
      ).length,
    );
    assert.equal(
      m.agreement + m.falseReachable + m.missedReachable,
      m.evaluated,
    );
  }
  for (const change of [
    (a: typeof audit) => a.metrics[0].agreement++,
    (a: typeof audit) =>
      (a.plan.points[0].predictions.current =
        !a.plan.points[0].predictions.current),
    (a: typeof audit) => a.observations[0].point[0]++,
    (a: typeof audit) =>
      (a.observations[0].readAt = "2026-10-15T00:00:00.000Z"),
    (a: typeof audit) => a.paired.currentAgreement++,
    (a: typeof audit) => a.observations.pop(),
  ]) {
    const changed = structuredClone(audit);
    change(changed);
    assert.throws(() => parseContourAudit(JSON.stringify(changed)));
  }
});
test("abort after a route response discards the partial audit and preserves source", async () => {
  const source = await base(),
    raw = JSON.stringify(source),
    provider = new DemoProvider(),
    controller = new AbortController();
  const route = provider.route.bind(provider);
  provider.route = async (...args) => {
    const result = await route(...args);
    controller.abort();
    return result;
  };
  await assert.rejects(
    executeContourAudit(
      source,
      contourAuditPlan(source, 15, 6),
      provider,
      controller.signal,
    ),
  );
  assert.equal(JSON.stringify(source), raw);
});
test("shared session works entirely offline, clears replaced inputs, and does not accept a delayed preview", async () => {
  const source = await base();
  let requests = 0;
  const session = new ContourAuditSession({
    request: async () => {
      requests++;
      throw new Error("no network");
    },
    notify: () => {},
  });
  session.setInput(source, 15, 6);
  await session.preview();
  assert.ok(session.state.prepared);
  await session.run();
  assert.ok(session.state.view);
  assert.equal(requests, 0);
  assert.equal(session.result().plan.count, 6);
  session.setInput(source, 15, 12);
  assert.equal(session.state.view, null);
  assert.throws(() => session.result());
  const real = {
    ...source,
    mode: "baidu",
    center: { ...source.center, geo: { lng: 121.5, lat: 31.2 } },
  } as AnalysisResult;
  let resolve: (v: any) => void = () => {};
  const delayed = new ContourAuditSession({
    request: () => new Promise((r) => (resolve = r)),
    notify: () => {},
  });
  delayed.setInput(real, 15, 6);
  const pending = delayed.preview();
  delayed.stop();
  resolve({ plan: contourAuditPlan(real, 15, 6), fingerprint: "a".repeat(64) });
  await pending;
  assert.equal(delayed.state.prepared, false);
  assert.equal(delayed.state.busy, false);
  session.dispose();
  delayed.dispose();
});
