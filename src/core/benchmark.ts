import { contoursFromTriangles } from "./contours.js";
import { distance, pointKey } from "./geo.js";
import type {
  AnalysisResult,
  MultiPolygon,
  Sample,
  Triangle,
  XY,
} from "../shared/types.js";

function inRing(point: XY, ring: XY[]): 0 | 1 | 2 {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    const cross =
      (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    if (
      Math.abs(cross) < 1e-7 &&
      point[0] >= Math.min(a[0], b[0]) &&
      point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) &&
      point[1] <= Math.max(a[1], b[1])
    )
      return 2;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside ? 1 : 0;
}
export function pointInPolygons(point: XY, polygons: MultiPolygon): boolean {
  return polygons.some(
    (p) =>
      inRing(point, p[0]) > 0 &&
      p.slice(1).every((hole) => inRing(point, hole) === 0),
  );
}
export const HOLDOUT_PROTOCOL = {
  radiiMeters: [250, 600, 1000],
  anglesDegrees: Array.from({ length: 8 }, (_, i) => 22.5 + i * 45),
  angleDefinition: "东为0度，逆时针；每个半径8点",
  circleSpeedMetersPerSecond: 1.2,
  minimumTrainingSeparationMeters: 10,
  maximumRoutePairs: 24,
};
export function holdoutPoints(result: AnalysisResult): XY[] {
  const training = [...result.samples, ...result.facilities].map(
    (p) => p.point,
  );
  const points = HOLDOUT_PROTOCOL.radiiMeters.flatMap((radius) =>
    HOLDOUT_PROTOCOL.anglesDegrees.map((angle) => {
      const rad = (angle * Math.PI) / 180;
      return [
        result.center.point[0] +
          Math.round(radius * Math.cos(rad) * 1000) / 1000,
        result.center.point[1] +
          Math.round(radius * Math.sin(rad) * 1000) / 1000,
      ] as XY;
    }),
  );
  if (
    points.some((p) =>
      training.some(
        (q) =>
          distance(p, q) < HOLDOUT_PROTOCOL.minimumTrainingSeparationMeters,
      ),
    )
  )
    throw new Error("预定义验证点接近已有测时点，不能作为独立留出验证。");
  return points;
}
export function coarseContours(result: AnalysisResult) {
  const { radiusMeters: radius, coarseStepMeters: step } = result.parameters;
  if (
    radius <= 0 ||
    step <= 0 ||
    (radius / step) % 1 !== 0 ||
    radius / step > 50
  )
    throw new Error("原结果不包含可复用的规则网格。");
  const samples = new Map(result.samples.map((s) => [pointKey(s.point), s]));
  const triangles: Triangle[] = [];
  const used = new Set<string>();
  const sample = (x: number, y: number) => {
    const key = pointKey([
      result.center.point[0] + x,
      result.center.point[1] + y,
    ]);
    const value = samples.get(key);
    if (!value) throw new Error("原结果缺少规则网格采样点。");
    used.add(key);
    return value;
  };
  for (let x = -radius; x < radius; x += step)
    for (let y = -radius; y < radius; y += step) {
      const a = sample(x, y),
        b = sample(x + step, y),
        c = sample(x + step, y + step),
        d = sample(x, y + step);
      triangles.push([a, b, c], [a, c, d]);
    }
  return {
    sampleCount: used.size,
    contours: ([5, 10, 15] as const).map((minutes) => ({
      minutes,
      polygons: contoursFromTriangles(triangles, minutes * 60),
    })),
  };
}
export function compareContours(result: AnalysisResult, validation: Sample[]) {
  const coarse = coarseContours(result);
  const known = validation.filter((s) => s.travel.status !== "unknown");
  const models = [
    {
      id: "circle",
      name: "直线圆（1.2米/秒）",
      samples: 0,
      contains: (p: XY, m: number) =>
        distance(result.center.point, p) <=
        m * 60 * HOLDOUT_PROTOCOL.circleSpeedMetersPerSecond,
    },
    {
      id: "coarse",
      name: `${result.parameters.coarseStepMeters}米规则网格`,
      samples: coarse.sampleCount,
      contains: (p: XY, m: number) =>
        pointInPolygons(
          p,
          coarse.contours.find((c) => c.minutes === m)!.polygons,
        ),
    },
    {
      id: "adaptive",
      name: "现有边界加密",
      samples: result.samples.length,
      contains: (p: XY, m: number) =>
        pointInPolygons(
          p,
          result.contours.find((c) => c.minutes === m)!.polygons,
        ),
    },
  ];
  return models.flatMap((model) =>
    [5, 10, 15].map((minutes) => {
      let trueReachable = 0,
        falseReachable = 0,
        missedReachable = 0,
        trueUnreachable = 0;
      for (const sample of known) {
        const actual =
          sample.travel.status === "ok" &&
          sample.travel.seconds <= minutes * 60;
        const predicted = model.contains(sample.point, minutes);
        if (actual && predicted) trueReachable++;
        else if (!actual && predicted) falseReachable++;
        else if (actual && !predicted) missedReachable++;
        else trueUnreachable++;
      }
      return {
        model: model.id,
        label: model.name,
        gridSamples: model.samples,
        minutes,
        evaluated: known.length,
        unknown: validation.length - known.length,
        trueReachable,
        falseReachable,
        missedReachable,
        trueUnreachable,
        agreement: known.length
          ? (trueReachable + trueUnreachable) / known.length
          : null,
      };
    }),
  );
}
