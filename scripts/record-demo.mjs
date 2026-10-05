import { mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import { createApp } from "../dist/server/server/app.js";
import { parseResultFile } from "../dist/server/shared/result-file.js";

// Recording always uses a separate server with no real service credentials.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");
const server = createApp({ PORT: "8790" });
server.listen(8790, "127.0.0.1");
await once(server, "listening");
await mkdir("materials", { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
    recordVideo: { dir: ".cache/video", size: { width: 1360, height: 1000 } },
  });
  const page = await context.newPage();
  const errors = [];
  let analyses = 0;
  let realRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/analyses"))
      analyses++;
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.startsWith("/api/map-sdk/") ||
      /^\/api\/(geocode|convert)$/.test(url.pathname) ||
      (url.pathname === "/api/analyses" &&
        route.request().postDataJSON()?.mode === "baidu")
    ) {
      realRequests++;
      return route.abort();
    }
    return url.hostname === "127.0.0.1" || url.protocol === "data:"
      ? route.continue()
      : route.abort();
  });
  const caption = async (title, detail, ms = 4300) => {
    await page.evaluate(
      ({ title, detail }) => {
        let box = document.getElementById("recording-caption");
        if (!box) {
          box = document.createElement("div");
          box.id = "recording-caption";
          box.style.cssText =
            "position:fixed;z-index:100000;bottom:20px;right:40px;width:640px;padding:16px 22px;background:#123e38f5;border-left:4px solid #cf7647;color:white;font:15px/1.8 'Microsoft YaHei',sans-serif;box-shadow:0 4px 18px #0002;pointer-events:none";
          document.body.appendChild(box);
        }
        box.replaceChildren();
        const heading = document.createElement("strong");
        heading.textContent = title;
        heading.style.cssText =
          "font-size:19px;display:block;margin-bottom:3px";
        const description = document.createElement("div");
        description.textContent = detail;
        box.append(heading, description);
      },
      { title, detail },
    );
    await page.waitForTimeout(ms);
  };
  await page.goto("http://127.0.0.1:8790");
  await caption(
    "一刻烟火 · 增强版操作演示",
    "15分钟生活圈智能体检与规划助手。本片使用模拟道路和设施，无真实社区结论。",
    5500,
  );
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await page.locator(".map-legend").waitFor();
  await caption(
    "01  从一个起点开始",
    "沿模拟道路计算步行时间，生成5、10、15分钟近似可达范围。",
    5000,
  );
  for (const minutes of [5, 10, 15]) {
    await page
      .getByRole("group", { name: "查看步行时长" })
      .getByRole("button", { name: `${minutes} 分钟`, exact: true })
      .click();
    await caption(
      `02  查看${minutes}分钟范围`,
      "切换时长复用已计算的路线，不重复发起分析。",
      2800,
    );
  }
  if (analyses !== 1)
    throw new Error("Unexpected repeated analysis during local filtering");
  await page.getByLabel("显示设施覆盖核查点").check();
  await caption(
    "03  标记需要核查的位置",
    "灰色网格提示采样点周边，按类别区分未检索到与数据不足，不代表精确缺口面积。",
    5000,
  );
  await page
    .locator(".category-option")
    .filter({ hasText: "药店" })
    .getByRole("checkbox")
    .uncheck();
  await caption(
    "04  按生活设施筛选",
    "菜市场、药店、小学、医疗、公园与养老，共六类设施。",
    4300,
  );
  await page
    .locator(".category-option")
    .filter({ hasText: "药店" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "体检报告", exact: true }).click();
  await caption(
    "05  阅读体检报告",
    "条形图呈现六类设施的步行时段，覆盖图表区分已有设施、候选缺口与数据不足。",
    5000,
  );
  await page.evaluate(() => scrollTo({ top: 650, behavior: "smooth" }));
  await caption(
    "让结论可以复核",
    "查看设施覆盖核查、提示与调用统计，再安排现场确认。",
    4300,
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  await (await downloaded).saveAs(".cache/video-export.json");
  await caption(
    "06  导出数据与打印报告",
    "JSON保留结构化结果；打印视图可用于保存和交流。",
    4500,
  );
  await page.getByRole("button", { name: "地图", exact: true }).click();
  await page.getByLabel("选择一个起点").selectOption("1");
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await page.locator(".map-legend").waitFor();
  await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
  await caption(
    "07  换到河畔，再看一次",
    "道路与桥梁会改变步行范围。画面仍为人工构造的对照场景。",
    5500,
  );
  const saved = await readFile(".cache/live-result.json", "utf8").catch(
    () => null,
  );
  if (saved) {
    const report = parseResultFile(saved);
    await page.getByText("保存与打开结果", { exact: true }).click();
    await page.locator("#result-import").setInputFiles({
      name: "shanghai-result.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(report)),
    });
    await page.getByRole("article").waitFor();
    await page.getByText("保存与打开结果", { exact: true }).click();
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await caption(
      "08  打开上海已保存的体检",
      "现在是2026年10月5日的百度接口历史结果；回放不重新检索或测时，入口尚未现场核验。",
      6500,
    );
    await page.locator(".coverage-chart").scrollIntoViewIfNeeded();
    await caption(
      "检索状态与覆盖证据分别呈现",
      "已返回设施可支持样点覆盖；六类检索均未取全，不能声称完成设施普查。",
      5500,
    );
    await page.getByRole("button", { name: "地图", exact: true }).click();
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await caption(
      "结果也可以离线查看",
      "此处为原坐标和轮廓示意，不含道路底图。仅在主动加载真实底图时请求地图资源。",
      5500,
    );
  }
  await caption(
    "按证据继续改进",
    "24点API对照中，15分钟加密轮廓一致率95.8%；5分钟仍有误差。入口和设施需继续现场核验。",
    6500,
  );
  if (realRequests)
    throw new Error("Unexpected real-service request while recording");
  if (errors.length) throw new Error("Browser errors while recording");
  const video = page.video();
  await context.close();
  await video.saveAs("materials/yike-yanhuo-demo.webm");
  console.log(
    "Recorded materials/yike-yanhuo-demo.webm with no real API calls; saved Shanghai replay is included when available.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  server.close();
}
