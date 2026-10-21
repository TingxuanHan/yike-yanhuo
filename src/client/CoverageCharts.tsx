import { CATEGORIES, type AnalysisResult } from "../shared/types.js";
import { facilityCount } from "../core/facilities.js";
import { coverageSummary } from "../core/coverage.js";

export function FacilityChart({ result }: { result: AnalysisResult }) {
  const bands = result.contours.map((c) => c.minutes);
  const data = CATEGORIES.map((c) => ({
    ...c,
    counts: bands.map((m) => facilityCount(result.facilities, c.id, m)),
  }));
  const max = Math.max(1, ...data.map((c) => c.counts.at(-1)!));
  return (
    <figure className="facility-chart">
      <figcaption>各类设施的步行时间分布</figcaption>
      <div className="chart-key">
        {bands.map((m, i) => (
          <span key={m}>
            <i className={"band-" + [5, 10, 15][i]} />
            {i ? `${bands[i - 1]}—${m}分钟` : `${m}分钟内`}
          </span>
        ))}
      </div>
      {data.map((c) => (
        <div
          className="chart-row"
          key={c.id}
          role="img"
          aria-label={
            c.label +
            "：" +
            bands.map((m, i) => `${m}分钟内${c.counts[i]}处`).join("，")
          }
        >
          <span>{c.label}</span>
          <div className="chart-track">
            {c.counts.map((n, i) => (
              <i
                key={i}
                className={"band-" + [5, 10, 15][i]}
                style={{
                  width: ((n - (c.counts[i - 1] ?? 0)) / max) * 100 + "%",
                }}
              />
            ))}
          </div>
          <strong>
            {c.counts.at(-1)}
            <small>处</small>
          </strong>
        </div>
      ))}
    </figure>
  );
}
export function CoverageChart({ result }: { result: AnalysisResult }) {
  const rows = coverageSummary(result);
  return (
    <figure className="coverage-chart">
      <figcaption>已测可达点的设施覆盖</figcaption>
      <div className="chart-key">
        <span>
          <i className="coverage-covered" />
          已发现设施
        </span>
        <span>
          <i className="coverage-missing" />
          未检索到
        </span>
        <span>
          <i className="coverage-unknown" />
          数据不足
        </span>
      </div>
      {rows.map((row) => (
        <div className="coverage-row" key={row.category}>
          <div className="coverage-row-title">
            <strong>
              {CATEGORIES.find((c) => c.id === row.category)!.label}
            </strong>
            <span>
              已发现 {row.covered} / {row.total} 点
            </span>
          </div>
          <div
            className="coverage-track"
            role="img"
            aria-label={
              "已发现设施" +
              row.covered +
              "点，未检索到" +
              row.missing +
              "点，数据不足" +
              row.unknown +
              "点"
            }
          >
            {(["covered", "missing", "unknown"] as const).map((status) => (
              <i
                key={status}
                className={"coverage-" + status}
                style={{
                  width: (row[status] / Math.max(1, row.total)) * 100 + "%",
                }}
              />
            ))}
          </div>
          <p>
            未检索到 {row.missing} 点 · 数据不足 {row.unknown} 点
          </p>
        </div>
      ))}
    </figure>
  );
}
