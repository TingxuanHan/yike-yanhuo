import { useRef, useState } from "react";
import type { AnalysisResult, FacilityEvidence } from "../shared/types.js";
import { REVIEW_LABELS, reviewState } from "../shared/facility-review.js";
import {
  applyEvidenceFile,
  evidenceFile,
  MAX_EVIDENCE_BYTES,
  parseEvidenceFile,
  type EvidenceFile,
} from "../core/poi-evidence.js";
import { downloadJson } from "./api.js";
import { ReviewReminders } from "./ReviewReminders.js";

export function FacilityReview({
  result,
  disabled,
  onChange,
}: {
  result: AnalysisResult;
  disabled: boolean;
  onChange: (result: AnalysisResult) => void;
}) {
  const [facilityId, setFacilityId] = useState(result.facilities[0]?.id ?? "");
  const [status, setStatus] = useState<FacilityEvidence["status"]>("uncertain");
  const [source, setSource] = useState("");
  const [recordId, setRecordId] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [reviewDays, setReviewDays] = useState("30");
  const editor = useRef<HTMLDetailsElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const [basis, setBasis] = useState("");
  const [pending, setPending] = useState<EvidenceFile | null>(null);
  const [undo, setUndo] = useState<AnalysisResult | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const reviewed = result.facilities.filter((f) => f.evidence?.length).length;
  const conflicts = result.facilities.filter(
    (f) => reviewState(f) === "conflict",
  ).length;
  const apply = (file: EvidenceFile) => {
    setError("");
    try {
      const updated = applyEvidenceFile(result, file);
      setUndo(result);
      onChange(updated);
      setPending(null);
      setMessage(
        `已应用 ${file.entries.length} 条核查记录。请保存本次结果或导出数据，刷新页面前可撤销。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "核查记录未能应用。");
    }
  };
  return (
    <section className="facility-review no-print" aria-label="设施核查">
      <h3>设施核查</h3>
      <p className="review-summary">
        {reviewed} / {result.facilities.length} 处有核查记录 · {conflicts}{" "}
        处来源冲突
      </p>
      <p className="caption">
        补充社区台账、公告或现场观察的来源与依据。停用、待核查或冲突的设施暂不计入数量和覆盖；未核查的地图条目仍按原检索结果展示。核查不重新测时。
      </p>
      <ReviewReminders
        facilities={result.facilities}
        onReview={(id, entry) => {
          setFacilityId(id);
          setSource(entry.source);
          setRecordId(entry.recordId);
          setStatus("uncertain");
          setCheckedAt("");
          setBasis("");
          setPending(null);
          setError("");
          setMessage(
            "已带入来源和编号，请填写本次实际核查的时间、结论与依据。",
          );
          if (editor.current) editor.current.open = true;
          requestAnimationFrame(() => sourceInput.current?.focus());
        }}
      />
      <details ref={editor}>
        <summary>记录或导入核查</summary>
        <fieldset disabled={disabled} className="review-fields">
          <legend className="sr-only">核查内容</legend>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (!checkedAt || !Number.isFinite(Date.parse(checkedAt)))
                  throw new Error("请填写核查时间。");
                apply({
                  format: "yike-poi-evidence-v1",
                  resultId: result.id,
                  entries: [
                    {
                      facilityId,
                      evidence: {
                        source,
                        recordId,
                        status,
                        checkedAt: new Date(checkedAt).toISOString(),
                        ...(reviewDays === "none"
                          ? {}
                          : {
                              nextReviewAt: new Date(
                                Date.parse(checkedAt) +
                                  Number(reviewDays) * 86_400_000,
                              ).toISOString(),
                            }),
                        basis,
                      },
                    },
                  ],
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : "请核对填写内容。");
              }
            }}
          >
            <div className="review-form-grid">
              <label>
                核查设施
                <select
                  value={facilityId}
                  onChange={(e) => setFacilityId(e.target.value)}
                  required
                >
                  {result.facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} · {REVIEW_LABELS[reviewState(f)]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                核查结论
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as FacilityEvidence["status"])
                  }
                >
                  <option value="uncertain">信息待核查</option>
                  <option value="confirmed">确认可用</option>
                  <option value="closed">确认停用</option>
                </select>
              </label>
              <label>
                来源名称
                <input
                  required
                  maxLength={120}
                  ref={sourceInput}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="如：社区设施台账"
                />
              </label>
              <label>
                来源内编号
                <input
                  required
                  maxLength={200}
                  value={recordId}
                  onChange={(e) => setRecordId(e.target.value)}
                  placeholder="台账编号或自定观察编号"
                />
              </label>
              <label>
                核查时间（本地时间）
                <input
                  required
                  type="datetime-local"
                  value={checkedAt}
                  onChange={(e) => setCheckedAt(e.target.value)}
                />
              </label>
              <label>
                下次复核提醒
                <select
                  value={reviewDays}
                  onChange={(e) => setReviewDays(e.target.value)}
                >
                  <option value="7">本次核查后7天</option>
                  <option value="30">本次核查后30天</option>
                  <option value="90">本次核查后90天</option>
                  <option value="none">暂不设置</option>
                </select>
              </label>
              <label className="review-basis">
                核查依据
                <textarea
                  required
                  rows={3}
                  maxLength={500}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  placeholder="注明公告日期、文档页码或观察情况，便于后续复查"
                />
              </label>
            </div>
            <button className="primary" disabled={!facilityId}>
              记录核查
            </button>
          </form>
          <div className="review-file-tools">
            <label htmlFor="evidence-import">
              批量导入核查文件（JSON，最多500KB）
            </label>
            <input
              id="evidence-import"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                setPending(null);
                setError("");
                setMessage("");
                if (!file) return;
                try {
                  if (file.size > MAX_EVIDENCE_BYTES)
                    throw new Error("核查文件超过500KB。");
                  const parsed = parseEvidenceFile(await file.text(), result);
                  // Check per-facility capacity before presenting an applicable preview.
                  applyEvidenceFile(result, parsed);
                  setPending(parsed);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "文件读取失败，原报告已保留。",
                  );
                }
              }}
            />
            <div className="review-actions">
              <button
                className="secondary"
                onClick={() =>
                  downloadJson(
                    {
                      format: "yike-poi-evidence-v1",
                      resultId: result.id,
                      entries: result.facilities.map((f) => ({
                        facilityId: f.id,
                        facilityName: f.name,
                        evidence: {
                          source: "",
                          recordId: "",
                          checkedAt: "",
                          status: "uncertain",
                          basis: "",
                        },
                      })),
                    },
                    "yike-poi-template.json",
                  )
                }
              >
                下载填写模板
              </button>
              <button
                className="secondary"
                disabled={!reviewed}
                onClick={() =>
                  downloadJson(evidenceFile(result), "yike-poi-evidence.json")
                }
              >
                导出核查记录
              </button>
            </div>
            <p className="caption">
              模板含设施编号，填写后只保留已核查条目。时间使用ISO格式，如2026-10-05T02:00:00Z；也可直接用上方表单。来源与编号共同标识一条记录，更新时保留相同编号。
            </p>
          </div>
          {pending && (
            <div
              className="review-preview"
              role="region"
              aria-label="核查导入预览"
            >
              <h4>待应用 {pending.entries.length} 条记录</h4>
              <ul>
                {pending.entries.slice(0, 8).map((entry, i) => (
                  <li key={i}>
                    {
                      result.facilities.find((f) => f.id === entry.facilityId)
                        ?.name
                    }{" "}
                    · {REVIEW_LABELS[entry.evidence.status]} ·{" "}
                    {entry.evidence.source}
                  </li>
                ))}
              </ul>
              {pending.entries.length > 8 && (
                <p>其余 {pending.entries.length - 8} 条随文件一起应用。</p>
              )}
              <p>
                各来源记录均会保留，来源冲突会标为待核查。原始坐标与路线测时保持不变。
              </p>
              <div className="review-actions">
                <button className="primary" onClick={() => apply(pending)}>
                  应用本次核查
                </button>
                <button className="secondary" onClick={() => setPending(null)}>
                  取消导入
                </button>
              </div>
            </div>
          )}
          {undo && (
            <button
              className="text-button"
              onClick={() => {
                onChange(undo);
                setUndo(null);
                setPending(null);
                setMessage("已撤销上一次核查，恢复此前报告。");
                setError("");
              }}
            >
              撤销上一次核查
            </button>
          )}
        </fieldset>
        {message && (
          <p role="status" className="field-note">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </details>
    </section>
  );
}
