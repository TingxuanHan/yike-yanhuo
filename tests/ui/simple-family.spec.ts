import { test, expect } from "@playwright/test";

test("simple entry keeps calling and family help available, folds advanced planning and remembers mode", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("简易模式 · 出门有人帮")).toBeVisible();
  await page.getByLabel("家人电话（只存本机）").fill("10086");
  await page.getByRole("button", { name: "保存家人电话", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "一键拨打家人电话" }),
  ).toHaveAttribute("href", "tel:10086");
  await page.reload();
  await expect(
    page.getByRole("link", { name: "一键拨打家人电话" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/images/simple-home-390.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /我要出门/ }).click();
  await expect(
    page.getByRole("heading", { name: "这次想做什么" }),
  ).toBeVisible();
  await expect(page.getByLabel("本次修改", { exact: true })).toBeHidden();
  await expect(
    page.getByRole("link", { name: "一键拨打家人电话" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "更多条件与AI修改" }).click();
  await expect(page.getByLabel("本次修改", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起更多设置" }).click();
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page
    .getByRole("button", { name: "按这条安排出门", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "发起这趟的远程协助", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换完整版" }).click();
  await expect(
    page.getByRole("button", { name: "我的日常", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "我的日常", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "简易模式", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /继续这趟出门/ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("denied location falls back to timed evidence, shares without owner credentials, and revokes across browsers", async ({
  page,
  browser,
}) => {
  let paid = 0;
  page.on("request", (r) => {
    if (/\/api\/(ai|outings\/routes|analyses|map-sdk)/.test(r.url())) paid++;
  });
  page.on("dialog", (d) => d.accept());
  await page.request.post("/api/life/create", { data: {} });
  await page.addInitScript(() => {
    localStorage.setItem("yike-help-phone", "10086");
    localStorage.setItem(
      "yike-location-record",
      JSON.stringify({
        source: "confirmed",
        name: "测试街角（构造）",
        at: Date.now() - 600000,
        accuracyM: null,
        position: { system: "gcj02", lng: 121.5, lat: 31.2 },
      }),
    );
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          fail({ code: 1 }),
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "告诉家人我在哪", exact: true })
    .click();
  await page.getByRole("button", { name: "授权并获取一次位置" }).click();
  await expect(page.getByRole("alert")).toContainText("未获得定位权限");
  await expect(
    page.getByRole("heading", { name: "最后本人确认：测试街角（构造）" }),
  ).toBeVisible();
  await expect(page.locator(".position-range")).toContainText("步行假设");
  await expect(
    page.getByRole("link", { name: "一键拨打家人电话" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "生成家人位置卡", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "停止位置分享" }),
  ).toBeVisible();
  const url = (await page.locator(".family-link").textContent())!.trim();
  const helperContext = await browser.newContext({
    viewport: { width: 320, height: 740 },
  });
  try {
    const helper = await helperContext.newPage();
    let credential = false;
    helper.on("request", (r) => {
      if (
        /\/api\/family\//.test(r.url()) &&
        (r.headers().cookie || r.headers().authorization)
      )
        credential = true;
    });
    await helper.goto(url);
    await expect(
      helper.getByRole("heading", { name: "一起确认他在哪" }),
    ).toBeVisible();
    await expect(helper.locator(".position-range")).toContainText("步行假设");
    expect(
      await helper.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await helper.screenshot({
      path: "docs/images/family-location-320.png",
      fullPage: true,
    });
    expect(credential).toBe(false);
    await page
      .getByRole("button", { name: "停止位置分享", exact: true })
      .click();
    await helper.reload();
    await expect(helper.getByRole("alert")).toContainText("停止或到期");
    await expect(helper.locator(".position-evidence")).toHaveCount(0);
  } finally {
    await helperContext.close();
  }
  expect(paid).toBe(0);
});

test("one-shot browser fix is not uploaded automatically and old evidence has no circle", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "yike-location-record",
      JSON.stringify({
        source: "confirmed",
        name: "旧测试地点",
        at: Date.now() - 3600000,
        accuracyM: null,
        position: { system: "bd09", lng: 121.5, lat: 31.2 },
      }),
    );
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: (v: unknown) => void) =>
          ok({
            timestamp: Date.now(),
            coords: { longitude: 121.4, latitude: 31.3, accuracy: 30 },
          }),
      },
    });
  });
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/life\/family/.test(r.url())) posts++;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "告诉家人我在哪", exact: true })
    .click();
  await expect(page.locator(".position-evidence > .muted")).toContainText(
    "记录已超过30分钟",
  );
  await expect(page.locator(".position-evidence svg")).toHaveCount(0);
  await page.getByRole("button", { name: "授权并获取一次位置" }).click();
  await expect(
    page.getByRole("heading", { name: "最后一次设备定位" }),
  ).toBeVisible();
  await expect(page.locator(".position-evidence svg")).toHaveCount(1);
  expect(posts).toBe(0);
});
