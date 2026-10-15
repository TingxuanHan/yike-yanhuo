import { useEffect, useState } from "react";
import {
  compareJourneys,
  comparisonDefaults,
  type ComparisonInput,
  type JourneyComparison as Comparison,
} from "../core/journey-comparison.js";
import type { AnalysisResult } from "../shared/types.js";
import { walkTime } from "./Report.js";

export function JourneyComparison({
  result,
  minutes,
}: {
  result: AnalysisResult;
  minutes: number;
}) {
  const initial = comparisonDefaults(result, minutes);
  const [speed, setSpeed] = useState(String(initial.speedMps));
  const [waiting, setWaiting] = useState<ComparisonInput["waiting"]>("same");
  const [wait, setWait] = useState("30");
  const [crossings, setCrossings] = useState("2");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setComparison(null);
    setError("");
  }, [result, minutes]);
  const clear = () => {
    setComparison(null);
    setError("");
  };
  const base = result.scenario?.preferences;
  return (
    <section className="journey-comparison" aria-label="个人条件对比">
      <h3>换个步速，看看范围变化</h3>
      <p>
        两种条件都按{minutes}分钟、同一批路线距离试算。原条件：
        {base?.speedMps ?? 1.2}米/秒，
        {base?.signals.enabled ? "沿用已填写的等灯假设" : "不计等灯"}。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            setComparison(
              compareJourneys(result, {
                minutes,
                speedMps: Number(speed),
                waiting,
                waitSeconds: Number(wait),
                crossingsPerKm: Number(crossings),
              }),
            );
            setError("");
          } catch (e) {
            setComparison(null);
            setError(
              e instanceof Error
                ? e.message
                : "这份报告暂不能对比，请换用完整体检结果。",
            );
          }
        }}
      >
        <div className="comparison-fields">
          <label>
            对比步速（米/秒）
            <input
              type="number"
              min="0.3"
              max="2"
              step="0.01"
              required
              value={speed}
              onChange={(e) => {
                setSpeed(e.target.value);
                clear();
              }}
            />
          </label>
          <label>
            对比等灯方式
            <select
              value={waiting}
              onChange={(e) => {
                setWaiting(e.target.value as ComparisonInput["waiting"]);
                clear();
              }}
            >
              <option value="same">沿用原条件</option>
              <option value="fixed">手动设定等待</option>
            </select>
          </label>
          {waiting === "fixed" && (
            <>
              <label>
                每公里假设路口数
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  required
                  value={crossings}
                  onChange={(e) => {
                    setCrossings(e.target.value);
                    clear();
                  }}
                />
              </label>
              <label>
                每次等待（秒）
                <input
                  type="number"
                  min="0"
                  max="300"
                  required
                  value={wait}
                  onChange={(e) => {
                    setWait(e.target.value);
                    clear();
                  }}
                />
              </label>
            </>
          )}
        </div>
        <button className="primary" type="submit">
          比较这两种条件
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {comparison && (
        <div className="comparison-result" aria-live="polite">
          <p className="comparison-source">
            {result.mode === "demo" ? "模拟社区" : "已有路线的条件试算"} ·{" "}
            {result.center.label} · {minutes}分钟
          </p>
          <div className="comparison-score">
            <div>
              <span>原条件</span>
              <strong>
                {comparison.baseline.count}
                <small>处设施</small>
              </strong>
              <span>约{comparison.baseline.areaKm2.toFixed(2)} km²</span>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <span>对比条件</span>
              <strong>
                {comparison.candidate.count}
                <small>处设施</small>
              </strong>
              <span>约{comparison.candidate.areaKm2.toFixed(2)} km²</span>
            </div>
          </div>
          <svg
            viewBox="0 0 320 240"
            className="comparison-map"
            role="img"
            aria-label="两种条件的范围变化示意图，无道路底图"
          >
            {comparison.sketch.bands.map((band, i) => (
              <path
                key={i}
                fill={band.color}
                fillOpacity="0.3"
                stroke={band.color}
                strokeWidth="1.5"
                fillRule="evenodd"
                d={band.polygons
                  .map((p) =>
                    p
                      .map(
                        (r) =>
                          r
                            .map(
                              (point, index) =>
                                `${index ? "L" : "M"}${point.x},${point.y}`,
                            )
                            .join(" ") + "Z",
                      )
                      .join(" "),
                  )
                  .join(" ")}
              />
            ))}
            <circle cx="160" cy="120" r="4" fill="#243f48" />
            <text x="169" y="124" fontSize="10">
              出发点
            </text>
          </svg>
          <div className="comparison-legend">
            {comparison.layers.map((l) => (
              <span key={l.kind}>
                <i style={{ backgroundColor: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <p>
            <strong>
              {comparison.counts.kept}处仍可达，{comparison.counts.lost}
              处超出时长，{comparison.counts.gained}处新增可达。
            </strong>
          </p>
          {(comparison.baseline.clipped || comparison.candidate.clipped) && (
            <p className="warning">范围触及采样边界，更远区域未参与比较。</p>
          )}
          <p className="caption">
            {comparison.counts.unknown}处设施缺少可用路线，
            {comparison.counts.excluded}处停用／待核查／冲突记录不参与；
            {comparison.unknownSamples}个测时点缺少有效路线。
            {comparison.incompleteSearch
              ? "部分分类检索不完整，设施数量仅表示已发现记录。"
              : "数量仅表示已检索设施。"}
          </p>
          <details>
            <summary>查看地点变化与两种条件</summary>
            <p>
              原条件：{comparison.baselinePrefs.speedMps}米/秒；对比：
              {comparison.candidatePrefs.speedMps}米/秒；
              {comparison.candidatePrefs.departure}出发。
            </p>
            <p>
              {waiting === "fixed"
                ? `对比条件手动假设每公里${crossings}处路口，每处等${wait}秒。`
                : "两种条件使用相同的等灯设置。"}
              路口位置和等待均非实时观测。
            </p>
            <ul className="comparison-places">
              {comparison.facilities
                .filter((f) => ["lost", "gained", "unknown"].includes(f.change))
                .map((f) => (
                  <li key={f.id}>
                    <strong>{f.name}</strong>
                    <span>
                      {f.categoryLabel} ·{" "}
                      {f.beforeSeconds === null
                        ? "未知"
                        : walkTime(f.beforeSeconds)}{" "}
                      →{" "}
                      {f.afterSeconds === null
                        ? "未知"
                        : walkTime(f.afterSeconds)}
                    </span>
                  </li>
                ))}
            </ul>
            {!comparison.facilities.some((f) =>
              ["lost", "gained", "unknown"].includes(f.change),
            ) && <p>本次已知设施的可达名单没有变化。</p>}
          </details>
        </div>
      )}
      <p className="caption">
        使用已有路线距离重新估算，不是重新导航或保证到达；两种条件均非原接口耗时。切换不调用地图，不改原报告和个人偏好。
      </p>
    </section>
  );
}
