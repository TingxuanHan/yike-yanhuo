import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { coverageArea } from "../src/core/coverage-area.js";
import { coveragePoints } from "../src/core/coverage.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import { distance } from "../src/core/geo.js";
import {
  verificationDrill,
  verificationTasks,
  verificationPlan,
  executeVerification,
} from "../src/core/verification.js";
import { parseResultFile } from "../src/shared/result-file.js";
import { personalize } from "../src/core/personalize.js";
import { emptyBook } from "../src/shared/life.js";
import { estimateJourney } from "../src/shared/journey.js";
import { createApp } from "../src/server/app.js";
import { BaiduGateway } from "../src/server/baidu.js";
import { QuotaLedger } from "../src/server/quota.js";
import type { AnalysisResult, Provider, Job } from "../src/shared/types.js";

const originalPromise = analyze(new DemoProvider(), DEMO_CENTERS[0]);
const base = async () => structuredClone(await originalPromise);
const identity = {
  id: "verification-fixture",
  completedAt: "2026-10-16T05:00:00.000Z",
};

test("local negative evidence is bounded by a complete individual search disk, preserves unknown and has an independent distance oracle", async () => {
  const source = await base();
  source.complete.school = false;
  source.facilities = source.facilities.filter((f) => f.category !== "school");
  const original = JSON.stringify(source);
  const patched = structuredClone(source);
  patched.localSearches = [
    {
      category: "school",
      center: [0, 0],
      radiusMeters: 1600,
      complete: true,
      readAt: identity.completedAt,
    },
  ];
  const before = coverageArea(source, "school", 15),
    after = coverageArea(patched, "school", 15);
  assert.equal(before.squareMeters.missing, 0);
  assert.ok(after.squareMeters.missing > 0);
  assert.ok(after.squareMeters.unknown > 0);
  for (let x = -1600; x <= 1600; x += 37)
    for (let y = -1600; y <= 1600; y += 41) {
      if (pointInPolygons([x, y], after.regions.missing))
        assert.ok(Math.hypot(x, y) + 1000 <= 1600 + 1e-6);
    }
  assert.ok(
    Math.abs(
      Object.values(after.squareMeters).reduce((sum, v) => sum + v, 0) -
        after.totalSquareMeters,
    ) < 1e-4,
  );
  assert.ok(
    Math.abs(
      Object.values(after.unknownReasons).reduce((sum, v) => sum + v, 0) -
        after.squareMeters.unknown,
    ) < 1e-4,
  );
  for (const p of coveragePoints(patched, "school", 15).filter(
    (p) => p.status === "missing",
  ))
    assert.ok(distance(p.point, [0, 0]) + 1000 <= 1600);
  patched.localSearches[0].complete = false;
  assert.equal(coverageArea(patched, "school", 15).squareMeters.missing, 0);
  patched.localSearches = [
    {
      ...patched.localSearches[0],
      complete: true,
      radiusMeters: 900,
      center: [-500, 0],
    },
    {
      ...patched.localSearches[0],
      complete: true,
      radiusMeters: 900,
      center: [500, 0],
    },
  ];
  assert.equal(coverageArea(patched, "school", 15).squareMeters.missing, 0);
  assert.equal(JSON.stringify(source), original);
});

test("selected repair uses one route and only the selected category, retains previous facts and round-trips evidence", async () => {
  const source = verificationDrill(await base(), "school"),
    original = JSON.stringify(source);
  const tasks = verificationTasks(source, "school", 15);
  const route = tasks.find((t) => t.kind === "route")!,
    search = tasks.find((t) => t.kind === "search")!;
  assert.ok(route && search);
  const plan = verificationPlan(source, "school", 15, [route.id, search.id]);
  const provider = new DemoProvider();
  let routeCalls = 0,
    searchCalls = 0;
  const r = provider.route.bind(provider),
    s = provider.search.bind(provider);
  provider.route = async (...args) => {
    routeCalls++;
    assert.equal(args[1].length, 1);
    return r(...args);
  };
  provider.search = async (...args) => {
    searchCalls++;
    assert.deepEqual(args[3], ["school"]);
    assert.equal(args[1], 1600);
    return s(...args);
  };
  const next = await executeVerification(source, plan, provider, identity);
  assert.equal(routeCalls, 1);
  assert.equal(searchCalls, 1);
  assert.equal(next.quality.knownSamples, source.quality.knownSamples + 1);
  assert.equal(next.complete.school, false);
  assert.equal(next.localSearches?.length, 1);
  assert.equal(next.verification?.sourceId, source.id);
  assert.equal(next.verification?.receipts.length, 2);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(
    parseResultFile(JSON.stringify(next)).localSearches,
    next.localSearches,
  );
  for (const f of source.facilities)
    assert.deepEqual(
      next.facilities.find((p) => p.id === f.id),
      f,
    );
  assert.throws(
    () => verificationPlan(source, "school", 15, [route.id, route.id]),
    /不同/,
  );
  assert.throws(
    () => verificationPlan(source, "school", 15, ["foreign"]),
    /变化/,
  );
  assert.throws(
    () =>
      verificationPlan(source, "school", 15, [
        tasks.find((t) => t.kind === "field")!.id,
      ]),
    /现场/,
  );
  const forged = structuredClone(next);
  forged.localSearches![0].radiusMeters = Infinity;
  assert.throws(() => parseResultFile(JSON.stringify(forged)), /有效/);
  const overflow = structuredClone(next);
  overflow.localSearches = Array(13).fill(next.localSearches![0]);
  assert.throws(() => parseResultFile(JSON.stringify(overflow)), /有效/);
});

test("repair applies personal distance time once, reuses valid same-point travel and does not upgrade partial searches", async () => {
  const prefs = { ...emptyBook().preferences, speedMps: 0.8 };
  const source = verificationDrill(personalize(await base(), prefs), "school");
  const route = verificationTasks(source, "school", prefs.minutes).find(
    (t) => t.kind === "route",
  )!;
  const next = await executeVerification(
    source,
    verificationPlan(source, "school", prefs.minutes, [route.id]),
    new DemoProvider(),
    identity,
  );
  const fixed = next.samples.find(
    (s) => s.point.join() === route.point.join(),
  )!;
  assert.equal(fixed.travel.status, "ok");
  if (fixed.travel.status === "ok")
    assert.equal(
      fixed.travel.seconds,
      estimateJourney(fixed.travel.meters, prefs).seconds,
    );
  const reusable = await base();
  const point = reusable.samples.find(
    (s) => s.travel.status === "ok" && s.travel.seconds > 0,
  )!.point;
  reusable.facilities.push({
    id: "reuse",
    name: "构造同点设施",
    address: "构造",
    category: "school",
    point,
  });
  const task = verificationTasks(reusable, "school", 15).find(
    (t) => t.kind === "route" && t.point.join() === point.join(),
  )!;
  assert.equal(task.routeUnits, 0);
  const provider = new DemoProvider();
  provider.route = async () => {
    throw new Error("must reuse");
  };
  const reused = await executeVerification(
    reusable,
    verificationPlan(reusable, "school", 15, [task.id]),
    provider,
    identity,
  );
  assert.equal(
    reused.facilities.find((f) => f.id === "reuse")!.travel?.status,
    "ok",
  );
  const search = verificationTasks(source, "school", 15).find(
    (t) => t.kind === "search",
  )!;
  provider.search = async () => ({
    facilities: [],
    complete: {
      market: false,
      pharmacy: false,
      school: false,
      medical: false,
      park: false,
      elder: false,
    },
    warnings: [],
    radiusMeters: 1600,
  });
  const partial = await executeVerification(
    source,
    verificationPlan(source, "school", 15, [search.id]),
    provider,
    identity,
  );
  assert.equal(coverageArea(partial, "school", 15).squareMeters.missing, 0);
});

test("cancellation after an upstream result discards the partial update and preserves the source", async () => {
  const source = verificationDrill(await base(), "school"),
    original = JSON.stringify(source),
    controller = new AbortController();
  const task = verificationTasks(source, "school", 15).find(
      (t) => t.kind === "route",
    )!,
    provider = new DemoProvider();
  const read = provider.route.bind(provider);
  provider.route = async (...args) => {
    const values = await read(...args);
    controller.abort();
    return values;
  };
  await assert.rejects(
    executeVerification(
      source,
      verificationPlan(source, "school", 15, [task.id]),
      provider,
      identity,
      controller.signal,
    ),
  );
  assert.equal(JSON.stringify(source), original);
});

async function app(
  t: any,
  env: NodeJS.ProcessEnv = {},
  gateway?: BaiduGateway,
) {
  const server = createApp({ PERSONAL_DATA_PATH: ":memory:", ...env }, gateway);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get: (path: string, headers: Record<string, string> = {}) =>
      fetch(url + path, { headers }),
    post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(url + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
  };
}
async function finished(
  server: Awaited<ReturnType<typeof app>>,
  id: string,
  headers?: Record<string, string>,
) {
  for (let i = 0; i < 200; i++) {
    const job = (await (
      await server.get(`/api/analyses/${id}`, headers)
    ).json()) as Job;
    if (job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job did not finish");
}

test("HTTP preview is free, confirmation and source hash are required, and request retries are idempotent", async (t) => {
  const server = await app(t),
    source = verificationDrill(await base(), "school");
  const taskIds = verificationTasks(source, "school", 15)
    .filter((t) => t.kind !== "field")
    .slice(0, 2)
    .map((t) => t.id);
  const body = { result: source, taskIds, category: "school", minutes: 15 };
  const preview = await (
    await server.post("/api/verification/preview", body)
  ).json();
  assert.ok(preview.fingerprint);
  assert.ok(preview.plan.tasks.length);
  assert.equal((await server.post("/api/verification", body)).status, 400);
  const request = {
    ...body,
    fingerprint: preview.fingerprint,
    requestId: "verify-http-0001",
    confirmed: true,
  };
  assert.equal(
    (
      await server.post("/api/verification", {
        ...request,
        result: { ...source, id: "changed" },
      })
    ).status,
    400,
  );
  const start = await server.post("/api/verification", request);
  assert.equal(start.status, 202);
  const { id } = await start.json();
  assert.equal(
    (await (await server.post("/api/verification", request)).json()).id,
    id,
  );
  assert.equal((await finished(server, id)).status, "done");
  const quota = await (await server.get("/api/quota")).json();
  assert.deepEqual(quota.used, { route: 0, search: 0, other: 0, map: 0 });
});

test("live-mode repair reads only one category, shares cache and quota guards, and fails before calls when budget is short", async (t) => {
  let calls = 0;
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    ledger: new QuotaLedger({ route: 10, search: 2, other: 1, map: 1 }),
    fetcher: async (input) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.pathname, "/place/v3/around");
      assert.equal(url.searchParams.get("query"), "小学");
      return new Response(JSON.stringify({ status: 0, total: 0, results: [] }));
    },
  });
  const server = await app(t, { BAIDU_SERVER_AK: "test-only" }, gateway);
  const source = verificationDrill(await base(), "school");
  source.mode = "baidu";
  source.center.geo = { lng: 121.5, lat: 31.2 };
  const task = verificationTasks(source, "school", 15).find(
    (t) => t.kind === "search",
  )!;
  const body = {
    result: source,
    taskIds: [task.id],
    category: "school",
    minutes: 15,
  };
  const preview = await (
    await server.post("/api/verification/preview", body)
  ).json();
  assert.equal(calls, 0);
  const request = {
    ...body,
    fingerprint: preview.fingerprint,
    requestId: "verify-live-0001",
    confirmed: true,
  };
  const [a, b] = await Promise.all([
    server.post("/api/verification", request),
    server.post("/api/verification", request),
  ]);
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  const id = (await a.json()).id;
  assert.equal((await b.json()).id, id);
  const done = await finished(server, id);
  assert.equal(done.status, "done");
  assert.equal(calls, 1);
  assert.equal(done.result?.complete.school, false);
  const shortage = new BaiduGateway({
    ak: "test-only",
    ledger: new QuotaLedger({ route: 10, search: 1, other: 1, map: 1 }),
    fetcher: async () => {
      throw new Error("must not call");
    },
  });
  const other = await app(t, { BAIDU_SERVER_AK: "test-only" }, shortage);
  assert.equal(
    (
      await other.post("/api/verification", {
        ...request,
        requestId: "verify-short-001",
      })
    ).status,
    429,
  );
});
