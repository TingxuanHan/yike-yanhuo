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

test("point evidence keeps incomplete search, boundary, excluded records and time filters distinct", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.center.point = [0, 0];
  result.samples = [
    { point: [0, 0], travel: { status: "ok", seconds: 300, meters: 300 } },
    { point: [1200, 0], travel: { status: "ok", seconds: 900, meters: 1200 } },
  ];
  result.parameters.searchRadiusMeters = 1500;
  result.facilities = [
    {
      id: "closed",
      name: "停用药店",
      category: "pharmacy",
      address: "",
      point: [0, 0],
      evidence: [
        {
          source: "test",
          recordId: "1",
          checkedAt: result.generatedAt,
          status: "closed",
          basis: "closed",
        },
      ],
    },
    {
      id: "open",
      name: "已检索药店",
      category: "pharmacy",
      address: "",
      point: [-1000, 0],
    },
  ];
  result.complete.pharmacy = false;
  const all = coveragePoints(result, "pharmacy", 15);
  assert.equal(all[0].status, "covered");
  assert.equal(all[0].nearest?.id, "open");
  assert.equal(all[0].nearest?.meters, 1000);
  assert.equal(all[1].status, "unknown");
  assert.equal(all[1].reasons.length, 2);
  assert.equal(all[1].inSearchArea, false);
  assert.equal(all[1].nearest?.meters, 2200);
  assert.equal(coveragePoints(result, "pharmacy", 5).length, 1);
  assert.equal(coveragePoints(result, "pharmacy", 4).length, 0);
  result.complete.pharmacy = true;
  assert.equal(coveragePoints(result, "pharmacy")[1].status, "unknown");
  result.parameters.searchRadiusMeters = 2200;
  assert.equal(coveragePoints(result, "pharmacy")[1].status, "missing");
  result.facilities = [];
  assert.equal(coveragePoints(result, "pharmacy")[0].nearest, null);
});

test("short-range gap cells cannot be drawn from points outside the selected walking time", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.facilities = [];
  result.samples = [
    { point: [0, 0], travel: { status: "ok", seconds: 600, meters: 300 } },
  ];
  assert.deepEqual(gapCells(result, "school", 5), { missing: [], unknown: [] });
});
