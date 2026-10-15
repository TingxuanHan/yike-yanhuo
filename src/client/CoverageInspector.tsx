import { coveragePoints, type GapCategory } from "../core/coverage.js";
import { CATEGORIES, type AnalysisResult } from "../shared/types.js";

export function CoverageInspector({
  result,
  category,
  minutes,
  selected,
  onSelect,
}: {
  result: AnalysisResult;
  category: GapCategory;
  minutes: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const points = coveragePoints(result, category, minutes);
  const active =
    points.find((p) => p.id === selected) ??
    points.find((p) => p.status !== "covered") ??
    points[0];
  const categoryName = CATEGORIES.find((c) => c.id === category)!.label;
  return (
    <section
      className="coverage-inspector"
      id="coverage-inspector"
      tabIndex={-1}
      aria-label="点位判定详情"
    >
      <div className="section-line">
        <h3>为什么这样判定？</h3>
        <span>{points.length}个有效核查点</span>
      </div>
      <p className="caption">
        {minutes}分钟可达采样点 · 周边{result.parameters.gapDistanceMeters}
        米直线距离 · {categoryName}
      </p>
      {active ? (
        <>
          <label htmlFor="coverage-point">
            选择核查点，也可点击地图上的 × / ?
          </label>
          <select
            id="coverage-point"
            value={active.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                点{p.number} · {p.label}
              </option>
            ))}
          </select>
          <strong className={`coverage-verdict ${active.status}`}>
            点{active.number} · {active.label}
          </strong>
          <ul>
            {active.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <dl>
            <div>
              <dt>最近的已检索{categoryName}</dt>
              <dd>
                {active.nearest
                  ? `${active.nearest.name} · 直线约${Math.round(active.nearest.meters)}米`
                  : "本次结果中没有可用的同类设施"}
              </dd>
            </div>
            <div>
              <dt>本次类别结果</dt>
              <dd>{active.complete ? "已取完返回结果" : "不完整"}</dd>
            </div>
            <div>
              <dt>周边核查范围</dt>
              <dd>
                {active.inSearchArea ? "全部在检索范围内" : "部分超出检索范围"}
              </dd>
            </div>
            <div>
              <dt>原始记录时间</dt>
              <dd>
                {new Date(result.generatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </dd>
            </div>
          </dl>
          <p className="caption">
            {result.mode === "demo"
              ? "模拟街区，用于演示判定流程。"
              : "依据本次百度检索及已记录的设施核查信息。"}
            最近设施仅比较已检索且未停用或冲突的记录；关键词检索不能证明现实中绝对没有设施。请结合社区台账和现场核验确认。
          </p>
        </>
      ) : (
        <p>
          当前时长内没有可用于核查的测时点，可增加时长或查看报告中的缺测说明。
        </p>
      )}
    </section>
  );
}
