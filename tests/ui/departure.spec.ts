import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";

test("simple routine is reused without starting a trip and an exported card opens offline without external requests", async ({
  page,
  context,
}) => {
  let paid = 0;
  page.on("request", (r) => {
    if (
      (r.method() === "POST" &&
        /\/api\/(ai\/(parse|plan|voice)$|outings\/routes|analyses)/.test(
          r.url(),
        )) ||
      /\/api\/map-sdk/.test(r.url())
    )
      paid++;
  });
  page.on("dialog", (d) => d.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("家人电话（只存本机）").fill("10086");
  await page.getByRole("button", { name: "保存家人电话", exact: true }).click();
  await page.getByRole("button", { name: /我要出门/ }).click();
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page
    .getByRole("button", { name: "存为常用方案", exact: true })
    .first()
    .click();
  await page.getByLabel("常用方案名称").fill("买菜顺路取药");
  await page.getByRole("button", { name: "保存常用方案", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "模拟 · 买菜顺路取药 · 重新核算" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "准备这趟出门卡", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "拨打卡内家人电话" }),
  ).toHaveAttribute("href", "tel:10086");
  await expect(page.locator(".departure-pack")).toContainText("返程地点");
  await page
    .locator(".departure-pack")
    .screenshot({ path: "docs/images/departure-card-390.png" });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载离线出门卡", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("一刻烟火-离线出门卡.html");
  const path = test.info().outputPath("offline-outing.html");
  await download.saveAs(path);
  await page.getByRole("button", { name: "返回我的日常", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /我要出门/ }).click();
  await page
    .getByRole("button", { name: "模拟 · 买菜顺路取药 · 重新核算" })
    .click();
  await expect(page.locator(".trip-plans")).toContainText("回来");
  expect(
    await page.evaluate(() => localStorage.getItem("yike-active-trip")),
  ).toBeNull();
  await context.setOffline(true);
  const offline = await context.newPage();
  let remote = 0;
  offline.on("request", (r) => {
    if (/^https?:/.test(r.url())) remote++;
  });
  await offline.goto(pathToFileURL(path!).href);
  await expect(
    offline.getByRole("heading", { name: "返程地点", exact: true }),
  ).toBeVisible();
  await expect(
    offline.getByRole("link", { name: /拨打家人电话/ }),
  ).toHaveAttribute("href", "tel:10086");
  await expect(
    offline.getByText("模拟社区与示例价格 · 不可据此出行", { exact: true }),
  ).toBeVisible();
  await offline.screenshot({
    path: "docs/images/departure-offline.png",
    fullPage: true,
  });
  expect(remote).toBe(0);
  expect(paid).toBe(0);
});

test("opening a location card sends no receipt; explicit response arrives and offline owner is clearly stale", async ({
  page,
  browser,
}) => {
  page.on("dialog", (d) => d.accept());
  await page.request.post("/api/life/create", { data: {} });
  await page.addInitScript(() => {
    localStorage.setItem(
      "yike-location-record",
      JSON.stringify({
        source: "confirmed",
        name: "测试门口（构造）",
        at: Date.now() - 120000,
        accuracyM: null,
        position: { system: "gcj02", lng: 121.5, lat: 31.2 },
      }),
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "告诉家人我在哪", exact: true })
    .click();
  await page
    .getByRole("button", { name: "生成家人位置卡", exact: true })
    .click();
  await expect(page.locator(".family-receipt")).toContainText(
    "尚未收到主动回应",
  );
  const url = (await page.locator(".family-link").textContent())!.trim();
  const helperContext = await browser.newContext({
    viewport: { width: 320, height: 740 },
  });
  try {
    const helper = await helperContext.newPage();
    let posts = 0,
      leak = false;
    helper.on("request", (r) => {
      if (/\/api\/family\//.test(r.url())) {
        if (r.method() === "POST") posts++;
        if (r.headers().cookie || r.headers().authorization) leak = true;
      }
    });
    await helper.goto(url);
    await expect(helper.locator(".family-receipt")).toContainText("尚未收到");
    expect(posts).toBe(0);
    await helper.getByLabel("你的称呼（对方会看到）").fill("家人测试");
    await helper
      .getByRole("button", { name: "我正在过来", exact: true })
      .click();
    await expect(helper.getByRole("status")).toContainText("回应已保存");
    expect(posts).toBe(1);
    expect(leak).toBe(false);
    await page
      .getByRole("button", { name: "刷新家人回应", exact: true })
      .click();
    await expect(page.locator(".family-receipt")).toContainText(
      "家人测试：我正在过来",
    );
    await helper.screenshot({
      path: "docs/images/family-receipt-320.png",
      fullPage: true,
    });
    expect(
      await helper.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.context().setOffline(true);
    await page
      .getByRole("button", { name: "刷新家人回应", exact: true })
      .click();
    await expect(
      page.getByText(
        "暂时无法核对新回应，下方仅是上次收到的记录。可直接拨打电话。",
        { exact: true },
      ),
    ).toBeVisible();
    await page.context().setOffline(false);
    await page
      .getByRole("button", { name: "停止位置分享", exact: true })
      .click();
    await helper
      .getByRole("button", { name: "刷新位置卡", exact: true })
      .click();
    await expect(helper.getByRole("alert")).toContainText("停止或到期");
    await expect(
      helper.getByRole("button", { name: "我正在过来", exact: true }),
    ).toHaveCount(0);
  } finally {
    await helperContext.close();
  }
});
