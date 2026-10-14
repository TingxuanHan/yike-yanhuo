import { test, expect } from "./fixtures.js";

test("two independent browsers exchange scoped help, mark an entrance and confirm a changed trip", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  let external = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      /\/api\/(outings\/routes|analyses|map-sdk)/.test(r.url()) ||
      (r.method() === "POST" && /\/api\/ai\/(parse|voice)/.test(r.url()))
    )
      external++;
  });
  page.on("dialog", (d) => d.accept());
  await page.request.post("/api/life/create", { data: {} });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page
    .getByRole("button", { name: "一趟出门 · 边办事边走走", exact: true })
    .click();
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page
    .getByRole("button", { name: "按这条安排出门", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "发起这趟的远程协助", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "复制协助链接", exact: true }),
  ).toBeVisible();
  const link = await page.locator(".assist-link").textContent();
  const context = await browser.newContext({
      viewport: { width: 320, height: 740 },
    }),
    helper = await context.newPage();
  try {
    helper.on("pageerror", (e) => errors.push(e.message));
    await helper.goto(link!.trim());
    await expect(
      helper.getByRole("heading", { name: "陪家人走好这一趟" }),
    ).toBeVisible();
    await helper
      .getByLabel("给家人的说明", { exact: true })
      .fill("先在原地等我看一下入口。");
    await helper
      .getByRole("button", { name: "发送建议，等待本人确认" })
      .click();
    await page
      .getByRole("button", { name: "刷新家人的建议", exact: true })
      .click();
    await expect(page.locator(".assist-proposal")).toContainText("先在原地");
    await page
      .getByRole("button", { name: "保留我的安排", exact: true })
      .click();

    await page.getByText("最后一百米 · 认准入口", { exact: true }).click();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 360;
      c.height = 240;
      const x = c.getContext("2d")!;
      x.fillStyle = "#efe5ca";
      x.fillRect(0, 0, 360, 240);
      x.fillStyle = "#257a69";
      x.fillRect(210, 70, 85, 170);
      x.fillStyle = "#fff";
      x.font = "20px sans-serif";
      x.fillText("TEST ENTRANCE", 20, 40);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("选择入口照片").setInputFiles({
      name: "synthetic-entrance.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page
      .getByLabel("认准这里", { exact: true })
      .fill("构造测试照片，右侧绿色门框。");
    await page
      .getByRole("button", { name: "保存私人入口卡", exact: true })
      .click();
    await page
      .getByRole("button", { name: "把这张入口卡分享给家人", exact: true })
      .click();
    await helper.getByRole("button", { name: "刷新协助", exact: true }).click();
    await expect(helper.locator(".entrance-mark")).toBeVisible();
    await helper.getByLabel("建议类型").selectOption("entrance");
    await helper
      .locator(".entrance-mark")
      .click({ position: { x: 160, y: 110 } });
    await helper
      .getByLabel("给家人的说明", { exact: true })
      .fill("认准圈出的绿色门框，开放情况现场确认。");
    await helper
      .getByRole("button", { name: "发送建议，等待本人确认" })
      .click();
    await page
      .getByRole("button", { name: "刷新家人的建议", exact: true })
      .click();
    await expect(page.locator(".assist-proposal")).toContainText("绿色门框");
    await page
      .locator(".assist-proposal")
      .screenshot({ path: ".cache/assistance-owner-390.png" });
    await helper.screenshot({
      path: ".cache/assistance-helper-320.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "核对并采纳建议", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("yike-life-v1")!).entrances[0]
              .source,
        ),
      )
      .toBe("helper");

    await page.getByRole("button", { name: "前往下一站", exact: true }).click();
    await page
      .getByRole("button", { name: "我到了，确认位置", exact: true })
      .click();
    await page
      .getByRole("button", { name: "刷新家人的建议", exact: true })
      .click();
    await helper.getByRole("button", { name: "刷新协助", exact: true }).click();
    await helper.getByLabel("建议类型").selectOption("plan");
    await helper.getByLabel("建议舒适步速（米/秒）").fill("0.8");
    await helper
      .getByLabel("给家人的说明", { exact: true })
      .fill("这段慢一点走，保留剩余安排。");
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("yike-active-trip")!),
    );
    await helper
      .getByRole("button", { name: "发送建议，等待本人确认" })
      .click();
    await page
      .getByRole("button", { name: "刷新家人的建议", exact: true })
      .click();
    await expect(page.locator(".assist-proposal")).toContainText("0.8米/秒");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("yike-active-trip")!).input.draft
            .speedMps,
      ),
    ).toBe(before.input.draft.speedMps);
    await page
      .getByRole("button", { name: "核对并采纳建议", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("yike-active-trip")!).input.draft
              .speedMps,
        ),
      )
      .toBe(0.8);
    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("yike-active-trip")!),
    );
    expect(after.input.draft.speedMps).toBe(0.8);
    expect(after.completed).toEqual(before.completed);
    expect(after.input.draft.shoppingBudget).toBe(
      before.input.draft.shoppingBudget,
    );
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await helper.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "结束协助", exact: true }).click();
    await helper.getByRole("button", { name: "刷新协助", exact: true }).click();
    await expect(helper.getByRole("alert")).toContainText("已结束或到期");
    await expect(helper.locator(".entrance-mark")).toHaveCount(0);
    expect(external).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
