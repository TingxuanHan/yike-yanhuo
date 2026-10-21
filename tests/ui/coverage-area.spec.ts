import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";

test("continuous coverage changes locally, exports its full basis, and stays readable on small screens", async ({
  page,
}, info) => {
  const errors: string[] = [],
    external: string[] = [];
  let analyses = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/analyses")) analyses++;
    if (!r.url().startsWith("http://127.0.0.1:8788")) external.push(r.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  const panel = page.getByRole("region", { name: "连续覆盖分区", exact: true });
  await expect(panel).toContainText("小学");
  await expect(panel).toContainText("不代表人口覆盖率");
  await page.getByLabel("核查类别", { exact: true }).selectOption("pharmacy");
  await expect(panel).toContainText("药店");
  await page.getByRole("button", { name: "10 分钟", exact: true }).click();
  await expect(panel).toContainText("10分钟范围");
  await panel.getByText("待核查原因与计算依据", { exact: true }).click();
  await expect(panel).toContainText("不包含地图坐标或路网插值误差");
  const downloadPromise = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "导出分区依据", exact: true })
    .click();
  const download = await downloadPromise;
  const path = info.outputPath("coverage-evidence.json");
  await download.saveAs(path);
  const data = JSON.parse(await readFile(path, "utf8"));
  expect(data.schema).toBe("yike-coverage-area-v1");
  expect(data.evidence).toBe("simulation");
  expect(data.partition.category).toBe("pharmacy");
  expect(data.partition.minutes).toBe(10);
  expect(data.report.parameters.gapDistanceMeters).toBe(1000);
  const areas = data.partition.squareMeters;
  expect(
    Math.abs(
      areas.covered +
        areas.missing +
        areas.unknown -
        data.partition.totalSquareMeters,
    ),
  ).toBeLessThan(0.001);
  await panel.getByText("待核查原因与计算依据", { exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 880 });
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({ path: `docs/images/coverage-area-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "docs/images/coverage-area-desktop.png" });
  await page.getByRole("button", { name: "体检报告", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "连续分区面积汇总", exact: true }),
  ).toContainText("15分钟范围");
  expect(analyses).toBe(1);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
