import { useEffect, useRef, useState } from "react";
import {
  CATEGORIES,
  type AnalysisResult,
  type Category,
  type Facility,
  type Job,
  type LngLat,
  type Mode,
  type Progress,
  type PublicConfig,
  type XY,
} from "../shared/types.js";
import { DEMO_CENTERS, demoFacilities } from "../core/demo.js";
import { facilityCount } from "../core/facilities.js";
import { usableFacility } from "../shared/facility-review.js";
import { validGeo } from "../core/geo.js";
import { DemoMap } from "./DemoMap.js";
import { BaiduMap } from "./BaiduMap.js";
import { Report, walkTime } from "./Report.js";
import { post, request } from "./api.js";
import { ResultLibrary } from "./ResultLibrary.js";
import { QuotaPanel } from "./QuotaPanel.js";
import { GAP_CATEGORIES, type GapCategory } from "../core/coverage.js";
import { LifePanel } from "./LifePanel.js";
import { personalize } from "../core/personalize.js";
import type { PersonalPlace } from "../shared/life.js";
import { SimpleHome } from "./SimpleHome.js";
import { CoverageInspector } from "./CoverageInspector.js";
import { CommunityGuide } from "./CommunityGuide.js";
import { SIMPLE_KEY } from "../shared/family.js";

export function App() {
  const [guided, setGuided] = useState(
    () => new URLSearchParams(location.search).get("showcase") === "1",
  );
  const [simple, setSimple] = useState(
    () => localStorage.getItem(SIMPLE_KEY) !== "false",
  );
  const switchMode = (value: boolean) => {
    try {
      localStorage.setItem(SIMPLE_KEY, String(value));
      setSimple(value);
    } catch {
      setError("模式未能保存，请检查浏览器存储后重试。");
    }
  };
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [mode, setMode] = useState<Mode>("demo");
  const [point, setPoint] = useState<XY>(DEMO_CENTERS[0].point);
  const [geo, setGeo] = useState<LngLat | null>(null);
  const [label, setLabel] = useState(DEMO_CENTERS[0].label);
  const [address, setAddress] = useState("上海市杨浦区抚顺路社区睦邻中心");
  const [coordinateText, setCoordinateText] = useState({ lng: "", lat: "" });
  const [minutes, setMinutes] = useState(15);
  const [categories, setCategories] = useState<Category[]>(
    CATEGORIES.map((c) => c.id),
  );
  const [showGaps, setShowGaps] = useState(false);
  const [gapCategory, setGapCategory] = useState<GapCategory>("school");
  const [gapPoint, setGapPoint] = useState<string | null>(null);
  const selectGap = (id: string) => {
    setGapPoint(id);
    setSelected(null);
    requestAnimationFrame(() =>
      document.getElementById("coverage-inspector")?.focus(),
    );
  };
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [replay, setReplay] = useState(false);
  const [liveMap, setLiveMap] = useState(false);
  const [selected, setSelected] = useState<Facility | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    stage: "",
    done: 0,
    total: 1,
  });
  const [error, setError] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [view, setView] = useState<"map" | "report" | "life">("map");
  const [lifeSection, setLifeSection] = useState<
    "places" | "preferences" | "sync"
  >("places");
  const [showHelp, setShowHelp] = useState(false);
  const [mobileLayers, setMobileLayers] = useState(false);
  const jobId = useRef<string | null>(null);
  const cancelled = useRef(false);
  const refreshConfig = () =>
    request<PublicConfig>("/api/config")
      .then((value) => {
        setConfig(value);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refreshConfig();
    return () => {
      cancelled.current = true;
    };
  }, []);
  useEffect(() => {
    if (window.matchMedia("(max-width:760px)").matches)
      requestAnimationFrame(() =>
        document
          .querySelector(".content-topbar")
          ?.scrollIntoView({ block: "start" }),
      );
  }, [view]);
  const clearResult = () => {
    setResult(null);
    setReplay(false);
    setLiveMap(false);
    setSelected(null);
    setError("");
    setView("map");
    setShowGaps(false);
  };
  const openResult = (value: AnalysisResult) => {
    setResult(value);
    setMode(value.mode);
    setPoint(value.center.point);
    setGeo(value.center.geo ?? null);
    setLabel(value.center.label);
    setLocationNote("");
    if (value.mode === "baidu") setAddress(value.center.label);
    if (value.center.geo)
      setCoordinateText({
        lng: String(value.center.geo.lng),
        lat: String(value.center.geo.lat),
      });
    setSelected(null);
    setError("");
    setReplay(true);
    setLiveMap(false);
    setMinutes(value.scenario?.preferences.minutes ?? 15);
    setView("report");
    setShowGaps(false);
  };
  const changeMode = (value: Mode) => {
    setMode(value);
    clearResult();
    setLocationNote("");
    setLabel(
      value === "demo"
        ? (DEMO_CENTERS.find(
            (c) => c.point[0] === point[0] && c.point[1] === point[1],
          )?.label ?? "自选中心")
        : address,
    );
  };
  const choosePoint = (p: XY) => {
    setPoint(p);
    setLabel(
      DEMO_CENTERS.find((c) => c.point[0] === p[0] && c.point[1] === p[1])
        ?.label ?? "自选中心",
    );
    clearResult();
  };
  const chooseGeo = (p: LngLat, name = "自选地图中心") => {
    setGeo(p);
    setLabel(name);
    setCoordinateText({ lng: p.lng.toFixed(6), lat: p.lat.toFixed(6) });
    clearResult();
    setLocationNote("请在地图上确认实际入口，再开始体检。");
  };
  async function locateAddress() {
    setLocating(true);
    setError("");
    try {
      const value = await post<{
        geo: LngLat;
        precise: boolean;
        confidence: number | null;
      }>("/api/geocode", { address });
      chooseGeo(value.geo, address);
      if (!value.precise)
        setLocationNote("地址定位是近似位置，请在地图上点击实际入口进行调整。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "地址定位失败，请重试。");
    } finally {
      setLocating(false);
    }
  }
  async function run(demo = false) {
    const runMode = demo ? "demo" : mode;
    const runLabel = demo ? DEMO_CENTERS[0].label : label;
    setBusy(true);
    setError("");
    setSelected(null);
    setReplay(Boolean(result));
    setView("map");
    cancelled.current = false;
    setProgress({ stage: "准备体检", done: 0, total: 1 });
    try {
      const started = await post<{ id: string }>("/api/analyses", {
        mode: runMode,
        label: runLabel,
        ...(runMode === "demo"
          ? { point: demo ? DEMO_CENTERS[0].point : point }
          : { geo }),
      });
      jobId.current = started.id;
      if (cancelled.current) {
        await request(`/api/analyses/${started.id}`, { method: "DELETE" });
        return;
      }
      for (;;) {
        const job = await request<Job>(`/api/analyses/${started.id}`);
        if (cancelled.current) break;
        setProgress(job.progress);
        if (job.status === "done" && job.result) {
          setMode(runMode);
          setLabel(runLabel);
          if (demo) {
            setPoint(DEMO_CENTERS[0].point);
            setGeo(null);
            setLiveMap(false);
          }
          setResult(job.result);
          setMinutes(15);
          setReplay(false);
          if (window.matchMedia("(max-width:760px)").matches)
            requestAnimationFrame(() =>
              document.querySelector(".content-topbar")?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion:reduce)")
                  .matches
                  ? "instant"
                  : "smooth",
                block: "start",
              }),
            );
          break;
        }
        if (job.status === "error")
          throw new Error(job.error ?? "体检未完成，请重试。");
        if (job.status === "cancelled") break;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (e) {
      if (!cancelled.current)
        setError(e instanceof Error ? e.message : "体检未完成，请重试。");
    } finally {
      setBusy(false);
      jobId.current = null;
    }
  }
  async function cancel() {
    cancelled.current = true;
    try {
      if (jobId.current)
        await request(`/api/analyses/${jobId.current}`, { method: "DELETE" });
    } catch {
      setError("取消请求未送达，服务端会在任务到期后停止。");
    }
    setBusy(false);
  }
  async function usePersonalPlace(place: PersonalPlace) {
    setError("");
    const p = place.position;
    if (p.system === "demo") {
      if (Math.abs(p.x) > 1000 || Math.abs(p.y) > 1000) {
        setError("模拟街区起点需在中心1000米内，这个地点仍可查看大字指引。");
        return;
      }
      setMode("demo");
      choosePoint([p.x, p.y]);
      setLabel(place.name);
    } else {
      setLocating(true);
      try {
        const position =
          p.system === "bd09"
            ? { lng: p.lng, lat: p.lat }
            : (
                await post<{ geo: LngLat }>("/api/convert", {
                  geo: { lng: p.lng, lat: p.lat },
                  from: p.system === "gcj02" ? 3 : 1,
                })
              ).geo;
        setMode("baidu");
        chooseGeo(position, place.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "位置转换失败，请重试。");
      } finally {
        setLocating(false);
      }
    }
  }
  const allFacilities =
    result?.facilities ?? (mode === "demo" ? demoFacilities() : []);
  const visible = allFacilities.filter(
    (p) =>
      usableFacility(p) &&
      categories.includes(p.category) &&
      (!result ||
        (p.travel?.status === "ok" && p.travel.seconds <= minutes * 60)),
  );
  const total =
    result?.facilities.filter(
      (p) =>
        usableFacility(p) &&
        p.travel?.status === "ok" &&
        p.travel.seconds <= minutes * 60,
    ).length ?? 0;
  const area =
    result?.contours.find((c) => c.minutes === minutes)?.areaKm2 ?? 0;
  const uniqueGaps = result
    ? new Set(result.gaps.map((g) => g.point.join(","))).size
    : 0;
  const canAnalyze =
    !busy &&
    !locating &&
    !!config &&
    (mode === "demo" || (!!config.baiduConfigured && !!geo));

  if (simple && !guided)
    return (
      <SimpleHome
        community={() => setGuided(true)}
        result={result}
        full={(life) => {
          if (life) {
            setLifeSection("places");
            setView("life");
          }
          switchMode(false);
        }}
      />
    );
  return (
    <>
      <a className="skip-link" href="#main-workspace">
        跳到体检工作台
      </a>
      <header className="app-header no-print">
        <button
          className="secondary"
          onClick={() => {
            setGuided(false);
            const url = new URL(location.href);
            url.searchParams.delete("showcase");
            history.replaceState(
              null,
              "",
              url.pathname + url.search + url.hash,
            );
            switchMode(true);
          }}
        >
          {guided ? "日常首页" : "简易模式"}
        </button>
        <a href="/" className="brand" aria-label="一刻烟火首页">
          <img src="/favicon.svg" alt="" width="38" height="38" />
          <div>
            <strong>一刻烟火</strong>
            <span>15分钟生活圈体检</span>
          </div>
        </a>
        <div className="header-right">
          <span className="header-caption">把日常，放回步行尺度</span>
          <button
            className="text-button"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
          >
            使用说明
          </button>
        </div>
      </header>
      {showHelp && (
        <section className="help-panel no-print">
          <h2>从一个地点开始</h2>
          <p>
            选择中心，点击“开始体检”，再查看不同步行时长内已发现的设施。切换时长和分类会直接复用本次结果。
          </p>
          <p>
            模拟街区可直接体验；真实案例先输入地址，并在地图上确认入口。体检完成后可导出数据，或在报告页打印为
            PDF。
          </p>
          <button className="text-button" onClick={() => setShowHelp(false)}>
            收起说明
          </button>
        </section>
      )}
      <main
        id="main-workspace"
        className={`workspace ${guided ? "guided" : ""} ${view === "life" ? "life-view" : ""}`}
      >
        <aside className="control-panel no-print" aria-label="体检设置">
          <div className="panel-intro">
            <p className="eyebrow">从家门口出发</p>
            <h1>看看附近的生活</h1>
            <p>一段步行，连起日常所需。</p>
            {!guided && (
              <button className="text-button" onClick={() => setGuided(true)}>
                社区体检演示
              </button>
            )}
          </div>
          <div className="mode-switch" role="group" aria-label="数据模式">
            <button
              disabled={busy || locating}
              aria-pressed={mode === "demo"}
              onClick={() => changeMode("demo")}
            >
              模拟街区
            </button>
            <button
              disabled={busy || locating}
              aria-pressed={mode === "baidu"}
              onClick={() => changeMode("baidu")}
            >
              百度地图
            </button>
          </div>
          <ResultLibrary
            result={result}
            disabled={busy || locating}
            onOpen={openResult}
          />
          <section className="control-section">
            <h2>分析地点</h2>
            {mode === "demo" ? (
              <>
                <label htmlFor="demo-center" className="field-label">
                  选择一个起点
                </label>
                <select
                  id="demo-center"
                  disabled={busy}
                  value={DEMO_CENTERS.findIndex(
                    (c) => c.point[0] === point[0] && c.point[1] === point[1],
                  )}
                  onChange={(e) =>
                    choosePoint(DEMO_CENTERS[Number(e.target.value)].point)
                  }
                >
                  {DEMO_CENTERS.map((c, i) => (
                    <option key={c.label} value={i}>
                      {c.label}
                    </option>
                  ))}
                  <option value="-1" disabled>
                    地图自选中心
                  </option>
                </select>
                <p className="field-note">也可以点击地图中心区域，换个起点。</p>
              </>
            ) : (
              <>
                {!config?.baiduConfigured && (
                  <div className="notice">
                    <strong>真实地图服务尚未就绪</strong>
                    <p>填写本地配置并重启服务后，点击下方刷新。</p>
                    <button
                      className="text-button"
                      onClick={() => void refreshConfig()}
                    >
                      刷新连接状态
                    </button>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void locateAddress();
                  }}
                >
                  <label htmlFor="address" className="field-label">
                    社区名称或详细地址
                  </label>
                  <input
                    id="address"
                    value={address}
                    disabled={busy || locating}
                    maxLength={160}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                  <button
                    className="secondary wide"
                    disabled={
                      busy ||
                      locating ||
                      !config?.baiduConfigured ||
                      address.trim().length < 2
                    }
                  >
                    {locating ? "正在定位…" : "定位地址"}
                  </button>
                </form>
                <details className="coordinate-input">
                  <summary>直接输入地图坐标</summary>
                  <p className="field-note">仅接收百度经纬度（BD-09）。</p>
                  <label className="field-label" htmlFor="lng">
                    经度
                  </label>
                  <input
                    id="lng"
                    inputMode="decimal"
                    value={coordinateText.lng}
                    disabled={busy}
                    onChange={(e) =>
                      setCoordinateText((v) => ({ ...v, lng: e.target.value }))
                    }
                  />
                  <label className="field-label" htmlFor="lat">
                    纬度
                  </label>
                  <input
                    id="lat"
                    inputMode="decimal"
                    value={coordinateText.lat}
                    disabled={busy}
                    onChange={(e) =>
                      setCoordinateText((v) => ({ ...v, lat: e.target.value }))
                    }
                  />
                  <button
                    className="secondary wide"
                    disabled={busy}
                    onClick={() => {
                      const p = {
                        lng: Number(coordinateText.lng),
                        lat: Number(coordinateText.lat),
                      };
                      if (validGeo(p)) chooseGeo(p);
                      else setError("请输入有效的百度经纬度坐标。");
                    }}
                  >
                    使用这个点
                  </button>
                </details>
                {locationNote && (
                  <p className="field-note" role="status">
                    {locationNote}
                  </p>
                )}
              </>
            )}
          </section>
          <section className="control-section time-section">
            <h2>步行时长</h2>
            <div className="time-switch" role="group" aria-label="查看步行时长">
              {(result?.contours.map((c) => c.minutes) ?? [5, 10, 15]).map(
                (m) => (
                  <button
                    key={m}
                    aria-pressed={minutes === m}
                    onClick={() => {
                      setMinutes(m);
                      setSelected(null);
                    }}
                  >
                    <strong>{m}</strong>
                    <span>分钟</span>
                  </button>
                ),
              )}
            </div>
            <button
              className="text-button"
              onClick={() => {
                setLifeSection("preferences");
                setView("life");
              }}
            >
              自定时长、步速与出发时间 →
            </button>
          </section>
          <button
            className="primary start-button"
            onClick={() => void run()}
            disabled={!canAnalyze}
          >
            {busy ? "正在体检…" : result ? "重新体检" : "开始体检"}
            <span aria-hidden="true">↗</span>
          </button>
          {busy && (
            <div className="progress-block" role="status">
              <div>
                <span>{progress.stage}</span>
                <span>
                  {progress.done} / {progress.total}
                </span>
              </div>
              <progress
                value={progress.done}
                max={Math.max(1, progress.total)}
              />
              <p>
                {mode === "baidu"
                  ? "正在逐批测时，请稍候。"
                  : "正在沿模拟道路计算。"}
              </p>
              <button className="text-button" onClick={() => void cancel()}>
                取消本次体检
              </button>
            </div>
          )}
          {error && (
            <div className="error-message" role="alert">
              {error}
              {!config && (
                <button
                  className="text-button"
                  onClick={() => void refreshConfig()}
                >
                  重新连接
                </button>
              )}
            </div>
          )}
          {mode === "baidu" && <QuotaPanel busy={busy || locating} />}
          <button
            className="text-button layer-disclosure-toggle"
            aria-expanded={mobileLayers}
            aria-controls="facility-layers"
            onClick={() => setMobileLayers((v) => !v)}
          >
            设施筛选与核查点 {mobileLayers ? "−" : "＋"}
          </button>
          <section
            id="facility-layers"
            className={`control-section layers ${mobileLayers ? "expanded" : ""}`}
          >
            <div className="section-line">
              <h2>生活设施</h2>
              <span>{result ? `${minutes}分钟内` : "地图图层"}</span>
            </div>
            <div className="category-list">
              {CATEGORIES.map((c) => (
                <label key={c.id} className="category-option">
                  <input
                    type="checkbox"
                    checked={categories.includes(c.id)}
                    onChange={(e) => {
                      setCategories((v) =>
                        e.target.checked
                          ? [...v, c.id]
                          : v.filter((id) => id !== c.id),
                      );
                      setSelected(null);
                    }}
                  />
                  <span className="category-symbol" style={{ color: c.color }}>
                    {c.short}
                  </span>
                  <span>{c.label}</span>
                  <strong>
                    {result
                      ? facilityCount(result.facilities, c.id, minutes)
                      : "—"}
                  </strong>
                </label>
              ))}
            </div>
            <label className="gap-switch">
              <input
                type="checkbox"
                checked={showGaps}
                disabled={!result}
                onChange={(e) => setShowGaps(e.target.checked)}
              />
              <span>显示设施覆盖核查点</span>
            </label>
          </section>
          <div className="side-note">
            {mode === "demo" ? (
              <>
                <span className="small-dot" />
                当前为模拟街区，所有地名与设施均为示例。
              </>
            ) : (
              <>
                <span className="small-dot" />
                真实案例候选：上海杨浦四平路街道，位置与入口需核验。
              </>
            )}
          </div>
        </aside>
        <div className="workspace-content">
          {guided && (
            <CommunityGuide
              result={result}
              busy={busy || locating}
              onExample={() => void run(true)}
              onImport={() => {
                const library =
                  document.querySelector<HTMLDetailsElement>(".result-library");
                if (library) library.open = true;
                document.getElementById("result-import")?.focus();
              }}
              onStep={(step) => {
                setView(step === "report" ? "report" : "map");
                setShowGaps(step === "coverage");
                if (step === "coverage") setMobileLayers(true);
                requestAnimationFrame(() => {
                  if (step === "coverage")
                    document.getElementById("coverage-inspector")?.focus();
                  else
                    document
                      .querySelector(
                        step === "report"
                          ? ".report-document"
                          : ".map-container",
                      )
                      ?.scrollIntoView({ block: "start" });
                });
              }}
            />
          )}
          <div className="content-topbar no-print">
            <div>
              <span className={`status-tag ${mode}`}>
                {replay
                  ? "历史结果"
                  : mode === "demo"
                    ? "模拟街区"
                    : "真实地图"}
              </span>
              <h2>
                {result
                  ? result.center.label
                  : mode === "demo"
                    ? label
                    : "选择社区起点"}
              </h2>
            </div>
            <div className="view-switch" role="group" aria-label="结果视图">
              <button
                aria-pressed={view === "map"}
                onClick={() => setView("map")}
              >
                地图
              </button>
              <button
                aria-pressed={view === "report"}
                disabled={!result}
                onClick={() => setView("report")}
              >
                体检报告
              </button>
              <button
                aria-pressed={view === "life"}
                onClick={() => {
                  setLifeSection("places");
                  setView("life");
                }}
              >
                我的日常
              </button>
            </div>
          </div>
          <div className={view !== "life" ? "view-hidden" : ""}>
            <LifePanel
              result={result}
              selected={selected}
              centerName={label}
              position={
                mode === "demo"
                  ? { system: "demo", x: point[0], y: point[1] }
                  : geo
                    ? { system: "bd09", ...geo }
                    : null
              }
              onApply={(p) => {
                if (result) {
                  const next = personalize(result, p);
                  setResult(next);
                  setMinutes(p.minutes);
                  setSelected(null);
                  setView("map");
                }
              }}
              onPlace={(p) => void usePersonalPlace(p)}
              onOpen={openResult}
              section={lifeSection}
              onSection={setLifeSection}
            />
          </div>
          {result?.scenario && view !== "life" && (
            <p className="notice no-print">
              个人出行试算 · {result.scenario.preferences.minutes}分钟 ·{" "}
              {result.scenario.preferences.speedMps}米/秒 ·{" "}
              {result.scenario.preferences.departure}出发。
              {result.scenario.preferences.signals.enabled
                ? "等灯采用手动假设，不是实时数据。"
                : "未计入等灯与停歇。"}
              {result.contours.some((c) => c.clipped)
                ? "范围已触及采样边界。"
                : ""}
            </p>
          )}
          {replay && result && (
            <div className="replay-notice no-print" role="status">
              <span>
                正在查看{" "}
                {new Date(result.generatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}{" "}
                的{mode === "demo" ? "模拟" : "百度接口"}
                结果。
                {busy
                  ? "正在更新，原结果暂时保留。"
                  : "这是已保存的数据；更新失败或取消时保留原结果。"}
              </span>
              {mode === "baidu" && !liveMap && config?.mapConfigured && (
                <button
                  className="text-button"
                  onClick={() => {
                    setLiveMap(true);
                    setView("map");
                  }}
                >
                  加载真实底图
                </button>
              )}
            </div>
          )}
          <section
            className={`map-pane ${view !== "map" ? "view-hidden" : ""}`}
            aria-label="地图和设施结果"
          >
            <div className="map-container">
              {mode === "demo" || (replay && !liveMap) ? (
                <DemoMap
                  center={result?.center.point ?? point}
                  background={mode === "demo" ? "demo" : "plain"}
                  result={result}
                  facilities={visible}
                  minutes={minutes}
                  showGaps={showGaps}
                  gapCategory={gapCategory}
                  disabled={busy || replay}
                  onCenter={choosePoint}
                  onFacility={setSelected}
                  onCoverage={selectGap}
                />
              ) : geo && config?.mapConfigured ? (
                <BaiduMap
                  center={geo}
                  result={result}
                  facilities={visible}
                  minutes={minutes}
                  showGaps={showGaps}
                  gapCategory={gapCategory}
                  disabled={busy}
                  onCenter={chooseGeo}
                  onFacility={setSelected}
                  onCoverage={selectGap}
                />
              ) : (
                <div className="map-stage map-empty">
                  <span className="empty-location" aria-hidden="true">
                    ◎
                  </span>
                  <h3>{geo ? "底图尚未配置" : "先定位一个真实地点"}</h3>
                  <p>
                    {geo
                      ? "配置浏览器端地图应用后，可查看底图。当前仍可进行体检并阅读报告。"
                      : "在左侧输入社区地址，确认地图上的实际入口。"}
                  </p>
                  <span>上海 · 四平路街道</span>
                </div>
              )}
              {selected && (
                <div className="facility-detail">
                  <button
                    className="close-detail"
                    aria-label="关闭设施详情"
                    onClick={() => setSelected(null)}
                  >
                    ×
                  </button>
                  <span className="eyebrow">
                    {CATEGORIES.find((c) => c.id === selected.category)?.label}
                  </span>
                  <h3>{selected.name}</h3>
                  <p>{selected.address || "暂无地址信息"}</p>
                  <strong>
                    {selected.travel?.status === "ok"
                      ? walkTime(selected.travel.seconds)
                      : result
                        ? "步行时间待核实"
                        : "体检后可查看步行时间"}
                  </strong>
                  <button
                    className="text-button"
                    onClick={() => setView("life")}
                  >
                    记到私人地点簿 / 生成指引
                  </button>
                </div>
              )}
              {result && (
                <div className="map-legend">
                  {result.contours.map((c) => (
                    <span key={c.minutes}>
                      <i
                        className={
                          c.minutes <= 5
                            ? "legend-5"
                            : c.minutes <= 10
                              ? "legend-10"
                              : "legend-15"
                        }
                      />
                      {c.minutes}分钟
                    </span>
                  ))}
                  <span className="legend-note">近似可达范围</span>
                </div>
              )}
            </div>
            {result ? (
              <>
                {showGaps && (
                  <div className="gap-explanation">
                    <label htmlFor="gap-category">核查类别</label>
                    <select
                      id="gap-category"
                      value={gapCategory}
                      onChange={(e) =>
                        setGapCategory(e.target.value as GapCategory)
                      }
                    >
                      {GAP_CATEGORIES.map((id) => (
                        <option key={id} value={id}>
                          {CATEGORIES.find((c) => c.id === id)!.label}
                        </option>
                      ))}
                    </select>
                    <p>
                      灰色实填 / ×：1公里内未检索到；浅灰斜线或虚线 /
                      ?：数据不足。色块仅提示采样点周边，不是连续缺口面积。
                    </p>
                    <CoverageInspector
                      key={`${result.id}:${gapCategory}:${minutes}`}
                      result={result}
                      category={gapCategory}
                      minutes={minutes}
                      selected={gapPoint}
                      onSelect={setGapPoint}
                    />
                  </div>
                )}
                <section className="result-strip" aria-label="体检摘要">
                  <div>
                    <span>{minutes}分钟近似可达面积</span>
                    <strong>
                      {area.toFixed(2)}
                      <small>km²</small>
                    </strong>
                  </div>
                  <div>
                    <span>范围内已发现设施</span>
                    <strong>
                      {total}
                      <small>处</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      {result.scenario?.preferences.minutes ?? 15}
                      分钟内覆盖核查点
                    </span>
                    <strong>
                      {uniqueGaps}
                      <small>个</small>
                    </strong>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setView("report")}
                  >
                    阅读体检报告 <span aria-hidden="true">→</span>
                  </button>
                </section>
                <section className="facility-section">
                  <div className="section-line">
                    <h2>步行范围内的设施</h2>
                    <span>按当前分类显示 {visible.length} 处</span>
                  </div>
                  {visible.length ? (
                    <ul className="facility-list">
                      {visible
                        .slice()
                        .sort(
                          (a, b) =>
                            (a.travel?.status === "ok"
                              ? a.travel.seconds
                              : Infinity) -
                            (b.travel?.status === "ok"
                              ? b.travel.seconds
                              : Infinity),
                        )
                        .map((p) => {
                          const c = CATEGORIES.find(
                            (c) => c.id === p.category,
                          )!;
                          return (
                            <li key={p.id}>
                              <button onClick={() => setSelected(p)}>
                                <span
                                  className="facility-icon"
                                  style={{ color: c.color }}
                                >
                                  {c.short}
                                </span>
                                <span>
                                  <strong>{p.name}</strong>
                                  <small>{c.label}</small>
                                </span>
                                <em>
                                  {p.travel?.status === "ok"
                                    ? walkTime(p.travel.seconds)
                                    : "待核查"}
                                </em>
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  ) : (
                    <div className="empty-list">
                      <p>
                        {categories.length === 0
                          ? "当前没有选中设施类别。"
                          : "本次检索未发现符合条件的设施。"}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => {
                          setCategories(CATEGORIES.map((c) => c.id));
                          setMinutes(15);
                        }}
                      >
                        查看15分钟内全部类别
                      </button>
                    </div>
                  )}
                  <p className="caption">
                    {Object.values(result.complete).some((v) => !v)
                      ? "部分分类检索不完整。当前数量仅表示已发现设施，不能据此断言设施缺失。"
                      : "按步行时间统计已发现设施。实际营业、开放和入口信息仍需核验。"}
                  </p>
                </section>
              </>
            ) : (
              <div className="before-analysis">
                <div className="walking-mark" aria-hidden="true">
                  15<span>min</span>
                </div>
                <div>
                  <h3>生活的半径，沿着路走一遍</h3>
                  <p>
                    完成体检后，这里会显示可达面积、周边设施与需要核查的服务空白点。
                  </p>
                </div>
              </div>
            )}
          </section>
          <section
            className={`report-pane ${view !== "report" ? "view-hidden" : ""}`}
            aria-label="体检报告"
          >
            {result && (
              <Report
                key={result.id}
                result={result}
                disabled={busy || locating}
                onReview={(value) => {
                  setResult(value);
                  setSelected(null);
                }}
              />
            )}
          </section>
          <footer className="workspace-footer no-print">
            <span>一刻烟火 · 社区步行观察</span>
            <span>
              {result
                ? `${result.quality.knownSamples}/${result.quality.totalSamples} 个有效测时点`
                : "选择地点 · 步行测时 · 设施核查"}
            </span>
          </footer>
        </div>
      </main>
    </>
  );
}
