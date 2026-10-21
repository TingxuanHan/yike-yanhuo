import { useEffect, useState } from "react";
import {
  NeighborhoodSession,
  NOTICE_KINDS,
  NOTICE_SIDES,
  type NeighborhoodView,
  type NoticeChoice,
} from "../mini/neighborhood.js";
import { cleanNoticeQuery, type NoticeQuery } from "../shared/neighborhood.js";
import { request } from "./api.js";
import { localValue } from "./FamilyPanel.js";
import "./neighborhood.css";
import { cleanMobility, type MobilityNeeds } from "../shared/mobility.js";
const ages = [
  [0, "刚刚"],
  [15, "约15分钟前"],
  [60, "约1小时前"],
  [180, "约3小时前"],
  [720, "约12小时前"],
  [1440, "约1天前"],
] as const;
export function NeighborhoodPanel({
  query,
  choices = [],
  mobility,
  onAlternative,
}: {
  query: NoticeQuery;
  choices?: NoticeChoice[];
  mobility?: MobilityNeeds;
  onAlternative?: () => void;
}) {
  const clean = cleanNoticeQuery(query);
  return (
    <Panel
      key={JSON.stringify([clean, choices])}
      query={clean}
      choices={choices}
      mobility={mobility}
      onAlternative={onAlternative}
    />
  );
}
function Panel({
  query,
  choices,
  mobility,
  onAlternative,
}: {
  query: NoticeQuery;
  choices: NoticeChoice[];
  mobility?: MobilityNeeds;
  onAlternative?: () => void;
}) {
  const [view, setView] = useState<NeighborhoodView | null>(null);
  const [session] = useState(
    () =>
      new NeighborhoodSession(query, choices, {
        request: <T,>(path: string, method = "GET", body?: unknown) =>
          request<T>(path, {
            method,
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
          }),
        get: localValue,
        set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
        confirm: async (message) => window.confirm(message),
        notify: setView,
      }),
  );
  useEffect(() => {
    session.reopen();
    const timer = setInterval(() => session.tick(), 30000);
    return () => {
      clearInterval(timer);
      session.dispose();
    };
  }, [session]);
  const mobilityKey = JSON.stringify(mobility);
  useEffect(() => {
    session.setMobility(cleanMobility(mobility));
  }, [session, mobilityKey]);
  const s = view ?? session.state;
  const [history, setHistory] = useState(false);
  const active = s.notices.filter(
    (n) => !["expired", "clear", "withdrawn"].includes(n.state),
  );
  return (
    <section
      className="neighbor-panel"
      aria-label="邻里提醒"
      aria-busy={s.busy}
    >
      <button
        className="secondary neighbor-toggle"
        aria-expanded={s.open}
        onClick={() => session.toggle()}
      >
        邻里提醒{s.open ? " · 收起" : " · 查看或补充"}
      </button>
      {s.open && (
        <div className="neighbor-content">
          <p className="neighbor-title">
            {s.targetLabel}
            {s.hasPath ? "及沿途" : "附近"}
          </p>
          {s.demo && (
            <p className="neighbor-warning">模拟社区提醒 · 不代表真实地点</p>
          )}
          <p className="muted">
            {s.hasPath
              ? "根据已保存路线附近的位置匹配，请核对路口和道路两侧。"
              : "仅查看地点附近100米；缺少路线坐标时不判断途中是否受影响。"}
            这里不会自动改动你的行程。
          </p>
          <div className="neighbor-actions">
            <button disabled={s.busy} onClick={() => void session.refresh()}>
              {s.busy ? "正在处理…" : "刷新提醒"}
            </button>
            <button disabled={s.busy} onClick={() => session.begin()}>
              报告遇到的情况
            </button>
          </div>
          <label className="neighbor-check">
            <input
              type="checkbox"
              checked={s.stepsOnly}
              disabled={s.busy}
              onChange={(e) => session.filter(e.target.checked)}
            />
            只看台阶或门槛
          </label>
          {s.error && (
            <p role="alert" className="error">
              {s.error}
            </p>
          )}
          {s.error.includes("连接") && (
            <p className="muted">
              可在“我的日常 →
              设备与同步”连接地点簿。草稿可以先存本机；其他人需连接同一个服务。
            </p>
          )}
          {s.status && <p role="status">{s.status}</p>}
          {s.asOf && <p className="muted">上次读取：{s.asOf}</p>}
          {s.stale && s.feed && (
            <p role="status" className="neighbor-warning">
              这些是上次读取的记录，已过刷新时间或连接中断。请刷新后确认现状。
            </p>
          )}
          {s.feed && !active.length && (
            <p>没有收到仍需关注的问题报告；这不代表门店一定营业或道路畅通。</p>
          )}
          {s.feed?.truncated && (
            <p className="neighbor-warning">
              仅显示前50条相关记录，请缩小查看范围。
            </p>
          )}
          {(history ? s.notices : active).map((n) => (
            <article
              className={`neighbor-event neighbor-${n.state}`}
              key={n.id}
            >
              <span className="neighbor-label">
                {s.stale ? "历史快照 · " : ""}
                {n.label}
              </span>
              <h4>
                {n.target.name} · {n.kindLabel}
              </h4>
              <p className="muted">{n.relation}</p>
              <p className="muted">{n.locationLabel}</p>
              {n.personalReason && (
                <p className="neighbor-warning">{n.personalReason}</p>
              )}
              <p>最近观察：{n.observedLabel}</p>
              <details>
                <summary>查看反馈依据</summary>
                <p>{n.reason}</p>
                {n.notesLabel.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </details>
              <div className="neighbor-actions">
                <button
                  disabled={s.busy || s.stale}
                  onClick={() => session.begin(n.id, "present")}
                >
                  我看到仍有问题
                </button>
                <button
                  disabled={s.busy || s.stale}
                  onClick={() => session.begin(n.id, "clear")}
                >
                  我看到已经恢复
                </button>
                <button
                  disabled={s.busy || s.stale}
                  onClick={() => session.begin(n.id, "unsure")}
                >
                  我不能确定
                </button>
                {n.mine && !n.mine.withdrawn && (
                  <button
                    disabled={s.busy}
                    onClick={() => void session.withdraw(n.id)}
                  >
                    撤回我的反馈
                  </button>
                )}
              </div>
            </article>
          ))}
          {s.notices.length > active.length && (
            <button
              className="text-button"
              onClick={() => setHistory(!history)}
            >
              {history
                ? "收起较早记录"
                : `查看恢复、过期或撤回记录（${s.notices.length - active.length}）`}
            </button>
          )}
          {onAlternative && active.length > 0 && (
            <button className="secondary" onClick={onAlternative}>
              为下一站看看备选安排
            </button>
          )}
          {s.draft && !s.editor && (
            <button onClick={() => session.restore()}>继续本机草稿</button>
          )}
          {s.editor && (
            <form
              className="neighbor-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void session.submit();
              }}
            >
              <h4>{s.editing ? "补充这条提醒" : "报告遇到的情况"}</h4>
              {!s.editing && (
                <>
                  <label>
                    报告位置
                    <select
                      aria-label="报告位置"
                      value={s.choice}
                      disabled={s.busy}
                      onChange={(e) => session.choose(Number(e.target.value))}
                    >
                      {s.choices.map((c, i) => (
                        <option key={i} value={i}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted">
                    这是所选地点或路线参考点，不是当前位置。请核对具体入口；不确定位置时请暂存草稿。
                  </p>
                  <label>
                    公开地点名称
                    <input
                      aria-label="公开地点名称"
                      maxLength={80}
                      value={s.name}
                      disabled={s.busy}
                      onChange={(e) => session.field("name", e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    范围说明
                    <select
                      aria-label="范围说明"
                      value={s.scope}
                      disabled={s.busy}
                      onChange={(e) => session.field("scope", e.target.value)}
                    >
                      <option value="nearby">尚未区分具体入口</option>
                      <option value="entrance">具体入口</option>
                      <option value="segment">具体路段</option>
                    </select>
                  </label>
                  {s.scope !== "nearby" && (
                    <>
                      <label>
                        入口或路段名称
                        <input
                          aria-label="入口或路段名称"
                          value={s.detail}
                          maxLength={80}
                          disabled={s.busy}
                          required
                          placeholder="如：菜场东门、桥北侧人行道"
                          onChange={(e) =>
                            session.field("detail", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        方位
                        <select
                          aria-label="方位"
                          value={s.side}
                          disabled={s.busy}
                          onChange={(e) =>
                            session.field("side", e.target.value)
                          }
                        >
                          {NOTICE_SIDES.map((o) => (
                            <option value={o.id} key={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="muted">
                        仅说明这一个入口或路段，其他入口情况未知；坐标仍是所选参考点。
                      </p>
                    </>
                  )}
                  <label>
                    发生了什么
                    <select
                      aria-label="发生了什么"
                      value={s.kind}
                      disabled={s.busy}
                      onChange={(e) => session.field("kind", e.target.value)}
                    >
                      {NOTICE_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {s.editing && (
                <p>
                  {s.name} · {NOTICE_KINDS.find((k) => k.id === s.kind)?.label}{" "}
                  ·{" "}
                  {s.observation === "present"
                    ? "仍有问题"
                    : s.observation === "clear"
                      ? "已经恢复"
                      : "不能确定"}
                </p>
              )}
              <label>
                信息来源
                <select
                  aria-label="信息来源"
                  value={s.basis}
                  disabled={s.busy}
                  onChange={(e) => session.field("basis", e.target.value)}
                >
                  <option value="seen">我亲眼看到</option>
                  <option value="heard">听说或转述</option>
                </select>
              </label>
              <label>
                发生时间
                <select
                  aria-label="发生时间"
                  value={s.age}
                  disabled={s.busy}
                  onChange={(e) => session.age(Number(e.target.value))}
                >
                  {ages.map(([v, label]) => (
                    <option value={v} key={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">记录时间：{s.atLabel}</p>
              <label>
                具体情况
                <textarea
                  aria-label="具体情况"
                  maxLength={240}
                  minLength={2}
                  value={s.note}
                  disabled={s.busy}
                  onChange={(e) => session.field("note", e.target.value)}
                  placeholder="例如：东侧入口围挡，西侧入口未确认。请勿填写姓名、电话或住址。"
                  required
                />
              </label>
              <label className="neighbor-check">
                <input
                  type="checkbox"
                  checked={s.share}
                  disabled={s.busy}
                  onChange={(e) => session.field("share", e.target.checked)}
                />
                我已核对位置，同意把这次观察、地点和时间共享给同一服务的其他用户
              </label>
              <p className="muted">
                只发送上述反馈，不上传私人地点簿、家庭位置或完整行程。“未开门”只描述本次观察。
              </p>
              <div className="neighbor-actions">
                <button type="submit" disabled={s.busy || !s.share}>
                  确认共享反馈
                </button>
                <button
                  type="button"
                  disabled={s.busy}
                  onClick={() => session.saveDraft()}
                >
                  仅存本机草稿
                </button>
                <button
                  type="button"
                  disabled={s.busy}
                  onClick={() => session.cancel()}
                >
                  收起表单
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
