import { distance, midpoint, pointKey } from "./geo.js";
import type { Sample, Triangle, XY } from "../shared/types.js";

export const MESH_VERSION = "shared-edge-two-pass-v2";

export function gridPoints(center: XY, radius: number, step: number): XY[] {
  const points: XY[] = [];
  for (let x = -radius; x <= radius; x += step)
    for (let y = -radius; y <= radius; y += step)
      points.push([center[0] + x, center[1] + y]);
  return points;
}

export function gridTriangles(
  center: XY,
  radius: number,
  step: number,
  samples: Map<string, Sample>,
): Triangle[] {
  const get = (x: number, y: number) => {
    const sample = samples.get(pointKey([center[0] + x, center[1] + y]));
    if (!sample) throw new Error("规则网格缺少测时结果。");
    return sample;
  };
  const triangles: Triangle[] = [];
  for (let x = -radius; x < radius; x += step)
    for (let y = -radius; y < radius; y += step) {
      const a = get(x, y),
        b = get(x + step, y);
      const c = get(x + step, y + step),
        d = get(x, y + step);
      triangles.push([a, b, c], [a, c, d]);
    }
  return triangles;
}

// Rank whole threshold-crossing faces, but budget unique edge midpoints.
// The second pass spends its remaining budget on the 5-minute boundary only.
export function refinementCandidates(
  triangles: Triangle[],
  center: XY,
  thresholds: number[],
): XY[] {
  const candidates = triangles
    .flatMap((triangle) => {
      if (triangle.some((s) => s.travel.status !== "ok")) return [];
      const times = triangle.map((s) =>
        s.travel.status === "ok" ? s.travel.seconds : 0,
      );
      const threshold = thresholds.findIndex(
        (t) => Math.min(...times) < t && Math.max(...times) > t,
      );
      if (threshold < 0) return [];
      const centroid: XY = [
        triangle.reduce((sum, s) => sum + s.point[0], 0) / 3,
        triangle.reduce((sum, s) => sum + s.point[1], 0) / 3,
      ];
      return [{ triangle, threshold, distance: distance(center, centroid) }];
    })
    .sort((a, b) => a.threshold - b.threshold || a.distance - b.distance);
  const points = new Map<string, XY>();
  for (const { triangle } of candidates)
    for (let i = 0; i < 3; i++) {
      const p = midpoint(triangle[i].point, triangle[(i + 1) % 3].point);
      points.set(pointKey(p), p);
    }
  return [...points.values()];
}

// Split both owners of each measured edge. Even a non-crossing neighbor uses
// the same midpoint, so a shared edge cannot have two different time fields.
export function splitSharedEdges(
  triangles: Triangle[],
  midpoints: Map<string, Sample>,
): Triangle[] {
  return triangles.flatMap((t): Triangle[] => {
    const mids = t.map((s, i) =>
      midpoints.get(pointKey(midpoint(s.point, t[(i + 1) % 3].point))),
    );
    const count = mids.filter(Boolean).length;
    if (!count) return [t];
    if (count === 3) {
      const [a, b, c] = t,
        [ab, bc, ca] = mids as Sample[];
      return [
        [a, ab, ca],
        [ab, b, bc],
        [ca, bc, c],
        [ab, bc, ca],
      ];
    }
    const index =
      count === 1
        ? mids.findIndex(Boolean)
        : mids.findIndex((m, i) => m && mids[(i + 1) % 3]);
    const [a, b, c] = [t[index], t[(index + 1) % 3], t[(index + 2) % 3]];
    const ab = mids[index]!;
    if (count === 1)
      return [
        [a, ab, c],
        [ab, b, c],
      ];
    const bc = mids[(index + 1) % 3]!;
    return [
      [b, bc, ab],
      [a, ab, c],
      [ab, bc, c],
    ];
  });
}

export async function adaptiveMesh(
  center: XY,
  radius: number,
  step: number,
  budget: number,
  measure: (points: XY[], stage: string) => Promise<Sample[]>,
) {
  const samples = new Map<string, Sample>();
  const query = async (points: XY[], stage: string) => {
    const measured = await measure(points, stage);
    if (measured.length !== points.length)
      throw new Error("测时结果数量不匹配。");
    measured.forEach((s, i) => {
      if (pointKey(s.point) !== pointKey(points[i]))
        throw new Error("测时点与结果不匹配。");
      samples.set(pointKey(s.point), s);
    });
  };
  await query(gridPoints(center, radius, step), "测量步行时间");
  let triangles = gridTriangles(center, radius, step, samples);
  let additions = 0,
    limited = false,
    passes = 0;
  for (let pass = 0; pass < 2; pass++) {
    const candidates = refinementCandidates(
      triangles,
      center,
      pass === 0 ? [300, 600, 900] : [300],
    ).filter((p) => !samples.has(pointKey(p)));
    const available =
      pass === 0 ? Math.floor((budget * 2) / 3) : budget - additions;
    const selected = candidates.slice(0, available);
    if (selected.length < candidates.length) limited = true;
    if (!selected.length) continue;
    await query(selected, pass === 0 ? "细化可达范围" : "复核5分钟边界");
    triangles = splitSharedEdges(
      triangles,
      new Map(selected.map((p) => [pointKey(p), samples.get(pointKey(p))!])),
    );
    additions += selected.length;
    passes = pass + 1;
  }
  return {
    triangles,
    samples: [...samples.values()],
    additions,
    limited,
    passes,
  };
}
