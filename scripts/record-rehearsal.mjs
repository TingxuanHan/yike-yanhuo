import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import { createApp } from "../dist/server/server/app.js";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");

// A separate, keyless service and fresh browser profile keep recording repeatable.
const fast = process.env.REHEARSAL_FAST === "1";
const app = createApp({
  HOST: "127.0.0.1",
  PORT: "8790",
  PERSONAL_DATA_PATH: ":memory:",
  AI_DATA_PATH: ".cache/recording-ai.sqlite",
  BAIDU_SERVER_AK: "",
  BAIDU_BROWSER_AK: "",
});
app.listen(8790, "127.0.0.1");
await once(app, "listening");
const base = "http://127.0.0.1:8790";
await mkdir("materials", { recursive: true });
await mkdir(".cache/video", { recursive: true });
let browser;
const timeline = [],
  errors = [];
let paid = 0;
const stamp = (ms) =>
  new Date(Math.max(0, ms)).toISOString().slice(11, 23).replace(".", ",");
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: ".cache/video", size: { width: 1600, height: 900 } },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const started = Date.now();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
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
      paid++;
      return route.abort();
    }
    return route.continue();
  });
  const caption = async (title, body, seconds = 9) => {
    await page.evaluate(
      ({ title, body }) => {
        let box = document.getElementById("recording-caption");
        if (!box) {
          box = document.createElement("aside");
          box.id = "recording-caption";
          box.style.cssText =
            "position:fixed;z-index:100000;bottom:22px;left:50%;transform:translateX(-50%);width:min(1060px,85vw);box-sizing:border-box;padding:16px 25px;background:#123e38f5;border-left:5px solid #cf7647;color:white;font:19px/1.65 'Microsoft YaHei',sans-serif;box-shadow:0 4px 18px #0002;pointer-events:none";
          document.body.append(box);
        }
        box.replaceChildren();
        const h = document.createElement("strong");
        h.textContent = title;
        h.style.cssText = "font-size:23px;display:block";
        const p = document.createElement("div");
        p.textContent = body;
        box.append(h, p);
      },
      { title, body },
    );
    const start = Date.now() - started;
    await page.waitForTimeout(fast ? 100 : seconds * 1000);
    timeline.push({ start, end: Date.now() - started, title, body });
    console.log(`Recorded scene ${timeline.length}: ${title}`);
  };
  await page.goto(base);
  await caption(
    "一刻烟火 · 从家门口，走进好生活",
    "Web与微信小程序共享计算逻辑。先看社区，再安排一趟出门，遇到问题还能请家人帮忙。",
    9,
  );
  await page.goto(base + "/?showcase=1");
  await page.getByRole("button", { name: "体验模拟社区", exact: true }).click();
  await page.locator(".result-strip").waitFor();
  await page.locator(".map-legend").scrollIntoViewIfNeeded();
  await caption(
    "01  道路决定生活圈",
    "人工构造街区：范围沿道路测时生成，河道和桥梁会改变可达范围。画面不是上海实况。",
    10,
  );
  for (const minutes of [5, 10, 15]) {
    await page
      .getByRole("group", { name: "查看步行时长" })
      .getByRole("button", { name: `${minutes} 分钟`, exact: true })
      .click();
    await caption(
      `${minutes}分钟，能走到哪里`,
      "切换复用已计算路线，不重复发起真实地图请求。",
      3,
    );
  }
  await page
    .getByRole("group", { name: "结果详情" })
    .getByRole("button", { name: "对比", exact: true })
    .click();
  await page.getByLabel("对比步速（米/秒）").fill("0.6");
  await page.getByRole("button", { name: "比较这两种条件" }).click();
  await page.locator(".comparison-result").scrollIntoViewIfNeeded();
  await caption(
    "02  每个人的15分钟不同",
    "同一批路线，换一个步速重新估计。手动等灯条件是情景假设，不是实时信号灯数据。",
    11,
  );
  await page.goto(base);
  await page.getByRole("button", { name: /我要出门/ }).click();
  await page.getByText("我的通行需要", { exact: true }).click();
  await page.getByLabel("推车出门", { exact: true }).check();
  await page.getByLabel("尽量少走台阶", { exact: true }).check();
  await caption(
    "03  简易模式，照顾不同的出门需要",
    "买菜、取药和返程放在同一趟安排；通行偏好用来突出相关反馈，不宣称路线已核验无障碍。",
    10,
  );
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await page.locator(".trip-plan").first().scrollIntoViewIfNeeded();
  await caption(
    "时间与预算一起比较",
    "示例清单按商品规格和已记录价格核算，包含停留与返程。未记录的价格和消费需要另行确认。",
    10,
  );
  await page
    .getByRole("button", { name: "按这条安排出门", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "查看剩余路段指引", exact: true })
    .click();
  await page.getByRole("button", { name: "查看模拟步骤", exact: true }).click();
  assert.ok(
    (await context.request.post(base + "/api/life/create", { data: {} })).ok(),
  );
  const a = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yike-active-trip")),
  );
  const next = a.input.stops.find((n) => n.id === a.remaining[0]);
  const observation = {
    state: "present",
    basis: "seen",
    at: Date.now(),
    note: "演示反馈：东门有台阶，西门情况尚未确认。非真实用户报告。",
  };
  const event = {
    share: true,
    requestId: "recording_event_0001",
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
  const neighbor = page.getByRole("region", { name: "邻里提醒", exact: true });
  await neighbor.locator(".neighbor-event").waitFor();
  await neighbor.scrollIntoViewIfNeeded();
  await caption(
    "04  只说这个入口，不替整个门店下结论",
    "演示反馈明确标出东门、观察时间和证据状态。推车用户会优先看到台阶提醒；没有反馈也不代表一定畅通。",
    12,
  );
  // A second isolated space illustrates conflict handling; it is never presented as a real resident.
  const other = await browser.newContext();
  assert.ok(
    (await other.request.post(base + "/api/life/create", { data: {} })).ok(),
  );
  assert.ok(
    (
      await other.request.post(base + "/api/neighborhood/events", {
        data: {
          ...event,
          requestId: "recording_event_0002",
          observation: {
            ...observation,
            state: "present",
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
            requestId: "recording_event_0003",
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
  await neighbor.getByRole("button", { name: "刷新提醒", exact: true }).click();
  await neighbor.getByText("查看反馈依据", { exact: true }).click();
  await caption(
    "反馈有分歧，就展示分歧",
    "两份构造观察用于演示冲突处理。独立空间不是已验证的独立人数，系统不会把票数包装成可靠概率。",
    10,
  );
  await other.close();
  await neighbor
    .getByRole("button", { name: "为下一站看看备选安排", exact: true })
    .click();
  await page
    .getByRole("button", { name: "比较时间和费用", exact: true })
    .click();
  await page.locator(".trip-alternative-preview").scrollIntoViewIfNeeded();
  await caption(
    "05  遇到问题，先比较备选",
    "换同类地点时，重新算去程与接续路线。超时和缺价直接显示，原安排在确认前保留。",
    12,
  );
  await page
    .getByRole("button", { name: "用我记录的另一入口", exact: true })
    .click();
  await page
    .getByRole("button", { name: "比较时间和费用", exact: true })
    .click();
  await page.locator(".trip-alternative-preview").scrollIntoViewIfNeeded();
  await caption(
    "也可以选择已记录的另一入口",
    "这里使用明确标注的示例入口。真实使用从私人地点簿选择；照片圈点不会被当成入口地图坐标。",
    10,
  );
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
  await caption(
    "06  带着一张出门卡",
    "替换后更新离线卡，保留原行程与价格依据。断网仍能查看已保存资料；未知通行和价格仍需要确认。",
    10,
  );
  await page
    .getByRole("region", { name: "家人协助与入口指引", exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "发起这趟的远程协助", exact: true })
    .click();
  await caption(
    "家人帮忙，也保留本人的决定",
    "协助按本趟授权，可结束；家人的建议需本人确认。此处是本机演示，跨设备协助需要可访问的服务器。",
    10,
  );
  await page.getByRole("button", { name: "结束协助", exact: true }).click();
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
  await caption(
    "07  上海真实API结果回放",
    "抚顺路社区至美城菜市场：去程248米、地图参考232秒，3条指引、18个路线点。已保存回放，不在录制时调用API。",
    12,
  );
  await page.getByText("查看整段步骤", { exact: true }).click();
  await caption(
    "把可验证的结果留下来",
    "本轮共5次真实路线调用，重复查询命中缓存。入口、营业、无障碍与街道通行尚未实走核验。",
    11,
  );
  assert.equal(paid, 0, "Recording attempted an external or paid request");
  assert.deepEqual(errors, []);
  const video = page.video();
  await context.close();
  const path = fast
    ? ".cache/rehearsal-fast.webm"
    : "materials/yike-yanhuo-rehearsal.webm";
  await video.saveAs(path);
  if (!fast) {
    await writeFile(
      "materials/rehearsal-timeline.json",
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          source: "Headless browser UI recording",
          paidRequests: paid,
          scenes: timeline,
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      "materials/rehearsal-subtitles.srt",
      timeline
        .map(
          (t, i) =>
            `${i + 1}\n${stamp(t.start)} --> ${stamp(t.end)}\n${t.title}\n${t.body}\n`,
        )
        .join("\n"),
    );
  }
  console.log(
    JSON.stringify({
      passed: true,
      video: path,
      scenes: timeline.length,
      paidRequests: paid,
      browserErrors: errors.length,
    }),
  );
} finally {
  await browser?.close();
  app.closeAllConnections();
  await new Promise((resolve) => app.close(resolve));
}
