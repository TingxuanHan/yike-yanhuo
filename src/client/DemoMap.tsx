import { useEffect, useRef, useState } from "react";
import { demoRoads } from "../core/demo.js";
import {
  CATEGORIES,
  type AnalysisResult,
  type Facility,
  type XY,
} from "../shared/types.js";

const roads = demoRoads();
const contourPath = (polygons: XY[][][]) =>
  polygons
    .map((polygon) =>
      polygon
        .map(
          (ring) =>
            ring.map((p, i) => `${i ? "L" : "M"}${p[0]},${-p[1]}`).join(" ") +
            "Z",
        )
        .join(" "),
    )
    .join(" ");
interface Props {
  center: XY;
  result: AnalysisResult | null;
  facilities: Facility[];
  minutes: number;
  showGaps: boolean;
  disabled: boolean;
  onCenter: (point: XY) => void;
  onFacility: (facility: Facility) => void;
}
export function DemoMap({
  center,
  result,
  facilities,
  minutes,
  showGaps,
  disabled,
  onCenter,
  onFacility,
}: Props) {
  const [extent, setExtent] = useState(1600);
  const container = useRef<HTMLDivElement>(null);
  const [pixels, setPixels] = useState(520);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setPixels(Math.max(250, Math.min(rect.width, rect.height)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const view = {
    x: center[0] - extent,
    y: -center[1] - extent,
    size: extent * 2,
  };
  const unit = view.size / pixels;
  return (
    <div className="map-stage" ref={container}>
      <svg
        className="neighborhood-map"
        viewBox={`${view.x} ${view.y} ${view.size} ${view.size}`}
        role="group"
        aria-label="模拟街区步行分析地图，可用左侧地点菜单选择中心"
        data-testid="demo-map"
        onClick={(event) => {
          if (disabled) return;
          const svg = event.currentTarget;
          const transform = svg.getScreenCTM()?.inverse();
          if (!transform) return;
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(transform);
          if (Math.abs(point.x) <= 1000 && Math.abs(point.y) <= 1000)
            onCenter([
              Math.round(point.x / 200) * 200,
              -Math.round(point.y / 200) * 200,
            ]);
        }}
      >
        <defs>
          <pattern
            id="blocks"
            width="200"
            height="200"
            patternUnits="userSpaceOnUse"
          >
            <rect
              x="26"
              y="27"
              width="148"
              height="146"
              rx="15"
              fill="#dde6e1"
            />
            <rect x="36" y="38" width="61" height="124" rx="5" fill="#e9eeea" />
            <rect x="109" y="38" width="55" height="54" rx="5" fill="#e9eeea" />
            <rect
              x="109"
              y="106"
              width="55"
              height="56"
              rx="5"
              fill="#e9eeea"
            />
          </pattern>
        </defs>
        <rect x="-3200" y="-3200" width="6400" height="6400" fill="#edf1ec" />
        <rect
          x="-4000"
          y="-4000"
          width="8000"
          height="8000"
          fill="url(#blocks)"
        />
        <rect x="441" y="-3200" width="118" height="6400" fill="#aecfd5" />
        <path
          d="M477,-3200V3200 M527,-3200V3200"
          stroke="#c7e1e4"
          fill="none"
          strokeWidth="3"
        />
        <rect
          x="-770"
          y="-570"
          width="135"
          height="145"
          rx="28"
          fill="#c4d9ba"
        />
        <rect x="29" y="-770" width="144" height="133" rx="35" fill="#c4d9ba" />
        {roads.map((r, i) => (
          <line
            key={i}
            x1={r.a[0]}
            y1={-r.a[1]}
            x2={r.b[0]}
            y2={-r.b[1]}
            stroke="#fff"
            strokeWidth={r.a[1] === -600 || r.a[1] === 800 ? 22 : 13}
          />
        ))}
        <g
          className="map-place-labels"
          fontSize="47"
          fill="#829087"
          textAnchor="middle"
          pointerEvents="none"
        >
          <text x="-970" y="-1050">
            西街住区
          </text>
          <text x="-270" y="1120">
            站前街区
          </text>
          <text x="1140" y="-960">
            河畔住区
          </text>
          <text x="730" y="690" fontSize="30">
            南桥
          </text>
          <text x="670" y="-830" fontSize="30">
            北桥
          </text>
        </g>
        {result?.contours
          .filter((c) => c.minutes <= minutes)
          .slice()
          .reverse()
          .map((c) => (
            <path
              key={c.minutes}
              d={contourPath(c.polygons)}
              fill={
                c.minutes === 5
                  ? "#257a65"
                  : c.minutes === 10
                    ? "#56a38b"
                    : "#86b8a2"
              }
              fillOpacity={c.minutes === 5 ? 0.29 : 0.24}
              fillRule="evenodd"
              stroke={c.minutes === 5 ? "#146c5d" : "#4e957b"}
              strokeWidth={c.minutes === minutes ? 3 : 1.4}
              strokeDasharray={c.minutes === 15 ? "8 5" : undefined}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
        {showGaps &&
          result?.gaps.map((g, i) => (
            <g
              key={i}
              transform={`translate(${g.point[0]},${-g.point[1]})`}
              pointerEvents="none"
            >
              <circle
                r="25"
                fill="#fff7e9"
                stroke="#b87023"
                strokeWidth="5"
                strokeDasharray={g.status === "unknown" ? "7 5" : undefined}
              />
              <path d="M-8,-8L8,8M-8,8L8,-8" stroke="#b87023" strokeWidth="4" />
              <title>
                {g.status === "unknown" ? "待核查" : "1公里内未检索到"}
                {CATEGORIES.find((c) => c.id === g.category)?.label}
              </title>
            </g>
          ))}
        {facilities
          .filter(
            (p) =>
              Math.abs(p.point[0] - center[0]) < extent - 80 &&
              Math.abs(p.point[1] - center[1]) < extent - 80,
          )
          .map((p) => {
            const category = CATEGORIES.find((c) => c.id === p.category)!;
            return (
              <g
                key={p.id}
                transform={`translate(${p.point[0]},${-p.point[1]})`}
                className="map-poi"
                role="button"
                tabIndex={0}
                aria-label={`查看${p.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFacility(p);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onFacility(p);
                  }
                }}
              >
                <circle r={22 * unit} fill="transparent" />
                <circle
                  r={13 * unit}
                  fill="white"
                  stroke={category.color}
                  strokeWidth={1.5 * unit}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12 * unit}
                  fill={category.color}
                  fontWeight="600"
                >
                  {category.short}
                </text>
                <title>{p.name}</title>
              </g>
            );
          })}
        <g
          transform={`translate(${center[0]},${-center[1]})`}
          pointerEvents="none"
        >
          <circle r="100" fill="#c46136" fillOpacity=".10" />
          <circle r="46" fill="#c46136" stroke="white" strokeWidth="12" />
          <circle r="11" fill="white" />
        </g>
      </svg>
      <div className="map-source-label">
        模拟街区<span>人工构造路网与设施</span>
      </div>
      <div className="north" aria-label="上方为北">
        N<span>↑</span>
      </div>
      <div className="map-zoom">
        <button
          type="button"
          aria-label="放大地图"
          disabled={extent <= 800}
          onClick={() => setExtent((v) => Math.max(800, v - 300))}
        >
          ＋
        </button>
        <button
          type="button"
          aria-label="缩小地图"
          disabled={extent >= 2500}
          onClick={() => setExtent((v) => Math.min(2500, v + 300))}
        >
          −
        </button>
      </div>
      <div className="map-scale">
        <span style={{ width: `${(250 / (2 * extent)) * 100}%` }} />
        <small>图中相邻路口约 200 米</small>
      </div>
      {!result && (
        <div className="map-instruction">选好起点，看看一刻钟能走到哪里</div>
      )}
    </div>
  );
}
