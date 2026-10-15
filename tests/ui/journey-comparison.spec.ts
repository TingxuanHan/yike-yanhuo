import { test, expect } from "@playwright/test";

test("comparison is temporary, refreshes after an input change and fits a small screen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/?showcase=1");
  await page.getByRole("button", { name: "体验模拟社区", exact: true }).click();
  await expect(page.locator(".result-strip")).toBeVisible();
  let requests = 0;
  await page.route(/\/api\/(analyses|map-sdk|geocode|convert)/, (r) => {
    requests++;
    return r.abort();
  });
  const summary = (await page.locator(".result-strip").textContent())!;
  await page
    .getByText("个人条件对比 · 换个步速或等灯时间", { exact: true })
    .click();
  await page.getByLabel("对比步速（米/秒）").fill("0.6");
  await page.getByRole("button", { name: "比较这两种条件" }).click();
  await expect(page.locator(".comparison-result")).toContainText("处超出时长");
  await expect(page.locator(".comparison-result")).toContainText("模拟社区");
  await expect(page.locator(".result-strip")).toHaveText(summary);
  await page.getByLabel("对比步速（米/秒）").fill("1.2");
  await expect(page.locator(".comparison-result")).toHaveCount(0);
  await page.getByLabel("对比等灯方式").selectOption("fixed");
  await page.getByLabel("每次等待（秒）").fill("60");
  await page.getByRole("button", { name: "比较这两种条件" }).click();
  await expect(page.locator(".comparison-result")).toBeVisible();
  await page
    .locator(".journey-comparison")
    .screenshot({ path: ".cache/comparison-web-390.png" });
  await page.setViewportSize({ width: 320, height: 850 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(requests).toBe(0);
  expect(errors).toEqual([]);
});
