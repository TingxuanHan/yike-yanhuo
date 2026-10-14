import { useEffect, useState } from "react";
import {
  cleanBook,
  cleanPlace,
  emptyBook,
  MAX_BOOK_BYTES,
  mergeBooks,
  placeCardText,
  type LifeBook,
  type LifeSnapshot,
  type PersonalPlace,
  type PlacePosition,
} from "../shared/life.js";
import { cleanJourney, type JourneyPreferences } from "../shared/journey.js";
import type { AnalysisResult, Facility } from "../shared/types.js";
import { downloadJson, post, request } from "./api.js";
import { preparePlacePhoto } from "./place-photo.js";
import { OutingsPanel } from "./OutingsPanel.js";
import { PlanningPanel } from "./PlanningPanel.js";
import { ShoppingPanel } from "./ShoppingPanel.js";
import { TripPanel } from "./TripPanel.js";
import { planningBook, type PlanningDraft } from "../shared/planning.js";

const KEY = "yike-life-v1";
function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return { book: raw ? cleanBook(JSON.parse(raw)) : emptyBook(), error: "" };
  } catch {
    return {
      book: emptyBook(),
      error: "本机地点簿无法读取。请先从设备与同步页恢复私人备份或服务器版本。",
    };
  }
}
export function LifePanel({
  result,
  position,
  centerName,
  selected,
  onApply,
  onPlace,
  onOpen,
  section,
  onSection,
}: {
  result: AnalysisResult | null;
  position: PlacePosition | null;
  centerName: string;
  selected: Facility | null;
  onApply: (p: JourneyPreferences) => void;
  onPlace: (p: PersonalPlace) => void;
  onOpen: (r: AnalysisResult) => void;
  section: "places" | "preferences" | "sync";
  onSection: (s: "places" | "preferences" | "sync") => void;
}) {
  const [initial] = useState(readLocal);
  const [showOutings, setShowOutings] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [trip, setTrip] = useState(false);
  const [planningSeed, setPlanningSeed] = useState<{
    draft: PlanningDraft;
    target: "errands" | "shopping" | "trip";
  } | null>(null);
  const [book, setBook] = useState<LifeBook>(initial.book);
  const [prefs, setPrefs] = useState(book.preferences);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [incoming, setIncoming] = useState<LifeSnapshot | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [note, setNote] = useState("");
  const [openingHours, setOpeningHours] = useState("");
  const [photo, setPhoto] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [sharePrompt, setSharePrompt] = useState(false);
  const [sharedCards, setSharedCards] = useState<
    { id: string; name: string; expiresAt: string }[]
  >([]);
  const [visitedOn, setVisitedOn] = useState("");
  const [savedPosition, setSavedPosition] = useState<PlacePosition | null>(
    null,
  );
  const [card, setCard] = useState<PersonalPlace | null>(null);
  useEffect(() => {
    setShareLink("");
    setSharePrompt(false);
  }, [card]);
  const [undo, setUndo] = useState<LifeBook | null>(null);
  const [reports, setReports] = useState<
    { id: string; label: string; mode: string; savedAt: string }[]
  >([]);
  useEffect(() => {
    void request<LifeSnapshot>("/api/life")
      .then((s) => {
        setConnected(true);
        setIncoming(s);
      })
      .catch(() => {});
    return () => window.speechSynthesis?.cancel();
  }, []);
  const save = (next: LifeBook) => {
    const valid = cleanBook(next);
    // Store successfully before changing visible state, so failed storage is recoverable.
    try {
      localStorage.setItem(KEY, JSON.stringify(valid));
    } catch {
      throw new Error("浏览器存储已满或被禁用，请先下载备份。");
    }
    setBook(valid);
    setPrefs(valid.preferences);
  };
  const action = async (task: () => Promise<void> | void) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const patch = (key: keyof JourneyPreferences, value: unknown) =>
    setPrefs((p) => ({ ...p, [key]: value }));
  const signal = (key: keyof JourneyPreferences["signals"], value: unknown) =>
    setPrefs((p) => ({ ...p, signals: { ...p.signals, [key]: value } }));
  const fill = (p: PersonalPlace) => {
    setEditing(p.id);
    setName(p.name);
    setAddress(p.address);
    setLandmark(p.landmark);
    setNote(p.note);
    setOpeningHours(p.openingHours || "");
    setPhoto(p.photo || "");
    setFavorite(!!p.favorite);
    setVisitedOn(p.visitedOn);
    setSavedPosition(p.position);
  };
  const remember = () => {
    const loc = savedPosition ?? position;
    if (!loc) throw new Error("请先在地图中选择位置，或选择一处已有设施。");
    const p = cleanPlace({
      id: editing ?? crypto.randomUUID(),
      name,
      address,
      landmark,
      note,
      visitedOn,
      position: loc,
      source: "personal",
      openingHours,
      photo,
      favorite,
    });
    save({ ...book, places: [...book.places.filter((x) => x.id !== p.id), p] });
    setEditing(null);
    setName("");
    setAddress("");
    setLandmark("");
    setNote("");
    setOpeningHours("");
    setPhoto("");
    setFavorite(false);
    setVisitedOn("");
    setSavedPosition(null);
    setCard(p);
    setStatus("地点已记在本机；连接服务器后可手动同步。");
  };
  const speak = () => {
    if (!card) return;
    if (!window.speechSynthesis) {
      setError("此浏览器不支持朗读，可使用大字卡片或打印。");
      return;
    }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(placeCardText(card));
    speech.lang = "zh-CN";
    speech.rate = 0.85;
    speech.onerror = () => setError("朗读不可用，请查看大字卡片或打印。");
    window.speechSynthesis.speak(speech);
  };
  if (trip)
    return (
      <TripPanel
        book={book}
        save={save}
        result={result}
        seed={planningSeed?.target === "trip" ? planningSeed.draft : undefined}
        back={() => {
          setTrip(false);
          setPlanningSeed(null);
        }}
        shopping={() => {
          setTrip(false);
          setPlanningSeed({
            target: "shopping",
            draft: {
              tripMinutes: null,
              shoppingBudget: null,
              departure: null,
              speedMps: null,
              walkingMinutes: null,
              returnEasy: null,
              tasks: [],
              items: [],
            },
          });
          setShowOutings(true);
        }}
      />
    );
  if (planning)
    return (
      <PlanningPanel
        back={() => setPlanning(false)}
        connect={() => {
          setPlanning(false);
          onSection("sync");
        }}
        apply={(p, target) => {
          const next = planningBook(book, p);
          save(next);
          if (next.movement)
            localStorage.setItem(
              "yike-movement-draft",
              JSON.stringify(next.movement),
            );
          setPlanningSeed({ draft: p, target });
          setPlanning(false);
          if (target === "trip") setTrip(true);
          else setShowOutings(true);
        }}
      />
    );
  if (showOutings)
    return (
      <div className="life-panel">
        <button
          className="secondary no-print"
          onClick={() => {
            setShowOutings(false);
            setPlanningSeed(null);
          }}
        >
          返回我的日常
        </button>
        {planningSeed?.target === "shopping" ? (
          <ShoppingPanel
            book={book}
            save={save}
            result={result}
            seed={planningSeed.draft}
            back={() => {
              setShowOutings(false);
              setPlanningSeed(null);
            }}
          />
        ) : (
          <OutingsPanel
            book={book}
            save={save}
            result={result}
            seed={planningSeed?.draft}
          />
        )}
      </div>
    );
  return (
    <div className="life-panel">
      <div className="life-heading no-print">
        <p className="eyebrow">自己记，也可以请家人帮忙记</p>
        <h2>我的日常</h2>
        <p>按自己的节奏出门，把熟悉的小店和入口留下来。</p>
        <button className="primary outing-entry" onClick={() => setTrip(true)}>
          一趟出门 · 边办事边走走
        </button>
        <button
          className="primary outing-entry"
          onClick={() => setShowOutings(true)}
        >
          出门办事 · 熟路与歇脚
        </button>
        <button
          className="secondary outing-entry"
          onClick={() => setPlanning(true)}
        >
          一句话安排 · AI辅助
        </button>
      </div>
      <div className="life-tabs no-print" role="group" aria-label="日常功能">
        {(
          [
            ["places", "地点与指引"],
            ["preferences", "出行偏好"],
            ["sync", "设备与同步"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => onSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="life-layout no-print" hidden={section === "sync"}>
        <section className="life-section" hidden={section !== "preferences"}>
          <h3>这次想走多远</h3>
          <p className="muted">
            先完成体检或打开已保存结果，再按个人习惯试算。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(() => {
                const p = cleanJourney(prefs);
                save({ ...book, preferences: p });
                onApply(p);
                setStatus("出行偏好已保存。");
              });
            }}
          >
            <div className="life-fields">
              <label>
                步行时长（分钟）
                <input
                  aria-label="个人步行时长"
                  type="number"
                  min="5"
                  max="30"
                  step="1"
                  required
                  value={prefs.minutes}
                  onChange={(e) => patch("minutes", Number(e.target.value))}
                />
              </label>
              <label>
                步速（米/秒）
                <input
                  aria-label="个人步速"
                  type="number"
                  min="0.3"
                  max="2"
                  step="0.05"
                  required
                  value={prefs.speedMps}
                  onChange={(e) => patch("speedMps", Number(e.target.value))}
                />
              </label>
              <label>
                出发时间（当地）
                <input
                  type="time"
                  required
                  value={prefs.departure}
                  onChange={(e) => patch("departure", e.target.value)}
                />
              </label>
            </div>
            <p className="field-note">
              例如走100米用125秒，步速就是0.8米/秒。请按本人实际习惯填写。
            </p>
            <label className="life-check">
              <input
                type="checkbox"
                checked={prefs.signals.enabled}
                onChange={(e) => signal("enabled", e.target.checked)}
              />
              考虑等灯时间（手动假设）
            </label>
            {prefs.signals.enabled && (
              <fieldset className="signal-fields">
                <legend>峰谷时段试算</legend>
                <p>
                  以下初始值仅为演示假设，请按现场观察修改。它们不是附近路口的实时数据。
                </p>
                <div className="life-fields">
                  <label>
                    每公里路口数
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="0.5"
                      required
                      value={prefs.signals.crossingsPerKm}
                      onChange={(e) =>
                        signal("crossingsPerKm", Number(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    平峰每次等待（秒）
                    <input
                      type="number"
                      min="0"
                      max="300"
                      required
                      value={prefs.signals.offPeakSeconds}
                      onChange={(e) =>
                        signal("offPeakSeconds", Number(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    高峰每次等待（秒）
                    <input
                      type="number"
                      min="0"
                      max="300"
                      required
                      value={prefs.signals.peakSeconds}
                      onChange={(e) =>
                        signal("peakSeconds", Number(e.target.value))
                      }
                    />
                  </label>
                  {(
                    [
                      ["morningStart", "早高峰开始"],
                      ["morningEnd", "早高峰结束"],
                      ["eveningStart", "晚高峰开始"],
                      ["eveningEnd", "晚高峰结束"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="time"
                        required
                        value={prefs.signals[key]}
                        onChange={(e) => signal(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="life-actions">
              <button
                className="primary"
                type="submit"
                disabled={busy || !result}
              >
                保存并查看试算范围
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(() => {
                    save({ ...book, preferences: cleanJourney(prefs) });
                    setStatus("偏好已保存，完成体检后即可试算。");
                  })
                }
              >
                仅保存偏好
              </button>
            </div>
            <p className="field-note">
              试算复用已有路线，不新增地图接口调用。未计入的停歇、路障等因素仍会影响实际用时。
            </p>
          </form>
        </section>
        <section className="life-section" hidden={section !== "places"}>
          <h3>{editing ? "修改地点" : "记住一家小店或常去的地方"}</h3>
          <p className="muted">手动记录，默认仅在本机和你配对的设备中保存。</p>
          <div className="life-actions">
            <button
              className="secondary"
              disabled={!position || busy}
              onClick={() => {
                setSavedPosition(position);
                setStatus(`已采用地图起点：${centerName}`);
              }}
            >
              使用地图起点
            </button>
            {selected && (
              <button
                className="secondary"
                onClick={() => {
                  setName(selected.name);
                  setAddress(selected.address);
                  setSavedPosition(
                    selected.geo
                      ? { system: "bd09", ...selected.geo }
                      : {
                          system: "demo",
                          x: selected.point[0],
                          y: selected.point[1],
                        },
                  );
                }}
              >
                使用刚选的设施
              </button>
            )}
          </div>
          <p className="field-note">
            位置：
            {(savedPosition ?? position)?.system === "demo"
              ? "模拟街区坐标"
              : (savedPosition ?? position)
                ? "已选地图位置"
                : "尚未选择"}
            。请在小店入口选点；这不会自动记录行踪。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(remember);
            }}
          >
            <div className="life-fields">
              <label>
                地点名称
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                详细地址
                <input
                  maxLength={240}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
              <label className="wide">
                入口地标
                <input
                  maxLength={300}
                  placeholder="例如：菜场东门旁，蓝色雨棚下"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                />
              </label>
              <label className="wide">
                出门提醒
                <input
                  maxLength={300}
                  placeholder="例如：上午营业，入口有一级台阶"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label>
                上次到访日期（可选）
                <input
                  type="date"
                  value={visitedOn}
                  onChange={(e) => setVisitedOn(e.target.value)}
                />
              </label>
              <label>
                记录的营业时间
                <input
                  maxLength={120}
                  value={openingHours}
                  onChange={(e) => setOpeningHours(e.target.value)}
                  placeholder="例如：周一至周六 9:00—17:00"
                />
              </label>
            </div>
            <label className="life-check">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
              />
              收藏这个地点
            </label>
            {photo && (
              <img className="entrance-photo" src={photo} alt="入口照片预览" />
            )}
            <div className="life-actions">
              <label className="file-action">
                选择入口照片
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="选择入口照片"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file)
                      void action(async () =>
                        setPhoto(await preparePlacePhoto(file)),
                      );
                  }}
                />
              </label>
              {photo && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPhoto("")}
                >
                  移除照片
                </button>
              )}
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {editing ? "保存地点修改" : "记住这个地方"}
            </button>
          </form>
        </section>
      </div>
      <section className="life-section no-print" hidden={section !== "places"}>
        <div className="section-line">
          <h3>我的地点簿</h3>
          <span>{book.places.length} / 200 处</span>
        </div>
        {!book.places.length ? (
          <p>还没有记录。可以先在地图上选小店入口，再填写店名和地标。</p>
        ) : (
          <ul className="personal-places">
            {book.places.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  {p.favorite && <span> · 已收藏</span>}
                  <p>{p.address || "地址待补充"}</p>
                  <small>
                    {p.position.system === "demo" ? "模拟地点" : "个人记录"}
                    {p.visitedOn ? ` · ${p.visitedOn}到访` : ""}
                  </small>
                </div>
                <div className="life-actions">
                  <button className="secondary" onClick={() => setCard(p)}>
                    大字指引
                  </button>
                  <button className="text-button" onClick={() => onPlace(p)}>
                    设为起点
                  </button>
                  <button className="text-button" onClick={() => fill(p)}>
                    修改
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void action(() => {
                        setUndo(book);
                        save({
                          ...book,
                          places: book.places.filter((x) => x.id !== p.id),
                        });
                        if (card?.id === p.id) setCard(null);
                        setStatus(
                          "地点已从本机移除，可撤销；同步后其他设备才能看到变化。",
                        );
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {undo && (
          <button
            className="text-button"
            onClick={() =>
              void action(() => {
                save(undo);
                setUndo(null);
                setStatus("已恢复本机地点簿。");
              })
            }
          >
            撤销上次移除 / 合并
          </button>
        )}
        <p className="field-note">
          私人地点不自动进入公共设施统计；地图未收录的小店，也可以通过这里再次找到地址和入口。
        </p>
      </section>
      {card && section === "places" && (
        <section className="assist-card" aria-label="大字出门指引">
          <div className="assist-caption">一刻烟火 · 出门带上这张卡</div>
          <h2>我要去：{card.name}</h2>
          {card.photo && (
            <img
              className="entrance-photo"
              src={card.photo}
              alt={`${card.name}的入口照片`}
            />
          )}
          {card.position.system === "demo" && <p>模拟地点，仅用于演示</p>}
          <dl>
            <dt>地址</dt>
            <dd>{card.address || "请协助者补充详细地址"}</dd>
            <dt>认准这里</dt>
            <dd>{card.landmark || "请协助者补充入口地标"}</dd>
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
            这张卡由本人或协助者记录。请确认营业情况；它不是逐路口导航。
          </p>
          <div className="life-actions no-print">
            <button
              className="primary"
              onClick={() => {
                document.body.classList.add("printing-card");
                window.addEventListener(
                  "afterprint",
                  () => document.body.classList.remove("printing-card"),
                  { once: true },
                );
                window.print();
              }}
            >
              打印这张指引
            </button>
            <button className="secondary" onClick={speak}>
              朗读指引
            </button>
            <button
              className="secondary"
              disabled={busy || !connected}
              onClick={() => setSharePrompt(true)}
            >
              生成只读分享卡
            </button>
            <button
              className="text-button"
              onClick={() => window.speechSynthesis?.cancel()}
            >
              停止朗读
            </button>
            <button
              className="text-button"
              onClick={() => {
                window.speechSynthesis?.cancel();
                setCard(null);
              }}
            >
              收起指引
            </button>
          </div>
          {sharePrompt && (
            <div className="sync-preview no-print">
              <p>
                持有链接的人可在7天内查看并转发这个地点的名称、地址、照片和提醒。分享卡不会开放整个地点簿；可在“设备与同步”撤销。
              </p>
              <div className="life-actions">
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() =>
                    void action(async () => {
                      const value = await post<{ token: string }>(
                        "/api/life/cards",
                        { place: card },
                      );
                      setShareLink(`${location.origin}/#card=${value.token}`);
                      setSharePrompt(false);
                    })
                  }
                >
                  确认生成7天有效卡片
                </button>
                <button
                  className="secondary"
                  onClick={() => setSharePrompt(false)}
                >
                  暂不分享
                </button>
              </div>
            </div>
          )}
          {shareLink && (
            <div className="notice no-print">
              <label>
                只读地点卡链接
                <input readOnly value={shareLink} />
              </label>
              <button
                onClick={() =>
                  void action(async () => {
                    await navigator.clipboard.writeText(shareLink);
                    setStatus("链接已复制，可发给家人。");
                  })
                }
              >
                复制卡片链接
              </button>
            </div>
          )}
        </section>
      )}
      <section className="life-section no-print" hidden={section !== "sync"}>
        <h3>在 Web 和小程序之间同步</h3>
        <p>
          两端连接同一台服务器，再用一次性配对码连接同一个私人地点簿。请仅把配对码交给你信任的家人或协助者。
        </p>
        {!connected ? (
          <>
            <div className="life-fields">
              <label>
                创建邀请码（本机可留空）
                <input
                  type="password"
                  autoComplete="off"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                />
              </label>
              <label>
                另一台设备的配对码
                <input
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={12}
                />
              </label>
            </div>
            <div className="life-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const v = await post<{ snapshot: LifeSnapshot }>(
                      "/api/life/create",
                      { invite, client: "web" },
                    );
                    setConnected(true);
                    setRevision(v.snapshot.revision);
                    setInvite("");
                    setStatus("私人地点簿已创建，请点击同步本机修改。");
                  })
                }
              >
                创建私人地点簿
              </button>
              <button
                className="secondary"
                disabled={busy || !code}
                onClick={() =>
                  void action(async () => {
                    const v = await post<{ snapshot: LifeSnapshot }>(
                      "/api/life/redeem",
                      { code, client: "web" },
                    );
                    setConnected(true);
                    setRevision(null);
                    setIncoming(v.snapshot);
                    setCode("");
                    setStatus("已连接，请选择读取或合并服务器内容。");
                  })
                }
              >
                使用配对码连接
              </button>
            </div>
          </>
        ) : (
          <>
            <p role="status">已连接私人地点簿 · 本机修改需手动同步</p>
            <div className="life-actions">
              <button
                className="primary"
                disabled={busy || revision === null || !!incoming}
                onClick={() =>
                  void action(async () => {
                    const v = await request<LifeSnapshot>("/api/life", {
                      method: "PUT",
                      body: JSON.stringify({ revision, book }),
                    });
                    setRevision(v.revision);
                    setStatus("已同步，另一台设备读取服务器版本即可看到。");
                  })
                }
              >
                同步本机修改
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setIncoming(await request<LifeSnapshot>("/api/life"));
                    setStatus("已获取服务器内容，本机尚未改动。");
                  })
                }
              >
                读取服务器版本
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const v = await post<{ code: string }>(
                      "/api/life/pair",
                      {},
                    );
                    setPairCode(v.code);
                    setStatus(
                      "配对码5分钟内有效，仅能使用一次；重新生成会使旧码失效。",
                    );
                  })
                }
              >
                生成配对码
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await request("/api/life/session", { method: "DELETE" });
                    setConnected(false);
                    setRevision(null);
                    setIncoming(null);
                    setPairCode("");
                    setStatus("已断开这台设备，本机记录仍保留。");
                  })
                }
              >
                断开此设备
              </button>
            </div>
            {pairCode && (
              <p className="pair-code">
                配对码：<strong>{pairCode}</strong>
              </p>
            )}
          </>
        )}
        {incoming && (
          <div className="sync-preview">
            <p>
              服务器有 {incoming.book.places.length} 个地点、
              {incoming.book.familiarRoutes?.length ?? 0} 条熟路、
              {incoming.book.restPoints?.length ?? 0} 个休息点、
              {incoming.book.entrances?.length ?? 0} 张入口卡、
              {incoming.book.shopping?.prices.length ?? 0} 条价格记录、
              {incoming.book.trips?.length ?? 0} 条行后记录、
              {incoming.book.routines?.length ?? 0} 份常用方案，版本{" "}
              {incoming.revision}。选择后仍需手动同步，才会修改服务器。
            </p>
            <div className="life-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(() => {
                    setUndo(book);
                    save(incoming.book);
                    setRevision(incoming.revision);
                    setIncoming(null);
                    setStatus("已读取服务器地点簿，可撤销。");
                  })
                }
              >
                使用服务器版本（替换本机）
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(() => {
                    setUndo(book);
                    save(mergeBooks(book, incoming.book));
                    setRevision(incoming.revision);
                    setIncoming(null);
                    setStatus(
                      "已合并到本机，同编号记录和出行偏好保留本机值；请核对后同步。",
                    );
                  })
                }
              >
                合并到本机（冲突保留本机）
              </button>
            </div>
          </div>
        )}
        <div className="life-actions">
          <button
            className="text-button"
            onClick={() => downloadJson(book, "yike-personal-places.json")}
          >
            下载私人备份
          </button>
          <label className="file-action">
            导入私人备份
            <input
              type="file"
              accept=".json,application/json"
              aria-label="导入私人地点备份"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  void action(async () => {
                    if (f.size > MAX_BOOK_BYTES)
                      throw new Error("备份超过750KB，请减少入口照片后再试。");
                    const next = cleanBook(JSON.parse(await f.text()));
                    setUndo(book);
                    save(next);
                    setStatus("备份已导入本机，可撤销。尚未修改服务器。");
                  });
              }}
            />
          </label>
        </div>
      </section>
      {connected && (
        <section className="life-section no-print" hidden={section !== "sync"}>
          <h3>已分享的地点卡</h3>
          <p>
            撤销后，原链接无法继续查看。接收者已保存的照片、文字或打印件无法撤回。
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setSharedCards(await request("/api/life/cards"));
                setStatus("分享卡列表已更新。");
              })
            }
          >
            查看有效分享卡
          </button>
          <ul className="personal-places">
            {sharedCards.map((c) => (
              <li key={c.id}>
                <span>
                  {c.name} · {new Date(c.expiresAt).toLocaleDateString("zh-CN")}
                  到期
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await request(`/api/life/cards/${c.id}`, {
                        method: "DELETE",
                      });
                      setSharedCards(await request("/api/life/cards"));
                      setStatus("原分享链接已失效。");
                    })
                  }
                >
                  撤销分享卡
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {connected && (
        <section className="life-section no-print" hidden={section !== "sync"}>
          <h3>两端共享的体检报告</h3>
          <div className="life-actions">
            <button
              className="secondary"
              disabled={busy || !result}
              onClick={() =>
                void action(async () => {
                  await post("/api/life/reports", { result });
                  setReports(await request("/api/life/reports"));
                  setStatus("报告已保存到私人地点簿，配对设备可以打开。");
                })
              }
            >
              共享当前报告
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setReports(await request("/api/life/reports"));
                  setStatus("共享报告列表已更新。");
                })
              }
            >
              读取共享报告
            </button>
          </div>
          <ul className="personal-places">
            {reports.map((r) => (
              <li key={r.id}>
                <span>
                  {r.label} · {r.mode === "demo" ? "模拟报告" : "地图报告"}
                </span>
                <div className="life-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        onOpen(
                          await request(
                            `/api/life/reports/${encodeURIComponent(r.id)}`,
                          ),
                        );
                      })
                    }
                  >
                    打开报告
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await request(
                          `/api/life/reports/${encodeURIComponent(r.id)}`,
                          { method: "DELETE" },
                        );
                        setReports(await request("/api/life/reports"));
                        setStatus("已移除服务器报告，本机打开的报告仍保留。");
                      })
                    }
                  >
                    移除共享
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {status && (
        <p className="notice no-print" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="error-message no-print" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
