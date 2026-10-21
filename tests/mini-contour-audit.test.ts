import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";

test("native audit runs offline in review mode, copies a bounded report and preserves private state", async () => {
  let copied = "";
  const runtime = miniRuntime(new Map(), {
      setClipboardData: (o: any) => {
        copied = o.data;
        o.success({});
      },
    }),
    page = runtime.page();
  page.onLoad();
  const stored = JSON.stringify([...runtime.storage.entries()]);
  page.openReview();
  page.reviewExample();
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  const original = JSON.stringify(page.data.result);
  page.auditToggle();
  await page.auditPreview();
  assert.equal(page.data.auditState.plan.count, 6);
  assert.equal(page.data.busy, false);
  await page.auditRun();
  assert.ok(page.data.auditState.view);
  assert.equal(page.data.busy, false);
  assert.match(page.data.auditState.view.sourceLabel, /构造/);
  await page.auditCopy();
  assert.match(copied, /原规则网格/);
  assert.match(copied, /不是社区随机抽样/);
  page.auditCountChange({ currentTarget: { dataset: { count: 12 } } });
  assert.equal(page.data.auditState.view, null);
  await page.auditPreview();
  await page.auditRun();
  assert.equal(page.data.auditState.view.rows.length, 12);
  assert.equal(JSON.stringify(page.data.result), original);
  page.closeReview();
  assert.equal(JSON.stringify([...runtime.storage.entries()]), stored);
  page.onUnload();
});
test("native stop and report replacements clear prepared or completed evidence", async () => {
  const page = miniRuntime().page();
  page.onLoad();
  page.openReview();
  page.reviewExample();
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  page.auditToggle();
  await page.auditPreview();
  page.auditStop();
  assert.equal(page.data.auditState.prepared, false);
  await page.auditPreview();
  await page.auditRun();
  assert.ok(page.data.auditState.view);
  page.setResult({ ...page.data.result, id: "different-audit-report" }, false);
  assert.equal(page.data.auditState.view, null);
  page.onHide();
  page.onUnload();
});
