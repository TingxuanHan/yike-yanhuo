import test from "node:test";
import assert from "node:assert/strict";
import {
  pointInPolygons,
  compareContours,
  holdoutPoints,
} from "../src/core/benchmark.js";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import type { MultiPolygon } from "../src/shared/types.js";

test("point inclusion preserves holes, separate islands and boundary semantics", () => {
  const geometry: MultiPolygon = [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ],
    ],
    [
      [
        [20, 20],
        [25, 20],
        [25, 25],
        [20, 25],
        [20, 20],
      ],
    ],
  ];
  assert.ok(pointInPolygons([1, 1], geometry));
  assert.ok(pointInPolygons([0, 5], geometry));
  assert.ok(!pointInPolygons([5, 5], geometry));
  assert.ok(!pointInPolygons([15, 15], geometry));
  assert.ok(pointInPolygons([22, 22], geometry));
});

test("holdout plan excludes training points and confusion counts use only known routes", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  assert.equal(holdoutPoints(result).length, 24);
  const rows = compareContours(result, [
    {
      point: result.center.point,
      travel: { status: "ok", seconds: 0, meters: 0 },
    },
    {
      point: [1500, 1500],
      travel: { status: "ok", seconds: 3600, meters: 5000 },
    },
    { point: [800, 800], travel: { status: "unknown", reason: "timeout" } },
  ]);
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.equal(row.evaluated, 2);
    assert.equal(row.unknown, 1);
    assert.equal(row.trueReachable, 1);
    assert.equal(row.trueUnreachable, 1);
    assert.equal(row.agreement, 1);
  }
});
