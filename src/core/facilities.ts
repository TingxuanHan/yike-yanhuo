import { distance } from "./geo.js";
import { usableFacility } from "../shared/facility-review.js";
import type {
  Category,
  Completeness,
  Facility,
  Gap,
  XY,
  LocalSearch,
} from "../shared/types.js";

export function deduplicate(facilities: Facility[]): Facility[] {
  const normalized = (name: string) =>
    name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s·•（）()\-]/gu, "");
  const output: Facility[] = [];
  for (const facility of facilities) {
    const duplicate = output.some(
      (p) =>
        p.category === facility.category &&
        ((p.uid && facility.uid ? p.uid === facility.uid : false) ||
          ((!p.uid || !facility.uid) &&
            normalized(p.name) === normalized(facility.name) &&
            distance(p.point, facility.point) <= 30)),
    );
    if (!duplicate) output.push(facility);
  }
  return output;
}

export function findGaps(
  points: XY[],
  center: XY,
  facilities: Facility[],
  complete: Completeness,
  searchRadius: number,
  localSearches: LocalSearch[] = [],
): Gap[] {
  const gaps: Gap[] = [];
  const usable = facilities.filter(usableFacility);
  for (const point of points) {
    for (const category of ["market", "pharmacy", "school"] as const) {
      if (
        usable.some(
          (p) => p.category === category && distance(point, p.point) <= 1000,
        )
      )
        continue;
      const fullySearched =
        (complete[category] &&
          distance(point, center) + 1000 <= searchRadius) ||
        localSearches.some(
          (w) =>
            w.category === category &&
            w.complete &&
            distance(point, w.center) + 1000 <= w.radiusMeters &&
            !facilities.some(
              (f) =>
                f.category === category &&
                !usableFacility(f) &&
                distance(f.point, w.center) <= w.radiusMeters + 5,
            ),
        );
      gaps.push({
        point,
        category,
        status: fullySearched ? "missing" : "unknown",
      });
    }
  }
  return gaps;
}
export function facilityCount(
  facilities: Facility[],
  category: Category,
  minutes: number,
): number {
  return facilities.filter(
    (p) =>
      p.category === category &&
      usableFacility(p) &&
      p.travel?.status === "ok" &&
      p.travel.seconds <= minutes * 60,
  ).length;
}
