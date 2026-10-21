import { useEffect, useRef, useState } from "react";
import {
  TripSession,
  planningFields,
  planningTasks,
  type TripView,
} from "../mini/trip.js";
import type { LifeBook } from "../shared/life.js";
import type { AnalysisResult } from "../shared/types.js";
import type { PlanningDraft } from "../shared/planning.js";
import { request } from "./api.js";
import { VoiceInput } from "./VoiceInput.js";
import { TripAssistance } from "./TripAssistance.js";
import { FamilyPanel, localValue } from "./FamilyPanel.js";
import { RoutinePanel, TripPreparation } from "./TripPreparation.js";
import { WalkingGuidePanel } from "./WalkingGuide.js";
import { MobilityPreferences, TripAlternatives } from "./TripAlternatives.js";
import "./planning.css";
import "./trip.css";
export function TripPanel({
  book,
  save,
  result,
  seed,
  back,
  shopping,
  simple = false,
}: {
  book: LifeBook;
  save: (b: LifeBook) => void;
  result: AnalysisResult | null;
  seed?: PlanningDraft;
  back: () => void;
  shopping: () => void;
  simple?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const [view, setView] = useState<TripView | null>(null),
    [session] = useState(
      () =>
        new TripSession(
          book,
          result,
          {
            get: localValue,
            set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
            save,
            request: <T,>(p: string, m = "GET", b?: unknown) =>
              request<T>(p, {
                method: m,
                ...(b ? { body: JSON.stringify(b) } : {}),
              }),
            confirm: async (s) => window.confirm(s),
            notify: setView,
          },
          seed,
        ),
    );
  useEffect(() => {
    session.reopen();
    const visibility = () =>
      document.hidden ? session.close() : session.reopen();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      session.close();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session]);
  const s = view ?? session.state,
    a = s.active;
  const showGuide = (id?: string) => {
    session.openGuide(id);
    requestAnimationFrame(() =>
      document
        .getElementById("walking-guide")
        ?.scrollIntoView({ block: "start" }),
    );
  };
  return (
    <section
      ref={panel}
      className={`planning-panel trip-panel ${simple ? "trip-simple" : ""}`}
      aria-busy={s.busy}
    >
      <button className="secondary" onClick={back}>
        返回我的日常
      </button>
      <header className="planning-heading">
        <p className="eyebrow">买好东西，办完事情，从容回来</p>
        <h2>一趟出门</h2>
        <p>
          {a?.input.bundle.mode === "demo" || (!a && s.demo)
            ? "模拟社区与示例价格 · 不可据此出行"
            : "当前报告与私人地点记录"}{" "}
          · 出发点：{a?.input.origin.name ?? s.origin}
        </p>
      </header>
      {simple && <FamilyPanel book={book} compact />}
      {s.error && (
        <p className="planning-error" role="alert">
          {s.error}
        </p>
      )}
      {s.status && (
        <p className="planning-status" role="status">
          {s.status}
        </p>
      )}
      <RoutinePanel session={session} s={s} />
      <MobilityPreferences session={session} s={s} />
      {!a && (
        <>
          {simple && !expanded && (
            <div className="planning-card">
              <h3>这次想做什么</h3>
              <div className="planning-actions">
                {planningTasks.map((t) => (
                  <button
                    key={t.id}
                    aria-pressed={s.tasks.includes(t.id)}
                    className={s.tasks.includes(t.id) ? "primary" : "secondary"}
                    onClick={() => session.task(t.id)}
                    disabled={s.busy}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label>
                整趟有多少分钟
                <input
                  type="number"
                  min={10}
                  max={240}
                  value={s.form.tripMinutes}
                  placeholder="45"
                  onChange={(e) => session.set("tripMinutes", e.target.value)}
                  disabled={s.busy}
                />
              </label>
              <p className="muted">
                包含办事、等待和回家。地点沿用已有记录；更多条件可展开修改。
              </p>
            </div>
          )}
          <div className="trip-summary">
            <p>
              整趟上限 <strong>{s.form.tripMinutes || "45"}分钟</strong> ·{" "}
              {s.form.shoppingBudget
                ? `购物预算 ¥${s.form.shoppingBudget}`
                : "未设购物预算"}
            </p>
            <button
              className="primary trip-calculate"
              disabled={s.busy || !!s.pending}
              onClick={async () => {
                await session.calculate();
                requestAnimationFrame(() =>
                  panel.current
                    ?.querySelector(
                      session.state.error
                        ? ".planning-error"
                        : session.state.plans.length
                          ? ".trip-plans"
                          : ".planning-status",
                    )
                    ?.scrollIntoView({ block: "start" }),
                );
              }}
            >
              {s.busy ? "正在核算…" : "核算整趟行程"}
            </button>
            <p className="muted">沿用下方条件，可先核算，也可修改后再比较。</p>
          </div>
          {simple && (
            <button
              className="secondary"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "收起更多设置" : "更多条件与AI修改"}
            </button>
          )}
          <div hidden={simple && !expanded}>
            <div className="planning-card">
              <h3>把这几件事放在一起</h3>
              <div className="planning-grid">
                {planningFields.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <input
                      type={f.type}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      value={s.form[f.key]}
                      disabled={s.busy}
                      placeholder={f.hint}
                      onChange={(e) => session.set(f.key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p className="muted">
                时间包含购物、办事、等待和返程。未填整趟时间按45分钟核算。
              </p>
              <div className="planning-actions">
                {planningTasks.map((t) => (
                  <button
                    key={t.id}
                    className={s.tasks.includes(t.id) ? "primary" : "secondary"}
                    aria-pressed={s.tasks.includes(t.id)}
                    disabled={s.busy}
                    onClick={() => session.task(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label>
                这一趟要买的商品
                <textarea
                  aria-label="这一趟要买的商品"
                  rows={2}
                  value={s.items}
                  maxLength={150}
                  disabled={s.busy}
                  onChange={(e) => session.set("items", e.target.value)}
                  placeholder="用顿号分隔；留空表示这趟不采购"
                />
              </label>
              <p className="muted">已备清单：{s.shoppingSummary}</p>
              <button
                className="secondary"
                disabled={s.busy}
                onClick={shopping}
              >
                补充商品规格与价格
              </button>
              <label className="trip-check">
                <input
                  type="checkbox"
                  checked={s.returnEasy}
                  disabled={s.busy}
                  onChange={() => session.toggleReturn()}
                />
                买完轻松返程
              </label>
              {s.returnInherited && (
                <p className="muted">返程节奏沿用已保存的步行偏好。</p>
              )}
              <p className="muted">
                {s.movementSummary}可在“顺路动一动”设置交替步行节奏。
              </p>
            </div>
            <div className="planning-card">
              <h3>想调整，就再说一句</h3>
              <label>
                本次修改
                <textarea
                  maxLength={600}
                  rows={3}
                  value={s.text}
                  disabled={s.busy}
                  onChange={(e) => session.set("text", e.target.value)}
                  placeholder="预算改成30元，药先不取了，其余不变。"
                />
              </label>
              <VoiceInput
                disabled={s.busy}
                useText={(t) => session.set("text", t)}
              />
              <div className="planning-actions">
                <label>
                  使用接口
                  <select
                    disabled={s.busy}
                    value={s.mode}
                    onChange={(e) => session.set("mode", e.target.value)}
                  >
                    <option value="free">基础免费AI</option>
                    <option value="own">我的API（按服务商计费）</option>
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={s.busy || !s.text.trim()}
                  onClick={() => void session.edit()}
                >
                  整理这次修改
                </button>
              </div>
              <p className="muted">
                只发送这段文字和当前时间、预算、任务及商品名称。地点坐标、价格记录和行后记录不会发送。没有连接服务时仍可直接改表单。
              </p>
              {s.pending && (
                <div className="trip-diff">
                  <h4>先核对变化</h4>
                  {s.changes.length ? (
                    <ul>
                      {s.changes.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>条件没有变化。</p>
                  )}
                  <div className="planning-actions">
                    <button
                      className="primary"
                      disabled={s.busy || !s.changes.length}
                      onClick={() => session.accept()}
                    >
                      确认这些修改
                    </button>
                    <button
                      className="secondary"
                      onClick={() => session.reject()}
                    >
                      保留原方案
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <details className="planning-card">
            <summary>参与比较的地点（最多5个）</summary>
            <p>
              可选公园来兼顾步行。上次标记难走的地点会提示，是否绕开由你决定。
            </p>
            {s.candidates.map((n) => (
              <label className="trip-check" key={n.id}>
                <input
                  type="checkbox"
                  checked={n.checked}
                  disabled={s.busy}
                  onChange={() => session.candidate(n.id)}
                />
                <span>
                  {n.name}
                  {n.difficult ? " · 曾标记难走" : ""} · 停留{n.stay}分钟
                </span>
              </label>
            ))}
          </details>
          <div className="trip-plans">
            {s.plans.map((p) => (
              <article className="planning-card trip-plan" key={p.id}>
                {s.demo && (
                  <p className="muted">模拟社区与示例价格 · 不可据此出行</p>
                )}
                <p className="eyebrow">{p.labels.join(" · ")}</p>
                <h3>{p.finish}前后回来</h3>
                <div className="trip-metrics">
                  <span>
                    整趟 <strong>{p.minutes.toFixed(1)}</strong> 分钟
                  </span>
                  <span>
                    步行 <strong>{p.walking.toFixed(1)}</strong> 分钟
                  </span>
                  <span>
                    {p.priceComplete ? "清单估价" : "已知部分"}{" "}
                    <strong>
                      ¥{p.low.toFixed(2)}—{p.high.toFixed(2)}
                    </strong>
                  </span>
                </div>
                <p className={p.budget === "over" ? "planning-error" : "muted"}>
                  {p.budget === "unknown"
                    ? "价格未齐，不能确认是否在预算内。"
                    : p.budget === "over"
                      ? "清单预计超过购物预算。"
                      : p.budget === "within"
                        ? "已有清单报价在预算内；其他未记录消费需另算。"
                        : "未设购物预算。"}
                  {p.gap > 0 ? ` 距步行目标还差${p.gap.toFixed(1)}分钟。` : ""}
                </p>
                {!!p.missed.length && (
                  <p className="planning-error">
                    尚未安排：{p.missed.join("、")}
                  </p>
                )}
                <ol className="trip-timeline">
                  {p.legs.map((l, i) => (
                    <li key={i}>
                      <time>{l.arrival}</time>
                      <div>
                        <strong>{l.name}</strong>
                        <p>
                          本段走{l.walking.toFixed(1)}分钟 · 停留{l.stay}分钟
                        </p>
                        <p className="muted">
                          {[
                            ...new Set(
                              l.phases
                                .filter((x) => x.kind !== "wait")
                                .map((x) => `${x.label} ${x.speed}米/秒`),
                            ),
                          ].join("，")}
                        </p>
                        {p.purchases
                          .filter((x) => x.quote?.store.id === p.stopIds[i])
                          .map((x) => (
                            <p key={x.item.id}>
                              买{x.item.name} ×{x.item.quantity}
                              {x.item.unit} ·{" "}
                              {x.known ? "有记录报价" : "价格待确认"}
                            </p>
                          ))}
                      </div>
                    </li>
                  ))}
                </ol>
                <details>
                  <summary>依据与待确认项</summary>
                  {p.notes.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                  {p.purchases.map((x) => (
                    <p key={x.item.id}>
                      {x.item.name}：{x.reason}
                    </p>
                  ))}
                  <p>
                    这是地点顺序与用时估算；交通灯使用已填写的假设，不代表实时信号。
                  </p>
                </details>
                <button
                  className="primary"
                  onClick={() => void session.start(p.id)}
                >
                  按这条安排出门
                </button>
                <div className="planning-actions">
                  <button className="secondary" onClick={() => showGuide(p.id)}>
                    查看步行指引
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      session.prepare(p.id);
                      requestAnimationFrame(() =>
                        document
                          .getElementById("trip-preparation")
                          ?.scrollIntoView({ block: "start" }),
                      );
                    }}
                  >
                    准备这趟出门卡
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      session.offerRoutine(p.id);
                      requestAnimationFrame(() =>
                        document
                          .getElementById("routine-editor")
                          ?.scrollIntoView({ block: "start" }),
                      );
                    }}
                  >
                    存为常用方案
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {a && (
        <div className="planning-card trip-active">
          {a.phase !== "finished" && (
            <button className="secondary" onClick={() => showGuide()}>
              查看剩余路段指引
            </button>
          )}
          <p className="eyebrow">
            {a.input.bundle.mode === "demo" ? "模拟行程演练" : "进行中的行程"} ·
            本机保存
          </p>
          <h3>
            {a.phase === "finished"
              ? "已经回来啦"
              : a.phase === "resting"
                ? "先歇一歇"
                : `下一站：${s.next}`}
          </h3>
          <p>最后确认位置：{s.here}</p>
          <p>
            预计返程：<strong>{s.remaining?.finish}</strong>
            {(s.remaining?.late ?? 0) > 0
              ? ` · 比整趟上限晚约${s.remaining!.late!.toFixed(1)}分钟`
              : ""}
          </p>
          <p className="muted">{s.remaining?.note}</p>
          <div className="trip-big-actions">
            {a.phase === "at" && (
              <>
                <button
                  className="primary"
                  onClick={() => void session.step("leave")}
                >
                  前往下一站
                </button>
                <button
                  className="secondary"
                  onClick={() => void session.step("rest")}
                >
                  在这里歇脚
                </button>
                <button
                  className="secondary"
                  disabled={a.remaining.length < 2}
                  onClick={() => void session.step("skip")}
                >
                  取消下一站
                </button>
                <button
                  className="secondary"
                  disabled={a.currentId === a.input.origin.id}
                  onClick={() => void session.step("return")}
                >
                  从这里直接返程
                </button>
              </>
            )}
            {a.phase === "walking" && (
              <button
                className="primary"
                onClick={() => void session.step("arrive")}
              >
                我到了，确认位置
              </button>
            )}
            {a.phase === "resting" && (
              <button
                className="primary"
                onClick={() => void session.step("resume")}
              >
                歇好了，继续安排
              </button>
            )}
            <button
              className="secondary"
              onClick={() => session.refreshProgress()}
            >
              更新预计返程
            </button>
          </div>
          <TripAlternatives session={session} s={s} />
          <TripAssistance session={session} s={s} />
          <div className="planning-actions">
            <button className="secondary" onClick={() => session.prepare()}>
              准备当前出门卡
            </button>
            <button
              className="secondary"
              onClick={() => session.offerRoutine()}
            >
              存为常用方案
            </button>
          </div>
          <details open={a.phase === "finished"}>
            <summary>结束这趟，记下实际情况</summary>
            <p>只填纯步行时间，排除购物、等灯和歇脚。实付总额仅作本次记录。</p>
            <div className="planning-grid">
              <label>
                实际纯步行（分钟，可留空）
                <input
                  inputMode="decimal"
                  value={s.feedback.walking}
                  onChange={(e) =>
                    session.feedbackField("walking", e.target.value)
                  }
                />
              </label>
              <label>
                实际花费（元，可留空）
                <input
                  inputMode="decimal"
                  value={s.feedback.spent}
                  onChange={(e) =>
                    session.feedbackField("spent", e.target.value)
                  }
                />
              </label>
            </div>
            <label>
              这次的提醒
              <textarea
                value={s.feedback.note}
                maxLength={300}
                onChange={(e) => session.feedbackField("note", e.target.value)}
              />
            </label>
            <p>哪些到过的地点不太好走？</p>
            {a.input.stops
              .filter((n) => a.completed.includes(n.id))
              .map((n) => (
                <label className="trip-check" key={n.id}>
                  <input
                    type="checkbox"
                    checked={s.feedback.difficult.includes(n.id)}
                    onChange={() => session.difficult(n.id)}
                  />
                  {n.name}
                </label>
              ))}
            <button
              className="primary"
              disabled={s.busy}
              onClick={() => void session.finish()}
            >
              保存行后记录并结束
            </button>
          </details>
        </div>
      )}
      {!!s.pace && (
        <div className="planning-card">
          <p>
            结合记录路程和纯步行时间，参考步速为{s.pace}米/秒；尚未修改偏好。
          </p>
          <button
            className="secondary"
            onClick={() => void session.applyPace()}
          >
            核对并更新舒适步速
          </button>
        </div>
      )}
      <WalkingGuidePanel
        session={session.walking}
        s={s.guide}
        mobility={s.mobility}
        onAlternative={
          a?.phase === "at" && a.remaining.length > 1
            ? () => {
                session.openAlternatives();
                requestAnimationFrame(() =>
                  document
                    .getElementById("trip-alternatives")
                    ?.scrollIntoView({ block: "start" }),
                );
              }
            : undefined
        }
      />
      <TripPreparation session={session} s={s} />
      {!!s.recent.length && (
        <details className="planning-card">
          <summary>最近的出门记录（随私人地点簿同步）</summary>
          {s.recent.slice(0, 5).map((t) => (
            <p key={t.id}>
              {t.date} · {t.mode === "demo" ? "模拟演练 · " : ""}
              {t.origin} · 手动确认{t.completed.length}次到达 ·{" "}
              {t.totalMinutes.toFixed(1)}分钟
              {t.spent !== null ? ` · 实付¥${t.spent}` : ""}
              {t.note ? ` · ${t.note}` : ""}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
