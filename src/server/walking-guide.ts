import {
  cleanWalkingLeg,
  cleanWalkingGuide,
  type WalkingGuide,
} from "../shared/walking-guide.js";
import { emptyUsage } from "../shared/types.js";
import { BaiduGateway, ServiceError } from "./baidu.js";
import type { QuotaLedger } from "./quota.js";

export async function readWalkingGuide(
  body: unknown,
  gateway: BaiduGateway,
  quota: QuotaLedger,
  signal: AbortSignal,
): Promise<WalkingGuide> {
  let leg: ReturnType<typeof cleanWalkingLeg>;
  try {
    leg = cleanWalkingLeg(body);
  } catch (e) {
    throw new ServiceError((e as Error).message, 400);
  }
  let a = leg.from.position,
    b = leg.to.position;
  if (a.system === "demo" || b.system === "demo")
    throw new ServiceError("模拟步骤请在本机查看。", 400);
  // Keep a single coordinate system for the provider. Matching systems need no conversion.
  const convert = a.system !== b.system;
  const conversions = convert
    ? [a, b].filter((p) => p.system !== "bd09").length
    : 0;
  const budget = await quota.snapshot();
  if (
    budget.limits.route - budget.used.route < 2 ||
    budget.limits.other - budget.used.other < conversions * 2
  )
    throw new ServiceError(
      "剩余预算不足以读取这一段（含一次重试余量），可继续查看已保存的步骤。",
      429,
    );
  if (convert) {
    if (a.system !== "bd09")
      a = {
        ...(await gateway.convert(a, a.system === "wgs84" ? 1 : 3, signal)),
        system: "bd09",
      };
    if (b.system !== "bd09")
      b = {
        ...(await gateway.convert(b, b.system === "wgs84" ? 1 : 3, signal)),
        system: "bd09",
      };
  }
  const reply = await gateway.call(
    "/directionlite/v1/walking",
    {
      origin: `${a.lat.toFixed(6)},${a.lng.toFixed(6)}`,
      destination: `${b.lat.toFixed(6)},${b.lng.toFixed(6)}`,
      coord_type: a.system === "bd09" ? "bd09ll" : a.system,
      ret_coordtype: "gcj02",
      steps_info: "1",
    },
    emptyUsage(),
    "route",
    1,
    signal,
  );
  try {
    const result = reply.result as {
      routes?: {
        distance: number;
        duration: number;
        steps?: {
          instruction: string;
          distance: number;
          path?: string;
          start_location?: { lng: number; lat: number };
        }[];
      }[];
    };
    const route = result?.routes?.[0];
    if (!route || !Array.isArray(route.steps)) throw new Error();
    const path = route.steps.flatMap((s) =>
      typeof s.path === "string"
        ? s.path
            .split(";")
            .filter(Boolean)
            .map((value) => {
              const [lng, lat] = value.split(",").map(Number);
              return { system: "gcj02", lng, lat };
            })
        : [],
    );
    // Older responses without geometry remain readable. Never invent a straight-line route.
    const usable =
      path.length >= 2 &&
      path.length <= 2000 &&
      path.every(
        (p) =>
          Number.isFinite(p.lng) &&
          Number.isFinite(p.lat) &&
          p.lng >= 73 &&
          p.lng <= 136 &&
          p.lat >= 3 &&
          p.lat <= 54,
      );
    return cleanWalkingGuide({
      ...leg,
      version: 1,
      source: "baidu",
      obtainedAt: Date.now(),
      meters: route.distance,
      seconds: route.duration,
      ...(usable ? { path } : {}),
      steps: route.steps.map((s) => ({
        meters: s.distance,
        instruction: plainInstruction(s.instruction),
        ...(s.start_location &&
        Number.isFinite(s.start_location.lng) &&
        Number.isFinite(s.start_location.lat)
          ? { position: { system: "gcj02", ...s.start_location } }
          : {}),
      })),
    });
  } catch {
    throw new ServiceError(
      "地图服务未返回完整步行步骤，原有行程和已保存步骤仍可查看。",
      502,
    );
  }
}
export function plainInstruction(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 4000)
    throw new Error("Invalid instruction");
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
