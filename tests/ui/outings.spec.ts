import { test, expect } from "@playwright/test";

test("four outing tools work offline on desktop and narrow screens with recoverable drafts", async ({
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
  };
  await page.goto("/");
  await open();
  await page.getByRole("button", { name: "安排这趟出门", exact: true }).click();
  await expect(page.locator(".outing-result").first()).toContainText(
    "完成2件事",
  );
  await expect(page.locator(".outing-result").first()).toContainText(
    "回到里巷中心",
  );
  await expect(
    page.getByRole("button", { name: "安排这趟出门", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/outings-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "走走歇歇", exact: true }).click();
  await page
    .getByRole("button", { name: "找能歇脚的走法", exact: true })
    .click();
  await expect(page.locator(".outing-result").first()).toContainText("歇脚");
  const rests = page.locator('.outing-form input[type="checkbox"]');
  for (const box of await rests.all()) await box.uncheck();
  await page
    .getByRole("button", { name: "找能歇脚的走法", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("无法满足条件");
  await page.getByRole("button", { name: "补点看变化", exact: true }).click();
  await page.getByRole("button", { name: "比较补点前后", exact: true }).click();
  await expect(page.locator(".outing-result")).toContainText("个测试点");
  await expect(page.locator(".outing-impact-table tbody tr")).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "比较补点前后", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/outings-impact-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "家人带过的路", exact: true }).click();
  await page.getByLabel("熟路名称", { exact: true }).fill("家到菜场的熟路");
  await page.getByLabel("关键点1名称").fill("小区东门");
  await page.getByLabel("关键点1指引").fill("从东门出来，沿雨棚下的人行道走。");
  await page.getByLabel("关键点2名称").fill("菜场蓝色招牌");
  await page.getByLabel("关键点2指引").fill("从南侧入口进入。");
  await page.reload();
  await open();
  await page.getByRole("button", { name: "家人带过的路", exact: true }).click();
  await expect(page.getByLabel("熟路名称", { exact: true })).toHaveValue(
    "家到菜场的熟路",
  );
  await page.getByRole("button", { name: "保存熟路卡", exact: true }).click();
  await expect(page.locator(".familiar-print")).toContainText("菜场蓝色招牌");
  await expect(page.getByLabel("熟路名称", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/outings-familiar-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.evaluate(() =>
    document.body.classList.add("printing-card", "printing-familiar"),
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".familiar-print")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "出门办事功能" }),
  ).toBeHidden();
  await page.screenshot({
    path: "test-results/outings-familiar-print.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() =>
    document.body.classList.remove("printing-card", "printing-familiar"),
  );
  await page.getByRole("button", { name: "返回熟路列表", exact: true }).click();
  await page
    .locator(".outing-route-list")
    .getByRole("button", { name: "移除", exact: true })
    .click();
  await expect(page.locator(".outing-route-list article")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销移除", exact: true }).click();
  await expect(page.locator(".outing-route-list")).toContainText(
    "家到菜场的熟路",
  );
  expect(paid).toBe(0);
  expect(errors).toEqual([]);
});
