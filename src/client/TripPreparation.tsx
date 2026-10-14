import type { TripSession, TripView } from "../mini/trip.js";
import type { DeparturePlace } from "../shared/departure.js";
import { downloadDeparture } from "./offline-departure.js";
import { guideAge } from "../shared/walking-guide.js";

export function RoutinePanel({
  session,
  s,
}: {
  session: TripSession;
  s: TripView;
}) {
  return (
    <>
      {!s.active && !!s.routines.length && (
        <section
          className="planning-card routine-list"
          aria-label="常用出门方案"
        >
          <h3>照着常用安排，再出一趟门</h3>
          <p className="muted">按当前时间和步速重新核算，先看结果再出发。</p>
          {s.routines.slice(0, 3).map((r) => (
            <button
              className="secondary"
              key={r.id}
              disabled={s.busy}
              onClick={() => void session.useRoutine(r.id)}
            >
              {r.origin.position.system === "demo" ? "模拟 · " : ""}
              {r.name} · 重新核算
            </button>
          ))}
          <details>
            <summary>全部方案与管理（{s.routines.length}/8）</summary>
            {s.routines.map((r) => (
              <div className="routine-row" key={r.id}>
                <p>
                  {r.name} · {r.origin.name}
                </p>
                <div className="planning-actions">
                  <button
                    className="secondary"
                    disabled={s.busy}
                    onClick={() => void session.useRoutine(r.id)}
                  >
                    使用此方案
                  </button>
                  <button
                    className="secondary"
                    disabled={s.busy}
                    onClick={() => void session.removeRoutine(r.id)}
                  >
                    移除{r.name}
                  </button>
                </div>
              </div>
            ))}
          </details>
        </section>
      )}
      {!s.active && s.routineSuggestion && (
        <button className="secondary" onClick={() => session.offerRoutine()}>
          把上一趟存为常用方案
        </button>
      )}
      {s.routineDraft && (
        <section
          className="planning-card"
          id="routine-editor"
          aria-label="保存常用方案"
        >
          <h3>下次少填一点</h3>
          <label>
            常用方案名称
            <input
              value={s.routineDraft.name}
              maxLength={40}
              onChange={(e) => session.routineName(e.target.value)}
            />
          </label>
          <p className="muted">
            只记住要办的事、候选地点和预算等条件，使用时更新出发时间和步速。
          </p>
          <div className="planning-actions">
            <button className="primary" onClick={() => session.saveRoutine()}>
              保存常用方案
            </button>
            <button
              className="secondary"
              onClick={() => session.cancelRoutine()}
            >
              暂不保存
            </button>
          </div>
        </section>
      )}
    </>
  );
}
function Place({ p }: { p: DeparturePlace }) {
  return (
    <div className="departure-place">
      <h4>{p.name}</h4>
      <p>{p.address}</p>
      <p>{p.landmark}</p>
      {p.photo && (
        <div className="departure-photo">
          <img src={p.photo} alt={`${p.name}记录的入口照片`} />
          {p.marker && (
            <b
              style={{
                left: `${p.marker.x * 100}%`,
                top: `${p.marker.y * 100}%`,
              }}
              aria-label="记录的入口标记"
            >
              ＋
            </b>
          )}
        </div>
      )}
      <p className="muted">{p.freshness}</p>
      <p className="muted">{p.opening}</p>
    </div>
  );
}
export function TripPreparation({
  session,
  s,
}: {
  session: TripSession;
  s: TripView;
}) {
  const p = s.pack;
  if (!p) return null;
  return (
    <details
      key={p.preparedAt}
      className="planning-card departure-pack"
      id="trip-preparation"
      open
    >
      <summary>已保存的出门卡 · 预计{p.finish}回来</summary>
      <p className="muted">
        {new Date(p.preparedAt).toLocaleString("zh-CN")}保存 · {s.packAge}
      </p>
      {p.demo && (
        <p className="planning-error">模拟社区与示例价格 · 不可据此出行</p>
      )}
      {s.packOutdated && (
        <p role="alert" className="planning-error">
          当前行程已变化，这份卡尚未更新。请重新准备。
        </p>
      )}
      <h3>出门前看一眼</h3>
      {p.checks.slice(0, 2).map((c, i) => (
        <p key={i}>{c}</p>
      ))}
      <details>
        <summary>价格记录与路线依据</summary>
        {p.checks.slice(2).map((c, i) => (
          <p key={i}>{c}</p>
        ))}
      </details>
      {p.phone ? (
        <a className="primary" href={`tel:${p.phone}`}>
          拨打卡内家人电话
        </a>
      ) : (
        <p>卡内尚无家人电话，可在“联系家人”中保存后重新准备。</p>
      )}
      <p className="muted">
        资料已保存到本机，未发送给家人。下载离线文件后，关闭网页或断网也能打开文件查看。
      </p>
      <div className="planning-actions">
        <button className="secondary" onClick={() => downloadDeparture(p)}>
          下载离线出门卡
        </button>
        <button className="secondary" onClick={() => void session.removePack()}>
          移除本机出门卡
        </button>
      </div>
      <details open>
        <summary>返程地点 · {p.returnPlace.name}</summary>
        <Place p={p.returnPlace} />
      </details>
      <details>
        <summary>本次安排与沿途入口</summary>
        <ol>
          {p.schedule.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
        {p.places.map((x) => (
          <Place key={x.id} p={x} />
        ))}
      </details>
      <details>
        <summary>卡内步行步骤（{p.guides.length}段）</summary>
        {p.guides.map((g, i) => (
          <div key={i}>
            <h3>
              {g.from.name} → {g.to.name}
            </h3>
            <p className="muted">{guideAge(g)}</p>
            <ol>
              {g.steps.map((x, j) => (
                <li key={j}>{x.instruction}</li>
              ))}
            </ol>
          </div>
        ))}
        {p.guideMissing.map((l, i) => (
          <p key={i}>未获取：{l}</p>
        ))}
        <p className="muted">
          仅含已经获取的文字步骤，不跟踪定位。刷新步骤后需重新准备出门卡，现场通行情况优先。
        </p>
      </details>
    </details>
  );
}
