import { completeCategories, emptyUsage, type Facility, type Provider, type Travel, type XY, type Category } from '../shared/types.js';
import { distance, pointKey } from './geo.js';

export const DEMO_CENTERS = [
  { label: '里巷中心', point: [-400, 0] as XY },
  { label: '河畔住区', point: [800, 200] as XY },
  { label: '站前街口', point: [-200, -800] as XY },
];
export const DEMO_EXTENT = 2400;
export const DEMO_STEP = 200;
export interface Road { a: XY; b: XY }
export function demoRoads(): Road[] {
  const roads: Road[] = [];
  for (let x = -DEMO_EXTENT; x <= DEMO_EXTENT; x += DEMO_STEP) {
    for (let y = -DEMO_EXTENT; y <= DEMO_EXTENT; y += DEMO_STEP) {
      if (x < DEMO_EXTENT && (x !== 400 || y === -600 || y === 800)) roads.push({ a: [x, y], b: [x + DEMO_STEP, y] });
      if (y < DEMO_EXTENT) roads.push({ a: [x, y], b: [x, y + DEMO_STEP] });
    }
  }
  return roads;
}
const rows: [Category, string, number, number][] = [
  ['market', '巷口菜场', -600, -200], ['market', '晨光市集', -1400, 800], ['market', '东岸菜场', 1800, 0],
  ['pharmacy', '四季药房', -200, 200], ['pharmacy', '安康药店', -800, -600], ['pharmacy', '桥畔药房', 600, -600], ['pharmacy', '东街药店', 1800, 1000],
  ['school', '榕树小学', -800, 600], ['school', '东岸小学', 1800, -1200],
  ['medical', '里巷卫生站', -400, 200], ['medical', '南街卫生中心', -200, -1000], ['medical', '东岸卫生站', 1200, 400],
  ['park', '口袋花园', -600, 400], ['park', '河西小园', 200, 600], ['park', '南街绿地', -600, -800], ['park', '东岸花园', 800, -400],
  ['elder', '邻里长者食堂', -400, -400], ['elder', '日间照料站', -1000, 0], ['elder', '东岸养老驿站', 1000, 800],
];
export const demoFacilities = (): Facility[] => rows.map(([category, name, x, y], i) => ({
  id: `demo-${i}`, uid: `demo-${i}`, category, name, point: [x, y], address: '模拟街区 · 人工构造设施',
}));

export class DemoProvider implements Provider {
  mode = 'demo' as const;
  usage = emptyUsage();
  private graph = new Map<string, { point: XY; neighbors: string[] }>();
  private routes = new Map<string, Map<string, number>>();
  constructor() {
    for (const { a, b } of demoRoads()) {
      for (const [start, end] of [[a, b], [b, a]]) {
        const key = pointKey(start);
        if (!this.graph.has(key)) this.graph.set(key, { point: start, neighbors: [] });
        this.graph.get(key)!.neighbors.push(pointKey(end));
      }
    }
  }
  async search(center: XY, radius: number) {
    return { facilities: demoFacilities().filter(p => distance(p.point, center) <= radius), complete: completeCategories(true), warnings: [], radiusMeters: radius };
  }
  private snap(p: XY): XY {
    return [Math.max(-2400, Math.min(2400, Math.round(p[0] / 200) * 200)), Math.max(-2400, Math.min(2400, Math.round(p[1] / 200) * 200))];
  }
  async route(origin: XY, destinations: XY[], signal?: AbortSignal): Promise<Travel[]> {
    signal?.throwIfAborted();
    const start = this.snap(origin);
    const startKey = pointKey(start);
    let costs = this.routes.get(startKey);
    if (!costs) {
      costs = new Map([[startKey, 0]]);
      const unvisited = new Set(this.graph.keys());
      while (unvisited.size) {
        let current: string | undefined;
        let best = Infinity;
        for (const key of unvisited) { const d = costs.get(key) ?? Infinity; if (d < best) { best = d; current = key; } }
        if (!current) break;
        unvisited.delete(current);
        for (const neighbor of this.graph.get(current)!.neighbors) {
          if (best + DEMO_STEP < (costs.get(neighbor) ?? Infinity)) costs.set(neighbor, best + DEMO_STEP);
        }
      }
      this.routes.set(startKey, costs);
    }
    return destinations.map(destination => {
      const end = this.snap(destination);
      const meters = (costs.get(pointKey(end)) ?? Infinity) + distance(origin, start) + distance(destination, end);
      return Number.isFinite(meters) ? { status: 'ok', seconds: meters / 1.2, meters } : { status: 'unreachable', reason: '模拟道路不连通' };
    });
  }
}
