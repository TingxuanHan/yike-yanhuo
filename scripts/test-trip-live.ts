import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { chromium } from "@playwright/test";
import { createApp } from "../src/server/app.js";
import { requireZeroPrice } from "../src/server/ai-pricing.js";

// Explicit, synthetic-speech smoke test. Each real model request verifies zero pricing.
if (process.env.CONFIRM_FREE_AI_LIVE !== "1")
  throw new Error(
    "Set CONFIRM_FREE_AI_LIVE=1 to run two real free-model requests with a synthetic fixture.",
  );
if (!existsSync(".cache/voice-fixture.wav"))
  throw new Error(
    "Run scripts/generate-voice-fixture.ps1 before this synthetic-speech test.",
  );
const server = createApp(
  {
    ...process.env,
    PORT: "8792",
    HOST: "127.0.0.1",
    PUBLIC_ORIGIN: undefined,
    PERSONAL_DATA_PATH: ":memory:",
    AI_DATA_PATH: ".cache/trip-live-ai.sqlite",
    AI_FREE_LOCAL_LIMITS: "false",
    BAIDU_SERVER_AK: "",
    BAIDU_BROWSER_AK: "",
  },
  undefined,
  undefined,
  async (config, signal) => {
    await requireZeroPrice(config, signal);
    console.log(
      JSON.stringify({
        stage: "official-price-check",
        model: config.model,
        zeroPrice: true,
      }),
    );
  },
);
server.listen(8792, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${resolve(".cache/voice-fixture.wav")}`,
  ],
});
try {
  const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage();
  await context.addInitScript(() =>
    localStorage.setItem("yike-simple-mode", "false"),
  );
  const r = await context.request.post(base + "/api/life/create", { data: {} });
  assert.equal(r.status(), 200);
  let audioCalls = 0,
    textCalls = 0,
    mapCalls = 0;
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/ai/voice") && r.request().method() === "POST") {
      const v = await r.json().catch(() => ({}));
      console.log(
        JSON.stringify({
          stage: "voice-response",
          status: r.status(),
          error: v.error ?? null,
          hasText: typeof v.text === "string",
        }),
      );
    }
  });
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/ai/voice"))
      audioCalls++;
    if (r.url().endsWith("/api/ai/parse")) textCalls++;
    if (
      /\/api\/(outings\/routes|analyses|map-sdk|geocode|convert)/.test(r.url())
    )
      mapCalls++;
  });
  page.on("requestfailed", (r) =>
    console.log(
      JSON.stringify({
        stage: "request-failed",
        path: new URL(r.url()).pathname,
        error: r.failure()?.errorText,
      }),
    ),
  );
  await page.goto(base);
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page
    .getByRole("button", { name: "一趟出门 · 边办事边走走", exact: true })
    .click();
  await page.getByText("用语音说一说", { exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await page.getByRole("button", { name: "结束录音", exact: true }).waitFor();
  await page.waitForTimeout(7300);
  await page.getByRole("button", { name: "结束录音", exact: true }).click();
  const [voiceResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/ai/voice"),
      { timeout: 45000 },
    ),
    page.getByRole("button", { name: "发送录音识别", exact: true }).click(),
  ]);
  assert.equal(
    voiceResponse.status(),
    200,
    JSON.stringify(await voiceResponse.json()),
  );
  await page
    .getByLabel("语音识别文字", { exact: true })
    .waitFor({ timeout: 40000 });
  const transcript = await page
    .getByLabel("语音识别文字", { exact: true })
    .inputValue();
  assert.match(transcript, /三十|30/);
  assert.match(transcript, /四十五|45/);
  await page.screenshot({
    path: ".cache/trip-live-voice-review.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "确认文字，填入需求", exact: true })
    .click();
  await page.getByRole("button", { name: "整理这次修改", exact: true }).click();
  await page.locator(".trip-diff").waitFor({ timeout: 35000 });
  await page.getByRole("button", { name: "确认这些修改", exact: true }).click();
  assert.equal(
    await page.getByLabel("购物预算（元）", { exact: true }).inputValue(),
    "30",
  );
  assert.equal(
    await page.getByLabel("整趟上限（分钟）", { exact: true }).inputValue(),
    "45",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "取药", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page.getByLabel("这一趟要买的商品", { exact: true }).inputValue(),
    "鸡蛋、青菜、纯牛奶",
  );
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page.locator(".trip-plan").first().waitFor();
  await page
    .locator(".trip-plan")
    .first()
    .screenshot({ path: ".cache/trip-live-plan.png" });
  assert.equal(audioCalls, 1);
  assert.equal(textCalls, 1);
  assert.equal(mapCalls, 0);
  console.log(
    JSON.stringify({
      passed: true,
      syntheticTranscript: transcript,
      liveAudioRequests: audioCalls,
      livePlanningRequests: textCalls,
      baiduRequests: mapCalls,
      preservedShoppingList: true,
    }),
  );
} finally {
  await browser.close();
  server.close();
}
