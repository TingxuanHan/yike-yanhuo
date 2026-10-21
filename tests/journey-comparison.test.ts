import test from "node:test";
import assert from "node:assert/strict";
import clipping from "polygon-clipping";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  compareJourneys,
  comparisonDefaults,
} from "../src/core/journey-comparison.js";
import { polygonArea } from "../src/core/contours.js";
import { personalize } from "../src/core/personalize.js";
import { DEFAULT_JOURNEY } from "../src/shared/journey.js";
import { miniRuntime } from "./helpers/mini.js";
import type { MultiPolygon } from "../src/shared/types.js";

test("condition comparison partitions the measured area and conserves source evidence without requests", async () => {
  const provider = new DemoProvider(),
    source = await analyze(provider, DEMO_CENTERS[0]);
  const original = JSON.stringify(source),
    calls = provider.usage.requests;
  const input = comparisonDefaults(source, 15);
  const same = compareJourneys(source, { ...input, speedMps: 1.2 });
  assert.equal(same.counts.lost + same.counts.gained, 0);
  assert.equal(same.lostAreaKm2 + same.gainedAreaKm2, 0);
  const slow = compareJourneys(source, { ...input, speedMps: 0.6 });
  assert.ok(slow.baseline.areaKm2 > slow.candidate.areaKm2);
  assert.ok(slow.counts.lost > 0);
  assert.equal(slow.counts.gained, 0);
  const [common, lost, gained] = slow.layers.map((l) => l.polygons);
  assert.ok(
    Math.abs(
      (polygonArea(common) + polygonArea(lost)) / 1e6 - slow.baseline.areaKm2,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      (polygonArea(common) + polygonArea(gained)) / 1e6 -
        slow.candidate.areaKm2,
    ) < 1e-8,
  );
  assert.equal(
    polygonArea(clipping.intersection(common, lost) as MultiPolygon),
    0,
  );
  const waiting = compareJourneys(source, {
    ...input,
    speedMps: 1.2,
    waiting: "fixed",
    waitSeconds: 60,
    crossingsPerKm: 4,
  });
  assert.ok(waiting.candidate.areaKm2 < waiting.baseline.areaKm2);
  assert.equal(JSON.stringify(source), original);
  assert.equal(provider.usage.requests, calls);
});

test("comparison preserves missing routes and exclusions, supports custom minutes and rejects incomplete grids", async () => {
  const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  source.samples[0].travel = { status: "unknown", reason: "缺测" };
  source.facilities[0].travel = { status: "unknown", reason: "未测" };
  source.facilities[1].evidence = [
    {
      source: "观察",
      recordId: "1",
      checkedAt: "2026-10-01T00:00:00Z",
      status: "closed",
      basis: "现场告示",
    },
  ];
  source.complete.market = false;
  const input = comparisonDefaults(source, 20),
    result = compareJourneys(source, input);
  assert.equal(
    result.facilities.find((f) => f.id === source.facilities[0].id)!.change,
    "unknown",
  );
  assert.equal(
    result.facilities.find((f) => f.id === source.facilities[1].id)!.change,
    "excluded",
  );
  assert.ok(result.unknownSamples >= 1);
  assert.equal(result.incompleteSearch, true);
  assert.equal(result.minutes, 20);
  for (const invalid of [
    { speedMps: 0 },
    { minutes: 31 },
    { waitSeconds: NaN },
    { crossingsPerKm: 11 },
  ])
    assert.throws(() => compareJourneys(source, { ...input, ...invalid }));
  assert.throws(() => compareJourneys({ ...source, samples: [] }, input));
});

test("repeated comparisons use original distances and keep a personalized source unchanged", async () => {
  const raw = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const source = personalize(raw, {
    ...DEFAULT_JOURNEY,
    speedMps: 0.7,
    minutes: 20,
  });
  const copy = JSON.stringify(source),
    input = { ...comparisonDefaults(source, 20), speedMps: 1.2 };
  const first = compareJourneys(source, input),
    second = compareJourneys(source, input);
  assert.deepEqual(first, second);
  assert.equal(first.baselinePrefs.speedMps, 0.7);
  assert.ok(first.counts.gained > 0);
  assert.equal(JSON.stringify(source), copy);
});

test("native condition comparison matches shared calculation without modifying storage or the active report", () => {
  const runtime = miniRuntime(),
    page = runtime.page();
  page.onLoad();
  page.openReview();
  page.reviewDetail({ currentTarget: { dataset: { panel: "compare" } } });
  assert.equal(page.data.showComparison, true);
  assert.equal(page.data.showCoverage, false);
  const saved = JSON.stringify([...runtime.storage]),
    original = JSON.stringify(page.data.result);
  page.compareJourney();
  assert.equal(page.data.comparisonError, "");
  const expected = compareJourneys(
    JSON.parse(original),
    comparisonDefaults(JSON.parse(original), page.data.minutes),
  );
  assert.equal(page.data.comparison.baselineCount, expected.baseline.count);
  assert.equal(page.data.comparison.candidateCount, expected.candidate.count);
  assert.equal(JSON.stringify(page.data.result), original);
  assert.equal(JSON.stringify([...runtime.storage]), saved);
  page.reviewDetail({ currentTarget: { dataset: { panel: "coverage" } } });
  assert.equal(page.data.showComparison, false);
  assert.equal(page.data.showCoverage, true);
  page.reviewDetail({ currentTarget: { dataset: { panel: "compare" } } });
  page.comparisonField({
    currentTarget: { dataset: { key: "speedMps" } },
    detail: { value: "" },
  });
  assert.equal(page.data.comparison, null);
  page.compareJourney();
  assert.match(page.data.comparisonError, /完整填写/);
  page.quickTime({ currentTarget: { dataset: { minutes: 10 } } });
  assert.equal(page.data.comparison, null);
  assert.equal(page.data.comparisonError, "");
  assert.equal(JSON.stringify([...runtime.storage]), saved);
  page.closeReview();
  page.onUnload();
});
