import { cleanNode, type OutingNode } from "./outings.js";
import type { PlacePosition } from "./life.js";

export interface WalkingLeg {
  from: OutingNode;
  to: OutingNode;
}
export interface WalkingGuide extends WalkingLeg {
  version: 1;
  source: "baidu" | "demo";
  obtainedAt: number;
  meters: number;
  seconds: number;
  steps: { instruction: string; meters: number; position?: PlacePosition }[];
  path?: PlacePosition[];
}
export const WALKING_GUIDES_KEY = "yike-walking-guides";
export const GUIDE_DAY = 24 * 60 * 60 * 1000;
export const guideKey = (leg: WalkingLeg) =>
  JSON.stringify([cleanNode(leg.from), cleanNode(leg.to)]);
export function cleanWalkingLeg(raw: unknown): WalkingLeg {
  const p = raw as WalkingLeg;
  const from = cleanNode(p?.from),
    to = cleanNode(p?.to);
  if (
    from.id === to.id ||
    JSON.stringify(from.position) === JSON.stringify(to.position) ||
    (from.position.system === "demo") !== (to.position.system === "demo")
  )
    throw new Error("请选择两个不同且属于同一场景的地点。");
  return { from, to };
}
export function cleanWalkingGuide(raw: unknown): WalkingGuide {
  const g = raw as WalkingGuide;
  const leg = cleanWalkingLeg(g);
  if (
    g.version !== 1 ||
    !["baidu", "demo"].includes(g.source) ||
    (g.source === "demo") !== (leg.from.position.system === "demo") ||
    !Number.isSafeInteger(g.obtainedAt) ||
    g.obtainedAt <= 0 ||
    g.obtainedAt > 8_640_000_000_000_000 ||
    !Number.isFinite(g.meters) ||
    g.meters <= 0 ||
    g.meters > 30000 ||
    !Number.isFinite(g.seconds) ||
    g.seconds <= 0 ||
    g.seconds > 86400 ||
    !Array.isArray(g.steps) ||
    !g.steps.length ||
    g.steps.length > 80
  )
    throw new Error("未获得完整可用的步行步骤，原有行程保留。");
  const position = (p: unknown) =>
    cleanNode({ id: "path", name: "路线点", position: p }).position;
  const validSystem = (p: PlacePosition) =>
    (p.system === "demo") === (g.source === "demo");
  const path = g.path?.map(position);
  if (
    path &&
    (path.length < 2 || path.length > 2000 || path.some((p) => !validSystem(p)))
  )
    throw new Error("步行路线坐标不完整。");
  return {
    ...leg,
    version: 1,
    source: g.source,
    obtainedAt: g.obtainedAt,
    meters: g.meters,
    seconds: g.seconds,
    ...(path ? { path } : {}),
    steps: g.steps.map((s) => {
      if (
        !s ||
        typeof s.instruction !== "string" ||
        !s.instruction.trim() ||
        s.instruction.length > 400 ||
        /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s.instruction) ||
        !Number.isFinite(s.meters) ||
        s.meters < 0 ||
        s.meters > 30000
      )
        throw new Error("步行步骤内容不完整，请稍后重新获取。");
      const p = s.position === undefined ? undefined : position(s.position);
      if (p && !validSystem(p)) throw new Error("步行路线坐标与场景不一致。");
      return {
        instruction: s.instruction.trim(),
        meters: s.meters,
        ...(p ? { position: p } : {}),
      };
    }),
  };
}
export function cleanGuideCache(raw: unknown): WalkingGuide[] {
  if (!Array.isArray(raw)) return [];
  const result: WalkingGuide[] = [];
  for (const item of raw.slice(0, 6)) {
    try {
      const g = cleanWalkingGuide(item);
      if (!result.some((x) => guideKey(x) === guideKey(g))) result.push(g);
    } catch {
      /* A damaged record must not hide other saved legs. */
    }
  }
  return result;
}
export function guideAge(g: WalkingGuide, now = Date.now()) {
  const age = now - g.obtainedAt;
  return `${g.source === "demo" ? "模拟步骤" : "百度步行步骤"} · ${new Date(g.obtainedAt).toLocaleString("zh-CN")}获取${age < 0 || age > GUIDE_DAY ? " · 已过24小时或时钟异常，请重新获取并核对" : " · 非实时路况"}`;
}
