import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import {
  compareSelectedSites,
  sitingView,
} from "../src/core/facility-siting.js";

test("native siting compares alternatives and combinations with shared geometry, no network, and no mutation of the report or private book", async () => {
  let copied = "";
  const runtime = miniRuntime(new Map(), {
    setClipboardData: (o: any) => {
      copied = o.data;
      o.success({});
    },
  });
  const page = runtime.page();
  page.onLoad();
  const storage = JSON.stringify([...runtime.storage.entries()]);
  page.openReview();
  page.reviewExample();
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  page.sitingToggle();
  const original = JSON.stringify(page.data.result);
  for (let slot = 0; slot < 3; slot++)
    page.sitingSelect({
      currentTarget: { dataset: { slot } },
      detail: { value: slot + 1 },
    });
  const ids = page.data.sitingSelections.map(
    (i: number) => page.data.sitingOptions[i].id,
  );
  page.compareSites();
  assert.equal(page.data.sitingError, "");
  assert.equal(page.data.sitingView.groups.length, 3);
  page.sitingPlan({ currentTarget: { dataset: { id: "ABC" } } });
  const expected = compareSelectedSites(page.data.result, "school", 15, ids);
  assert.equal(
    JSON.stringify(page.data.sitingView.rows),
    JSON.stringify(sitingView(page.data.result, expected, "ABC").rows),
  );
  page.sitingBefore({ currentTarget: { dataset: { before: "true" } } });
  assert.equal(page.data.sitingView.before, true);
  assert.equal(page.data.sitingView.sketch.places.length, 0);
  await page.copySiting();
  assert.match(copied, /规划假设/);
  assert.match(copied, /构造演示/);
  assert.match(copied, /不代表受益人数/);
  assert.match(copied, /组合方案已扣除重复/);
  assert.equal(JSON.stringify(page.data.result), original);
  page.closeReview();
  assert.equal(JSON.stringify([...runtime.storage.entries()]), storage);
  page.onUnload();
});

test("native edited, stale, duplicate, and invalid selections clear old conclusions and preserve recoverable inputs", () => {
  const page = miniRuntime().page();
  page.onLoad();
  page.coverageToggle();
  page.sitingToggle();
  const choose = (slot: number, value: number) =>
    page.sitingSelect({
      currentTarget: { dataset: { slot } },
      detail: { value },
    });
  choose(0, 1);
  page.compareSites();
  assert.ok(page.data.sitingView);
  choose(1, 1);
  assert.equal(page.data.sitingView, null);
  page.compareSites();
  assert.equal(page.data.sitingView, null);
  assert.match(page.data.sitingError, /重复/);
  assert.equal(page.data.sitingSelections[0], 1);
  choose(1, 2);
  page.compareSites();
  assert.ok(page.data.sitingView);
  page.coverageCategoryChange({ detail: { value: 1 } });
  assert.equal(page.data.sitingView, null);
  assert.equal(JSON.stringify(page.data.sitingSelections), "[0,0,0]");
  choose(0, 1);
  page.compareSites();
  assert.ok(page.data.sitingView);
  page.quickTime({ currentTarget: { dataset: { minutes: 5 } } });
  assert.equal(page.data.sitingView, null);
  choose(0, 1);
  page.data.result = structuredClone(page.data.result);
  page.data.result.parameters.gapDistanceMeters = 0;
  page.updateCoverage();
  choose(0, 1);
  page.compareSites();
  assert.equal(page.data.sitingView, null);
  assert.match(page.data.sitingError, /无效/);
  page.onUnload();
});
