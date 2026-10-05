import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("desktop analysis, local filtering, report export and no browser errors", async ({
  page,
}, info) => {
  const errors: string[] = [];
  let analyses = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/analyses"))
      analyses++;
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "看看附近的生活" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".map-legend")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("group", { name: "查看步行时长" })
    .getByRole("button", { name: "5 分钟", exact: true })
    .click();
  await page
    .locator(".category-option")
    .filter({ hasText: "药店" })
    .getByRole("checkbox")
    .uncheck();
  expect(analyses).toBe(1);
  await page.getByRole("button", { name: "体检报告", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "1公里设施覆盖核查" }),
  ).toBeVisible();
  await expect(page.locator(".chart-row")).toHaveCount(6);
  await expect(page.locator(".coverage-row")).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("report-charts.png"),
    fullPage: true,
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  const download = await downloaded;
  const output = info.outputPath("export.json");
  await download.saveAs(output);
  const result = JSON.parse(await readFile(output, "utf8"));
  expect(result.mode).toBe("demo");
  expect(result.contours).toHaveLength(3);
  expect(result).not.toHaveProperty("ak");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".control-panel")).toBeHidden();
  await expect(page.locator(".report-document")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile workbench fits viewport and handles a changed center", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("选择一个起点").selectOption("1");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /设施筛选与核查点/ }).click();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page.getByLabel("核查类别").selectOption("school");
  await expect(page.locator(".gap-explanation")).toContainText("数据不足");
  await page.screenshot({
    path: info.outputPath("mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "体检报告", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("report-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("missing configuration and server failure offer recovery without losing input", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "百度地图", exact: true }).click();
  await expect(page.getByText("真实地图服务尚未就绪")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始体检", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "模拟街区", exact: true }).click();
  await page.route("**/api/analyses", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试服务暂不可用，请重试。" }),
    }),
  );
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请重试");
  await page.unroute("**/api/analyses");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.route("**/api/analyses", (route) =>
    route.fulfill({ status: 429, json: { error: "预算不足，请稍后重试。" } }),
  );
  await page.getByRole("button", { name: "重新体检", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("预算不足");
  await expect(page.locator(".result-strip")).toBeVisible();
  await page.getByRole("button", { name: "体检报告", exact: true }).click();
  await expect(page.getByRole("article")).toBeVisible();
});
test("map permission rejection shows recovery without vendor dialogs or a blank map", async ({
  page,
}) => {
  let dialogs = 0;
  const errors: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { mapConfigured: true, baiduConfigured: true, version: "0.1.0" },
    }),
  );
  await page.route("**/api/map-sdk/api?*", (route) =>
    route.fulfill({ status: 503, json: { error: "地图底图服务未启用。" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "百度地图", exact: true }).click();
  await page.getByText("直接输入地图坐标", { exact: true }).click();
  await page.getByLabel("经度", { exact: true }).fill("121.5");
  await page.getByLabel("纬度", { exact: true }).fill("31.2");
  await page.getByRole("button", { name: "使用这个点", exact: true }).click();
  await expect(page.getByText("地图暂未加载", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新加载底图" }),
  ).toBeEnabled();
  expect(dialogs).toBe(0);
  expect(errors).toEqual([]);
});
