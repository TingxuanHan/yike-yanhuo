import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");
const base = "http://127.0.0.1:8787",
  dir = ".cache/submission-v3-video";
await mkdir(dir, { recursive: true });
await mkdir("materials/submission-v3-evidence", { recursive: true });
const story = JSON.parse(
  await readFile("docs/submission-video-v3.json", "utf8"),
);
const voices = JSON.parse(
  await readFile(".cache/submission-v3-voice/manifest.json", "utf8"),
);
const reuse = process.env.REUSE_SUBMISSION_V3 === "1";
let original;
if (reuse) {
  original = JSON.parse(
    await readFile("materials/submission-v3-timeline.json", "utf8"),
  );
  assert.ok(original.scenes.some((s) => s.id === "analyze"));
  await copyFile(
    ".cache/submission-v3-raw.webm",
    ".cache/submission-v3-first-run.webm",
  );
  await writeFile(
    ".cache/submission-v3-first-run.json",
    JSON.stringify(original, null, 2),
  );
}
const proxyUrl = process.env.HTTPS_PROXY
  ? new URL(process.env.HTTPS_PROXY)
  : null;
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
  ...(proxyUrl
    ? {
        proxy: {
          server: proxyUrl.origin,
          bypass: "127.0.0.1,localhost",
          ...(proxyUrl.username
            ? {
                username: decodeURIComponent(proxyUrl.username),
                password: decodeURIComponent(proxyUrl.password),
              }
            : {}),
        },
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 800 },
  recordVideo: { dir, size: { width: 1600, height: 800 } },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  reducedMotion: "reduce",
});
const errors = [],
  timeline = [],
  api = [];
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
page.on("response", async (r) => {
  const u = new URL(r.url());
  if (
    u.origin === base &&
    /^\/api\/(geocode|analyses|outings)/.test(u.pathname) &&
    r.request().method() === "POST"
  )
    api.push({
      path: u.pathname,
      status: r.status(),
      at: new Date().toISOString(),
    });
});
const start = Date.now();
const frame = async (l, block = "center") =>
  l.evaluate(
    (e, b) => e.scrollIntoView({ behavior: "instant", block: b }),
    block,
  );
const card = async (title, body, note = "") =>
  page.evaluate(
    ({ title, body, note }) => {
      document.getElementById("submission-card")?.remove();
      const e = document.createElement("section");
      e.id = "submission-card";
      e.style.cssText =
        "position:fixed;inset:0;z-index:999999;background:#fffdf7;color:#183b3b;padding:48px 78px;box-sizing:border-box;font-family:'Microsoft YaHei',sans-serif;overflow:hidden";
      e.innerHTML = `<div style="color:#a3613e;font-size:18px;letter-spacing:2px">2026 上海开源软件应用创新大赛</div><h1 style="font-size:43px;margin:18px 0 28px">${title}</h1><div style="font-size:25px;line-height:1.6">${body}</div><div style="position:absolute;bottom:22px;left:78px;right:78px;font-size:17px;color:#657b79">${note}</div>`;
      document.body.append(e);
    },
    { title, body, note },
  );
const dataImage = async (p) =>
  "data:image/png;base64," + (await readFile(p)).toString("base64");
async function scene(id, action) {
  const speech = voices.find((v) => v.id === id),
    entry = story.scenes.find((v) => v.id === id);
  assert.ok(speech && entry);
  await page.evaluate(() =>
    document.getElementById("submission-card")?.remove(),
  );
  const s = Date.now() - start;
  await action();
  await page.waitForTimeout(
    Math.max(800, speech.duration * 1000 - (Date.now() - start - s)),
  );
  const e = Date.now() - start;
  timeline.push({
    id,
    title: entry.title,
    start: s,
    end: e,
    voiceDuration: speech.duration,
  });
  await page.screenshot({ path: `${dir}/${id}.png` });
  await writeFile(
    `${dir}/progress.json`,
    JSON.stringify({ scenes: timeline, browserErrors: errors, api }, null, 2),
  );
  console.log(
    `Recorded ${timeline.length}/${story.scenes.length}: ${id} (${((e - s) / 1000).toFixed(1)}s)`,
  );
}
let quotaBefore, quotaAfter, result;
try {
  await page.goto(base + "/?showcase=1");
  quotaBefore = reuse
    ? original.quotaBefore
    : await (await context.request.get(base + "/api/quota")).json();
  if (!reuse)
    assert.ok(
      quotaBefore.limits.route - quotaBefore.used.route >= 262 &&
        quotaBefore.limits.search - quotaBefore.used.search >= 6,
      "Insufficient remaining budget",
    );
  await scene("title", async () => {
    const logo = await dataImage("materials/wechat-avatar-v8-512.png");
    await card(
      "一刻烟火",
      `<div style="display:flex;gap:45px;align-items:center"><div style="flex:1"><div style="font-size:31px;color:#176c60;margin-bottom:20px">15 分钟生活圈智能体检与规划助手</div><div style="font-size:22px;line-height:1.9">参赛赛道：开源 AI 工具赛道<br>负责人：韩庭轩　单位/学校：南京大学<br>其他团队成员：姜可</div></div><img src="${logo}" style="width:260px;border-radius:30px"></div><div style="font-size:22px;line-height:1.6;margin-top:25px;padding:20px;background:#edf4ef;border-radius:12px">企业赛题：【开源 AI 工具赛道】百度地图赛题：基于地图开放能力的“15 分钟生活圈”智能体检与规划助手</div>`,
      "真实上海社区接口演示 ＋ 日常出行构造场景；各段单独标明。",
    );
  });
  await scene("locate", async () => {
    await page.getByRole("button", { name: "百度地图", exact: true }).click();
    await page
      .getByLabel("社区名称或详细地址")
      .fill("上海市杨浦区抚顺路社区睦邻中心");
    await page.getByRole("button", { name: "定位地址", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector("#address")?.disabled,
    );
    await frame(page.locator(".map-container"));
    await page.waitForTimeout(3500);
  });
  await scene("analyze", async () => {
    if (reuse) {
      result = JSON.parse(
        await readFile(
          "materials/submission-v3-evidence/shanghai-analysis.json",
          "utf8",
        ),
      );
      await page.locator(".result-library summary").click();
      await page
        .locator("#result-import")
        .setInputFiles(
          "materials/submission-v3-evidence/shanghai-analysis.json",
        );
      await page
        .getByRole("button", { name: "加载真实底图", exact: true })
        .click();
      await frame(page.locator(".map-container"));
      await page.waitForTimeout(6500);
      return;
    }
    const response = page.waitForResponse(
      (r) =>
        r.url() === base + "/api/analyses" && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^开始体检/ }).click();
    const res = await response;
    assert.equal(res.status(), 202);
    const { id } = await res.json();
    await page.locator(".result-strip").waitFor({ timeout: 420000 });
    const job = await (
      await context.request.get(base + "/api/analyses/" + id)
    ).json();
    assert.equal(job.status, "done");
    assert.equal(job.result.mode, "baidu");
    result = job.result;
    await writeFile(
      "materials/submission-v3-evidence/shanghai-analysis.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    await frame(page.locator(".map-container"));
    await page.waitForTimeout(3500);
  });
  await scene("range", async () => {
    for (const m of [5, 10, 15]) {
      await page
        .getByRole("group", { name: "查看步行时长" })
        .getByRole("button", { name: `${m} 分钟`, exact: true })
        .click();
      await frame(page.locator(".map-container"));
      await page.waitForTimeout(2500);
    }
  });
  await scene("places", async () => {
    const buttons = page.locator(".facility-list button");
    if (await buttons.count()) await buttons.first().click();
    else {
      const markers = page.locator(".map-container button");
      if (await markers.count()) await markers.first().click();
    }
    await frame(page.locator(".map-container"));
  });
  await scene("coverage", async () => {
    await page
      .getByRole("button", { name: "2. 查设施缺口", exact: true })
      .click();
    await page.getByLabel("核查类别", { exact: true }).selectOption("school");
    await frame(
      page.getByRole("region", { name: "连续覆盖分区", exact: true }),
    );
  });
  await scene("planning", async () => {
    await page.getByText("比较设施补点方案", { exact: true }).click();
    const panel = page.locator(".siting-panel:not(.detour-panel)");
    await frame(panel, "start");
    for (let i = 0; i < 3; i++)
      await panel
        .locator(".siting-inputs select")
        .nth(i)
        .selectOption({ index: i + 1 });
    await panel
      .getByRole("button", { name: "比较所选方案", exact: true })
      .click();
    await frame(panel.locator(".siting-sketch"));
    await page.waitForTimeout(5500);
    await panel.getByText("换种走法，方案还合适吗？", { exact: true }).click();
    await panel
      .getByRole("button", { name: "检查三种条件", exact: true })
      .click();
    await frame(panel.locator(".siting-conditions-result"), "start");
  });
  await scene("personal", async () => {
    await page
      .getByRole("button", { name: "1. 看步行范围", exact: true })
      .click();
    await page
      .getByRole("group", { name: "结果详情" })
      .getByRole("button", { name: "对比", exact: true })
      .click();
    await page.getByLabel("对比步速（米/秒）").fill("0.8");
    await page.getByRole("button", { name: "比较这两种条件" }).click();
    await frame(page.locator(".comparison-result"));
  });
  quotaAfter = await (await context.request.get(base + "/api/quota")).json();
  await scene("daily", async () => {
    assert.ok(
      (
        await context.request.post(base + "/api/life/create", { data: {} })
      ).ok(),
    );
    await page.goto(base);
    await page.getByRole("button", { name: /我要出门/ }).click();
    await page
      .getByRole("button", { name: "核算整趟行程", exact: true })
      .click();
    await frame(page.locator(".trip-plan").first(), "start");
  });
  await scene("family", async () => {
    await page
      .getByRole("button", { name: "按这条安排出门", exact: true })
      .first()
      .click();
    await frame(
      page.getByRole("region", { name: "家人协助与入口指引", exact: true }),
      "start",
    );
    await page
      .getByRole("button", { name: "发起这趟的远程协助", exact: true })
      .click();
    const link = (await page.locator(".assist-link").textContent()).trim();
    const hc = await browser.newContext(),
      helper = await hc.newPage();
    await helper.goto(link);
    await helper
      .getByLabel("给家人的说明", { exact: true })
      .fill("先在已确认的地点等一下，我帮你核对入口。");
    await helper
      .getByRole("button", { name: "发送建议，等待本人确认" })
      .click();
    await page
      .getByRole("button", { name: "刷新家人的建议", exact: true })
      .click();
    await frame(page.locator(".assist-proposal"), "start");
    await hc.close();
  });
  await scene("mini", async () => {
    const paths = [
      "docs/images/simple-home-mini.png",
      "docs/images/trip-mini-result.png",
      "docs/images/family-location-mini.png",
    ];
    const imgs = await Promise.all(paths.map(dataImage));
    await card(
      "微信原生小程序",
      `<div style="display:flex;justify-content:space-around;gap:35px">${imgs.map((src) => `<img src="${src}" style="height:510px;max-width:32%;object-fit:contain;border-radius:14px;border:1px solid #d9e4df">`).join("")}</div>`,
      "开发者工具页面留档；原首页已有使用者手机预览反馈，新增流程仍需逐项手机验收。",
    );
  });
  await scene("finish", async () => {
    await card(
      "一刻烟火",
      `<p style="font-size:34px;color:#176c60">沿道路看见生活，让每一步更有把握。</p><div style="padding:24px;background:#edf4ef;border-radius:12px;font-size:26px">完整可运行源码 · MIT 许可<br><span style="font-size:29px">github.com/TingxuanHan/yike-yanhuo</span></div><div style="margin-top:30px;font-size:22px">开源 AI 工具赛道 · 百度地图企业赛题<br>负责人：韩庭轩 · 南京大学　其他团队成员：姜可</div>`,
      "地图数据来自本次百度API；道路实际通行与入口开放情况需现场核验。",
    );
  });
} finally {
  await context.close();
  const video = page.video();
  if (video) {
    await video.saveAs(".cache/submission-v3-raw.webm");
  }
  await browser.close();
  await writeFile(
    "materials/submission-v3-timeline.json",
    JSON.stringify(
      {
        video: ".cache/submission-v3-raw.webm",
        recordedAt: new Date().toISOString(),
        scenes: timeline,
        browserErrors: errors.length,
        errors,
        blockedRequests: 0,
        api: [...(original?.api ?? []), ...api],
        quotaBefore,
        quotaAfter,
        initialLiveRecording: reuse
          ? {
              video: ".cache/submission-v3-first-run.webm",
              analysis: original.scenes.find((s) => s.id === "analyze"),
            }
          : undefined,
      },
      null,
      2,
    ) + "\n",
  );
}
assert.equal(timeline.length, story.scenes.length);
assert.equal(errors.length, 0);
console.log(
  JSON.stringify({
    scenes: timeline.length,
    browserErrors: errors.length,
    api: api.length,
    usage: result?.usage,
  }),
);
