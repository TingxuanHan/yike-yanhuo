import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const result = JSON.parse(
  await readFile(
    "materials/submission-v3-evidence/shanghai-analysis.json",
    "utf8",
  ),
);
const first = JSON.parse(
  await readFile(".cache/submission-v3-first-run.json", "utf8"),
);
const start = first.api.find((x) => x.path === "/api/analyses").at;
// The asynchronous job may start its first search just before HTTP 202 arrives.
const lowerBound = new Date(Date.parse(start) - 1000).toISOString();
const logs = (await readFile(".cache/baidu-requests.jsonl", "utf8"))
  .trim()
  .split("\n")
  .map((x) => JSON.parse(x))
  .filter(
    (x) => x.startedAt >= lowerBound && x.startedAt <= result.generatedAt,
  );
const routes = logs.filter((x) => x.service === "route");
const times = routes.map((x) => Date.parse(x.startedAt)),
  gaps = times.slice(1).map((t, i) => t - times[i]);
assert.equal(result.mode, "baidu");
assert.ok(routes.length > 100);
assert.ok(logs.every((x) => x.httpStatus === 200 && x.upstreamStatus === 0));
const summary = {
  source: "live-baidu-api",
  center: result.center.label,
  startedAt: start,
  completedAt: result.generatedAt,
  quotaDelta: {
    route: routes.reduce((n, x) => n + x.units, 0),
    search: logs
      .filter((x) => x.service === "search")
      .reduce((n, x) => n + x.units, 0),
  },
  routeRequests: routes.length,
  minimumStartIntervalMs: Math.min(...gaps),
  maximumStartsInOneSecond: Math.max(
    ...times.map((t) => times.filter((s) => s >= t && s < t + 1000).length),
  ),
  successfulResponses: logs.length,
  failedResponses: 0,
  samples: result.samples.length,
  facilities: result.facilities.length,
  usage: result.usage,
  fieldValidated: false,
  recordingNote:
    "实际地址解析、设施检索和步行测时已录制；底图展示使用该轮刚生成报告，等待剪短；日常演练另标构造场景。",
  requests: logs,
};
assert.ok(summary.minimumStartIntervalMs >= 1000);
assert.equal(summary.maximumStartsInOneSecond, 1);
assert.equal(summary.quotaDelta.route, result.usage.routePairs);
assert.equal(summary.quotaDelta.search, result.usage.searchRequests);
await writeFile(
  "materials/submission-v3-evidence/live-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify({ ...summary, requests: undefined }));
