import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");
const dir = ".cache/submission-v4-cards";
await mkdir(dir, { recursive: true });
const voice = JSON.parse(
  await readFile(".cache/submission-v4-voice/manifest.json", "utf8"),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 800 },
  recordVideo: { dir, size: { width: 1600, height: 800 } },
});
const p = await context.newPage();
let start = Date.now();
const scenes = [];
const logo =
  "data:image/png;base64," +
  (await readFile("materials/wechat-avatar-v8-512.png")).toString("base64");
for (const id of ["title", "finish"]) {
  const s = Date.now() - start;
  const body =
    id === "title"
      ? `<div style="display:flex;gap:60px;align-items:center"><div style="flex:1"><h2 style="font-size:34px;color:#176c60;font-weight:500">15 分钟生活圈<br>智能体检与规划助手</h2><p style="font-size:25px;line-height:1.8">社区体检 · 个人出门 · 家人协助</p><p style="font-size:23px">参赛赛道：开源 AI 工具赛道</p></div><img src="${logo}" style="width:290px;border-radius:30px"></div><div style="padding:23px;background:#edf4ef;border-radius:12px;font-size:22px;line-height:1.6;margin-top:35px">企业赛题：【开源 AI 工具赛道】百度地图赛题：基于地图开放能力的“15 分钟生活圈”智能体检与规划助手</div>`
      : `<p style="font-size:37px;color:#176c60;margin:45px 0">沿道路看见生活，让每一步更有把握。</p><div style="background:#edf4ef;padding:35px;border-radius:14px;font-size:29px;line-height:1.8">真实地图体检 → 有依据的规划 → 本人确认的协助<br>完整可运行源码 · MIT许可 · Web与微信原生</div><p style="font-size:24px;margin-top:40px">代码仓库、完整文档与复现入口见作品提交材料。</p>`;
  await p.setContent(
    `<main style="height:800px;box-sizing:border-box;background:#fffdf7;color:#183b3b;padding:48px 78px;font-family:'Microsoft YaHei'"><div style="font-size:18px;color:#a3613e;letter-spacing:2px">2026 上海开源软件应用创新大赛 · 百度地图企业赛题</div><h1 style="font-size:43px;margin:18px 0 28px">一刻烟火</h1>${body}<div style="position:absolute;bottom:22px;left:78px;right:78px;font-size:17px;color:#657b79">${id === "title" ? "本轮真实上海地图API ＋ 构造场景演练 ＋ 原生页面留档，各段分别标明。" : "实际入口、开放与通行状态仍需现场核验。"}</div></main>`,
  );
  await p.waitForTimeout(
    voice.find((v) => v.id === id).duration * 1000 + 0.5 * 1000,
  );
  scenes.push({ id, start: s, end: Date.now() - start });
  await p.screenshot({ path: `materials/submission-v4-assets/${id}.png` });
  console.log("Recorded public " + id);
}
await context.close();
await p.video().saveAs(".cache/submission-v4-cards.webm");
await browser.close();
await writeFile(
  "materials/submission-v4-cards-timeline.json",
  JSON.stringify(
    { video: ".cache/submission-v4-cards.webm", scenes },
    null,
    2,
  ) + "\n",
);
