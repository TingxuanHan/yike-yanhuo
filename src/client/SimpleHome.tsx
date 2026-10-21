import { useState } from "react";
import {
  cleanBook,
  emptyBook,
  placeCardText,
  type LifeBook,
} from "../shared/life.js";
import type { AnalysisResult } from "../shared/types.js";
import { FamilyPanel, localValue } from "./FamilyPanel.js";
import { TripPanel } from "./TripPanel.js";
export function SimpleHome({
  full,
  result,
  community,
}: {
  full: (life?: boolean) => void;
  result: AnalysisResult | null;
  community: () => void;
}) {
  const [initial] = useState(() => {
    try {
      return {
        book: cleanBook(localValue("yike-life-v1") ?? emptyBook()),
        error: "",
      };
    } catch {
      return {
        book: emptyBook(),
        error:
          "本机地点簿无法读取，请切换完整版，从备份恢复后再保存。原数据已保留。",
      };
    }
  });
  const [book, setBook] = useState(initial.book);
  const error = initial.error;
  const [pane, setPane] = useState<"home" | "trip" | "places">("home");
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const active = !!localValue("yike-active-trip");
  const save = (value: LifeBook) => {
    if (error) throw new Error(error);
    const clean = cleanBook(value);
    localStorage.setItem("yike-life-v1", JSON.stringify(clean));
    setBook(clean);
  };
  const places = book.places
    .filter((p) => `${p.name} ${p.address}`.includes(query))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  const chosen = book.places.find((p) => p.id === selected);
  return (
    <main className="simple-home">
      <header className="simple-header">
        <div>
          <h1>一刻烟火</h1>
          <p>简易模式 · 出门有人帮</p>
        </div>
        <button className="secondary" onClick={() => full()}>
          切换完整版
        </button>
      </header>
      {error && (
        <p role="alert" className="family-error">
          {error}
        </p>
      )}
      {pane === "trip" ? (
        <TripPanel
          simple
          book={book}
          save={save}
          result={result}
          back={() => setPane("home")}
          shopping={() => full(true)}
        />
      ) : (
        <>
          {pane === "home" ? (
            <div className="simple-shortcuts">
              <button onClick={() => setPane("trip")}>
                <strong>{active ? "继续这趟出门" : "我要出门"}</strong>
                <span>选几件事，算好时间再出发</span>
              </button>
              <button onClick={() => setPane("places")}>
                <strong>常用地点</strong>
                <span>找小店、看入口、大字指引</span>
              </button>
            </div>
          ) : (
            <section className="simple-places">
              <button
                className="secondary"
                onClick={() => {
                  setPane("home");
                  setSelected("");
                }}
              >
                返回简易首页
              </button>
              <h2>常用地点</h2>
              <label>
                找一个地方
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {chosen && (
                <div className="simple-place-card" role="status">
                  {chosen.position.system === "demo" && (
                    <strong>
                      模拟地点，不可据此出行
                      <br />
                    </strong>
                  )}
                  {placeCardText(chosen)}
                </div>
              )}
              {!places.length && (
                <p>还没有匹配的地点，可请家人帮忙记下常去的小店和入口。</p>
              )}
              {places.map((p) => (
                <button
                  className="simple-place"
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span>
                    {p.landmark || p.address || "入口待补充"}
                    {p.position.system === "demo" ? " · 模拟地点" : ""}
                  </span>
                </button>
              ))}
              <button className="secondary" onClick={() => full(true)}>
                添加或管理地点
              </button>
            </section>
          )}
          <FamilyPanel
            book={book}
            trip={active ? () => setPane("trip") : undefined}
          />
          {pane === "home" && (
            <button className="community-entry secondary" onClick={community}>
              社区体检演示 · 看范围与设施缺口
            </button>
          )}
        </>
      )}
    </main>
  );
}
