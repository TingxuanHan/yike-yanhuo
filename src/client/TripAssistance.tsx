import { useState } from "react";
import type { TripSession, TripView } from "../mini/trip.js";
import { adjustTrip, tripBasis } from "../shared/trip-adjust.js";
import { EntrancePhoto } from "./EntrancePhoto.js";
import { preparePlacePhoto } from "./place-photo.js";
import "./assistance.css";
export function TripAssistance({
  session,
  s,
}: {
  session: TripSession;
  s: TripView;
}) {
  const [copy, setCopy] = useState("");
  const [phone, setPhone] = useState(
    () => localStorage.getItem("yike-help-phone") ?? "",
  );
  const a = s.active;
  if (!a) return null;
  const help = s.assistance,
    v = help.view,
    p = v?.proposal,
    g = s.entrance;
  const name = (id: string) =>
    [a.input.origin, ...a.input.stops].find((n) => n.id === id)?.name ?? id;
  const placeIds = [...new Set([a.currentId, ...a.remaining])];
  const link =
    v && help.invite
      ? `${location.origin}/#assist=${v.id}&key=${help.invite}`
      : "";
  let changes: string[] = [];
  if (p?.change) {
    try {
      if (v?.snapshot.basis !== tripBasis(a))
        throw new Error("行程已经变化，请先刷新协助。");
      changes = adjustTrip(a, p.change).changes;
    } catch (e) {
      changes = [(e as Error).message];
    }
  }
  return (
    <section
      className="planning-card assist-panel"
      aria-label="家人协助与入口指引"
    >
      <h3>家人帮我一下</h3>
      {help.error && (
        <p className="planning-error" role="alert">
          {help.error}
        </p>
      )}
      {help.status && <p role="status">{help.status}</p>}
      {!v ? (
        <>
          <label>
            想让家人帮什么
            <textarea
              value={s.helpRequest}
              maxLength={240}
              onChange={(e) => session.helpRequest(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={help.busy || a.phase === "finished"}
            onClick={() => void session.startHelp()}
          >
            发起这趟的远程协助
          </button>
          <p className="muted">
            先在“设备与同步”连接服务。发起后将协助卡发给家人，只分享这趟的地点名称和进度；照片另行选择分享。
          </p>
          <button
            className="secondary"
            disabled={help.busy}
            onClick={() => void session.assistance.restore()}
          >
            恢复已有协助
          </button>
        </>
      ) : (
        <>
          <p>
            本次协助到{new Date(v.expiresAt).toLocaleTimeString("zh-CN")}
            结束，只有你确认后才会修改安排。
          </p>
          <div className="assist-actions">
            <button
              className="primary"
              disabled={!link}
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopy("协助链接已复制，请发给信任的家人。");
                  } catch {
                    setCopy("未能复制，请展开下方链接手动复制。");
                  }
                })();
              }}
            >
              复制协助链接
            </button>
            <button
              className="secondary"
              disabled={help.busy}
              onClick={() => void session.assistance.refresh()}
            >
              刷新家人的建议
            </button>
            <button
              className="secondary"
              disabled={help.busy}
              onClick={() => void session.assistance.end()}
            >
              结束协助
            </button>
          </div>
          {copy && <p role="status">{copy}</p>}
          {link && (
            <details>
              <summary>查看本次协助链接</summary>
              <p className="assist-link">{link}</p>
              <p className="muted">
                链接持有人可查看并提出建议，请只发给信任的人。
              </p>
              {/localhost|127\.0\.0\.1/.test(location.hostname) && (
                <p>当前链接仅供本机演示；跨设备协助需要可访问的 HTTPS 服务。</p>
              )}
            </details>
          )}
          <p className="muted">
            页面打开时约每5秒更新；最后同步：
            {new Date(v.updatedAt).toLocaleTimeString("zh-CN")}
            。当前位置由你手动确认。
          </p>
          {p && (
            <div className="assist-proposal">
              <h4>{p.helper}的建议</h4>
              <p>{p.note}</p>
              {p.kind === "entrance" && v.snapshot.guide && p.marker && (
                <EntrancePhoto
                  photo={v.snapshot.guide.photo}
                  x={p.marker.x}
                  y={p.marker.y}
                />
              )}
              {changes.map((t) => (
                <p key={t}>{t}</p>
              ))}
              <div className="assist-actions">
                <button
                  className="primary"
                  disabled={help.busy}
                  onClick={() => void session.assistance.decide(true)}
                >
                  核对并采纳建议
                </button>
                <button
                  className="secondary"
                  disabled={help.busy}
                  onClick={() => void session.assistance.decide(false)}
                >
                  保留我的安排
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <details>
        <summary>给家人打电话</summary>
        <label>
          家人电话（只保存在本机）
          <input
            inputMode="tel"
            value={phone}
            maxLength={20}
            onChange={(e) => {
              const value = e.target.value.replace(/[^+0-9]/g, "");
              setPhone(value);
              try {
                localStorage.setItem("yike-help-phone", value);
              } catch {
                session.message("电话号码未能保存，请稍后重试。");
              }
            }}
          />
        </label>
        {/^\+?\d{3,19}$/.test(phone) && (
          <a href={`tel:${phone}`}>拨打家人电话</a>
        )}
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open && !s.adjust) session.editRemaining();
        }}
      >
        <summary>调整剩余行程</summary>
        <p>
          到达并确认一个地点后，可取消、调换尚未去的站点和修改本次步速。已到达记录保持不变。
        </p>
        {s.adjust && (
          <>
            {a.remaining
              .filter((id) => id !== a.input.origin.id)
              .map((id) => (
                <label className="trip-check" key={id}>
                  <input
                    type="checkbox"
                    checked={s.adjust!.remaining.includes(id)}
                    onChange={() => session.adjustStop(id)}
                  />
                  {name(id)}
                </label>
              ))}
            <ol>
              {s.adjust.remaining.map((id) => (
                <li key={id}>
                  {name(id)}{" "}
                  <button
                    className="secondary"
                    disabled={s.adjust!.remaining.indexOf(id) === 0}
                    onClick={() => session.moveStop(id)}
                  >
                    提前一站
                  </button>
                </li>
              ))}
            </ol>
            <label>
              这次舒适步速（米/秒）
              <input
                type="number"
                min="0.3"
                max="2"
                step="0.1"
                value={s.adjust.speed}
                onChange={(e) => session.adjustSpeed(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              disabled={a.phase !== "at"}
              onClick={() => session.previewRemaining()}
            >
              先核算调整结果
            </button>
            {!!s.adjustPreview.length && (
              <div className="assist-proposal">
                {s.adjustPreview.map((t) => (
                  <p key={t}>{t}</p>
                ))}
                <button
                  className="primary"
                  onClick={() => void session.applyRemaining()}
                >
                  确认更新剩余行程
                </button>
              </div>
            )}
          </>
        )}
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open && !g)
            session.selectEntrance(a.remaining[0] ?? a.currentId);
        }}
      >
        <summary>最后一百米 · 认准入口</summary>
        <label>
          入口所属地点
          <select
            value={g?.id ?? ""}
            onChange={(e) => session.selectEntrance(e.target.value)}
          >
            <option value="" disabled>
              选择地点
            </option>
            {placeIds.map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </select>
        </label>
        {g && (
          <>
            <label>
              选择入口照片
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void preparePlacePhoto(f)
                      .then((photo) => session.entranceField("photo", photo))
                      .catch((e) => session.message(e.message));
                }}
              />
            </label>
            {g.photo && (
              <>
                <EntrancePhoto
                  photo={g.photo}
                  x={g.x}
                  y={g.y}
                  onMark={(x, y) => {
                    session.entranceField("x", x);
                    session.entranceField("y", y);
                  }}
                />
                <p className="muted">点击照片圈出入口，或用方向键微调。</p>
              </>
            )}
            <label>
              认准这里
              <textarea
                value={g.instruction}
                maxLength={240}
                onChange={(e) =>
                  session.entranceField("instruction", e.target.value)
                }
                placeholder="哪扇门、什么招牌、有没有台阶"
              />
            </label>
            <label>
              照片观察日期
              <input
                type="date"
                value={g.observedOn}
                onChange={(e) =>
                  session.entranceField("observedOn", e.target.value)
                }
              />
            </label>
            <p className="muted">
              {g.source === "helper"
                ? "家人提供的指引，尚未现场核实。"
                : "本人记录的入口，开放情况可能变化。"}
            </p>
            <div className="assist-actions">
              <button
                className="primary"
                onClick={() => session.saveEntranceDraft()}
              >
                保存私人入口卡
              </button>
              {s.entrances.some((item) => item.id === g.id) && (
                <button
                  className="secondary"
                  onClick={() => void session.removeEntrance()}
                >
                  移除这张私人入口卡
                </button>
              )}
              {v && (
                <button
                  className="secondary"
                  disabled={help.busy}
                  onClick={() => void session.shareEntrance()}
                >
                  把这张入口卡分享给家人
                </button>
              )}
            </div>
          </>
        )}
      </details>
    </section>
  );
}
