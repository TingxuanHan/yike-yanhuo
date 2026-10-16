import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  compareFacilitySites,
  compareSelectedSites,
  SITING_STATES,
  SITING_VERSION,
} from "../src/core/facility-siting.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import { distance } from "../src/core/geo.js";
import { polygonArea } from "../src/core/contours.js";
import { usableFacility } from "../src/shared/facility-review.js";
import { parseResultFile } from "../src/shared/result-file.js";
import type { AnalysisResult, XY } from "../src/shared/types.js";

const replayPath = process.argv
  .find((arg) => arg.startsWith("--replay="))
  ?.slice(9);
if (replayPath) {
  const text = await readFile(replayPath, "utf8");
  const input = JSON.parse(text.replace(/^\uFEFF/, ""));
  assert.equal(input.schema, "yike-facility-siting-v1");
  const report = parseResultFile(JSON.stringify(input.report));
  assert.equal(input.comparison.version, SITING_VERSION);
  const replay = compareSelectedSites(
    report,
    input.comparison.category,
    input.comparison.minutes,
    input.comparison.candidates.map((c: { id: string }) => c.id),
  );
  assert.equal(replay.sourceId, input.comparison.sourceId);
  assert.equal(replay.sourceGeneratedAt, input.comparison.sourceGeneratedAt);
  assert.deepEqual(replay.candidates, input.comparison.candidates);
  assert.equal(replay.scenarios.length, input.comparison.scenarios.length);
  // Browser and Node transcendental implementations can differ at the last
  // floating-point bit. Verify exported areas to 0.001 m², not byte identity.
  let maxAreaErrorSquareMeters = 0;
  for (const plan of replay.scenarios) {
    const saved = input.comparison.scenarios.find(
      (p: { id: string }) => p.id === plan.id,
    );
    assert.ok(saved);
    for (const state of SITING_STATES) {
      const error = Math.abs(
        plan.squareMeters[state] - saved.squareMeters[state],
      );
      assert.ok(
        Number.isFinite(error) && error < 0.001,
        `${plan.id}/${state} area differs`,
      );
      maxAreaErrorSquareMeters = Math.max(maxAreaErrorSquareMeters, error);
    }
    assert.ok(
      Math.abs(plan.duplicateGapSquareMeters - saved.duplicateGapSquareMeters) <
        0.001,
    );
  }
  console.log(
    JSON.stringify({
      sourceSha256: createHash("sha256").update(text).digest("hex"),
      evidence:
        report.mode === "demo" ? "simulation" : "historical-api-hypothesis",
      verifiedScenarios: replay.scenarios.length,
      maxAreaErrorSquareMeters,
      externalApiCalls: 0,
    }),
  );
} else {
  const source = JSON.parse(
    await readFile("docs/experiments/coverage-area-simulation.json", "utf8"),
  );
  const inputs: AnalysisResult[] = source.inputs;
  const candidates = [
    { id: "west", name: "西侧假设", point: [-1100, 500] as XY },
    { id: "west2", name: "西南假设", point: [-1000, -500] as XY },
    { id: "east", name: "东侧假设", point: [1100, 500] as XY },
  ];
  const results = inputs.map((report) => {
    const comparison = compareFacilitySites(report, "market", 15, candidates);
    const domain = report.contours[0].polygons;
    const existing = report.facilities.filter(usableFacility);
    const plans = comparison.scenarios.map((plan) => {
      const sites = candidates.filter((c) => plan.siteIds.includes(c.id));
      let checkedPoints = 0,
        falseGapGain = 0,
        falseAssumedCoverage = 0,
        partitionErrors = 0;
      for (let x = -1493; x < 1500; x += 37)
        for (let y = -1491; y < 1500; y += 41) {
          const p: XY = [x, y];
          if (!pointInPolygons(p, domain)) continue;
          checkedPoints++;
          const states = SITING_STATES.filter((state) =>
            pointInPolygons(p, plan.regions[state]),
          );
          if (states.length !== 1) partitionErrors++;
          const nearCandidate = sites.some(
            (site) => distance(site.point, p) <= 1000,
          );
          if (
            states.includes("gapGain") &&
            (!report.complete.market ||
              !nearCandidate ||
              distance(p, report.center.point) + 1000 >
                report.parameters.searchRadiusMeters ||
              existing.some((f) => distance(f.point, p) <= 1000))
          )
            falseGapGain++;
          if (
            (states.includes("gapGain") ||
              states.includes("unknownAssumption")) &&
            !nearCandidate
          )
            falseAssumedCoverage++;
        }
      const conservationErrorSquareMeters = Math.abs(
        Object.values(plan.squareMeters).reduce((sum, n) => sum + n, 0) -
          polygonArea(domain),
      );
      assert.equal(falseGapGain + falseAssumedCoverage + partitionErrors, 0);
      assert.ok(conservationErrorSquareMeters < 0.001);
      if (!report.complete.market) assert.equal(plan.squareMeters.gapGain, 0);
      return {
        plan: plan.label,
        siteCount: plan.siteCount,
        checkedPoints,
        falseGapGain,
        falseAssumedCoverage,
        partitionErrors,
        conservationErrorSquareMeters,
        squareMeters: plan.squareMeters,
        duplicateGapSquareMeters: plan.duplicateGapSquareMeters,
      };
    });
    return {
      label: report.id,
      baseline: comparison.baseline.squareMeters,
      plans,
    };
  });
  const checked = results
    .flatMap((r) => r.plans)
    .reduce((sum, p) => sum + p.checkedPoints, 0);
  await writeFile(
    "docs/experiments/facility-siting-simulation.json",
    JSON.stringify(
      {
        version: SITING_VERSION,
        evidence: "simulation",
        externalApiCalls: 0,
        oracle:
          "Independent Euclidean distance tests on a 37m by 41m offset grid, for each of 7 plans per input.",
        comparisonUnit: "point-plan pairs; not unique locations or people",
        category: "market",
        minutes: 15,
        candidates,
        inputs,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "docs/experiments/facility-siting-simulation.md",
    [
      "# 设施补点比较：固定构造验证",
      "",
      "命令：`npm run benchmark:siting`。全部是构造数据，无外部API调用。四类输入各比较七个方案，不能将方案间重复测试的位置当作更多独立实地点。",
      "",
      "| 场景 | 点与方案组合检查数 | 错误缺口改善 | 超出距离的假设覆盖 | 分区错误 |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...results.map(
        (r) =>
          `| ${r.label} | ${r.plans.reduce((sum, p) => sum + p.checkedPoints, 0)} | ${r.plans.reduce((sum, p) => sum + p.falseGapGain, 0)} | ${r.plans.reduce((sum, p) => sum + p.falseAssumedCoverage, 0)} | ${r.plans.reduce((sum, p) => sum + p.partitionErrors, 0)} |`,
      ),
      "",
      `合计${checked.toLocaleString("en-US")}个点与方案组合检查，来自四个构造场景的七种方案；面积守恒误差均小于0.001平方米。检索不完整时，所有方案的已证实缺口改善均为零，待核查区假设覆盖单列。`,
      "",
      "组合先求并集再计算原缺口增益，重叠部分不重复计入。同数量方案按原缺口补足面积排序，不能据此宣称全局最优、受益人数或真实选址可行性。孔洞保持为空；边界使用保守内接近似，不把保留带算作确定补足。",
      "",
      "完整输入、候选位置、每个方案的面积及检查结果在同名JSON中。实地入口、用地条件、真实POI完整性和地图坐标误差不属于本构造实验的验证范围。",
      "",
    ].join("\n"),
  );
  console.log(
    JSON.stringify({
      cases: results.length,
      scenarios: results.length * 7,
      pointPlanChecks: checked,
      falseGapGain: 0,
      falseAssumedCoverage: 0,
      partitionErrors: 0,
      externalApiCalls: 0,
    }),
  );
}
