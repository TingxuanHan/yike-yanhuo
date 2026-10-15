import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import { createApp } from "../dist/server/server/app.js";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");

// Isolated, keyless recording. Editorial cards are explicitly labelled.
const fast = process.env.REHEARSAL_FAST === "1";
const story = JSON.parse(await readFile("docs/submission-video.json", "utf8"));
const voice = JSON.parse(
  (await readFile(".cache/submission-voice/manifest.json", "utf8")).replace(
    /^\uFEFF/,
    "",
  ),
);
const app = createApp({
  HOST: "127.0.0.1",
  PORT: "8790",
  PERSONAL_DATA_PATH: ":memory:",
  AI_DATA_PATH: ".cache/submission-ai.sqlite",
  BAIDU_SERVER_AK: "",
  BAIDU_BROWSER_AK: "",
});
app.listen(8790, "127.0.0.1");
await once(app, "listening");
const base = "http://127.0.0.1:8790";
await mkdir(".cache/submission-video", { recursive: true });
await mkdir("materials/submission-assets", { recursive: true });
const dataImage = async (path) =>
  "data:image/png;base64," + (await readFile(path)).toString("base64");
const picture = (src, style = "") => `<img src="${src}" style="${style}"/>`;
let browser;
const timeline = [],
  errors = [];
let blockedRequests = 0;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 800 },
    recordVideo: {
      dir: ".cache/submission-video",
      size: { width: 1600, height: 800 },
    },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const r = route.request(),
      u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:")
      return route.continue();
    if (
      u.hostname !== "127.0.0.1" ||
      /\/api\/(outings\/|geocode|convert|map-sdk\/)/.test(u.pathname) ||
      (r.method() === "POST" && /\/api\/ai\/(parse|voice$)/.test(u.pathname)) ||
      (r.method() === "POST" &&
        u.pathname === "/api/analyses" &&
        r.postDataJSON()?.mode === "baidu")
    ) {
      blockedRequests++;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(18000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const started = Date.now();
  const sleep = async (ms) => page.waitForTimeout(fast ? 80 : ms);
  const card = async (eyebrow, title, body, note = "") =>
    page.evaluate(
      ({ eyebrow, title, body, note }) => {
        const box = document.createElement("section");
        box.id = "submission-editorial-card";
        box.style.cssText =
          "position:fixed;inset:0;z-index:999999;background:#fffdf7;color:#183b3b;padding:48px 80px;box-sizing:border-box;font-family:'Microsoft YaHei',sans-serif;overflow:hidden";
        box.innerHTML = `<div style="font-size:19px;color:#a3613e;letter-spacing:2px;margin-bottom:16px">${eyebrow}</div><h1 style="font-size:43px;margin:0 0 30px;line-height:1.3">${title}</h1><div style="font-size:25px;line-height:1.65">${body}</div><div style="position:absolute;bottom:24px;left:80px;right:80px;font-size:17px;color:#657b79">${note}</div>`;
        document.body.append(box);
      },
      { eyebrow, title, body, note },
    );
  const scene = async (id, action) => {
    const entry = story.scenes.find((s) => s.id === id);
    assert.ok(entry, id);
    const speech = voice.find((s) => s.id === id);
    const start = Date.now() - started;
    await page.evaluate(() =>
      document.getElementById("submission-editorial-card")?.remove(),
    );
    await action();
    const elapsed = Date.now() - started - start;
    await sleep(Math.max(500, speech.duration * 1000 - elapsed));
    const end = Date.now() - started;
    timeline.push({ id, title: entry.title, start, end });
    await page.screenshot({ path: `.cache/submission-video/${id}.png` });
    console.log(
      `Recorded ${timeline.length}/${story.scenes.length}: ${id} (${((end - start) / 1000).toFixed(1)}s)`,
    );
  };
  await page.goto(base);
  await scene("title", async () => {
    const logo = await dataImage("materials/wechat-avatar-v8-512.png");
    await card(
      "2026 上海开源软件应用创新大赛 · 百度地图企业赛题",
      "一刻烟火",
      `<div style="display:flex;gap:70px;align-items:center"><div style="flex:1"><p style="font-size:38px;margin-top:0">从社区体检，到一趟安心出门</p><p>沿着道路理解生活圈<br>把时间、预算和通行需要放进同一趟安排<br>遇到问题，自己选，也能请家人帮忙</p><div style="margin-top:36px;font-size:22px;color:#176c60">Web ＋ 微信原生小程序 · MIT 许可</div></div>${picture(logo, "width:330px;height:330px;object-fit:contain;border-radius:40px")}</div>`,
      "视频包含实际界面操作、构造场景、历史接口回放；各段分别说明证据来源。2026.10.16",
    );
  });
  await scene("home", async () => {
    await page.evaluate(() => scrollTo(0, 0));
  });
  await scene("community", async () => {
    await page.goto(base + "/?showcase=1");
    await page
      .getByRole("button", { name: "体验模拟社区", exact: true })
      .click();
    await page.locator(".result-strip").waitFor();
    await page
      .locator(".map-container")
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
  });
  await scene("duration", async () => {
    for (const minutes of [5, 10, 15]) {
      await page
        .getByRole("group", { name: "查看步行时长" })
        .getByRole("button", { name: `${minutes} 分钟`, exact: true })
        .click();
      await page
        .locator(".map-container")
        .evaluate((element) => element.scrollIntoView({ block: "center" }));
      await sleep(3200);
    }
  });
  await scene("coverage", async () => {
    await page
      .getByRole("button", { name: "2. 查设施缺口", exact: true })
      .click();
    await page.locator("#coverage-inspector").scrollIntoViewIfNeeded();
    await sleep(3500);
    await page.getByLabel("核查类别", { exact: true }).selectOption("pharmacy");
  });
  await scene("report", async () => {
    await page
      .getByRole("button", { name: "3. 阅读与导出报告", exact: true })
      .click();
    await page.locator("article").first().scrollIntoViewIfNeeded();
    await sleep(5500);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出数据", exact: true }).click();
    await (await download).saveAs(".cache/submission-video/demo-report.json");
  });
  await scene("algorithm", async () => {
    await card(
      "技术说明 · 与实际源码和实验一致",
      "把有限调用，用在时间边界上",
      `<div style="display:flex;gap:22px;margin:32px 0">${["① 粗网格测时<br><small>81 个初始网格点</small>", "② 预算内两轮加密<br><small>复用相邻三角形共享边</small>", "③ 阈值裁切与融合<br><small>保留孔洞、未知和边界限制</small>"].map((s) => `<div style="flex:1;padding:30px 22px;background:#edf4ef;border-top:4px solid #176c60;border-radius:8px;font-size:26px">${s}</div>`).join("")}</div><p style="margin-top:46px">同一组测时 → 5 / 10 / 15 分钟范围 → 设施核查 → 可导出报告</p><p style="font-size:22px;color:#657b79">采样加密并不保证每个阈值都更准。独立测试点保留误判计数。</p>`,
      "技术贡献是预算、采样拓扑与证据链的组合；不主张发明等时圈或取代专业地图导航。",
    );
  });
  await scene("comparison", async () => {
    await page
      .getByRole("button", { name: "1. 看步行范围", exact: true })
      .click();
    await page
      .getByRole("group", { name: "结果详情" })
      .getByRole("button", { name: "对比", exact: true })
      .click();
    await page.getByLabel("对比步速（米/秒）").fill("0.6");
    await page.getByRole("button", { name: "比较这两种条件" }).click();
    await page.locator(".comparison-result").scrollIntoViewIfNeeded();
  });
  await scene("trip", async () => {
    await page.goto(base);
    await page.getByRole("button", { name: /我要出门/ }).click();
    await page.getByText("我的通行需要", { exact: true }).click();
    await page.getByLabel("推车出门", { exact: true }).check();
    await page.getByLabel("尽量少走台阶", { exact: true }).check();
    await sleep(3000);
    await page
      .getByRole("button", { name: "核算整趟行程", exact: true })
      .click();
    await page.locator(".trip-plan").first().scrollIntoViewIfNeeded();
  });
  await scene("ai", async () => {
    const v = await dataImage("materials/submission-assets/voice-review.png"),
      q = await dataImage("materials/submission-assets/planning-review.png");
    await card(
      "历史真实接口联调 · 编辑展示原截图",
      "说出来，也要核对清楚",
      `<div style="display:flex;gap:30px;align-items:start"><div style="width:365px;height:470px;overflow:hidden;border:1px solid #cbdcd3;border-radius:12px">${picture(v, "width:365px;transform:translateY(-1680px)")}</div><div style="width:365px;height:470px;overflow:hidden;border:1px solid #cbdcd3;border-radius:12px">${picture(q, "width:365px;transform:translateY(-720px)")}</div><div style="flex:1;padding:15px 0"><h2 style="font-size:29px;margin:0">语音 → 可编辑文字<br>AI → 待确认条件</h2><p>步速、时长、预算、目的地<br>由本人确认后应用</p><p style="font-size:21px;color:#657b79">转写可能出错，保留修正入口。<br>没有让模型编造道路、价格或营业状态。</p></div></div>`,
      "本段展示已保存的在线测试证据；录制过程没有再次调用语音、模型或地图付费接口。",
    );
  });
  let event, observation, neighbor;
  await scene("notice", async () => {
    await page
      .getByRole("button", { name: "按这条安排出门", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "查看剩余路段指引", exact: true })
      .click();
    await page
      .getByRole("button", { name: "查看模拟步骤", exact: true })
      .click();
    assert.ok(
      (
        await context.request.post(base + "/api/life/create", { data: {} })
      ).ok(),
    );
    const active = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("yike-active-trip")),
    );
    const next = active.input.stops.find((n) => n.id === active.remaining[0]);
    observation = {
      state: "present",
      basis: "seen",
      at: Date.now(),
      note: "演示反馈：东门有台阶，西门情况尚未确认。非真实用户报告。",
    };
    event = {
      share: true,
      requestId: "submission_event_0001",
      version: 0,
      target: {
        name: next.name,
        position: next.position,
        detail: { kind: "entrance", label: "东门", side: "east" },
      },
      kind: "steps",
      observation,
    };
    assert.ok(
      (
        await context.request.post(base + "/api/neighborhood/events", {
          data: event,
        })
      ).ok(),
    );
    await page
      .getByRole("button", { name: "邻里提醒 · 查看或补充", exact: true })
      .click();
    neighbor = page.getByRole("region", { name: "邻里提醒", exact: true });
    await neighbor.locator(".neighbor-event").waitFor();
    await neighbor.scrollIntoViewIfNeeded();
  });
  await scene("conflict", async () => {
    const other = await browser.newContext();
    assert.ok(
      (await other.request.post(base + "/api/life/create", { data: {} })).ok(),
    );
    assert.ok(
      (
        await other.request.post(base + "/api/neighborhood/events", {
          data: {
            ...event,
            requestId: "submission_event_0002",
            observation: {
              ...observation,
              note: "演示第二份观察：仍看到东门台阶。",
            },
          },
        })
      ).ok(),
    );
    const list = await (
      await other.request.post(base + "/api/neighborhood/query", {
        data: { target: event.target },
      })
    ).json();
    assert.ok(
      (
        await other.request.post(
          base + "/api/neighborhood/events/" + list.notices[0].id,
          {
            data: {
              share: true,
              requestId: "submission_event_0003",
              version: 1,
              observation: {
                ...observation,
                state: "clear",
                note: "演示相反反馈：认为现在可通行，仍需核实。",
              },
            },
          },
        )
      ).ok(),
    );
    await neighbor
      .getByRole("button", { name: "刷新提醒", exact: true })
      .click();
    await neighbor.getByText("查看反馈依据", { exact: true }).click();
    await other.close();
  });
  await scene("alternative", async () => {
    await neighbor
      .getByRole("button", { name: "为下一站看看备选安排", exact: true })
      .click();
    await page
      .getByRole("button", { name: "比较时间和费用", exact: true })
      .click();
    await page.locator(".trip-alternative-preview").scrollIntoViewIfNeeded();
  });
  await scene("entrance", async () => {
    await page
      .getByRole("button", { name: "用我记录的另一入口", exact: true })
      .click();
    await page
      .getByRole("button", { name: "比较时间和费用", exact: true })
      .click();
    await page.locator(".trip-alternative-preview").scrollIntoViewIfNeeded();
  });
  await scene("card", async () => {
    await page
      .getByRole("button", { name: "确认替换下一站", exact: true })
      .click();
    await page
      .getByRole("button", { name: "准备当前出门卡", exact: true })
      .click();
    await page.locator(".departure-pack").scrollIntoViewIfNeeded();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载离线出门卡", exact: true })
      .click();
    await (await download).saveAs("materials/demo-departure-card.html");
  });
  await scene("family", async () => {
    await page
      .getByRole("region", { name: "家人协助与入口指引", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "发起这趟的远程协助", exact: true })
      .click();
    const link = await page.locator(".assist-link").textContent();
    const helperContext = await browser.newContext();
    const helper = await helperContext.newPage();
    helper.on("pageerror", (e) => errors.push(e.message));
    await helper.goto(link.trim());
    await helper
      .getByLabel("给家人的说明", { exact: true })
      .fill("先在已确认的地点等一下，我帮你核对入口。");
    await helper
      .getByRole("button", { name: "发送建议，等待本人确认" })
      .click();
    await page
      .getByRole("button", { name: "刷新家人的建议", exact: true })
      .click();
    await page.locator(".assist-proposal").waitFor();
    await page.locator(".assist-proposal").scrollIntoViewIfNeeded();
    await sleep(6500);
    await page
      .getByRole("button", { name: "保留我的安排", exact: true })
      .click();
    await page.getByRole("button", { name: "结束协助", exact: true }).click();
    await helperContext.close();
  });
  await scene("wechat", async () => {
    const paths = [
      "docs/images/simple-home-mini.png",
      "docs/images/trip-alternative-mini-entry.png",
      "docs/images/walking-steps-mini.png",
    ];
    const images = await Promise.all(paths.map(dataImage));
    await card(
      "微信开发者工具 · 原生页面实际静帧",
      "一套规则，两个入口",
      `<div style="display:flex;justify-content:center;gap:55px">${images.map((src) => picture(src, "height:490px;width:auto;border:1px solid #cbdcd3;border-radius:20px")).join("")}<div style="width:280px;padding-top:50px"><p>简易首页<br>下一站备选<br>步行指引</p><p style="font-size:22px;color:#657b79">共享核心逻辑与接口<br>配对后同步数据<br>手机新增流程待验收</p></div></div>`,
      "原首页手机预览已由使用者确认；本段不是手机录像，不代表正式上线或全部真机验收通过。",
    );
  });
  await scene("real", async () => {
    const replay = JSON.parse(
      await readFile("docs/validation/baidu-alternative-replay.json", "utf8"),
    );
    await page.evaluate(
      ({ active, guide }) => {
        localStorage.setItem("yike-active-trip", JSON.stringify(active));
        localStorage.setItem("yike-walking-guides", JSON.stringify([guide]));
        localStorage.removeItem("yike-departure-pack");
      },
      { active: replay.preview.active, guide: replay.guide },
    );
    await page.goto(base);
    await page.getByRole("button", { name: /我要出门|继续这趟/ }).click();
    await page
      .getByRole("button", { name: "查看剩余路段指引", exact: true })
      .click();
    await page.locator(".walking-step").waitFor();
    await page.locator(".walking-guide").scrollIntoViewIfNeeded();
    await sleep(5500);
    await page.getByText("查看整段步骤", { exact: true }).click();
  });
  await scene("validation", async () => {
    await card(
      "上海固定点对照 · 同一百度步行接口作参考",
      "15分钟：23 / 24 点判断正确",
      `<div style="display:flex;gap:70px"><div style="flex:1">${[
        ["直线圆", 16, "#cf9977"],
        ["81点粗网格", 22, "#79ab9a"],
        ["133点加密", 23, "#176c60"],
      ]
        .map(
          ([label, n, c]) =>
            `<div style="margin:25px 0;font-size:24px">${label}<div style="display:flex;align-items:center;gap:18px"><div style="height:35px;width:${(n / 24) * 90}%;background:${c};border-radius:4px"></div><strong>${n}</strong></div></div>`,
        )
        .join(
          "",
        )}</div><div style="width:460px;background:#edf4ef;border-radius:12px;padding:30px"><h2 style="font-size:28px;margin:0 0 20px">也保留不足</h2><p>5分钟没有全面改善。<br>第二组固定24点：<br>20 → 21 点判断正确。</p><p style="font-size:21px">这是API参照实验，不是实地步行准确率。地点、营业和入口仍需现场核查。</p></div></div>`,
      "第一组：直线圆、81点粗网格、133点加密；第二组预先固定近端测试点，177点训练轮廓另行验证。完整计数见作品文档。",
    );
  });
  await scene("closing", async () => {
    await card(
      "可运行 · 可复核 · 可持续完善",
      "让附近的生活，更容易抵达",
      `<div style="display:flex;gap:28px;margin:35px 0">${[
        ["184", "业务 / 接口 / 小程序测试"],
        ["34", "浏览器流程测试"],
        ["MIT", "代码许可与贡献规范"],
      ]
        .map(
          ([a, b]) =>
            `<div style="flex:1;background:#edf4ef;border-radius:12px;padding:28px"><strong style="font-size:54px;color:#176c60">${a}</strong><div style="font-size:22px">${b}</div></div>`,
        )
        .join(
          "",
        )}</div><p style="font-size:28px">下一步：实走验证 → 小范围试用 → 完善维护与治理</p><p style="font-size:24px;color:#176c60">github.com/TingxuanHan/yike-yanhuo</p><p style="font-size:21px;color:#657b79">完整源码 · 作品PDF · 运行说明 · 测试与实验记录</p>`,
      "测试与功能基线：09b3027。当前仓库仍按所有者原要求私有，公开或评审访问授权需在提交前落实。",
    );
  });
  assert.equal(timeline.length, story.scenes.length);
  assert.equal(
    blockedRequests,
    0,
    "Recording attempted a forbidden external/API request",
  );
  assert.deepEqual(errors, []);
  const video = page.video();
  await context.close();
  const output = fast
    ? ".cache/submission-fast.webm"
    : ".cache/submission-raw.webm";
  await video.saveAs(output);
  const manifest = {
    createdAt: new Date().toISOString(),
    functionalBaseline: "09b3027",
    source:
      "Headless actual UI recording with explicitly labelled editorial cards",
    blockedRequests,
    browserErrors: errors.length,
    video: output,
    scenes: timeline,
  };
  await writeFile(
    fast
      ? ".cache/submission-fast-timeline.json"
      : "materials/submission-timeline.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ passed: true, ...manifest, scenes: timeline.length }),
  );
} finally {
  await browser?.close();
  app.closeAllConnections();
  await new Promise((resolve) => app.close(resolve));
}
