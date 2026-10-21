import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  compareSitingConditions,
  sitingConditionDefaults,
  sitingConditionsView,
  sitingConditionsEvidence,
  SITING_CONDITION_LIMITS,
  type SitingConditions,
} from "../core/siting-conditions.js";
import type { SitingComparison } from "../core/facility-siting.js";
import type { AnalysisResult } from "../shared/types.js";
import { downloadJson } from "./api.js";

export function SitingConditionsPanel({
  result,
  comparison,
}: {
  result: AnalysisResult;
  comparison: SitingComparison;
}) {
  const defaults = () =>
    Object.fromEntries(
      Object.entries(sitingConditionDefaults(result)).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
  const [fields, setFields] = useState(defaults);
  const [calculated, setCalculated] = useState<{
    source: AnalysisResult;
    parent: SitingComparison;
    value: SitingConditions;
  } | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const id = useId(),
    target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCalculated(null);
    setFields(defaults());
    setError("");
  }, [result, comparison]);
  const value =
    calculated?.source === result && calculated.parent === comparison
      ? calculated.value
      : null;
  const view = useMemo(
    () => (value ? sitingConditionsView(result, value, selected) : null),
    [result, value, selected],
  );
  function change(key: string, text: string) {
    setFields({ ...fields, [key]: text });
    setCalculated(null);
    setError("");
  }
  return (
    <details className="siting-conditions">
      <summary>换种走法，方案还合适吗？</summary>
      <section aria-label="补点多条件检查">
        <p>保留相同候选位置，检查三种条件下的收益和落后幅度。</p>
        <p className="caption">
          原条件、{fields.speedMps || "待填"}米/秒与
          {fields.departure || "待填时段"}、再假设每公里
          {fields.crossingsPerKm || "待填"}处各等{fields.waitSeconds || "0"}
          秒。三组都按已有路线距离重算。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              if (Object.values(fields).some((v) => !v.trim()))
                throw new Error("请填完整比较条件。");
              const next = compareSitingConditions(
                result,
                comparison.category,
                comparison.minutes,
                comparison.candidates.map((c) => c.id),
                {
                  speedMps: Number(fields.speedMps),
                  departure: fields.departure,
                  waitSeconds: Number(fields.waitSeconds),
                  crossingsPerKm: Number(fields.crossingsPerKm),
                },
              );
              setCalculated({
                source: result,
                parent: comparison,
                value: next,
              });
              setSelected(next.plans[0].id);
              setError("");
              requestAnimationFrame(() => target.current?.focus());
            } catch (e) {
              setCalculated(null);
              setError((e as Error).message);
            }
          }}
        >
          <details>
            <summary>调整比较条件</summary>
            <div className="siting-inputs">
              {[
                {
                  key: "speedMps",
                  label: "检查用步速（米/秒）",
                  type: "number",
                  min: "0.3",
                  max: "2",
                  step: "0.01",
                },
                { key: "departure", label: "检查用出发时间", type: "time" },
                {
                  key: "crossingsPerKm",
                  label: "检查用每公里路口数",
                  type: "number",
                  min: "0",
                  max: "10",
                  step: "0.1",
                },
                {
                  key: "waitSeconds",
                  label: "检查用每处等待（秒）",
                  type: "number",
                  min: "0",
                  max: "300",
                  step: "1",
                },
              ].map((f) => (
                <div key={f.key}>
                  <label htmlFor={`${id}-${f.key}`}>{f.label}</label>
                  <input
                    id={`${id}-${f.key}`}
                    type={f.type}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={fields[f.key]}
                    required
                    onChange={(e) => change(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <p className="caption">
              等灯为手动假设。对照时段沿用原峰谷规则；第三组改为上述固定等待。未启用等灯时，仅改时段不会改变范围。
            </p>
          </details>
          <button type="submit" className="secondary">
            检查三种条件
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {view && value && (
          <div
            ref={target}
            tabIndex={-1}
            className="siting-conditions-result"
            aria-label="多条件检查结果"
          >
            <p className="eyebrow">{view.sourceLabel}</p>
            <h4 className="siting-headline">{view.headline}</h4>
            <p className="caption">
              最大落后面积：在各条件内先与同数量的最好方案比较，再看差距最大的一次。数值越小，表示这几组条件下的取舍越小。
            </p>
            {view.changedWinner && (
              <p className="notice">
                首选方案随条件改变，单看一组条件可能遗漏取舍。
              </p>
            )}
            {view.groups.map((group) => (
              <fieldset className="siting-plans" key={group.count}>
                <legend>{group.label}</legend>
                {group.plans.map((p) => (
                  <button
                    type="button"
                    className="siting-plan"
                    key={p.id}
                    aria-pressed={selected === p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    检查方案 {p.label}
                  </button>
                ))}
              </fieldset>
            ))}
            <p className="siting-conclusion">
              方案 {view.label}：三组都补足约{view.stableGain} km²；最大落后约
              {view.maxRegret} km²。
            </p>
            <svg
              className="siting-sketch"
              viewBox="0 0 320 240"
              role="img"
              aria-label="三组条件共同补足与条件相关范围示意"
            >
              <rect width="320" height="240" fill="#f4f8f7" />
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
                  fillOpacity="0.5"
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
              蓝色：三组都计入补足；橙色：仅部分条件计入；灰底：三组分析范围的并集。不是导航路线。
            </p>
            <dl className="siting-area-rows">
              <div>
                <dt>三组都补足的同一片区域</dt>
                <dd>约{view.stableGain} km²</dd>
              </div>
              <div>
                <dt>仅部分条件计入补足</dt>
                <dd>约{view.variableGain} km²</dd>
              </div>
              <div>
                <dt>单组最少补足</dt>
                <dd>约{view.worstGain} km²</dd>
              </div>
            </dl>
            <p className="caption">最大落后发生在：{view.worstConditions}。</p>
            {view.clipped && (
              <p className="notice">
                部分条件触及采样边界，只比较现有数据覆盖的部分。
              </p>
            )}
            {view.emptyConditions && (
              <p className="notice">
                {view.emptyConditions}没有可比较范围，该组收益记为0。
              </p>
            )}
            {view.distinctConditions < 3 && (
              <p className="caption">
                有设置重复，实际只有{view.distinctConditions}
                组不同参数；重复条件不加权。
              </p>
            )}
            <details>
              <summary>逐组数值与计算口径</summary>
              {view.conditions.map((c) => (
                <div key={c.id} className="siting-condition-row">
                  <strong>{c.label}</strong>
                  <p className="caption">{c.description}</p>
                  <p>
                    补足约{c.gain} km² · 落后约{c.regret} km²
                  </p>
                  <p className="caption">
                    分析范围{c.range} km²；原缺口{c.gap} km²；待核查{c.unknown}{" "}
                    km²。未知区假设覆盖{c.unknownGain} km²，不计收益。
                  </p>
                </div>
              ))}
              <ul>
                {SITING_CONDITION_LIMITS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="caption">
                显示相差不足0.001
                km²时提示接近，不代表现场精度或统计等价。基础记录：
                {value.baseGeneratedAt}。
              </p>
            </details>
            <button
              className="secondary"
              onClick={() =>
                downloadJson(
                  sitingConditionsEvidence(result, value),
                  `yike-siting-conditions-${comparison.category}-${comparison.minutes}.json`,
                )
              }
            >
              导出多条件检查依据
            </button>
          </div>
        )}
      </section>
    </details>
  );
}
