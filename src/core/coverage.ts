import polygonClipping from "polygon-clipping";
import { distance, pointKey } from "./geo.js";
import { usableFacility } from "../shared/facility-review.js";
import { searchAtPoint } from "./search-evidence.js";
import type { AnalysisResult, Gap, MultiPolygon, XY } from "../shared/types.js";

export const GAP_CATEGORIES = ["market", "pharmacy", "school"] as const;
export type GapCategory = (typeof GAP_CATEGORIES)[number];
export type CoverageStatus = "covered" | "missing" | "unknown";

export const COVERAGE_LABELS = {
  covered: "已检索到设施",
  missing: "候选缺口",
  unknown: "数据不足，待核查",
};

export function coveragePoints(
  result: AnalysisResult,
  category: GapCategory,
  minutes = result.scenario?.preferences.minutes ?? 15,
) {
  const seen = new Set<string>();
  const facilities = result.facilities.filter(usableFacility);
  return result.samples
    .filter((sample) => {
      const key = pointKey(sample.point);
      if (
        seen.has(key) ||
        sample.travel.status !== "ok" ||
        sample.travel.seconds > minutes * 60
      )
        return false;
      seen.add(key);
      return true;
    })
    .map((sample, index) => {
      const nearest =
        facilities
          .filter((p) => p.category === category)
          .map((p) => ({
            id: p.id,
            name: p.name,
            meters: distance(p.point, sample.point),
          }))
          .sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id))[0] ??
        null;
      const near =
        nearest !== null &&
        nearest.meters <= result.parameters.gapDistanceMeters;
      const search = searchAtPoint(result, category, sample.point);
      const inSearchArea = search.inSearchArea;
      const status: CoverageStatus = near
        ? "covered"
        : search.complete
          ? "missing"
          : "unknown";
      const reasons: string[] = [];
      if (near) reasons.push("核查距离内已找到至少一处可用于统计的同类设施。");
      else {
        if (!result.complete[category] && !search.complete)
          reasons.push("该类别检索结果未取全或含无效条目，可能仍有遗漏。");
        if (!inSearchArea)
          reasons.push("该点周围的完整核查范围超出了本次检索范围。");
        if (status === "missing")
          reasons.push(
            "本次同类检索或局部补查已取完，且覆盖该点完整核查范围，但未找到同类设施。",
          );
      }
      return {
        point: sample.point,
        status,
        id: `${category}:${pointKey(sample.point)}`,
        number: index + 1,
        seconds: sample.travel.status === "ok" ? sample.travel.seconds : 0,
        nearest,
        inSearchArea,
        complete: result.complete[category] || search.complete,
        label: COVERAGE_LABELS[status],
        reasons,
      };
    });
}
export type CoveragePoint = ReturnType<typeof coveragePoints>[number];
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
    const squares = coveragePoints(result, category, minutes)
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
