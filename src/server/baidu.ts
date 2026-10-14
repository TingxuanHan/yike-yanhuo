import { setTimeout as delay } from "node:timers/promises";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  CATEGORIES,
  completeCategories,
  emptyUsage,
  type Facility,
  type LngLat,
  type Provider,
  type SearchResult,
  type Travel,
  type Usage,
  type XY,
} from "../shared/types.js";
import { distance, pointKey, toGeo, toLocal, validGeo } from "../core/geo.js";
import { QuotaLedger } from "./quota.js";

export class ServiceError extends Error {
  constructor(
    message: string,
    public code = 502,
  ) {
    super(message);
  }
}
function upstreamError(status: unknown, path: string): ServiceError {
  const code = Number(status);
  const service =
    {
      "/geocoding/v3/": "地理编码",
      "/geoconv/v2/": "坐标转换",
      "/place/v3/around": "地点检索",
      "/routematrix/v2/walking": "批量算路（步行）",
      "/directionlite/v1/walking": "轻量路线规划（步行）",
    }[path] ?? "对应";
  const guidance: Record<number, string> = {
    3: "权限校验失败，请核对服务端应用类型和访问限制。",
    5: "AK 无效，请核对本地服务端配置。",
    203: "应用类型不匹配，请为服务端接口使用服务端类型的 AK。",
    210: "IP 校验失败，请核对服务端应用允许的出口 IP。",
    211: "签名校验失败，当前接入方式需要使用 IP 白名单校验。",
    220: "Referer 校验失败，请核对应用类型及域名限制。",
    240: `${service}服务权限校验未通过，请先核对本地服务端 AK 与控制台应用是否对应，再检查该应用的服务开关。`,
    4: "服务配额校验失败，已停止请求；请先核对控制台剩余额度。",
    301: "服务累计配额已用完，已停止请求；请先核对控制台额度。",
    302: "服务当日配额已用完，已停止请求；请等待额度恢复。",
    401: "服务并发超限，已停止请求；请降低调用频率后重试。",
    402: "服务并发超限，已停止请求；请降低调用频率后重试。",
  };
  const label = Number.isFinite(code) ? code : "未知";
  return new ServiceError(
    `百度服务错误（${label}）：${guidance[code] ?? "请核对 AK、服务权限及配额。"}`,
    [4, 301, 302, 401, 402].includes(code) ? 429 : 502,
  );
}
export interface BaiduOptions {
  ak: string;
  routeQps?: number;
  searchIntervalMs?: number;
  maxRoutePairs?: number;
  maxSearchPages?: number;
  dailyRouteLimit?: number;
  dailySearchLimit?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  ledger?: QuotaLedger;
  requestLogPath?: string;
}
type Reply = {
  status: number | string;
  result?: unknown;
  results?: unknown;
  total?: number;
};
export class BaiduGateway {
  readonly routeQps: number;
  readonly searchIntervalMs: number;
  readonly maxRoutePairs: number;
  readonly maxSearchPages: number;
  private fetcher: typeof fetch;
  private wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  private now: () => number;
  private next = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private blocked?: ServiceError;
  private ledger: QuotaLedger;
  private cache = new Map<string, { expires: number; value: Reply }>();
  constructor(private options: BaiduOptions) {
    this.routeQps = Math.max(1, Math.min(2, Math.floor(options.routeQps ?? 1)));
    this.searchIntervalMs = Math.max(2000, options.searchIntervalMs ?? 2000);
    this.maxRoutePairs = options.maxRoutePairs ?? 260;
    this.maxSearchPages = Math.max(1, Math.min(3, options.maxSearchPages ?? 1));
    this.fetcher = options.fetcher ?? fetch;
    this.wait =
      options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
    this.now = options.now ?? Date.now;
    this.ledger =
      options.ledger ??
      new QuotaLedger(
        {
          route: options.dailyRouteLimit ?? 500,
          search: options.dailySearchLimit ?? 12,
          other: 50,
          map: 500,
        },
        undefined,
        this.now,
      );
  }
  async call(
    path: string,
    params: Record<string, string>,
    usage: Usage,
    kind: "route" | "search" | "other",
    cost = 1,
    signal?: AbortSignal,
  ): Promise<Reply> {
    // Hold the queue through response parsing and retries, so slow responses
    // cannot overlap and overdue requests cannot catch up in a burst.
    const operation = this.queue.then(() =>
      this.callQueued(path, params, usage, kind, cost, signal),
    );
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async callQueued(
    path: string,
    params: Record<string, string>,
    usage: Usage,
    kind: "route" | "search" | "other",
    cost = 1,
    signal?: AbortSignal,
  ): Promise<Reply> {
    signal?.throwIfAborted();
    if (!this.options.ak)
      throw new ServiceError(
        "尚未配置百度地图服务端 AK，请先配置或使用模拟街区。",
        503,
      );
    const allowed = [
      "/place/v3/around",
      "/routematrix/v2/walking",
      "/directionlite/v1/walking",
      "/geocoding/v3/",
      "/geoconv/v2/",
    ];
    if (!allowed.includes(path))
      throw new ServiceError("不支持的地图服务", 400);
    const cacheKey = `${path}?${new URLSearchParams(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > this.now()) {
      usage.cacheHits++;
      return structuredClone(cached.value);
    }
    if (this.blocked) throw this.blocked;
    const url = new URL(path, "https://api.map.baidu.com");
    url.search = new URLSearchParams({
      ...params,
      output: "json",
      ak: this.options.ak,
    }).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      if (kind === "route" && usage.routePairs + cost > this.maxRoutePairs)
        throw new ServiceError(
          "步行测时已达到本次预算，请调整采样后重试。",
          429,
        );
      if (
        !Number.isInteger(cost) ||
        cost < 1 ||
        (kind === "route" && cost > this.routeQps)
      )
        throw new ServiceError(
          "单次请求超过当前安全调用频率，请拆分路线。",
          400,
        );
      const interval =
        kind === "search"
          ? this.searchIntervalMs
          : Math.ceil((cost / (kind === "route" ? this.routeQps : 1)) * 1000) +
            100;
      await this.wait(
        Math.max(0, (this.next.get(kind) ?? 0) - this.now()),
        signal,
      );
      signal?.throwIfAborted();
      try {
        await this.ledger.take(kind, cost);
      } catch (error) {
        throw new ServiceError(
          error instanceof Error ? error.message : "调用预算不可用。",
          429,
        );
      }
      usage.requests++;
      if (kind === "route") usage.routePairs += cost;
      if (kind === "search") usage.searchRequests++;
      const startedAt = this.now();
      this.next.set(kind, startedAt + interval);
      let httpStatus: number | undefined;
      let upstreamStatus: number | undefined;
      try {
        const timed = AbortSignal.timeout(this.options.timeoutMs ?? 12000);
        const response = await this.fetcher(url, {
          signal: signal ? AbortSignal.any([signal, timed]) : timed,
          redirect: "error",
        });
        httpStatus = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429) {
            this.blocked = new ServiceError(
              "地图服务触发限流（HTTP 429），已停止真实接口请求；请核对控制台后再重启服务。",
              429,
            );
            throw this.blocked;
          }
          if (attempt === 0 && response.status >= 500) {
            usage.retries++;
            await this.wait(800, signal);
            continue;
          }
          throw new ServiceError(
            `地图服务暂不可用（HTTP ${response.status}），请稍后重试。`,
          );
        }
        const text = await response.text();
        if (text.length > 2_000_000)
          throw new ServiceError("地图服务返回数据过大，请缩小查询范围。");
        const result = JSON.parse(text) as Reply;
        upstreamStatus = Number.isFinite(Number(result?.status))
          ? Number(result.status)
          : undefined;
        if (!result || upstreamStatus !== 0) {
          const error = upstreamError(result?.status, path);
          if (error.code === 429) this.blocked = error;
          throw error;
        }
        if (this.cache.size >= 128)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(cacheKey, {
          expires: this.now() + 120_000,
          value: result,
        });
        return structuredClone(result);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ServiceError) throw error;
        if (attempt === 0) {
          usage.retries++;
          await this.wait(800, signal);
          continue;
        }
        throw new ServiceError(
          "地图服务连接超时或响应无效，请检查网络后重试。",
        );
      } finally {
        if (this.options.requestLogPath) {
          try {
            await mkdir(dirname(this.options.requestLogPath), {
              recursive: true,
            });
            await appendFile(
              this.options.requestLogPath,
              JSON.stringify({
                startedAt: new Date(startedAt).toISOString(),
                service: kind,
                path,
                units: cost,
                httpStatus,
                upstreamStatus,
              }) + "\n",
            );
          } catch {
            this.blocked = new ServiceError(
              "调用时间记录无法写入，已停止真实接口请求。",
              503,
            );
            throw this.blocked;
          }
        }
      }
    }
    throw new ServiceError("地图服务未返回结果，请重试。");
  }
  async geocode(
    address: string,
    signal?: AbortSignal,
  ): Promise<{ geo: LngLat; precise: boolean; confidence: number | null }> {
    address = address.trim();
    if (address.length < 2 || Buffer.byteLength(address, "utf8") > 128)
      throw new ServiceError(
        "地址需至少2个字符，且不超过128字节（约42个汉字）；请精简到城市、道路和门牌号。",
        400,
      );
    const reply = await this.call(
      "/geocoding/v3/",
      { address, ret_coordtype: "bd09ll" },
      emptyUsage(),
      "other",
      1,
      signal,
    );
    const result = reply.result as {
      location?: LngLat;
      precise?: number;
      confidence?: number;
    };
    if (!validGeo(result?.location))
      throw new ServiceError(
        "没有找到这个地址，请补充城市、街道和门牌号。",
        404,
      );
    return {
      geo: result.location,
      precise: result.precise === 1,
      confidence: Number.isFinite(result.confidence)
        ? result.confidence!
        : null,
    };
  }
  async convert(
    point: LngLat,
    from: 1 | 3,
    signal?: AbortSignal,
  ): Promise<LngLat> {
    const reply = await this.call(
      "/geoconv/v2/",
      { coords: `${point.lng},${point.lat}`, model: from === 1 ? "2" : "1" },
      emptyUsage(),
      "other",
      1,
      signal,
    );
    const result = (reply.result as { x: number; y: number }[])?.[0];
    const output = { lng: result?.x, lat: result?.y };
    if (!validGeo(output))
      throw new ServiceError("坐标转换失败，请换一个位置。");
    return output;
  }
}

export function parseTravel(value: unknown, samePoint = false): Travel {
  if (samePoint) return { status: "ok", seconds: 0, meters: 0 };
  const r = value as
    | { duration?: { value?: number }; distance?: { value?: number } }
    | undefined;
  const seconds = r?.duration?.value;
  const meters = r?.distance?.value;
  if (
    typeof seconds !== "number" ||
    typeof meters !== "number" ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(meters) ||
    seconds <= 0 ||
    meters <= 0
  )
    return { status: "unknown", reason: "未返回有效步行路线" };
  return { status: "ok", seconds, meters };
}

export class BaiduProvider implements Provider {
  mode = "baidu" as const;
  usage = emptyUsage();
  private routes = new Map<string, Travel>();
  constructor(
    private gateway: BaiduGateway,
    private origin: LngLat,
  ) {}
  async search(
    center: XY,
    radius: number,
    signal?: AbortSignal,
  ): Promise<SearchResult> {
    const complete = completeCategories(false);
    const warnings: string[] = [];
    const facilities: Facility[] = [];
    const geo = toGeo(center, this.origin);
    for (const category of CATEGORIES) {
      let rawCount = 0;
      let invalidCount = 0;
      let total: number | undefined;
      for (let page = 0; page < this.gateway.maxSearchPages; page++) {
        const reply = await this.gateway.call(
          "/place/v3/around",
          {
            query: category.query,
            location: `${geo.lat},${geo.lng}`,
            radius: String(radius),
            radius_limit: "true",
            coord_type: "3",
            scope: "1",
            page_num: String(page),
            page_size: "10",
          },
          this.usage,
          "search",
          1,
          signal,
        );
        const results = Array.isArray(reply.results)
          ? (reply.results as {
              uid?: string;
              name?: string;
              location?: LngLat;
              address?: string;
            }[])
          : [];
        if (!Array.isArray(reply.results)) invalidCount++;
        total =
          typeof reply.total === "number" &&
          Number.isFinite(reply.total) &&
          reply.total >= 0
            ? reply.total
            : undefined;
        rawCount += results.length;
        for (const p of results) {
          if (!p.name || !validGeo(p.location)) {
            invalidCount++;
            continue;
          }
          const point = toLocal(p.location, this.origin);
          if (distance(center, point) > radius + 5) {
            invalidCount++;
            continue;
          }
          facilities.push({
            id: `${category.id}:${p.uid ?? `${p.name}:${pointKey(point)}`}`,
            uid: p.uid,
            name: p.name,
            category: category.id,
            point,
            geo: p.location,
            address: p.address ?? "",
          });
        }
        if (total !== undefined && rawCount >= total) break;
        if (results.length < 10) break;
      }
      complete[category.id] =
        total !== undefined &&
        total < 150 &&
        rawCount >= total &&
        invalidCount === 0;
      if (!complete[category.id])
        warnings.push(
          `${category.label}检索结果可能不完整，相关空白点仅标为待核查。`,
        );
    }
    warnings.push(
      "设施类别按检索关键词映射，是否营业、开放及实际入口仍需核验；检索完成不代表地图收录了所有设施。",
    );
    return { facilities, complete, warnings, radiusMeters: radius };
  }
  async route(
    origin: XY,
    destinations: XY[],
    signal?: AbortSignal,
  ): Promise<Travel[]> {
    const originGeo = toGeo(origin, this.origin);
    const routeKey = (p: XY) => `${pointKey(origin)}>${pointKey(p)}`;
    const distinct = [
      ...new Map(destinations.map((p) => [routeKey(p), p])).values(),
    ];
    const pending: XY[] = [];
    for (const p of distinct) {
      if (distance(p, origin) < 0.01)
        this.routes.set(routeKey(p), parseTravel(undefined, true));
      else if (!this.routes.has(routeKey(p))) pending.push(p);
    }
    const size = Math.min(50, this.gateway.routeQps);
    for (let i = 0; i < pending.length; i += size) {
      const batch = pending.slice(i, i + size);
      const coordinates = batch.map((p) => {
        const g = toGeo(p, this.origin);
        return `${g.lat},${g.lng}`;
      });
      const reply = await this.gateway.call(
        "/routematrix/v2/walking",
        {
          origins: `${originGeo.lat},${originGeo.lng}`,
          destinations: coordinates.join("|"),
          coord_type: "bd09ll",
        },
        this.usage,
        "route",
        batch.length,
        signal,
      );
      const result = Array.isArray(reply.result) ? reply.result : [];
      batch.forEach((p, j) =>
        this.routes.set(routeKey(p), parseTravel(result[j])),
      );
    }
    return destinations.map(
      (p) =>
        this.routes.get(routeKey(p)) ?? {
          status: "unknown",
          reason: "路线结果缺失",
        },
    );
  }
}
