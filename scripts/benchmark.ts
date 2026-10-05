import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  compareContours,
  holdoutPoints,
  HOLDOUT_PROTOCOL,
} from "../src/core/benchmark.js";
import { parseResultFile } from "../src/shared/result-file.js";
import {
  BaiduGateway,
  BaiduProvider,
  ServiceError,
} from "../src/server/baidu.js";
import { QuotaLedger } from "../src/server/quota.js";
import { acquireQuotaLease } from "../src/server/runtime-lease.js";
import type { Sample, XY } from "../src/shared/types.js";

const flags = new Set(process.argv.slice(2));
const save = async (path: string, value: unknown, exclusive = false) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: exclusive ? "wx" : "w",
  });
await mkdir(".cache", { recursive: true });
if (flags.has("--demo")) {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const points = holdoutPoints(result);
  const travels = await new DemoProvider().route(result.center.point, points);
  const comparison = compareContours(
    result,
    points.map((point, i) => ({ point, travel: travels[i] })),
  );
  await save(".cache/benchmark-demo.json", {
    mode: "synthetic",
    protocol: HOLDOUT_PROTOCOL,
    comparison,
  });
  console.log(JSON.stringify(comparison, null, 2));
} else if (flags.has("--plan")) {
  const raw = await readFile(".cache/live-result.json", "utf8");
  const result = parseResultFile(raw);
  if (result.mode !== "baidu") throw new Error("需要既有百度体检结果。");
  const plan = {
    plannedAt: new Date().toISOString(),
    resultSha256: createHash("sha256").update(raw).digest("hex"),
    resultId: result.id,
    protocol: HOLDOUT_PROTOCOL,
    points: holdoutPoints(result),
  };
  await save(".cache/benchmark-plan.json", plan, true);
  console.log(
    "验证方案已固定：24个新点，最多24条路线，不检索POI，不重算原轮廓。",
  );
} else if (flags.has("--live")) {
  const raw = await readFile(".cache/live-result.json", "utf8");
  const result = parseResultFile(raw);
  const plan = JSON.parse(
    await readFile(".cache/benchmark-plan.json", "utf8"),
  ) as {
    resultSha256: string;
    protocol: typeof HOLDOUT_PROTOCOL;
    points: XY[];
    plannedAt: string;
  };
  if (
    result.mode !== "baidu" ||
    !result.center.geo ||
    plan.resultSha256 !== createHash("sha256").update(raw).digest("hex") ||
    JSON.stringify(plan.protocol) !== JSON.stringify(HOLDOUT_PROTOCOL) ||
    JSON.stringify(plan.points) !== JSON.stringify(holdoutPoints(result))
  )
    throw new Error("原结果或验证方案已变化，停止调用。");
  const ak = process.env.BAIDU_SERVER_AK?.trim();
  if (!ak) throw new Error("本地服务端配置未填写。");
  const quotaPath = resolve(".cache/baidu-quota.json");
  const release = await acquireQuotaLease(quotaPath);
  const ledger = new QuotaLedger(
    {
      route: Math.min(500, Number(process.env.BAIDU_DAILY_ROUTE_LIMIT ?? 500)),
      search: 12,
      other: 50,
      map: 500,
    },
    quotaPath,
  );
  const gateway = new BaiduGateway({
    ak,
    ledger,
    routeQps: 1,
    searchIntervalMs: 2000,
    maxRoutePairs: 24,
    requestLogPath: resolve(".cache/baidu-requests.jsonl"),
  });
  const provider = new BaiduProvider(gateway, result.center.geo);
  const output: {
    status: string;
    startedAt: string;
    validation: Sample[];
    error?: string;
    finishedAt?: string;
  } = {
    status: "running",
    startedAt: new Date().toISOString(),
    validation: [],
  };
  try {
    const quota = await ledger.snapshot();
    if (quota.limits.route - quota.used.route < 24)
      throw new Error("本地剩余路线预算不足24条。");
    // Refuse accidental repeated measurement; each completed pair is checkpointed.
    await save(".cache/benchmark-observations.json", output, true);
    for (const point of plan.points) {
      const [travel] = await provider.route(result.center.point, [point]);
      output.validation.push({ point, travel });
      await save(".cache/benchmark-observations.json", output);
    }
    output.status = "completed";
  } catch (error) {
    output.status = "failed";
    output.error =
      error instanceof ServiceError
        ? error.message
        : "预检未通过或已有实测记录，已停止；查看本地记录后处理。";
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    output.finishedAt = new Date().toISOString();
    if (output.validation.length)
      await save(".cache/benchmark-observations.json", output);
    await release();
  }
  if (output.validation.length) {
    const validation = plan.points.map(
      (point) =>
        output.validation.find(
          (s) => s.point[0] === point[0] && s.point[1] === point[1],
        ) ??
        ({
          point,
          travel: { status: "unknown", reason: "本轮未完成测时" },
        } as Sample),
    );
    const logs = (await readFile(".cache/baidu-requests.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            startedAt: string;
            service: string;
            units: number;
          },
      );
    const starts = logs
      .filter(
        (v) =>
          v.service === "route" &&
          v.startedAt >= output.startedAt &&
          v.startedAt <= output.finishedAt!,
      )
      .map((v) => Date.parse(v.startedAt));
    const intervals = starts.slice(1).map((time, i) => time - starts[i]);
    const comparison = compareContours(result, validation);
    const evidence = {
      case: result.center.label,
      sourceMode: result.mode,
      sourceGeneratedAt: result.generatedAt,
      sourceSha256: plan.resultSha256,
      plannedAt: plan.plannedAt,
      measuredAt: output.finishedAt,
      status: output.status,
      protocol: HOLDOUT_PROTOCOL,
      comparison,
      usage: provider.usage,
      rate: {
        minimumStartIntervalMs: intervals.length
          ? Math.min(...intervals)
          : null,
        maximumStartsInOneSecond: Math.max(
          0,
          ...starts.map(
            (t) => starts.filter((s) => s >= t && s < t + 1000).length,
          ),
        ),
      },
      scope:
        "同一百度接口的新点留出验证，非现场测量；单个候选入口，24点，不能概括所有社区或设施覆盖准确性。",
    };
    await save(".cache/benchmark-shanghai.json", evidence);
    console.log(JSON.stringify(evidence, null, 2));
  }
} else {
  console.log(
    "离线对照：npm run benchmark:demo；真实对照先 --plan 固定方案，再手动 --live（最多24条路线）。",
  );
}
