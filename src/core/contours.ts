import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Sample, Triangle, XY } from '../shared/types.js';

interface TimedPoint { point: XY; seconds: number }

export function clipTriangle(triangle: Triangle, seconds: number): XY[] {
  // Unknown and disconnected vertices are not assigned an invented travel time.
  if (triangle.some(v => v.travel.status !== 'ok')) return [];
  const vertices: TimedPoint[] = triangle.map(v => ({ point: v.point, seconds: v.travel.status === 'ok' ? v.travel.seconds : 0 }));
  const out: XY[] = [];
  for (let i = 0; i < 3; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % 3];
    const insideA = a.seconds <= seconds;
    const insideB = b.seconds <= seconds;
    if (insideA) out.push(a.point);
    if (insideA !== insideB) {
      const ratio = (seconds - a.seconds) / (b.seconds - a.seconds);
      out.push([a.point[0] + (b.point[0] - a.point[0]) * ratio, a.point[1] + (b.point[1] - a.point[1]) * ratio]);
    }
  }
  const distinct = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
  if (distinct.length < 3 || Math.abs(ringArea(distinct)) < 0.001) return [];
  return [...distinct, distinct[0]];
}

export function ringArea(ring: XY[]): number {
  return ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
}
export function polygonArea(polygons: MultiPolygon): number {
  return polygons.reduce((sum, polygon) => sum + Math.abs(ringArea(polygon[0])) - polygon.slice(1).reduce((holes, ring) => holes + Math.abs(ringArea(ring)), 0), 0);
}
export function contoursFromTriangles(triangles: Triangle[], seconds: number): MultiPolygon {
  const pieces = triangles.map(t => clipTriangle(t, seconds)).filter(ring => ring.length > 0);
  if (!pieces.length) return [];
  return polygonClipping.union([pieces[0]], ...pieces.slice(1).map(p => [p])) as MultiPolygon;
}
export function crossesThreshold(triangle: Triangle): boolean {
  const times = triangle.filter((v): v is Sample & { travel: { status: 'ok'; seconds: number; meters: number } } => v.travel.status === 'ok').map(v => v.travel.seconds);
  if (times.length !== 3) return false;
  return [300, 600, 900].some(t => Math.min(...times) < t && Math.max(...times) > t);
}
