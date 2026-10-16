import { useMemo } from "react";
import {
  coverageArea,
  coverageAreaView,
  areaLabel,
} from "../core/coverage-area.js";
import { GAP_CATEGORIES, type GapCategory } from "../core/coverage.js";
import { CATEGORIES, type AnalysisResult } from "../shared/types.js";
import { downloadJson } from "./api.js";
import "./coverage-area.css";

export function CoverageAreaPanel({
  result,
  category,
  minutes,
}: {
  result: AnalysisResult;
  category: GapCategory;
  minutes: number;
}) {
  const computed = useMemo(() => {
    try {
      return { view: coverageAreaView(result, category, minutes), error: "" };
    } catch (e) {
      return { view: null, error: (e as Error).message };
    }
  }, [result, category, minutes]);
  const { view, error } = computed;
  return (
    <section className="coverage-area-panel" aria-label="连续覆盖分区">
      <p className="eyebrow">{minutes}分钟范围 · 连续分区</p>
      <h3>这一片，哪里还需要核查？</h3>
      {error && <p role="alert">{error} 原始点位依据仍可查看。</p>}
      {view && (
        <>
          <p>
            {view.categoryLabel} · 周边{view.distanceMeters}米直线距离 ·
            范围面积约{view.totalArea} km²
          </p>
          {view.empty ? (
            <p>当前时长没有已生成的可达范围，暂不计算面积。</p>
          ) : (
            <>
              <div className="coverage-area-bar" aria-hidden="true">
                {view.rows.map((r) => (
                  <i
                    key={r.state}
                    style={{ width: `${r.percent}%`, backgroundColor: r.color }}
                  />
                ))}
              </div>
              <dl className="coverage-area-rows">
                {view.rows.map((r) => (
                  <div key={r.state}>
                    <dt>
                      <i style={{ backgroundColor: r.color }} />
                      {r.label}
                    </dt>
                    <dd>
                      约{r.area} km² <small>{r.percent}%</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <p className="caption">
            面积来自已有步行轮廓与设施距离分区，不代表人口覆盖率或到店步行距离。候选缺口仍需现场核查。
          </p>
          {view.clipped && (
            <p className="notice">
              当前步行范围可能被采样边界截断，面积只统计已生成部分。
            </p>
          )}
          <details>
            <summary>待核查原因与计算依据</summary>
            <ul>
              {view.reasons.map((r) => (
                <li key={r.label}>
                  {r.label}：约{r.area} km²
                </li>
              ))}
            </ul>
            <p className="caption">
              排除已停用和存在冲突的同类设施。返回结果不完整、核查范围超出检索边界时，不判为缺口。距离圆使用内外边界，最宽约
              {view.boundaryBand}
              米的绘图保留带归入待核查；此数不包含地图坐标或路网插值误差。
            </p>
            <p className="caption">
              {result.mode === "demo"
                ? "人工构造数据"
                : "百度API数据及已有核查记录"}{" "}
              · 原始记录 {new Date(result.generatedAt).toLocaleString("zh-CN")}
              。本地重算不调用地图接口。
            </p>
          </details>
          <button
            className="secondary no-print"
            onClick={() =>
              downloadJson(
                {
                  schema: "yike-coverage-area-v1",
                  coordinateSystem: "report-local-meters",
                  evidence:
                    result.mode === "demo"
                      ? "simulation"
                      : "api-and-user-review",
                  report: result,
                  partition: coverageArea(result, category, minutes),
                },
                `yike-coverage-${category}-${minutes}.json`,
              )
            }
          >
            导出分区依据
          </button>
        </>
      )}
    </section>
  );
}

export function CoverageAreaReport({ result }: { result: AnalysisResult }) {
  const minutes = result.scenario?.preferences.minutes ?? 15;
  const rows = useMemo(
    () =>
      GAP_CATEGORIES.map((category) => {
        try {
          return { category, area: coverageArea(result, category, minutes) };
        } catch {
          return { category, area: null };
        }
      }),
    [result, minutes],
  );
  return (
    <section className="coverage-area-report" aria-label="连续分区面积汇总">
      <h3>{minutes}分钟范围的连续分区面积</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>类别</th>
              <th>已找到设施</th>
              <th>候选缺口</th>
              <th>待核查</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ category, area }) => (
              <tr key={category}>
                <th scope="row">
                  {CATEGORIES.find((c) => c.id === category)!.label}
                </th>
                {(["covered", "missing", "unknown"] as const).map((s) => (
                  <td key={s}>
                    {area ? areaLabel(area.squareMeters[s]) : "无法计算"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        单位
        km²，均为近似面积。按当前插值轮廓分区，检索不足及距离边界保留为待核查；关键词检索不能证明现实中绝对不存在设施。与上方采样点数量分别统计。
      </p>
    </section>
  );
}
