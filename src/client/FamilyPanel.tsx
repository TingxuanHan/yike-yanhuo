import { useEffect, useState } from "react";
import {
  FamilySession,
  FamilyReplySession,
  receiptText,
  familyReplies,
  type FamilyReplyState,
  locationSummary,
  type FamilyState,
  type FamilySnapshot,
  type FamilyShare,
  type LocationRecord,
} from "../mini/family.js";
import type { LifeBook } from "../shared/life.js";
import { request } from "./api.js";
import "./family.css";

export function localValue(key: string): unknown {
  const value = localStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function locate(): Promise<LocationRecord> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error("当前浏览器不支持定位，仍可使用地点记录和电话。"),
      );
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          source: "device",
          name: "设备定位点",
          at: p.timestamp,
          position: {
            system: "wgs84",
            lng: p.coords.longitude,
            lat: p.coords.latitude,
          },
          accuracyM: Number.isFinite(p.coords.accuracy)
            ? p.coords.accuracy
            : null,
        }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? "未获得定位权限。可在浏览器的网站权限中允许位置后重试。"
              : "暂时未能定位，请检查系统定位或稍后重试。",
          ),
        ),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}
export function PositionEvidence({
  snapshot,
  now = Date.now(),
}: {
  snapshot: FamilySnapshot | null;
  now?: number;
}) {
  const s = locationSummary(snapshot, now);
  return (
    <div className="position-evidence">
      <h3>{s.title}</h3>
      {s.time && (
        <p>
          {s.time} · {s.age}
        </p>
      )}
      <p className="position-range">{s.range}</p>
      {s.radiusM !== null && (
        <svg
          viewBox="0 0 300 150"
          role="img"
          aria-label="以最后记录点为中心的估算圆形范围，不含道路信息"
        >
          <circle
            cx="150"
            cy="70"
            r="58"
            fill="#e6efeb"
            stroke="#78948a"
            strokeDasharray="5 4"
          />
          <circle cx="150" cy="70" r="5" fill="#c46136" />
          <path d="M150 70h58" stroke="#78948a" />
          <text x="150" y="53" textAnchor="middle">
            最后记录点
          </text>
          <text x="150" y="147" textAnchor="middle">
            范围示意 · 不代表道路可达
          </text>
        </svg>
      )}
      <p className="muted">{s.detail}</p>
      {s.coordinates && (
        <details>
          <summary>参考坐标与完整说明</summary>
          <pre>{s.text}</pre>
        </details>
      )}
    </div>
  );
}
export function FamilyPanel({
  book,
  trip,
  compact = false,
}: {
  book: LifeBook;
  trip?: () => void;
  compact?: boolean;
}) {
  const [view, setView] = useState<FamilyState | null>(null);
  const [opened, setOpened] = useState(false),
    [manual, setManual] = useState("");
  const [session] = useState(
    () =>
      new FamilySession({
        get: localValue,
        set: (k, v) =>
          localStorage.setItem(
            k,
            k === "yike-help-phone" ? String(v) : JSON.stringify(v),
          ),
        locate,
        speedMps: book.preferences.speedMps,
        notify: setView,
        confirm: async (t) => window.confirm(t),
        request: <T,>(p: string, method = "GET", body?: unknown) =>
          request<T>(p, {
            method,
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
      }),
  );
  useEffect(() => {
    session.reopen();
    const show = () => (document.hidden ? session.close() : session.reopen());
    document.addEventListener("visibilitychange", show);
    return () => {
      session.close();
      document.removeEventListener("visibilitychange", show);
    };
  }, [session]);
  const s = view ?? session.state;
  const places = book.places.filter((p) => p.position.system !== "demo");
  const link =
    s.share && s.invite
      ? `${location.origin}/#family=${s.share.id}&key=${s.invite}`
      : "";
  return (
    <section className="family-panel" aria-label="联系家人">
      {!compact && <h2>家人就在身边</h2>}
      <div className="family-actions">
        {s.phone && (
          <a className="primary" href={`tel:${s.phone}`}>
            一键拨打家人电话
          </a>
        )}
        <button
          className="secondary"
          aria-expanded={opened}
          onClick={() => setOpened(!opened)}
        >
          告诉家人我在哪
        </button>
        {trip && (
          <button className="secondary" onClick={trip}>
            请家人帮我看行程
          </button>
        )}
      </div>
      {(!compact || opened) && (
        <details open={s.phone ? undefined : true}>
          <summary>{s.phone ? "修改家人电话" : "先记下家人电话"}</summary>
          <label>
            家人电话（只存本机）
            <input
              type="tel"
              value={s.draftPhone}
              maxLength={20}
              onChange={(e) => session.phone(e.target.value)}
            />
          </label>
          <button className="secondary" onClick={() => session.savePhone()}>
            保存家人电话
          </button>
          <p className="muted">
            保存后可直接拨打，不需要定位或连接服务。桌面需有可处理电话的应用。
          </p>
        </details>
      )}
      {s.error && (
        <p role="alert" className="family-error">
          {s.error}
        </p>
      )}
      {s.status && <p role="status">{s.status}</p>}
      {(opened || s.share) && (
        <div className="family-location">
          <button
            className="primary"
            disabled={s.locating}
            onClick={() => void session.locate()}
          >
            {s.locating ? "正在获取位置…" : "授权并获取一次位置"}
          </button>
          <p className="muted">
            仅主动点击时获取，不持续追踪。未授权时使用最近的本人确认记录。
          </p>
          <PositionEvidence snapshot={s.snapshot} />
          <details>
            <summary>没有定位？确认我现在所在的地点</summary>
            {places.length ? (
              <>
                <label>
                  我现在就在
                  <select
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  >
                    <option value="">请选择实际所在地点</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={!manual}
                  onClick={() => {
                    const p = places.find((p) => p.id === manual);
                    if (p && p.position.system !== "demo")
                      void session.confirmPlace(p.name, p.position);
                  }}
                >
                  确认我现在在这里
                </button>
              </>
            ) : (
              <p>
                地点簿里还没有真实地点。可先通过电话告诉家人附近招牌或路口。
              </p>
            )}
          </details>
          <div className="family-actions">
            <button
              className="secondary"
              disabled={!s.snapshot}
              onClick={() =>
                void session.copyText((t) => navigator.clipboard.writeText(t))
              }
            >
              复制位置说明给家人
            </button>
            <button
              className="secondary"
              disabled={!s.snapshot || s.busy}
              onClick={() => void session.share()}
            >
              {s.share ? "重新分享这次记录" : "生成家人位置卡"}
            </button>
          </div>
          <p className="muted">
            文字可直接转发；位置卡需先连接服务，跨设备使用需可访问的HTTPS服务。
          </p>
          {s.share && (
            <div className="family-share">
              <h3>家人的回应</h3>
              <p className="family-receipt" role="status">
                {receiptText(s.share)}
              </p>
              {s.receiptStatus && (
                <p className="family-error">{s.receiptStatus}</p>
              )}
              <p className="muted">
                回应者的称呼由对方填写，身份未核验。此页打开时核对新回应；需要马上联系请打电话。
              </p>
              <button
                className="secondary"
                disabled={s.busy}
                onClick={() => void session.refreshShare()}
              >
                刷新家人回应
              </button>
              <p>
                链接到{new Date(s.share.expiresAt).toLocaleTimeString("zh-CN")}
                失效，只包含分享时的记录。
              </p>
              {s.shareOutdated && (
                <p className="family-error">
                  本机已有新记录，旧链接尚未更新。可重新分享并发送新卡。
                </p>
              )}
              {link && (
                <>
                  <button
                    className="secondary"
                    onClick={() =>
                      void navigator.clipboard.writeText(link).then(
                        () =>
                          session.message("链接已复制，请只发给信任的家人。"),
                        () => session.message("未能复制，请展开链接手动复制。"),
                      )
                    }
                  >
                    复制家人位置卡链接
                  </button>
                  <details>
                    <summary>查看位置卡链接</summary>
                    <p className="family-link">{link}</p>
                  </details>
                </>
              )}
              <button className="secondary" onClick={() => void session.end()}>
                停止位置分享
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
export function FamilyViewer({ id, token }: { id: string; token: string }) {
  const [state, setState] = useState<FamilyReplyState | null>(null);
  const [session] = useState(
    () =>
      new FamilyReplySession({
        notify: setState,
        request: (method = "GET", body?: unknown) => {
          if (!/^[a-f0-9-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token))
            return Promise.reject(
              new Error("位置链接不完整，请让家人重新发送。"),
            );
          return request<FamilyShare>(`/api/family/${id}`, {
            method,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            headers: { "X-Yike-Family": token },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
        },
      }),
  );
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        session.close();
        setState({ ...session.state });
      } else session.reopen();
    };
    session.reopen();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      session.close();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session]);
  const s = state ?? session.state,
    { view, error, time } = s;
  return (
    <main className="family-viewer">
      <p className="eyebrow">一刻烟火 · 家人位置卡</p>
      <h1>一起确认他在哪</h1>
      {error && (
        <p role="alert" className="family-error">
          {error}
        </p>
      )}
      {!error && !view && <p role="status">正在核对位置卡…</p>}
      {s.status && <p role="status">{s.status}</p>}
      <button
        className="secondary"
        disabled={s.busy}
        onClick={() => void session.refresh()}
      >
        刷新位置卡
      </button>
      {view && view.expiresAt > time && (
        <>
          <section className="family-share">
            <h2>给对方一个回应</h2>
            <p className="family-receipt">{receiptText(view)}</p>
            <label>
              你的称呼（对方会看到）
              <input
                value={s.name}
                maxLength={20}
                disabled={s.busy}
                onChange={(e) => session.name(e.target.value)}
              />
            </label>
            <div className="family-actions">
              {familyReplies.map((r) => (
                <button
                  key={r.kind}
                  className="secondary"
                  disabled={s.busy || !s.name.trim()}
                  onClick={() => void session.reply(r.kind)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="muted">
              点击才发送回应。持有链接的人都可填写称呼，身份未核验；不会替你拨打电话或持续定位。
            </p>
          </section>
          <PositionEvidence snapshot={view.snapshot} now={time} />
          <p>
            这是一条由对方主动分享的记录，不会持续定位。请电话核对附近招牌、路口和是否乘车；不能仅凭圆形范围确认人在其中。
          </p>
          <p className="muted">
            位置卡到{new Date(view.expiresAt).toLocaleTimeString("zh-CN")}
            失效，对方也可提前停止分享。
          </p>
        </>
      )}
    </main>
  );
}
