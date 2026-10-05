import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuotaLedger } from "../src/server/quota.js";
import { allowedMapPath } from "../src/server/map-proxy.js";
import { createMapProxy } from "../src/server/map-proxy.js";
import type { IncomingMessage, ServerResponse } from "node:http";

test("daily budget survives a restart and concurrent reservations cannot overspend", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "yike-quota-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const limits = { route: 4, search: 2, other: 2, map: 10 };
  const file = join(dir, "quota.json");
  const ledger = new QuotaLedger(limits, file);
  const results = await Promise.allSettled([
    ledger.take("route", 3),
    ledger.take("route", 3),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const reloaded = new QuotaLedger(limits, file);
  await assert.rejects(reloaded.take("route", 2), /预算/);
  await reloaded.take("route", 1);
});
test("map proxy blocks analysis services and arbitrary upstream URLs", () => {
  assert.ok(allowedMapPath("/api"));
  assert.ok(allowedMapPath("/getscript"));
  assert.ok(!allowedMapPath("/place/v3/around"));
  assert.ok(!allowedMapPath("/routematrix/v2/walking"));
  assert.ok(!allowedMapPath("//unrelated.invalid/"));
});
test("map proxy supports SDK verification and repeated slashes without opening arbitrary services", async () => {
  const upstream: URL[] = [];
  const quota = new QuotaLedger({ route: 0, search: 0, other: 0, map: 10 });
  const proxy = createMapProxy(
    "browser-test",
    "server-test",
    quota,
    async (input) => {
      upstream.push(new URL(String(input)));
      return new Response("safe resource", {
        headers: { "content-type": "text/javascript" },
      });
    },
  );
  const req = { headers: {} } as IncomingMessage;
  const res = { writeHead() {}, end() {} } as unknown as ServerResponse;
  for (const path of [
    "//getmodules?v=4.0",
    "/?qt=verify&callback=ready",
    "/res/webgl/10/bmap-v4.css",
  ]) {
    await proxy(
      req,
      res,
      new URL("http://localhost/api/map-sdk" + path),
      "http://localhost",
    );
  }
  assert.deepEqual(
    upstream.map((url) => url.pathname),
    ["/getmodules", "/", "/res/webgl/10/bmap-v4.css"],
  );
  assert.ok(
    upstream.every((url) => url.origin === "https://api.map.baidu.com"),
  );
  for (const path of [
    "/?qt=place",
    "//unrelated.invalid/api",
    "/place/v3/around",
  ]) {
    await assert.rejects(
      proxy(
        req,
        res,
        new URL("http://localhost/api/map-sdk" + path),
        "http://localhost",
      ),
      /不可用/,
    );
  }
  assert.equal(upstream.length, 3);
});
test("map proxy rejects upstream credential echoes before writing any response body", async () => {
  let sent = false;
  const proxy = createMapProxy(
    "browser-test",
    "server-test",
    new QuotaLedger({ route: 0, search: 0, other: 0, map: 3 }),
    async () => new Response("denied: browser-test"),
  );
  const req = { headers: {} } as IncomingMessage;
  const res = {
    writeHead() {
      sent = true;
    },
    end() {
      sent = true;
    },
  } as unknown as ServerResponse;
  await assert.rejects(
    proxy(
      req,
      res,
      new URL("http://localhost/api/map-sdk/api"),
      "http://localhost",
    ),
    /校验未通过/,
  );
  assert.equal(sent, false);
});
test("disabled map permission stops SDK loading and caches the denial", async () => {
  let calls = 0;
  let sent = false;
  const proxy = createMapProxy(
    "browser-test",
    "server-test",
    new QuotaLedger({ route: 0, search: 0, other: 0, map: 2 }),
    async (input) => {
      calls++;
      assert.equal(new URL(String(input)).searchParams.get("qt"), "verify");
      return new Response(
        '__yikeVerify({"error":240,"error_msg":"denied","popup":1});',
      );
    },
  );
  const req = { headers: {} } as IncomingMessage;
  const res = {
    writeHead() {
      sent = true;
    },
    end() {
      sent = true;
    },
  } as unknown as ServerResponse;
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      proxy(
        req,
        res,
        new URL("http://localhost/api/map-sdk/api"),
        "http://localhost",
      ),
      /240.*浏览器端 AK.*应用是否对应/,
    );
  assert.equal(calls, 1);
  assert.equal(sent, false);
});
test("valid map permission loads the SDK and reuses the verified resource", async () => {
  let calls = 0;
  const proxy = createMapProxy(
    "browser-test",
    "server-test",
    new QuotaLedger({ route: 0, search: 0, other: 0, map: 2 }),
    async (input) => {
      calls++;
      return new Response(
        new URL(String(input)).pathname === "/"
          ? '__yikeVerify({"error":0,"error_msg":"","popup":0});'
          : "window.example=true;",
      );
    },
  );
  const req = { headers: {} } as IncomingMessage;
  const output: string[] = [];
  const res = {
    writeHead() {},
    end(body: Buffer) {
      output.push(body.toString());
    },
  } as unknown as ServerResponse;
  for (let i = 0; i < 2; i++)
    await proxy(
      req,
      res,
      new URL("http://localhost/api/map-sdk/api"),
      "http://localhost",
    );
  assert.equal(calls, 2);
  assert.deepEqual(output, ["window.example=true;", "window.example=true;"]);
});
