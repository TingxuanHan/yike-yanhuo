import { test, expect } from "@playwright/test";
test("shopping completes a recoverable offline price and planning flow at desktop and phone widths", async ({
  page,
}) => {
  let paid = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(
    /\/api\/(map-sdk|geocode|convert|analyses|outings\/routes)/,
    (route) => {
      paid++;
      return route.abort();
    },
  );
  const open = async () => {
    await page.getByRole("button", { name: "我的日常", exact: true }).click();
    await page
      .getByRole("button", { name: "出门办事 · 熟路与歇脚", exact: true })
      .click();
    await page
      .getByRole("button", { name: "顺路好买 · 按清单与预算安排", exact: true })
      .click();
  };
  await page.goto("/");
  await open();
  await page.getByRole("button", { name: "比较购物方案", exact: true }).click();
  await expect(page.locator(".shopping-receipt").first()).toContainText(
    "清单全部安排",
  );
  await expect(page.locator(".shopping-receipt").first()).toContainText(
    "回到里巷中心",
  );
  await expect(
    page.getByRole("button", { name: "比较购物方案", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page
    .getByRole("button", { name: "复制购物安排", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText("复制未完成");
  await page.getByRole("button", { name: "比较购物方案", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/shopping-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "编辑商品1", exact: true }).click();
  await page.getByLabel("商品1数量", { exact: true }).fill("2");
  await expect(page.locator(".shopping-receipt")).toHaveCount(0);
  await page
    .getByRole("button", { name: "保存清单和预算", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("清单和预算已保存");
  await page.reload();
  await open();
  await page.getByRole("button", { name: "编辑商品1", exact: true }).click();
  await expect(page.getByLabel("商品1数量", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "价格记忆", exact: true }).click();
  const first = page.locator(".shopping-price-list article").first();
  await first
    .getByRole("button", { name: "补记实付 / 缺货", exact: true })
    .click();
  await page.getByLabel("单价 / 区间下限（元）", { exact: true }).fill("10.50");
  await page.getByRole("button", { name: "保存价格记录", exact: true }).click();
  await expect(page.locator(".shopping-price-list")).toContainText("¥10.50");
  const saved = page
    .locator(".shopping-price-list article")
    .filter({ hasText: "¥10.50" });
  await saved
    .getByRole("button", { name: "不再推荐此商品", exact: true })
    .click();
  await expect(
    saved.getByRole("button", { name: "加入清单", exact: true }),
  ).toBeDisabled();
  await saved.getByRole("button", { name: "恢复推荐", exact: true }).click();
  await saved.getByRole("button", { name: "移除记录", exact: true }).click();
  await page.getByRole("button", { name: "撤销移除", exact: true }).click();
  await expect(page.locator(".shopping-price-list")).toContainText("¥10.50");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/shopping-prices-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "购物清单", exact: true }).click();
  await page.getByRole("button", { name: "比较购物方案", exact: true }).click();
  await expect(page.locator(".shopping-receipt").first()).toContainText(
    "虚构价格",
  );
  await expect(
    page.getByRole("button", { name: "比较购物方案", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/shopping-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByLabel("整趟时间（分钟）", { exact: true }).fill("0");
  await page.getByRole("button", { name: "比较购物方案", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("整趟分钟数");
  expect(paid).toBe(0);
  expect(errors).toEqual([]);
});
