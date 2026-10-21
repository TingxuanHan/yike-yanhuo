import { useEffect, useState } from "react";
import type { QuotaSnapshot } from "../shared/types.js";
import { request } from "./api.js";

export function QuotaPanel({ busy }: { busy: boolean }) {
  const [data, setData] = useState<QuotaSnapshot | null>(null);
  const [error, setError] = useState("");
  const refresh = () =>
    request<QuotaSnapshot>("/api/quota")
      .then((value) => {
        setData(value);
        setError("");
      })
      .catch(() => setError("暂时无法读取预算记录，请稍后刷新。"));
  useEffect(() => {
    if (!busy) void refresh();
  }, [busy]);
  return (
    <details className="quota-panel control-section">
      <summary>今日调用预算</summary>
      {data && (
        <>
          <p className="field-note">{data.day} · 北京时间</p>
          <dl className="quota-counters">
            {(
              [
                ["route", "步行路线"],
                ["search", "地点检索"],
                ["other", "定位与转换"],
                ["map", "底图资源转发"],
              ] as const
            ).map(([id, label]) => (
              <div key={id}>
                <dt>{label}</dt>
                <dd>
                  {data.used[id]} / {data.limits[id]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-note">
            本项目本地计数，不含其他应用；底图资源数不等于平台计费量。
          </p>
        </>
      )}
      {error && (
        <p role="status" className="field-note">
          {error}
        </p>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void refresh()}
      >
        刷新预算记录
      </button>
    </details>
  );
}
