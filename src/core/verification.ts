import clip from "polygon-clipping";
import {
  coverageArea,
  positiveCoverageFootprint,
  areaLabel,
} from "./coverage-area.js";
import {
  coveragePoints,
  GAP_CATEGORIES,
  type GapCategory,
} from "./coverage.js";
import { gridTriangles, splitSharedEdges } from "./mesh.js";
import { contoursFromTriangles, polygonArea } from "./contours.js";
import { distance, pointKey } from "./geo.js";
import { usableFacility } from "../shared/facility-review.js";
import { estimateJourney } from "../shared/journey.js";
import { parseResultFile } from "../shared/result-file.js";
import { utf8Bytes } from "../shared/life.js";
import type {
  AnalysisResult,
  Provider,
  XY,
  Triangle,
  Travel,
} from "../shared/types.js";

export interface VerificationTask {
  id: string;
  kind: "route" | "search" | "field";
  title: string;
  reason: string;
  point: XY;
  category?: GapCategory;
  radiusMeters?: number;
  potentialSquareMeters: number;
  influence: string;
  routeUnits: number;
}
export interface VerificationPlan {
  category: GapCategory;
  minutes: number;
  tasks: VerificationTask[];
  maxRouteUnits: number;
  maxSearchUnits: number;
}
export const VERIFICATION_BACKUP_KEY = "yike-last-verification";
// Reports contain JSON values only; this copy works in WeChat's JS runtime too.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function reportTriangles(result: AnalysisResult): Triangle[] {
  const { radiusMeters: radius, coarseStepMeters: step } = result.parameters;
  if (
    radius <= 0 ||
    step <= 0 ||
    !Number.isInteger(radius / step) ||
    radius / step > 20
  )
    throw new Error("这份报告的网格不支持局部补查，请保留原报告后重新体检。");
  const map = new Map(result.samples.map((s) => [pointKey(s.point), s]));
  if (map.size !== result.samples.length)
    throw new Error("报告含重复测时点，请先核对来源。");
  let triangles = gridTriangles(result.center.point, radius, step, map);
  for (let pass = 0; pass < 2; pass++)
    triangles = splitSharedEdges(triangles, map);
  return triangles;
}

function knownAt(result: AnalysisResult, point: XY): Travel | undefined {
  return [
    ...result.samples,
    ...result.facilities.map((f) => ({ point: f.point, travel: f.travel })),
  ].find(
    (s) => pointKey(s.point) === pointKey(point) && s.travel?.status === "ok",
  )?.travel;
}

export function verificationTasks(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
): VerificationTask[] {
  if (
    !GAP_CATEGORIES.includes(category) ||
    !result.contours.some((c) => c.minutes === minutes)
  )
    throw new Error("请选择当前报告已有的类别和时长。");
  const tasks: VerificationTask[] = [];
  let triangles: Triangle[] = [];
  try {
    triangles = reportTriangles(result);
  } catch {
    /* Search and field checks remain available. */
  }
  const destinations = new Map<string, XY>();
  if (triangles.length)
    for (const s of result.samples)
      if (s.travel.status === "unknown")
        destinations.set(pointKey(s.point), s.point);
  for (const f of result.facilities)
    if (!f.travel || f.travel.status === "unknown")
      destinations.set(pointKey(f.point), f.point);
  for (const [key, point] of destinations) {
    const dx = Math.round(point[0] - result.center.point[0]),
      dy = Math.round(point[1] - result.center.point[1]);
    const direction =
      [
        dx ? `${dx < 0 ? "西" : "东"}${Math.abs(dx)}米` : "",
        dy ? `${dy < 0 ? "南" : "北"}${Math.abs(dy)}米` : "",
      ]
        .filter(Boolean)
        .join("、") || "出发点";
    const affected = triangles.filter(
      (t) =>
        t.some(
          (s) => s.travel.status === "unknown" && pointKey(s.point) === key,
        ) &&
        t.some(
          (s) => s.travel.status === "ok" && s.travel.seconds <= minutes * 60,
        ),
    );
    const area = affected.reduce((sum, t) => {
      const [a, b, c] = t.map((s) => s.point);
      return (
        sum +
        Math.abs(
          (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]),
        ) /
          2
      );
    }, 0);
    tasks.push({
      id: `route:${key}`,
      kind: "route",
      point: [...point],
      title: `补取步行测时 · ${direction}`,
      reason: knownAt(result, point)
        ? "同一位置已有有效测时，可直接复用。"
        : "该位置缺少有效步行测时，只读取这一个目的地。",
      potentialSquareMeters: area,
      influence: `关联${affected.length}个缺测网格片；实际变化以补查后为准`,
      routeUnits: knownAt(result, point) ? 0 : 1,
    });
  }
  const points = coveragePoints(result, category, minutes).filter(
    (p) => p.status === "unknown",
  );
  const radius = Math.min(20_000, result.parameters.gapDistanceMeters + 600);
  if (
    radius > result.parameters.gapDistanceMeters &&
    (result.localSearches?.length ?? 0) < 12
  ) {
    const area = coverageArea(result, category, minutes);
    const candidates = points
      .map((p) => {
        const shape = positiveCoverageFootprint(
          [p.point],
          radius - area.distanceMeters,
        );
        const potential = area.regions.unknown.length
          ? polygonArea(
              clip.intersection(
                area.regions.unknown,
                shape,
              ) as import("../shared/types.js").MultiPolygon,
            )
          : 0;
        return { p, potential };
      })
      .filter((p) => p.potential > 0)
      .sort((a, b) => b.potential - a.potential || a.p.number - b.p.number);
    const chosen: XY[] = [];
    for (const { p, potential } of candidates) {
      if (chosen.some((point) => distance(point, p.point) < 600)) continue;
      chosen.push(p.point);
      tasks.push({
        id: `search:${category}:${pointKey(p.point)}`,
        kind: "search",
        category,
        point: [...p.point],
        radiusMeters: radius,
        title: `局部补查${{ market: "菜市场", pharmacy: "药店", school: "小学" }[category]} · 点${p.number}`,
        reason: "只检索这个核查点附近的一类设施；分页仍受服务配置限制。",
        potentialSquareMeters: potential,
        influence: `关联待核查面积约${areaLabel(potential)} km²，不保证全部消除`,
        routeUnits: 0,
      });
      if (chosen.length === 2) break;
    }
  }
  tasks.sort(
    (a, b) =>
      b.potentialSquareMeters /
        (b.kind === "route" && b.routeUnits === 0 ? 0.5 : 2) -
        a.potentialSquareMeters /
          (a.kind === "route" && a.routeUnits === 0 ? 0.5 : 2) ||
      a.id.localeCompare(b.id),
  );
  // Only an ordering hint: overlapping areas are not additive benefits.
  const actions = tasks.slice(0, 12);
  for (const f of result.facilities
    .filter((f) => f.category === category)
    .slice(0, 2))
    actions.push({
      id: `field:${f.id}`,
      kind: "field",
      title: `现场核实 · ${f.name}`,
      reason:
        "查看实际入口、台阶及营业信息，记录观察日期。地图补查不能代替现场确认。",
      point: [...f.point],
      potentialSquareMeters: 0,
      influence: usableFacility(f)
        ? "已有地图记录，现场情况仍需确认"
        : "已有核查分歧或停用记录，需人工确认",
      routeUnits: 0,
    });
  return actions;
}

export function verificationPlan(
  result: AnalysisResult,
  category: GapCategory,
  minutes: number,
  ids: string[],
  searchPages = 1,
): VerificationPlan {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 3 ||
    new Set(ids).size !== ids.length ||
    !Number.isInteger(searchPages) ||
    searchPages < 1 ||
    searchPages > 3
  )
    throw new Error("请选择1至3个不同的接口补查任务。");
  const available = verificationTasks(result, category, minutes);
  const tasks = ids.map((id) => {
    const task = available.find((t) => t.id === id);
    if (!task || task.kind === "field")
      throw new Error("任务已变化或需要现场核实，请重新选择。");
    return task;
  });
  if (
    (result.localSearches?.length ?? 0) +
      tasks.filter((t) => t.kind === "search").length >
    12
  )
    throw new Error("局部补查记录最多12处，请保留报告后重新体检。");
  if (
    result.warnings.length > 97 ||
    result.facilities.length +
      10 * searchPages * tasks.filter((t) => t.kind === "search").length >
      1000
  )
    throw new Error("当前报告容量不足以预留本次补查结果，请先导出并重新体检。");
  if (
    result.facilities.some(
      (f) =>
        (f.evidence?.length ?? 0) +
          tasks.filter((t) => t.kind === "search" && t.category === f.category)
            .length >
        30,
    )
  )
    throw new Error("本次范围内有设施达到核查记录容量，请先备份整理后再补查。");
  return {
    category,
    minutes,
    tasks,
    maxRouteUnits: 2 * tasks.reduce((sum, t) => sum + t.routeUnits, 0),
    maxSearchUnits:
      2 * searchPages * tasks.filter((t) => t.kind === "search").length,
  };
}

export function rebuildVerificationGeometry(
  result: AnalysisResult,
): AnalysisResult {
  const triangles = reportTriangles(result);
  result.contours = result.contours.map(({ minutes }) => {
    const polygons = contoursFromTriangles(triangles, minutes * 60);
    const clipped = result.samples.some(
      (s) =>
        s.travel.status === "ok" &&
        s.travel.seconds <= minutes * 60 &&
        (Math.abs(s.point[0] - result.center.point[0]) ===
          result.parameters.radiusMeters ||
          Math.abs(s.point[1] - result.center.point[1]) ===
            result.parameters.radiusMeters),
    );
    return { minutes, polygons, areaKm2: polygonArea(polygons) / 1e6, clipped };
  });
  result.quality = {
    knownSamples: result.samples.filter((s) => s.travel.status === "ok").length,
    totalSamples: result.samples.length,
    unknownFacilities: result.facilities.filter(
      (f) => f.travel?.status !== "ok",
    ).length,
    skippedTriangles: triangles.filter((t) =>
      t.some((s) => s.travel.status !== "ok"),
    ).length,
  };
  result.gaps = GAP_CATEGORIES.flatMap((category) =>
    coveragePoints(result, category)
      .filter((p) => p.status !== "covered")
      .map((p) => ({
        point: p.point,
        category,
        status: p.status as "unknown" | "missing",
      })),
  );
  return result;
}

export async function executeVerification(
  source: AnalysisResult,
  plan: VerificationPlan,
  provider: Provider,
  identity: { id: string; completedAt?: string },
  signal?: AbortSignal,
  progress?: (done: number, total: number) => void,
): Promise<AnalysisResult> {
  const original = copy(source);
  const result = copy(source);
  if (provider.mode !== source.mode)
    throw new Error("补查服务与报告来源不一致。");
  const receipts: NonNullable<AnalysisResult["verification"]>["receipts"] = [];
  const warn = (s: string) => {
    if (!result.warnings.includes(s)) result.warnings.push(s);
  };
  for (const [index, task] of plan.tasks.entries()) {
    signal?.throwIfAborted();
    progress?.(index, plan.tasks.length);
    if (task.kind === "route") {
      let value = knownAt(result, task.point);
      if (!value) {
        value = (
          await provider.route(source.center.point, [task.point], signal)
        )[0] ?? { status: "unknown", reason: "补查未返回测时" };
        if (value.status === "ok" && source.scenario)
          value = {
            ...value,
            recordedSeconds: value.seconds,
            seconds: estimateJourney(value.meters, source.scenario.preferences)
              .seconds,
          };
      }
      signal?.throwIfAborted();
      const key = pointKey(task.point);
      for (const s of result.samples)
        if (pointKey(s.point) === key && s.travel.status === "unknown")
          s.travel = copy(value);
      for (const f of result.facilities)
        if (
          pointKey(f.point) === key &&
          (!f.travel || f.travel.status === "unknown")
        )
          f.travel = copy(value);
      receipts.push({
        taskId: task.id,
        outcome: value.status === "ok" ? "updated" : "unchanged",
        message:
          value.status === "ok"
            ? "已补齐或复用该位置测时。"
            : "未取得有效测时，仍保留缺测或不连通说明。",
      });
    } else if (task.kind === "search") {
      const found = await provider.search(
        task.point,
        task.radiusMeters!,
        signal,
        [task.category!],
      );
      signal?.throwIfAborted();
      let count = 0,
        disputes = 0,
        consistent = true;
      const flagged = new Set<string>();
      const flagPosition = (
        existing: (typeof result.facilities)[number],
        point: XY,
      ) => {
        if (distance(existing.point, point) <= 5) return;
        consistent = false;
        if (flagged.has(existing.id)) return;
        flagged.add(existing.id);
        disputes++;
        existing.evidence ??= [];
        existing.evidence.push({
          source: source.mode === "demo" ? "模拟局部检索" : "百度地图局部检索",
          recordId: task.id,
          checkedAt: identity.completedAt ?? new Date().toISOString(),
          status: "uncertain",
          basis: `本次返回坐标与历史记录相差约${Math.round(distance(existing.point, point))}米；保留原坐标，需核实来源误差或入口变动。5米仅为复核触发阈值。`,
        });
        result.complete[existing.category] = false;
        warn(
          "局部补查：发现设施位置差异，保留历史坐标并增加待核实记录；未经核实不参与覆盖统计。",
        );
      };
      for (const p of found.facilities.filter(
        (f) => f.category === task.category,
      )) {
        if (distance(p.point, task.point) > task.radiusMeters! + 5) {
          consistent = false;
          continue;
        }
        const same = result.facilities.find(
          (f) =>
            f.category === p.category &&
            (f.id === p.id || (f.uid && p.uid && f.uid === p.uid)),
        );
        if (same) {
          flagPosition(same, p.point);
          continue;
        }
        const near = result.facilities.find(
          (f) =>
            f.category === p.category &&
            (!f.uid || !p.uid) &&
            f.name === p.name &&
            distance(f.point, p.point) <= 30,
        );
        if (near) {
          flagPosition(near, p.point);
          continue;
        }
        if (result.facilities.some((f) => f.id === p.id))
          throw new Error("补查设施编号冲突，请保留原报告并人工核实。");
        result.facilities.push({
          ...p,
          travel: knownAt(source, p.point) ?? {
            status: "unknown",
            reason: "本轮只补查地点，尚未读取该设施步行测时",
          },
        });
        count++;
      }
      result.localSearches ??= [];
      result.localSearches.push({
        category: task.category!,
        center: [...task.point],
        radiusMeters: task.radiusMeters!,
        complete: consistent && found.complete[task.category!],
        readAt: identity.completedAt ?? new Date().toISOString(),
      });
      const complete = result.localSearches.at(-1)!.complete;
      receipts.push({
        taskId: task.id,
        outcome: count || complete || disputes ? "updated" : "unchanged",
        message: `新增${count}处设施；${disputes ? `${disputes}处位置差异待核实；` : ""}${complete ? "本次局部返回已取完，仅完整覆盖的核查范围可用于缺口判断。" : "本次局部返回仍不完整，空白继续保留待核查。"}`,
      });
    } else throw new Error("现场核实任务不能由地图接口自动完成。");
  }
  signal?.throwIfAborted();
  const completedAt = identity.completedAt ?? new Date().toISOString();
  result.id = identity.id;
  result.baseGeneratedAt =
    source.baseGeneratedAt ??
    source.derivedFrom?.sourceGeneratedAt ??
    source.generatedAt;
  result.generatedAt = completedAt;
  result.usage = { ...provider.usage };
  result.elapsedMs = 0;
  result.verification = {
    version: "targeted-verification-v1",
    sourceId: source.id,
    sourceGeneratedAt: source.generatedAt,
    completedAt,
    receipts,
  };
  warn(
    "定向补查：仅更新所选任务，其余测时、设施和核查记录沿用历史资料；当前生成时间不是所有数据的重新核验时间。",
  );
  if (source.mode === "demo")
    warn("定向补查：本次为人工构造街区演练，不代表真实社区或现场验证。");
  try {
    rebuildVerificationGeometry(result);
  } catch (error) {
    if (
      plan.tasks.some(
        (t) =>
          t.kind === "route" &&
          source.samples.some((s) => pointKey(s.point) === pointKey(t.point)),
      )
    )
      throw error;
    result.contours = original.contours;
    result.quality.unknownFacilities = result.facilities.filter(
      (f) => f.travel?.status !== "ok",
    ).length;
    result.gaps = GAP_CATEGORIES.flatMap((category) =>
      coveragePoints(result, category)
        .filter((p) => p.status !== "covered")
        .map((p) => ({
          point: p.point,
          category,
          status: p.status as "missing" | "unknown",
        })),
    );
  }
  progress?.(plan.tasks.length, plan.tasks.length);
  return result;
}

export function verificationDiff(
  before: AnalysisResult,
  after: AnalysisResult,
  category: GapCategory,
  minutes: number,
) {
  const first = coverageArea(before, category, minutes),
    last = coverageArea(after, category, minutes);
  return {
    category,
    minutes,
    knownSamplesBefore: before.quality.knownSamples,
    knownSamplesAfter: after.quality.knownSamples,
    newFacilities: after.facilities.filter(
      (f) => !before.facilities.some((p) => p.id === f.id),
    ).length,
    unknownBefore: areaLabel(first.squareMeters.unknown),
    unknownAfter: areaLabel(last.squareMeters.unknown),
    domainBefore: areaLabel(first.totalSquareMeters),
    domainAfter: areaLabel(last.totalSquareMeters),
    note: "补查可能同时改变步行轮廓，待核查面积应连同范围面积阅读；变化不是现场精度或实际受益人数。",
  };
}

export function verificationEvidence(
  before: AnalysisResult,
  after: AnalysisResult,
  category: GapCategory,
  minutes: number,
) {
  if (
    before.id === after.id ||
    after.verification?.sourceId !== before.id ||
    after.verification.sourceGeneratedAt !== before.generatedAt
  )
    throw new Error("补查结果与原报告不匹配，请保留各自报告后核对。");
  return {
    schema: "yike-targeted-verification-v1",
    evidence:
      before.mode === "demo" ? "simulation" : "api-and-historical-report",
    before,
    after,
    diff: verificationDiff(before, after, category, minutes),
    limitations: [
      "只更新明确选择的任务，其余资料保留原时间与来源。",
      "局部检索完整不等于整个类别完整，也不等于现场没有未收录设施。",
      "新设施本轮不自动追加步行测时。",
      "两个范围面积可能不同；面积变化不是实地精度或受益人数。",
    ],
  };
}

export function parseVerificationEvidence(raw: string) {
  if (utf8Bytes(raw) > 4_100_000)
    throw new Error("补查备份超过容量，请分别打开原始报告。");
  const value = JSON.parse(raw);
  if (value?.schema !== "yike-targeted-verification-v1" || !value.diff)
    throw new Error("补查备份格式无效。");
  const before = parseResultFile(JSON.stringify(value.before)),
    after = parseResultFile(JSON.stringify(value.after));
  if (
    !GAP_CATEGORIES.includes(value.diff.category) ||
    !before.contours.some((c) => c.minutes === value.diff.minutes) ||
    !after.contours.some((c) => c.minutes === value.diff.minutes)
  )
    throw new Error("补查备份类别或时长无效。");
  return verificationEvidence(
    before,
    after,
    value.diff.category,
    value.diff.minutes,
  );
}

export function verificationDrill(
  source: AnalysisResult,
  category: GapCategory,
): AnalysisResult {
  if (source.mode !== "demo") throw new Error("缺测演练只适用于模拟街区。");
  const result = copy(source);
  const target = result.samples
    .filter(
      (s) =>
        s.travel.status === "ok" &&
        s.travel.seconds > 0 &&
        s.travel.seconds < 900,
    )
    .sort(
      (a, b) =>
        distance(a.point, source.center.point) -
        distance(b.point, source.center.point),
    )[0];
  if (!target) throw new Error("当前示例没有可用于缺测演练的测时点。");
  target.travel = { status: "unknown", reason: "人工构造缺测，仅用于演练" };
  result.id = `drill-${source.id}`.slice(0, 100);
  result.complete[category] = false;
  result.center.label = "模拟缺测演练 · 人工构造";
  result.warnings = [
    ...result.warnings,
    "人工构造缺测：刻意移除一个测时并将一类检索标为不完整，用于演示补查流程。",
  ];
  delete result.verification;
  return rebuildVerificationGeometry(result);
}
