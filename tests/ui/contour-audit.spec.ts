import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { analyze } from "../../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../../src/core/demo.js";

test("fixed holdout audit is offline, freezes the plan, exports independently replayable evidence and fits phone widths", async ({
  page,
}, info) => {
  let businessRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/contour-audit")) businessRequests++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page
    .getByText("抽点复核：这个范围和测时一致吗？", { exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "等时圈抽点复核",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "预览固定点与用量", exact: true })
    .click();
  await expect(panel).toContainText("已固定6个位置及原判断");
  await expect(panel.locator(".audit-result")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "开始本机复核", exact: true })
    .click();
  await expect(panel.locator(".audit-result")).toContainText("构造路网对照");
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出抽点复核依据" }).click();
  const file = info.outputPath("contour-audit.json");
  await (await download).saveAs(file);
  const value = JSON.parse(await readFile(file, "utf8"));
  expect(value.plan.count).toBe(6);
  expect(value.observations).toHaveLength(6);
  const replay = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/replay-contour-audit.ts", file],
      { encoding: "utf8" },
    ),
  );
  expect(replay.verifiedPoints).toBe(6);
  expect(replay.externalApiCalls).toBe(0);
  await panel.getByLabel("固定复核点数", { exact: true }).selectOption("12");
  await expect(panel.locator(".audit-result")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "预览固定点与用量", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "开始本机复核", exact: true })
    .click();
  await expect(panel).toContainText("已固定12个位置及原判断");
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await panel.locator(".audit-result").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel
      .locator(".audit-result")
      .screenshot({ path: info.outputPath(`contour-audit-${width}.png`) });
  }
  await page.getByRole("button", { name: "5 分钟", exact: true }).click();
  await expect(panel.locator(".audit-result")).toHaveCount(0);
  expect(businessRequests).toBe(0);
  expect(errors).toEqual([]);
});
test("real report preview exposes the bounded route cost and a missing backend configuration preserves source", async ({
  page,
}) => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.mode = "baidu";
  result.center.geo = { lng: 121.5, lat: 31.2 };
  result.center.label = "构造协议检查，不是真实社区";
  let runs = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/contour-audit")) runs++;
  });
  await page.goto("/");
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page.locator("#result-import").setInputFiles({
    name: "constructed-report.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(result)),
  });
  await page.getByRole("button", { name: "地图", exact: true }).click();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page
    .getByText("抽点复核：这个范围和测时一致吗？", { exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "等时圈抽点复核",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "预览固定点与用量", exact: true })
    .click();
  await expect(panel).toContainText("最多预留12条路线");
  expect(runs).toBe(0);
  await panel
    .getByRole("button", { name: "确认读取固定点", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("尚未配置百度服务");
  await expect(panel.locator(".audit-result")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: result.center.label, exact: true }),
  ).toBeVisible();
  expect(runs).toBe(1);
});
