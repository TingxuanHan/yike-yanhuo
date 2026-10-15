import {
  MOBILITY_OPTIONS,
  type TripSession,
  type TripView,
} from "../mini/trip.js";
export function MobilityPreferences({
  session,
  s,
}: {
  session: TripSession;
  s: TripView;
}) {
  return (
    <details className="planning-card mobility-preferences">
      <summary>我的通行需要</summary>
      <p className="muted">相关提醒会优先展示；不会据此认定一条路无障碍。</p>
      {MOBILITY_OPTIONS.map((o) => (
        <label className="trip-check" key={o.key}>
          <input
            type="checkbox"
            checked={s.mobility[o.key]}
            disabled={s.busy}
            onChange={() => session.mobilityNeed(o.key)}
          />
          {o.label}
        </label>
      ))}
      {s.mobility.needRest && (
        <p className="muted">
          备选用时不预留新增歇脚，请在已确认地点停留；已记录的休息点可在“步行与歇脚”查看。
        </p>
      )}
    </details>
  );
}
export function TripAlternatives({
  session,
  s,
}: {
  session: TripSession;
  s: TripView;
}) {
  const v = s.alternative;
  return (
    <section
      className="trip-alternatives"
      id="trip-alternatives"
      aria-label="备选安排"
    >
      {!v ? (
        <button
          className="secondary"
          disabled={
            s.busy || s.active?.phase !== "at" || s.active.remaining.length < 2
          }
          onClick={() => session.openAlternatives()}
        >
          下一站不好走？看看备选
        </button>
      ) : (
        <>
          <h3>换个地点，先算清楚</h3>
          <p>当前下一站：{s.next}</p>
          <div className="planning-actions">
            <button
              className={v.kind === "place" ? "primary" : "secondary"}
              disabled={s.busy}
              onClick={() => session.openAlternatives("place")}
            >
              换同类地点
            </button>
            <button
              className={v.kind === "entrance" ? "primary" : "secondary"}
              disabled={s.busy}
              onClick={() => session.openAlternatives("entrance")}
            >
              用我记录的另一入口
            </button>
          </div>
          <p className="muted">{v.note}</p>
          {v.candidates.length ? (
            <label>
              备选地点
              <select
                aria-label="备选地点"
                value={v.selected}
                disabled={s.busy}
                onChange={(e) => session.selectAlternative(e.target.value)}
              >
                {v.candidates.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p role="status">
              没有符合条件的备选。可先到地点簿记录入口，也可取消下一站或联系家人；保留已用地点后，一趟最多容纳5个地点。
            </p>
          )}
          <button
            className="secondary"
            disabled={s.busy || !v.selected}
            onClick={() => void session.previewAlternative()}
          >
            {s.busy ? "正在核算…" : "比较时间和费用"}
          </button>
          {!!v.changes.length && (
            <div className="trip-alternative-preview" aria-live="polite">
              <h4>核对后再换</h4>
              {v.changes.slice(0, 4).map((c, i) => (
                <p key={i}>{c}</p>
              ))}
              <details>
                <summary>估计口径与待确认项</summary>
                {v.changes.slice(4).map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
              </details>
              {s.mobility.needRest && (
                <p>需要途中歇脚：新增休息时间尚未计入，请留出余量。</p>
              )}
              <button
                className="primary"
                disabled={s.busy}
                onClick={() => void session.applyAlternative()}
              >
                确认替换下一站
              </button>
            </div>
          )}
          <button
            className="text-button"
            disabled={s.busy}
            onClick={() => session.closeAlternatives()}
          >
            保留原安排并收起
          </button>
        </>
      )}
    </section>
  );
}
