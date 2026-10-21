import clipping from "polygon-clipping";
import type { AnalysisResult, MultiPolygon } from "../shared/types.js";

export function walkingTimeBands(result: AnalysisResult, minutes: number) {
  const limit = result.contours.find((c) => c.minutes === minutes)?.polygons;
  if (!limit?.length) return [];
  let covered: MultiPolygon = [];
  let from = 0;
  return result.contours
    .filter((c) => c.minutes <= minutes)
    .slice()
    .sort((a, b) => a.minutes - b.minutes)
    .map((contour) => {
      const within = contour.polygons.length
        ? (clipping.intersection(contour.polygons, limit) as MultiPolygon)
        : [];
      const polygons = !within.length
        ? []
        : covered.length
          ? (clipping.difference(within, covered) as MultiPolygon)
          : within;
      if (within.length)
        covered = covered.length
          ? (clipping.union(covered, within) as MultiPolygon)
          : within;
      const band = {
        from,
        to: contour.minutes,
        label: `${from}–${contour.minutes}分钟`,
        color:
          contour.minutes <= 5
            ? "#176d56"
            : contour.minutes <= 10
              ? "#5b9f77"
              : contour.minutes <= 15
                ? "#b8cb80"
                : "#d5bd76",
        polygons,
      };
      from = contour.minutes;
      return band;
    });
}
