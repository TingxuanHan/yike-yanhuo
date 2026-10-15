import { test, expect } from "./fixtures.js";

test("coverage points explain evidence without changing the center or calling maps", async ({
  page,
}, info) => {
  let analyses = 0;
  const external: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/analyses"))
      analyses++;
    if (!req.url().startsWith("http://127.0.0.1:8788"))
      external.push(req.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  const marker = page.getByRole("button", { name: /^核查点/ }).first();
  const name = await marker.getAttribute("aria-label");
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#coverage-inspector")).toBeFocused();
  await expect(page.locator(".coverage-verdict")).toContainText(
    name!.match(/点\d+/)![0],
  );
  await expect(page.locator("#coverage-inspector")).toContainText(
    "已取完返回结果",
  );
  await expect(page.locator("#coverage-inspector")).toContainText("模拟街区");
  await page.getByLabel("核查类别", { exact: true }).selectOption("pharmacy");
  await expect(page.locator("#coverage-inspector")).toContainText(
    "最近的已检索药店",
  );
  await page.setViewportSize({ width: 320, height: 850 });
  await page.locator("#coverage-inspector").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("coverage-320.png"),
    fullPage: true,
  });
  expect(analyses).toBe(1);
  expect(external).toEqual([]);
});
