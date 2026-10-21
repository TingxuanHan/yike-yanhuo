import { useEffect, useState } from "react";
import {
  cleanPlace,
  placeCardText,
  type PersonalPlace,
} from "../shared/life.js";

export function SharedPlaceCard({ token }: { token: string }) {
  const [card, setCard] = useState<PersonalPlace | null>(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [expires, setExpires] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setCard(null);
    setError("");
    void (async () => {
      if (!/^[A-Za-z0-9_-]{32}$/.test(token))
        throw new Error("地点卡链接不完整，请联系分享者重新发送。");
      const response = await fetch("/api/card", {
        headers: { "X-Yike-Card": token },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "地点卡暂时无法打开。");
      setCard(cleanPlace(data.place));
      setExpires(new Date(data.expiresAt).toLocaleDateString("zh-CN"));
    })().catch((e) => {
      if (!abort.signal.aborted)
        setError(e.message || "暂时无法连接，请稍后重试。");
    });
    return () => {
      abort.abort();
      window.speechSynthesis?.cancel();
    };
  }, [token, attempt]);
  return (
    <main className="shared-card-page">
      <section className="assist-card" aria-label="家人的地点卡">
        <div className="assist-caption">一刻烟火 · 家人的地点卡</div>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setAttempt((n) => n + 1)}>重新打开</button>
          </>
        ) : !card ? (
          <p role="status">正在打开地点卡…</p>
        ) : (
          <>
            <h1>我要去：{card.name}</h1>
            {card.position.system === "demo" && (
              <p className="notice">模拟地点，仅用于演示</p>
            )}
            {card.photo && (
              <img
                className="entrance-photo"
                src={card.photo}
                alt={`${card.name}的入口照片`}
              />
            )}
            <dl>
              <dt>地址</dt>
              <dd>{card.address || "地址待补充"}</dd>
              <dt>认准这里</dt>
              <dd>{card.landmark || "入口地标待补充"}</dd>
              {card.openingHours && (
                <>
                  <dt>记录的营业时间</dt>
                  <dd>{card.openingHours}</dd>
                </>
              )}
              {card.note && (
                <>
                  <dt>出门提醒</dt>
                  <dd>{card.note}</dd>
                </>
              )}
            </dl>
            <p className="card-note">
              这是分享时的只读副本，有效至{expires}
              。出发前请确认营业情况；此卡不是逐路口导航。
            </p>
            {actionMessage && (
              <p className="notice no-print" role="status">
                {actionMessage}
              </p>
            )}
            <div className="life-actions no-print">
              <button className="primary" onClick={() => window.print()}>
                打印地点卡
              </button>
              <button
                className="secondary"
                onClick={() => {
                  if (!window.speechSynthesis) {
                    setActionMessage(
                      "此浏览器不支持朗读，请使用大字卡片或打印。",
                    );
                    return;
                  }
                  window.speechSynthesis.cancel();
                  const speech = new SpeechSynthesisUtterance(
                    placeCardText(card),
                  );
                  speech.lang = "zh-CN";
                  speech.rate = 0.85;
                  speech.onerror = () =>
                    setActionMessage("朗读暂时不可用，仍可查看或打印地点卡。");
                  window.speechSynthesis.speak(speech);
                }}
              >
                朗读指引
              </button>
              <button
                className="text-button"
                onClick={() => window.speechSynthesis?.cancel()}
              >
                停止朗读
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
