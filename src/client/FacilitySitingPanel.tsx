import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  compareSelectedSites,
  sitingEvidence,
  sitingOptions,
  sitingView,
  type SitingComparison,
} from "../core/facility-siting.js";
import type { GapCategory } from "../core/coverage.js";
import type { AnalysisResult } from "../shared/types.js";
import { downloadJson } from "./api.js";
import { SitingConditionsPanel } from "./SitingConditionsPanel.js";
import "./facility-siting.css";

export function FacilitySitingPanel({
  result,
  category,
  minutes,
}: {
  result: AnalysisResult;
  category: GapCategory;
  minutes: number;
}) {
  const options = useMemo(
    () => sitingOptions(result, category, minutes),
    [result, category, minutes],
  );
  const [selection, setSelection] = useState(["", "", ""]);
  const [computed, setComputed] = useState<{
    source: AnalysisResult;
    comparison: SitingComparison;
  } | null>(null);
  const [selected, setSelected] = useState("");
  const [before, setBefore] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelection(["", "", ""]);
    setComputed(null);
    setError("");
  }, [result, category, minutes]);
  const comparison =
    computed?.source === result &&
    computed.comparison.category === category &&
    computed.comparison.minutes === minutes
      ? computed.comparison
      : null;
  const view = useMemo(
    () =>
      comparison ? sitingView(result, comparison, selected, before) : null,
    [result, comparison, selected, before],
  );
  function compare() {
    try {
      const next = compareSelectedSites(result, category, minutes, selection);
      // Never overwrite the report or turn a hypothetical site into a POI.
      setComputed({ source: result, comparison: next });
      setSelected(next.scenarios[0].id);
      setBefore(false);
      setError("");
      requestAnimationFrame(() => target.current?.focus());
    } catch (e) {
      setComputed(null);
      setError((e as Error).message);
    }
  }
  return (
    <details className="siting-panel">
      <summary>比较设施补点方案</summary>
      <section aria-label="设施补点方案比较">
        <h3>多一处服务，放在哪里更有帮助？</h3>
        <p>从已有核查点选1至3处位置，比较各方案补足的原缺口面积。</p>
        <p className="caption">
          位置是规划假设，需另行核实入口与用地。比较使用当前报告，不消耗地图接口额度。
        </p>
        {options.length ? (
          <>
            <div className="siting-inputs">
              {selection.map((id, index) => (
                <div key={index}>
                  <label htmlFor={`${inputId}-${index}`}>
                    候选位置{index + 1}
                    {index > 0 ? "（选填）" : ""}
                  </label>
                  <select
                    id={`${inputId}-${index}`}
                    value={id}
                    onChange={(event) => {
                      setSelection(
                        selection.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      );
                      setComputed(null);
                      setError("");
                    }}
                  >
                    <option value="">
                      {index ? "暂不添加" : "请选择核查点"}
                    </option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              className="primary"
              onClick={compare}
              disabled={!selection.some(Boolean)}
            >
              比较所选方案
            </button>
          </>
        ) : (
          <p className="notice">
            当前时长没有可选测时点。请增加时长，或先完成社区体检。
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {view && comparison && (
          <div
            ref={target}
            tabIndex={-1}
            className="siting-result"
            aria-label="补点比较结果"
          >
            <p className="eyebrow">
              {view.minutes}分钟范围 · {view.categoryLabel} · 规划假设
            </p>
            <h4 className="siting-headline">{view.headline}</h4>
            <p className="caption">
              原候选缺口约{view.baselineGap} km²。{view.supporting}
            </p>
            {view.noProvenGap && (
              <p className="notice">
                当前资料没有可证实的候选缺口。待核查区内的假设覆盖不计入缺口改善，也不证明现实没有缺口。
              </p>
            )}
            {!before && <p className="siting-conclusion">{view.additional}</p>}
            {view.groups.map((group) => (
              <fieldset className="siting-plans" key={group.count}>
                <legend>{group.label}</legend>
                {group.plans.map((plan) => (
                  <button
                    key={plan.id}
                    className="siting-plan"
                    title={`补足原缺口约${plan.gapGain} km²；待核查区假设覆盖约${plan.unknownAssumption} km²`}
                    aria-pressed={selected === plan.id}
                    onClick={() => {
                      setSelected(plan.id);
                      setBefore(false);
                    }}
                  >
                    <strong>方案 {plan.label}</strong>
                  </button>
                ))}
              </fieldset>
            ))}
            <div
              className="siting-map-switch"
              role="group"
              aria-label="补点前后切换"
            >
              <button
                className="secondary"
                aria-pressed={before}
                onClick={() => setBefore(true)}
              >
                补点前
              </button>
              <button
                className="secondary"
                aria-pressed={!before}
                onClick={() => setBefore(false)}
              >
                假设补点后
              </button>
            </div>
            <p className="siting-map-title">{view.title}</p>
            <svg
              className="siting-sketch"
              viewBox="0 0 320 240"
              role="img"
              aria-label={`${view.title}覆盖分区示意`}
            >
              <title>
                {view.title}：蓝色为假设补足的原缺口，紫色为待核查区的假设覆盖
              </title>
              <rect width="320" height="240" fill="#edf3e9" />
              {view.sketch.bands.map((band, i) => (
                <path
                  key={i}
                  d={band.polygons
                    .map((p) =>
                      p
                        .map(
                          (r) =>
                            r
                              .map((v, j) => `${j ? "L" : "M"}${v.x},${v.y}`)
                              .join(" ") + "Z",
                        )
                        .join(" "),
                    )
                    .join(" ")}
                  fill={band.color}
                  fillOpacity="0.3"
                  stroke={band.color}
                  strokeWidth="1"
                  fillRule="evenodd"
                />
              ))}
              {view.sketch.places.map((p) => (
                <g key={p.label}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="9"
                    fill="#243f48"
                    stroke="white"
                  />
                  <text
                    x={p.x}
                    y={p.y + 3.5}
                    textAnchor="middle"
                    fill="white"
                    fontSize="10"
                  >
                    {p.label}
                  </text>
                </g>
              ))}
              <circle cx="160" cy="120" r="3" fill="#d57243" />
            </svg>
            <p className="caption">
              设施直线覆盖示意，不作导航；字母对应所选候选位置。
            </p>
            <dl className="siting-area-rows">
              {view.mainRows.map((row) => (
                <div key={row.state}>
                  <dt>
                    <i style={{ background: row.color }} />
                    {row.label}
                  </dt>
                  <dd>约{row.area} km²</dd>
                </div>
              ))}
            </dl>
            {!before && (
              <p className="caption">
                组合计算已扣除重复计入的原缺口约{view.duplicateGap}{" "}
                km²。待核查区内的假设覆盖单列，不计入已证实的缺口改善。
              </p>
            )}
            {view.clipped && (
              <p className="notice">
                步行范围可能截断，只比较当前已生成的部分。
              </p>
            )}
            <SitingConditionsPanel result={result} comparison={comparison} />
            <details>
              <summary>比较依据与限制</summary>
              <ul className="siting-candidates">
                {view.candidates.map((site) => (
                  <li key={site.id}>
                    <strong>{site.letter}</strong>
                    <span>
                      {site.name}
                      <small>{site.coordinates}</small>
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="siting-area-rows">
                {view.rows
                  .filter(
                    (r) => !view.mainRows.some((m) => m.state === r.state),
                  )
                  .map((row) => (
                    <div key={row.state}>
                      <dt>
                        <i style={{ background: row.color }} />
                        {row.label}
                      </dt>
                      <dd>约{row.area} km²</dd>
                    </div>
                  ))}
              </dl>
              <p>
                范围与原报告相同，按周边{view.distanceMeters}
                米直线距离计算。距离边界保守保留；“未计入补足”不等于已证明新增设施无法覆盖。面积不是受益人数或到店步行距离。
              </p>
              <p>
                {result.mode === "demo"
                  ? "人工构造数据"
                  : "百度API及已有核查记录，未现场验证"}{" "}
                · 基础记录
                {new Date(
                  result.baseGeneratedAt ?? result.generatedAt,
                ).toLocaleString("zh-CN")}
                。原报告和公共设施未被改动。
              </p>
            </details>
            <button
              className="secondary"
              onClick={() =>
                downloadJson(
                  sitingEvidence(result, comparison),
                  `yike-siting-${category}-${minutes}.json`,
                )
              }
            >
              导出补点比较依据
            </button>
          </div>
        )}
      </section>
    </details>
  );
}
