import { useEffect, useState } from "react";
import { HelperSession, type HelperState } from "../mini/assistance.js";
import { EntrancePhoto } from "./EntrancePhoto.js";
import { request } from "./api.js";
import "./planning.css";
import "./assistance.css";
export function HelperPage({ id, token }: { id: string; token: string }) {
  const [view, setView] = useState<HelperState | null>(null);
  const [session] = useState(
    () =>
      new HelperSession(async <T,>(method = "GET", body?: unknown) => {
        if (!/^[a-f0-9-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token))
          throw new Error("协助链接不完整，请让家人重新发送。");
        return request<T>(`/api/assistance/${id}`, {
          method,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: {
            "content-type": "application/json",
            "X-Yike-Assist": token,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      }, setView),
  );
  useEffect(() => {
    session.reopen();
    const change = () => (document.hidden ? session.close() : session.reopen());
    document.addEventListener("visibilitychange", change);
    return () => {
      session.close();
      document.removeEventListener("visibilitychange", change);
    };
  }, [session]);
  const s = view ?? session.state,
    v = s.view,
    p = v?.snapshot;
  const name = (id: string) => p?.stops.find((n) => n.id === id)?.name ?? id;
  return (
    <main className="helper-page planning-panel">
      <p className="eyebrow">一刻烟火 · 家人帮我一下</p>
      <h1>陪家人走好这一趟</h1>
      <p className="muted">
        仅查看这次分享的行程，建议由本人确认。称呼由协助者填写，请通过熟悉的联系方式确认彼此。
      </p>
      {s.error && (
        <p className="planning-error" role="alert">
          {s.error}
        </p>
      )}
      <button
        className="secondary"
        disabled={s.busy}
        onClick={() => void session.refresh()}
      >
        刷新协助
      </button>
      {!p && !s.error && <p role="status">正在连接这次协助…</p>}
      {p && v && (
        <>
          <section className="planning-card">
            <p className="eyebrow">
              {p.mode === "demo" ? "模拟行程 · 不可据此出行" : "本次行程"}
            </p>
            <h2>{p.request || "想请你帮忙看看"}</h2>
            <p>
              最后确认地点：<strong>{name(p.currentId)}</strong>
            </p>
            <p>
              确认于{new Date(p.confirmedAt).toLocaleString("zh-CN")} ·{" "}
              {p.phase === "walking"
                ? "正在前往下一站"
                : p.phase === "resting"
                  ? "正在歇脚"
                  : p.phase === "finished"
                    ? "已结束行程"
                    : "在确认地点"}
            </p>
            <p>
              剩余安排：{p.remaining.map(name).join(" → ") || "已回到出发点"}
            </p>
            <p>预计返程：{p.finish}</p>
            <p className="muted">
              这里显示手动确认记录，不是实时定位。对方打开行程页时更新。协助到
              {new Date(v.expiresAt).toLocaleTimeString("zh-CN")}结束。
            </p>
          </section>
          {p.guide && (
            <section className="planning-card">
              <h2>{p.guide.name} · 入口照片</h2>
              <EntrancePhoto
                photo={p.guide.photo}
                x={s.kind === "entrance" ? s.x : p.guide.x}
                y={s.kind === "entrance" ? s.y : p.guide.y}
                onMark={
                  s.kind === "entrance"
                    ? (x, y) => {
                        session.field("x", x);
                        session.field("y", y);
                      }
                    : undefined
                }
              />
              <p>{p.guide.instruction}</p>
              <p className="muted">
                照片观察日期：{p.guide.observedOn}；现场开放情况仍需确认。
              </p>
            </section>
          )}
          <section className="planning-card">
            <h2>给家人一个清楚的建议</h2>
            <p role="status">{s.status}</p>
            {v.proposal ? (
              <p className="assist-waiting">
                “{v.proposal.note}”已送达，等待本人核对。
              </p>
            ) : (
              <>
                {s.stale && (
                  <div className="planning-error">
                    <p>
                      对方行程或照片已变化，原草稿已保留，请按新进度重新编辑。
                    </p>
                    <button
                      className="secondary"
                      onClick={() => session.reset()}
                    >
                      按新进度重新编辑
                    </button>
                  </div>
                )}
                <label>
                  你的称呼
                  <input
                    value={s.helper}
                    maxLength={30}
                    onChange={(e) => session.field("helper", e.target.value)}
                  />
                </label>
                <label>
                  建议类型
                  <select
                    value={s.kind}
                    onChange={(e) => session.field("kind", e.target.value)}
                  >
                    <option value="message">提醒一句</option>
                    <option value="plan" disabled={p.phase !== "at"}>
                      调整剩余行程
                    </option>
                    <option value="entrance" disabled={!p.guide}>
                      圈出照片入口
                    </option>
                  </select>
                </label>
                {s.kind === "plan" && (
                  <>
                    <p>取消不去的地点，或将某站提前。返程自动保留。</p>
                    {p.remaining
                      .filter((id) => id !== p.homeId)
                      .map((id) => (
                        <label className="trip-check" key={id}>
                          <input
                            type="checkbox"
                            checked={s.remaining.includes(id)}
                            onChange={() => session.stop(id)}
                          />
                          {name(id)}
                        </label>
                      ))}
                    <ol>
                      {s.remaining.map((id) => (
                        <li key={id}>
                          {name(id)}{" "}
                          <button
                            className="secondary"
                            disabled={s.remaining.indexOf(id) === 0}
                            onClick={() => session.move(id)}
                          >
                            提前一站
                          </button>
                        </li>
                      ))}
                    </ol>
                    <label>
                      建议舒适步速（米/秒）
                      <input
                        type="number"
                        min="0.3"
                        max="2"
                        step="0.1"
                        value={s.speed}
                        onChange={(e) => session.field("speed", e.target.value)}
                      />
                    </label>
                    <p className="muted">
                      本人采纳前会按已知道路核算；缺少路线或营业窗口不合适时，原安排保留。
                    </p>
                  </>
                )}
                {s.kind === "entrance" && (
                  <p>点击上方照片圈出入口，或用键盘方向键调整标记。</p>
                )}
                <label>
                  给家人的说明
                  <textarea
                    value={s.note}
                    maxLength={240}
                    onChange={(e) => session.field("note", e.target.value)}
                    placeholder="例如：蓝色雨棚旁的侧门，先确认今天是否开放。"
                  />
                </label>
                <button
                  className="primary"
                  disabled={s.busy || s.stale || !s.note.trim()}
                  onClick={() => void session.send()}
                >
                  发送建议，等待本人确认
                </button>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
