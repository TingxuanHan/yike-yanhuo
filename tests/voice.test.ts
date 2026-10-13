import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { cleanAudio, VOICE_MODEL } from "../src/server/voice-transport.js";
import { hasZeroVoicePrice } from "../src/server/ai-pricing.js";
import { AiService } from "../src/server/ai-service.js";
import { createApp } from "../src/server/app.js";
import { VoiceSession, type RecorderHandle } from "../src/mini/voice.js";
import { emptyPlanning } from "../src/shared/planning.js";
import { miniRuntime } from "./helpers/mini.js";
function wav(seconds = 1) {
  const n = 16000 * seconds,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  return { mime: "audio/wav", audio: b.toString("base64") };
}
const env = {
  AI_FREE_BASE_URL: "https://api.siliconflow.cn/v1",
  AI_FREE_MODEL: "Qwen/Qwen3-8B",
  AI_FREE_KEY: "fixture-key-123456",
  AI_FREE_LOCAL_LIMITS: "false",
  PERSONAL_DATA_PATH: ":memory:",
};
test("audio validation requires bounded real WAV or MPEG frames and rejects arbitrary content", () => {
  assert.equal(cleanAudio(wav()).bytes.length, 32044);
  assert.throws(() => cleanAudio(wav(47)));
  assert.throws(() =>
    cleanAudio({
      mime: "audio/wav",
      audio: Buffer.from("not an audio recording").toString("base64"),
    }),
  );
  assert.throws(() =>
    cleanAudio({ mime: "audio/mpeg", audio: "=".repeat(64) }),
  );
  const b = Buffer.alloc(216 * 28);
  for (let i = 0; i < 28; i++) {
    b[i * 216] = 0xff;
    b[i * 216 + 1] = 0xf3;
    b[i * 216 + 2] = 0x68;
    b[i * 216 + 3] = 0xc0;
  }
  assert.equal(
    cleanAudio({ mime: "audio/mpeg", audio: b.toString("base64") }).bytes
      .length,
    b.length,
  );
  b[216] = 0;
  assert.throws(() =>
    cleanAudio({ mime: "audio/mpeg", audio: b.toString("base64") }),
  );
});
test("voice price guard rejects paid, unknown units, renamed and missing rows", () => {
  const row = {
    playgroundName: VOICE_MODEL,
    componentCode: "utf8-bytes",
    unitZhCnName: "千字符（UTF-8）",
    realTimePriceCnyUnit: "0.000000",
  };
  const page = (rows: unknown) =>
    `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify({ rows })}\n`])})</script>`;
  assert.equal(hasZeroVoicePrice(page([row]), VOICE_MODEL), true);
  for (const r of [
    { ...row, realTimePriceCnyUnit: "0.001" },
    { ...row, unitZhCnName: "second" },
    { ...row, playgroundName: "Other/model" },
  ])
    assert.equal(hasZeroVoicePrice(page([r]), VOICE_MODEL), false);
  assert.equal(hasZeroVoicePrice(page([]), VOICE_MODEL), false);
});
test("ASR shares the AI lease, verifies free on every call, blocks duplicates and never returns a key", async () => {
  let allowed = false,
    calls = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const ai = new AiService(
    env,
    async () => JSON.stringify(emptyPlanning()),
    Date.now,
    async () => {
      if (!allowed) throw new Error("price unknown");
    },
    async (config) => {
      calls++;
      await gate;
      assert.equal(config.model, VOICE_MODEL);
      return "预算五十元";
    },
  );
  const body = { ...wav(), requestId: "voice-request-001" };
  try {
    await assert.rejects(ai.transcribe("token", "space", body));
    assert.equal(calls, 0);
    allowed = true;
    const working = ai.transcribe("token", "space", {
      ...body,
      requestId: "voice-request-002",
    });
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      ai.run("token", "space", {
        text: "买菜",
        mode: "free",
        requestId: "text-request-001",
      }),
      /正在/,
    );
    release();
    assert.equal((await working).text, "预算五十元");
    assert.equal(calls, 1);
    await assert.rejects(
      ai.transcribe("token", "space", {
        ...body,
        requestId: "voice-request-002",
      }),
      /已发送/,
    );
    await ai.transcribe("token", "space", {
      ...body,
      requestId: "voice-request-003",
    });
    assert.equal(calls, 2);
  } finally {
    ai.close();
  }
  const leaking = new AiService(
    env,
    undefined,
    Date.now,
    async () => {},
    async () => env.AI_FREE_KEY,
  );
  try {
    await assert.rejects(leaking.transcribe("t", "s", body), /无效/);
  } finally {
    leaking.close();
  }
});
test("voice HTTP endpoint requires a paired space and does not echo audio", async (t) => {
  let calls = 0;
  const server = createApp(
    env,
    undefined,
    undefined,
    async () => {},
    async () => {
      calls++;
      return "买菜后回来";
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(base + "/api/ai/voice")).status, 401);
  const created = (await (
    await fetch(base + "/api/life/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: "mini" }),
    })
  ).json()) as { token: string };
  const r = await fetch(base + "/api/ai/voice", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${created.token}`,
    },
    body: JSON.stringify({ ...wav(), requestId: "voice-http-test-001" }),
  });
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.deepEqual(result, { text: "买菜后回来", model: VOICE_MODEL });
  assert.equal(calls, 1);
});
test("voice deadline releases the lease even if a provider ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined,
    calls = 0;
  const ai = new AiService(
    env,
    undefined,
    Date.now,
    async () => {},
    async (_c, _clip, s) => {
      signal = s;
      calls++;
      return new Promise<string>(() => {});
    },
  );
  try {
    const body = { ...wav(), requestId: "voice-timeout-001" };
    const pending = ai.transcribe("token", "space", body);
    const rejected = assert.rejects(pending, /超时/);
    await Promise.resolve();
    t.mock.timers.tick(30001);
    await rejected;
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
    await assert.rejects(ai.transcribe("token", "space", body), /已发送/);
  } finally {
    ai.close();
  }
});
test("voice state machine only sends after explicit transcription, preserves review and cancels pending mic permission", async () => {
  let calls = 0,
    cancelled = 0,
    resolve: (h: RecorderHandle) => void = () => {};
  const clip = wav(),
    handle = {
      finish: async () => clip,
      cancel: () => {
        cancelled++;
      },
    };
  const s = new VoiceSession({
    capture: async () => handle,
    request: async <T>(_p: string, m?: string) => {
      if (m === "POST") calls++;
      return (m === "POST" ? { text: "预算50元" } : { configured: true }) as T;
    },
    notify: () => {},
  });
  await s.refresh();
  await s.start();
  assert.equal(calls, 0);
  await s.stop();
  assert.equal(s.state.stage, "ready");
  assert.equal(calls, 0);
  await s.transcribe();
  assert.equal(calls, 1);
  assert.equal(s.state.text, "预算50元");
  s.text("预算30元");
  assert.equal(s.state.text, "预算30元");
  s.cancel();
  const pending = new VoiceSession({
    capture: () => new Promise((r) => (resolve = r)),
    request: async <T>() => ({ configured: true }) as T,
    notify: () => {},
  });
  await pending.refresh();
  const start = pending.start();
  pending.cancel();
  resolve(handle);
  await start;
  assert.equal(pending.state.stage, "idle");
  assert.equal(cancelled, 1);
});
test("native recorder uses explicit privacy authorization, MP3 capture and removes its own temporary recording", async () => {
  let onStart: () => void = () => {},
    onStop: (r: any) => void = () => {},
    onError: () => void = () => {},
    permission = 0,
    removed = 0,
    options: any;
  const recorder = {
    onStart: (f: () => void) => (onStart = f),
    onStop: (f: (r: any) => void) => (onStop = f),
    onError: (f: () => void) => (onError = f),
    offStart: () => {},
    offStop: () => {},
    offError: () => {},
    start: (o: any) => {
      options = o;
      onStart();
    },
    stop: () => onStop({ tempFilePath: "fixture-mp3", fileSize: 1000 }),
  };
  const runtime = miniRuntime(new Map(), {
    getRecorderManager: () => recorder,
    requirePrivacyAuthorize: (o: any) => {
      permission++;
      o.success();
    },
    getFileSystemManager: () => ({
      readFile: (o: any) => o.success({ data: "fixture-audio" }),
      unlink: (o: any) => {
        assert.equal(o.filePath, "fixture-mp3");
        removed++;
      },
    }),
  });
  const h = await runtime.load("platform/voice.js").capture();
  assert.equal(permission, 1);
  assert.equal(options.format, "mp3");
  assert.equal(options.duration, 45000);
  assert.equal((await h.finish()).audio, "fixture-audio");
  assert.equal(removed, 1);
});
