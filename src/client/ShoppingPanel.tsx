import { useEffect, useRef, useState } from "react";
import type { LifeBook } from "../shared/life.js";
import type { AnalysisResult } from "../shared/types.js";
import {
  ShoppingSession,
  type ShoppingView,
  type PriceForm,
} from "../mini/shopping.js";
import { request } from "./api.js";
import "./shopping.css";
import { MovementPanel } from "./MovementPanel.js";
import type { MovementTrip } from "../shared/movement.js";

export function ShoppingPanel({
  book,
  save,
  result,
  back,
}: {
  book: LifeBook;
  save: (b: LifeBook) => void;
  result: AnalysisResult | null;
  back: () => void;
}) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const [view, setView] = useState<ShoppingView | null>(null);
  const [movement, setMovement] = useState<MovementTrip | null>(null);
  const [session] = useState(
    () =>
      new ShoppingSession(book, result, {
        get: (k) => {
          try {
            return JSON.parse(localStorage.getItem(k) || "null");
          } catch {
            return null;
          }
        },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
        save: (b) => saveRef.current(b),
        request: <T,>(path: string, method = "GET", body?: unknown) =>
          request<T>(path, {
            method,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        notify: setView,
      }),
  );
  const previous = useRef(book),
    s = view ?? session.state;
  useEffect(() => {
    session.reopen();
    return () => session.close();
  }, [session]);
  useEffect(() => {
    if (previous.current !== book) {
      previous.current = book;
      session.sync(book);
    }
  }, [book, session]);
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (s.plans.length && !s.busy)
      resultRef.current?.scrollIntoView({ block: "start" });
  }, [s.plans, s.busy]);
  const copyPlan = async (index: number) => {
    try {
      await navigator.clipboard.writeText(session.planText(index));
      session.message("购物安排已复制。");
    } catch {
      session.message(
        "复制未完成，请使用HTTPS或检查浏览器剪贴板权限后重试。",
        true,
      );
    }
  };
  const form = (key: keyof PriceForm, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={String(s.form[key])}
        maxLength={key === "unit" ? 12 : 80}
        onChange={(e) => session.form(key, e.target.value)}
      />
    </label>
  );
  if (movement)
    return (
      <MovementPanel
        trip={movement}
        book={book}
        save={save}
        back={() => setMovement(null)}
      />
    );
  return (
    <section className="shopping-panel outing-panel">
      <button className="subtle" onClick={back} disabled={s.busy}>
        返回一趟办齐
      </button>
      <header className="shopping-heading">
        <div>
          <p className="eyebrow">带上清单再出门</p>
          <h2>顺路好买</h2>
        </div>
        <span>时间 · 预算 · 少绕路</span>
      </header>
      <div className="outing-source">
        <label>
          使用的数据
          <select
            aria-label="购物数据来源"
            value={s.demo ? "demo" : "real"}
            disabled={s.busy}
            onChange={(e) => session.change("demo", e.target.value === "demo")}
          >
            <option value="demo">示例店铺与价格</option>
            <option value="real">我的真实地点与记录</option>
          </select>
        </label>
        <p>{s.label}</p>
        <p className="muted">{s.modeNotice}</p>
      </div>
      <nav className="outing-tabs" aria-label="购物功能">
        <button
          aria-pressed={s.tab === "list"}
          disabled={s.busy}
          onClick={() => session.change("tab", "list")}
        >
          购物清单
        </button>
        <button
          aria-pressed={s.tab === "prices"}
          disabled={s.busy}
          onClick={() => session.change("tab", "prices")}
        >
          价格记忆
        </button>
      </nav>
      {s.error && (
        <p className="shopping-error" role="alert">
          {s.error}
        </p>
      )}
      {s.status && (
        <p className="shopping-status" role="status">
          {s.status}
        </p>
      )}
      {s.undo && (
        <button className="subtle" onClick={() => session.undo()}>
          撤销移除
        </button>
      )}
      {s.busy && (
        <button className="subtle" onClick={() => session.stop()}>
          停止读取后续路线
        </button>
      )}
      {s.tab === "list" && (
        <>
          <fieldset className="shopping-list" disabled={s.busy}>
            <legend>这次要买什么</legend>
            {!s.items.length && (
              <p className="muted">
                添加商品，或到“价格记忆”把买过的商品加入清单。
              </p>
            )}
            {s.items.map((item, i) => (
              <div className="shopping-item" key={item.id}>
                <div className="shopping-item-heading">
                  <div>
                    <strong>{item.name || `第${i + 1}项待填写`}</strong>
                    <p className="muted">
                      {item.spec} · {item.quantity}
                      {item.unit}
                      {item.brand ? ` · ${item.brand}` : ""}
                    </p>
                  </div>
                  <button
                    className="subtle"
                    aria-label={`编辑商品${i + 1}`}
                    onClick={() =>
                      session.change(
                        "editItem",
                        s.editItem === item.id ? "" : item.id,
                      )
                    }
                  >
                    {s.editItem === item.id ? "收起" : "编辑"}
                  </button>
                </div>
                {s.editItem === item.id && (
                  <>
                    <button
                      className="subtle"
                      aria-label={`移除商品${i + 1}`}
                      onClick={() => session.removeItem(i)}
                    >
                      移除
                    </button>
                    <div className="shopping-grid">
                      <label>
                        商品名称
                        <input
                          aria-label={`商品${i + 1}名称`}
                          value={item.name}
                          maxLength={60}
                          placeholder="例如：鸡蛋"
                          onChange={(e) =>
                            session.item(i, "name", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        可比规格
                        <input
                          aria-label={`商品${i + 1}规格`}
                          value={item.spec}
                          maxLength={80}
                          placeholder="例如：6枚装"
                          onChange={(e) =>
                            session.item(i, "spec", e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <div className="shopping-grid three">
                      <label>
                        数量
                        <input
                          type="number"
                          min={1}
                          max={99}
                          aria-label={`商品${i + 1}数量`}
                          value={item.quantity}
                          onChange={(e) =>
                            session.item(i, "quantity", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        单位
                        <input
                          aria-label={`商品${i + 1}单位`}
                          value={item.unit}
                          maxLength={12}
                          placeholder="盒 / 份 / 箱"
                          onChange={(e) =>
                            session.item(i, "unit", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        品牌（选填）
                        <input
                          aria-label={`商品${i + 1}品牌`}
                          value={item.brand}
                          maxLength={40}
                          onChange={(e) =>
                            session.item(i, "brand", e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={item.alternatives}
                        onChange={(e) =>
                          session.item(i, "alternatives", e.target.checked)
                        }
                      />
                      接受同规格、同单位的其他品牌
                    </label>
                  </>
                )}
              </div>
            ))}
            <div className="shopping-actions">
              <button
                className="subtle"
                disabled={s.items.length >= 5}
                onClick={() => session.addItem()}
              >
                添加商品
              </button>
              <button className="subtle" onClick={() => session.saveList()}>
                保存清单和预算
              </button>
              <button
                className="subtle"
                onClick={() => {
                  if (
                    window.confirm(
                      "载入地点簿中保存的清单和预算，会替换当前购物草稿。",
                    )
                  )
                    session.loadList();
                }}
              >
                载入保存的清单
              </button>
            </div>
          </fieldset>
          <fieldset className="outing-form" disabled={s.busy}>
            <legend>这一趟的安排</legend>
            <div className="shopping-grid">
              <label>
                消费预算（元）
                <input
                  type="number"
                  value={s.options.money}
                  onChange={(e) => session.change("money", e.target.value)}
                />
              </label>
              <label>
                整趟时间（分钟）
                <input
                  type="number"
                  value={s.options.minutes}
                  onChange={(e) => session.change("minutes", e.target.value)}
                />
              </label>
              <label>
                最多到几家店
                <select
                  value={s.options.maxShops}
                  onChange={(e) => session.change("maxShops", e.target.value)}
                >
                  {[1, 2, 3].map((v) => (
                    <option key={v} value={v}>
                      {v}家
                    </option>
                  ))}
                </select>
              </label>
              <label>
                均衡方案最多多用几分钟
                <input
                  type="number"
                  value={s.options.detour}
                  onChange={(e) => session.change("detour", e.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              整趟时间包含购物停留和返程。缺价不会按0元计算。
            </p>
            <details>
              <summary>出发、营业与休息设置</summary>
              <div className="shopping-grid">
                <label>
                  出发点
                  <select
                    value={s.originId}
                    onChange={(e) => session.change("originId", e.target.value)}
                  >
                    {s.origins.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  出发时刻
                  <input
                    type="time"
                    value={s.prefs.departure}
                    onChange={(e) =>
                      session.change("departure", e.target.value)
                    }
                  />
                </label>
                <label>
                  步速（米/秒）
                  <input
                    type="number"
                    step="0.1"
                    value={s.prefs.speedMps}
                    onChange={(e) => session.change("speedMps", e.target.value)}
                  />
                </label>
                <label>
                  每店停留（分钟）
                  <input
                    type="number"
                    value={s.options.stay}
                    onChange={(e) => session.change("stay", e.target.value)}
                  />
                </label>
                <label>
                  连续步行上限（0为不限）
                  <input
                    type="number"
                    value={s.options.continuous}
                    onChange={(e) =>
                      session.change("continuous", e.target.value)
                    }
                  />
                </label>
                <label>
                  核验过的休息点
                  <select
                    value={s.restId}
                    onChange={(e) => session.change("restId", e.target.value)}
                  >
                    <option value="">不安排休息点</option>
                    {s.rests.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  休息多久（分钟）
                  <input
                    type="number"
                    value={s.options.rest}
                    onChange={(e) => session.change("rest", e.target.value)}
                  />
                </label>
              </div>
              <p className="muted">
                逛店与站着等灯不算坐下休息。等灯沿用出行偏好中的假设。
              </p>
            </details>
            <details className="shopping-stores">
              <summary>
                比较哪些店 · 已选{s.stores.filter((r) => r.checked).length}家
              </summary>
              <p className="muted">
                最多比较5家；使用休息点时最多4家。仅显示报告、地点簿与价格记录中的候选店。
              </p>
              {s.stores.map((n) => (
                <div key={n.id} className="shopping-store">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={n.checked}
                      onChange={(e) =>
                        session.store(n.id, "checked", e.target.checked)
                      }
                    />
                    {n.name}
                  </label>
                  <div className="shopping-grid">
                    <label>
                      开门（选填）
                      <input
                        type="time"
                        value={n.open}
                        onChange={(e) =>
                          session.store(n.id, "open", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      关门（选填）
                      <input
                        type="time"
                        value={n.close}
                        onChange={(e) =>
                          session.store(n.id, "close", e.target.value)
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </details>
            <button
              className="primary shopping-submit"
              onClick={() => void session.calculate()}
            >
              比较购物方案
            </button>
          </fieldset>
          <section
            ref={resultRef}
            className="shopping-results"
            aria-label="购物方案"
          >
            {s.plans.map((p, i) => (
              <article key={p.id} className="shopping-receipt">
                <p className="source-note">
                  {s.demo
                    ? "离线示例 · 虚构价格"
                    : "私人记录 · 价格与库存待核实"}
                </p>
                <h3>{p.title}</h3>
                <p className="shopping-total">{p.cost}</p>
                <p>{p.total}</p>
                <p>
                  {p.coverage} · {p.budget}
                </p>
                {p.comparison && (
                  <p className="shopping-comparison">{p.comparison}</p>
                )}
                <ol className="shopping-timeline">
                  {p.rows.map((r) => (
                    <li key={r.id}>
                      <strong>{r.title}</strong>
                      <p>{r.buy}</p>
                      <small>{r.detail}</small>
                    </li>
                  ))}
                </ol>
                <details>
                  <summary>推荐依据与待确认信息</summary>
                  {p.notes.map((n, j) => (
                    <p key={j}>{n}</p>
                  ))}
                </details>
                <p className="muted">
                  显示到店顺序与预计用时，不是逐路口导航。
                </p>
                <div className="shopping-actions">
                  <button className="subtle" onClick={() => void copyPlan(i)}>
                    复制购物安排
                  </button>
                  <button
                    className="subtle"
                    onClick={() => session.change("tab", "prices")}
                  >
                    买完补记价格
                  </button>
                  <button
                    className="subtle"
                    onClick={() => {
                      try {
                        setMovement(session.movement(i));
                      } catch (e) {
                        session.message((e as Error).message, true);
                      }
                    }}
                  >
                    这趟顺路动一动
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
      {s.tab === "prices" && (
        <>
          <label>
            查找商品或店铺
            <input
              value={s.priceQuery}
              placeholder="输入商品名、规格或店名"
              onChange={(e) => session.change("priceQuery", e.target.value)}
            />
          </label>
          <div className="shopping-actions">
            <p>记住买过的价格，下次更好安排。</p>
            <button className="primary" onClick={() => session.newPrice()}>
              记一笔价格
            </button>
          </div>
          {s.showEditor && (
            <fieldset className="outing-form" disabled={s.busy}>
              <legend>补记商品或消费参考</legend>
              <label>
                哪家店
                <select
                  aria-label="记录店铺"
                  value={s.form.storeId}
                  onChange={(e) => session.form("storeId", e.target.value)}
                >
                  {s.stores.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              {!s.stores.length && <p>请先在地点簿保存出发点和店铺。</p>}
              <label>
                记录类型
                <select
                  value={s.form.kind}
                  onChange={(e) => session.form("kind", e.target.value)}
                >
                  <option value="item">商品单价</option>
                  <option value="person">店铺每人消费参考</option>
                  <option value="visit">店铺每次消费参考</option>
                </select>
              </label>
              <div className="shopping-grid">
                {form("name", "商品 / 服务名称")}
                {form("spec", "规格 / 套餐说明")}
                {form("unit", "计价单位")}
                {form("brand", "品牌（选填）")}
                {form("low", "单价 / 区间下限（元）", "number")}
                {form("high", "区间上限（空白为同价）", "number")}
                {form("observedOn", "记录日期", "date")}
                {form("validDays", "参考有效天数", "number")}
              </div>
              <div className="shopping-grid">
                <label>
                  价格来源
                  <select
                    value={s.form.source}
                    onChange={(e) => session.form("source", e.target.value)}
                  >
                    <option value="noted">看到的标价</option>
                    <option value="paid">实际买过的单价</option>
                  </select>
                </label>
                <label>
                  当时的情况
                  <select
                    value={s.form.stock}
                    onChange={(e) => session.form("stock", e.target.value)}
                  >
                    <option value="unknown">有货情况不清楚</option>
                    <option value="seen">当时有货</option>
                    <option value="out">当时缺货</option>
                  </select>
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.form.liked}
                  onChange={(e) => session.form("liked", e.target.checked)}
                />
                这款用过满意
              </label>
              <p className="muted">
                两项价格都留空表示待确认。每人、每次消费只作店铺参考，不会叠加到购物清单。
              </p>
              <div className="shopping-actions">
                <button className="primary" onClick={() => session.savePrice()}>
                  保存价格记录
                </button>
                <button
                  className="subtle"
                  onClick={() => session.change("showEditor", false)}
                >
                  收起，保留草稿
                </button>
              </div>
            </fieldset>
          )}
          {!s.prices.length && (
            <p className="outing-source">
              {s.priceQuery.trim()
                ? "没有找到匹配的商品或店铺，换个关键词试试。"
                : "还没有价格记忆。先记一笔实际购买或看到的标价，再把商品加入购物清单。"}
            </p>
          )}
          <div className="shopping-price-list">
            {s.prices.map((r) => (
              <article key={r.id}>
                <p className="source-note">
                  {s.demo ? "模拟店铺" : "私人价格记录"} · {r.store}
                </p>
                <h3>{r.title}</h3>
                <strong>{r.price}</strong>
                <p className="muted">
                  {r.detail}
                  {r.liked ? " · 用过满意" : ""}
                </p>
                <div className="shopping-actions">
                  {r.item && (
                    <button
                      className="subtle"
                      disabled={r.blocked}
                      onClick={() => session.usePrice(r.id)}
                    >
                      加入清单
                    </button>
                  )}
                  <button
                    className="subtle"
                    onClick={() => session.reprice(r.id)}
                  >
                    补记实付 / 缺货
                  </button>
                  {r.item && (
                    <button
                      className="subtle"
                      onClick={() => session.block(r.id)}
                    >
                      {r.blocked ? "恢复推荐" : "不再推荐此商品"}
                    </button>
                  )}
                  {!r.id.startsWith("demo-price-") && (
                    <button
                      className="subtle"
                      onClick={() => session.removePrice(r.id)}
                    >
                      移除记录
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
