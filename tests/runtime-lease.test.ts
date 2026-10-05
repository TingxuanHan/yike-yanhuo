import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acquireQuotaLease } from "../src/server/runtime-lease.js";

test("same-project real callers cannot hold independent request queues", async () => {
  const key = "lease-test-" + randomUUID();
  const release = await acquireQuotaLease(key);
  try {
    await assert.rejects(acquireQuotaLease(key), /已有真实地图/);
  } finally {
    await release();
  }
  const next = await acquireQuotaLease(key);
  await next();
});
