import { test, expect } from "@playwright/test";
test("simple trip compares a replacement, keeps cancelled choices and refreshes its departure card", async ({
  page,
}) => {
  const errors: string[] = [];
  let paid = 0,
    accept = true;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/(outings|ai|analyses)/.test(r.url()))
      paid++;
  });
  page.on("dialog", (d) => (accept ? d.accept() : d.dismiss()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /我要出门/ }).click();
  await page.getByText("我的通行需要", { exact: true }).click();
  await page.getByLabel("推车出门", { exact: true }).check();
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page
    .getByRole("button", { name: "按这条安排出门", exact: true })
    .first()
    .click();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yike-active-trip")!),
  );
  await page
    .getByRole("button", { name: "下一站不好走？看看备选", exact: true })
    .click();
  await page
    .getByRole("button", { name: "比较时间和费用", exact: true })
    .click();
  const comparison = page.getByRole("region", {
    name: "备选安排",
    exact: true,
  });
  await expect(comparison).toContainText("原安排：");
  await expect(comparison).toContainText("不会自动绕过");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("yike-active-trip")!),
    ),
  ).toEqual(before);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await comparison.screenshot({ path: "docs/images/trip-alternative-320.png" });
  accept = false;
  await comparison
    .getByRole("button", { name: "确认替换下一站", exact: true })
    .click();
  await expect(
    comparison.getByRole("button", { name: "确认替换下一站", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("yike-active-trip")!),
    ),
  ).toEqual(before);
  accept = true;
  await comparison
    .getByRole("button", { name: "确认替换下一站", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已替换下一站" }),
  ).toBeVisible();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yike-active-trip")!),
  );
  expect(after.remaining[0]).not.toBe(before.remaining[0]);
  expect(after.events.slice(0, -1)).toEqual(before.events);
  await page
    .getByRole("button", { name: "准备当前出门卡", exact: true })
    .click();
  await expect(page.locator("body")).toContainText("本趟已更换地点");
  expect(paid).toBe(0);
  expect(errors).toEqual([]);
});
