import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("multi-condition siting is offline, source-bound, readable on narrow screens and independently replayable", async ({
  page,
}, info) => {
  const errors: string[] = [],
    external: string[] = [];
  let analyses = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:8788")) external.push(r.url());
    if (r.method() === "POST" && r.url().endsWith("/api/analyses")) analyses++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page.getByText("比较设施补点方案", { exact: true }).click();
  const parent = page.getByRole("region", {
    name: "设施补点方案比较",
    exact: true,
  });
  for (let slot = 1; slot <= 3; slot++)
    await parent
      .getByLabel(`候选位置${slot}${slot > 1 ? "（选填）" : ""}`, {
        exact: true,
      })
      .selectOption({ index: slot });
  await parent.getByRole("button", { name: "比较所选方案" }).click();
  await parent.getByText("换种走法，方案还合适吗？", { exact: true }).click();
  const panel = page.getByRole("region", {
    name: "补点多条件检查",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "检查三种条件", exact: true })
    .click();
  await expect(panel.getByRole("img")).toHaveAccessibleName(
    "三组条件共同补足与条件相关范围示意",
  );
  await expect(panel).toContainText("构造情景 · 非真实社区");
  await panel
    .getByRole("button", { name: "检查方案 A + B", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出多条件检查依据" }).click();
  const path = info.outputPath("conditions.json");
  await (await download).saveAs(path);
  const raw = JSON.parse(await readFile(path, "utf8"));
  expect(raw.comparison.plans).toHaveLength(7);
  const replay = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/replay-planning-evidence.ts", path],
      { encoding: "utf8" },
    ),
  );
  expect(replay.externalApiCalls).toBe(0);
  expect(replay.verifiedPlans).toBe(7);
  expect(replay.maxErrorSquareMeters).toBeLessThan(0.001);
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: info.outputPath(`conditions-${width}.png`),
    });
  }
  await panel.getByText("调整比较条件", { exact: true }).click();
  await panel.getByLabel("检查用步速（米/秒）", { exact: true }).fill("0.8");
  await expect(panel.locator(".siting-conditions-result")).toHaveCount(0);
  await panel.getByRole("button", { name: "检查三种条件" }).click();
  await expect(panel.locator(".siting-conditions-result")).toHaveCount(1);
  await parent
    .getByLabel("候选位置2（选填）", { exact: true })
    .selectOption({ index: 4 });
  await expect(
    page.getByRole("region", { name: "补点多条件检查" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(analyses).toBe(1);
});

test("detour diagnosis exposes measured evidence, exports all candidates and does not request routes", async ({
  page,
}, info) => {
  const external: string[] = [];
  let analyses = 0;
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:8788")) external.push(r.url());
    if (r.method() === "POST" && r.url().endsWith("/api/analyses")) analyses++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page.getByText("看起来很近，为什么要走更远？", { exact: true }).click();
  const panel = page.getByRole("region", { name: "绕行代价诊断" });
  await expect(panel).toContainText("构造路网 · 非真实社区");
  await expect(panel.locator("article").first()).toContainText("直线");
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出绕行核查依据" }).click();
  const path = info.outputPath("detour.json");
  await (await download).saveAs(path);
  const replay = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/replay-planning-evidence.ts", path],
      { encoding: "utf8" },
    ),
  );
  expect(replay.externalApiCalls).toBe(0);
  expect(replay.hotspots).toBeGreaterThan(0);
  await panel.getByText("未纳入的点与判定口径", { exact: true }).click();
  await expect(panel).toContainText("1.5倍");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({ path: info.outputPath(`detour-${width}.png`) });
  }
  expect(external).toEqual([]);
  expect(analyses).toBe(1);
});
