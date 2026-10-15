import type { AnalysisResult } from "../shared/types.js";
import { useEffect, useState } from "react";
import { shanghaiStudy } from "../presentation/case-study.js";

export function CommunityGuide({
  result,
  busy,
  onExample,
  onImport,
  onStep,
}: {
  result: AnalysisResult | null;
  busy: boolean;
  onExample: () => void;
  onImport: () => void;
  onStep: (step: "range" | "coverage" | "report") => void;
}) {
  const [expanded, setExpanded] = useState(!result);
  useEffect(() => {
    if (result) setExpanded(false);
  }, [result?.id]);
  return (
    <section className="community-guide no-print" aria-label="社区体检演示导览">
      <h2>{result ? "社区体检" : "从步行范围，看到生活设施的缺口"}</h2>
      {!result && (
        <p>
          先体验模拟社区，或打开已有报告；再按顺序查看范围、核查依据和体检报告。
        </p>
      )}
      {result && (
        <p className="guide-current">
          {result.mode === "demo" ? "模拟社区" : "百度接口历史记录"} ·{" "}
          {result.center.label} · {result.generatedAt.slice(0, 10)}
        </p>
      )}
      <details
        className="guide-options"
        open={expanded}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>案例与实验说明</summary>
        <div className="guide-actions">
          <button className="primary" disabled={busy} onClick={onExample}>
            体验模拟社区
          </button>
          <button className="secondary" disabled={busy} onClick={onImport}>
            打开已有报告
          </button>
        </div>
        <p className="caption">
          模拟社区使用构造道路和设施。报告回放使用文件原始记录，默认不加载在线底图。
        </p>
      </details>
      <ol className="guide-steps">
        {(
          [
            ["range", "1. 看步行范围"],
            ["coverage", "2. 查设施缺口"],
            ["report", "3. 阅读与导出报告"],
          ] as const
        ).map(([step, label]) => (
          <li key={step}>
            <button
              className="secondary"
              aria-label={label}
              disabled={!result || busy}
              onClick={() => onStep(step)}
            >
              {step === "range"
                ? "1. 范围"
                : step === "coverage"
                  ? "2. 核查"
                  : "3. 报告"}
            </button>
          </li>
        ))}
      </ol>
      <details className="study-summary">
        <summary>上海真实接口对照 · 查看实验结果</summary>
        <p>
          <strong>{shanghaiStudy.title}</strong> · {shanghaiStudy.date}
        </p>
        <p className="caption">
          点位可达判定与API测时一致的数量；分母均为24个有效点。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>步行时长</th>
                <th>直线圆</th>
                <th>规则网格</th>
                <th>边界加密</th>
              </tr>
            </thead>
            <tbody>
              {shanghaiStudy.rows.map((row) => (
                <tr key={row.minutes}>
                  <th>{row.minutes}分钟</th>
                  {row.cells.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">{shanghaiStudy.note}</p>
        <p className="caption">
          这是已有实验摘要，和上方正在展示的案例分开；上海完整结果可从本机导入。
        </p>
      </details>
    </section>
  );
}
