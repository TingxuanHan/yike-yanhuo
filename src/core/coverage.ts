import polygonClipping from "polygon-clipping";
import { distance, pointKey } from "./geo.js";
import type { AnalysisResult, Gap, MultiPolygon, XY } from "../shared/types.js";

export const GAP_CATEGORIES = ["market", "pharmacy", "school"] as const;
export type GapCategory = (typeof GAP_CATEGORIES)[number];
export type CoverageStatus = "covered" | "missing" | "unknown";

export function coveragePoints(result: AnalysisResult, category: GapCategory) {
  const seen = new Set<string>();
  return result.samples
    .filter((sample) => {
      const key = pointKey(sample.point);
      if (
        seen.has(key) ||
        sample.travel.status !== "ok" ||
        sample.travel.seconds > 900
      )
        return false;
      seen.add(key);
      return true;
    })
    .map((sample) => {
      const near = result.facilities.some(
        (p) =>
          p.category === category &&
          distance(p.point, sample.point) <=
            result.parameters.gapDistanceMeters,
      );
      const searched =
        result.complete[category] &&
        distance(sample.point, result.center.point) +
          result.parameters.gapDistanceMeters <=
          result.parameters.searchRadiusMeters;
      const status: CoverageStatus = near
        ? "covered"
        : searched
          ? "missing"
          : "unknown";
      return { point: sample.point, status };
    });
}
export function coverageSummary(result: AnalysisResult) {
  return GAP_CATEGORIES.map((category) => {
    const points = coveragePoints(result, category);
    return {
      category,
      total: points.length,
      covered: points.filter((p) => p.status === "covered").length,
      missing: points.filter((p) => p.status === "missing").length,
      unknown: points.filter((p) => p.status === "unknown").length,
    };
  });
}
// Squares only highlight the vicinity of checked samples. Their area is not a
// coverage estimate: adaptive samples are irregularly distributed.
export function gapCells(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
): Record<Gap["status"], MultiPolygon> {
  const contour =
    result.contours.find((c) => c.minutes === minutes)?.polygons ?? [];
  const output: Record<Gap["status"], MultiPolygon> = {
    missing: [],
    unknown: [],
  };
  if (!contour.length) return output;
  const half =
    Math.min(
      result.parameters.coarseStepMeters,
      result.parameters.refinedStepMeters || result.parameters.coarseStepMeters,
    ) / 2;
  for (const status of ["missing", "unknown"] as const) {
    const squares = coveragePoints(result, category)
      .filter((p) => p.status === status)
      .map(({ point: [x, y] }): XY[][] => [
        [
          [x - half, y - half],
          [x + half, y - half],
          [x + half, y + half],
          [x - half, y + half],
          [x - half, y - half],
        ],
      ]);
    if (squares.length) {
      const joined = polygonClipping.union(squares[0], ...squares.slice(1));
      output[status] = polygonClipping.intersection(
        joined,
        contour,
      ) as MultiPolygon;
    }
  }
  return output;
}
