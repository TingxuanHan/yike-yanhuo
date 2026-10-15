import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { analyze } from "../../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../../src/core/demo.js";
import { parseResultFile } from "../../src/shared/result-file.js";
import { reviewState } from "../../src/shared/facility-review.js";

test("a due reminder opens the matching source, renewal exports its deadline and undo restores the queue", async ({
  page,
}) => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.facilities[0].evidence = [
    {
      source: "模拟台账",
      recordId: "M1",
      checkedAt: "2000-01-01T00:00:00Z",
      nextReviewAt: "2000-02-01T00:00:00Z",
      status: "confirmed",
      basis: "仅用于测试的旧记录",
    },
  ];
  await page.goto("/");
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page.locator("#result-import").setInputFiles({
    name: "reminders.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(result)),
  });
  const panel = page.getByRole("region", { name: "设施核查", exact: true });
  const queue = panel.getByRole("region", { name: "复核提醒", exact: true });
  await expect(queue).toContainText("1处已到复核日期");
  await page.setViewportSize({ width: 390, height: 844 });
  await queue.screenshot({ path: ".cache/review-reminder-390.png" });
  await queue.getByRole("button", { name: "复核此地点" }).click();
  await expect(panel.getByLabel("来源名称", { exact: true })).toHaveValue(
    "模拟台账",
  );
  await expect(panel.getByLabel("来源内编号", { exact: true })).toHaveValue(
    "M1",
  );
  await expect(
    panel.getByLabel("核查时间（本地时间）", { exact: true }),
  ).toHaveValue("");
  await panel
    .getByRole("combobox", { name: "核查结论", exact: true })
    .selectOption("confirmed");
  await panel
    .getByLabel("核查时间（本地时间）", { exact: true })
    .fill(new Date().toISOString().slice(0, 16));
  await panel
    .getByRole("combobox", { name: "下次复核提醒", exact: true })
    .selectOption("7");
  await panel
    .getByLabel("核查依据", { exact: true })
    .fill("模拟复核，验证同来源历史保存");
  await panel.getByRole("button", { name: "记录核查", exact: true }).click();
  await expect(queue).toContainText("0处已到复核日期");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  const saved = parseResultFile(
    await readFile((await (await downloading).path())!, "utf8"),
  );
  const entries = saved.facilities[0].evidence!;
  expect(entries.length).toBe(2);
  expect(
    Date.parse(entries[1].nextReviewAt!) - Date.parse(entries[1].checkedAt),
  ).toBe(7 * 86400000);
  await panel.getByRole("button", { name: "撤销上一次核查" }).click();
  await expect(queue).toContainText("1处已到复核日期");
});

test("facility reviews preview conflicts, undo, export and replay without paid requests", async ({
  page,
}) => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const facility = result.facilities.find((f) => f.category === "market")!;
  let paidCalls = 0;
  await page.route(/\/api\/(map-sdk|analyses|geocode|convert)/, (route) => {
    paidCalls++;
    return route.abort();
  });
  await page.goto("/");
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page.locator("#result-import").setInputFiles({
    name: "result.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(result)),
  });
  await page.getByText("记录或导入核查", { exact: true }).click();
  const panel = page.getByRole("region", { name: "设施核查", exact: true });
  await panel
    .getByRole("combobox", { name: "核查设施", exact: true })
    .selectOption(facility.id);
  await panel
    .getByRole("combobox", { name: "核查结论", exact: true })
    .selectOption("closed");
  await panel.getByLabel("来源名称", { exact: true }).fill("模拟社区台账");
  await panel.getByLabel("来源内编号", { exact: true }).fill("M-01");
  await panel
    .getByLabel("核查时间（本地时间）", { exact: true })
    .fill("2026-10-05T10:00");
  await panel
    .getByLabel("核查依据", { exact: true })
    .fill("模拟核查：台账标记暂停开放，仅用于自动验证。");
  await panel.getByRole("button", { name: "记录核查", exact: true }).click();
  const row = page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: facility.name, exact: true }),
  });
  await expect(row).toContainText("记录停用");
  const file = {
    format: "yike-poi-evidence-v1",
    resultId: result.id,
    entries: [
      {
        facilityId: facility.id,
        evidence: {
          source: "模拟公告",
          recordId: "M-01",
          checkedAt: "2026-10-05T03:00:00.000Z",
          status: "confirmed",
          basis: "另一来源标记开放，制造来源冲突用于自动验证。",
        },
      },
    ],
  };
  await page.locator("#evidence-import").setInputFiles({
    name: "review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(
    page.getByRole("region", { name: "核查导入预览" }),
  ).toBeVisible();
  await expect(row).toContainText("记录停用");
  await panel.getByRole("button", { name: "应用本次核查" }).click();
  await expect(row).toContainText("来源冲突");
  await row.getByText("2 条依据", { exact: true }).click();
  await expect(row).toContainText("模拟社区台账");
  await expect(row).toContainText("模拟公告");
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/facility-review-desktop.png" });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  const download = await downloadPromise;
  const saved = parseResultFile(
    await readFile((await download.path())!, "utf8"),
  );
  expect(reviewState(saved.facilities.find((f) => f.id === facility.id)!)).toBe(
    "conflict",
  );
  await panel.getByRole("button", { name: "撤销上一次核查" }).click();
  await expect(row).toContainText("记录停用");
  await page.locator("#evidence-import").setInputFiles({
    name: "wrong.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...file, resultId: "wrong" })),
  });
  await expect(panel.getByRole("alert")).toContainText("不属于当前报告");
  await expect(row).toContainText("记录停用");
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/facility-review-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "保存本次结果", exact: true }).click();
  await page.reload();
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(result.center.label) })
    .first()
    .click();
  await expect(row).toContainText("记录停用");
  expect(paidCalls).toBe(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".facility-review")).toBeHidden();
  await expect(page.locator(".review-appendix")).toBeVisible();
  await expect(page.locator(".review-appendix")).toContainText(
    "模拟核查：台账标记暂停开放",
  );
});
