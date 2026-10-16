import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { BaiduGateway } from "../src/server/baidu.js";
import { QuotaLedger } from "../src/server/quota.js";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { parseContourAudit } from "../src/core/contour-audit.js";
import type { Job } from "../src/shared/types.js";

const original = analyze(new DemoProvider(), DEMO_CENTERS[0]);
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
    read: (path: string, headers = {}) => fetch(url + path, { headers }),
    post: (path: string, body: unknown, headers = {}) =>
      fetch(url + path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...headers },
      }),
    remove: (path: string) => fetch(url + path, { method: "DELETE" }),
  };
}
async function done(
  server: Awaited<ReturnType<typeof app>>,
  id: string,
  headers = {},
) {
  for (let i = 0; i < 200; i++) {
    const j = (await (
      await server.read(`/api/analyses/${id}`, headers)
    ).json()) as Job;
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("audit did not finish");
}
test("audit preview is free, content-bound confirmation required, duplicate calls share a job, and source stays unchanged", async (t) => {
  const server = await app(t),
    result = structuredClone(await original),
    raw = JSON.stringify(result),
    body = { result, minutes: 15, count: 6 };
  const preview = await (
    await server.post("/api/contour-audit/preview", body)
  ).json();
  assert.equal(preview.plan.points.length, 6);
  assert.equal((await server.post("/api/contour-audit", body)).status, 400);
  const request = {
    ...body,
    fingerprint: preview.fingerprint,
    requestId: "audit-http-0001",
    confirmed: true,
  };
  assert.equal(
    (await server.post("/api/contour-audit", { ...request, count: 12 })).status,
    400,
  );
  const [a, b] = await Promise.all([
    server.post("/api/contour-audit", request),
    server.post("/api/contour-audit", request),
  ]);
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  const id = (await a.json()).id;
  assert.equal((await b.json()).id, id);
  const job = await done(server, id);
  assert.equal(job.status, "done");
  assert.ok(job.contourAudit);
  const parsed = parseContourAudit(JSON.stringify(job.contourAudit));
  assert.equal(parsed.observations.length, 6);
  assert.equal(parsed.evidence, "simulation");
  const alternateBody = { ...body, count: 12 },
    alternate = await (
      await server.post("/api/contour-audit/preview", alternateBody)
    ).json();
  assert.equal(
    (
      await server.post("/api/contour-audit", {
        ...request,
        ...alternateBody,
        fingerprint: alternate.fingerprint,
      })
    ).status,
    409,
  );
  assert.equal(JSON.stringify(result), raw);
  const quota = await (await server.read("/api/quota")).json();
  assert.equal(quota.used.route, 0);
});
test("public audit jobs are authenticated and isolated by paired space", async (t) => {
  const invite = "audit-test-invitation-at-least-24",
    server = await app(t, {
      PUBLIC_ORIGIN: "https://audit.example.invalid",
      SPACE_INVITE_CODE: invite,
    });
  const body = { result: await original, minutes: 15, count: 6 };
  assert.equal(
    (await server.post("/api/contour-audit/preview", body)).status,
    401,
  );
  const a = await (
      await server.post("/api/life/create", { invite, client: "mini" })
    ).json(),
    b = await (
      await server.post("/api/life/create", { invite, client: "mini" })
    ).json();
  const headers = { Authorization: `Bearer ${a.token}` },
    other = { Authorization: `Bearer ${b.token}` };
  const preview = await (
    await server.post("/api/contour-audit/preview", body, headers)
  ).json();
  const start = await (
    await server.post(
      "/api/contour-audit",
      {
        ...body,
        fingerprint: preview.fingerprint,
        requestId: "private-audit-0001",
        confirmed: true,
      },
      headers,
    )
  ).json();
  assert.equal(
    (await server.read(`/api/analyses/${start.id}`, other)).status,
    404,
  );
  assert.equal((await done(server, start.id, headers)).status, "done");
});
test("real-mode controlled upstream uses six serialized matrix reads, no searches, cache reuse, and a conservative budget preflight", async (t) => {
  let calls = 0,
    concurrent = 0,
    maxConcurrent = 0;
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    ledger: new QuotaLedger({ route: 50, search: 10, other: 1, map: 1 }),
    fetcher: async (input) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls++;
      const url = new URL(String(input));
      assert.equal(url.pathname, "/routematrix/v2/walking");
      assert.ok(!url.searchParams.get("destinations")!.includes("|"));
      await new Promise((r) => setTimeout(r, 1));
      concurrent--;
      return new Response(
        JSON.stringify({
          status: 0,
          result: [{ distance: { value: 800 }, duration: { value: 800 } }],
        }),
      );
    },
  });
  const server = await app(t, { BAIDU_SERVER_AK: "test-only" }, gateway),
    result = structuredClone(await original);
  result.mode = "baidu";
  result.center.geo = { lng: 121.5, lat: 31.2 };
  const body = { result, minutes: 15, count: 6 },
    preview = await (
      await server.post("/api/contour-audit/preview", body)
    ).json();
  assert.equal(calls, 0);
  const request = {
    ...body,
    fingerprint: preview.fingerprint,
    requestId: "matrix-audit-0001",
    confirmed: true,
  };
  const start = await (await server.post("/api/contour-audit", request)).json(),
    first = await done(server, start.id);
  assert.equal(first.status, "done");
  assert.equal(calls, 6);
  assert.equal(maxConcurrent, 1);
  assert.equal(first.contourAudit?.usage.routePairs, 6);
  const cached = await (
      await server.post("/api/contour-audit", {
        ...request,
        requestId: "matrix-audit-0002",
      })
    ).json(),
    second = await done(server, cached.id);
  assert.equal(second.status, "done");
  assert.equal(calls, 6);
  assert.equal(second.contourAudit?.usage.cacheHits, 6);
  assert.equal(second.contourAudit?.usage.routePairs, 0);
  const shortGateway = new BaiduGateway({
    ak: "test-only",
    ledger: new QuotaLedger({ route: 5, search: 1, other: 1, map: 1 }),
    fetcher: async () => {
      throw new Error("must not call");
    },
  });
  const short = await app(t, { BAIDU_SERVER_AK: "test-only" }, shortGateway);
  assert.equal((await short.post("/api/contour-audit", request)).status, 429);
});
test("cancelled real-mode jobs discard a delayed response and never expose a partial audit", async (t) => {
  let release: (() => void) | undefined;
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    ledger: new QuotaLedger({ route: 30, search: 1, other: 1, map: 1 }),
    fetcher: () =>
      new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            new Response(
              JSON.stringify({
                status: 0,
                result: [
                  { distance: { value: 100 }, duration: { value: 100 } },
                ],
              }),
            ),
          );
      }),
  });
  const server = await app(t, { BAIDU_SERVER_AK: "test-only" }, gateway),
    result = structuredClone(await original);
  result.mode = "baidu";
  result.center.geo = { lng: 121.5, lat: 31.2 };
  const body = { result, minutes: 15, count: 6 },
    preview = await (
      await server.post("/api/contour-audit/preview", body)
    ).json();
  const start = await (
    await server.post("/api/contour-audit", {
      ...body,
      fingerprint: preview.fingerprint,
      requestId: "cancel-audit-0001",
      confirmed: true,
    })
  ).json();
  for (let i = 0; i < 50 && !release; i++)
    await new Promise((r) => setTimeout(r, 2));
  assert.ok(release);
  await server.remove(`/api/analyses/${start.id}`);
  release!();
  await new Promise((r) => setTimeout(r, 10));
  const job = await done(server, start.id);
  assert.equal(job.status, "cancelled");
  assert.equal(job.contourAudit, undefined);
});
