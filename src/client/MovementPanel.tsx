import { useEffect, useRef, useState } from "react";
import type { LifeBook } from "../shared/life.js";
import {
  MovementSession,
  type MovementView,
  type MovementTrip,
  type MovementSettings,
} from "../mini/movement.js";
import "./movement.css";
export function MovementPanel({
  book,
  save,
  trip,
  back,
}: {
  book: LifeBook;
  save: (b: LifeBook) => void;
  trip: MovementTrip;
  back: () => void;
}) {
  const saving = useRef(save);
  saving.current = save;
  const [view, setView] = useState<MovementView | null>(null);
  const [session] = useState(
    () =>
      new MovementSession(book, trip, {
        get: (k) => JSON.parse(localStorage.getItem(k) || "null"),
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
        save: (b) => saving.current(b),
        notify: setView,
      }),
  );
  useEffect(() => {
    session.reopen();
    return () => session.close();
  }, [session]);
  useEffect(() => session.sync(book), [book, session]);
  const s = view ?? session.state,
    p = s.preview;
  const field = (
    key: Exclude<keyof MovementSettings, "mode" | "returnEasy">,
    label: string,
    step = "1",
  ) => (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={s.settings[key]}
        onChange={(e) => session.change(key, e.target.value)}
      />
    </label>
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.copyText());
      session.message("步行安排已复制。");
    } catch {
      session.message("复制未完成，请使用HTTPS或检查剪贴板权限后重试。", true);
    }
  };
  return (
    <section className="movement-panel outing-panel">
      <button className="subtle" onClick={back}>
        返回原行程
      </button>
      <header>
        <p className="eyebrow">办完事，也走得更舒服</p>
        <h2>顺路动一动</h2>
        <p>沿着已选路线，安排适合自己的步行节奏。</p>
      </header>
      <div className="movement-source">
        <strong>{s.source}</strong>
        <p>{s.route}</p>
        <p>{s.original}</p>
      </div>
      {s.error && (
        <p className="movement-error" role="alert">
          {s.error}
        </p>
      )}
      {s.status && <p role="status">{s.status}</p>}
      <fieldset className="outing-form">
        <legend>这一趟怎么走</legend>
        <div className="movement-modes">
          <button
            className={s.settings.mode === "easy" ? "primary" : "subtle"}
            aria-pressed={s.settings.mode === "easy"}
            onClick={() => session.change("mode", "easy")}
          >
            全程轻松走
          </button>
          <button
            className={s.settings.mode === "alternating" ? "primary" : "subtle"}
            aria-pressed={s.settings.mode === "alternating"}
            onClick={() => session.change("mode", "alternating")}
          >
            轻快交替走
          </button>
        </div>
        <div className="movement-fields">
          {field("targetMinutes", "希望步行（分钟）")}
          {field("maxExtraMinutes", "比原方案最多多用（分钟）")}
          {field("easyMps", "我的轻松步速（米/秒）", "0.1")}
          {s.settings.mode === "alternating" &&
            field("briskMps", "我能舒服接受的稍快步速（米/秒）", "0.1")}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={s.settings.returnEasy}
            onChange={(e) => session.change("returnEasy", e.target.checked)}
          />
          返程轻松走，适合买完东西后慢慢回家
        </label>
        <p className="muted">
          步速按自己的舒适程度选择。路口、拥挤或不平的路段以现场通行为先，感到不适就停止运动安排。
        </p>
        <details>
          <summary>节奏与连续步行设置</summary>
          <div className="movement-fields">
            {s.settings.mode === "alternating" && (
              <>
                {field("warmMinutes", "开始先轻松走（分钟）")}
                {field("briskMinutes", "每段稍快走（分钟）")}
                {field("recoverMinutes", "每段轻松调整（分钟）")}
              </>
            )}
            {field("continuousMinutes", "连续步行上限（0为不限）")}
          </div>
          <p className="muted">
            只有原行程中已核验的歇脚点才重置连续步行；等灯和逛店不算坐下休息。
          </p>
        </details>
        <div className="movement-actions">
          <button className="primary" onClick={() => session.calculate()}>
            安排这一趟怎么走
          </button>
          <button className="subtle" onClick={() => session.save()}>
            保存步行偏好
          </button>
          <button
            className="subtle"
            onClick={() => {
              if (window.confirm("载入地点簿保存的步行偏好，会替换当前设置。"))
                session.load();
            }}
          >
            载入保存的偏好
          </button>
        </div>
      </fieldset>
      {p && (
        <section className="movement-result" aria-label="步行安排结果">
          <p className="eyebrow">
            {s.demo ? "离线示例 · 计划参考" : "已选路线 · 计划参考"}
          </p>
          <h3>{p.feasible ? "这趟时间安排可行" : "需要调整这趟安排"}</h3>
          {p.issues.map((x) => (
            <p className="movement-error" key={x}>
              {x}
            </p>
          ))}
          <p className="movement-total">{p.summary}</p>
          <p>{p.returnText}</p>
          <p>
            {p.brisk} · {p.other}
          </p>
          <p>{p.extra}</p>
          <p className="movement-goal">{p.goal}</p>
          <p className="muted">
            以上是计划值，不是已完成运动量，也不据此判断运动强度或消耗热量。
          </p>
          <ol className="movement-legs">
            {p.legs.map((l) => (
              <li key={l.id}>
                <h4>{l.name}</h4>
                <p>{l.time}</p>
                <p>{l.stop}</p>
                <details>
                  <summary>查看这一段的步行节奏</summary>
                  <ol className="movement-phases">
                    {l.phases.map((v) => (
                      <li key={v.id} className={v.kind}>
                        <strong>{v.label}</strong>
                        <span>{v.detail}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ol>
          <details>
            <summary>估算依据和待确认信息</summary>
            <p>
              复用已选行程的路段距离，重新计算步速、营业等待和所设等灯假设。不增加地图请求，不识别实际路口、坡度或路面。
            </p>
            {p.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            <p>
              节奏是路段内的示意安排；在安全位置停下再查看手机，不作逐路口导航。
            </p>
          </details>
          <button
            className="subtle"
            disabled={!p.feasible}
            onClick={() => void copy()}
          >
            复制步行安排
          </button>
        </section>
      )}
    </section>
  );
}
