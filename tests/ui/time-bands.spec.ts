import { test, expect } from "./fixtures.js";

test("time bands and legend follow the selected duration without new analysis calls", async ({
  page,
}, info) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/analyses")) calls++;
  });
  await page.goto("/?showcase=1");
  await page.getByRole("button", { name: "体验模拟社区", exact: true }).click();
  await expect(page.getByTestId("time-band")).toHaveCount(3);
  await expect(page.locator(".map-legend")).toContainText("10–15分钟");
  const colors = await page
    .getByTestId("time-band")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("fill")));
  expect(new Set(colors).size).toBe(3);
  await page
    .locator(".map-container")
    .screenshot({ path: info.outputPath("time-bands-desktop.png") });
  await page
    .getByRole("group", { name: "查看步行时长" })
    .getByRole("button", { name: "5 分钟", exact: true })
    .click();
  await expect(page.getByTestId("time-band")).toHaveCount(1);
  await expect(page.locator(".map-legend")).toContainText("0–5分钟");
  await expect(page.locator(".map-legend")).not.toContainText("10–15分钟");
  await page.setViewportSize({ width: 320, height: 850 });
  await page
    .locator(".map-container")
    .screenshot({ path: info.outputPath("time-bands-320.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(calls).toBe(1);
});
