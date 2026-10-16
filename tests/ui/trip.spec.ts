import { test, expect } from "./fixtures.js";
const open = async (page: any) => {
  await page.goto("/");
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page
    .getByRole("button", { name: "一趟出门 · 边办事边走走", exact: true })
    .click();
};
test("unified outing computes locally, records progress and returns to a persisted private trip", async ({
  page,
}) => {
  let paid = 0;
  page.on("request", (r) => {
    if (/\/api\/(ai\/parse|outings\/routes|analyses|map-sdk)/.test(r.url()))
      paid++;
  });
  page.on("dialog", (d) => d.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  await expect(page.locator(".trip-plan").first()).toContainText("清单估价");
  await expect(page.locator(".trip-plan").first()).toContainText(
    "回到里巷中心",
  );
  await page
    .locator(".trip-plan")
    .first()
    .screenshot({ path: ".cache/trip-plan-390.png" });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "按这条安排出门", exact: true })
    .first()
    .click();
  await expect(page.locator(".trip-active")).toBeVisible();
  await page.getByRole("button", { name: "前往下一站", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "我的日常", exact: true }).click();
  await page
    .getByRole("button", { name: "一趟出门 · 边办事边走走", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "我到了，确认位置", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "我到了，确认位置", exact: true })
    .click();
  await page.getByRole("button", { name: "在这里歇脚", exact: true }).click();
  await expect(page.getByRole("heading", { name: "先歇一歇" })).toBeVisible();
  await page
    .getByRole("button", { name: "歇好了，继续安排", exact: true })
    .click();
  await page
    .getByRole("button", { name: "从这里直接返程", exact: true })
    .click();
  await page.getByRole("button", { name: "前往下一站", exact: true }).click();
  await page
    .getByRole("button", { name: "我到了，确认位置", exact: true })
    .click();
  await page.getByLabel("实际花费（元，可留空）").fill("38");
  await page.getByLabel("这次的提醒").fill("菜场入口有台阶，下次留意。");
  await page
    .getByRole("button", { name: "保存行后记录并结束", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("yike-life-v1")!).trips[0].spent,
    ),
  ).toBe(38);
  expect(paid).toBe(0);
});
test("AI amendments are previewed, can be rejected and invalidate computed plans only on acceptance", async ({
  page,
}) => {
  let body: any;
  await page.route("**/api/ai/parse", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        draft: { ...body.current, shoppingBudget: 30, tasks: ["market"] },
      },
    });
  });
  await open(page);
  await page.getByRole("button", { name: "核算整趟行程", exact: true }).click();
  const count = await page.locator(".trip-plan").count();
  await page.getByLabel("本次修改").fill("预算改成30元，药先不取了");
  await page.getByRole("button", { name: "整理这次修改", exact: true }).click();
  await expect(page.locator(".trip-diff")).toContainText("50 → 30");
  await expect(page.getByLabel("购物预算（元）", { exact: true })).toHaveValue(
    "50",
  );
  expect(body.current.tripMinutes).toBe(45);
  expect(JSON.stringify(body)).not.toContain("position");
  await page.getByRole("button", { name: "保留原方案", exact: true }).click();
  expect(await page.locator(".trip-plan").count()).toBe(count);
  await page.getByRole("button", { name: "整理这次修改", exact: true }).click();
  await page.getByRole("button", { name: "确认这些修改", exact: true }).click();
  await expect(page.getByLabel("购物预算（元）", { exact: true })).toHaveValue(
    "30",
  );
  await expect(page.locator(".trip-plan")).toHaveCount(0);
  await expect(
    page.getByLabel("整趟上限（分钟）", { exact: true }),
  ).toHaveValue("45");
});
test("voice permission failure leaves text editable and makes no upload", async ({
  page,
}) => {
  let posted = 0;
  await page.route("**/api/ai/voice", (route) => {
    if (route.request().method() === "POST") posted++;
    return route.fulfill({ json: { configured: true } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.reject(new Error("denied")) },
    });
  });
  await open(page);
  await page.getByLabel("本次修改").fill("保留这段草稿");
  await page.getByText("用语音说一说", { exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.locator(".voice-input")).toContainText("麦克风未能开启");
  await expect(page.getByLabel("本次修改")).toHaveValue("保留这段草稿");
  expect(posted).toBe(0);
});
test("recorded browser audio is held locally until send, then editable text is confirmed", async ({
  page,
}) => {
  let posted = 0;
  await page.route("**/api/ai/voice", (route) => {
    if (route.request().method() === "POST") {
      posted++;
      return route.fulfill({ json: { text: "预算改成三十元，药先不取了。" } });
    }
    return route.fulfill({ json: { configured: true } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const audio = new AudioContext(),
          osc = audio.createOscillator(),
          dest = audio.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        await audio.resume();
        (window as any).recordingFixture = {
          audio,
          osc,
          startedAt: audio.currentTime,
        };
        return dest.stream;
      },
    });
  });
  await open(page);
  await page.getByText("用语音说一说", { exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "结束录音", exact: true }),
  ).toBeVisible();
  // Wait for rendered audio, not wall time: a delayed/suspended audio clock
  // can otherwise produce an empty recording on a busy test worker.
  await page.waitForFunction(() => {
    const f = (window as any).recordingFixture;
    return (
      f?.audio.state === "running" && f.audio.currentTime - f.startedAt >= 0.4
    );
  });
  await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "发送录音识别", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const f = (window as any).recordingFixture;
    f.osc.stop();
    await f.audio.close();
  });
  expect(posted).toBe(0);
  await page.getByRole("button", { name: "发送录音识别", exact: true }).click();
  await expect(page.getByLabel("语音识别文字", { exact: true })).toHaveValue(
    "预算改成三十元，药先不取了。",
  );
  await page
    .getByRole("button", { name: "确认文字，填入需求", exact: true })
    .click();
  await expect(page.getByLabel("本次修改")).toHaveValue(
    "预算改成三十元，药先不取了。",
  );
  expect(posted).toBe(1);
});
test("a browser recording failure closes its granted audio track without uploading", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/ai/voice", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: { configured: true } });
  });
  await page.addInitScript(() => {
    (window as any).closedAudioTrack = false;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => ({
        getTracks: () => [
          {
            stop: () => {
              (window as any).closedAudioTrack = true;
            },
          },
        ],
      }),
    });
    (window as any).MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
      start() {
        throw new Error("recording unavailable");
      }
    };
  });
  await open(page);
  await page.getByText("用语音说一说", { exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.locator(".voice-input")).toContainText("麦克风未能开启");
  expect(await page.evaluate(() => (window as any).closedAudioTrack)).toBe(
    true,
  );
  expect(posts).toBe(0);
});
