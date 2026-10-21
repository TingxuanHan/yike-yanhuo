import test from "node:test";
import assert from "node:assert/strict";
import clip from "polygon-clipping";
import {
  coverageArea,
  coverageAreaView,
  AREA_STATES,
} from "../src/core/coverage-area.js";
import { polygonArea } from "../src/core/contours.js";
import { pointInPolygons } from "../src/core/benchmark.js";
import { distance } from "../src/core/geo.js";
import {
  completeCategories,
  emptyUsage,
  type AnalysisResult,
  type MultiPolygon,
  type XY,
} from "../src/shared/types.js";

export function square(x: number, y: number, half: number): XY[] {
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
    [x - half, y - half],
  ];
}
export function fixture(): AnalysisResult {
  const polygons: MultiPolygon = [[square(0, 0, 1500)]];
  return {
    schemaVersion: 1,
    id: "constructed-coverage",
    mode: "demo",
    generatedAt: "2026-10-16T00:00:00Z",
    center: { label: "构造核查范围", point: [0, 0] },
    samples: [],
    gaps: [],
    warnings: [],
    usage: emptyUsage(),
    elapsedMs: 0,
    complete: completeCategories(true),
    facilities: [
      {
        id: "market",
        name: "构造菜场",
        category: "market",
        point: [0, 0],
        address: "构造",
      },
    ],
    contours: [5, 10, 15].map((minutes) => ({
      minutes,
      polygons,
      areaKm2: 9,
      clipped: false,
    })),
    parameters: {
      radiusMeters: 1500,
      coarseStepMeters: 400,
      refinedStepMeters: 200,
      refinementPoints: 0,
      searchRadiusMeters: 4000,
      gapDistanceMeters: 1000,
      gapDistanceDefinition: "直线距离",
    },
    quality: {
      knownSamples: 0,
      totalSamples: 0,
      unknownFacilities: 0,
      skippedTriangles: 0,
    },
  };
}
function partition(
  result: AnalysisResult,
  area: ReturnType<typeof coverageArea>,
) {
  const domain = result.contours.find(
    (c) => c.minutes === area.minutes,
  )!.polygons;
  const total = AREA_STATES.reduce((n, s) => n + area.squareMeters[s], 0);
  assert.ok(Math.abs(total - polygonArea(domain)) < 1e-4);
  for (const s of AREA_STATES) {
    if (area.regions[s].length)
      assert.ok(
        polygonArea(clip.difference(area.regions[s], domain) as MultiPolygon) <
          1e-4,
      );
    for (const t of AREA_STATES.filter((v) => v !== s))
      if (area.regions[s].length && area.regions[t].length)
        assert.ok(
          polygonArea(
            clip.intersection(area.regions[s], area.regions[t]) as MultiPolygon,
          ) < 1e-4,
        );
  }
  assert.ok(
    Math.abs(
      Object.values(area.unknownReasons).reduce((a, b) => a + b, 0) -
        area.squareMeters.unknown,
    ) < 1e-4,
  );
}

test("continuous distance coverage partitions the contour and conservatively brackets the 1km boundary", () => {
  const result = fixture(),
    original = JSON.stringify(result),
    area = coverageArea(result, "market");
  partition(result, area);
  assert.ok(area.squareMeters.covered < Math.PI * 1e6);
  assert.ok(area.squareMeters.missing < 9e6 - Math.PI * 1e6);
  assert.ok(area.squareMeters.unknown > 0 && area.boundaryBandMeters < 0.61);
  for (let degrees = 0; degrees < 360; degrees += 1.7)
    for (const radius of [0, 995, 999.999, 1000, 1000.001, 1005, 1400]) {
      const point: XY = [
        radius * Math.cos((degrees * Math.PI) / 180),
        radius * Math.sin((degrees * Math.PI) / 180),
      ];
      if (pointInPolygons(point, area.regions.covered))
        assert.ok(distance(point, [0, 0]) <= 1000);
      if (pointInPolygons(point, area.regions.missing))
        assert.ok(distance(point, [0, 0]) > 1000);
      if (radius === 1000)
        assert.ok(pointInPolygons(point, area.regions.unknown));
    }
  assert.equal(JSON.stringify(result), original);
});

test("incomplete results and search edges stay unknown while positive facility evidence remains usable", () => {
  const result = fixture();
  result.parameters.searchRadiusMeters = 2400;
  let area = coverageArea(result, "market");
  partition(result, area);
  assert.ok(pointInPolygons([1200, 0], area.regions.missing));
  assert.ok(pointInPolygons([1490, 1490], area.regions.unknown));
  assert.ok(area.unknownReasons.searchEdge > 0);
  result.complete.market = false;
  area = coverageArea(result, "market");
  partition(result, area);
  assert.equal(area.squareMeters.missing, 0);
  assert.ok(pointInPolygons([0, 0], area.regions.covered));
  assert.ok(area.unknownReasons.incomplete > 0);
  result.parameters.searchRadiusMeters = 500;
  result.complete.market = true;
  area = coverageArea(result, "market");
  assert.equal(area.squareMeters.missing, 0);
  assert.ok(area.squareMeters.covered > 0);
});

test("holes, disconnected areas and facilities outside the walking contour retain the right geometry", () => {
  const result = fixture();
  result.contours[2].polygons = [
    [square(0, 0, 700), square(0, 0, 150)],
    [square(1500, 0, 100)],
  ];
  result.facilities[0].point = [1600, 0];
  result.facilities[0].travel = { status: "unknown", reason: "not timed" };
  const area = coverageArea(result, "market");
  partition(result, area);
  assert.ok(pointInPolygons([1500, 0], area.regions.covered));
  assert.ok(pointInPolygons([-500, 0], area.regions.missing));
  for (const s of AREA_STATES)
    assert.equal(pointInPolygons([0, 0], area.regions[s]), false);
  const view = coverageAreaView(result, "market", 15);
  assert.equal(view.minutes, 15);
  assert.ok(view.hasHoles);
});

test("closed or disputed facilities cannot prove coverage and broad-phase culling changes no results", () => {
  const result = fixture(),
    baseline = coverageArea(result, "market");
  result.facilities.push(
    ...Array.from({ length: 100 }, (_, i) => ({
      ...result.facilities[0],
      id: `copy-${i}`,
    })),
  );
  result.facilities.push(
    ...Array.from({ length: 100 }, (_, i) => ({
      ...result.facilities[0],
      id: `far-${i}`,
      point: [10000 + i, 10000] as XY,
    })),
  );
  const area = coverageArea(result, "market");
  assert.equal(area.facilitiesConsidered, 201);
  assert.equal(area.facilitiesUsed, 1);
  assert.deepEqual(area.squareMeters, baseline.squareMeters);
  for (const f of result.facilities)
    f.evidence = [
      {
        source: "fixture",
        recordId: f.id,
        checkedAt: result.generatedAt,
        status: "closed",
        basis: "constructed closed",
      },
    ];
  assert.equal(coverageArea(result, "market").squareMeters.covered, 0);
});

test("area follows the selected contour, keeps clipped provenance and rejects unavailable time without inventing geometry", () => {
  const result = fixture();
  result.contours[0].polygons = [];
  assert.equal(coverageArea(result, "market", 5).totalSquareMeters, 0);
  result.contours[1].polygons = [[square(0, 0, 100)]];
  result.contours[1].clipped = true;
  const area = coverageArea(result, "market", 10);
  assert.equal(area.totalSquareMeters, 40000);
  assert.equal(area.clipped, true);
  assert.equal(area.squareMeters.missing, 0);
  assert.throws(() => coverageArea(result, "market", 20), /没有/);
  result.parameters.gapDistanceMeters = NaN;
  assert.throws(() => coverageArea(result, "market"), /无效/);
});
