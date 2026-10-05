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
import { QuotaLedger } from "./quota.js";
import { createMapProxy } from "./map-proxy.js";

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
): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new ServiceError("请使用 JSON 请求。", 415);
  let size = 0;
  const buffers: Buffer[] = [];
  for await (const buffer of req) {
    size += buffer.length;
    if (size > 8192) throw new ServiceError("请求内容过长。", 413);
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
) {
  const browserAk = env.BAIDU_BROWSER_AK?.trim() ?? "";
  const serverAk = env.BAIDU_SERVER_AK?.trim() ?? "";
  const config: PublicConfig = {
    baiduConfigured: Boolean(serverAk),
    mapConfigured: Boolean(browserAk),
    version: "0.1.0",
  };
  const quota = new QuotaLedger(
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
    { job: Job; mode: string; controller: AbortController; expires: number }
  >();
  const clientRoot = resolve("dist/client");
  const clean = () => {
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
      if (method === "POST" && url.pathname === "/api/analyses") {
        const input = validateInput(await readJson(req));
        if (input.mode === "baidu" && !config.baiduConfigured)
          throw new ServiceError(
            "尚未配置百度地图服务，请先使用模拟街区。",
            503,
          );
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
        if (!item) throw new ServiceError("这份体检已过期，请重新开始。", 404);
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
        json(res, error instanceof ServiceError ? error.code : 500, {
          error:
            error instanceof ServiceError
              ? error.message
              : "服务暂时不可用，请稍后重试。",
        });
      else res.end();
    }
  });
  server.on("close", () => {
    clearInterval(cleanup);
    for (const item of jobs.values()) item.controller.abort();
  });
  return server;
}
