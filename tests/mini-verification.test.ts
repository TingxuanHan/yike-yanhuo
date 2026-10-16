import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import {
  VERIFICATION_BACKUP_KEY,
  verificationPlan,
} from "../src/core/verification.js";

const choose = (page: any) => {
  const tasks = page.data.verificationTasks;
  for (const task of [
    tasks.find((t: any) => t.kind === "route"),
    tasks.find((t: any) => t.kind === "search"),
  ].filter(Boolean))
    page.verificationChoose({ currentTarget: { dataset: { id: task.id } } });
};

test("native offline verification uses shared rules, explicit adoption and source-bound copy without private writes in review mode", async () => {
  let copied = "";
  const runtime = miniRuntime(new Map(), {
      setClipboardData: (o: any) => {
        copied = o.data;
        o.success({});
      },
    }),
    page = runtime.page();
  page.onLoad();
  const storage = JSON.stringify([...runtime.storage.entries()]);
  page.openReview();
  page.reviewExample();
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  page.verificationToggle();
  page.verificationDrill();
  const source = JSON.stringify(page.data.result),
    known = page.data.result.quality.knownSamples;
  choose(page);
  assert.equal(page.data.verificationSelected, 2);
  await page.verificationPreview();
  assert.ok(page.data.verificationPlan);
  await page.verificationRun();
  assert.equal(page.data.verificationReady, true);
  assert.equal(page.data.verificationError, "");
  assert.equal(JSON.stringify(page.data.result), source);
  assert.equal(page.data.verificationDiff.knownSamplesAfter, known + 1);
  await page.verificationCopy();
  assert.match(copied, /人工构造演练/);
  assert.match(copied, /不是现场精度/);
  page.verificationAdopt();
  assert.equal(page.data.result.quality.knownSamples, known + 1);
  assert.equal(page.data.verificationReady, false);
  assert.equal(page.data.verificationCanRestore, true);
  assert.ok(page.data.result.localSearches.length);
  page.verificationRestore();
  assert.equal(JSON.stringify(page.data.result), source);
  page.closeReview();
  assert.equal(JSON.stringify([...runtime.storage.entries()]), storage);
  page.onUnload();
});

test("native backup failure prevents adoption, persisted pairs reopen after a new page and context edits clear pending conclusions", async () => {
  const storage = new Map<string, any>();
  let fail = false;
  const runtime = miniRuntime(storage, {
    setStorageSync: (k: string, v: any) => {
      if (fail && k === VERIFICATION_BACKUP_KEY) throw new Error("full");
      storage.set(k, structuredClone(v));
    },
  });
  const page = runtime.page();
  page.onLoad();
  page.coverageToggle();
  page.verificationToggle();
  page.verificationDrill();
  choose(page);
  await page.verificationPreview();
  await page.verificationRun();
  const source = JSON.stringify(page.data.result);
  fail = true;
  page.verificationAdopt();
  assert.equal(JSON.stringify(page.data.result), source);
  assert.match(page.data.verificationError, /未采用/);
  fail = false;
  page.verificationAdopt();
  const saved = storage.get(VERIFICATION_BACKUP_KEY);
  assert.ok(saved?.before && saved.after);
  page.onUnload();
  const reopened = miniRuntime(storage).page();
  reopened.onLoad();
  reopened.verificationReopen();
  assert.equal(reopened.data.result.id, saved.after.id);
  assert.equal(reopened.data.verificationCanRestore, true);
  reopened.coverageToggle();
  reopened.verificationToggle();
  reopened.verificationDrill();
  choose(reopened);
  await reopened.verificationPreview();
  assert.ok(reopened.data.verificationPlan);
  reopened.coverageCategoryChange({ detail: { value: 1 } });
  assert.equal(reopened.data.verificationPlan, null);
  assert.equal(reopened.data.verificationReady, false);
  assert.equal(reopened.data.verificationSelected, 0);
  reopened.onUnload();
});

test("native cancellation during job creation rejects late results and deletes the returned task", async () => {
  let resolveStart: (() => void) | undefined,
    deleted = false;
  const storage = new Map<string, any>([
    ["yike-server", "http://127.0.0.1:8787"],
  ]);
  const runtime = miniRuntime(storage, {
      request: (o: any) => {
        const path = new URL(o.url).pathname;
        if (path === "/api/verification/preview")
          return o.success({
            statusCode: 200,
            data: {
              fingerprint: "test",
              plan: verificationPlan(
                o.data.result,
                o.data.category,
                o.data.minutes,
                o.data.taskIds,
              ),
            },
          });
        if (path === "/api/verification") {
          resolveStart = () =>
            o.success({ statusCode: 202, data: { id: "cancelled-test-job" } });
          return;
        }
        if (
          path === "/api/analyses/cancelled-test-job" &&
          o.method === "DELETE"
        ) {
          deleted = true;
          return o.success({ statusCode: 200, data: { status: "cancelled" } });
        }
        throw new Error("Unexpected API request");
      },
    }),
    page = runtime.page();
  page.onLoad();
  page.coverageToggle();
  page.verificationToggle();
  page.verificationDrill();
  const source = structuredClone(page.data.result);
  source.mode = "baidu";
  source.center.geo = { lng: 121.5, lat: 31.2 };
  page.setResult(source, false, 15);
  choose(page);
  await page.verificationPreview();
  const before = JSON.stringify(page.data.result),
    pending = page.verificationRun();
  assert.ok(resolveStart);
  page.verificationStop();
  resolveStart!();
  await pending;
  assert.equal(page.data.verificationReady, false);
  assert.equal(page.data.busy, false);
  assert.equal(JSON.stringify(page.data.result), before);
  assert.equal(deleted, true);
  page.onUnload();
});
