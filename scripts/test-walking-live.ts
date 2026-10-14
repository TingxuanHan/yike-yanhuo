import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile, mkdir } from "node:fs/promises";
import { createApp } from "../src/server/app.js";
import { cleanWalkingGuide } from "../src/shared/walking-guide.js";
import { acquireQuotaLease } from "../src/server/runtime-lease.js";

// Opt-in public Shanghai sample: one provider route, then a gateway-cache check.
if (process.env.CONFIRM_BAIDU_WALKING_LIVE !== "1")
  throw new Error(
    "Set CONFIRM_BAIDU_WALKING_LIVE=1 to test one public Shanghai walking leg.",
  );
if (!process.env.BAIDU_SERVER_AK)
  throw new Error("Local server key is not configured.");
const releaseLease = await acquireQuotaLease(".cache/baidu-quota.json");
const server = createApp({
  ...process.env,
  HOST: "127.0.0.1",
  PORT: "8793",
  PUBLIC_ORIGIN: undefined,
  PERSONAL_DATA_PATH: ":memory:",
  AI_DATA_PATH: ".cache/walking-live-ai.sqlite",
  BAIDU_BROWSER_AK: "",
});
server.listen(8793, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:8793";
const leg = {
  from: {
    id: "home",
    name: "抚顺路社区睦邻中心（待核验入口）",
    position: {
      system: "bd09",
      lng: 121.51649820940204,
      lat: 31.283733525621674,
    },
  },
  to: {
    id: "f-market:93df0dc3624c5f32882fb55b",
    name: "阳普鞍山菜市场(鞍山四村店)",
    position: {
      system: "bd09",
      lng: 121.51783219308436,
      lat: 31.282418385871313,
    },
  },
};
try {
  const before = (await (await fetch(base + "/api/quota")).json()) as any;
  const read = async () => {
    const r = await fetch(base + "/api/outings/walking-guide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(leg),
      signal: AbortSignal.timeout(35000),
    });
    const body = (await r.json()) as any;
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return cleanWalkingGuide(body);
  };
  const guide = await read();
  const afterFirst = (await (await fetch(base + "/api/quota")).json()) as any;
  const cached = await read();
  const after = (await (await fetch(base + "/api/quota")).json()) as any;
  assert.deepEqual(cached.steps, guide.steps);
  assert.equal(after.used.route, afterFirst.used.route);
  const used = {
    route: after.used.route - before.used.route,
    search: after.used.search - before.used.search,
    other: after.used.other - before.used.other,
    map: after.used.map - before.used.map,
  };
  assert.ok(used.route >= 1 && used.route <= 2);
  assert.equal(used.search + used.other + used.map, 0);
  await mkdir(".cache", { recursive: true });
  await writeFile(
    ".cache/walking-live.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), guide, used, cacheReused: true },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      source: guide.source,
      meters: guide.meters,
      seconds: guide.seconds,
      steps: guide.steps.length,
      used,
      cacheReused: true,
      fieldVerified: false,
    }),
  );
} finally {
  server.closeAllConnections();
  server.close();
  await releaseLease();
}
