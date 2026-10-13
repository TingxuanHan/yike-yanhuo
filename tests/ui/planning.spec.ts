import { test, expect } from "@playwright/test";
const open = async (page: any) => {
  await page.goto("/");
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page
    .getByRole("button", { name: "一句话安排 · AI辅助", exact: true })
    .click();
};
test("manual planning works without a provider and transfers confirmed fields at phone widths", async ({
  page,
}) => {
  let paid = 0;
  page.on("request", (r) => {
    if (/\/api\/(outings\/routes|ai\/parse|analyses|map-sdk)/.test(r.url()))
      paid++;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "手工填写", exact: true }).click();
  await page.getByLabel("整趟上限（分钟）", { exact: true }).fill("60");
  await page.getByLabel("购物预算（元）", { exact: true }).fill("80");
  await page.getByLabel("希望步行（分钟）", { exact: true }).fill("20");
  await page.getByLabel("想买的商品", { exact: false }).fill("鸡蛋、牛奶");
  await page
    .getByRole("button", { name: "API设置与额度", exact: true })
    .click();
  await page.screenshot({
    path: ".cache/planning-web-390.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "API设置与额度", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认，带入购物", exact: true })
    .click();
  await expect(page.locator(".shopping-status")).toContainText("已带入确认");
  await page.getByRole("button", { name: "比较购物方案", exact: true }).click();
  await expect(page.locator(".shopping-error")).toBeVisible();
  expect(paid).toBe(0);
});
test("model review preserves drafts, never applies automatically and clears API fields after saving", async ({
  page,
}) => {
  const status = {
    free: { configured: true, remaining: null, limit: null, model: "测试模型" },
    own: {
      configured: false,
      baseUrl: "",
      model: "",
      remaining: 20,
      limit: 20,
    },
    resetsAt: "2026-10-14T00:00:00+08:00",
  };
  let requestBody: any,
    failed = false,
    storedKey = "";
  await page.route("**/api/ai/**", async (route) => {
    const req = route.request();
    if (req.url().endsWith("parse")) {
      requestBody = req.postDataJSON();
      return route.fulfill({
        status: failed ? 429 : 200,
        json: failed
          ? { error: "测试额度已用完" }
          : {
              draft: { tripMinutes: 45, shoppingBudget: 50, tasks: ["market"] },
              model: "测试模型",
            },
      });
    }
    if (req.method() === "PUT") storedKey = req.postDataJSON().key;
    await route.fulfill({ json: status });
  });
  await open(page);
  await expect(
    page.getByText("本地不设每日次数限制 · 测试模型", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("这次想做什么", { exact: true })
    .fill("45分钟买菜回来，50元预算");
  await page
    .getByRole("button", { name: "整理成出行条件", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "核对这次出门的条件" }),
  ).toBeVisible();
  expect(Object.keys(requestBody).sort()).toEqual([
    "mode",
    "requestId",
    "text",
  ]);
  expect(
    await page.evaluate(() => localStorage.getItem("yike-life-v1")),
  ).toBeNull();
  failed = true;
  await page
    .getByRole("button", { name: "整理成出行条件", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("测试额度已用完");
  await expect(page.getByLabel("这次想做什么", { exact: true })).toHaveValue(
    "45分钟买菜回来，50元预算",
  );
  await page
    .getByRole("button", { name: "API设置与额度", exact: true })
    .click();
  await page.getByLabel("API密钥", { exact: true }).fill("fixture-private-key");
  await page.getByRole("button", { name: "保存接口", exact: true }).click();
  await expect(page.getByLabel("API密钥", { exact: true })).toHaveValue("");
  expect(storedKey).toBe("fixture-private-key");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture-private-key",
  );
  await page.screenshot({
    path: ".cache/planning-web-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "确认，带入办事", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "出门办事", exact: true }),
  ).toBeVisible();
});
