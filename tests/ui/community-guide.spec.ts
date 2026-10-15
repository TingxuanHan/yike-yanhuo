import { test, expect } from "@playwright/test";
import { analyze } from "../../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../../src/core/demo.js";

test("guided community tour starts from simple mode, keeps evidence separate and exports", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const paid: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/\/api\/(map-sdk|geocode|convert)/, (route) => {
    paid.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: /社区体检演示/ }).click();
  await expect(
    page.getByRole("region", { name: "社区体检演示导览" }),
  ).toBeVisible();
  await page
    .getByText("上海真实接口对照 · 查看实验结果", { exact: true })
    .click();
  await expect(page.locator(".study-summary")).toContainText("23/24");
  await expect(page.locator(".study-summary")).toContainText("5分钟未全面改善");
  await page.getByRole("button", { name: "体验模拟社区", exact: true }).click();
  await expect(page.locator(".guide-current")).toContainText("模拟社区");
  await page
    .getByRole("button", { name: "2. 查设施缺口", exact: true })
    .click();
  await expect(page.locator("#coverage-inspector")).toBeFocused();
  await page
    .getByRole("button", { name: "3. 阅读与导出报告", exact: true })
    .click();
  await expect(page.getByRole("article")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  await (await download).saveAs(info.outputPath("guided-report.json"));
  await page.setViewportSize({ width: 320, height: 850 });
  await page.locator(".community-guide").scrollIntoViewIfNeeded();
  await page.locator(".community-guide").screenshot({
    path: info.outputPath("community-guide-320.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "日常首页", exact: true }).click();
  await expect(page.getByRole("button", { name: /我要出门/ })).toBeVisible();
  expect(paid).toEqual([]);
  expect(errors).toEqual([]);
});

test("guided replay imports a historical record without fetching routes or maps and preserves it on failure", async ({
  page,
}) => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.mode = "baidu";
  result.center.geo = { lng: 121.5, lat: 31.2 };
  result.center.label = "构造的回放契约记录";
  let upstream = 0;
  await page.route(/\/api\/(map-sdk|analyses|geocode|convert)/, (route) => {
    upstream++;
    return route.abort();
  });
  await page.goto("/?showcase=1");
  await page.getByRole("button", { name: "打开已有报告", exact: true }).click();
  await page.locator("#result-import").setInputFiles({
    name: "case.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(result)),
  });
  await expect(page.locator(".guide-current")).toContainText(
    "构造的回放契约记录",
  );
  await page
    .getByRole("button", { name: "1. 看步行范围", exact: true })
    .click();
  await expect(page.getByText("结果示意图", { exact: false })).toBeVisible();
  await page.locator("#result-import").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".guide-current")).toContainText(
    result.center.label,
  );
  expect(upstream).toBe(0);
});
