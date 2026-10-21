import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult, QuotaSnapshot } from "../shared/types.js";
import { type LifeBook } from "../shared/life.js";
import { cleanJourney } from "../shared/journey.js";
import {
  allPairs,
  cleanFamiliarRoute,
  cleanFamiliarDraft,
  emptyFamiliarDraft,
  cleanRestPoint,
  compareAddition,
  demoScene,
  errandSelection,
  familiarText,
  itineraryText,
  minutesText,
  OutingRouteCache,
  planErrands,
  planRestJourney,
  sceneFromReport,
  taskOptions,
  todayLocal,
  type FamiliarRoute,
  type FamiliarStep,
  type OpeningWindow,
  type OutingNode,
  type RouteBundle,
  type RestPoint,
} from "../mini/outings.js";
import { post, request } from "./api.js";
import { preparePlacePhoto } from "./place-photo.js";
import "./outings.css";
import type { PlanningDraft } from "../shared/planning.js";
import { ShoppingPanel } from "./ShoppingPanel.js";
import { MovementPanel } from "./MovementPanel.js";
import {
  movementTrip,
  demoMovementTrip,
  type MovementTrip,
} from "../shared/movement.js";

const tabs = [
  ["errands", "一趟办齐"],
  ["familiar", "家人带过的路"],
  ["rest", "走走歇歇"],
  ["impact", "补点看变化"],
] as const;
const emptyStep = (): FamiliarStep => ({ title: "", instruction: "" });
export function OutingsPanel({
  book,
  save,
  result,
  seed,
}: {
  book: LifeBook;
  save: (b: LifeBook) => void;
  result: AnalysisResult | null;
  seed?: PlanningDraft;
}) {
  const [shopping, setShopping] = useState(false);
  const [movement, setMovement] = useState<MovementTrip | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("errands"),
    [example, setExample] = useState(result?.mode !== "baidu");
  const scene = useMemo(
    () => (example ? demoScene() : sceneFromReport(result, book)),
    [example, result, book],
  );
  const [categories, setCategories] = useState(
      seed?.tasks.length ? seed.tasks : ["market", "pharmacy"],
    ),
    [stays, setStays] = useState<Record<string, number>>({
      market: 5,
      pharmacy: 3,
      park: 10,
      personal: 5,
    });
  const [budget, setBudget] = useState(seed?.tripMinutes ?? 45),
    [prefs, setPrefs] = useState(book.preferences),
    [opening, setOpening] = useState<Record<string, OpeningWindow>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [plans, setPlans] = useState<
      (ReturnType<typeof itineraryText> & { movement: MovementTrip })[]
    >([]),
    [restResult, setRestResult] = useState<ReturnType<
      typeof planRestJourney
    > | null>(null),
    [impact, setImpact] = useState<ReturnType<typeof compareAddition> | null>(
      null,
    );
  const [target, setTarget] = useState(""),
    [continuous, setContinuous] = useState(6),
    [restMinutes, setRestMinutes] = useState(2),
    [restSelection, setRestSelection] = useState<string[] | null>(null);
  const [placeIndex, setPlaceIndex] = useState(0),
    [restChecked, setRestChecked] = useState(todayLocal()),
    [restUntil, setRestUntil] = useState(todayLocal()),
    [restNote, setRestNote] = useState("");
  const [impactCategory, setImpactCategory] = useState("pharmacy"),
    [newIndex, setNewIndex] = useState(0);
  const [draftSeed] = useState(() => {
    try {
      const raw = localStorage.getItem("yike-familiar-draft");
      return {
        draft: raw ? cleanFamiliarDraft(JSON.parse(raw)) : emptyFamiliarDraft(),
        error: "",
      };
    } catch {
      return {
        draft: emptyFamiliarDraft(),
        error: "熟路草稿未能恢复，请检查本机保存内容。",
      };
    }
  });
  const [routeName, setRouteName] = useState(draftSeed.draft.name),
    [checkedOn, setCheckedOn] = useState(draftSeed.draft.checkedOn),
    [steps, setSteps] = useState<FamiliarStep[]>(draftSeed.draft.steps),
    [editing, setEditing] = useState<string | null>(draftSeed.draft.id),
    [selected, setSelected] = useState<FamiliarRoute | null>(null),
    [undo, setUndo] = useState<
      | { kind: "route"; value: FamiliarRoute }
      | { kind: "rest"; value: RestPoint }
      | null
    >(null);
  const [showEditor, setShowEditor] = useState(!book.familiarRoutes?.length);
  const cancel = useRef(false),
    alive = useRef(true);
  const cache = useRef<OutingRouteCache | null>(null);
  if (!cache.current) {
    let old: unknown = [];
    try {
      old = JSON.parse(localStorage.getItem("yike-outing-routes") || "[]");
    } catch {}
    cache.current = new OutingRouteCache(old);
  }
  useEffect(() => {
    alive.current = true;
    if (draftSeed.error) setError(draftSeed.error);
    return () => {
      cancel.current = true;
      alive.current = false;
    };
  }, [draftSeed.error]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "yike-familiar-draft",
        JSON.stringify({ id: editing, name: routeName, checkedOn, steps }),
      );
    } catch {
      setError("草稿无法保存，请释放浏览器空间；离开前请复制重要文字。");
    }
  }, [editing, routeName, checkedOn, steps]);
  useEffect(() => {
    setPlans([]);
    setRestResult(null);
    setImpact(null);
    setSelected((old) =>
      old ? (book.familiarRoutes?.find((r) => r.id === old.id) ?? null) : null,
    );
  }, [book]);
  useEffect(() => {
    setPlans([]);
    setRestResult(null);
    setImpact(null);
    setOpening({});
    setTarget("");
    setRestSelection(null);
    setNewIndex(0);
  }, [example, result?.id]);
  const run = async (fn: () => void | Promise<void>) => {
    if (busy) return;
    setError("");
    setStatus("");
    setBusy(true);
    cancel.current = false;
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const routes = async (nodes: OutingNode[], pairs: [string, string][]) => {
    const pending = cache.current!.pending(nodes, pairs).length;
    if (scene.mode === "baidu" && pending) {
      const q = await request<QuotaSnapshot>("/api/quota");
      if (q.limits.route - q.used.route < pending * 2)
        throw new Error(
          "剩余路线预算不足（需包含重试余量），请减少候选地点或使用示例。",
        );
    }
    return cache.current!.obtain(
      nodes,
      pairs,
      (b) => post<RouteBundle>("/api/outings/routes", b),
      (done, total) => {
        try {
          localStorage.setItem(
            "yike-outing-routes",
            JSON.stringify(cache.current!.snapshot()),
          );
        } catch {
          throw new Error("路线缓存无法保存，请释放浏览器空间后重试。");
        }
        if (alive.current)
          setStatus(
            `已读取 ${done}/${total} 段路线${scene.mode === "demo" ? " · 示例不调用地图接口" : ""}`,
          );
      },
      () => cancel.current,
    );
  };
  let selection: ReturnType<typeof errandSelection> | null = null;
  try {
    selection = errandSelection(scene, categories, stays);
  } catch {}
  const currentTarget =
    scene.facilities.find((p) => p.id === target) ??
    scene.facilities.find((p) => p.category === "park") ??
    scene.facilities[0];
  const selectedRests =
    restSelection !== null
      ? scene.rests.filter((p) => restSelection.includes(p.id))
      : scene.rests.filter((r) => r.validUntil >= todayLocal()).slice(0, 3);
  const baseline = scene.facilities
      .filter((p) => p.category === impactCategory)
      .slice(0, 3),
    proposed = scene.proposed[newIndex];
  const stepPatch = (i: number, patch: Partial<FamiliarStep>) =>
    setSteps((old) => old.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const hasDraft = !!(
    routeName || steps.some((s) => s.title || s.instruction || s.photo)
  );
  const emptyBundle = (nodes: OutingNode[]): RouteBundle => ({
    nodes,
    edges: [],
    mode: scene.mode,
    generatedAt: "",
  });
  const print = () => {
    document.body.classList.add("printing-card", "printing-familiar");
    window.print();
    setTimeout(
      () =>
        document.body.classList.remove("printing-card", "printing-familiar"),
      0,
    );
  };
  if (movement)
    return (
      <MovementPanel
        book={book}
        save={save}
        trip={movement}
        back={() => setMovement(null)}
      />
    );
  if (shopping)
    return (
      <ShoppingPanel
        book={book}
        save={save}
        result={result}
        back={() => setShopping(false)}
      />
    );
  return (
    <div className="outing-panel">
      <div className="life-heading no-print">
        <p className="eyebrow">把一次出门安排好</p>
        <h2>出门办事</h2>
        <p>留好返程时间，也留下家人认得出的路。</p>
      </div>
      <nav className="outing-tabs no-print" aria-label="出门办事功能">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              setError("");
              setStatus("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab !== "familiar" && (
        <div className="outing-source no-print">
          <label>
            使用的地点
            <select
              disabled={busy}
              value={example ? "demo" : "report"}
              onChange={(e) => setExample(e.target.value === "demo")}
            >
              <option value="demo">示例街区</option>
              <option value="report" disabled={result?.mode !== "baidu"}>
                当前真实报告
              </option>
            </select>
          </label>
          <p>{scene.label}</p>
          <small>
            {scene.mode === "demo"
              ? "所有地点、路线和核验记录均为模拟。"
              : `历史数据：${scene.date.slice(0, 10)}。新路线按需读取，营业与入口情况需另行核对。`}
          </small>
        </div>
      )}
      {error && (
        <p className="error no-print" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="status no-print" role="status">
          {status}
        </p>
      )}
      {busy && (
        <button
          className="secondary no-print"
          onClick={() => {
            cancel.current = true;
            setStatus("正在停止，当前小批次结束后保留已读取路线。");
          }}
        >
          停止计算
        </button>
      )}
      {tab !== "familiar" && (
        <fieldset className="outing-preferences no-print" disabled={busy}>
          <legend>这次出门</legend>
          <label>
            出发时间
            <input
              aria-label="办事出发时间"
              type="time"
              value={prefs.departure}
              onChange={(e) => {
                setPrefs({ ...prefs, departure: e.target.value });
                setPlans([]);
                setRestResult(null);
                setImpact(null);
              }}
            />
          </label>
          <label>
            步速（米/秒）
            <input
              aria-label="办事步速"
              type="number"
              min="0.3"
              max="2"
              step="0.1"
              value={prefs.speedMps}
              onChange={(e) => {
                setPrefs({ ...prefs, speedMps: Number(e.target.value) });
                setPlans([]);
                setRestResult(null);
                setImpact(null);
              }}
            />
          </label>
          <p className="muted">
            {prefs.signals.enabled
              ? "沿用出行偏好的等灯假设；这是估算，未接入实时行人信号。"
              : "未计入等灯。可在“出行偏好”里设置等待假设。"}
          </p>
        </fieldset>
      )}
      {tab === "errands" && (
        <>
          <button
            className="outing-entry primary"
            disabled={busy}
            onClick={() => setShopping(true)}
          >
            顺路好买 · 按清单与预算安排
          </button>
          <button
            className="outing-entry subtle"
            disabled={busy}
            onClick={() => setMovement(demoMovementTrip())}
          >
            顺路动一动 · 先看离线示例
          </button>
          <fieldset className="outing-form no-print" disabled={busy}>
            <legend>这趟想做什么</legend>
            <label>
              出门到回来的总时间（分钟）
              <input
                aria-label="办事总时间"
                type="number"
                min="5"
                max="180"
                value={budget}
                onChange={(e) => {
                  setBudget(Number(e.target.value));
                  setPlans([]);
                }}
              />
            </label>
            <div className="outing-task-list">
              {taskOptions.map((o) => (
                <div key={o.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={categories.includes(o.id)}
                      onChange={(e) => {
                        setCategories(
                          e.target.checked
                            ? [...categories, o.id]
                            : categories.filter((c) => c !== o.id),
                        );
                        setPlans([]);
                      }}
                    />
                    {o.label}
                  </label>
                  {categories.includes(o.id) && (
                    <label>
                      停留（分钟）
                      <input
                        aria-label={`${o.label}停留`}
                        type="number"
                        min="0"
                        max="60"
                        value={stays[o.id]}
                        onChange={(e) => {
                          setStays({
                            ...stays,
                            [o.id]: Number(e.target.value),
                          });
                          setPlans([]);
                        }}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            <details>
              <summary>候选地点与营业时间</summary>
              <p className="muted">
                每件事比较最多两处地点，整趟最多五处候选。填入的时间适用于本次出行；留空表示未确认。
              </p>
              {selection?.nodes.slice(1).map((n) => (
                <div className="outing-opening" key={n.id}>
                  <strong>{n.name}</strong>
                  <label>
                    开门
                    <input
                      aria-label={`${n.name}开门`}
                      type="time"
                      value={opening[n.id]?.start || ""}
                      onChange={(e) => {
                        setOpening({
                          ...opening,
                          [n.id]: {
                            start: e.target.value,
                            end: opening[n.id]?.end || "",
                          },
                        });
                        setPlans([]);
                      }}
                    />
                  </label>
                  <label>
                    关门
                    <input
                      aria-label={`${n.name}关门`}
                      type="time"
                      value={opening[n.id]?.end || ""}
                      onChange={(e) => {
                        setOpening({
                          ...opening,
                          [n.id]: {
                            start: opening[n.id]?.start || "",
                            end: e.target.value,
                          },
                        });
                        setPlans([]);
                      }}
                    />
                  </label>
                </div>
              ))}
            </details>
            <p className="muted">
              {scene.mode === "demo"
                ? "使用模拟路网，不消耗百度额度。"
                : `首次最多读取${selection ? allPairs(selection.nodes).length : 0}段路线；重试也计入预算，已有路线优先复用。`}
            </p>
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  const s = errandSelection(scene, categories, stays),
                    windows: Record<string, OpeningWindow> = {};
                  for (const [id, w] of Object.entries(opening)) {
                    if (!s.nodes.some((n) => n.id === id)) continue;
                    if (w.start || w.end) {
                      if (!w.start || !w.end)
                        throw new Error(
                          "请把开门和关门时间一起填好，或都留空。",
                        );
                      windows[id] = w;
                    }
                  }
                  const validPrefs = cleanJourney(prefs);
                  planErrands(
                    emptyBundle(s.nodes),
                    scene.origin.id,
                    s.tasks,
                    validPrefs,
                    budget,
                    windows,
                  );
                  const r = planErrands(
                    await routes(s.nodes, allPairs(s.nodes)),
                    scene.origin.id,
                    s.tasks,
                    validPrefs,
                    budget,
                    windows,
                  );
                  setPlans(
                    r.plans.map((p) => ({
                      ...itineraryText(p),
                      movement: movementTrip(
                        p.visits,
                        {
                          source: "errands",
                          mode: scene.mode,
                          origin: scene.origin.name,
                          originalMinutes: p.totalMinutes,
                          budgetMinutes: budget,
                          prefs: validPrefs,
                        },
                        windows,
                      ),
                    })),
                  );
                  setStatus(
                    r.plans.length
                      ? "已计入返程、停留和所填的营业时间。"
                      : "当前候选路线里没有符合时间预算的方案；可延长时间、减少任务或检查路线缺失。",
                  );
                })
              }
            >
              安排这趟出门
            </button>
          </fieldset>
          <div className="outing-results">
            {plans.map((p, i) => (
              <article className="outing-result" key={i}>
                {scene.mode === "demo" && (
                  <p className="eyebrow">离线示例 · 非真实街区</p>
                )}
                <span className="eyebrow">
                  {i === 0 ? "优先方案" : "另一种走法"}
                </span>
                <h3>{p.summary}</h3>
                <p>{p.detail}</p>
                <ol className="outing-timeline">
                  {p.rows.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ol>
                {p.notes.map((n) => (
                  <p className="muted" key={n}>
                    {n}
                  </p>
                ))}
                <button
                  className="subtle"
                  onClick={() => setMovement(p.movement)}
                >
                  这趟顺路动一动
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "rest" && (
        <>
          <fieldset className="outing-form" disabled={busy}>
            <legend>找一条能歇脚的路</legend>
            <p className="muted">
              从{scene.origin.name}
              出发，比较去程。休息点由本人确认，到期后不参与推荐。
            </p>
            <label>
              目的地
              <select
                value={currentTarget?.id || ""}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setRestResult(null);
                }}
              >
                {scene.facilities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="outing-preferences">
              <label>
                每次最多连续走（分钟）
                <input
                  aria-label="连续步行上限"
                  type="number"
                  min="1"
                  max="60"
                  value={continuous}
                  onChange={(e) => {
                    setContinuous(Number(e.target.value));
                    setRestResult(null);
                  }}
                />
              </label>
              <label>
                每站休息（分钟）
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={restMinutes}
                  onChange={(e) => {
                    setRestMinutes(Number(e.target.value));
                    setRestResult(null);
                  }}
                />
              </label>
            </div>
            <div>
              {scene.rests.map((r) => (
                <label className="check" key={r.id}>
                  <input
                    type="checkbox"
                    checked={selectedRests.some((v) => v.id === r.id)}
                    disabled={r.validUntil < todayLocal()}
                    onChange={(e) => {
                      const ids = selectedRests.map((v) => v.id);
                      if (e.target.checked && ids.length >= 3) {
                        setError("最多选择3个休息点。");
                        return;
                      }
                      setRestSelection(
                        e.target.checked
                          ? [...ids, r.id]
                          : ids.filter((id) => id !== r.id),
                      );
                      setRestResult(null);
                    }}
                  />
                  {r.name} · 有效至{r.validUntil}
                </label>
              ))}
            </div>
            {!scene.rests.length && (
              <p>还没有休息点，可以先使用示例，或在下面从地点簿添加。</p>
            )}
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  if (!currentTarget) throw new Error("请先选择目的地。");
                  const rests = selectedRests
                      .filter((r) => r.validUntil >= todayLocal())
                      .filter((r) => r.id !== currentTarget.id),
                    nodes = [
                      scene.origin,
                      currentTarget,
                      ...rests.filter((r) => r.id !== currentTarget.id),
                    ];
                  planRestJourney(
                    emptyBundle(nodes),
                    scene.origin.id,
                    currentTarget.id,
                    rests,
                    prefs,
                    continuous,
                    restMinutes,
                  );
                  const r = planRestJourney(
                    await routes(nodes, allPairs(nodes)),
                    scene.origin.id,
                    currentTarget.id,
                    rests,
                    prefs,
                    continuous,
                    restMinutes,
                  );
                  setRestResult(r);
                  setStatus(
                    r.plans.length
                      ? "已找到符合连续步行上限的方案。"
                      : "这些路线与已核验休息点暂时无法满足条件；请调整上限或补充休息点。",
                  );
                })
              }
            >
              找能歇脚的走法
            </button>
          </fieldset>
          {restResult?.plans.map((p, i) => (
            <article className="outing-result" key={i}>
              <p className="eyebrow">
                {scene.mode === "demo" ? "离线示例 · " : ""}连续步行上限
                {continuous}分钟
              </p>
              <h3>
                {minutesText(p.totalMinutes)} · 歇脚{p.restCount}次
              </h3>
              <p>
                最长连续步行{minutesText(p.longestMinutes)}，预计{p.finish}
                到达。
              </p>
              <ol className="outing-timeline">
                {p.visits.map((v, j) => (
                  <li key={j}>
                    {v.arrival} {v.name} · 步行{minutesText(v.walkMinutes)}
                    {v.stayMinutes ? `，休息${minutesText(v.stayMinutes)}` : ""}
                  </li>
                ))}
              </ol>
            </article>
          ))}
          <details className="outing-form">
            <summary>从私人地点簿登记休息点</summary>
            <p className="muted">
              请先确认现场确实有可用座位。这里只保存本人的核验记录。
            </p>
            <label>
              地点
              <select
                value={placeIndex}
                onChange={(e) => setPlaceIndex(Number(e.target.value))}
              >
                {book.places.map((p, i) => (
                  <option value={i} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              实际核验日期
              <input
                type="date"
                value={restChecked}
                max={todayLocal()}
                onChange={(e) => setRestChecked(e.target.value)}
              />
            </label>
            <label>
              有效至（最长90天）
              <input
                type="date"
                value={restUntil}
                onChange={(e) => setRestUntil(e.target.value)}
              />
            </label>
            <label>
              座位位置与开放提醒
              <input
                value={restNote}
                maxLength={300}
                onChange={(e) => setRestNote(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !book.places.length}
              onClick={() =>
                void run(() => {
                  const p = book.places[placeIndex];
                  if (!p) throw new Error("请先到地点簿记录休息点。");
                  const r = cleanRestPoint({
                    ...p,
                    id: `rest-${p.id}`,
                    checkedOn: restChecked,
                    validUntil: restUntil,
                    note: restNote,
                  });
                  save({
                    ...book,
                    restPoints: [
                      ...(book.restPoints ?? []).filter((v) => v.id !== r.id),
                      r,
                    ],
                  });
                  setStatus(
                    "已保存本人的休息点核验记录。真实地点会在当前真实报告中参与选择。",
                  );
                })
              }
            >
              确认可休息并保存
            </button>
            {(book.restPoints ?? []).map((r) => (
              <p key={r.id}>
                {r.name} · {r.validUntil}
                <button
                  className="secondary"
                  onClick={() =>
                    void run(() => {
                      save({
                        ...book,
                        restPoints: book.restPoints!.filter(
                          (v) => v.id !== r.id,
                        ),
                      });
                      setUndo({ kind: "rest", value: r });
                      setStatus("已移除，可撤销。");
                    })
                  }
                >
                  移除
                </button>
              </p>
            ))}
          </details>
        </>
      )}
      {tab === "impact" && (
        <>
          <fieldset className="outing-form" disabled={busy}>
            <legend>假设这里多一处服务</legend>
            <label>
              比较哪类设施
              <select
                value={impactCategory}
                onChange={(e) => {
                  setImpactCategory(e.target.value);
                  setImpact(null);
                }}
              >
                <option value="pharmacy">药店</option>
                <option value="market">菜市场</option>
                <option value="school">小学</option>
              </select>
            </label>
            <label>
              候选新增地点
              <select
                value={newIndex}
                onChange={(e) => {
                  setNewIndex(Number(e.target.value));
                  setImpact(null);
                }}
              >
                {scene.proposed.map((p, i) => (
                  <option key={p.id} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {!proposed && (
              <p>先在地点簿记下候选位置，再打开当前真实报告进行对比。</p>
            )}
            <label>
              步行时间门槛（分钟）
              <input
                type="number"
                min="5"
                max="30"
                value={prefs.minutes}
                onChange={(e) => {
                  setPrefs({ ...prefs, minutes: Number(e.target.value) });
                  setImpact(null);
                }}
              />
            </label>
            <p>
              现有对照设施：
              {baseline.map((p) => p.name).join("、") || "当前报告没有同类设施"}
            </p>
            <p className="muted">
              对比{scene.samples.length}
              个固定测试点。此处是规划假设，不会把私人地点加入公共体检，也不代表受益人数或真实开业。
            </p>
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  if (!proposed || !baseline.length)
                    throw new Error("请先准备候选位置和同类现有设施。");
                  const nodes = [...scene.samples, ...baseline, proposed],
                    pairs = scene.samples.flatMap((s) =>
                      [...baseline, proposed].map(
                        (t) => [s.id, t.id] as [string, string],
                      ),
                    );
                  const validPrefs = cleanJourney(prefs);
                  compareAddition(
                    emptyBundle(nodes),
                    scene.samples.map((p) => p.id),
                    baseline.map((p) => p.id),
                    proposed.id,
                    validPrefs,
                  );
                  setImpact(
                    compareAddition(
                      await routes(nodes, pairs),
                      scene.samples.map((p) => p.id),
                      baseline.map((p) => p.id),
                      proposed.id,
                      validPrefs,
                    ),
                  );
                  setStatus("对比完成，原始体检报告未改变。");
                })
              }
            >
              比较补点前后
            </button>
          </fieldset>
          {impact && (
            <article className="outing-result">
              <p className="eyebrow">
                {scene.mode === "demo" ? "离线示例 · " : ""}
                {prefs.minutes}分钟门槛 · 假设补点
              </p>
              <h3>
                新增覆盖 {impact.newlyCovered}/{impact.rows.length} 个测试点
              </h3>
              <p>
                {impact.improved}个点步行时间缩短；{impact.unknown}
                个点资料不足。
              </p>
              <p>
                有完整对照的点，平均节省
                {minutesText(impact.averageSavedMinutes)}。
              </p>
              <div className="outing-impact-table">
                <table>
                  <thead>
                    <tr>
                      <th>固定测试点</th>
                      <th>所选现有设施</th>
                      <th>增加候选后</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{minutesText(r.beforeMinutes)}</td>
                        <td>
                          {minutesText(r.afterMinutes)}
                          {r.gain ? " · 新覆盖" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                结论仅针对所列设施和测试点；没有人口数据，也不是全部社区的覆盖率。
              </p>
            </article>
          )}
        </>
      )}
      {tab === "familiar" && (
        <>
          {!showEditor && !selected && (
            <button
              className="primary no-print"
              onClick={() => setShowEditor(true)}
            >
              {hasDraft ? "继续编辑熟路草稿" : "添加一条熟路"}
            </button>
          )}
          {showEditor && !selected && (
            <fieldset className="outing-form no-print" disabled={busy}>
              <h3>留下家人认得出的关键点</h3>
              <p className="muted">
                按走路顺序记录2—8个关键点。照片和指引可离线查看；卡片不自动判断当前位置。
              </p>
              <label>
                熟路名称
                <input
                  aria-label="熟路名称"
                  value={routeName}
                  maxLength={80}
                  onChange={(e) => setRouteName(e.target.value)}
                />
              </label>
              <label>
                实际走访日期
                <input
                  type="date"
                  value={checkedOn}
                  max={todayLocal()}
                  onChange={(e) => setCheckedOn(e.target.value)}
                />
              </label>
              {steps.map((s, i) => (
                <div className="outing-step-editor" key={i}>
                  <strong>第{i + 1}个关键点</strong>
                  <label>
                    认准哪里
                    <input
                      aria-label={`关键点${i + 1}名称`}
                      maxLength={80}
                      value={s.title}
                      onChange={(e) => stepPatch(i, { title: e.target.value })}
                    />
                  </label>
                  <label>
                    到这里怎么走
                    <textarea
                      aria-label={`关键点${i + 1}指引`}
                      maxLength={300}
                      value={s.instruction}
                      onChange={(e) =>
                        stepPatch(i, { instruction: e.target.value })
                      }
                    />
                  </label>
                  {s.photo && (
                    <img
                      className="outing-photo"
                      src={s.photo}
                      alt={`${s.title || "关键点"}照片`}
                    />
                  )}
                  <label>
                    入口或地标照片
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void run(async () =>
                            stepPatch(i, { photo: await preparePlacePhoto(f) }),
                          );
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <div className="life-actions">
                    <button
                      disabled={i === 0 || busy}
                      onClick={() =>
                        setSteps((old) => {
                          const v = [...old];
                          [v[i - 1], v[i]] = [v[i], v[i - 1]];
                          return v;
                        })
                      }
                    >
                      上移
                    </button>
                    <button
                      disabled={i === steps.length - 1 || busy}
                      onClick={() =>
                        setSteps((old) => {
                          const v = [...old];
                          [v[i], v[i + 1]] = [v[i + 1], v[i]];
                          return v;
                        })
                      }
                    >
                      下移
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setSteps((old) => old.filter((_, j) => j !== i))
                      }
                    >
                      移除关键点
                    </button>
                    {s.photo && (
                      <button
                        onClick={() => stepPatch(i, { photo: undefined })}
                      >
                        移除照片
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="life-actions">
                <button
                  disabled={steps.length >= 8 || busy}
                  onClick={() => setSteps([...steps, emptyStep()])}
                >
                  添加关键点
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => {
                      const r = cleanFamiliarRoute({
                        id: editing ?? crypto.randomUUID(),
                        name: routeName,
                        checkedOn,
                        steps,
                      });
                      save({
                        ...book,
                        familiarRoutes: [
                          ...(book.familiarRoutes ?? []).filter(
                            (v) => v.id !== r.id,
                          ),
                          r,
                        ],
                      });
                      setSelected(r);
                      setShowEditor(false);
                      setEditing(r.id);
                      setStatus(
                        "熟路卡已保存在本机，可到设备与同步中同步给已配对设备。",
                      );
                    })
                  }
                >
                  保存熟路卡
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      hasDraft &&
                      !window.confirm("清空当前编辑草稿，开始另一条熟路？")
                    )
                      return;
                    setEditing(null);
                    setRouteName("");
                    setCheckedOn(todayLocal());
                    setSteps([emptyStep(), emptyStep()]);
                  }}
                >
                  新建另一条
                </button>
              </div>
            </fieldset>
          )}
          {!selected && (
            <div className="outing-route-list no-print">
              {(book.familiarRoutes ?? []).map((r) => (
                <article className="outing-result" key={r.id}>
                  <h3>{r.name}</h3>
                  <p>
                    {r.steps.length}个关键点 · {r.checkedOn}走访
                  </p>
                  <div className="life-actions">
                    <button onClick={() => setSelected(r)}>查看熟路卡</button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          hasDraft &&
                          !window.confirm("用这条熟路替换当前编辑草稿？")
                        )
                          return;
                        setEditing(r.id);
                        setShowEditor(true);
                        setRouteName(r.name);
                        setCheckedOn(r.checkedOn);
                        setSteps(r.steps);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() => {
                          save({
                            ...book,
                            familiarRoutes: book.familiarRoutes!.filter(
                              (v) => v.id !== r.id,
                            ),
                          });
                          setUndo({ kind: "route", value: r });
                          setStatus("已移除熟路卡，可撤销。");
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {selected && (
            <article className="familiar-print">
              <h2>{selected.name}</h2>
              <p>{selected.checkedOn}走访记录 · 请以现场道路及过街指示为准</p>
              <div className="life-actions no-print">
                <button onClick={() => setSelected(null)}>返回熟路列表</button>
                <button onClick={print}>打印整条熟路</button>
                <button
                  onClick={() =>
                    void run(async () => {
                      try {
                        await navigator.clipboard.writeText(
                          familiarText(selected),
                        );
                      } catch {
                        throw new Error(
                          "复制未完成，可直接选中文字复制，或使用打印。",
                        );
                      }
                      setStatus("熟路文字已复制。");
                    })
                  }
                >
                  复制文字
                </button>
              </div>
              {selected.steps.map((s, i) => (
                <section className="familiar-step" key={i}>
                  <span className="step-number">{i + 1}</span>
                  <h3>{s.title}</h3>
                  {s.photo && <img src={s.photo} alt={`${s.title}实拍`} />}
                  <p>{s.instruction}</p>
                </section>
              ))}
            </article>
          )}
        </>
      )}
      {undo && (
        <button
          className="secondary no-print"
          onClick={() =>
            void run(() => {
              if (undo.kind === "route") {
                if (book.familiarRoutes?.some((r) => r.id === undo.value.id))
                  throw new Error("同编号的熟路已经存在，请先核对。");
                save({
                  ...book,
                  familiarRoutes: [...(book.familiarRoutes ?? []), undo.value],
                });
              } else {
                if (book.restPoints?.some((r) => r.id === undo.value.id))
                  throw new Error("同编号的休息点已经存在，请先核对。");
                save({
                  ...book,
                  restPoints: [...(book.restPoints ?? []), undo.value],
                });
              }
              setUndo(null);
              setStatus("已恢复移除的记录，其他修改保留。");
            })
          }
        >
          撤销移除
        </button>
      )}
    </div>
  );
}
