import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/playwright");
const { chromium } = await import("@playwright/test");
const v2 = process.env.SUBMISSION_VARIANT === "v2";
const v3 = process.env.SUBMISSION_VARIANT === "v3";
const v4 = process.env.SUBMISSION_VARIANT === "v4";
const prefix = v4
  ? "submission-v4"
  : v3
    ? "submission-v3"
    : v2
      ? "submission-v2"
      : "submission";
const file = resolve(
  v4
    ? "materials/yike-yanhuo-baidu-v4.mp4"
    : v3
      ? "materials/yike-yanhuo-baidu-v3.mp4"
      : v2
        ? "materials/yike-yanhuo-baidu-v2.mp4"
        : "materials/yike-yanhuo-submission.mp4",
);
const { size } = await stat(file);
const metadata = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
    { encoding: "utf8" },
  ),
);
const v = metadata.streams.find((s) => s.codec_type === "video"),
  a = metadata.streams.find((s) => s.codec_type === "audio");
assert.equal(v.codec_name, "h264");
assert.deepEqual([v.width, v.height], [1600, 900]);
assert.equal(a.codec_name, "aac");
assert.ok(Math.abs(+v.duration - +a.duration) < 0.05);
execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], {
  stdio: "pipe",
});
const timeline = JSON.parse(
  await readFile(
    `materials/${prefix}${v3 || v4 ? "-edited" : ""}-timeline.json`,
    "utf8",
  ),
);
const subtitles = JSON.parse(
  await readFile(`materials/${prefix}-caption-timing.json`, "utf8"),
);
const story = JSON.parse(
  await readFile(
    v4
      ? "docs/submission-video-v4.json"
      : v3
        ? "docs/submission-video-v3.json"
        : v2
          ? "docs/submission-video-v2.json"
          : "docs/submission-video.json",
    "utf8",
  ),
);
let identityCheck;
if (v4) {
  const publicText = [
    JSON.stringify(story.scenes),
    JSON.stringify(subtitles),
    JSON.stringify(metadata.format.tags),
    await readFile("materials/yike-yanhuo-baidu-v4.srt", "utf8"),
    await readFile("docs/submission-v4-transcript.md", "utf8"),
  ].join("\n");
  for (const text of ["韩庭轩", "南京大学", "姜可"])
    assert.ok(!publicText.includes(text), "Video contains excluded identity");
  assert.equal(metadata.format.tags.artist, "一刻烟火");
  identityCheck = { excludedNamesAndSchool: true, artist: "一刻烟火" };
}
assert.equal(timeline.scenes.length, story.scenes.length);
assert.equal(
  subtitles.length,
  story.scenes.reduce((n, s) => n + s.lines.length, 0),
);
for (const [i, sub] of subtitles.entries()) {
  assert.ok(sub.start < sub.end && sub.end < +v.duration);
  if (i) assert.ok(subtitles[i - 1].end <= sub.start);
}
await mkdir(`.cache/${prefix}-final-frames`, { recursive: true });
for (const scene of timeline.scenes) {
  const sub = subtitles.find((s) => s.scene === scene.id);
  const at = Math.min(scene.end / 1000 - 1, sub.start + 3);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    String(at),
    "-i",
    file,
    "-frames:v",
    "1",
    `.cache/${prefix}-final-frames/${scene.id}.png`,
  ]);
}
const server = createServer((req, res) => {
  if (req.url !== "/video.mp4") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      '<video controls muted style="width:100%" src="/video.mp4"></video>',
    );
    return;
  }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const start = m ? +m[1] : 0,
    end = m?.[2] ? Math.min(+m[2], size - 1) : size - 1;
  res.writeHead(m ? 206 : 200, {
    "Content-Type": "video/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    ...(m ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  createReadStream(file, { start, end }).pipe(res);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator("video").evaluate(async (video) => {
    await video.play();
  });
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 1.2,
  );
  const playback = [];
  for (const at of [2, +v.duration / 2, +v.duration - 5]) {
    await page.locator("video").evaluate((video, at) => {
      video.currentTime = at;
    }, at);
    await page.waitForFunction((at) => {
      const v = document.querySelector("video");
      return !v.seeking && v.readyState >= 3 && v.currentTime > at + 0.4;
    }, at);
    playback.push(
      await page.locator("video").evaluate((v) => ({
        currentTime: v.currentTime,
        readyState: v.readyState,
        width: v.videoWidth,
        height: v.videoHeight,
        decodedAudioBytes: v.webkitAudioDecodedByteCount,
        decodedVideoFrames: v.getVideoPlaybackQuality().totalVideoFrames,
        error: v.error?.code || null,
      })),
    );
  }
  assert.deepEqual(errors, []);
  assert.ok(playback.every((p) => !p.error && p.decodedVideoFrames > 0));
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    duration: +metadata.format.duration,
    sizeBytes: size,
    video: {
      codec: v.codec_name,
      width: v.width,
      height: v.height,
      frameRate: v.r_frame_rate,
      frames: v.nb_frames,
    },
    audio: {
      codec: a.codec_name,
      sampleRate: a.sample_rate,
      channels: a.channels,
      duration: +a.duration,
    },
    scenes: timeline.scenes.length,
    spokenCaptions: subtitles.length,
    fullDecode: true,
    ...(identityCheck ? { identityCheck } : {}),
    playback,
  };
  await writeFile(
    `docs/validation/${prefix}-video.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
