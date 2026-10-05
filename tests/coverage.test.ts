import test from "node:test";
import assert from "node:assert/strict";
import polygonClipping from "polygon-clipping";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  coveragePoints,
  coverageSummary,
  gapCells,
} from "../src/core/coverage.js";
import { polygonArea } from "../src/core/contours.js";

test("coverage distinguishes observed facilities, a searched gap, and incomplete evidence", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.samples = [
    { point: [0, 0], travel: { status: "ok", seconds: 0, meters: 0 } },
    { point: [1100, 0], travel: { status: "ok", seconds: 800, meters: 1200 } },
    { point: [1100, 0], travel: { status: "ok", seconds: 800, meters: 1200 } },
    { point: [900, 0], travel: { status: "unknown", reason: "no time" } },
  ];
  result.facilities = [
    { id: "p", name: "药店", category: "pharmacy", address: "", point: [0, 0] },
  ];
  assert.deepEqual(
    coveragePoints(result, "pharmacy").map((p) => p.status),
    ["covered", "missing"],
  );
  result.complete.pharmacy = false;
  assert.deepEqual(
    coveragePoints(result, "pharmacy").map((p) => p.status),
    ["covered", "unknown"],
  );
  const row = coverageSummary(result).find((r) => r.category === "pharmacy")!;
  assert.deepEqual(row, {
    category: "pharmacy",
    total: 2,
    covered: 1,
    missing: 0,
    unknown: 1,
  });
  result.complete.pharmacy = true;
  result.parameters.searchRadiusMeters = 1200;
  assert.equal(coveragePoints(result, "pharmacy")[1].status, "unknown");
});

test("gap highlight cells stay within selected contour and do not invent uncovered area", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const cells = gapCells(result, "school", 15);
  assert.ok(polygonArea(cells.missing) > 0);
  assert.deepEqual(
    polygonClipping.difference(cells.missing, result.contours[2].polygons),
    [],
  );
  assert.deepEqual(cells.unknown, []);
  result.complete.school = false;
  const incomplete = gapCells(result, "school", 15);
  assert.deepEqual(incomplete.missing, []);
  assert.equal(polygonArea(incomplete.unknown), polygonArea(cells.missing));
});
