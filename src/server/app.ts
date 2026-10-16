import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { analyze } from "../core/analyze.js";
import { verificationPlan, executeVerification } from "../core/verification.js";
import { DemoProvider, DEMO_CENTERS } from "../core/demo.js";
import { validGeo } from "../core/geo.js";
import { BaiduGateway, BaiduProvider, ServiceError } from "./baidu.js";
import type {
  AnalysisInput,
  Center,
  Job,
  Provider,
  PublicConfig,
} from "../shared/types.js";
import { QuotaLedger, QuotaError } from "./quota.js";
import { createMapProxy } from "./map-proxy.js";
import { LifeStore } from "./life-store.js";
import { timingSafeEqual, createHash } from "node:crypto";
import { personalize } from "../core/personalize.js";
import { cleanJourney } from "../shared/journey.js";
import { parseResultFile } from "../shared/result-file.js";
import { MAX_BOOK_BYTES } from "../shared/life.js";
import { readOutingRoutes } from "./outing-routes.js";
import { readWalkingGuide } from "./walking-guide.js";
import { AiService } from "./ai-service.js";
import type { requireZeroPrice } from "./ai-pricing.js";
import type { AiTransport } from "./ai-transport.js";

const integer = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("服务配置数值超出允许范围，请检查 .env");
  return n;
};
async function readJson(
  req: IncomingMessage,
  limit = 8192,
): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new ServiceError("请使用 JSON 请求。", 415);
  let size = 0;
  const buffers: Buffer[] = [];
  for await (const buffer of req) {
    size += buffer.length;
    if (size > limit) throw new ServiceError("请求内容过长。", 413);
    buffers.push(buffer);
  }
  try {
    const result = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result;
  } catch {
    throw new ServiceError("请求格式无效。", 400);
  }
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

export function validateInput(value: Record<string, unknown>): AnalysisInput {
  if (value.mode !== "demo" && value.mode !== "baidu")
    throw new ServiceError("请选择模拟街区或百度地图。", 400);
  if (
    value.label !== undefined &&
    (typeof value.label !== "string" || value.label.trim().length > 80)
  )
    throw new ServiceError("地点名称过长。", 400);
  if (value.mode === "baidu") {
    if (!validGeo(value.geo))
      throw new ServiceError("请先定位一个有效的地图中心。", 400);
    return {
      mode: "baidu",
      label: typeof value.label === "string" ? value.label.trim() : undefined,
      geo: value.geo,
    };
  }
  const p = value.point ?? DEMO_CENTERS[0].point;
  if (
    !Array.isArray(p) ||
    p.length !== 2 ||
    p.some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000,
    )
  )
    throw new ServiceError("请选择模拟街区中心区域内的点位。", 400);
  return {
    mode: "demo",
    point: [p[0], p[1]],
    label:
      typeof value.label === "string"
        ? value.label.trim()
        : DEMO_CENTERS[0].label,
  };
}

export function createApp(
  env: NodeJS.ProcessEnv = process.env,
  gatewayOverride?: BaiduGateway,
  aiTransport?: AiTransport,
  aiPriceCheck?: typeof requireZeroPrice,
  voiceTransport?: import("./voice-transport.js").VoiceTransport,
) {
  const publicServer =
    Boolean(env.PUBLIC_ORIGIN) ||
    (Boolean(env.HOST) &&
      !["localhost", "127.0.0.1", "::1"].includes(env.HOST!));
  if (publicServer && !env.PUBLIC_ORIGIN?.startsWith("https://"))
    throw new Error(
      "外部部署须配置 HTTPS PUBLIC_ORIGIN，私人地点簿不能通过明文公网传输。",
    );
  const life = new LifeStore(env.PERSONAL_DATA_PATH);
  const ai = new AiService(
    env,
    aiTransport,
    undefined,
    aiPriceCheck,
    voiceTransport,
  );
  const tokenOf = (req: IncomingMessage) =>
    req.headers.authorization?.replace(/^Bearer /, "") ??
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("yike_device="))
      ?.slice(12);
  const limits = new Map<string, { count: number; until: number }>();
  const rate = (key: string, max: number, window = 600_000) => {
    for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
    if (limits.size >= 1000 && !limits.has(key))
      throw new ServiceError("当前请求较多，请稍后再试。", 429);
    const row = limits.get(key) ?? { count: 0, until: Date.now() + window };
    if (++row.count > max)
      throw new ServiceError("操作过于频繁，请稍后再试。", 429);
    limits.set(key, row);
  };
  const session = (
    req: IncomingMessage,
    res: ServerResponse,
    value: ReturnType<LifeStore["create"]>,
    client: unknown,
  ) => {
    if (client !== "mini")
      res.setHeader(
        "set-cookie",
        `yike_device=${value.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${publicServer ? "; Secure" : ""}`,
      );
    return json(res, 200, {
      snapshot: value.snapshot,
      ...(client === "mini" ? { token: value.token } : {}),
    });
  };
  const browserAk = env.BAIDU_BROWSER_AK?.trim() ?? "";
  const serverAk = env.BAIDU_SERVER_AK?.trim() ?? "";
  const config: PublicConfig = {
    baiduConfigured: Boolean(serverAk),
    mapConfigured: Boolean(browserAk),
    version: "0.1.0",
  };
  const quota =
    gatewayOverride?.ledger ??
    new QuotaLedger(
      {
        route: integer(env.BAIDU_DAILY_ROUTE_LIMIT, 500, 1, 1200),
        search: integer(env.BAIDU_DAILY_SEARCH_LIMIT, 12, 1, 80),
        other: 50,
        map: 500,
      },
      serverAk || browserAk ? resolve(".cache/baidu-quota.json") : undefined,
    );
  const proxyMap = createMapProxy(browserAk, serverAk, quota);
  const gateway =
    gatewayOverride ??
    new BaiduGateway({
      ak: serverAk,
      routeQps: integer(env.BAIDU_ROUTE_QPS, 1, 1, 2),
      searchIntervalMs: integer(
        env.BAIDU_SEARCH_INTERVAL_MS,
        2000,
        2000,
        60000,
      ),
      maxRoutePairs: integer(env.BAIDU_MAX_ROUTE_PAIRS, 260, 81, 1000),
      maxSearchPages: integer(env.BAIDU_MAX_SEARCH_PAGES, 1, 1, 3),
      ledger: quota,
      requestLogPath: serverAk
        ? resolve(".cache/baidu-requests.jsonl")
        : undefined,
    });
  const jobs = new Map<
    string,
    {
      job: Job;
      mode: string;
      owner: string;
      controller: AbortController;
      expires: number;
      verificationKey?: string;
      verificationFingerprint?: string;
    }
  >();
  const clientRoot = resolve("dist/client");
  const clean = () => {
    life.assistance.sweep();
    life.family.sweep();
    for (const [id, item] of jobs)
      if (item.expires < Date.now()) {
        item.controller.abort();
        jobs.delete(id);
      }
  };
  const cleanup = setInterval(clean, 30_000).unref();
  const allowedOrigins = new Set(
    [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      `http://127.0.0.1:${env.PORT ?? 8787}`,
      `http://localhost:${env.PORT ?? 8787}`,
      env.PUBLIC_ORIGIN,
    ].filter(Boolean),
  );
  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        if (
          (req.headers.origin && !allowedOrigins.has(req.headers.origin)) ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          throw new ServiceError("请求来源不受支持，请从项目页面操作。", 403);
      }
      clean();
      if (method === "GET" && url.pathname === "/api/health")
        return json(res, 200, { status: "ok", version: config.version });
      if (method === "GET" && url.pathname === "/api/config")
        return json(res, 200, config);
      const peer = req.socket.remoteAddress ?? "unknown";
      const familyRoute = url.pathname.match(
        /^\/api\/(life\/)?family(?:\/([a-f0-9-]{36}))?$/,
      );
      if (familyRoute) {
        try {
          const owner = familyRoute[1]
            ? life.authenticate(tokenOf(req))
            : undefined;
          const id = familyRoute[2];
          rate("family-read:" + (owner ?? peer), 120);
          if (owner && !id && method === "POST") {
            rate("family-create:" + owner, 10);
            return json(
              res,
              201,
              life.family.create(owner, (await readJson(req, 3000)).snapshot),
            );
          }
          if (id && method === "GET")
            return json(
              res,
              200,
              life.family.read(id, owner, req.headers["x-yike-family"]),
            );
          if (!owner && id && method === "POST") {
            rate("family-reply:" + id + ":" + peer, 20);
            const body = await readJson(req, 1000);
            return json(
              res,
              200,
              life.family.reply(
                id,
                req.headers["x-yike-family"],
                body.revision,
                body.receipt,
              ),
            );
          }
          if (owner && id && method === "DELETE")
            return json(res, 200, life.family.close(id, owner));
          throw new ServiceError("位置分享操作不存在。", 404);
        } catch (e) {
          if (e instanceof ServiceError) throw e;
          throw new ServiceError(
            e instanceof Error ? e.message : "位置说明无效。",
            400,
          );
        }
      }
      const helperRoute = url.pathname.match(
        /^\/api\/assistance\/([a-f0-9-]{36})$/,
      );
      const ownerRoute = url.pathname.match(
        /^\/api\/life\/assistance(?:\/([a-f0-9-]{36})(?:\/(decision))?)?$/,
      );
      if (helperRoute || ownerRoute) {
        try {
          if (helperRoute) {
            const id = helperRoute[1],
              token = req.headers["x-yike-assist"];
            rate("assist-read:" + peer, 600);
            if (method === "GET")
              return json(res, 200, life.assistance.read(id, undefined, token));
            if (method === "POST") {
              rate("assist-propose:" + id + ":" + peer, 30);
              const body = await readJson(req, 5000);
              return json(
                res,
                200,
                life.assistance.propose(
                  id,
                  token,
                  body.revision,
                  body.proposal,
                ),
              );
            }
          } else if (ownerRoute) {
            const owner = life.authenticate(tokenOf(req)),
              id = ownerRoute[1];
            rate("assist-owner:" + owner, 600);
            if (!id && method === "GET")
              return json(res, 200, life.assistance.list(owner));
            if (!id && method === "POST") {
              rate("assist-create:" + owner, 10);
              return json(
                res,
                201,
                life.assistance.create(
                  owner,
                  (await readJson(req, 90000)).snapshot,
                ),
              );
            }
            if (id && method === "GET")
              return json(res, 200, life.assistance.read(id, owner));
            if (id && method === "DELETE")
              return json(res, 200, life.assistance.close(id, owner));
            if (id && method === "PUT") {
              const body = await readJson(req, 90000);
              return json(
                res,
                200,
                life.assistance.update(id, owner, body.revision, body.snapshot),
              );
            }
            if (id && ownerRoute[2] && method === "POST") {
              const body = await readJson(req, 2000);
              return json(
                res,
                200,
                life.assistance.resolve(
                  id,
                  owner,
                  body.revision,
                  body.proposalId,
                  body.decision,
                ),
              );
            }
          }
          throw new ServiceError("协助操作不存在。", 404);
        } catch (error) {
          if (error instanceof ServiceError) throw error;
          throw new ServiceError(
            error instanceof Error ? error.message : "协助内容无效。",
            400,
          );
        }
      }
      if (method === "GET" && url.pathname === "/api/card") {
        rate("card-read:" + peer, 120);
        return json(res, 200, life.sharedCard(req.headers["x-yike-card"]));
      }
      if (method === "POST" && url.pathname === "/api/life/create") {
        rate("create:" + peer, 5, 3600_000);
        const body = await readJson(req);
        if (
          publicServer ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)
        ) {
          const expected = env.SPACE_INVITE_CODE;
          const digest = (v: string) => createHash("sha256").update(v).digest();
          if (
            !expected ||
            expected.length < 24 ||
            typeof body.invite !== "string" ||
            !timingSafeEqual(digest(body.invite), digest(expected))
          )
            throw new ServiceError(
              "请填写管理员提供的创建邀请码，或使用已有设备的配对码。",
              403,
            );
        }
        return session(req, res, life.create(), body.client);
      }
      if (method === "POST" && url.pathname === "/api/life/redeem") {
        rate("redeem:" + peer, 8);
        const body = await readJson(req);
        return session(req, res, life.redeem(body.code), body.client);
      }
      if (url.pathname.startsWith("/api/neighborhood/")) {
        const owner = life.authenticate(tokenOf(req));
        rate("neighbor-read:" + owner, 120);
        try {
          if (method === "POST" && url.pathname === "/api/neighborhood/query")
            return json(
              res,
              200,
              life.neighborhood.query(owner, await readJson(req, 160000)),
            );
          const event = url.pathname.match(
            /^\/api\/neighborhood\/events(?:\/([a-f0-9-]{36}))?$/,
          );
          if (method === "POST" && event) {
            rate("neighbor-write:" + owner, 12);
            return json(
              res,
              200,
              life.neighborhood.write(
                owner,
                event[1] ?? null,
                await readJson(req, 6000),
              ),
            );
          }
          throw new ServiceError("提醒操作不存在。", 404);
        } catch (e) {
          if (e instanceof ServiceError) throw e;
          throw new ServiceError(
            e instanceof Error ? e.message : "提醒内容无效。",
            400,
          );
        }
      }
      if (url.pathname.startsWith("/api/ai/")) {
        const token = tokenOf(req),
          space = life.authenticate(token);
        if (method === "GET" && url.pathname === "/api/ai/status")
          return json(res, 200, ai.status(token!, space));
        if (method === "GET" && url.pathname === "/api/ai/voice")
          return json(res, 200, ai.voiceStatus());
        if (method === "POST" && url.pathname === "/api/ai/voice")
          return json(
            res,
            200,
            await ai.transcribe(token!, space, await readJson(req, 2_800_000)),
          );
        if (method === "PUT" && url.pathname === "/api/ai/settings") {
          rate(`ai-settings:${space}`, 20);
          ai.save(token!, await readJson(req));
          return json(res, 200, ai.status(token!, space));
        }
        if (method === "DELETE" && url.pathname === "/api/ai/settings") {
          ai.remove(token!);
          return json(res, 200, ai.status(token!, space));
        }
        if (method === "POST" && url.pathname === "/api/ai/parse") {
          const input = await readJson(req);
          if (input.mode !== "free" || env.AI_FREE_LOCAL_LIMITS !== "false")
            rate(`ai:${space}`, 10);
          return json(res, 200, await ai.run(token!, space, input));
        }
        throw new ServiceError("接口不存在。", 404);
      }
      if (url.pathname.startsWith("/api/life")) {
        const token = tokenOf(req);
        const owner = life.authenticate(token);
        if (url.pathname === "/api/life/cards") {
          if (method === "GET") return json(res, 200, life.cards(owner));
          if (method === "POST") {
            rate("card-create:" + owner, 20);
            return json(
              res,
              201,
              life.createCard(owner, (await readJson(req, 90_000)).place),
            );
          }
        }
        if (method === "DELETE" && url.pathname.startsWith("/api/life/cards/"))
          return json(
            res,
            200,
            life.revokeCard(
              owner,
              url.pathname.slice("/api/life/cards/".length),
            ),
          );
        if (method === "GET" && url.pathname === "/api/life")
          return json(res, 200, life.read(owner));
        if (url.pathname === "/api/life/reports") {
          if (method === "GET") return json(res, 200, life.reports(owner));
          if (method === "POST") {
            rate("report:" + owner, 20);
            return json(
              res,
              200,
              life.saveReport(owner, (await readJson(req, 2_100_000)).result),
            );
          }
        }
        if (url.pathname.startsWith("/api/life/reports/")) {
          const id = decodeURIComponent(
            url.pathname.slice("/api/life/reports/".length),
          );
          if (method === "GET") return json(res, 200, life.report(owner, id));
          if (method === "DELETE")
            return json(res, 200, life.deleteReport(owner, id));
        }
        if (method === "PUT" && url.pathname === "/api/life") {
          rate("write:" + owner, 120);
          const body = await readJson(req, MAX_BOOK_BYTES + 1024);
          return json(res, 200, life.write(owner, body.revision, body.book));
        }
        if (method === "POST" && url.pathname === "/api/life/pair") {
          rate("pair:" + owner, 12);
          return json(res, 200, life.pair(owner));
        }
        if (method === "DELETE" && url.pathname === "/api/life/session") {
          ai.remove(tokenOf(req)!);
          life.revoke(token!);
          res.setHeader(
            "set-cookie",
            `yike_device=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publicServer ? "; Secure" : ""}`,
          );
          return json(res, 200, { ok: true });
        }
        throw new ServiceError("接口不存在。", 404);
      }
      const owner =
        publicServer && url.pathname.startsWith("/api/")
          ? life.authenticate(tokenOf(req))
          : "local";
      if (
        method === "POST" &&
        ["/api/outings/routes", "/api/outings/walking-guide"].includes(
          url.pathname,
        )
      ) {
        rate("outing:" + owner + ":" + peer, 40);
        const body = await readJson(req, 24000);
        const controller = new AbortController();
        const abort = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", abort);
        try {
          return json(
            res,
            200,
            await (
              url.pathname === "/api/outings/walking-guide"
                ? readWalkingGuide
                : readOutingRoutes
            )(body, gateway, quota, controller.signal),
          );
        } finally {
          res.off("close", abort);
        }
      }
      if (method === "POST" && url.pathname === "/api/personalize") {
        rate("scenario:" + peer, 20);
        const body = await readJson(req, 2_100_000);
        try {
          return json(
            res,
            200,
            personalize(
              parseResultFile(JSON.stringify(body.result)),
              cleanJourney(body.preferences),
            ),
          );
        } catch (e) {
          throw new ServiceError((e as Error).message, 400);
        }
      }
      if (method === "GET" && url.pathname === "/api/quota")
        return json(res, 200, await quota.snapshot());
      if (method === "GET" && url.pathname.startsWith("/api/map-sdk/")) {
        const origin =
          req.headers.origin ??
          (req.headers.referer
            ? new URL(req.headers.referer).origin
            : `http://${req.headers.host}`);
        if (!allowedOrigins.has(origin))
          throw new ServiceError("地图请求来源不受支持。", 403);
        return await proxyMap(req, res, url, origin);
      }
      if (
        method === "POST" &&
        ["/api/verification/preview", "/api/verification"].includes(
          url.pathname,
        )
      ) {
        rate("verification:" + owner + ":" + peer, 30);
        const body = await readJson(req, 2_100_000);
        let result: ReturnType<typeof parseResultFile>;
        let plan: ReturnType<typeof verificationPlan>;
        try {
          result = parseResultFile(JSON.stringify(body.result));
          plan = verificationPlan(
            result,
            body.category as any,
            body.minutes as number,
            body.taskIds as string[],
            gateway.maxSearchPages,
          );
        } catch (error) {
          throw new ServiceError((error as Error).message, 400);
        }
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(result))
          .digest("hex");
        if (url.pathname.endsWith("/preview"))
          return json(res, 200, { fingerprint, plan });
        if (
          body.confirmed !== true ||
          body.fingerprint !== fingerprint ||
          typeof body.requestId !== "string" ||
          !/^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId)
        )
          throw new ServiceError(
            "请先预览当前报告的补查用量，再明确确认。",
            400,
          );
        const requestFingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              fingerprint,
              category: plan.category,
              minutes: plan.minutes,
              ids: plan.tasks.map((t) => t.id),
            }),
          )
          .digest("hex");
        const previous = [...jobs.values()].find(
          (v) => v.owner === owner && v.verificationKey === body.requestId,
        );
        if (previous) {
          if (previous.verificationFingerprint !== requestFingerprint)
            throw new ServiceError(
              "同一补查编号对应的内容已变化，请重新预览。",
              409,
            );
          return json(res, 202, { id: previous.job.id });
        }
        if (result.mode === "baidu") {
          if (!config.baiduConfigured)
            throw new ServiceError("尚未配置百度服务，原报告可继续查看。", 503);
          const budget = await quota.snapshot();
          if (
            budget.limits.route - budget.used.route < plan.maxRouteUnits ||
            budget.limits.search - budget.used.search < plan.maxSearchUnits
          )
            throw new ServiceError(
              "本地剩余预算不足以预留本次补查及一次重试，原报告已保留。",
              429,
            );
        }
        const raced = [...jobs.values()].find(
          (v) => v.owner === owner && v.verificationKey === body.requestId,
        );
        if (raced) {
          if (raced.verificationFingerprint !== requestFingerprint)
            throw new ServiceError(
              "同一补查编号对应的内容已变化，请重新预览。",
              409,
            );
          return json(res, 202, { id: raced.job.id });
        }
        if (
          [...jobs.values()].filter((v) => v.job.status === "running").length >=
            2 ||
          (result.mode === "baidu" &&
            [...jobs.values()].some(
              (v) => v.mode === "baidu" && v.job.status === "running",
            ))
        )
          throw new ServiceError(
            "已有地图任务正在进行，请完成或取消后再补查。",
            429,
          );
        while (jobs.size >= 8) {
          const old = [...jobs].find(([, v]) => v.job.status !== "running");
          if (!old) break;
          jobs.delete(old[0]);
        }
        const job: Job = {
          id: randomUUID(),
          status: "running",
          progress: {
            stage: "准备定向补查",
            done: 0,
            total: plan.tasks.length,
          },
        };
        const controller = new AbortController();
        jobs.set(job.id, {
          job,
          mode: result.mode,
          owner,
          controller,
          expires: Date.now() + 10 * 60_000,
          verificationKey: body.requestId,
          verificationFingerprint: requestFingerprint,
        });
        const provider =
          result.mode === "demo"
            ? new DemoProvider()
            : new BaiduProvider(gateway, result.center.geo!);
        void executeVerification(
          result,
          plan,
          provider,
          { id: randomUUID() },
          controller.signal,
          (done, total) => {
            job.progress = { stage: "补查所选任务", done, total };
          },
        )
          .then((updated) => {
            if (controller.signal.aborted) return;
            job.result = parseResultFile(JSON.stringify(updated));
            job.status = "done";
          })
          .catch((error) => {
            job.status = controller.signal.aborted ? "cancelled" : "error";
            job.error = controller.signal.aborted
              ? "本次补查已取消，原报告保留。"
              : error instanceof ServiceError
                ? error.message
                : "补查未能完成，原报告保留；请核对后重试。";
          });
        return json(res, 202, { id: job.id });
      }
      if (method === "POST" && url.pathname === "/api/analyses") {
        const input = validateInput(await readJson(req));
        if (input.mode === "baidu" && !config.baiduConfigured)
          throw new ServiceError(
            "尚未配置百度地图服务，请先使用模拟街区。",
            503,
          );
        if (input.mode === "baidu") {
          const budget = await quota.snapshot();
          if (
            budget.limits.route - budget.used.route < gateway.maxRoutePairs ||
            budget.limits.search - budget.used.search <
              6 * gateway.maxSearchPages
          )
            throw new ServiceError(
              "本地剩余预算不足以预留一次完整体检，请打开已保存结果，或核对额度后再调整。",
              429,
            );
        }
        if (
          [...jobs.values()].filter((v) => v.job.status === "running").length >=
            2 ||
          (input.mode === "baidu" &&
            [...jobs.values()].some(
              (v) => v.mode === "baidu" && v.job.status === "running",
            ))
        )
          throw new ServiceError("已有体检正在进行，请完成或取消后再试。", 429);
        while (jobs.size >= 8) {
          const old = [...jobs].find(([, v]) => v.job.status !== "running");
          if (!old) break;
          jobs.delete(old[0]);
        }
        const job: Job = {
          id: randomUUID(),
          status: "running",
          progress: { stage: "准备体检", done: 0, total: 1 },
        };
        const controller = new AbortController();
        jobs.set(job.id, {
          job,
          mode: input.mode,
          owner,
          controller,
          expires: Date.now() + 10 * 60_000,
        });
        const center: Center =
          input.mode === "demo"
            ? { label: input.label || "自选中心", point: input.point! }
            : {
                label: input.label || "自选地图中心",
                point: [0, 0],
                geo: input.geo,
              };
        const provider: Provider =
          input.mode === "demo"
            ? new DemoProvider()
            : new BaiduProvider(gateway, input.geo!);
        void analyze(provider, center, {
          signal: controller.signal,
          onProgress: (value) => {
            job.progress = value;
          },
        })
          .then((result) => {
            if (controller.signal.aborted) return;
            job.status = "done";
            job.result = result;
          })
          .catch((error) => {
            job.status = controller.signal.aborted ? "cancelled" : "error";
            job.error =
              error instanceof ServiceError
                ? error.message
                : controller.signal.aborted
                  ? "本次体检已取消。"
                  : "本次体检未能完成，请重试或更换中心点。";
          });
        return json(res, 202, { id: job.id });
      }
      if (
        url.pathname.startsWith("/api/analyses/") &&
        (method === "GET" || method === "DELETE")
      ) {
        const item = jobs.get(url.pathname.slice("/api/analyses/".length));
        if (!item || item.owner !== owner)
          throw new ServiceError("这份体检已过期，请重新开始。", 404);
        if (method === "DELETE") {
          item.controller.abort();
          item.job.status = "cancelled";
          delete item.job.result;
        }
        return json(res, 200, item.job);
      }
      if (method === "POST" && url.pathname === "/api/geocode") {
        const body = await readJson(req);
        if (typeof body.address !== "string")
          throw new ServiceError("请输入社区名称或详细地址。", 400);
        return json(res, 200, await gateway.geocode(body.address));
      }
      if (method === "POST" && url.pathname === "/api/convert") {
        const body = await readJson(req);
        if (!validGeo(body.geo) || (body.from !== 1 && body.from !== 3))
          throw new ServiceError("坐标或坐标类型无效。", 400);
        return json(res, 200, {
          geo: await gateway.convert(body.geo, body.from),
        });
      }
      if (url.pathname.startsWith("/api/"))
        throw new ServiceError("接口不存在。", 404);
      if (method !== "GET" && method !== "HEAD")
        throw new ServiceError("不支持此请求方式。", 405);
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const target = resolve(clientRoot, relative);
      if (
        !target.startsWith(clientRoot + sep) ||
        relative.split(/[\\/]/).some((p) => p.startsWith("."))
      )
        throw new ServiceError("文件不存在。", 404);
      const info = await stat(target).catch(() => null);
      if (!info?.isFile())
        throw new ServiceError(
          "页面不存在。请先构建项目，或访问开发服务地址。",
          404,
        );
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "content-type": mime[extname(target)] ?? "application/octet-stream",
        "cache-control": relative.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      if (method === "HEAD") return res.end();
      createReadStream(target).pipe(res);
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          error instanceof ServiceError
            ? error.code
            : error instanceof QuotaError
              ? 503
              : 500,
          {
            error:
              error instanceof ServiceError || error instanceof QuotaError
                ? error.message
                : "服务暂时不可用，请稍后重试。",
          },
        );
      else res.end();
    }
  });
  server.on("close", () => {
    ai.close();
    life.close();
    clearInterval(cleanup);
    for (const item of jobs.values()) item.controller.abort();
  });
  return server;
}
