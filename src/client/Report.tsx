import { CATEGORIES, type AnalysisResult } from "../shared/types.js";
import { facilityCount } from "../core/facilities.js";
import { downloadJson } from "./api.js";
import { CoverageChart, FacilityChart } from "./CoverageCharts.js";

export const walkTime = (seconds: number) =>
  seconds === 0 ? "起点" : `约 ${Math.ceil(seconds / 60)} 分钟`;
export function Report({ result }: { result: AnalysisResult }) {
  const gaps = (category: string, status: string) =>
    result.gaps.filter((g) => g.category === category && g.status === status)
      .length;
  return (
    <article className="report-document">
      <div className="report-heading">
        <div>
          <p className="eyebrow">一刻烟火 / 生活圈体检报告</p>
          <h2>{result.center.label}</h2>
          <p className="muted">
            {new Date(result.generatedAt).toLocaleString("zh-CN", {
              hour12: false,
            })}{" "}
            · {result.mode === "demo" ? "模拟数据" : "百度地图接口数据"}
          </p>
        </div>
        <div className="report-actions no-print">
          <button
            className="secondary"
            onClick={() =>
              downloadJson(
                result,
                `yike-${result.mode}-${result.id.slice(0, 8)}.json`,
              )
            }
          >
            导出数据
          </button>
          <button className="primary" onClick={() => window.print()}>
            打印 / 保存 PDF
          </button>
        </div>
      </div>
      {result.mode === "demo" && (
        <p className="notice">
          本报告用于演示算法与操作流程，数据为人工构造，不代表上海真实社区。
        </p>
      )}
      <section>
        <h3>步行可达范围</h3>
        <p>
          以实际路线测时点生成近似范围。面积为插值估计，不作为精确规划边界。
        </p>
        <div className="range-summary">
          {result.contours.map((c) => (
            <div key={c.minutes}>
              <span>{c.minutes} 分钟</span>
              <strong>
                {c.areaKm2.toFixed(2)} <small>km²</small>
              </strong>
              <em>{c.clipped ? "可能被采样边界截断" : "未触及采样边界"}</em>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>范围内已发现的设施</h3>
        <FacilityChart result={result} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>设施类别</th>
                <th>5分钟</th>
                <th>10分钟</th>
                <th>15分钟</th>
                <th>检索状态</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  {[5, 10, 15].map((m) => (
                    <td key={m}>{facilityCount(result.facilities, c.id, m)}</td>
                  ))}
                  <td>
                    {result.complete[c.id] ? "返回结果已取完" : "仍需补充核查"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">
          数量按步行耗时统计；营业情况、开放时间、设施入口与类别准确性需复核。
        </p>
      </section>
      <section>
        <h3>1公里设施覆盖核查</h3>
        <p>
          检查15分钟可达采样点周边的菜市场、药店和小学。此处“1公里”为直线距离，与步行可达范围分开计算。
        </p>
        <CoverageChart result={result} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>类别</th>
                <th>未检索到设施的点位</th>
                <th>数据不足的点位</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.slice(0, 3).map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  <td>{gaps(c.id, "missing")}</td>
                  <td>{gaps(c.id, "unknown")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">
          这些是候选核查点的数量，不是居民数量、行政社区数量或缺口面积。关键词检索无法证明现实中绝对不存在设施。
        </p>
      </section>
      <section>
        <h3>设施明细</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>设施</th>
                <th>类别</th>
                <th>步行时间</th>
                <th>地址</th>
              </tr>
            </thead>
            <tbody>
              {result.facilities.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td>{CATEGORIES.find((c) => c.id === p.category)?.label}</td>
                  <td>
                    {p.travel?.status === "ok"
                      ? walkTime(p.travel.seconds)
                      : "待核实"}
                  </td>
                  <td>{p.address || "未提供地址"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3>数据与方法记录</h3>
        <dl className="evidence-list">
          <div>
            <dt>有效测时点</dt>
            <dd>
              {result.quality.knownSamples} / {result.quality.totalSamples}
            </dd>
          </div>
          <div>
            <dt>采样间距</dt>
            <dd>
              {result.parameters.coarseStepMeters}米，局部加密至
              {result.parameters.refinedStepMeters}米
            </dd>
          </div>
          <div>
            <dt>检索半径</dt>
            <dd>{result.parameters.searchRadiusMeters}米</dd>
          </div>
          <div>
            <dt>实际接口调用</dt>
            <dd>
              {result.usage.requests}次 / {result.usage.routePairs}条路线 /{" "}
              {result.usage.searchRequests}次地点检索
            </dd>
          </div>
          <div>
            <dt>结果复用</dt>
            <dd>{result.usage.cacheHits}次短时缓存命中</dd>
          </div>
          <div>
            <dt>本次分析耗时</dt>
            <dd>{(result.elapsedMs / 1000).toFixed(1)}秒</dd>
          </div>
        </dl>
        <ul className="report-notes">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>
      <footer className="report-footer">
        一刻烟火 · v0.1.0 · 报告编号 {result.id}
      </footer>
    </article>
  );
}
