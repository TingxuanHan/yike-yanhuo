import { test, expect } from "@playwright/test";
import { once } from "node:events";
import type { Server } from "node:http";
import { createApp } from "../../src/server/app.js";

let app: Server;
const base = "http://127.0.0.1:8794";
test.beforeAll(async () => {
  app = createApp({ PORT: "8794" });
  app.listen(8794, "127.0.0.1");
  await once(app, "listening");
});
test.afterAll(() => {
  app.closeAllConnections();
  app.close();
});
test("neighbors share evidence, see conflicting recovery and withdraw only their own feedback", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  let paid = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/(analyses|ai\/|outings\/)/.test(r.url())
    )
      paid++;
  });
  page.on("dialog", (d) => d.accept());
  expect(
    (await page.request.post(base + "/api/life/create", { data: {} })).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  async function openTrip(p: typeof page) {
    await p.goto(base);
    await p.getByRole("button", { name: /我要出门/ }).click();
    await p.getByRole("button", { name: "核算整趟行程", exact: true }).click();
    await p
      .getByRole("button", { name: "查看步行指引", exact: true })
      .first()
      .click();
    await p.getByRole("button", { name: "查看模拟步骤", exact: true }).click();
    await p
      .getByRole("button", { name: "邻里提醒 · 查看或补充", exact: true })
      .click();
  }
  await openTrip(page);
  const panel = page.getByRole("region", { name: "邻里提醒", exact: true });
  await expect(panel).toContainText("不代表门店一定营业");
  await panel
    .getByRole("button", { name: "报告遇到的情况", exact: true })
    .click();
  await panel
    .getByLabel("发生了什么", { exact: true })
    .selectOption("construction");
  await panel
    .getByLabel("具体情况", { exact: true })
    .fill("模拟东入口施工，另一侧入口尚未确认。");
  await expect(
    panel.getByRole("button", { name: "确认共享反馈", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel(/我已核对位置/).check();
  await panel
    .getByRole("button", { name: "确认共享反馈", exact: true })
    .click();
  await expect(panel).toContainText("反馈已共享");
  await panel.getByRole("button", { name: "刷新提醒", exact: true }).click();
  await expect(panel.locator(".neighbor-event")).toContainText(
    "有人反馈，待核实",
  );
  const second = await browser.newContext({
    viewport: { width: 320, height: 740 },
  });
  try {
    expect(
      (await second.request.post(base + "/api/life/create", { data: {} })).ok(),
    ).toBe(true);
    const other = await second.newPage();
    other.on("pageerror", (e) => errors.push(e.message));
    await openTrip(other);
    const otherPanel = other.getByRole("region", {
      name: "邻里提醒",
      exact: true,
    });
    await expect(otherPanel.locator(".neighbor-event")).toContainText(
      "有人反馈，待核实",
    );
    await otherPanel
      .getByRole("button", { name: "我看到仍有问题", exact: true })
      .click();
    await otherPanel
      .getByLabel("具体情况", { exact: true })
      .fill("又看到同一入口围挡。");
    await otherPanel.getByLabel(/我已核对位置/).check();
    await otherPanel
      .getByRole("button", { name: "确认共享反馈", exact: true })
      .click();
    await expect(otherPanel).toContainText("反馈已共享");
    await otherPanel
      .getByRole("button", { name: "刷新提醒", exact: true })
      .click();
    await expect(otherPanel.locator(".neighbor-event")).toContainText(
      "多份近期反馈",
    );
    await panel.getByRole("button", { name: "刷新提醒", exact: true }).click();
    await panel
      .getByRole("button", { name: "我看到已经恢复", exact: true })
      .click();
    await panel
      .getByLabel("具体情况", { exact: true })
      .fill("刚看到东侧围挡已经移开。");
    await panel.getByLabel(/我已核对位置/).check();
    await panel
      .getByRole("button", { name: "确认共享反馈", exact: true })
      .click();
    await expect(panel).toContainText("反馈已共享");
    await panel.getByRole("button", { name: "刷新提醒", exact: true }).click();
    await expect(panel.locator(".neighbor-event")).toContainText(
      "近期反馈有分歧",
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await panel.getByText("查看反馈依据", { exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: "docs/images/neighborhood-conflict-320.png",
    });
    await panel
      .getByRole("button", { name: "撤回我的反馈", exact: true })
      .click();
    await expect(panel).toContainText("你的反馈已撤回");
    await panel.getByRole("button", { name: "刷新提醒", exact: true }).click();
    await expect(panel.locator(".neighbor-event")).toContainText(
      "有人反馈，待核实",
    );
    await page.context().setOffline(true);
    await panel.getByRole("button", { name: "刷新提醒", exact: true }).click();
    await expect(panel).toContainText("已过刷新时间或连接中断");
    await expect(
      panel.getByRole("button", { name: "我看到仍有问题", exact: true }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "报告遇到的情况", exact: true })
      .click();
    await panel
      .getByLabel("具体情况", { exact: true })
      .fill("离线时保留的现场文字。");
    await panel
      .getByRole("button", { name: "仅存本机草稿", exact: true })
      .click();
    await expect(panel).toContainText("草稿仅保存在本机，尚未共享");
    await panel.getByRole("button", { name: "收起表单", exact: true }).click();
    await panel
      .getByRole("button", { name: "继续本机草稿", exact: true })
      .click();
    await expect(panel.getByLabel("具体情况", { exact: true })).toHaveValue(
      "离线时保留的现场文字。",
    );
    await page.context().setOffline(false);
    expect(
      await page.evaluate(() => localStorage.getItem("yike-active-trip")),
    ).toBeNull();
    expect(paid).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.context().setOffline(false);
    await second.close();
  }
});
