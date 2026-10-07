import { DemoProvider } from "../core/demo.js";
import { toGeo } from "../core/geo.js";
import { usableFacility } from "../shared/facility-review.js";
import type { AnalysisResult, Category, Travel } from "../shared/types.js";
import type { LifeBook } from "../shared/life.js";
import {
  todayLocal,
  cleanNode,
  type OutingNode,
  type RouteBundle,
  type RouteEdge,
  type RestPoint,
  type ErrandTask,
  type Itinerary,
} from "../shared/outings.js";
export * from "../shared/outings.js";
export const taskOptions = [
  { id: "market", label: "买菜", stay: 5 },
  { id: "pharmacy", label: "取药", stay: 3 },
  { id: "park", label: "逛公园", stay: 10 },
  { id: "personal", label: "去常去的小店", stay: 5 },
];
export interface OutingScene {
  origin: OutingNode;
  facilities: (OutingNode & { category: string })[];
  samples: OutingNode[];
  rests: RestPoint[];
  proposed: OutingNode[];
  mode: "demo" | "baidu";
  label: string;
  date: string;
}
const node = (id: string, name: string, x: number, y: number): OutingNode => ({
  id,
  name,
  position: { system: "demo", x, y },
});
export function demoScene(): OutingScene {
  return {
    origin: node("home", "里巷中心", -400, 0),
    facilities: [
      { ...node("market-a", "巷口菜场", -600, -200), category: "market" },
      { ...node("market-b", "晨光市集", -1400, 800), category: "market" },
      { ...node("pharmacy-a", "四季药房", -200, 200), category: "pharmacy" },
      { ...node("pharmacy-b", "安康药店", -800, -600), category: "pharmacy" },
      { ...node("park-a", "口袋花园", -600, 400), category: "park" },
    ],
    samples: [
      [-1400, 0],
      [-1400, 200],
      [-1200, 0],
      [-1000, 0],
      [-1200, 400],
      [-800, 0],
    ].map(([x, y], i) => node(`sample-${i}`, `测试点${i + 1}`, x, y)),
    rests: [
      {
        ...node("bench-a", "社区门廊座椅", -400, 200),
        checkedOn: todayLocal(),
        validUntil: todayLocal(),
        note: "人工构造的休息点",
      },
      {
        ...node("bench-b", "花园外长椅", -600, 200),
        checkedOn: todayLocal(),
        validUntil: todayLocal(),
        note: "人工构造的休息点",
      },
    ],
    proposed: [node("new-site", "拟新增便民药店", -1200, 200)],
    mode: "demo",
    label: "里巷中心 · 人工构造街区",
    date: "示例数据",
  };
}
export function sceneFromReport(
  result: AnalysisResult | null,
  book: LifeBook,
): OutingScene {
  if (!result || result.mode === "demo") return demoScene();
  if (!result.center.geo)
    throw new Error("报告缺少真实中心位置，请重新打开有效报告。");
  const position = (point: [number, number]) => ({
    system: "bd09" as const,
    ...toGeo(point, result.center.geo!),
  });
  const known = result.samples.filter((s) => s.travel.status === "ok");
  const samples = Array.from({ length: Math.min(6, known.length) }, (_, i) => {
    const p = known[Math.floor((i * known.length) / Math.min(6, known.length))];
    return {
      id: `sample-${i}`,
      name: `测试点${i + 1}`,
      position: position(p.point),
    };
  });
  const personal = book.places
    .filter((p) => p.position.system !== "demo")
    .map((p) => ({ ...cleanNode(p), id: `p-${p.id}` }));
  return {
    origin: {
      id: "home",
      name: result.center.label,
      position: { system: "bd09", ...result.center.geo },
    },
    facilities: [
      ...result.facilities.filter(usableFacility).map((f) => ({
        id: `f-${f.id}`,
        name: f.name,
        position: f.geo
          ? { system: "bd09" as const, ...f.geo }
          : position(f.point),
        category: f.category,
      })),
      ...personal.map((p) => ({ ...p, category: "personal" })),
    ],
    samples,
    rests: (book.restPoints ?? []).filter((p) => p.position.system !== "demo"),
    proposed: personal,
    mode: "baidu",
    label: result.center.label,
    date: result.generatedAt,
  };
}
export function errandSelection(
  scene: OutingScene,
  categories: string[],
  stays: Record<string, number>,
) {
  if (!categories.length || categories.length > 3)
    throw new Error("请选择1—3件事。");
  const nodes: OutingNode[] = [scene.origin],
    tasks: ErrandTask[] = [];
  categories.forEach((id, index) => {
    const option = taskOptions.find((o) => o.id === id);
    if (!option) throw new Error("办事类型无效。");
    const candidates = scene.facilities
      .filter((f) => f.category === id)
      .slice(0, categories.length === 3 && index === 2 ? 1 : 2);
    if (!candidates.length)
      throw new Error(
        `当前结果里没有${option.label}的候选地点，请更换任务或先记录地点。`,
      );
    nodes.push(...candidates);
    tasks.push({
      id,
      label: option.label,
      candidates: candidates.map((c) => c.id),
      stayMinutes: stays[id] ?? option.stay,
    });
  });
  return { nodes, tasks };
}
export const minutesText = (v: number | null) =>
  v === null ? "待确认" : `${Math.round(v * 10) / 10}分钟`;
export function itineraryText(plan: Itinerary) {
  return {
    summary: `完成${plan.completed.length}件事 · ${minutesText(plan.totalMinutes)} · ${plan.finish}回到出发点`,
    detail: `步行${minutesText(plan.walkingMinutes)}，停留${minutesText(plan.stayMinutes)}，等待${minutesText(plan.waitingMinutes)}。`,
    rows: plan.visits.map(
      (v) =>
        `${v.arrival} ${v.name} · 本段走${minutesText(v.walkMinutes)}${v.stayMinutes ? `，停留${minutesText(v.stayMinutes)}` : ""}`,
    ),
    notes: [
      ...(plan.skipped.length
        ? [`本方案暂未安排：${plan.skipped.join("、")}`]
        : []),
      ...(plan.unknownOpening.length
        ? [`营业时间未确认：${[...new Set(plan.unknownOpening)].join("、")}`]
        : []),
    ],
  };
}
export const familiarText = (r: {
  name: string;
  checkedOn: string;
  steps: { title: string; instruction: string }[];
}) =>
  `${r.name}\n走访日期：${r.checkedOn}\n${r.steps.map((s, i) => `${i + 1}. ${s.title}：${s.instruction}`).join("\n")}\n这是家人记录的熟路，请以现场道路和过街指示为准。`;
type CachedEdge = { key: string; travel: Travel; at: string };
export class OutingRouteCache {
  private entries: CachedEdge[] = [];
  constructor(value: unknown = []) {
    if (Array.isArray(value))
      this.entries = value
        .filter(
          (e): e is CachedEdge =>
            !!e &&
            typeof e.key === "string" &&
            e.key.length < 1000 &&
            typeof e.at === "string" &&
            Number.isFinite(Date.parse(e.at)) &&
            !!e.travel &&
            ((e.travel.status === "ok" &&
              Number.isFinite(e.travel.meters) &&
              e.travel.meters >= 0 &&
              e.travel.meters <= 100000 &&
              Number.isFinite(e.travel.seconds) &&
              e.travel.seconds >= 0) ||
              (["unknown", "unreachable"].includes(e.travel.status) &&
                typeof e.travel.reason === "string")),
        )
        .slice(-256);
  }
  private key(a: OutingNode, b: OutingNode) {
    return JSON.stringify([a.position, b.position]);
  }
  private find(a: OutingNode, b: OutingNode) {
    return this.entries.find(
      (e) =>
        e.key === this.key(a, b) &&
        Date.now() - Date.parse(e.at) >= 0 &&
        Date.now() - Date.parse(e.at) < 24 * 3600_000 &&
        e.travel.status === "ok",
    );
  }
  snapshot() {
    return this.entries.slice(-256);
  }
  pending(nodes: OutingNode[], pairs: [string, string][]) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return pairs.filter(([a, b]) => !this.find(byId.get(a)!, byId.get(b)!));
  }
  async obtain(
    nodes: OutingNode[],
    pairs: [string, string][],
    read: (body: unknown) => Promise<RouteBundle>,
    progress: (done: number, total: number) => void,
    cancelled: () => boolean = () => false,
  ) {
    if (
      nodes.length < 2 ||
      nodes.length > 12 ||
      pairs.length > 32 ||
      new Set(nodes.map((n) => n.id)).size !== nodes.length
    )
      throw new Error("地点过多，请减少候选地点后重试。");
    nodes.forEach(cleanNode);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    if (pairs.some(([a, b]) => !byId.has(a) || !byId.has(b) || a === b))
      throw new Error("路线起终点无效。");
    const mode = nodes[0].position.system === "demo" ? "demo" : "baidu";
    if (nodes.some((n) => (n.position.system === "demo") !== (mode === "demo")))
      throw new Error("不能混用真实地点和模拟地点。");
    const pending = this.pending(nodes, pairs),
      provider = mode === "demo" ? new DemoProvider() : null;
    const unknown = new Map<string, Travel>();
    progress(0, pending.length);
    for (let start = 0; start < pending.length; start += 6) {
      if (cancelled()) throw new Error("已停止计算，已读取的路线仍保留。");
      const chunk = pending.slice(start, start + 6);
      let edges: RouteEdge[];
      if (provider) {
        edges = [];
        for (const [from, to] of chunk) {
          const a = byId.get(from)!.position,
            b = byId.get(to)!.position;
          if (a.system !== "demo" || b.system !== "demo")
            throw new Error("示例位置无效。");
          const [travel] = await provider.route([a.x, a.y], [[b.x, b.y]]);
          edges.push({ from, to, travel });
        }
      } else edges = (await read({ nodes, pairs: chunk })).edges;
      for (const [from, to] of chunk) {
        const travel = edges.find((e) => e.from === from && e.to === to)
          ?.travel ?? { status: "unknown" as const, reason: "路线结果缺失" };
        const key = this.key(byId.get(from)!, byId.get(to)!);
        if (travel.status === "ok")
          this.entries = [
            ...this.entries.filter((e) => e.key !== key),
            { key, travel, at: new Date().toISOString() },
          ].slice(-256);
        else unknown.set(`${from}>${to}`, travel);
      }
      progress(Math.min(start + 6, pending.length), pending.length);
    }
    if (cancelled()) throw new Error("已停止计算，已读取的路线仍保留。");
    return {
      nodes,
      mode,
      generatedAt: new Date().toISOString(),
      edges: pairs.map(([from, to]) => ({
        from,
        to,
        travel: this.find(byId.get(from)!, byId.get(to)!)?.travel ??
          unknown.get(`${from}>${to}`) ?? {
            status: "unknown",
            reason: "路线未读取",
          },
      })),
    } as RouteBundle;
  }
}
