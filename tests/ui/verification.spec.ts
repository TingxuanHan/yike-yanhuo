import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("backup quota failure preserves the pending result and a saved pair survives a full browser reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__failVerificationStore = true;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key === "yike-last-verification" &&
        (window as any).__failVerificationStore
      )
        throw new DOMException("Full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page.getByText("补齐缺失数据", { exact: true }).click();
  const panel = page.getByRole("region", { name: "定向补核查", exact: true });
  await panel.getByRole("button", { name: "体验模拟缺测" }).click();
  await panel
    .getByRole("checkbox", { name: /补取步行测时/ })
    .first()
    .check();
  await panel.getByRole("button", { name: "查看补查用量" }).click();
  await panel.getByRole("button", { name: "确认执行所选任务" }).click();
  await expect(
    panel.getByRole("button", { name: "采用补查结果" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "采用补查结果" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "未采用结果，原报告保留",
  );
  await expect(
    panel.getByRole("button", { name: "采用补查结果" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "恢复补查前报告" }),
  ).toHaveCount(0);
  await page.evaluate(() => ((window as any).__failVerificationStore = false));
  await panel.getByRole("button", { name: "采用补查结果" }).click();
  const id = await page.evaluate(
    () => JSON.parse(localStorage.getItem("yike-last-verification")!).after.id,
  );
  await page.reload();
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page.getByText("补齐缺失数据", { exact: true }).click();
  await panel.getByRole("button", { name: "打开最近补查记录" }).click();
  await expect(
    panel.getByRole("button", { name: "恢复补查前报告" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("yike-last-verification")!).after.id,
    ),
  ).toBe(id);
});

test("targeted verification previews, retains source until adoption, exports both reports and reopens the persisted pair", async ({
  page,
}, info) => {
  const external: string[] = [],
    errors: string[] = [];
  let starts = 0;
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:8788")) external.push(r.url());
    if (r.method() === "POST" && r.url().endsWith("/api/verification"))
      starts++;
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新体检", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("显示设施覆盖核查点").check();
  await page.getByText("补齐缺失数据", { exact: true }).click();
  const panel = page.getByRole("region", { name: "定向补核查", exact: true });
  await panel
    .getByRole("button", { name: "体验模拟缺测", exact: true })
    .click();
  await panel
    .getByRole("checkbox", { name: /补取步行测时/ })
    .first()
    .check();
  await panel
    .getByRole("checkbox", { name: /局部补查小学/ })
    .first()
    .check();
  await panel.getByRole("button", { name: "查看补查用量" }).click();
  await expect(
    panel.getByText("模拟演练，不消耗百度额度", { exact: true }),
  ).toBeVisible();
  expect(starts).toBe(0);
  await panel.getByRole("button", { name: "确认执行所选任务" }).click();
  await expect(
    panel.getByRole("button", { name: "采用补查结果" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出补查前后依据" }).click();
  const path = info.outputPath("verification-evidence.json");
  await (await download).saveAs(path);
  const evidence = JSON.parse(await readFile(path, "utf8"));
  expect(evidence.schema).toBe("yike-targeted-verification-v1");
  const replay = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/replay-verification.ts", path],
      { encoding: "utf8" },
    ),
  );
  expect(replay.verifiedReports).toBe(2);
  expect(replay.externalApiCalls).toBe(0);
  expect(replay.maxConservationErrorSquareMeters).toBeLessThan(0.001);
  expect(evidence.before.quality.knownSamples + 1).toBe(
    evidence.after.quality.knownSamples,
  );
  expect(evidence.after.verification.sourceId).toBe(evidence.before.id);
  expect(evidence.after.complete.school).toBe(false);
  expect(evidence.after.localSearches).toHaveLength(1);
  expect(
    await page.evaluate(() => localStorage.getItem("yike-last-verification")),
  ).toBeNull();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.locator(".verification-diff").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel
      .locator(".verification-diff")
      .screenshot({ path: info.outputPath(`verification-${width}.png`) });
  }
  await panel.getByRole("button", { name: "采用补查结果" }).click();
  await expect(
    panel.getByRole("button", { name: "恢复补查前报告" }),
  ).toBeVisible();
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("yike-last-verification"),
      ))!,
    ).after.id,
  ).toBe(evidence.after.id);
  await panel.getByRole("button", { name: "恢复补查前报告" }).click();
  await expect(
    panel.getByRole("button", { name: "恢复补查前报告" }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "打开最近补查记录" }).click();
  await expect(
    panel.getByRole("button", { name: "恢复补查前报告" }),
  ).toBeVisible();
  expect(starts).toBe(1);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
