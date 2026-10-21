import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { parseResultFile } from "../src/shared/result-file.js";

test("result imports preserve report geometry while discarding foreign fields", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const imported = parseResultFile(
    JSON.stringify({ ...result, ak: "do-not-retain", extra: { token: "no" } }),
  );
  assert.deepEqual(imported, result);
  assert.ok(!JSON.stringify(imported).includes("do-not-retain"));
});
test("malformed and oversized report geometry is rejected before rendering", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  for (const mutate of [
    (r: any) => {
      r.schemaVersion = 999;
    },
    (r: any) => {
      r.mode = "baidu";
      r.center.geo = { lng: 999, lat: 31 };
    },
    (r: any) => {
      r.samples[0].travel = { status: "ok", seconds: -1, meters: 5 };
    },
    (r: any) => {
      r.contours[0].polygons = [
        [
          [
            [1, 2],
            [2, 3],
            ["bad", 3],
            [1, 2],
          ],
        ],
      ];
    },
    (r: any) => {
      r.gaps[0] = { category: "unknown", status: "missing", point: [0, 0] };
    },
  ]) {
    const changed = structuredClone(result);
    mutate(changed);
    assert.throws(() => parseResultFile(JSON.stringify(changed)), /有效/);
  }
  assert.throws(() => parseResultFile(" ".repeat(2_000_001)), /2MB/);
});
