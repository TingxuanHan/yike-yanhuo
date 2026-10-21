import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adaptiveMesh, MESH_VERSION } from "../src/core/mesh.js";
import { analyze } from "../src/core/analyze.js";
import { distance, pointKey } from "../src/core/geo.js";
import { compareContours } from "../src/core/benchmark.js";
import { parseResultFile } from "../src/shared/result-file.js";
import {
  emptyUsage,
  type Sample,
  type XY,
  type Provider,
} from "../src/shared/types.js";
import {
  BaiduGateway,
  BaiduProvider,
  ServiceError,
} from "../src/server/baidu.js";
import { QuotaLedger } from "../src/server/quota.js";
import { acquireQuotaLease } from "../src/server/runtime-lease.js";

const save = (path: string, data: unknown, exclusive = false) =>
  writeFile(path, JSON.stringify(data, null, 2) + "\n", {
    flag: exclusive ? "wx" : "w",
  });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const raw = await readFile(".cache/live-result.json", "utf8");
const source = parseResultFile(raw);
if (source.mode !== "baidu" || !source.center.geo)
  throw new Error("需要已有的真实案例。");
const modelSha256 = hash(
  (
    await Promise.all(
      ["src/core/mesh.ts", "src/core/analyze.ts", "src/core/contours.ts"].map(
        (p) => readFile(p, "utf8"),
      ),
    )
  ).join("\n"),
);
const known = new Map<string, Sample>(
  [
    ...source.samples,
    ...source.facilities
      .filter((f) => f.travel)
      .map((f) => ({ point: f.point, travel: f.travel! })),
  ].map((s) => [pointKey(s.point), s]),
);
const flags = new Set(process.argv.slice(2));
const planPath = ".cache/refinement-plan.json";
const observationPath = ".cache/refinement-observations.json";
const protocol = {
  meshVersion: MESH_VERSION,
  refinementBudget: 96,
  radiiMeters: [180, 280, 380],
  anglesDegrees: Array.from({ length: 8 }, (_, i) => 11.25 + i * 45),
  minimumSeparationMeters: 10,
  purpose:
    "预先固定的新点，仅检验短距离边界；旧24点作为开发案例，不再作为独立验证",
};
interface Plan {
  plannedAt: string;
  sourceSha256: string;
  modelSha256: string;
  protocol: typeof protocol;
  training: XY[];
  validation: XY[];
}
interface Observations {
  planSha256: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  training: Sample[];
  validation: Sample[];
  usage: ReturnType<typeof emptyUsage>;
}

if (flags.has("--plan")) {
  const training: XY[] = [];
  const mesh = await adaptiveMesh(
    source.center.point,
    source.parameters.radiusMeters,
    source.parameters.coarseStepMeters,
    96,
    async (points, stage) =>
      points.map((point) => {
        const existing = known.get(pointKey(point));
        if (existing) return existing;
        if (stage !== "复核5分钟边界")
          throw new Error("原记录缺少第一轮测时，不能离线固定本方案。");
        training.push(point);
        return { point, travel: { status: "unknown", reason: "尚未测时" } };
      }),
  );
  const prior = JSON.parse(
    await readFile(".cache/benchmark-observations.json", "utf8"),
  ) as { validation: Sample[] };
  const excluded = [...mesh.samples.map((s) => s.point), ...known.values()].map(
    (s) => (Array.isArray(s) ? s : s.point),
  );
  excluded.push(...prior.validation.map((s) => s.point));
  const validation = protocol.radiiMeters.flatMap((radius) =>
    protocol.anglesDegrees.map((angle): XY => {
      const rad = (angle * Math.PI) / 180;
      return [
        source.center.point[0] +
          Math.round(radius * Math.cos(rad) * 1000) / 1000,
        source.center.point[1] +
          Math.round(radius * Math.sin(rad) * 1000) / 1000,
      ];
    }),
  );
  if (
    validation.some((p) =>
      excluded.some((q) => distance(p, q) < protocol.minimumSeparationMeters),
    )
  )
    throw new Error("新验证点过于接近已有点，方案需重新设计。");
  if (training.length + validation.length > 80)
    throw new Error("超过本次80条路线的上限。");
  const plan: Plan = {
    plannedAt: new Date().toISOString(),
    sourceSha256: hash(raw),
    modelSha256,
    protocol,
    training,
    validation,
  };
  await save(planPath, plan, true);
  console.log(
    JSON.stringify({
      training: training.length,
      validation: validation.length,
      maximumRequests: training.length + validation.length,
      searches: 0,
      meshSamples: mesh.samples.length,
    }),
  );
} else if (flags.has("--live") || flags.has("--report")) {
  const planRaw = await readFile(planPath, "utf8");
  const plan = JSON.parse(planRaw) as Plan;
  if (
    plan.sourceSha256 !== hash(raw) ||
    plan.modelSha256 !== modelSha256 ||
    JSON.stringify(plan.protocol) !== JSON.stringify(protocol)
  )
    throw new Error("原结果、算法或方案已变化，停止。");
  const maximumRequests = plan.training.length + plan.validation.length;
  if (maximumRequests > 80 || !maximumRequests)
    throw new Error("路线数量不符合预算。");
  let observations: Observations;
  if (flags.has("--live")) {
    const quotaPath = resolve(".cache/baidu-quota.json");
    const release = await acquireQuotaLease(quotaPath);
    try {
      const ledger = new QuotaLedger(
        {
          route: Math.min(
            500,
            Number(process.env.BAIDU_DAILY_ROUTE_LIMIT ?? 500),
          ),
          search: 12,
          other: 50,
          map: 500,
        },
        quotaPath,
      );
      const quota = await ledger.snapshot();
      if (quota.limits.route - quota.used.route < maximumRequests)
        throw new Error("剩余预算不足。");
      const ak = process.env.BAIDU_SERVER_AK?.trim();
      if (!ak) throw new Error("服务端配置缺失。");
      const gateway = new BaiduGateway({
        ak,
        ledger,
        routeQps: 1,
        maxRoutePairs: maximumRequests,
        requestLogPath: resolve(".cache/baidu-requests.jsonl"),
      });
      const provider = new BaiduProvider(gateway, source.center.geo!);
      observations = {
        planSha256: hash(planRaw),
        status: "running",
        startedAt: new Date().toISOString(),
        training: [],
        validation: [],
        usage: emptyUsage(),
      };
      // Never overwrite an earlier run or resume silently after a quota error.
      await save(observationPath, observations, true);
      try {
        for (const stage of ["training", "validation"] as const) {
          for (const point of plan[stage]) {
            const [travel] = await provider.route(source.center.point, [point]);
            observations[stage].push({ point, travel });
            observations.usage = { ...provider.usage };
            await save(observationPath, observations);
          }
          console.log(`${stage}: ${observations[stage].length} 个测时点完成`);
        }
        observations.status = "completed";
      } catch (error) {
        observations.status = "failed";
        console.error(
          error instanceof ServiceError
            ? error.message
            : "本轮请求已停止，检查本地记录。",
        );
        process.exitCode = 1;
      } finally {
        observations.finishedAt = new Date().toISOString();
        observations.usage = { ...provider.usage };
        await save(observationPath, observations);
      }
    } finally {
      await release();
    }
  } else
    observations = JSON.parse(
      await readFile(observationPath, "utf8"),
    ) as Observations;
  if (
    observations.planSha256 !== hash(planRaw) ||
    observations.status !== "completed"
  )
    throw new Error("实测记录未完成或与方案不符；不能发布完整对照。");
  const training = new Map(known);
  observations.training.forEach((s) => training.set(pointKey(s.point), s));
  const reused = new Set<string>();
  const replay: Provider = {
    mode: "baidu",
    usage: emptyUsage(),
    search: async () => ({
      facilities: structuredClone(source.facilities),
      complete: { ...source.complete },
      warnings: source.warnings.filter(
        (w) => !w.includes("插值") && !w.includes("采样"),
      ),
      radiusMeters: source.parameters.searchRadiusMeters,
    }),
    route: async (_, points) =>
      points.map((p) => {
        const key = pointKey(p),
          value = training.get(key);
        if (!value) throw new Error("缺少计划中的测时点。");
        if (known.has(key)) reused.add(key);
        return value.travel;
      }),
  };
  const result = await analyze(replay, source.center, {
    radius: source.parameters.radiusMeters,
    step: source.parameters.coarseStepMeters,
    maxRefinement: 96,
  });
  result.derivedFrom = {
    sourceId: source.id,
    sourceGeneratedAt: source.generatedAt,
    reusedTravelPoints: reused.size,
    addedTravelPoints: observations.training.length,
  };
  result.usage = {
    requests: observations.training.length,
    routePairs: observations.training.length,
    searchRequests: 0,
    cacheHits: reused.size,
    retries: 0,
  };
  await save(".cache/refined-result.json", result);
  const previous = compareContours(source, observations.validation).filter(
    (r) => r.model === "adaptive",
  );
  const current = compareContours(result, observations.validation).filter(
    (r) => r.model === "adaptive",
  );
  const evidence = {
    protocol: plan.protocol,
    sourceSha256: plan.sourceSha256,
    modelSha256,
    plannedAt: plan.plannedAt,
    measuredAt: observations.finishedAt,
    sourceGeneratedAt: source.generatedAt,
    observations,
    previous,
    current,
    scope:
      "上海单个候选入口，同一服务的新点对照。仅观察短距离边界，非现场真值、非一般精度承诺。旧设施数据复用。",
  };
  await save(".cache/refinement-comparison.json", evidence);
  console.log(
    JSON.stringify(
      {
        previous,
        current,
        usage: observations.usage,
        samples: result.samples.length,
      },
      null,
      2,
    ),
  );
} else
  console.log(
    "先 --plan 固定新采样与验证点，再 --live 单次实测；--report 仅复用记录。",
  );
