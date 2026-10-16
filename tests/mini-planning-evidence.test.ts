import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import {
  compareSitingConditions,
  sitingConditionDefaults,
  sitingConditionsView,
} from "../src/core/siting-conditions.js";
import { detourView } from "../src/core/detour-audit.js";
const choose = (page: any, slot: number, value: number) =>
  page.sitingSelect({
    currentTarget: { dataset: { slot } },
    detail: { value },
  });

test("native condition checks and detour lists match shared calculations offline and preserve all private state", async () => {
  let copied = "";
  const runtime = miniRuntime(new Map(), {
    setClipboardData: (o: any) => {
      copied = o.data;
      o.success({});
    },
  });
  const page = runtime.page();
  page.onLoad();
  const saved = JSON.stringify([...runtime.storage.entries()]);
  page.openReview();
  page.reviewExample();
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  const report = JSON.stringify(page.data.result);
  page.detourToggle();
  assert.equal(
    JSON.stringify(page.data.detourView),
    JSON.stringify(detourView(page.data.result, 15)),
  );
  await page.detourCopy();
  assert.match(copied, /绕行核查/);
  assert.match(copied, /构造/);
  page.sitingToggle();
  for (let i = 0; i < 3; i++) choose(page, i, i + 1);
  page.compareSites();
  page.conditionsToggle();
  page.conditionsCompare();
  assert.equal(page.data.conditionsError, "");
  const ids = page.data.sitingSelections.map(
    (i: number) => page.data.sitingOptions[i].id,
  );
  const expected = compareSitingConditions(
    page.data.result,
    "school",
    15,
    ids,
    sitingConditionDefaults(page.data.result),
  );
  assert.equal(
    JSON.stringify(page.data.conditionsView),
    JSON.stringify(sitingConditionsView(page.data.result, expected)),
  );
  page.conditionsSelect({ currentTarget: { dataset: { id: "AB" } } });
  await page.conditionsCopy();
  assert.match(copied, /同一新增数量/);
  assert.match(copied, /空间交集/);
  assert.match(copied, /构造/);
  assert.equal(JSON.stringify(page.data.result), report);
  page.closeReview();
  assert.equal(JSON.stringify([...runtime.storage.entries()]), saved);
  page.onUnload();
});
test("native condition edits, invalid drafts and replaced reports clear old output without losing input", () => {
  const page = miniRuntime().page();
  page.onLoad();
  page.coverageToggle();
  page.sitingToggle();
  choose(page, 0, 1);
  choose(page, 1, 2);
  page.compareSites();
  page.conditionsToggle();
  page.conditionsCompare();
  assert.ok(page.data.conditionsView);
  page.conditionsField({
    currentTarget: { dataset: { key: "waitSeconds" } },
    detail: { value: "" },
  });
  assert.equal(page.data.conditionsView, null);
  page.conditionsCompare();
  assert.match(page.data.conditionsError, /完整/);
  assert.equal(page.data.conditionsFields.waitSeconds, "");
  page.conditionsField({
    currentTarget: { dataset: { key: "waitSeconds" } },
    detail: { value: "45" },
  });
  page.conditionsCompare();
  assert.ok(page.data.conditionsView);
  choose(page, 1, 3);
  assert.equal(page.data.conditionsView, null);
  page.compareSites();
  page.conditionsCompare();
  assert.ok(page.data.conditionsView);
  page.coverageCategoryChange({ detail: { value: 1 } });
  assert.equal(page.data.conditionsView, null);
  page.onUnload();
});
