import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("facility siting compares local hypotheses, preserves evidence and clears stale results on edits and context changes", async ({
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
  await page.getByText("比较设施补点方案", { exact: true }).click();
  const panel = page.getByRole("region", {
    name: "设施补点方案比较",
    exact: true,
  });
  await expect(
    panel.getByRole("button", { name: "比较所选方案" }),
  ).toBeDisabled();
  await panel
    .getByLabel("候选位置1", { exact: true })
    .selectOption({ index: 1 });
  await panel
    .getByLabel("候选位置2（选填）", { exact: true })
    .selectOption({ index: 2 });
  await panel.getByRole("button", { name: "比较所选方案" }).click();
  await expect(
    panel.getByRole("button", { name: /方案 A \+ B/ }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /方案 A \+ B/ }).click();
  await expect(panel.getByRole("img")).toHaveAccessibleName(
    "假设补点后 · A + B覆盖分区示意",
  );
  await panel.getByRole("button", { name: "补点前", exact: true }).click();
  await expect(panel.getByRole("img")).toHaveAccessibleName(
    "补点前覆盖分区示意",
  );
  await panel.getByRole("button", { name: "假设补点后", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出补点比较依据" }).click();
  const path = info.outputPath("siting-evidence.json");
  await (await downloaded).saveAs(path);
  const evidence = JSON.parse(await readFile(path, "utf8"));
  expect(evidence.schema).toBe("yike-facility-siting-v1");
  expect(evidence.hypothesisOnly).toBe(true);
  expect(evidence.comparison.scenarios).toHaveLength(3);
  const replay = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/benchmark-facility-siting.ts",
        `--replay=${path}`,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(replay.verifiedScenarios).toBe(3);
  expect(replay.maxAreaErrorSquareMeters).toBeLessThan(0.001);
  expect(
    evidence.report.facilities.some((f: any) => f.id.startsWith("sample:")),
  ).toBe(false);
  const ab = evidence.comparison.scenarios.find((s: any) => s.id === "AB");
  expect(
    Math.abs(
      Object.values(ab.squareMeters).reduce(
        (sum: number, n: any) => sum + n,
        0,
      ) - evidence.comparison.baseline.totalSquareMeters,
    ),
  ).toBeLessThan(0.001);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({ path: info.outputPath(`siting-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.screenshot({ path: info.outputPath("siting-desktop.png") });
  await panel
    .getByLabel("候选位置2（选填）", { exact: true })
    .selectOption({ index: 1 });
  await expect(panel.locator(".siting-result")).toHaveCount(0);
  await panel.getByRole("button", { name: "比较所选方案" }).click();
  await expect(panel.getByRole("alert")).toContainText("候选位置重复");
  await panel
    .getByLabel("候选位置2（选填）", { exact: true })
    .selectOption({ index: 3 });
  await panel.getByRole("button", { name: "比较所选方案" }).click();
  await page.getByLabel("核查类别", { exact: true }).selectOption("pharmacy");
  await page.getByText("比较设施补点方案", { exact: true }).click();
  await expect(panel.locator(".siting-result")).toHaveCount(0);
  await expect(panel.getByLabel("候选位置1", { exact: true })).toHaveValue("");
  expect(analyses).toBe(1);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
