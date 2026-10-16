import { useEffect, useMemo, useRef, useState } from "react";
import {
  verificationTasks,
  verificationDrill,
  verificationDiff,
  verificationEvidence,
  parseVerificationEvidence,
  VERIFICATION_BACKUP_KEY,
  type VerificationPlan,
} from "../core/verification.js";
import type { GapCategory } from "../core/coverage.js";
import type { AnalysisResult, Job } from "../shared/types.js";
import { parseResultFile } from "../shared/result-file.js";
import { request, downloadJson } from "./api.js";
import "./verification.css";

interface Prepared {
  fingerprint: string;
  plan: VerificationPlan;
  requestId: string;
}
export function VerificationPanel({
  result,
  category,
  minutes,
  onApply,
  previous,
}: {
  result: AnalysisResult;
  category: GapCategory;
  minutes: number;
  onApply: (value: AnalysisResult, before: AnalysisResult) => void;
  previous?: AnalysisResult | null;
}) {
  const listing = useMemo(() => {
    try {
      return { tasks: verificationTasks(result, category, minutes), error: "" };
    } catch (e) {
      return { tasks: [], error: (e as Error).message };
    }
  }, [result, category, minutes]);
  const [ids, setIds] = useState<string[]>([]),
    [prepared, setPrepared] = useState<Prepared | null>(null),
    [finished, setFinished] = useState<AnalysisResult | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const operation = useRef(0),
    controller = useRef<AbortController | null>(null),
    job = useRef<string | null>(null);
  const resultTarget = useRef<HTMLDivElement>(null);
  const completedSource = useRef<AnalysisResult | null>(null);
  const cancel = () => {
    operation.current++;
    controller.current?.abort();
    controller.current = null;
    const id = job.current;
    job.current = null;
    if (id)
      void request(`/api/analyses/${id}`, { method: "DELETE" }).catch(() => {});
  };
  useEffect(() => {
    cancel();
    setIds([]);
    setPrepared(null);
    setFinished(null);
    completedSource.current = null;
    setRunning(false);
    setError("");
    setStatus("");
    return cancel;
  }, [result, category, minutes]);
  const pending = completedSource.current === result ? finished : null;
  const shown =
    pending ?? (result.verification?.sourceId === previous?.id ? result : null);
  const before = pending ? result : previous;
  const diff =
    shown && before ? verificationDiff(before, shown, category, minutes) : null;
  const tasks = listing.tasks.filter((t) => t.kind !== "field"),
    fields = listing.tasks.filter((t) => t.kind === "field");
  const body = () => ({ result, category, minutes, taskIds: ids });
  const adopt = (next: AnalysisResult, source: AnalysisResult) => {
    try {
      localStorage.setItem(
        VERIFICATION_BACKUP_KEY,
        JSON.stringify(verificationEvidence(source, next, category, minutes)),
      );
      onApply(next, source);
    } catch (e) {
      setError(
        `未采用结果，原报告保留。${(e as Error).message} 如空间不足，请先导出备份。`,
      );
    }
  };
  async function preview() {
    cancel();
    const token = operation.current,
      abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError("");
    setPrepared(null);
    setFinished(null);
    setStatus("正在核对本次补查范围");
    try {
      const value = await request<{
        fingerprint: string;
        plan: VerificationPlan;
      }>("/api/verification/preview", {
        method: "POST",
        body: JSON.stringify(body()),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      });
      if (token !== operation.current) return;
      setPrepared({
        ...value,
        requestId: crypto.randomUUID().replaceAll("-", ""),
      });
      setStatus("用量已核对，确认后才执行所选任务。");
    } catch (e) {
      if (token === operation.current) setError((e as Error).message);
    } finally {
      if (token === operation.current) setRunning(false);
    }
  }
  async function run() {
    if (!prepared) return;
    const token = operation.current,
      abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError("");
    setFinished(null);
    setStatus("准备执行所选任务");
    try {
      const started = await request<{ id: string }>("/api/verification", {
        method: "POST",
        body: JSON.stringify({
          ...body(),
          fingerprint: prepared.fingerprint,
          requestId: prepared.requestId,
          confirmed: true,
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      });
      if (token !== operation.current) {
        void request(`/api/analyses/${started.id}`, { method: "DELETE" }).catch(
          () => {},
        );
        return;
      }
      job.current = started.id;
      const until = Date.now() + 300_000;
      for (;;) {
        if (token !== operation.current) return;
        const state = await request<Job>(`/api/analyses/${started.id}`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        if (token !== operation.current) return;
        if (state.status === "done" && state.result) {
          const next = parseResultFile(JSON.stringify(state.result));
          verificationEvidence(result, next, category, minutes);
          completedSource.current = result;
          setFinished(next);
          job.current = null;
          setPrepared(null);
          setStatus("补查完成。先看变化，再决定是否采用。");
          requestAnimationFrame(() => resultTarget.current?.focus());
          break;
        }
        if (state.status !== "running") {
          job.current = null;
          setPrepared(null);
          throw new Error(state.error || "补查未能完成，原报告保留。");
        }
        if (Date.now() > until)
          throw new Error("补查等待超时，原报告保留。可停止后重试。");
        setStatus(
          `${state.progress.stage} ${state.progress.done}/${state.progress.total}`,
        );
        await new Promise<void>((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(new DOMException("Cancelled", "AbortError"));
          };
          const timer = setTimeout(() => {
            abort.signal.removeEventListener("abort", stop);
            resolve();
          }, 750);
          abort.signal.addEventListener("abort", stop, { once: true });
        });
      }
    } catch (e) {
      if (token === operation.current) setError((e as Error).message);
    } finally {
      if (token === operation.current) setRunning(false);
    }
  }
  return (
    <details className="verification-panel">
      <summary>补齐缺失数据</summary>
      <section aria-label="定向补核查">
        <h3>这次先核实哪里？</h3>
        <p>选择最多3项。只补取缺失测时或局部设施，原报告保留。</p>
        {result.mode === "demo" && (
          <button
            className="secondary"
            disabled={running}
            onClick={() => {
              try {
                onApply(verificationDrill(result, category), result);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            体验模拟缺测
          </button>
        )}
        <button
          className="secondary"
          disabled={running}
          onClick={() => {
            try {
              const raw = localStorage.getItem(VERIFICATION_BACKUP_KEY);
              if (!raw) throw new Error("本机尚无补查备份。");
              const saved = parseVerificationEvidence(raw);
              onApply(saved.after, saved.before);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          打开最近补查记录
        </button>
        {previous && result.verification?.sourceId === previous.id && (
          <button
            className="secondary"
            disabled={running}
            onClick={() => onApply(previous, result)}
          >
            恢复补查前报告
          </button>
        )}
        {(error || listing.error) && (
          <p className="error" role="alert">
            {error || listing.error}
          </p>
        )}
        {tasks.length ? (
          <fieldset className="verification-tasks" disabled={running}>
            <legend>选择接口补查任务</legend>
            {tasks.map((task) => (
              <label key={task.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(task.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...ids, task.id]
                      : ids.filter((id) => id !== task.id);
                    if (next.length > 3) {
                      setError("一次最多选择3项，请分次核查。");
                      return;
                    }
                    cancel();
                    setIds(next);
                    setPrepared(null);
                    setFinished(null);
                    setError("");
                    setStatus("");
                  }}
                />
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.reason}</small>
                  <small>{task.influence}</small>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="notice">
            当前范围没有可执行的接口补查任务。仍可按现场清单核实入口和营业情况。
          </p>
        )}
        {!!tasks.length && !prepared && (
          <button
            className="primary"
            disabled={!ids.length || running}
            onClick={() => void preview()}
          >
            查看补查用量
          </button>
        )}
        {prepared && (
          <div className="verification-plan">
            <strong>
              {result.mode === "demo"
                ? "模拟演练，不消耗百度额度"
                : `本次上限：测时${prepared.plan.maxRouteUnits}条、检索${prepared.plan.maxSearchUnits}次`}
            </strong>
            <p>
              {result.mode === "demo"
                ? "使用人工构造道路与设施，仅演示补查流程。"
                : "上限已包含一次重试余量；命中缓存的实际用量可能更低。全站日额度和串行队列继续生效。"}
            </p>
            <button
              className="primary"
              disabled={running}
              onClick={() => void run()}
            >
              确认执行所选任务
            </button>
          </div>
        )}
        {running && (
          <button
            className="secondary"
            onClick={() => {
              const known = job.current;
              cancel();
              if (known) setPrepared(null);
              setRunning(false);
              setStatus("已停止等待。已发出的调用可能已计入用量，原报告保留。");
            }}
          >
            停止本次补查
          </button>
        )}
        {status && <p role="status">{status}</p>}
        {shown && before && diff && (
          <div
            className="verification-diff"
            ref={resultTarget}
            tabIndex={-1}
            aria-label="补查前后变化"
          >
            <p className="eyebrow">
              {shown.mode === "demo"
                ? "模拟缺测演练 · 非真实社区"
                : "历史报告与本次补查 · 未现场验证"}
            </p>
            <h4>补查前后有什么变化？</h4>
            <dl>
              <div>
                <dt>有效测时点</dt>
                <dd>
                  {diff.knownSamplesBefore} → {diff.knownSamplesAfter}
                </dd>
              </div>
              <div>
                <dt>新增地图设施</dt>
                <dd>{diff.newFacilities}处</dd>
              </div>
              <div>
                <dt>待核查面积</dt>
                <dd>
                  {diff.unknownBefore} → {diff.unknownAfter} km²
                </dd>
              </div>
              <div>
                <dt>本次步行范围</dt>
                <dd>
                  {diff.domainBefore} → {diff.domainAfter} km²
                </dd>
              </div>
            </dl>
            <p className="caption">{diff.note}</p>
            {shown.verification!.receipts.map((receipt) => (
              <p className="caption" key={receipt.taskId}>
                {receipt.message}
              </p>
            ))}
            <div className="verification-actions">
              <button
                className="secondary"
                onClick={() =>
                  downloadJson(
                    verificationEvidence(before, shown, category, minutes),
                    "yike-verification-before-after.json",
                  )
                }
              >
                导出补查前后依据
              </button>
              {pending && (
                <button
                  className="primary"
                  onClick={() => adopt(pending, result)}
                >
                  采用补查结果
                </button>
              )}
            </div>
          </div>
        )}
        {!!fields.length && (
          <details className="verification-fields">
            <summary>带着现场核查清单出门</summary>
            <ul>
              {fields.map((field) => (
                <li key={field.id}>
                  <strong>{field.title}</strong>
                  <p>{field.reason}</p>
                </li>
              ))}
            </ul>
            <button
              className="secondary"
              onClick={() =>
                downloadJson(
                  {
                    schema: "yike-field-checklist-v1",
                    sourceId: result.id,
                    sourceGeneratedAt: result.generatedAt,
                    evidence:
                      result.mode === "demo"
                        ? "simulation"
                        : "needs-field-observation",
                    tasks: fields,
                  },
                  "yike-field-checklist.json",
                )
              }
            >
              导出现场清单
            </button>
          </details>
        )}
        <details>
          <summary>如何排序与判定</summary>
          <p>
            任务按可能关联的缺测片区粗排，关联范围可能重叠，不能相加为预期收益。局部结果未取完时，空白仍为待核查；新发现设施不会在本轮自动追加测时。入口、营业和临时障碍需要现场确认。
          </p>
        </details>
      </section>
    </details>
  );
}
