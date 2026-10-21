import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BaiduGateway,
  BaiduProvider,
  ServiceError,
} from "../dist/server/server/baidu.js";
import { QuotaLedger } from "../dist/server/server/quota.js";
import { acquireQuotaLease } from "../dist/server/server/runtime-lease.js";
import { analyze } from "../dist/server/core/analyze.js";
import { emptyUsage, CATEGORIES } from "../dist/server/shared/types.js";
import { facilityCount } from "../dist/server/core/facilities.js";

if (!process.argv.includes("--run")) {
  console.log(
    "实测会消耗百度地图配额。已准备好后，使用 node --env-file=.env scripts/live-check.mjs --run 执行一轮。",
  );
  process.exit(0);
}
const ak = process.env.BAIDU_SERVER_AK?.trim();
if (!ak) {
  console.error("请先填写本地 .env 中的服务端 AK。");
  process.exit(1);
}
const quotaPath = resolve(".cache/baidu-quota.json");
const releaseLease = await acquireQuotaLease(quotaPath).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
const ledger = new QuotaLedger(
  { route: 500, search: 12, other: 10, map: 500 },
  quotaPath,
);
const gateway = new BaiduGateway({
  ak,
  routeQps: 1,
  searchIntervalMs: 2000,
  maxRoutePairs: 260,
  maxSearchPages: 1,
  ledger,
  requestLogPath: resolve(".cache/baidu-requests.jsonl"),
});
const evidence = {
  timestamp: new Date().toISOString(),
  status: "running",
  stages: [],
  limits: {
    routesThisAnalysis: 260,
    dailyRoutes: 500,
    dailySearches: 12,
    routePairsPerSecond: 1,
    searchIntervalMs: 2000,
    maxInFlight: 1,
  },
  notes: ["本记录是接口联调，不构成现场入口核验或地图准确性验证。"],
};
try {
  console.log("实测 1/4：地址定位");
  const located = await gateway.geocode("上海市杨浦区抚顺路社区睦邻中心");
  evidence.center = located;
  if (
    located.geo.lng < 121.3 ||
    located.geo.lng > 121.7 ||
    located.geo.lat < 31.1 ||
    located.geo.lat > 31.5
  )
    throw new ServiceError("定位结果未落在预期上海范围，停止后续调用。");
  evidence.stages.push({
    stage: "geocode",
    status: "passed",
    precise: located.precise,
    confidence: located.confidence,
  });
  console.log("实测 2/4：单条步行路线");
  const provider = new BaiduProvider(gateway, located.geo);
  const [route] = await provider.route([0, 0], [[200, 0]]);
  if (route.status !== "ok")
    throw new ServiceError("单条路线未返回有效步行时间，停止完整分析。");
  evidence.stages.push({
    stage: "walking",
    status: "passed",
    seconds: route.seconds,
    meters: route.meters,
  });
  console.log("实测 3/4：坐标转换");
  await gateway.convert({ lng: 121.5, lat: 31.2 }, 1);
  evidence.stages.push({ stage: "coordinateConversion", status: "passed" });
  console.log("实测 4/4：一轮社区体检");
  let previous = "";
  const result = await analyze(
    provider,
    {
      label: "抚顺路社区睦邻中心（待核验入口）",
      point: [0, 0],
      geo: located.geo,
    },
    {
      onProgress: (p) => {
        if (p.stage !== previous) {
          console.log(p.stage);
          previous = p.stage;
        }
      },
    },
  );
  evidence.status = "passed";
  evidence.stages.push({ stage: "analysis", status: "passed" });
  evidence.analysis = {
    generatedAt: result.generatedAt,
    elapsedMs: result.elapsedMs,
    quality: result.quality,
    usage: result.usage,
    parameters: result.parameters,
    completeness: result.complete,
    areas: result.contours.map((c) => ({
      minutes: c.minutes,
      areaKm2: c.areaKm2,
      clipped: c.clipped,
    })),
    facilities: CATEGORIES.map((c) => ({
      category: c.id,
      label: c.label,
      counts: [5, 10, 15].map((m) => facilityCount(result.facilities, c.id, m)),
    })),
    gaps: {
      missing: result.gaps.filter((g) => g.status === "missing").length,
      unknown: result.gaps.filter((g) => g.status === "unknown").length,
    },
    warnings: result.warnings,
  };
  // Reusable local result, explicitly produced by this manual verification run.
  await mkdir(".cache", { recursive: true });
  await writeFile(".cache/live-result.json", JSON.stringify(result));
  console.log(
    `体检完成：${result.quality.knownSamples}/${result.quality.totalSamples} 个有效测时点，${result.usage.routePairs} 条路线，${result.usage.searchRequests} 次地点检索。`,
  );
} catch (error) {
  evidence.status = "failed";
  evidence.error =
    error instanceof ServiceError
      ? error.message
      : "本轮实测出现未预期错误，请检查本地实现。";
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  await mkdir(".cache", { recursive: true });
  const quota = await readFile(quotaPath, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  evidence.localQuotaCounters = quota;
  await writeFile(
    ".cache/live-check.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log("无密钥的联调摘要已保存到 .cache/live-check.json");
  await releaseLease();
}
