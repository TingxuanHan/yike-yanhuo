import type { WalkingGuideSession, GuideView } from "../mini/walking-guide.js";
import { NeighborhoodPanel } from "./NeighborhoodPanel.js";
import { guideNotices } from "../mini/neighborhood.js";
export function WalkingGuidePanel({
  session,
  s,
}: {
  session: WalkingGuideSession;
  s: GuideView;
}) {
  if (!s.open) return null;
  const leg = s.legs[s.selected],
    g = s.guide,
    step = g?.steps[s.step],
    neighborhood = leg ? guideNotices(leg, g) : null;
  return (
    <section
      className="planning-card walking-guide"
      id="walking-guide"
      aria-label="这一段怎么走"
      aria-busy={s.busy}
    >
      <h3>这一段怎么走</h3>
      {neighborhood && (
        <NeighborhoodPanel
          query={neighborhood.query}
          choices={neighborhood.choices}
        />
      )}
      <p>先核对自己所在位置；这里从选定起点说明走法，不读取实时定位。</p>
      <label>
        选择路段
        <select
          value={s.selected}
          onChange={(e) => session.select(Number(e.target.value))}
          disabled={s.busy}
        >
          {s.legs.map((l, i) => (
            <option key={i} value={i}>
              {i + 1}. {l.from.name} → {l.to.name}
            </option>
          ))}
        </select>
      </label>
      {leg?.from.position.system === "demo" && (
        <p className="planning-error">模拟道路步骤 · 不可据此出行</p>
      )}
      {s.error && (
        <p className="planning-error" role="alert">
          {s.error}
        </p>
      )}
      {s.status && <p role="status">{s.status}</p>}
      {g && step ? (
        <>
          <p className="muted">{s.age}</p>
          <p>
            本段约{Math.round(g.meters)}米 · 地图参考
            {Math.round(g.seconds / 60)}分钟；你的步速、等候和办事用时见行程。
          </p>
          <div className="walking-step" aria-live="polite">
            <p>
              第 {s.step + 1} / {g.steps.length} 条
            </p>
            <p>{step.instruction}</p>
          </div>
          <div className="planning-actions">
            <button
              className="secondary"
              disabled={s.step === 0}
              onClick={() => session.turn(-1)}
            >
              上一条指引
            </button>
            <button
              className="primary"
              disabled={s.step === g.steps.length - 1}
              onClick={() => session.turn(1)}
            >
              下一条指引
            </button>
          </div>
          <p className="muted">
            翻页只记录阅读进度。是否到达请回到行程中手动确认，过街和通行情况以现场为准。
          </p>
          <details>
            <summary>查看整段步骤</summary>
            <ol>
              {g.steps.map((x, i) => (
                <li key={i}>{x.instruction}</li>
              ))}
            </ol>
          </details>
        </>
      ) : (
        <p className="muted">
          还没有保存这段步骤。获取失败时可继续使用原行程与入口资料。
        </p>
      )}
      <div className="planning-actions">
        <button
          className="secondary"
          disabled={s.busy}
          onClick={() => void session.load()}
        >
          {s.busy
            ? "正在读取这一段…"
            : g
              ? "重新获取这一段"
              : leg?.from.position.system === "demo"
                ? "查看模拟步骤"
                : "获取这一段步行步骤"}
        </button>
        <button className="secondary" onClick={() => session.close()}>
          收起步行指引
        </button>
      </div>
    </section>
  );
}
