import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import { coverageAreaView } from "../src/core/coverage-area.js";

test("native area summary follows category and time without changing the private book or calling APIs", async () => {
  let copied = "";
  const runtime = miniRuntime(new Map(), {
    setClipboardData: (o: any) => {
      copied = o.data;
      o.success({});
    },
  });
  const page = runtime.page();
  page.onLoad();
  const before = JSON.stringify([...runtime.storage.entries()]);
  page.openReview();
  page.reviewExample();
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  assert.equal(page.data.coverageArea.categoryLabel, "小学");
  assert.equal(page.data.coverageArea.sketch.plain, true);
  page.coverageCategoryChange({ detail: { value: 1 } });
  assert.equal(page.data.coverageArea.categoryLabel, "药店");
  page.quickTime({ currentTarget: { dataset: { minutes: 5 } } });
  assert.equal(page.data.coverageArea.minutes, 5);
  assert.equal(
    JSON.stringify(page.data.coverageArea.rows),
    JSON.stringify(coverageAreaView(page.data.result, "pharmacy", 5).rows),
  );
  page.coverageBasisToggle();
  assert.equal(page.data.showCoverageBasis, true);
  await page.copyCoverageArea();
  assert.match(copied, /构造演示/);
  assert.match(copied, /5分钟/);
  assert.match(copied, /人口覆盖率/);
  assert.equal(page.data.coverageAreaError, "");
  page.closeReview();
  assert.equal(JSON.stringify([...runtime.storage.entries()]), before);
  page.onUnload();
});

test("native invalid area parameters clear the old partition and keep point evidence available", () => {
  const page = miniRuntime().page();
  page.onLoad();
  page.coverageToggle();
  assert.ok(page.data.coverageArea);
  page.data.result = structuredClone(page.data.result);
  page.data.result.parameters.gapDistanceMeters = 0;
  page.updateCoverage();
  assert.equal(page.data.coverageArea, null);
  assert.match(page.data.coverageAreaError, /无效/);
  assert.ok(page.data.coveragePoints.length);
  page.onUnload();
});
