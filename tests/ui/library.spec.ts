import { test, expect } from "./fixtures.js";
import { analyze } from "../../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../../src/core/demo.js";

test("saved real-mode reports can be opened, saved and replayed without any map or analysis request", async ({
  page,
}) => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  result.mode = "baidu";
  result.center = {
    label: "回放测试记录",
    point: [0, 0],
    geo: { lng: 121.5, lat: 31.2 },
  };
  let paidCalls = 0;
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { baiduConfigured: true, mapConfigured: true, version: "test" },
    }),
  );
  await page.route(/\/api\/(map-sdk|analyses|geocode|convert)/, (route) => {
    paidCalls++;
    return route.abort();
  });
  await page.goto("/");
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page.locator("#result-import").setInputFiles({
    name: "report.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(result)),
  });
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByText("历史结果", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存本次结果", exact: true }).click();
  await page.reload();
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page
    .getByRole("button", { name: /回放测试记录/ })
    .first()
    .click();
  await page.getByRole("button", { name: "地图", exact: true }).click();
  await expect(page.getByText("结果示意图", { exact: false })).toBeVisible();
  await page
    .getByRole("group", { name: "查看步行时长" })
    .getByRole("button", { name: "5 分钟", exact: true })
    .click();
  await expect(page.locator(".result-strip")).toContainText("5分钟");
  expect(paidCalls).toBe(0);
  await page.screenshot({
    path: "test-results/result-replay-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/result-replay-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.locator("#result-import").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("alert")).toContainText("有效的体检结果");
  await expect(page.locator(".result-strip")).toBeVisible();
  expect(paidCalls).toBe(0);
});
