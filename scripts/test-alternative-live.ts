import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createApp } from "../src/server/app.js";
import { acquireQuotaLease } from "../src/server/runtime-lease.js";
import { parseResultFile } from "../src/shared/result-file.js";
import { sceneFromReport } from "../src/mini/outings.js";
import { emptyBook } from "../src/shared/life.js";
import { emptyPlanning } from "../src/shared/planning.js";
import { defaultMovement } from "../src/shared/movement.js";
import { defaultShopping } from "../src/shared/shopping.js";
import { solveTrip, startTrip, type TripInput } from "../src/shared/trip.js";
import { replaceNextStop } from "../src/shared/trip-alternative.js";
import {
  noticeDistance,
  cleanNoticeQuery,
} from "../src/shared/neighborhood.js";
import { cleanWalkingGuide } from "../src/shared/walking-guide.js";
import { guideNotices } from "../src/mini/neighborhood.js";
import type { RouteBundle } from "../src/shared/outings.js";

if (
  process.env.CONFIRM_BAIDU_ALTERNATIVE_LIVE !== "1" ||
  !process.env.BAIDU_SERVER_AK
)
  throw new Error(
    "需要本地服务端AK及CONFIRM_BAIDU_ALTERNATIVE_LIVE=1；最多5段路线，另留重试余量。",
  );
const report = parseResultFile(
  await readFile(".cache/refined-result.json", "utf8"),
);
assert.equal(report.mode, "baidu");
const book = emptyBook(),
  scene = sceneFromReport(report, book);
const markets = scene.facilities
  .filter((f) => f.category === "market")
  .sort(
    (a, b) =>
      noticeDistance(a.position, scene.origin.position) -
      noticeDistance(b.position, scene.origin.position),
  );
const first = markets[0],
  second = markets
    .slice(1)
    .find((n) => noticeDistance(n.position, first.position) < 2000);
assert.ok(
  first && second,
  "Saved Shanghai case needs two known market coordinates",
);
const stops = [first, second].map((n) => ({ ...n, stay: 5 }));
const nodes = [scene.origin, ...stops];
const release = await acquireQuotaLease(".cache/baidu-quota.json");
const app = createApp({
  ...process.env,
  PORT: "8793",
  HOST: "127.0.0.1",
  PUBLIC_ORIGIN: undefined,
  PERSONAL_DATA_PATH: ":memory:",
  AI_DATA_PATH: ".cache/alternative-live-ai.sqlite",
  BAIDU_BROWSER_AK: "",
});
app.listen(8793, "127.0.0.1");
await once(app, "listening");
const base = "http://127.0.0.1:8793";
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const value = (await r.json()) as any;
  if (!r.ok) throw new Error(value.error || `HTTP ${r.status}`);
  return value as T;
}
const quota = async () =>
  (await (await fetch(base + "/api/quota")).json()) as any;
try {
  const before = await quota();
  assert.ok(
    before.limits.route - before.used.route >= 10,
    "Not enough existing daily quota for this bounded test",
  );
  const initialPairs = [
    [scene.origin.id, first.id],
    [first.id, scene.origin.id],
  ];
  const bundle = await post<RouteBundle>("/api/outings/routes", {
    nodes,
    pairs: initialPairs,
  });
  const input: TripInput = {
    origin: scene.origin,
    stops,
    bundle,
    preferences: book.preferences,
    movement: defaultMovement(),
    shopping: defaultShopping(),
    draft: {
      ...emptyPlanning(),
      tripMinutes: 60,
      tasks: ["market"],
      items: [],
      speedMps: 1.2,
    },
  };
  const plan = solveTrip(input).plans[0];
  assert.ok(plan, "Original public walking route is unavailable");
  const active = startTrip(input, plan),
    snapshot = structuredClone(active);
  const pairs = [
    [scene.origin.id, second.id],
    [second.id, scene.origin.id],
  ];
  const replacement = await post<RouteBundle>("/api/outings/routes", {
    nodes,
    pairs,
  });
  const afterRoutes = await quota();
  const repeated = await post<RouteBundle>("/api/outings/routes", {
    nodes,
    pairs,
  });
  assert.deepEqual(repeated.edges, replacement.edges);
  assert.equal((await quota()).used.route, afterRoutes.used.route);
  const preview = replaceNextStop(active, stops[1], "place", replacement);
  assert.deepEqual(active, snapshot);
  assert.equal(preview.active.remaining[0], second.id);
  const leg = { from: scene.origin, to: stops[1] };
  const guide = cleanWalkingGuide(
    await post("/api/outings/walking-guide", leg),
  );
  const afterGuide = await quota();
  const cached = cleanWalkingGuide(
    await post("/api/outings/walking-guide", leg),
  );
  assert.deepEqual(cached.steps, guide.steps);
  const after = await quota();
  assert.equal(after.used.route, afterGuide.used.route);
  const query = guideNotices(leg, guide).query;
  assert.doesNotThrow(() => cleanNoticeQuery(query));
  const used = {
    route: after.used.route - before.used.route,
    search: after.used.search - before.used.search,
    other: after.used.other - before.used.other,
    map: after.used.map - before.used.map,
  };
  assert.ok(used.route >= 5 && used.route <= 10);
  assert.equal(used.search + used.other + used.map, 0);
  const result = {
    checkedAt: new Date().toISOString(),
    passed: true,
    source: "Baidu walking API",
    origin: scene.origin.name,
    original: first.name,
    alternative: second.name,
    originalRoundTripMeters: bundle.edges.reduce(
      (sum, e) => sum + (e.travel.status === "ok" ? e.travel.meters : 0),
      0,
    ),
    alternativeRoundTripMeters: replacement.edges.reduce(
      (sum, e) => sum + (e.travel.status === "ok" ? e.travel.meters : 0),
      0,
    ),
    guide: {
      meters: guide.meters,
      seconds: guide.seconds,
      steps: guide.steps.length,
      pathPoints: guide.path?.length ?? 0,
    },
    usage: used,
    routeCacheReused: true,
    guideCacheReused: true,
    originalPreserved: true,
    fieldVerified: false,
    limitations: [
      "地点来自已保存的上海公开POI，未核验实际入口、营业、无障碍或路况。",
      "备选可行性仅验证API路线与本地计算，不代表实地通行。",
      "价格、邻里用户反馈和家庭数据未发送到百度。",
    ],
  };
  await mkdir("docs/validation", { recursive: true });
  await writeFile(
    "docs/validation/baidu-alternative-live.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(
    ".cache/alternative-live-replay.json",
    JSON.stringify({ result, input, plan, preview, guide }),
  );
  console.log(JSON.stringify(result));
} finally {
  app.closeAllConnections();
  await new Promise<void>((resolve) => app.close(() => resolve()));
  await release();
}
