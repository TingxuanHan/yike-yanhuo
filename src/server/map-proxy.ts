import type { IncomingMessage, ServerResponse } from "node:http";
import { ServiceError } from "./baidu.js";
import type { QuotaLedger } from "./quota.js";

// This proxy only serves map rendering resources. Charged analysis APIs have
// separate validated endpoints and are deliberately unavailable here.
export function allowedMapPath(path: string): boolean {
  return /^\/(api\/?|getscript\/?|getmodules\/?|mapconfig\/?|styles(?:\/.*)?|customimage(?:\/.*)?|tile(?:\/.*)?|tiles(?:\/.*)?|js\/.*|static\/.*|res\/webgl\/.*|genpng\/?|sty\/.*|images\/.*)$/.test(
    path,
  );
}
export function createMapProxy(
  browserAk: string,
  otherSecret: string,
  quota: QuotaLedger,
  fetcher: typeof fetch = fetch,
) {
  const cache = new Map<
    string,
    { body: Buffer; type: string; expires: number }
  >();
  const permissions = new Map<
    string,
    { expires: number; error?: ServiceError }
  >();
  const resource = async (
    url: URL,
    req: IncomingMessage,
    publicOrigin: string,
  ) => {
    await quota.take("map", 1);
    url.searchParams.set("ak", browserAk);
    let response: Response;
    try {
      response = await fetcher(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
        headers: {
          BMAP_PROXY_URL: publicOrigin + "/api/map-sdk",
          Referer: publicOrigin + "/",
          "user-agent": req.headers["user-agent"] ?? "YikeYanhuo/0.1",
        },
      });
    } catch {
      throw new ServiceError("地图底图连接失败，请稍后重试。");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServiceError("地图底图暂不可用，请检查应用配置。");
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 8_000_000)
      throw new ServiceError("地图资源超过大小限制。");
    // Refuse unexpected credential echoes, including from upstream error pages.
    for (const secret of [browserAk, otherSecret].filter(Boolean)) {
      if (
        body.includes(Buffer.from(secret)) ||
        body.includes(Buffer.from(encodeURIComponent(secret)))
      )
        throw new ServiceError("地图资源校验未通过，请检查代理配置。");
    }
    const type =
      response.headers.get("content-type") ?? "application/octet-stream";
    return { body, type };
  };
  const verify = async (req: IncomingMessage, publicOrigin: string) => {
    const cached = permissions.get(publicOrigin);
    if (cached && cached.expires > Date.now()) {
      if (cached.error) throw cached.error;
      return;
    }
    const url = new URL("https://api.map.baidu.com/");
    url.search = new URLSearchParams({
      qt: "verify",
      v: "4.0",
      type: "webgl",
      callback: "__yikeVerify",
    }).toString();
    const { body } = await resource(url, req, publicOrigin);
    let status: unknown;
    try {
      const raw = body.toString("utf8").trim();
      const payload = raw.startsWith("{")
        ? raw
        : raw.match(/__yikeVerify\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/)?.[1];
      const reply = JSON.parse(payload ?? "");
      status = reply.statuscode ?? reply.status;
    } catch {
      throw new ServiceError("地图权限响应异常，请稍后重试。", 502);
    }
    if (status === 0 || status === "0") {
      permissions.set(publicOrigin, { expires: Date.now() + 120_000 });
      return;
    }
    const code = Number.isFinite(Number(status)) ? Number(status) : "未知";
    const message =
      code === 240
        ? "地图底图服务未启用，请在浏览器端应用中开启 JavaScript API（240）。"
        : `地图应用校验未通过（${code}），请核对浏览器端类型、服务权限和 Referer 白名单。`;
    const error = new ServiceError(message, 503);
    permissions.set(publicOrigin, { expires: Date.now() + 120_000, error });
    throw error;
  };
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    requested: URL,
    publicOrigin: string,
  ) => {
    if (!browserAk)
      throw new ServiceError("地图底图尚未配置，请使用模拟街区。", 503);
    // SDK modules sometimes append an extra slash to serviceHost. Normalize it
    // before validation, and never interpret a path as a new upstream host.
    const path = requested.pathname
      .slice("/api/map-sdk".length)
      .replace(/^\/+/, "/");
    const verification =
      path === "/" && requested.searchParams.get("qt") === "verify";
    if (
      (!allowedMapPath(path) && !verification) ||
      requested.search.length > 5000
    )
      throw new ServiceError("地图资源不可用。", 404);
    const url = new URL("https://api.map.baidu.com");
    url.pathname = path;
    url.search = requested.search;
    url.searchParams.delete("ak");
    const key = `${publicOrigin}${path}${url.search}`;
    if (/^\/api\/?$/.test(path)) await verify(req, publicOrigin);
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      res.writeHead(200, {
        "content-type": cached.type,
        "cache-control": "private, max-age=120",
      });
      res.end(cached.body);
      return;
    }
    const { body, type } = await resource(url, req, publicOrigin);
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, { body, type, expires: Date.now() + 120_000 });
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "private, max-age=120",
    });
    res.end(body);
  };
}
