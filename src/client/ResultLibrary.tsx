import { useState } from "react";
import type { AnalysisResult } from "../shared/types.js";
import { MAX_RESULT_BYTES, parseResultFile } from "../shared/result-file.js";
import { downloadJson } from "./api.js";

const storageKey = "yike.saved-results.v1";
function loadSaved(): AnalysisResult[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw || raw.length > 4_000_000) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(0, 5).flatMap((value) => {
      try {
        return [parseResultFile(JSON.stringify(value))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
export function ResultLibrary({
  result,
  disabled,
  onOpen,
}: {
  result: AnalysisResult | null;
  disabled: boolean;
  onOpen: (result: AnalysisResult) => void;
}) {
  const [saved, setSaved] = useState(loadSaved);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<AnalysisResult[] | null>(null);
  function store(values: AnalysisResult[]) {
    try {
      const raw = JSON.stringify(values);
      if (raw.length > 4_000_000) throw new Error("storage limit");
      localStorage.setItem(storageKey, raw);
      setSaved(values);
      setError("");
      return true;
    } catch {
      setError("浏览器保存空间不足，请下载结果文件保管。");
      return false;
    }
  }
  return (
    <details className="result-library control-section">
      <summary>保存与打开结果</summary>
      <p className="field-note">
        打开已有结果不会重新检索或测时。保存内容仅留在当前浏览器，最多5份。
      </p>
      <div className="library-actions">
        <button
          className="secondary"
          disabled={!result || disabled}
          onClick={() => {
            if (
              result &&
              store(
                [result, ...saved.filter((r) => r.id !== result.id)].slice(
                  0,
                  5,
                ),
              )
            ) {
              setUndo(null);
              setMessage("已保存到此浏览器。");
            }
          }}
        >
          保存本次结果
        </button>
        <button
          className="secondary"
          disabled={!result || disabled}
          onClick={() => {
            if (result)
              downloadJson(
                result,
                `yike-${result.mode}-${result.id.slice(0, 8)}.json`,
              );
          }}
        >
          下载结果文件
        </button>
      </div>
      <label className="field-label" htmlFor="result-import">
        打开结果文件
      </label>
      <input
        id="result-import"
        type="file"
        accept=".json,application/json"
        disabled={disabled}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            if (file.size > MAX_RESULT_BYTES)
              throw new Error("结果文件超过2MB，请选择单份体检结果。");
            const value = parseResultFile(await file.text());
            onOpen(value);
            setError("");
            setMessage("已打开结果，显示的是原记录时间的数据。");
          } catch (e) {
            setError(e instanceof Error ? e.message : "结果文件无法读取。");
          }
        }}
      />
      {saved.length > 0 && (
        <ul className="saved-results">
          {saved.map((r) => (
            <li key={r.id}>
              <button
                className="text-button saved-title"
                disabled={disabled}
                onClick={() => onOpen(r)}
              >
                <strong>{r.center.label}</strong>
                <span>
                  {r.mode === "demo" ? "模拟" : "百度接口"} ·{" "}
                  {new Date(r.generatedAt).toLocaleDateString("zh-CN")}
                </span>
              </button>
              <button
                className="text-button"
                disabled={disabled}
                aria-label={`移除已保存的${r.center.label}`}
                onClick={() => {
                  const before = saved;
                  if (store(saved.filter((v) => v.id !== r.id))) {
                    setUndo(before);
                    setMessage("已从浏览器移除，可撤销。");
                  }
                }}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      {undo && (
        <button
          className="text-button"
          onClick={() => {
            if (store(undo)) {
              setUndo(null);
              setMessage("已恢复保存记录。");
            }
          }}
        >
          撤销移除
        </button>
      )}
      {message && (
        <p className="field-note" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
