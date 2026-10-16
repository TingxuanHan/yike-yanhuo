import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../dist/server/server/app.js";
import { analyze } from "../dist/server/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../dist/server/core/demo.js";
import { emptyBook } from "../dist/server/shared/life.js";
import {
  prepareWalk,
  finishWalk,
} from "../dist/server/shared/walk-calibration.js";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");
const base = "http://127.0.0.1:8791",
  dir = ".cache/submission-v4-extra";
await mkdir(dir, { recursive: true });
await mkdir("materials/submission-v4-assets", { recursive: true });
const app = createApp({
  HOST: "127.0.0.1",
  PORT: "8791",
  PERSONAL_DATA_PATH: ":memory:",
  AI_DATA_PATH: ":memory:",
  BAIDU_SERVER_AK: "",
  BAIDU_BROWSER_AK: "",
});
app.listen(8791, "127.0.0.1");
await once(app, "listening");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 800 },
  recordVideo: { dir, size: { width: 1600, height: 800 } },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  reducedMotion: "reduce",
});
let prohibited = 0;
await context.route("**/*", (route) => {
  const r = route.request(),
    u = new URL(r.url());
  if (["data:", "blob:"].includes(u.protocol)) return route.continue();
  const voiceInfo = r.method() === "GET" && u.pathname === "/api/ai/voice";
  if (
    u.origin !== base ||
    (!voiceInfo &&
      /\/api\/(map-sdk|geocode|convert|outings\/routes|ai\/parse|ai\/voice)/.test(
        u.pathname,
      ))
  ) {
    prohibited++;
    return route.abort();
  }
  return route.continue();
});
const p = await context.newPage(),
  errors = [],
  scenes = [];
p.setDefaultTimeout(15000);
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => d.accept());
const start = Date.now(),
  story = JSON.parse(await readFile("docs/submission-video-v4.json", "utf8"));
let voices = [];
try {
  voices = JSON.parse(
    await readFile(".cache/submission-v4-voice/manifest.json", "utf8"),
  );
} catch {}
const frame = (l, block = "center") =>
  l.evaluate(
    (e, b) => e.scrollIntoView({ block: b, behavior: "instant" }),
    block,
  );
async function shot(id, task) {
  const s = Date.now() - start;
  await task();
  const sec = voices.find((v) => v.id === id)?.duration ?? 15;
  await p.waitForTimeout(Math.max(1500, sec * 1000 - (Date.now() - start - s)));
  const end = Date.now() - start;
  scenes.push({ id, start: s, end });
  await p.screenshot({ path: `materials/submission-v4-assets/${id}.png` });
  console.log("Recorded extra " + id);
}
async function full() {
  await p.goto(base);
  await p.evaluate(() => {
    localStorage.setItem("yike-simple-mode", "false");
    localStorage.removeItem("yike-active-trip");
  });
  await p.reload();
}
async function life() {
  await full();
  await p.getByRole("button", { name: "我的日常", exact: true }).click();
}
async function outing() {
  await life();
  await p
    .getByRole("button", { name: "出门办事 · 熟路与歇脚", exact: true })
    .click();
}
async function card(title, paths, note) {
  const images = await Promise.all(
    paths.map(
      async (file) =>
        "data:image/png;base64," + (await readFile(file)).toString("base64"),
    ),
  );
  await p.evaluate(
    ({ title, images, note }) => {
      document.body.innerHTML = `<main style="height:800px;box-sizing:border-box;background:#fffdf7;color:#183b3b;padding:38px 70px;font-family:'Microsoft YaHei'"><div style="font-size:19px;color:#a3613e">实际页面留档 · 构造场景</div><h1 style="font-size:39px;margin:15px 0 25px">${title}</h1><div style="display:flex;justify-content:space-evenly;gap:30px;height:555px">${images.map((src) => `<img src="${src}" style="height:100%;max-width:47%;object-fit:contain;border:1px solid #d9e4df;border-radius:12px">`).join("")}</div><p style="font-size:17px;color:#657b79">${note}</p></main>`;
    },
    { title, images, note },
  );
}
try {
  await shot("simple", async () => {
    await p.goto(base);
    await frame(p.locator(".simple-home"), "start");
  });
  await shot("review", async () => {
    await full();
    const report = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
    report.facilities[0].evidence = [
      {
        source: "构造社区台账",
        recordId: "DEMO-01",
        checkedAt: "2020-01-01T00:00:00Z",
        nextReviewAt: "2020-02-01T00:00:00Z",
        status: "confirmed",
        basis: "构造旧记录，用于复核提醒演练",
      },
    ];
    await p.locator(".result-library summary").click();
    await p.locator("#result-import").setInputFiles({
      name: "构造核查报告.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(report)),
    });
    await p.getByRole("button", { name: "体检报告", exact: true }).click();
    await p.getByText("记录或导入核查", { exact: true }).click();
    const panel = p.getByRole("region", { name: "设施核查", exact: true });
    await panel.getByLabel("来源名称", { exact: true }).fill("构造复核台账");
    await panel
      .getByLabel("核查依据", { exact: true })
      .fill("演示：补记入口资料，保留来源与下次核查时间。");
    await frame(panel, "start");
  });
  await shot("placebook", async () => {
    await full();
    await p.locator(".result-library summary").click();
    const report = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
    await p.locator("#result-import").setInputFiles({
      name: "构造街区.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(report)),
    });
    await p.getByRole("button", { name: "我的日常", exact: true }).click();
    await p.getByLabel("地点名称", { exact: true }).fill("巷口修鞋铺（构造）");
    await p.getByLabel("详细地址", { exact: true }).fill("示例街12号");
    await p
      .getByLabel("入口地标", { exact: true })
      .fill("蓝色雨棚下，东侧入口");
    await p
      .getByLabel("出门提醒", { exact: true })
      .fill("入口有一级台阶，建议请家人先核对。");
    await p.getByRole("button", { name: "记住这个地方", exact: true }).click();
    await frame(p.locator(".assist-card"), "start");
  });
  await shot("calibration", async () => {
    const now = Date.now() - 86400000,
      book = {
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
              `walk-film-${i}`,
            ),
            125,
            25,
            now + i * 1000000 + 200000,
          ),
        ),
      };
    await p.evaluate(
      (book) => localStorage.setItem("yike-life-v1", JSON.stringify(book)),
      book,
    );
    await life();
    await p.getByRole("button", { name: "出行偏好", exact: true }).click();
    await p
      .getByRole("button", { name: "实走记录与步速校准", exact: true })
      .click();
    await frame(
      p.getByRole("region", { name: "步速建议", exact: true }),
      "start",
    );
  });
  await shot("familiar", async () => {
    await card(
      "熟路照片与分段歇脚",
      [
        "docs/images/mini-familiar-card.jpg",
        "docs/images/mini-rest-result.jpg",
      ],
      "微信原生页面留档，人工构造路线与休息点；不作为实际无障碍导航。",
    );
  });
  await shot("shopping", async () => {
    await outing();
    await p
      .getByRole("button", { name: "顺路好买 · 按清单与预算安排", exact: true })
      .click();
    await p.getByRole("button", { name: "比较购物方案", exact: true }).click();
    await frame(p.locator(".shopping-receipt").first(), "start");
  });
  await shot("movement", async () => {
    await outing();
    await p
      .getByRole("button", { name: "顺路动一动 · 先看离线示例", exact: true })
      .click();
    await p.getByRole("button", { name: "轻快交替走", exact: true }).click();
    await p
      .getByRole("button", { name: "安排这一趟怎么走", exact: true })
      .click();
    await frame(
      p.getByRole("region", { name: "步行安排结果", exact: true }),
      "start",
    );
  });
  await shot("ai_settings", async () => {
    await life();
    await p
      .getByRole("button", { name: "一句话安排 · AI辅助", exact: true })
      .click();
    await p.getByRole("button", { name: "API设置与额度", exact: true }).click();
    await frame(p.locator(".planning-panel"), "start");
  });
  await shot("location", async () => {
    await full();
    await p.evaluate(() => {
      localStorage.setItem("yike-simple-mode", "true");
      localStorage.setItem(
        "yike-location-record",
        JSON.stringify({
          source: "confirmed",
          name: "构造示例街角",
          at: Date.now() - 600000,
          accuracyM: null,
          position: { system: "gcj02", lng: 121.5, lat: 31.2 },
        }),
      );
    });
    await p.reload();
    await p
      .getByRole("button", { name: "告诉家人我在哪", exact: true })
      .click();
    await frame(p.locator(".position-evidence"), "start");
  });
  await shot("sync", async () => {
    await life();
    await p.getByRole("button", { name: "设备与同步", exact: true }).click();
    await p
      .getByRole("button", { name: "创建私人地点簿", exact: true })
      .click();
    await p.getByRole("button", { name: "同步本机修改", exact: true }).click();
    await p
      .getByRole("button", { name: "读取服务器版本", exact: true })
      .click();
    await frame(p.locator(".sync-preview"), "start");
  });
} finally {
  await context.close();
  await p.video().saveAs(".cache/submission-v4-extra.webm");
  await browser.close();
  app.closeAllConnections();
  await new Promise((r) => app.close(r));
  await writeFile(
    "materials/submission-v4-extra-timeline.json",
    JSON.stringify(
      {
        video: ".cache/submission-v4-extra.webm",
        scenes,
        browserErrors: errors,
        prohibitedRequests: prohibited,
      },
      null,
      2,
    ) + "\n",
  );
}
assert.equal(scenes.length, 10);
assert.deepEqual(errors, []);
assert.equal(prohibited, 0);
