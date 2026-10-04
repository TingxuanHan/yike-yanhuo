import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuotaLedger } from "../src/server/quota.js";
import { allowedMapPath } from "../src/server/map-proxy.js";

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
