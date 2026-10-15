import { test, expect } from "./fixtures.js";
import { emptyBook } from "../../src/shared/life.js";
import { prepareWalk, finishWalk } from "../../src/shared/walk-calibration.js";
import { readFile } from "node:fs/promises";

test("walk observations use frozen predictions, explicit application, export and reversible exclusion on compact screens", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let calls = 0;
  await page.route(
    /\/api\/(map-sdk|geocode|convert|analyses|outings\/routes)/,
    (route) => {
      calls++;
      return route.abort();
    },
  );
  const now = Date.now() - 86400000;
  const book = {
    ...emptyBook(),
    walks: [0, 1, 2].map((i) =>
      finishWalk(
        prepareWalk(
          {
            label: `构造测试步道${i + 1}`,
            meters: 100,
            distanceSource: "measured",
            usual: true,
          },
          1.2,
          [],
          now + i * 1000000,
          `walk-browser-${i}`,
        ),
        125,
        25,
        now + i * 1000000 + 200000,
      ),
    ),
  };
  await page.goto("/");
  await page.evaluate(
    (b) => localStorage.setItem("yike-life-v1", JSON.stringify(b)),
    book,
  );
  await page.reload();
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page.getByRole("button", { name: "出行偏好", exact: true }).click();
  await page
    .getByRole("button", { name: "实走记录与步速校准", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "步速建议" })).toContainText(
    "建议试用 1 米/秒",
  );
  await page.getByLabel("路段简称", { exact: true }).fill("构造后续步道");
  await page.getByLabel("按平时步速走平路", { exact: false }).check();
  await page.getByRole("button", { name: "准备记录，固定预计用时" }).click();
  await expect(page.locator(".walk-form")).toContainText("事先建议预计100秒");
  await page.getByLabel("总用时（秒）", { exact: true }).fill("140");
  await page.getByLabel("其中停留（秒）", { exact: true }).fill("30");
  await page.getByRole("button", { name: "保存这次实走", exact: true }).click();
  await page.getByText("查看预测对照与记录（4）", { exact: true }).click();
  await expect(page.locator(".walk-evidence")).toContainText(
    "事先建议平均误差10秒",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("yike-life-v1")!).preferences.speedMps,
    ),
  ).toBe(1.2);
  await page.getByRole("button", { name: "采用建议步速", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("请重新试算");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出实走验证记录", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(exported.summary.evaluationCount).toBe(1);
  expect(exported.trials).toHaveLength(4);
  expect(exported.limitations.join(" ")).toContain("未经独立核验");
  await page
    .getByRole("button", { name: "排除这条记录", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText("排除原因");
  await page.getByLabel("排除原因", { exact: false }).fill("构造输入误记");
  await page
    .getByRole("button", { name: "排除这条记录", exact: true })
    .first()
    .click();
  await expect(page.locator(".walk-evidence")).toContainText(
    "尚无可对照的后续记录",
  );
  await page.getByRole("button", { name: "恢复这条记录", exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/walk-calibration-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.screenshot({
    path: "test-results/walk-calibration-desktop.png",
    fullPage: true,
  });
  const reset = page.getByRole("button", {
    name: "已备份，清空实走记录",
    exact: true,
  });
  await expect(reset).toBeDisabled();
  await page
    .getByRole("button", { name: "导出实走验证记录", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await reset.click();
  await expect(page.locator(".walk-records > li")).toHaveCount(4);
  page.once("dialog", (dialog) => dialog.accept());
  await reset.click();
  await expect(page.locator(".walk-records > li")).toHaveCount(0);
  await page.getByRole("button", { name: "返回出行偏好", exact: true }).click();
  await expect(page.getByLabel("个人步速", { exact: true })).toHaveValue("1");
  expect(calls).toBe(0);
  expect(errors).toEqual([]);
});

test("walk save failure keeps the entered seconds and existing pending record", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page.getByRole("button", { name: "出行偏好", exact: true }).click();
  await page
    .getByRole("button", { name: "实走记录与步速校准", exact: true })
    .click();
  await page.getByLabel("距离来源", { exact: true }).selectOption("demo");
  await page.getByRole("button", { name: "准备记录，固定预计用时" }).click();
  await page.getByLabel("总用时（秒）", { exact: true }).fill("125");
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "保存这次实走", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("存储已满");
  await expect(page.getByLabel("总用时（秒）", { exact: true })).toHaveValue(
    "125",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("yike-life-v1")!).walks[0].completedAt,
    ),
  ).toBeNull();
});
