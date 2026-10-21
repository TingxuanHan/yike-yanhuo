import { test, expect } from "./fixtures.js";
import { analyze } from "../../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../../src/core/demo.js";
test("personal journey, local shop, readable card, private sync and mobile layout use no paid calls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let paid = 0;
  await page.route(/\/api\/(map-sdk|geocode|convert|analyses)/, (route) => {
    paid++;
    return route.abort();
  });
  const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  await page.goto("/");
  await page.getByText("保存与打开结果", { exact: true }).click();
  await page.locator("#result-import").setInputFiles({
    name: "demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page.getByRole("button", { name: "出行偏好", exact: true }).click();
  await page.getByLabel("个人步行时长").fill("20");
  await page.getByLabel("个人步速").fill("0.8");
  await page.getByLabel("考虑等灯时间（手动假设）").check();
  await page
    .getByRole("button", { name: "保存并查看试算范围", exact: true })
    .click();
  await expect(page.locator(".result-strip")).toContainText("20分钟");
  await page.getByRole("button", { name: "体检报告", exact: true }).click();
  await expect(page.locator(".report-document")).toContainText("0.8米/秒");
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page.getByLabel("地点名称", { exact: true }).fill("巷口修鞋铺");
  await page.getByLabel("详细地址", { exact: true }).fill("测试街12号");
  await page
    .getByLabel("入口地标", { exact: true })
    .fill("蓝色雨棚下，东侧入口");
  await page
    .getByLabel("出门提醒", { exact: true })
    .fill("上午营业，入口有一级台阶");
  await page.getByRole("button", { name: "记住这个地方", exact: true }).click();
  await expect(page.locator(".assist-card")).toContainText("蓝色雨棚下");
  await page.getByRole("button", { name: "设备与同步", exact: true }).click();
  await page
    .getByRole("button", { name: "创建私人地点簿", exact: true })
    .click();
  await page.getByRole("button", { name: "同步本机修改", exact: true }).click();
  await page.getByRole("button", { name: "共享当前报告", exact: true }).click();
  await page
    .getByRole("button", { name: "读取服务器版本", exact: true })
    .click();
  await expect(page.locator(".sync-preview")).toContainText("1 个地点");
  await page.getByRole("button", { name: "地点与指引", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "地点与指引", exact: true }),
  ).toHaveCSS("background-color", "rgb(20, 108, 93)");
  await page.screenshot({
    path: "test-results/daily-life-desktop.png",
    fullPage: true,
  });
  await page.evaluate(() => document.body.classList.add("printing-card"));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".assist-card")).toBeVisible();
  await expect(page.locator(".report-document")).toBeHidden();
  await page.screenshot({
    path: "test-results/assisted-card-print.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => document.body.classList.remove("printing-card"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/daily-life-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await expect(page.locator(".personal-places").first()).toContainText(
    "巷口修鞋铺",
  );
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await page
    .getByRole("button", { name: "撤销上次移除 / 合并", exact: true })
    .click();
  await expect(page.locator(".personal-places").first()).toContainText(
    "巷口修鞋铺",
  );
  expect(paid).toBe(0);
  expect(errors).toEqual([]);
});
