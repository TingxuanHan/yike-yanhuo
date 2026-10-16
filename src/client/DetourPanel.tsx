import { useEffect, useMemo, useState } from "react";
import {
  detourView,
  detourEvidence,
  DETOUR_LIMITS,
} from "../core/detour-audit.js";
import type { AnalysisResult } from "../shared/types.js";
import { downloadJson } from "./api.js";
import "./facility-siting.css";

export function DetourPanel({
  result,
  minutes,
}: {
  result: AnalysisResult;
  minutes: number;
}) {
  const view = useMemo(() => detourView(result, minutes), [result, minutes]);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [result, minutes]);
  return (
    <details className="siting-panel detour-panel">
      <summary>看起来很近，为什么要走更远？</summary>
      <section aria-label="绕行代价诊断">
        <p className="eyebrow">{view.sourceLabel}</p>
        <h3>{view.headline}</h3>
        <p>
          直线附近的{view.knownPoints}个有效已测点中，有{view.timeExceeded}
          个按现有记录超出{minutes}分钟。
        </p>
        <p className="caption">
          用{view.speedMps}米/秒、不计等灯的直线{view.directRadius}
          米作为对照。只核对已有点，点数不代表面积或发生率。{view.timeLabel}。
        </p>
        {view.rows.slice(0, more ? 8 : 3).map((r) => (
          <article key={r.id} className="siting-condition-row">
            <strong>
              {r.number}. {r.name}
            </strong>
            <p>
              直线{r.direct}米 → 路线{r.route}米
            </p>
            <p className="siting-conclusion">
              多走约{r.extra}米 · 约{r.ratioLabel}倍 · {r.time}分钟
              {r.outsideTime ? "（超出所选时长）" : ""}
            </p>
            <details>
              <summary>带去现场核查</summary>
              <p>{r.coordinates}</p>
              <p>
                核对入口、道路连通和过街设施；这些线索不能确定障碍原因或可用捷径。
              </p>
            </details>
          </article>
        ))}
        {view.rows.length > 3 && (
          <button className="quiet" onClick={() => setMore(!more)}>
            {more ? "收起其余线索" : "展开其余线索（最多8处）"}
          </button>
        )}
        <p className="caption">
          默认列3处，最多展开8处，按额外距离排序。没有线索不表示没有绕行或障碍。
        </p>
        <details>
          <summary>未纳入的点与判定口径</summary>
          <p>
            缺测{view.unknownPoints}处 · 未能连接{view.unreachablePoints}处 ·
            记录分歧{view.conflictPoints}处 · 距离异常{view.inconsistentPoints}
            处。出发点80米内另行排除，避免比值放大。
          </p>
          <ul>
            {DETOUR_LIMITS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p>
            基础记录：{view.baseGeneratedAt}
            。后续补查可能包含新旧记录，导出保留完整来源。
          </p>
        </details>
        <button
          className="secondary"
          onClick={() =>
            downloadJson(
              detourEvidence(result, minutes),
              `yike-detour-${minutes}.json`,
            )
          }
        >
          导出绕行核查依据
        </button>
      </section>
    </details>
  );
}
