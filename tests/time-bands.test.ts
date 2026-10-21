import test from "node:test";
import assert from "node:assert/strict";
import clipping from "polygon-clipping";
import { walkingTimeBands } from "../src/core/time-bands.js";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { polygonArea } from "../src/core/contours.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import type { XY, MultiPolygon } from "../src/shared/types.js";
const square = (radius: number): XY[] => [
  [-radius, -radius],
  [radius, -radius],
  [radius, radius],
  [-radius, radius],
  [-radius, -radius],
];

test("time bands partition the selected area, preserve holes, and never overlap or mutate the report", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.contours = [5, 10, 15].map((minutes) => ({
    minutes,
    areaKm2: 0,
    clipped: false,
    polygons: [[square(minutes), square(2)]],
  }));
  const before = JSON.stringify(result);
  const bands = walkingTimeBands(result, 15);
  assert.deepEqual(
    bands.map((b) => b.label),
    ["0–5分钟", "5–10分钟", "10–15分钟"],
  );
  assert.equal(new Set(bands.map((b) => b.color)).size, 3);
  const union = clipping.union(
    ...(bands.map((b) => b.polygons) as [MultiPolygon, ...MultiPolygon[]]),
  ) as MultiPolygon;
  assert.ok(
    Math.abs(polygonArea(union) - polygonArea(result.contours[2].polygons)) <
      1e-8,
  );
  for (let i = 0; i < bands.length; i++) {
    assert.equal(pointInPolygons([0, 0], bands[i].polygons), false);
    for (let j = i + 1; j < bands.length; j++)
      assert.deepEqual(
        clipping.intersection(bands[i].polygons, bands[j].polygons),
        [],
      );
  }
  assert.equal(JSON.stringify(result), before);
  assert.equal(walkingTimeBands(result, 5).length, 1);
  assert.deepEqual(walkingTimeBands(result, 20), []);
});

test("time bands clip imported non-nested contours and respect an empty selected range", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.contours = [
    { minutes: 5, areaKm2: 0, clipped: false, polygons: [[square(20)]] },
    {
      minutes: 12,
      areaKm2: 0,
      clipped: true,
      polygons: [[square(10), square(2)]],
    },
  ];
  const bands = walkingTimeBands(result, 12);
  assert.equal(bands[1].label, "5–12分钟");
  assert.deepEqual(bands[1].polygons, []);
  assert.deepEqual(
    clipping.difference(bands[0].polygons, result.contours[1].polygons),
    [],
  );
  result.contours[1].polygons = [];
  assert.deepEqual(walkingTimeBands(result, 12), []);
});
