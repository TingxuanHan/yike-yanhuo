import { useEffect, useRef, useState } from "react";
import {
  ContourAuditSession,
  type ContourAuditState,
} from "../mini/contour-audit.js";
import { CONTOUR_AUDIT_LIMITS } from "../core/contour-audit.js";
import type { AnalysisResult } from "../shared/types.js";
import { downloadJson, request } from "./api.js";
import "./contour-audit.css";

const initial: ContourAuditState = {
  busy: false,
  prepared: false,
  error: "",
  status: "",
  plan: null,
  view: null,
};
export function ContourAuditPanel({
  result,
  minutes,
}: {
  result: AnalysisResult;
  minutes: number;
}) {
  const [count, setCount] = useState(6),
    [state, setState] = useState(initial);
  const [session] = useState(
    () =>
      new ContourAuditSession({
        notify: setState,
        request: (path, method = "GET", body) =>
          request(path, {
            method,
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
          }),
      }),
  );
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    session.reopen();
    session.setInput(result, minutes, count);
    return () => session.dispose();
  }, [session, result, minutes, count]);
  useEffect(() => {
    if (state.view) target.current?.focus();
  }, [state.view]);
  return (
    <details className="contour-audit-panel">
      <summary>抽点复核：这个范围和测时一致吗？</summary>
      <section aria-label="等时圈抽点复核">
        <h3>先固定预测，再读取路线</h3>
        <p className="caption">
          在原采样之外的固定位置，核对{minutes}
          分钟判断。复核点与原采样及设施点至少相隔10米，不改变原轮廓。
        </p>
        <label>
          固定复核点数
          <select
            aria-label="固定复核点数"
            value={count}
            disabled={state.busy}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            <option value={6}>6点 · 先做小样本复核</option>
            <option value={12}>12点 · 每个半径四个方向</option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={state.busy}
          onClick={() => void session.preview()}
        >
          预览固定点与用量
        </button>
        {state.plan && (
          <div className="audit-plan">
            <strong>已固定{state.plan.count}个位置及原判断</strong>
            <p>
              {result.mode === "demo"
                ? "本机模拟演练，零外部请求。"
                : `读取${state.plan.count}个固定点，最多预留${state.plan.maxRouteUnits}条路线（含一次重试），不检索设施。`}
            </p>
            <p className="caption">
              250、600、1000米三个半径的对向点；读取后保留全部结果，缓存命中按实际记账。
            </p>
            <details>
              <summary>查看预先固定的位置</summary>
              {state.plan.points.map((p) => (
                <p className="caption" key={p.number}>
                  点{p.number} · 报告坐标{p.point.join(", ")}米 · 当前
                  {p.predictions.current === null
                    ? "资料不足"
                    : p.predictions.current
                      ? "圈内"
                      : "圈外"}
                </p>
              ))}
            </details>
            {state.prepared && (
              <button disabled={state.busy} onClick={() => void session.run()}>
                {result.mode === "demo" ? "开始本机复核" : "确认读取固定点"}
              </button>
            )}
          </div>
        )}
        {state.busy && (
          <button className="quiet" onClick={() => session.stop()}>
            停止抽点复核
          </button>
        )}
        {state.status && (
          <p className="caption" role="status">
            {state.status}
          </p>
        )}
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {state.view && (
          <div
            className="audit-result"
            ref={target}
            tabIndex={-1}
            aria-label="抽点复核结果"
          >
            <p className="eyebrow">{state.view.sourceLabel}</p>
            <h4>{state.view.headline}</h4>
            <p className="caption">
              这是固定样本的一致数，不代表社区整体准确率。原报告未改动。
            </p>
            <div className="audit-metrics">
              {state.view.metrics.map((m) => (
                <article key={m.model}>
                  <strong>{m.label}</strong>
                  <p>
                    一致{" "}
                    <b>
                      {m.agreement}/{m.evaluated}
                    </b>{" "}
                    · 误判{m.falseReachable} · 漏判{m.missedReachable}
                  </p>
                  <p className="caption">
                    测时缺失{m.observationUnknown} · 预测不足
                    {m.predictionUnknown}
                  </p>
                </article>
              ))}
            </div>
            <p className="notice">
              在共同可比较的{state.view.paired.evaluated}个点上：当前轮廓一致
              {state.view.paired.currentAgreement}个，直线圆一致
              {state.view.paired.circleAgreement}个。
            </p>
            <details>
              <summary>逐点结果与读取时间</summary>
              {state.view.rows.map((r) => (
                <article className="audit-observation" key={r.number}>
                  <strong>
                    点{r.number} · {r.verdict}
                  </strong>
                  <p>
                    当前{r.current} · 规则网格{r.coarse} · 直线圆{r.circle}
                  </p>
                  <p>
                    读取结果：{r.observed}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                  <p className="caption">
                    {r.coordinates} · {r.readAt}
                  </p>
                </article>
              ))}
            </details>
            <details>
              <summary>比较口径与数据边界</summary>
              <ul>
                {CONTOUR_AUDIT_LIMITS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="caption">
                冻结时间{state.view.plannedAt}；完成{state.view.completedAt}
                。实际路线计数{state.view.usage.routePairs}，缓存命中
                {state.view.usage.cacheHits}，重试{state.view.usage.retries}。
              </p>
            </details>
            <button
              className="secondary"
              onClick={() =>
                downloadJson(
                  session.result(),
                  `yike-contour-audit-${minutes}.json`,
                )
              }
            >
              导出抽点复核依据
            </button>
          </div>
        )}
      </section>
    </details>
  );
}
