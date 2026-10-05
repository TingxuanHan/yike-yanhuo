import test from "node:test";
import assert from "node:assert/strict";
import {
  BaiduGateway,
  BaiduProvider,
  parseTravel,
  ServiceError,
} from "../src/server/baidu.js";
import { emptyUsage } from "../src/shared/types.js";

const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const noWait = async () => {};
test("zero and malformed routes are unknown unless the points coincide", () => {
  assert.equal(
    parseTravel({ duration: { value: 0 }, distance: { value: 0 } }).status,
    "unknown",
  );
  assert.equal(parseTravel(undefined).status, "unknown");
  assert.equal(
    parseTravel({ duration: { value: -1 }, distance: { value: 20 } }).status,
    "unknown",
  );
  assert.deepEqual(parseTravel(undefined, true), {
    status: "ok",
    seconds: 0,
    meters: 0,
  });
});
test("walking batches respect pair QPS, coordinate order and route reuse", async () => {
  const calls: URL[] = [];
  const waits: number[] = [];
  const client = new BaiduGateway({
    ak: "test-only",
    routeQps: 3,
    now: () => 0,
    wait: async (ms) => {
      waits.push(ms);
    },
    fetcher: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      return response({
        status: 0,
        result: url.searchParams
          .get("destinations")!
          .split("|")
          .map(() => ({ duration: { value: 100 }, distance: { value: 120 } })),
      });
    },
  });
  const provider = new BaiduProvider(client, { lng: 121.5, lat: 31.2 });
  const results = await provider.route(
    [0, 0],
    [
      [100, 0],
      [200, 0],
      [300, 0],
      [400, 0],
      [0, 0],
      [100, 0],
    ],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get("origins"), "31.2,121.5");
  assert.equal(calls[0].searchParams.get("coord_type"), "bd09ll");
  assert.equal(calls[0].searchParams.get("destinations")!.split("|").length, 3);
  assert.equal(provider.usage.routePairs, 4);
  assert.ok(waits[1] >= 1000);
  assert.equal(results.length, 6);
  await provider.route([0, 0], [[100, 0]]);
  assert.equal(calls.length, 2);
});
test("single analysis budget is enforced before contacting upstream", async () => {
  let calls = 0;
  const client = new BaiduGateway({
    ak: "test",
    maxRoutePairs: 2,
    wait: noWait,
    fetcher: async () => {
      calls++;
      return response({ status: 0 });
    },
  });
  await assert.rejects(
    client.call("/routematrix/v2/walking", {}, emptyUsage(), "route", 3),
    /预算/,
  );
  assert.equal(calls, 0);
});
test("retry consumes actual route pairs and stops after one retry", async () => {
  let calls = 0;
  const client = new BaiduGateway({
    ak: "test",
    wait: noWait,
    fetcher: async () => {
      calls++;
      return new Response("", { status: 503 });
    },
  });
  const usage = emptyUsage();
  await assert.rejects(
    client.call("/routematrix/v2/walking", {}, usage, "route", 3),
    /暂不可用/,
  );
  assert.equal(calls, 2);
  assert.equal(usage.routePairs, 6);
  assert.equal(usage.retries, 1);
});
test("pagination cap and missing total never establish facility absence", async () => {
  const client = new BaiduGateway({
    ak: "test",
    wait: noWait,
    fetcher: async () => response({ status: 0, total: 50, results: [] }),
  });
  const data = await new BaiduProvider(client, {
    lng: 121.5,
    lat: 31.2,
  }).search([0, 0], 2000);
  assert.ok(Object.values(data.complete).every((v) => !v));
  assert.equal(data.facilities.length, 0);
});
test("malformed facilities invalidate completeness, valid coordinates are projected", async () => {
  const client = new BaiduGateway({
    ak: "test",
    wait: noWait,
    fetcher: async () =>
      response({
        status: 0,
        total: 2,
        results: [
          { uid: "valid", name: "测试点", location: { lng: 121.5, lat: 31.2 } },
          { name: "坏坐标", location: { lng: 999, lat: 0 } },
        ],
      }),
  });
  const data = await new BaiduProvider(client, {
    lng: 121.5,
    lat: 31.2,
  }).search([0, 0], 2000);
  assert.equal(data.facilities.length, 6);
  assert.deepEqual(data.facilities[0].point, [0, 0]);
  assert.equal(data.complete.market, false);
});
test("coordinate conversion uses longitude first and explicit coordinate types", async () => {
  let requested: URL | undefined;
  const client = new BaiduGateway({
    ak: "test",
    wait: noWait,
    fetcher: async (input) => {
      requested = new URL(String(input));
      return response({ status: 0, result: [{ x: 121.51, y: 31.21 }] });
    },
  });
  assert.deepEqual(await client.convert({ lng: 121.5, lat: 31.2 }, 1), {
    lng: 121.51,
    lat: 31.21,
  });
  assert.equal(requested!.searchParams.get("coords"), "121.5,31.2");
  assert.equal(requested!.pathname, "/geoconv/v2/");
  assert.equal(requested!.searchParams.get("model"), "2");
});
test("upstream text cannot leak the AK through a service error", async () => {
  const client = new BaiduGateway({
    ak: "private-test-key",
    wait: noWait,
    fetcher: async () => response({ status: 302, message: "private-test-key" }),
  });
  await assert.rejects(
    client.geocode("测试地点"),
    (error) =>
      error instanceof Error && !error.message.includes("private-test-key"),
  );
});
test("geocoding validates UTF-8 bytes before spending quota and accepts 128 bytes", async () => {
  let calls = 0;
  let sentAddress = "";
  const client = new BaiduGateway({
    ak: "test-only",
    wait: noWait,
    fetcher: async (input) => {
      calls++;
      sentAddress = new URL(String(input)).searchParams.get("address")!;
      return response({
        status: 0,
        result: { location: { lng: 121.5, lat: 31.2 } },
      });
    },
  });
  for (const address of [" ", "中", "中".repeat(43), "a".repeat(129)]) {
    await assert.rejects(
      client.geocode(address),
      (error) => error instanceof ServiceError && error.code === 400,
    );
  }
  assert.equal(calls, 0);
  const accepted = "中".repeat(42) + "12";
  await client.geocode("  " + accepted + "  ");
  assert.equal(calls, 1);
  assert.equal(sentAddress, accepted);
});
test("permission and quota failures have safe actionable guidance without retrying", async () => {
  for (const [status, message, http] of [
    [240, "地理编码服务权限校验未通过", 502],
    [210, "IP 校验失败", 502],
    [302, "当日配额已用完", 429],
    [401, "并发超限", 429],
  ] as const) {
    let calls = 0;
    const client = new BaiduGateway({
      ak: "secret-test-value",
      wait: noWait,
      fetcher: async () => {
        calls++;
        return response({ status, message: "secret-test-value" });
      },
    });
    await assert.rejects(
      client.geocode("测试地址"),
      (error) =>
        error instanceof ServiceError &&
        error.code === http &&
        error.message.includes(message) &&
        !error.message.includes("secret-test-value"),
    );
    assert.equal(calls, 1);
  }
});
