import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  coverageArea,
  AREA_STATES,
  COVERAGE_AREA_VERSION,
} from "../src/core/coverage-area.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import { polygonArea } from "../src/core/contours.js";
import { distance } from "../src/core/geo.js";
import { parseResultFile } from "../src/shared/result-file.js";
import { usableFacility } from "../src/shared/facility-review.js";
import { GAP_CATEGORIES } from "../src/core/coverage.js";
import type { AnalysisResult, XY } from "../src/shared/types.js";

const seed = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
function box(half: number): XY[] {
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
    [-half, -half],
  ];
}
function base(label: string) {
  const r = structuredClone(seed);
  r.id = label;
  r.generatedAt = "2026-10-16T00:00:00.000Z";
  r.elapsedMs = 0;
  r.center = { label, point: [0, 0] };
  r.facilities = [
    {
      id: "constructed-market",
      name: "构造菜场",
      category: "market",
      point: [0, 0],
      address: "构造",
    },
  ];
  r.contours = [
    { minutes: 15, polygons: [[box(1500)]], areaKm2: 9, clipped: false },
  ];
  r.parameters.searchRadiusMeters = 4000;
  r.parameters.radiusMeters = 1500;
  r.samples = [];
  r.gaps = [];
  return r;
}
const full = base("完整检索与1公里边界"),
  incomplete = base("类别检索未取全"),
  edge = base("检索边界截断"),
  hole = base("空洞与停用设施");
incomplete.complete.market = false;
edge.parameters.searchRadiusMeters = 2400;
hole.contours[0].polygons[0].push(box(300));
hole.facilities[0].evidence = [
  {
    source: "constructed",
    recordId: "closed",
    checkedAt: hole.generatedAt,
    status: "closed",
    basis: "构造停用",
  },
];
const scenarios = [full, incomplete, edge, hole];
const results = scenarios.map((r) => {
  const a = coverageArea(r, "market", 15);
  let evaluated = 0,
    falseCovered = 0,
    falseMissing = 0,
    unexplainedUnknown = 0;
  const fs = r.facilities.filter(usableFacility);
  // Independent pointwise distance oracle. This checks the geometric partition,
  // not Baidu POI completeness, road accuracy or actual on-site access.
  for (let x = -1493; x < 1500; x += 37)
    for (let y = -1491; y < 1500; y += 41) {
      const p: XY = [x, y];
      if (!pointInPolygons(p, r.contours[0].polygons)) continue;
      evaluated++;
      const near = fs.some((f) => distance(p, f.point) <= 1000);
      const searched =
        distance(p, r.center.point) + 1000 <= r.parameters.searchRadiusMeters;
      if (pointInPolygons(p, a.regions.covered) && !near) falseCovered++;
      if (
        pointInPolygons(p, a.regions.missing) &&
        (near || !searched || !r.complete.market)
      )
        falseMissing++;
      if (!AREA_STATES.some((s) => pointInPolygons(p, a.regions[s])))
        unexplainedUnknown++;
    }
  assert.equal(falseCovered + falseMissing + unexplainedUnknown, 0);
  const conservationError = Math.abs(
    Object.values(a.squareMeters).reduce((x, y) => x + y, 0) -
      polygonArea(r.contours[0].polygons),
  );
  assert.ok(conservationError < 0.001);
  return {
    label: r.id,
    evidence: "simulation",
    evaluated,
    falseCovered,
    falseMissing,
    unclassified: unexplainedUnknown,
    areaKm2: Object.fromEntries(
      AREA_STATES.map((s) => [s, a.squareMeters[s] / 1e6]),
    ),
    conservationErrorSquareMeters: conservationError,
    boundaryBandMeters: a.boundaryBandMeters,
  };
});
await mkdir("docs/experiments", { recursive: true });
const data = {
  version: COVERAGE_AREA_VERSION,
  evidence: "simulation",
  externalApiCalls: 0,
  oracle: "37m × 41m fixed offset grid; exact local Euclidean distances",
  inputs: scenarios,
  results,
};
await writeFile(
  "docs/experiments/coverage-area-simulation.json",
  JSON.stringify(data, null, 2) + "\n",
);
const md = [
  "# 连续设施覆盖分区：固定构造验证",
  "",
  "全部为构造数据；几何正确性不等于真实POI、路网或现场通行准确性。命令：`npm run benchmark:coverage`。无外部API调用。",
  "",
  "| 场景 | 检查点 | 错误已覆盖 | 错误候选缺口 | 未分类点 |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...results.map(
    (r) =>
      `| ${r.label} | ${r.evaluated} | ${r.falseCovered} | ${r.falseMissing} | ${r.unclassified} |`,
  ),
  "",
  "核查点使用固定偏移网格，与128边距离近似的顶点无关。边界采用内外近似，保留带归为待核查；三类面积守恒误差低于0.001平方米。输入、完整结果和参数见同名JSON。",
  "",
  "工程优化：先按范围包围盒剔除不相交的设施，按相同坐标去重，再分批合并。不会丢弃不同位置的设施，也不会因其不在步行圈内就漏掉1公里邻近影响。分类与时长切换只重算几何，不重新检索或测时。",
  "",
];
await writeFile("docs/experiments/coverage-area-simulation.md", md.join("\n"));
const inputPath = process.argv.find((a) => a.startsWith("--replay="))?.slice(9);
if (inputPath) {
  const raw = await readFile(inputPath, "utf8"),
    result: AnalysisResult = parseResultFile(raw);
  if (result.mode !== "baidu") throw new Error("回放需既有百度结果。");
  const started = performance.now();
  const partitions = GAP_CATEGORIES.map((category) =>
    coverageArea(result, category, 15),
  );
  const replay = {
    version: COVERAGE_AREA_VERSION,
    evidence: "historical-baidu-api-replay",
    externalApiCalls: 0,
    sourceLabel: result.center.label,
    sourceGeneratedAt: result.generatedAt,
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    elapsedMs: performance.now() - started,
    note: "历史数据本地重算，不是新的百度调用或现场核验；原始关键词漏检和路网误差仍保留。",
    results: partitions.map(({ regions, ...r }) => r),
  };
  await writeFile(
    "docs/experiments/coverage-area-shanghai-replay.json",
    JSON.stringify(replay, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      replay: replay.results.map((r) => ({
        category: r.category,
        squareMeters: r.squareMeters,
        facilitiesUsed: r.facilitiesUsed,
      })),
      elapsedMs: replay.elapsedMs,
    }),
  );
}
console.log(
  JSON.stringify({
    scenarios: results.length,
    checkedPoints: results.reduce((n, r) => n + r.evaluated, 0),
    falseCovered: 0,
    falseMissing: 0,
    externalApiCalls: 0,
  }),
);
