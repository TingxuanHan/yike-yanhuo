import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveMesh, splitSharedEdges } from "../src/core/mesh.js";
import { contoursFromTriangles, polygonArea } from "../src/core/contours.js";
import { pointKey } from "../src/core/geo.js";
import type { Sample, Triangle, XY } from "../src/shared/types.js";

const sample = (point: XY): Sample => ({
  point,
  travel: { status: "ok", seconds: point[0] + point[1] + 400, meters: 0 },
});

test("all edge split patterns conserve area and a linear time field", () => {
  const triangle = [
    [0, 0],
    [200, 0],
    [0, 200],
  ].map((p) => sample(p as XY)) as Triangle;
  const mids: XY[] = [
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  for (let mask = 0; mask < 8; mask++) {
    const selected = mids.filter((_, i) => mask & (1 << i));
    const mesh = splitSharedEdges(
      [triangle],
      new Map(selected.map((p) => [pointKey(p), sample(p)])),
    );
    assert.equal(polygonArea(contoursFromTriangles(mesh, 1000)), 20000);
    assert.equal(polygonArea(contoursFromTriangles(mesh, 500)), 5000);
  }
});

test("a midpoint splits both neighbors and preserves its measured detour", () => {
  const a = sample([0, 0]),
    b = sample([200, 0]),
    c = sample([200, 200]),
    d = sample([0, 200]);
  const midpoint: Sample = {
    point: [100, 100],
    travel: { status: "ok", seconds: 2000, meters: 2000 },
  };
  const triangles = splitSharedEdges(
    [
      [a, b, c],
      [a, c, d],
    ],
    new Map([[pointKey(midpoint.point), midpoint]]),
  );
  assert.equal(triangles.length, 4);
  assert.equal(triangles.filter((t) => t.includes(midpoint)).length, 4);
  assert.ok(polygonArea(contoursFromTriangles(triangles, 900)) < 40000);
});

test("two-pass mesh respects the unique-point budget and has no hanging vertices", async () => {
  const requested = new Set<string>();
  const result = await adaptiveMesh([0, 0], 800, 400, 50, async (points) =>
    points.map((point) => {
      assert.ok(
        !requested.has(pointKey(point)),
        "must not pay for duplicate samples",
      );
      requested.add(pointKey(point));
      return {
        point,
        travel: {
          status: "ok",
          seconds: Math.hypot(...point),
          meters: Math.hypot(...point),
        },
      };
    }),
  );
  assert.ok(result.additions <= 50);
  assert.equal(result.passes, 2);
  assert.equal(result.samples.length, 25 + result.additions);
  for (const t of result.triangles)
    for (let i = 0; i < 3; i++) {
      const a = t[i].point,
        b = t[(i + 1) % 3].point;
      for (const { point: p } of result.samples) {
        const cross =
          (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
        const dot =
          (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]);
        assert.ok(
          Math.abs(cross) > 1e-6 || dot >= 0,
          "measured vertex inside an unsplit edge",
        );
      }
    }
  const area = polygonArea(contoursFromTriangles(result.triangles, 5000));
  assert.equal(area, 1600 ** 2);
});

test("unknown midpoint leaves a hole instead of inventing a walk time", () => {
  const t = [
    [0, 0],
    [200, 0],
    [0, 200],
  ].map((p) => sample(p as XY)) as Triangle;
  const mid: Sample = {
    point: [100, 0],
    travel: { status: "unknown", reason: "timeout" },
  };
  const triangles = splitSharedEdges(
    [t],
    new Map([[pointKey(mid.point), mid]]),
  );
  assert.deepEqual(contoursFromTriangles(triangles, 10000), []);
});
