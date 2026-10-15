import { personalize } from "../core/personalize.js";
import { walkingTimeBands } from "../core/time-bands.js";
import { toGeo } from "../core/geo.js";
import {
  coveragePoints,
  GAP_CATEGORIES,
  type GapCategory,
} from "../core/coverage.js";
import { usableFacility } from "../shared/facility-review.js";
import { cleanJourney, type JourneyPreferences } from "../shared/journey.js";
import {
  CATEGORIES,
  type AnalysisResult,
  type LngLat,
  type XY,
} from "../shared/types.js";
import type { PersonalPlace, PlacePosition } from "../shared/life.js";
export { parseResultFile } from "../shared/result-file.js";
export { shanghaiStudy } from "../presentation/case-study.js";

// Display conversion only. Canonical coordinates and Baidu analysis inputs stay unchanged.
export function bd09ToGcj02(p: LngLat): LngLat {
  const x = p.lng - 0.0065,
    y = p.lat - 0.006;
  const a = (Math.PI * 3000) / 180;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * a);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * a);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}
export function mapPosition(p: PlacePosition): LngLat | null {
  if (p.system === "gcj02") return { lng: p.lng, lat: p.lat };
  if (p.system === "bd09") return bd09ToGcj02(p);
  // Unknown conversion and synthetic locations must never be shown on a real map.
  return null;
}
export function facilityPlace(
  result: AnalysisResult,
  id: string,
): PersonalPlace {
  const p = result.facilities.find((f) => f.id === id);
  if (!p) throw new Error("地点已不在当前结果中，请重新选择。");
  const position: PlacePosition =
    result.mode === "demo"
      ? { system: "demo", x: p.point[0], y: p.point[1] }
      : { system: "bd09", ...(p.geo ?? toGeo(p.point, result.center.geo!)) };
  return {
    id: `place-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: p.name,
    address: p.address,
    landmark: "",
    note: "",
    visitedOn: "",
    position,
    source: "personal",
  };
}
export const categories = [
  { id: "all", label: "全部" },
  ...CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
];
export const coverageCategories = GAP_CATEGORIES.map((id) => ({
  id,
  label: CATEGORIES.find((c) => c.id === id)!.label,
}));
export function coverageView(
  result: AnalysisResult,
  category: GapCategory = "school",
  minutes = result.scenario?.preferences.minutes ?? 15,
) {
  const points = coveragePoints(result, category, minutes).map((p) => ({
    ...p,
    option: `点${p.number} · ${p.label}`,
    nearestLabel: p.nearest
      ? `${p.nearest.name} · 直线约${Math.round(p.nearest.meters)}米`
      : "本次没有可用的同类设施",
  }));
  return {
    coveragePoints: points,
    coverageOptions: points.map((p) => p.option),
  };
}
export function scenario(
  source: AnalysisResult,
  prefs: JourneyPreferences,
): AnalysisResult {
  return personalize(source, cleanJourney(prefs), {
    id: `mini-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  });
}
export function placeList(
  places: PersonalPlace[],
  query = "",
  favoriteOnly = false,
) {
  const q = query.trim().toLocaleLowerCase();
  return places
    .filter(
      (p) =>
        (!favoriteOnly || p.favorite) &&
        `${p.name} ${p.address} ${p.landmark}`.toLocaleLowerCase().includes(q),
    )
    .slice()
    .sort(
      (a, b) =>
        Number(!!b.favorite) - Number(!!a.favorite) ||
        b.visitedOn.localeCompare(a.visitedOn) ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
}
export function reportView(
  result: AnalysisResult,
  category = "all",
  minutes = result.scenario?.preferences.minutes ?? 15,
) {
  const nearby = result.facilities
    .filter(
      (p) =>
        usableFacility(p) &&
        (category === "all" || p.category === category) &&
        p.travel?.status === "ok" &&
        p.travel.seconds <= minutes * 60,
    )
    .sort(
      (a, b) =>
        (a.travel!.status === "ok" ? a.travel!.seconds : Infinity) -
        (b.travel!.status === "ok" ? b.travel!.seconds : Infinity),
    )
    .slice(0, 60)
    .map((p, i) => ({
      ...p,
      markerId: i + 1,
      minutes: p.travel?.status === "ok" ? Math.ceil(p.travel.seconds / 60) : 0,
      categoryLabel:
        CATEGORIES.find((c) => c.id === p.category)?.label ?? "地点",
    }));
  const contour = result.contours.find((c) => c.minutes === minutes);
  const bands = walkingTimeBands(result, minutes);
  const native = result.mode === "baidu" && !!result.center.geo;
  const convert = (xy: XY) => {
    const p = bd09ToGcj02(toGeo(xy, result.center.geo!));
    return { latitude: p.lat, longitude: p.lng };
  };
  const center = native ? bd09ToGcj02(result.center.geo!) : null;
  const paths =
    contour?.polygons.flatMap((polygon) =>
      polygon.map((convertRing) => convertRing),
    ) ?? [];
  // Draw rings as lines: native map polygons cannot represent holes consistently.
  const polylines = native
    ? bands.flatMap((band) =>
        band.polygons.flatMap((polygon) =>
          polygon.map((points) => ({
            points: points.map(convert),
            color: band.color,
            width: 3,
            dottedLine: false,
          })),
        ),
      )
    : [];
  const polygons = native
    ? bands.flatMap((band) =>
        band.polygons
          .filter((p) => p.length === 1)
          .map((p) => ({
            points: p[0].map(convert),
            strokeWidth: 1,
            strokeColor: band.color,
            fillColor: band.color + "55",
          })),
      )
    : [];
  const markers = native
    ? nearby.map((p) => ({
        id: p.markerId,
        ...convert(p.point),
        iconPath: "/assets/place.png",
        width: 26,
        height: 26,
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          content: `${p.name} · ${p.minutes}分钟`,
          display: "BYCLICK",
          padding: 8,
          borderRadius: 8,
        },
      }))
    : [];
  if (native)
    markers.push({
      id: 0,
      ...convert(result.center.point),
      iconPath: "/assets/place.png",
      width: 34,
      height: 34,
      anchor: { x: 0.5, y: 0.5 },
      callout: {
        content: "出发点",
        display: "ALWAYS",
        padding: 8,
        borderRadius: 8,
      },
    });
  const radius = result.parameters.radiusMeters;
  const plot = (p: XY) => ({
    x: 160 + ((p[0] - result.center.point[0]) / radius) * 105,
    y: 120 - ((p[1] - result.center.point[1]) / radius) * 105,
  });
  return {
    nearby,
    minutes,
    mapNative: native,
    mapCenter: center ? { longitude: center.lng, latitude: center.lat } : null,
    mapPolylines: polylines,
    mapPolygons: polygons,
    mapMarkers: markers,
    mapPoints: native
      ? [convert(result.center.point), ...paths.flatMap((r) => r.map(convert))]
      : [],
    sketch: {
      rings: paths.map((r) => r.map(plot)),
      bands: bands.map((b) => ({
        color: b.color,
        polygons: b.polygons.map((p) => p.map((r) => r.map(plot))),
      })),
      places: nearby.map((p) => ({ ...plot(p.point), id: p.id })),
    },
    areas: result.contours.map((c) => ({
      minutes: c.minutes,
      area: c.areaKm2.toFixed(2),
      clipped: c.clipped,
    })),
    rangeArea: contour?.areaKm2.toFixed(2) ?? "0.00",
    rangeClipped: !!contour?.clipped,
    timeLegend: bands.map((b) => ({
      label: b.label,
      color: b.color,
      to: b.to,
    })),
    generatedLabel: result.generatedAt.slice(0, 10),
    mapHasHoles: bands.some((b) => b.polygons.some((p) => p.length > 1)),
  };
}
