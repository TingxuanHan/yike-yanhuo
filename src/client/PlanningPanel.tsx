import { useEffect, useState } from "react";
import {
  PlanningSession,
  planningFields,
  planningTasks,
  aiPresets,
  type PlanningDraft,
  type PlanningView,
} from "../mini/planning.js";
import { request } from "./api.js";
import "./planning.css";

export function PlanningPanel({
  apply,
  back,
  connect,
}: {
  apply: (draft: PlanningDraft, target: "errands" | "shopping") => void;
  back: () => void;
  connect: () => void;
}) {
  const [view, setView] = useState<PlanningView | null>(null);
  const [session] = useState(
    () =>
      new PlanningSession({
        get: (k) => JSON.parse(localStorage.getItem(k) || "null"),
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
        request: <T,>(path: string, method = "GET", body?: unknown) =>
          request<T>(path, {
            method,
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
        notify: setView,
      }),
  );
  useEffect(() => {
    session.reopen();
    session.emit();
    void session.refresh();
    return () => session.close();
  }, [session]);
  const s = view ?? session.state;
  const confirm = (target: "errands" | "shopping") => {
    try {
      apply(session.confirm(), target);
    } catch (e) {
      session.message((e as Error).message);
    }
  };
  return (
    <section className="planning-panel" aria-busy={s.busy}>
      <button className="secondary" onClick={back}>
        返回我的日常
      </button>
      <div className="planning-heading">
        <p className="eyebrow">把想法变成可核对的条件</p>
        <h2>一句话安排</h2>
        <p>今天想去哪、花多少、几点回来？先说出来，再一起核对。</p>
      </div>
      <div className="planning-card">
        <label>
          这次想做什么
          <textarea
            aria-label="这次想做什么"
            maxLength={600}
            rows={4}
            value={s.text}
            disabled={s.busy}
            placeholder="带50元买菜，45分钟内回来，想顺便走20分钟，买完慢慢回家。"
            onChange={(e) => session.set("text", e.target.value)}
          />
        </label>
        <div className="planning-modes" role="group" aria-label="整理方式">
          {(
            [
              ["free", "基础免费AI"],
              ["own", "我的API"],
              ["manual", "手工填写"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              className={s.mode === id ? "primary" : "secondary"}
              aria-pressed={s.mode === id}
              disabled={s.busy}
              onClick={() => session.mode(id)}
            >
              {name}
            </button>
          ))}
        </div>
        {s.mode !== "manual" && (
          <>
            <p className="muted">
              点击整理，仅发送上面这段文字到所选模型；请避免写入家庭住址等私人信息。
            </p>
            {!s.service ? (
              <p>
                请先连接私人空间。
                <button className="secondary" onClick={connect}>
                  设备与同步
                </button>{" "}
                也可以手工填写。
              </p>
            ) : s.mode === "free" ? (
              <p>
                {s.service.free.configured
                  ? `本空间今天还可用${s.service.free.remaining}/${s.service.free.limit}次 · ${s.service.free.model}`
                  : "基础AI尚未开通，可以手工填写或配置自己的API。"}
              </p>
            ) : (
              <p>
                {s.service.own.configured
                  ? `本设备今天还可用${s.service.own.remaining}/${s.service.own.limit}次 · ${s.service.own.model}`
                  : "本设备尚未配置API。"}{" "}
                自用接口按服务商规则计费。
              </p>
            )}
            <button
              className="primary"
              disabled={
                s.busy ||
                !s.text.trim() ||
                !s.service?.[s.mode].configured ||
                !s.service[s.mode].remaining
              }
              onClick={() => void session.parse()}
            >
              {s.busy ? "正在整理…" : "整理成出行条件"}
            </button>
          </>
        )}
        <button
          className="secondary planning-settings-toggle"
          aria-expanded={s.settings}
          onClick={() => session.toggleSettings()}
          disabled={s.busy}
        >
          API设置与额度
        </button>
      </div>
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
      {s.settings && (
        <div className="planning-card">
          <h3>当前设备的API</h3>
          <p>密钥由后端加密保存，不随地点簿分享。换设备需要单独配置。</p>
          <div className="planning-actions">
            {aiPresets.map((p, i) => (
              <button
                className="secondary"
                key={p.name}
                onClick={() => session.preset(i)}
                disabled={s.busy}
              >
                {p.name}
              </button>
            ))}
          </div>
          <label>
            接口地址
            <input
              value={s.baseUrl}
              disabled={s.busy}
              autoComplete="off"
              onChange={(e) => session.set("baseUrl", e.target.value)}
              placeholder="https://服务商/v1"
            />
          </label>
          <label>
            模型名称
            <input
              value={s.model}
              disabled={s.busy}
              onChange={(e) => session.set("model", e.target.value)}
            />
          </label>
          <label>
            API密钥
            <input
              type="password"
              value={s.key}
              disabled={s.busy}
              autoComplete="new-password"
              onChange={(e) => session.set("key", e.target.value)}
              placeholder="每次保存需填入完整密钥"
            />
          </label>
          <p className="muted">
            新服务商域名需由管理员允许。测试连接会发送一条固定示例，占用一次自用额度，也可能产生服务商费用。
          </p>
          <div className="planning-actions">
            <button
              className="primary"
              disabled={s.busy || !s.key}
              onClick={() => void session.saveSettings()}
            >
              保存接口
            </button>
            <button
              className="secondary"
              disabled={s.busy || !s.service?.own.configured}
              onClick={() => void session.testSettings()}
            >
              测试已保存接口
            </button>
            <button
              className="secondary"
              disabled={s.busy || !s.service?.own.configured}
              onClick={() => {
                if (window.confirm("删除当前设备的API设置？"))
                  void session.removeSettings();
              }}
            >
              删除接口
            </button>
          </div>
          <p className="muted">
            每日北京时间零点重置。失败请求也计入保护额度，不自动重试或切换付费接口。免费额度由同一私人空间的设备共用。
          </p>
        </div>
      )}
      {(s.reviewed || s.mode === "manual") && (
        <div className="planning-card planning-review">
          <p className="eyebrow">确认之后才会应用</p>
          <h3>核对这次出门的条件</h3>
          <p>{s.mode === "manual" ? "手工填写 · 不调用模型" : s.source}</p>
          <p className="muted">
            留空保留原设置；这里不计算路线，也不读取地图。
          </p>
          <div className="planning-grid">
            {planningFields.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type={f.type}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={s.form[f.key]}
                  disabled={s.busy}
                  onChange={(e) => session.set(f.key, e.target.value)}
                  placeholder={f.hint}
                />
              </label>
            ))}
          </div>
          <fieldset>
            <legend>这趟要办什么（最多三件）</legend>
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
          </fieldset>
          <label>
            想买的商品（用顿号分隔，最多五项）
            <input
              value={s.items}
              onChange={(e) => session.set("items", e.target.value)}
              disabled={s.busy}
              placeholder="鸡蛋、牛奶"
            />
          </label>
          <label>
            返程轻松走
            <select
              value={s.returnChoice}
              onChange={(e) => session.set("returnChoice", e.target.value)}
              disabled={s.busy}
            >
              <option value="">保留原设置</option>
              <option value="yes">是</option>
              <option value="no">否</option>
            </select>
          </label>
          <p>
            确认后会保存明确填写的步速、出发时刻和步行目标。带入购物时，商品名称会替换当前购物草稿；请在下一步补全规格和数量。
          </p>
          {s.notes.map((n) => (
            <p className="muted" key={n}>
              {n}
            </p>
          ))}
          <div className="planning-actions">
            <button
              className="primary"
              disabled={s.busy}
              onClick={() => confirm("errands")}
            >
              确认，带入办事
            </button>
            <button
              className="secondary"
              disabled={s.busy}
              onClick={() => confirm("shopping")}
            >
              确认，带入购物
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
