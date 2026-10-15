import test from "node:test";
import assert from "node:assert/strict";
import { emptyBook, cleanBook } from "../src/shared/life.js";
import { prepareWalk, finishWalk } from "../src/shared/walk-calibration.js";
import { miniRuntime } from "./helpers/mini.js";
const event = (key: string, value: unknown) => ({
  currentTarget: { dataset: { key } },
  detail: { value },
});
function seed() {
  const now = Date.now() - 86400000;
  return {
    ...emptyBook(),
    walks: [0, 1, 2].map((i) =>
      finishWalk(
        prepareWalk(
          {
            label: `构造测试${i}`,
            meters: 100,
            distanceSource: "measured",
            usual: true,
          },
          1.2,
          [],
          now + i * 1000000,
          `walk-seed-${i}`,
        ),
        125,
        25,
        now + i * 1000000 + 200000,
      ),
    ),
  };
}
test("native walk page retains pending observations, applies pace only on request and preserves household data", async () => {
  const book = seed();
  const storage = new Map<string, any>([["yike-life", book]]);
  let copied = "";
  const overrides = {
    setClipboardData: (o: any) => {
      copied = o.data;
      o.success({});
    },
  };
  const page = miniRuntime(storage, overrides).page("calibration");
  page.onLoad();
  page.onShow();
  assert.equal(page.data.ready, true);
  assert.equal(page.data.summary.ready, true);
  assert.equal(page.data.current, "1.2米/秒");
  page.usual();
  page.prepare();
  assert.ok(page.data.pending);
  assert.equal(storage.get("yike-life").preferences.speedMps, 1.2);
  const next = miniRuntime(storage, overrides).page("calibration");
  next.onLoad();
  assert.equal(next.data.pending, page.data.pending);
  next.field(event("elapsed", "130"));
  next.field(event("stopped", "30"));
  next.finish();
  assert.equal(next.data.summary.evaluationCount, 1);
  assert.equal(next.data.summary.calibratedMaeSeconds, 0);
  assert.equal(storage.get("yike-life").preferences.speedMps, 1.2);
  next.apply();
  const saved = cleanBook(storage.get("yike-life"));
  assert.equal(saved.preferences.speedMps, 1);
  assert.equal(saved.walks?.length, 4);
  next.care();
  assert.equal(storage.get("yike-care-mode"), true);
  await next.copy();
  assert.match(copied, /未经独立核验/);
  assert.ok(!copied.includes("构造测试"));
  const home = miniRuntime(storage).page();
  home.onLoad();
  home.onShow();
  assert.equal(home.data.book.preferences.speedMps, 1);
  home.onUnload();
  await next.resetRecords();
  assert.match(next.data.error, /先复制/);
  assert.equal(storage.get("yike-life").walks.length, 4);
  await next.backup();
  assert.equal(JSON.parse(copied).trials.length, 4);
  await next.resetRecords();
  assert.equal(storage.get("yike-life").walks.length, 0);
  assert.equal(storage.get("yike-life").preferences.speedMps, 1);
});
test("native storage failure keeps measured inputs; simulation never becomes calibration evidence", () => {
  let fail = false;
  const storage = new Map<string, any>();
  const page = miniRuntime(storage, {
    setStorageSync: (k: string, v: any) => {
      if (fail) throw new Error("full");
      storage.set(k, structuredClone(v));
    },
  }).page("calibration");
  page.onLoad();
  page.source({ detail: { value: "2" } });
  page.usual();
  page.prepare();
  page.field(event("elapsed", "125"));
  fail = true;
  page.finish();
  assert.match(page.data.error, /尚未保存/);
  assert.equal(page.data.elapsed, "125");
  assert.ok(page.data.pending);
  fail = false;
  page.finish();
  assert.equal(page.data.summary.count, 0);
  assert.equal(page.data.summary.total, 1);
  page.apply();
  assert.match(page.data.error, /至少3次/);
  assert.equal(storage.get("yike-life").preferences.speedMps, 1.2);
});
