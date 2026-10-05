import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BaiduGateway,
  BaiduProvider,
  ServiceError,
} from "../src/server/baidu.js";
import { emptyUsage } from "../src/shared/types.js";

const ok = () => new Response(JSON.stringify({ status: 0, results: [] }));

test("concurrent searches stay serial and cannot catch up after a slow response body", async () => {
  let now = 0;
  const starts: number[] = [];
  let release!: () => void;
  const gateway = new BaiduGateway({
    ak: "test-only",
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    fetcher: async () => {
      starts.push(now);
      if (starts.length === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              release = () => {
                now += 10_000;
                controller.enqueue(
                  new TextEncoder().encode('{"status":0,"results":[]}'),
                );
                controller.close();
              };
            },
          }),
        );
      }
      return ok();
    },
  });
  const usage = emptyUsage();
  const pending = Array.from({ length: 6 }, (_, i) =>
    gateway.call("/place/v3/around", { query: String(i) }, usage, "search"),
  );
  await yieldTurn();
  assert.equal(
    starts.length,
    1,
    "a pending body must keep later requests queued",
  );
  release();
  await Promise.all(pending);
  assert.equal(usage.searchRequests, 6);
  assert.deepEqual(starts, [0, 10_000, 12_000, 14_000, 16_000, 18_000]);
});

test("default walking requests send one route pair at a time with headroom", async () => {
  let now = 0;
  const starts: number[] = [];
  const gateway = new BaiduGateway({
    ak: "test-only",
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    fetcher: async (input) => {
      starts.push(now);
      const destinations = new URL(String(input)).searchParams.get(
        "destinations",
      )!;
      assert.equal(destinations.split("|").length, 1);
      return new Response(
        JSON.stringify({
          status: 0,
          result: [{ duration: { value: 100 }, distance: { value: 120 } }],
        }),
      );
    },
  });
  const provider = new BaiduProvider(gateway, { lng: 121.5, lat: 31.2 });
  await provider.route(
    [0, 0],
    [
      [100, 0],
      [200, 0],
      [300, 0],
    ],
  );
  assert.deepEqual(starts, [0, 1100, 2200]);
  assert.equal(provider.usage.routePairs, 3);
});

test("HTTP and service quota rejections stop queued calls without retries", async () => {
  for (const code of [429, 4, 301, 302, 401, 402]) {
    let calls = 0;
    const gateway = new BaiduGateway({
      ak: "test-only",
      wait: async () => {},
      fetcher: async () => {
        calls++;
        return code === 429
          ? new Response("", { status: 429 })
          : new Response(JSON.stringify({ status: code }));
      },
    });
    const usage = emptyUsage();
    const results = await Promise.allSettled([
      gateway.call("/place/v3/around", { query: "first" }, usage, "search"),
      gateway.call("/place/v3/around", { query: "second" }, usage, "search"),
    ]);
    assert.ok(
      results.every(
        (r) =>
          r.status === "rejected" &&
          r.reason instanceof ServiceError &&
          r.reason.code === 429,
      ),
    );
    assert.equal(calls, 1, `code ${code} must stop the request queue`);
    assert.equal(usage.retries, 0);
    assert.equal(usage.searchRequests, 1);
  }
});

test("a cancelled queued request spends no quota and does not block the next caller", async () => {
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway = new BaiduGateway({
    ak: "test-only",
    wait: async () => {},
    fetcher: async () => {
      calls++;
      if (calls === 1) await held;
      return ok();
    },
  });
  const controller = new AbortController();
  const usage = emptyUsage();
  const first = gateway.call(
    "/place/v3/around",
    { query: "first" },
    usage,
    "search",
  );
  const cancelled = gateway.call(
    "/place/v3/around",
    { query: "cancelled" },
    usage,
    "search",
    1,
    controller.signal,
  );
  const cancellation = assert.rejects(cancelled, { name: "AbortError" });
  await yieldTurn();
  controller.abort();
  release();
  await first;
  await cancellation;
  await gateway.call("/place/v3/around", { query: "last" }, usage, "search");
  assert.equal(calls, 2);
  assert.equal(usage.searchRequests, 2);
});

test("request timing records omit keys, query parameters and upstream messages", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "yike-requests-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "requests.jsonl");
  const gateway = new BaiduGateway({
    ak: "private-test-key",
    requestLogPath: path,
    now: () => 10000,
    wait: async () => {},
    fetcher: async () =>
      new Response(
        JSON.stringify({ status: 240, message: "private-test-key" }),
      ),
  });
  await assert.rejects(
    gateway.call(
      "/place/v3/around",
      { query: "private-address" },
      emptyUsage(),
      "search",
    ),
  );
  const raw = await readFile(path, "utf8");
  assert.ok(
    !raw.includes("private-test-key") && !raw.includes("private-address"),
  );
  assert.deepEqual(JSON.parse(raw), {
    startedAt: "1970-01-01T00:00:10.000Z",
    service: "search",
    path: "/place/v3/around",
    units: 1,
    httpStatus: 200,
    upstreamStatus: 240,
  });
});
