import { useEffect, useRef, useState } from "react";
import {
  CATEGORIES,
  type AnalysisResult,
  type Facility,
  type LngLat,
  type XY,
} from "../shared/types.js";
import { toGeo } from "../core/geo.js";
import { gapCells, type GapCategory } from "../core/coverage.js";

interface MapInstance {
  addOverlay(value: unknown): void;
  clearOverlays(): void;
  centerAndZoom(point: unknown, zoom: number): void;
  enableScrollWheelZoom(): void;
  addEventListener(
    name: string,
    callback: (e: { point?: LngLat; latlng?: LngLat }) => void,
  ): void;
  zoomIn(): void;
  zoomOut(): void;
  destroy?(): void;
}
interface MarkerInstance {
  addEventListener(name: string, callback: () => void): void;
}
interface MapApi {
  Map: new (
    element: HTMLElement,
    options: { center: unknown; zoom: number },
  ) => MapInstance;
  Point: new (lng: number, lat: number) => unknown;
  Polygon: new (
    rings: unknown[][],
    options: Record<string, unknown>,
  ) => unknown;
  Marker: new (
    point: unknown,
    options?: Record<string, unknown>,
  ) => MarkerInstance;
  Icon: new (url: string, size: unknown) => unknown;
  Size: new (width: number, height: number) => unknown;
}
declare global {
  interface Window {
    BMap?: MapApi;
    _BMapSecurityConfig?: { serviceHost: string };
    __yikeMapReady?: () => void;
  }
}
let loading: Promise<MapApi> | undefined;
function loadMap() {
  if (window.BMap) return Promise.resolve(window.BMap);
  if (loading) return loading;
  loading = new Promise<MapApi>((resolve, reject) => {
    window._BMapSecurityConfig = {
      serviceHost: location.origin + "/api/map-sdk/",
    };
    const script = document.createElement("script");
    const fail = () => {
      script.remove();
      loading = undefined;
      delete window.__yikeMapReady;
      reject(new Error("底图暂时无法加载，请检查地图应用权限或稍后重试。"));
    };
    const timer = setTimeout(fail, 20000);
    window.__yikeMapReady = () => {
      clearTimeout(timer);
      if (window.BMap) resolve(window.BMap);
      else fail();
    };
    script.src = "/api/map-sdk/api?v=4.0&callback=__yikeMapReady";
    script.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    document.head.appendChild(script);
  });
  return loading;
}
const iconSvg = (color: string, letter: string) =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="white" stroke="${color}" stroke-width="2"/><text x="16" y="21" text-anchor="middle" font-family="sans-serif" font-size="15" fill="${color}">${letter}</text></svg>`,
  );
interface Props {
  center: LngLat;
  result: AnalysisResult | null;
  facilities: Facility[];
  minutes: number;
  showGaps: boolean;
  gapCategory: GapCategory;
  disabled: boolean;
  onCenter: (point: LngLat) => void;
  onFacility: (facility: Facility) => void;
}
export function BaiduMap(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    loadMap()
      .then((BMap) => {
        if (cancelled || !element.current) return;
        const center = current.current.center;
        const instance = new BMap.Map(element.current, {
          center: new BMap.Point(center.lng, center.lat),
          zoom: 15,
        });
        instance.enableScrollWheelZoom();
        instance.addEventListener("click", (e) => {
          const point = e.latlng ?? e.point;
          if (point && !current.current.disabled)
            current.current.onCenter({ lng: point.lng, lat: point.lat });
        });
        map.current = instance;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      map.current?.destroy?.();
      map.current = null;
      setReady(false);
    };
  }, [retry]);
  useEffect(() => {
    if (ready && map.current && window.BMap)
      map.current.centerAndZoom(
        new window.BMap.Point(props.center.lng, props.center.lat),
        15,
      );
  }, [ready, props.center.lng, props.center.lat]);
  useEffect(() => {
    const BMap = window.BMap;
    if (!ready || !map.current || !BMap) return;
    const instance = map.current;
    instance.clearOverlays();
    const geoPoint = (g: LngLat) => new BMap.Point(g.lng, g.lat);
    const localPoint = (p: XY) =>
      geoPoint(toGeo(p, props.result?.center.geo ?? props.center));
    for (const contour of props.result?.contours
      .filter((c) => c.minutes <= props.minutes)
      .slice()
      .reverse() ?? []) {
      for (const polygon of contour.polygons)
        instance.addOverlay(
          new BMap.Polygon(
            polygon.map((ring) => ring.map(localPoint)),
            {
              strokeColor: "#146c5d",
              strokeWeight: 2,
              fillColor: "#4b9d82",
              fillOpacity: 0.13,
              strokeOpacity: 0.7,
            },
          ),
        );
    }
    if (props.showGaps && props.result) {
      const cells = gapCells(props.result, props.gapCategory, props.minutes);
      for (const status of ["missing", "unknown"] as const)
        for (const polygon of cells[status])
          instance.addOverlay(
            new BMap.Polygon(
              polygon.map((ring) => ring.map(localPoint)),
              {
                strokeColor: "#53646b",
                strokeWeight: 1,
                strokeStyle: status === "unknown" ? "dashed" : "solid",
                fillColor: "#59666c",
                fillOpacity: status === "unknown" ? 0.15 : 0.4,
              },
            ),
          );
    }
    const marker = (point: unknown, color: string, letter: string) =>
      new BMap.Marker(point, {
        icon: new BMap.Icon(iconSvg(color, letter), new BMap.Size(32, 32)),
      });
    for (const p of props.facilities) {
      const category = CATEGORIES.find((c) => c.id === p.category)!;
      const pin = marker(
        p.geo ? geoPoint(p.geo) : localPoint(p.point),
        category.color,
        category.short,
      );
      pin.addEventListener("click", () => current.current.onFacility(p));
      instance.addOverlay(pin);
    }
    if (props.showGaps)
      for (const gap of props.result?.gaps.filter(
        (g) =>
          g.category === props.gapCategory &&
          props.result?.samples.some(
            (s) =>
              s.point[0] === g.point[0] &&
              s.point[1] === g.point[1] &&
              s.travel.status === "ok" &&
              s.travel.seconds <= props.minutes * 60,
          ),
      ) ?? [])
        instance.addOverlay(
          marker(
            localPoint(gap.point),
            "#b87023",
            gap.status === "unknown" ? "?" : "×",
          ),
        );
    instance.addOverlay(marker(geoPoint(props.center), "#c46136", "起"));
  }, [
    ready,
    props.result,
    props.facilities,
    props.minutes,
    props.showGaps,
    props.gapCategory,
    props.center,
  ]);
  return (
    <div className="map-stage baidu-stage">
      <div
        ref={element}
        className="baidu-canvas"
        aria-label="百度地图分析视图"
      />
      {error ? (
        <div className="map-message" role="status">
          <strong>地图暂未加载</strong>
          <p>{error}</p>
          <button className="secondary" onClick={() => setRetry((v) => v + 1)}>
            重新加载底图
          </button>
        </div>
      ) : (
        !ready && (
          <div className="map-message" role="status">
            正在加载地图…
          </div>
        )
      )}
      {ready && (
        <div className="map-zoom">
          <button aria-label="放大地图" onClick={() => map.current?.zoomIn()}>
            ＋
          </button>
          <button aria-label="缩小地图" onClick={() => map.current?.zoomOut()}>
            −
          </button>
        </div>
      )}
    </div>
  );
}
