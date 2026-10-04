import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

if (!process.argv.includes("--run")) {
  console.log(
    "手动底图联调：先启动本地服务，再执行 node --env-file=.env scripts/map-check.mjs --run。",
  );
  process.exit(0);
}
const secrets = [
  process.env.BAIDU_BROWSER_AK,
  process.env.BAIDU_SERVER_AK,
].filter(Boolean);
if (secrets.length !== 2) {
  console.error("请先配置两种本地 AK。");
  process.exit(1);
}
const containsSecret = (value) =>
  secrets.some(
    (secret) =>
      value.includes(secret) || value.includes(encodeURIComponent(secret)),
  );
const sanitized = (value) =>
  secrets
    .reduce(
      (text, secret) =>
        text
          .replaceAll(secret, "[REDACTED]")
          .replaceAll(encodeURIComponent(secret), "[REDACTED]"),
      String(value),
    )
    .slice(0, 700);
const evidence = {
  timestamp: new Date().toISOString(),
  status: "running",
  resourceCap: 30,
  mapRequests: 0,
  cappedRequests: 0,
  blockedAnalysisRequests: 0,
  credentialDetected: false,
  pageErrors: 0,
  pageErrorMessages: [],
  dialogs: 0,
  dialogMessages: [],
  failedResources: [],
  externalHosts: [],
  note: "本轮只检查指定上海测试坐标的底图加载，不调用地理编码、地点检索或步行分析，不作社区结论。",
};
const bodies = [];
const hosts = new Set();
let browser;
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  page.on("pageerror", (error) => {
    evidence.pageErrors++;
    evidence.pageErrorMessages.push(sanitized(error.message));
  });
  page.on("dialog", async (dialog) => {
    evidence.dialogs++;
    evidence.dialogMessages.push(sanitized(dialog.message()));
    await dialog.dismiss();
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      containsSecret(
        request.url() +
          JSON.stringify(request.headers()) +
          (request.postData() ?? ""),
      )
    ) {
      evidence.credentialDetected = true;
      return route.abort();
    }
    if (/^\/api\/(analyses|geocode|convert)/.test(url.pathname)) {
      evidence.blockedAnalysisRequests++;
      return route.abort();
    }
    if (
      url.origin === "http://127.0.0.1:8787" &&
      url.pathname.startsWith("/api/map-sdk/")
    ) {
      if (evidence.mapRequests >= evidence.resourceCap) {
        evidence.cappedRequests++;
        return route.abort();
      }
      evidence.mapRequests++;
    } else if (
      url.protocol.startsWith("http") &&
      url.hostname !== "127.0.0.1"
    ) {
      hosts.add(url.hostname);
    }
    return route.continue();
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (containsSecret(response.url())) {
      evidence.credentialDetected = true;
      return;
    }
    if (response.status() >= 400)
      evidence.failedResources.push({
        host: url.hostname,
        path: url.pathname,
        status: response.status(),
      });
    if (
      url.hostname === "127.0.0.1" &&
      /javascript|json|html/.test(response.headers()["content-type"] ?? "")
    ) {
      bodies.push(
        response
          .body()
          .then((buffer) => {
            if (secrets.some((secret) => buffer.includes(Buffer.from(secret))))
              evidence.credentialDetected = true;
          })
          .catch(() => {}),
      );
    }
  });
  await page.goto("http://127.0.0.1:8787");
  await page.getByRole("button", { name: "百度地图", exact: true }).click();
  await page.getByText("直接输入地图坐标", { exact: true }).click();
  await page.getByLabel("经度", { exact: true }).fill("121.5");
  await page.getByLabel("纬度", { exact: true }).fill("31.2");
  await page.getByRole("button", { name: "使用这个点", exact: true }).click();
  await page
    .locator(".baidu-stage .map-zoom")
    .waitFor({ state: "visible", timeout: 25000 });
  await page.waitForTimeout(4000);
  evidence.sdkReady = await page.evaluate(() => Boolean(window.BMap));
  evidence.canvasCount = await page.locator(".baidu-canvas canvas").count();
  evidence.credentialDetected ||= containsSecret(await page.content());
  evidence.status =
    evidence.credentialDetected ||
    evidence.pageErrors ||
    evidence.failedResources.length ||
    evidence.cappedRequests ||
    !evidence.canvasCount
      ? "needs_review"
      : "passed";
  await mkdir(".cache", { recursive: true });
  if (!evidence.credentialDetected)
    await page.screenshot({ path: ".cache/map-check.png", fullPage: true });
} catch {
  evidence.status = "failed";
  evidence.reason = "底图未在25秒内完成加载，请结合无密钥资源状态检查。";
  process.exitCode = 1;
} finally {
  await Promise.allSettled(bodies);
  if (evidence.credentialDetected) evidence.status = "failed";
  if (evidence.status !== "passed") process.exitCode = 1;
  evidence.externalHosts = [...hosts];
  await browser?.close();
  await mkdir(".cache", { recursive: true });
  await writeFile(
    ".cache/map-check.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
}
