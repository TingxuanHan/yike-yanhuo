import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  detourAudit,
  detourEvidence,
  detourView,
} from "../src/core/detour-audit.js";
import { replayPlanningEvidence } from "../src/core/planning-evidence.js";
import type { AnalysisResult, XY, Travel } from "../src/shared/types.js";
const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
function fixture(): AnalysisResult {
  const point = (x: number, y: number, travel: Travel) => ({
    point: [x, y] as XY,
    travel,
  });
  return {
    ...structuredClone(source),
    center: { ...source.center, point: [0, 0] },
    facilities: [],
    samples: [
      point(300, 0, { status: "ok", meters: 900, seconds: 950 }),
      point(400, 0, { status: "ok", meters: 410, seconds: 340 }),
      point(0, 500, { status: "unknown", reason: "missing" }),
      point(0, -500, { status: "unreachable", reason: "no route" }),
      point(-300, 0, { status: "ok", meters: 800, seconds: 700 }),
      point(-300, 0, { status: "ok", meters: 800, seconds: 700 }),
      point(-400, 0, { status: "ok", meters: 850, seconds: 750 }),
      point(-400, 0, { status: "ok", meters: 1200, seconds: 1100 }),
      point(700, 0, { status: "ok", meters: 300, seconds: 250 }),
      point(20, 0, { status: "ok", meters: 800, seconds: 700 }),
      point(1500, 0, { status: "ok", meters: 2200, seconds: 1800 }),
    ],
  };
}
test("detour audit deduplicates observations and separates unknown, unreachable, conflicting and inconsistent distances", () => {
  const report = fixture(),
    saved = JSON.stringify(report),
    audit = detourAudit(report, 15);
  assert.equal(audit.hotspots.length, 2);
  assert.equal(audit.hotspots[0].straightMeters, 300);
  assert.equal(audit.hotspots[0].extraMeters, 600);
  assert.equal(audit.hotspots[0].ratio, 3);
  assert.equal(audit.hotspots[0].outsideTime, true);
  assert.deepEqual(audit.counts, {
    nearPoints: 7,
    knownPoints: 3,
    unknownPoints: 1,
    unreachablePoints: 1,
    conflictPoints: 1,
    inconsistentPoints: 1,
    excludedNearOrigin: 1,
    timeExceeded: 1,
  });
  assert.equal(JSON.stringify(report), saved);
  assert.match(detourView(report, 15).sourceLabel, /构造/);
});
test("detour thresholds are conjunctive and no unmeasured point becomes evidence for an obstacle", () => {
  const report = fixture();
  report.samples = [
    { point: [100, 0], travel: { status: "ok", meters: 299, seconds: 500 } },
    { point: [1000, 0], travel: { status: "ok", meters: 1300, seconds: 1000 } },
    { point: [400, 0], travel: { status: "unknown", reason: "limit" } },
  ];
  const audit = detourAudit(report, 15);
  assert.equal(audit.hotspots.length, 0);
  assert.equal(audit.counts.timeExceeded, 1);
  assert.match(detourView(report, 15).headline, /现有已测点/);
  assert.throws(() => detourAudit(report, 31), /5—30/);
  const evidence = detourEvidence(report, 15);
  assert.equal(
    replayPlanningEvidence(JSON.stringify(evidence)).verifiedPoints,
    3,
  );
  evidence.audit.counts.timeExceeded = 999;
  assert.throws(
    () => replayPlanningEvidence(JSON.stringify(evidence)),
    /不一致/,
  );
});
