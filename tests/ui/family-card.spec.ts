import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";
import { emptyBook } from "../../src/shared/life.js";

test("Web keeps mini photos on edit and shares one revocable place without device credentials", async ({
  page,
  context,
}) => {
  const image =
    "data:image/png;base64," +
    readFileSync("materials/wechat-avatar-v8-144.png").toString("base64");
  const book = {
    ...emptyBook(),
    places: [
      {
        id: "family-place",
        name: "示例修鞋铺",
        address: "测试街12号",
        landmark: "蓝色雨棚下，东侧入口",
        note: "入口有一级台阶",
        visitedOn: "2026-10-07",
        source: "personal",
        position: { system: "demo", x: 0, y: 0 },
        favorite: true,
        openingHours: "周一至周六 9:00—17:00",
        photo: image,
      },
    ],
  };
  await page.request.post("/api/life/create", { data: { client: "web" } });
  await page.addInitScript(
    (value) => localStorage.setItem("yike-life-v1", JSON.stringify(value)),
    book,
  );
  let paid = 0;
  await page.route(/\/api\/(map-sdk|geocode|convert|analyses)/, (route) => {
    paid++;
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page.getByRole("button", { name: "修改", exact: true }).click();
  await expect(page.getByLabel("收藏这个地点")).toBeChecked();
  await expect(page.getByLabel("记录的营业时间", { exact: true })).toHaveValue(
    book.places[0].openingHours,
  );
  await page.getByLabel("入口地标", { exact: true }).fill("修鞋铺东侧蓝色雨棚");
  await page.getByRole("button", { name: "保存地点修改", exact: true }).click();
  await expect(page.locator(".assist-card img")).toHaveAttribute("src", image);
  await page
    .getByRole("button", { name: "生成只读分享卡", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认生成7天有效卡片", exact: true })
    .click();
  const link = await page.getByLabel("只读地点卡链接").inputValue();
  expect(link).toMatch(/\/#card=[A-Za-z0-9_-]{32}$/);
  const reader = await context.newPage();
  let cookie: string | undefined, auth: string | undefined;
  const requests: string[] = [];
  reader.on("request", (request) => {
    if (request.url().includes("/api/"))
      requests.push(new URL(request.url()).pathname);
    if (request.url().includes("/api/card")) {
      cookie = request.headers().cookie;
      auth = request.headers().authorization;
    }
  });
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.goto(link);
  await expect(
    reader.getByRole("heading", { name: "我要去：示例修鞋铺" }),
  ).toBeVisible();
  await expect(
    reader.getByText("修鞋铺东侧蓝色雨棚", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("button", { name: "打印地点卡" }),
  ).toBeVisible();
  await expect(
    reader.getByRole("button", { name: "修改", exact: true }),
  ).toHaveCount(0);
  expect(cookie).toBeUndefined();
  expect(auth).toBeUndefined();
  expect(requests).toEqual(["/api/card"]);
  expect(
    await reader.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await reader.screenshot({
    path: "test-results/family-card-mobile.png",
    fullPage: true,
  });
  await reader.emulateMedia({ media: "print" });
  await reader.screenshot({
    path: "test-results/family-card-print.png",
    fullPage: true,
  });
  await reader.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "设备与同步", exact: true }).click();
  await page
    .getByRole("button", { name: "查看有效分享卡", exact: true })
    .click();
  await page.getByRole("button", { name: "撤销分享卡", exact: true }).click();
  await reader.reload();
  await expect(reader.getByRole("alert")).toContainText("撤销");
  expect(paid).toBe(0);
  await reader.close();
});
