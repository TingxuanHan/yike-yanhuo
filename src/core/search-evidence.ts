import { distance } from "./geo.js";
import { usableFacility } from "../shared/facility-review.js";
import type {
  AnalysisResult,
  Category,
  LocalSearch,
  XY,
} from "../shared/types.js";

// Each negative conclusion needs a complete search containing the entire
// distance neighborhood. Several partial disks must not imply completeness.
export function searchWindows(
  result: AnalysisResult,
  category: Category,
): LocalSearch[] {
  return [
    {
      category,
      center: result.center.point,
      radiusMeters: result.parameters.searchRadiusMeters,
      complete: result.complete[category],
      readAt: result.generatedAt,
    },
    ...(result.localSearches ?? [])
      .filter((w) => w.category === category)
      .map((w) => ({
        ...w,
        complete:
          w.complete &&
          !result.facilities.some(
            (f) =>
              f.category === category &&
              !usableFacility(f) &&
              distance(f.point, w.center) <= w.radiusMeters + 5,
          ),
      })),
  ];
}

export function searchAtPoint(
  result: AnalysisResult,
  category: Category,
  point: XY,
  distanceMeters = result.parameters.gapDistanceMeters,
) {
  const containing = searchWindows(result, category).filter(
    (w) => distance(point, w.center) + distanceMeters <= w.radiusMeters,
  );
  return {
    inSearchArea: containing.length > 0,
    complete: containing.some((w) => w.complete),
  };
}
