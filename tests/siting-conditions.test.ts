import test from "node:test";
import assert from "node:assert/strict";
import clip from "polygon-clipping";
import { readFileSync } from "node:fs";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  sitingOptions,
  compareFacilitySites,
} from "../src/core/facility-siting.js";
import {
  compareSitingConditions,
  sitingConditionDefaults,
  sitingConditionsView,
  sitingConditionsEvidence,
} from "../src/core/siting-conditions.js";
import { replayPlanningEvidence } from "../src/core/planning-evidence.js";
import { personalize } from "../src/core/personalize.js";
import { polygonArea } from "../src/core/contours.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import type { MultiPolygon } from "../src/shared/types.js";

const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
const ids = sitingOptions(source, "school", 15)
  .slice(0, 3)
  .map((s) => s.id);
const input = sitingConditionDefaults(source);
const original = JSON.stringify(source);
const comparison = compareSitingConditions(source, "school", 15, ids, input);

test("a fixed constructed trade-off changes the single-scenario winner without mixing facility counts", () => {
  const fixture = JSON.parse(
    readFileSync("docs/experiments/planning-evidence-simulation.json", "utf8"),
  ).records[1].siting;
  const actual = compareSitingConditions(
    fixture.report,
    "school",
    15,
    fixture.comparison.candidates.map((c: { id: string }) => c.id),
    fixture.comparison.input,
  );
  const a = actual.plans.find((p) => p.id === "A")!,
    b = actual.plans.find((p) => p.id === "B")!;
  assert.ok(a.values[0].gainSquareMeters > b.values[0].gainSquareMeters);
  assert.ok(a.values[1].gainSquareMeters < b.values[1].gainSquareMeters);
  assert.ok(a.values[2].gainSquareMeters < b.values[2].gainSquareMeters);
  assert.ok(a.maxRegretSquareMeters < b.maxRegretSquareMeters);
  assert.equal(actual.groups[0].changedWinner, true);
  assert.deepEqual(actual.groups[0].planIds, ["A", "B"]);
  assert.match(sitingConditionsView(fixture.report, actual).headline, /方案 A/);
});

test("conditions reuse measured distances with equal-count regret, spatial intersection and immutable source", () => {
  assert.equal(comparison.plans.length, 7);
  assert.equal(comparison.conditions.length, 3);
  const independent = comparison.conditions.map((c) =>
    compareFacilitySites(
      personalize(source, c.preferences, {
        id: c.id,
        createdAt: source.generatedAt,
      }),
      "school",
      15,
      comparison.candidates,
    ),
  );
  for (const plan of comparison.plans) {
    const gains = independent.map((c) =>
      c.scenarios.find((s) => s.id === plan.id)!,
    );
    const regrets = gains.map(
      (p, i) =>
        Math.max(
          ...independent[i].scenarios
            .filter((s) => s.siteCount === plan.siteCount)
            .map((s) => s.squareMeters.gapGain),
        ) - p.squareMeters.gapGain,
    );
    assert.equal(plan.maxRegretSquareMeters, Math.max(...regrets));
    assert.equal(
      plan.worstGainSquareMeters,
      Math.min(...gains.map((p) => p.squareMeters.gapGain)),
    );
    assert.ok(
      plan.stableGainSquareMeters <= plan.worstGainSquareMeters + 0.001,
    );
    assert.ok(
      polygonArea(
        clip.intersection(plan.stable, plan.variable) as MultiPolygon,
      ) < 0.001,
    );
    for (let x = -1103.137; x < 1200; x += 79)
      for (let y = -1107.257; y < 1200; y += 83) {
        const membership = gains.map((g) =>
          pointInPolygons([x, y], g.regions.gapGain),
        );
        assert.equal(
          pointInPolygons([x, y], plan.stable),
          membership.every(Boolean),
        );
        assert.equal(
          pointInPolygons([x, y], plan.variable),
          membership.some(Boolean) && !membership.every(Boolean),
          JSON.stringify({ x, y, plan: plan.id, membership }),
        );
      }
  }
  assert.equal(JSON.stringify(source), original);
});

test("unknown evidence cannot become gain; duplicate conditions and one-combination cases avoid confident recommendations", () => {
  const unknown = structuredClone(source);
  unknown.complete.school = false;
  const missing = compareSitingConditions(unknown, "school", 15, ids, input);
  assert.ok(
    missing.plans.some((p) => p.values.some((v) => v.unknownSquareMeters > 0)),
  );
  assert.ok(
    missing.plans.every(
      (p) => p.maxRegretSquareMeters === 0 && p.stableGainSquareMeters === 0,
    ),
  );
  assert.match(sitingConditionsView(unknown, missing).headline, /资料不足/);
  assert.match(
    sitingConditionsView(source, comparison, "ABC").headline,
    /只有一种组合/,
  );
  const base = comparison.conditions[0].preferences;
  const same = personalize(source, {
    ...base,
    signals: {
      ...base.signals,
      enabled: true,
      crossingsPerKm: 2,
      peakSeconds: 30,
      offPeakSeconds: 30,
    },
  });
  const repeated = compareSitingConditions(same, "school", 15, ids, {
    ...input,
    speedMps: base.speedMps,
  });
  assert.equal(repeated.distinctConditions, 1);
  assert.match(sitingConditionsView(same, repeated).headline, /设置相同/);
  for (const p of repeated.plans) assert.ok(p.variableGainSquareMeters < 0.001);
});

test("personalized reports never accumulate time transformations; candidate and source changes reject stale comparisons", () => {
  const personalized = personalize(
    source,
    comparison.conditions[2].preferences,
  );
  const available = sitingOptions(personalized, "school", 15)
    .slice(0, 3)
    .map((s) => s.id);
  const next = compareSitingConditions(
    personalized,
    "school",
    15,
    available,
    input,
  );
  const again = compareSitingConditions(
    personalize(personalized, comparison.conditions[2].preferences),
    "school",
    15,
    available,
    input,
  );
  assert.deepEqual(next.plans, again.plans);
  assert.throws(
    () =>
      compareSitingConditions(source, "school", 15, [ids[0], ids[0]], input),
    /重复/,
  );
  assert.throws(
    () => compareSitingConditions(source, "school", 15, ["foreign"], input),
    /不在/,
  );
  assert.throws(
    () =>
      compareSitingConditions(source, "school", 15, ids, {
        ...input,
        waitSeconds: -1,
      }),
    /等灯/,
  );
  assert.throws(
    () =>
      compareSitingConditions(source, "school", 15, ids, {
        ...input,
        departure: "24:01",
      }),
    /时段/,
  );
  assert.throws(
    () => sitingConditionsView({ ...source, id: "changed" }, comparison),
    /报告已变化/,
  );
});

test("empty and truncated model ranges remain explicit instead of silently dropping adverse conditions", () => {
  const empty = structuredClone(source);
  for (const s of empty.samples)
    if (s.travel.status === "ok") s.travel.meters = 5000;
  const c = compareSitingConditions(empty, "school", 15, ids, input);
  assert.equal(c.conditions.length, 3);
  assert.ok(c.conditions.every((v) => v.domainSquareMeters === 0));
  assert.ok(c.plans.every((p) => p.worstGainSquareMeters === 0));
  assert.ok(sitingConditionsView(empty, c).emptyConditions);
  const long = personalize(source, {
    ...comparison.conditions[0].preferences,
    minutes: 30,
    speedMps: 2,
  });
  const clipped = compareSitingConditions(
    long,
    "school",
    30,
    sitingOptions(long, "school", 30)
      .slice(0, 3)
      .map((p) => p.id),
    { ...input, speedMps: 2 },
  );
  assert.ok(sitingConditionsView(long, clipped).clipped);
});

test("export replay binds source, scenario settings, candidate coordinates, geometry and numerical claims", () => {
  const evidence = sitingConditionsEvidence(source, comparison);
  assert.equal(
    replayPlanningEvidence(JSON.stringify(evidence)).verifiedPlans,
    7,
  );
  for (const change of [
    (e: typeof evidence) => {
      e.comparison.plans[0].maxRegretSquareMeters += 20;
    },
    (e: typeof evidence) => {
      e.comparison.sourceId = "foreign";
    },
    (e: typeof evidence) => {
      e.comparison.candidates[0].point[0] += 30;
    },
    (e: typeof evidence) => {
      e.comparison.conditions[0].preferences.speedMps = 2;
    },
    (e: typeof evidence) => {
      e.comparison.plans[0].stable = [
        [
          [
            [0, 0],
            [200, 0],
            [200, 200],
            [0, 0],
          ],
        ],
      ];
    },
  ]) {
    const modified = structuredClone(evidence);
    change(modified);
    assert.throws(() => replayPlanningEvidence(JSON.stringify(modified)));
  }
});
