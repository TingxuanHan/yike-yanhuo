import { demoRoads } from "../core/demo.js";
import {
  cleanWalkingLeg,
  cleanWalkingGuide,
  cleanGuideCache,
  guideAge,
  guideKey,
  WALKING_GUIDES_KEY,
  type WalkingGuide,
  type WalkingLeg,
} from "../shared/walking-guide.js";

export interface GuideView {
  open: boolean;
  legs: WalkingLeg[];
  selected: number;
  guide: WalkingGuide | null;
  step: number;
  busy: boolean;
  error: string;
  status: string;
  age: string;
}
interface Deps {
  get: (k: string) => unknown;
  set: (k: string, v: unknown) => void;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  confirm: (s: string) => Promise<boolean>;
  notify: (s: GuideView) => void;
  now: () => number;
}
export class WalkingGuideSession {
  state: GuideView = {
    open: false,
    legs: [],
    selected: 0,
    guide: null,
    step: 0,
    busy: false,
    error: "",
    status: "",
    age: "",
  };
  private epoch = 0;
  private inFlight = false;
  constructor(private deps: Deps) {}
  private emit() {
    this.state.age = this.state.guide
      ? guideAge(this.state.guide, this.deps.now())
      : "";
    this.deps.notify({ ...this.state });
  }
  saved(legs: WalkingLeg[]) {
    const cache = cleanGuideCache(this.deps.get(WALKING_GUIDES_KEY));
    return legs
      .map((l) => cache.find((g) => guideKey(l) === guideKey(g)))
      .filter((g): g is WalkingGuide => !!g);
  }
  show(legs: WalkingLeg[]) {
    this.epoch++;
    this.state.legs = legs.map(cleanWalkingLeg);
    this.state.open = true;
    this.state.selected = 0;
    this.select(0);
  }
  select(index: number) {
    if (!Number.isInteger(index) || !this.state.legs[index]) return;
    this.epoch++;
    this.state.selected = index;
    this.state.step = 0;
    this.state.error = "";
    this.state.status = "";
    try {
      this.state.guide = this.saved([this.state.legs[index]])[0] ?? null;
    } catch {
      this.state.guide = null;
      this.state.error = "本机资料读取失败，可重新获取这一段。";
    }
    this.emit();
  }
  close() {
    this.epoch++;
    this.state.open = false;
    this.emit();
  }
  turn(delta: number) {
    const g = this.state.guide;
    if (g)
      this.state.step = Math.max(
        0,
        Math.min(g.steps.length - 1, this.state.step + delta),
      );
    this.emit();
  }
  async load() {
    const leg = this.state.legs[this.state.selected];
    if (!leg || !this.state.open || this.inFlight) return;
    const epoch = ++this.epoch;
    this.inFlight = true;
    this.state.busy = true;
    this.state.error = "";
    this.state.status = "";
    this.emit();
    const current = () => this.state.open && this.epoch === epoch;
    try {
      if (
        leg.from.position.system !== "demo" &&
        !(await this.deps.confirm(
          "获取这一段的百度步行步骤？仅发送这段起终点到服务端，坐标交由百度算路；约需1次步行请求，网络失败至多重试1次。不会读取实时位置。",
        ))
      )
        return;
      if (!current()) return;
      const guide = cleanWalkingGuide(
        leg.from.position.system === "demo"
          ? demoWalkingGuide(leg, this.deps.now())
          : await this.deps.request("/api/outings/walking-guide", "POST", leg),
      );
      if (!current()) return;
      if (guideKey(guide) !== guideKey(leg))
        throw new Error("返回步骤的起终点不匹配，未替换原资料。");
      const next = [
        guide,
        ...cleanGuideCache(this.deps.get(WALKING_GUIDES_KEY)).filter(
          (g) => guideKey(g) !== guideKey(leg),
        ),
      ].slice(0, 6);
      try {
        this.deps.set(WALKING_GUIDES_KEY, next);
        if (
          JSON.stringify(cleanGuideCache(this.deps.get(WALKING_GUIDES_KEY))) !==
          JSON.stringify(next)
        )
          throw new Error();
        this.state.status =
          "这一段已保存在本机，可离线查看。更新出门卡后才会收录进去。";
      } catch {
        this.state.status =
          "步骤已获取，但本机保存未完成。请保持页面打开，清理存储后再试。";
      }
      this.state.guide = guide;
      this.state.step = 0;
    } catch (e) {
      if (current()) this.state.error = (e as Error).message;
    } finally {
      this.inFlight = false;
      this.state.busy = false;
      this.emit();
    }
  }
}

// Follow the same synthetic road graph as the offline travel estimates.
export function demoWalkingGuide(raw: WalkingLeg, now: number): WalkingGuide {
  const leg = cleanWalkingLeg(raw),
    a = leg.from.position,
    b = leg.to.position;
  if (a.system !== "demo" || b.system !== "demo")
    throw new Error("不是模拟路段。");
  const key = (x: number, y: number) => `${x},${y}`;
  const graph = new Map<string, string[]>();
  for (const edge of demoRoads())
    for (const [p, q] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ]) {
      const k = key(...p);
      graph.set(k, [...(graph.get(k) ?? []), key(...q)]);
    }
  const start = key(a.x, a.y),
    end = key(b.x, b.y);
  if (!graph.has(start) || !graph.has(end))
    throw new Error("此模拟地点不在道路节点上，暂不提供分段步骤。");
  const previous = new Map<string, string | null>([[start, null]]),
    queue = [start];
  for (let i = 0; i < queue.length && !previous.has(end); i++)
    for (const next of graph.get(queue[i]) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, queue[i]);
        queue.push(next);
      }
    }
  if (!previous.has(end)) throw new Error("此模拟路段没有连通道路。");
  const path = [end];
  while (path[0] !== start) path.unshift(previous.get(path[0])!);
  const runs: { dir: string; meters: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i - 1].split(",").map(Number),
      [u, v] = path[i].split(",").map(Number);
    const dir = u > x ? "东" : u < x ? "西" : v > y ? "北" : "南";
    if (runs.at(-1)?.dir === dir) runs[runs.length - 1].meters += 200;
    else runs.push({ dir, meters: 200 });
  }
  const meters = (path.length - 1) * 200;
  return cleanWalkingGuide({
    ...leg,
    version: 1,
    source: "demo",
    obtainedAt: now,
    meters,
    seconds: meters / 1.2,
    steps: runs.map((r) => ({
      instruction: `沿模拟道路向${r.dir}走${r.meters}米。`,
      meters: r.meters,
    })),
  });
}
