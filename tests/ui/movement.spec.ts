import { test, expect } from "./fixtures.js";
test("movement checks the selected trip, preserves settings and remains usable at narrow widths without map calls", async ({
  page,
}) => {
  let paid = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(
    /\/api\/(map-sdk|geocode|convert|analyses|outings\/routes)/,
    (r) => {
      paid++;
      return r.abort();
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
  await page
    .getByRole("button", {
      name: "顺路动一动 · 先看离线示例",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "轻快交替走", exact: true }).click();
  await page.getByLabel("希望步行（分钟）", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "安排这一趟怎么走", exact: true })
    .click();
  const result = page.getByRole("region", { name: "步行安排结果" });
  await expect(result).toContainText("这趟时间安排可行");
  await expect(result).toContainText("距离步行目标还差");
  await result
    .locator("summary")
    .filter({ hasText: "查看这一段的步行节奏" })
    .first()
    .click();
  await expect(result).toContainText("稍快走");
  await page.screenshot({
    path: "test-results/movement-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存步行偏好", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("步行偏好已保存");
  await page.getByLabel("希望步行（分钟）", { exact: true }).fill("35");
  await expect(result).toHaveCount(0);
  await page.reload();
  await open();
  await page
    .getByRole("button", { name: "顺路动一动 · 先看离线示例", exact: true })
    .click();
  await expect(
    page.getByLabel("希望步行（分钟）", { exact: true }),
  ).toHaveValue("35");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "载入保存的偏好", exact: true })
    .click();
  await expect(
    page.getByLabel("希望步行（分钟）", { exact: true }),
  ).toHaveValue("30");
  await page.getByText("节奏与连续步行设置", { exact: true }).click();
  await page.getByLabel("连续步行上限（0为不限）", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "安排这一趟怎么走", exact: true })
    .click();
  await expect(result).toContainText("需要调整这趟安排");
  await expect(
    result.getByRole("button", { name: "复制步行安排" }),
  ).toBeDisabled();
  await page.getByLabel("连续步行上限（0为不限）", { exact: true }).fill("0");
  await page.getByLabel("我的轻松步速（米/秒）", { exact: true }).fill("0.3");
  await page
    .getByRole("button", { name: "安排这一趟怎么走", exact: true })
    .click();
  await expect(result).toContainText("整趟超出原定时间");
  await page.getByLabel("我的轻松步速（米/秒）", { exact: true }).fill("1.2");
  await page
    .getByRole("button", { name: "安排这一趟怎么走", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/movement-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "返回原行程", exact: true }).click();
  await page
    .getByRole("button", { name: "顺路好买 · 按清单与预算安排", exact: true })
    .click();
  await page.getByRole("button", { name: "比较购物方案", exact: true }).click();
  await page
    .getByRole("button", { name: "这趟顺路动一动", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "安排这一趟怎么走", exact: true })
    .click();
  await expect(result).toContainText("这趟时间安排可行");
  await expect(result).toContainText("回到里巷中心");
  expect(errors).toEqual([]);
  expect(paid).toBe(0);
});
