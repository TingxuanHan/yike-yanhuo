import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import clip from "polygon-clipping";
import {
  compareFacilitySites,
  compareSelectedSites,
  sitingOptions,
  sitingView,
  sitingEvidence,
  SITING_STATES,
} from "../src/core/facility-siting.js";
import { polygonArea } from "../src/core/contours.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import { distance } from "../src/core/geo.js";
import { usableFacility } from "../src/shared/facility-review.js";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { parseResultFile } from "../src/shared/result-file.js";
import type { AnalysisResult, MultiPolygon, XY } from "../src/shared/types.js";

const cases: AnalysisResult[] = JSON.parse(
  readFileSync("docs/experiments/coverage-area-simulation.json", "utf8"),
).inputs;
const sites = [
  { id: "west", name: "西侧假设", point: [-1100, 500] as XY },
  { id: "west2", name: "西南假设", point: [-1000, -500] as XY },
  { id: "east", name: "东侧假设", point: [1100, 500] as XY },
];

test("siting compares all seven bounded plans within equal counts and subtracts overlapping gap gains", () => {
  const source = structuredClone(cases[0]);
  const original = JSON.stringify(source);
  const comparison = compareFacilitySites(source, "market", 15, sites);
  assert.equal(comparison.scenarios.length, 7);
  const ab = comparison.scenarios.find((s) => s.id === "AB")!;
  const a = comparison.scenarios.find((s) => s.id === "A")!;
  const b = comparison.scenarios.find((s) => s.id === "B")!;
  assert.ok(ab.duplicateGapSquareMeters > 10_000);
  assert.ok(
    Math.abs(
      a.squareMeters.gapGain +
        b.squareMeters.gapGain -
        ab.squareMeters.gapGain -
        ab.duplicateGapSquareMeters,
    ) < 0.001,
  );
  assert.ok(
    ab.squareMeters.gapGain >=
      Math.max(a.squareMeters.gapGain, b.squareMeters.gapGain),
  );
  for (let i = 1; i < comparison.scenarios.length; i++) {
    const previous = comparison.scenarios[i - 1],
      current = comparison.scenarios[i];
    assert.ok(previous.siteCount <= current.siteCount);
    if (previous.siteCount === current.siteCount)
      assert.ok(previous.squareMeters.gapGain >= current.squareMeters.gapGain);
  }
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(sites[0].point, [-1100, 500]);
});

test("independent distance oracle rejects false gap gains and preserves holes, edges, incomplete evidence and area conservation", () => {
  for (const source of cases) {
    const comparison = compareFacilitySites(source, "market", 15, sites);
    const facilities = source.facilities.filter(usableFacility);
    const domain = source.contours[0].polygons;
    for (const plan of comparison.scenarios) {
      assert.ok(
        Math.abs(
          Object.values(plan.squareMeters).reduce((a, b) => a + b, 0) -
            polygonArea(domain),
        ) < 0.001,
      );
      assert.ok(
        Math.abs(
          plan.squareMeters.gapGain +
            plan.squareMeters.remainingGap -
            comparison.baseline.squareMeters.missing,
        ) < 0.001,
      );
      assert.ok(
        Math.abs(
          plan.squareMeters.unknownAssumption +
            plan.squareMeters.remainingUnknown -
            comparison.baseline.squareMeters.unknown,
        ) < 0.001,
      );
      for (const state of SITING_STATES) {
        const region = plan.regions[state];
        if (region.length)
          assert.ok(
            polygonArea(clip.difference(region, domain) as MultiPolygon) <
              0.001,
          );
        for (const other of SITING_STATES.filter((v) => v !== state)) {
          if (region.length && plan.regions[other].length)
            assert.ok(
              polygonArea(
                clip.intersection(region, plan.regions[other]) as MultiPolygon,
              ) < 0.001,
            );
        }
      }
      const selected = sites.filter((s) => plan.siteIds.includes(s.id));
      for (let x = -1479; x < 1500; x += 121)
        for (let y = -1477; y < 1500; y += 113) {
          const p: XY = [x, y];
          const inside = pointInPolygons(p, domain);
          const states = SITING_STATES.filter((s) =>
            pointInPolygons(p, plan.regions[s]),
          );
          assert.equal(states.length, inside ? 1 : 0);
          if (states.includes("gapGain")) {
            assert.ok(source.complete.market);
            assert.ok(
              distance(p, source.center.point) + 1000 <=
                source.parameters.searchRadiusMeters,
            );
            assert.ok(!facilities.some((f) => distance(f.point, p) <= 1000));
            assert.ok(selected.some((s) => distance(s.point, p) <= 1000));
          }
          if (states.includes("unknownAssumption"))
            assert.ok(pointInPolygons(p, comparison.baseline.regions.unknown));
        }
    }
  }
});

test("unknown-only evidence never produces proven gap improvement or a fabricated optimum", () => {
  const result = compareFacilitySites(cases[1], "market", 15, sites);
  assert.equal(result.baseline.squareMeters.missing, 0);
  assert.ok(result.scenarios.some((p) => p.squareMeters.unknownAssumption > 0));
  for (const p of result.scenarios) assert.equal(p.squareMeters.gapGain, 0);
  assert.equal(sitingView(cases[1], result).noProvenGap, true);
  assert.deepEqual(
    result.scenarios.slice(0, 3).map((s) => s.id),
    ["A", "B", "C"],
  );
  const onExisting = compareFacilitySites(cases[0], "market", 15, [
    { id: "same", name: "原有点", point: [0, 0] },
  ]);
  assert.equal(onExisting.scenarios[0].squareMeters.gapGain, 0);
});

test("candidate distance boundary is not counted as certain gain, and empty/invalid/repeated inputs fail explicitly", () => {
  const source = structuredClone(cases[0]);
  source.facilities = [];
  const result = compareFacilitySites(source, "market", 15, [
    { id: "center", name: "中心", point: [0, 0] },
  ]);
  assert.equal(
    pointInPolygons([1000, 0], result.scenarios[0].regions.gapGain),
    false,
  );
  assert.equal(
    pointInPolygons([999, 0], result.scenarios[0].regions.gapGain),
    true,
  );
  assert.throws(() => compareFacilitySites(source, "market", 15, []), /1至3/);
  assert.throws(
    () => compareFacilitySites(source, "market", 15, [...sites, sites[0]]),
    /1至3/,
  );
  assert.throws(
    () =>
      compareFacilitySites(source, "market", 15, [
        sites[0],
        { ...sites[0], id: "duplicate" },
      ]),
    /重复/,
  );
  assert.throws(
    () =>
      compareFacilitySites(source, "market", 15, [
        { ...sites[0], point: [NaN, 0] },
      ]),
    /无效/,
  );
  source.contours[0].polygons = [];
  assert.throws(
    () => compareFacilitySites(source, "market", 15, sites),
    /没有可比较/,
  );
});

test("measured-point selections export a self-contained reproducible hypothesis and before/after share one coordinate frame", async () => {
  const report = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const ids = sitingOptions(report, "school", 15)
    .slice(0, 3)
    .map((s) => s.id);
  const result = compareSelectedSites(report, "school", 15, ids);
  assert.throws(
    () => compareSelectedSites(report, "school", 15, ["not-in-report"]),
    /当前报告/,
  );
  assert.throws(
    () => compareSelectedSites(report, "school", 15, [ids[0], ids[0]]),
    /重复/,
  );
  const evidence = JSON.parse(JSON.stringify(sitingEvidence(report, result)));
  const replay = compareSelectedSites(
    parseResultFile(JSON.stringify(evidence.report)),
    evidence.comparison.category,
    evidence.comparison.minutes,
    evidence.comparison.candidates.map((c: any) => c.id),
  );
  assert.deepEqual(
    replay.scenarios.map((s) => s.squareMeters),
    result.scenarios.map((s) => s.squareMeters),
  );
  assert.equal(evidence.hypothesisOnly, true);
  assert.equal(evidence.evidence, "simulation");
  const before = sitingView(report, result, "ABC", true);
  const after = sitingView(report, result, "ABC", false);
  assert.equal(before.rows[1].area, "0");
  assert.deepEqual(before.sketch.bands[0], after.sketch.bands[0]);
  assert.equal(after.sketch.places.length, 3);
  assert.deepEqual(
    after.sketch.places.map((p) => p.label),
    ["A", "B", "C"],
  );
  assert.ok(!report.facilities.some((f) => f.id === ids[0]));
});
