import {
  cleanRouteRequest,
  type RouteBundle,
  type OutingNode,
} from "../shared/outings.js";
import { emptyUsage, type LngLat } from "../shared/types.js";
import { DemoProvider } from "../core/demo.js";
import { BaiduGateway, parseTravel, ServiceError } from "./baidu.js";
import type { QuotaLedger } from "./quota.js";

export async function readOutingRoutes(
  body: unknown,
  gateway: BaiduGateway,
  quota: QuotaLedger,
  signal: AbortSignal,
): Promise<RouteBundle> {
  let input: ReturnType<typeof cleanRouteRequest>;
  try {
    input = cleanRouteRequest(body);
  } catch (e) {
    throw new ServiceError((e as Error).message, 400);
  }
  const { nodes, pairs } = input,
    demo = nodes[0].position.system === "demo",
    usage = emptyUsage();
  const edges: RouteBundle["edges"] = [],
    byId = new Map(nodes.map((n) => [n.id, n]));
  if (demo) {
    const provider = new DemoProvider();
    for (const [from, to] of pairs) {
      const a = byId.get(from)!.position,
        b = byId.get(to)!.position;
      if (a.system !== "demo" || b.system !== "demo")
        throw new Error("Invalid demo coordinates");
      const [travel] = await provider.route([a.x, a.y], [[b.x, b.y]], signal);
      edges.push({ from, to, travel });
    }
  } else {
    const budget = await quota.snapshot(),
      conversions = nodes.filter((n) => n.position.system !== "bd09").length;
    if (
      budget.limits.route - budget.used.route < pairs.length * 2 ||
      budget.limits.other - budget.used.other < conversions * 2
    )
      throw new ServiceError(
        "剩余预算不足以完成这些路段（含一次重试余量），请使用已保存路线。",
        429,
      );
    const coordinates = new Map<string, LngLat>();
    for (const n of nodes) {
      const p = n.position;
      if (p.system === "demo")
        throw new Error("Invalid geographic coordinates");
      coordinates.set(
        n.id,
        p.system === "bd09"
          ? { lng: p.lng, lat: p.lat }
          : await gateway.convert(p, p.system === "wgs84" ? 1 : 3, signal),
      );
    }
    for (const [from, to] of pairs) {
      signal.throwIfAborted();
      const a = coordinates.get(from)!,
        b = coordinates.get(to)!;
      const same =
        Math.abs(a.lng - b.lng) < 1e-8 && Math.abs(a.lat - b.lat) < 1e-8;
      if (same) {
        edges.push({ from, to, travel: parseTravel(undefined, true) });
        continue;
      }
      const reply = await gateway.call(
        "/routematrix/v2/walking",
        {
          origins: `${a.lat},${a.lng}`,
          destinations: `${b.lat},${b.lng}`,
          coord_type: "bd09ll",
        },
        usage,
        "route",
        1,
        signal,
      );
      edges.push({
        from,
        to,
        travel: parseTravel(
          Array.isArray(reply.result) ? reply.result[0] : undefined,
        ),
      });
    }
  }
  return {
    nodes,
    edges,
    usage,
    mode: demo ? "demo" : "baidu",
    generatedAt: new Date().toISOString(),
  };
}
