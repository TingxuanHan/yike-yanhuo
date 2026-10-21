import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";

test("simple trip reads large steps without marking arrival, then exports saved steps for offline use", async ({
  page,
  context,
}) => {
  let paid = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/(outings|analyses|ai)/.test(r.url()))
      paid++;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /我要出门/ }).click();
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page
    .getByRole("button", { name: "查看步行指引", exact: true })
    .first()
    .click();
  const panel = page.getByRole("region", { name: "这一段怎么走" });
  await expect(panel).toContainText("还没有保存这段步骤");
  await panel
    .getByRole("button", { name: "查看模拟步骤", exact: true })
    .click();
  await expect(panel).toContainText("这一段已保存在本机");
  await expect(panel.locator(".walking-step")).toContainText("1 /");
  await panel.getByRole("button", { name: "下一条指引", exact: true }).click();
  await expect(panel.locator(".walking-step")).toContainText("2 /");
  expect(
    await page.evaluate(() => localStorage.getItem("yike-active-trip")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("yike-location-record")),
  ).toBeNull();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: "docs/images/walking-steps-320.png" });
  await page
    .getByRole("button", { name: "准备这趟出门卡", exact: true })
    .first()
    .click();
  await page
    .locator("#trip-preparation summary")
    .filter({ hasText: "卡内步行步骤" })
    .click();
  await expect(page.locator("#trip-preparation")).toContainText("未获取：");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载离线出门卡", exact: true })
    .click();
  const path = test.info().outputPath("walking-offline.html");
  await (await downloadPromise).saveAs(path);
  await page.getByRole("button", { name: "收起步行指引", exact: true }).click();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "查看步行指引", exact: true })
    .first()
    .click();
  await expect(panel).toContainText("沿模拟道路");
  const offline = await context.newPage();
  let remote = 0;
  offline.on("request", (r) => {
    if (/^https?:/.test(r.url())) remote++;
  });
  await offline.goto(pathToFileURL(path).href);
  await expect(
    offline.getByRole("heading", { name: "已保存的步行步骤", exact: true }),
  ).toBeVisible();
  await expect(offline.locator("body")).toContainText("沿模拟道路");
  expect(remote).toBe(0);
  expect(paid).toBe(0);
});
