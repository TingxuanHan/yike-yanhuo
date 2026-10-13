import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { AiService } from "../src/server/ai-service.js";
import {
  cleanModelConfig,
  publicAddress,
  planningRequest,
  MAX_COMPLETION,
  MAX_THINKING,
  PLANNING_SYSTEM,
} from "../src/server/ai-transport.js";
import { createApp } from "../src/server/app.js";
import {
  cleanPlanning,
  emptyPlanning,
  parsePlanningAnswer,
  planningBook,
} from "../src/shared/planning.js";
import { emptyBook } from "../src/shared/life.js";
import { PlanningSession } from "../src/mini/planning.js";

const config = {
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "example-model",
  key: "test-only-key-abcdef",
};
const env = {
  AI_FREE_BASE_URL: config.baseUrl,
  AI_FREE_MODEL: config.model,
  AI_FREE_KEY: config.key,
};
const answer = JSON.stringify({
  ...emptyPlanning(),
  tripMinutes: 45,
  shoppingBudget: 50,
  tasks: ["market"],
});
const input = (n: number, mode = "free") => ({
  text: "45分钟买菜回来，50元预算",
  mode,
  requestId: `request-test-${n}`,
});
test("Xing extraction disables thinking without changing other provider payloads or exposing keys", () => {
  const model = "XingChenAGI/Xing4.0-29B";
  const body = planningRequest({ ...config, model }, "50元买菜");
  assert.equal(body.enable_thinking, false);
  assert.equal(body.thinking_budget, 128);
  assert.equal(body.max_tokens, MAX_COMPLETION);
  assert.equal(JSON.stringify(body).includes(config.key), false);
  for (const other of [
    config,
    { ...config, model, baseUrl: "https://openrouter.ai/api/v1" },
  ]) {
    const request = planningRequest(other, "买菜");
    assert.equal("enable_thinking" in request, false);
    assert.equal("thinking_budget" in request, false);
  }
});
test("Qwen extraction requests JSON and disables thinking only at the supported provider", () => {
  const model = "Qwen/Qwen3-8B";
  const body = planningRequest({ ...config, model }, "50元买菜");
  assert.equal(body.enable_thinking, false);
  assert.equal(body.thinking_budget, MAX_THINKING);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, MAX_COMPLETION);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.top_p, 0.8);
  assert.equal(JSON.stringify(body).includes(config.key), false);
  for (const other of [
    config,
    { ...config, model: "XingChenAGI/Xing4.0-29B" },
    { ...config, model, baseUrl: "https://openrouter.ai/api/v1" },
  ]) {
    assert.equal("response_format" in planningRequest(other, "买菜"), false);
  }
});
test("token reservations include the bounded thinking allowance before any model request", async () => {
  let calls = 0;
  const reservation =
    Buffer.byteLength(PLANNING_SYSTEM, "utf8") +
    600 * 4 +
    MAX_COMPLETION +
    MAX_THINKING +
    256;
  const ai = new AiService(
    { ...env, AI_FREE_DAILY_TOKEN_BUDGET: String(reservation - 1) },
    async () => {
      calls++;
      return answer;
    },
  );
  try {
    await assert.rejects(ai.run("a", "s", input(1)), /额度/);
    assert.equal(calls, 0);
  } finally {
    ai.close();
  }
});
test("planning rejects invented facts, fields, goods and out of range conditions", () => {
  assert.equal(parsePlanningAnswer(answer, "买菜").shoppingBudget, 50);
  assert.throws(() => cleanPlanning({ price: 2 }));
  assert.throws(() => cleanPlanning({ tripMinutes: 181 }));
  assert.throws(() => cleanPlanning({ speedMps: "1.2" }));
  assert.throws(() => cleanPlanning({ departure: "25:00" }));
  assert.throws(() => cleanPlanning({ tasks: ["hospital"] }));
  assert.throws(() =>
    parsePlanningAnswer(JSON.stringify({ items: ["鸡蛋"] }), "买牛奶"),
  );
  const next = planningBook(emptyBook(), {
    ...emptyPlanning(),
    departure: "10:00",
    walkingMinutes: 15,
  });
  assert.equal(next.preferences.departure, "10:00");
  assert.equal(next.preferences.minutes, 15);
  assert.equal(next.movement?.targetMinutes, 15);
  assert.deepEqual(next.places, []);
});
test("custom model URLs reject credentials, private destinations and unapproved hosts", () => {
  const hosts = new Set(["api.siliconflow.cn"]);
  for (const url of [
    "http://api.siliconflow.cn/v1",
    "https://127.0.0.1/v1",
    "https://api.siliconflow.cn/v1?key=secret",
    "https://secret@api.siliconflow.cn/v1",
    "https://unapproved.example/v1",
    "https://api.siliconflow.cn:444/v1",
  ])
    assert.throws(() => cleanModelConfig({ ...config, baseUrl: url }, hosts));
  assert.equal(cleanModelConfig(config, hosts).baseUrl, config.baseUrl);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "172.16.1.1",
    "192.168.2.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2002:7f00:1::",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});
test("encrypted credentials and daily counters survive restart and a model switch without sharing keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "yike-ai-")),
    path = join(root, "service.sqlite");
  let now = Date.parse("2026-10-13T23:50:00+08:00"),
    calls = 0;
  const transport = async () => {
    calls++;
    return answer;
  };
  let ai = new AiService({ ...env, AI_DATA_PATH: path }, transport, () => now);
  try {
    ai.save("device-a", config);
    assert.equal(ai.status("device-b", "shared-space").own.configured, false);
    assert.equal(
      JSON.stringify(ai.status("device-a", "shared-space")).includes(
        config.key,
      ),
      false,
    );
    await ai.run("device-a", "shared-space", input(1));
    await ai.run("device-b", "shared-space", input(2));
    await ai.run("device-a", "shared-space", input(3));
    ai.close();
    assert.equal(readFileSync(path).includes(Buffer.from(config.key)), false);
    ai = new AiService(
      { ...env, AI_DATA_PATH: path, AI_FREE_MODEL: "Qwen/Qwen3-8B" },
      transport,
      () => now,
    );
    assert.equal(
      ai.status("device-a", "shared-space").free.model,
      "Qwen/Qwen3-8B",
    );
    assert.equal(ai.status("device-a", "shared-space").own.configured, true);
    await assert.rejects(ai.run("device-b", "shared-space", input(4)), /额度/);
    assert.equal(calls, 3);
    await assert.rejects(
      ai.run("device-b", "shared-space", input(4, "own")),
      /保存/,
    );
    await ai.run("device-a", "shared-space", input(5, "own"));
    now += 20 * 60000;
    assert.equal(ai.status("device-b", "shared-space").free.remaining, 3);
    ai.remove("device-a");
    assert.equal(ai.status("device-a", "shared-space").own.configured, false);
  } finally {
    ai.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("single flight, global cap and duplicate request protection stop accidental model calls", async () => {
  let finish: (s: string) => void = () => {};
  let calls = 0;
  const ai = new AiService({ ...env, AI_FREE_DAILY_REQUESTS: "1" }, () => {
    calls++;
    return new Promise((r) => {
      finish = r;
    });
  });
  try {
    const pending = ai.run("a", "space-a", input(1));
    await assert.rejects(ai.run("b", "space-b", input(2)), /正在/);
    finish(answer);
    await pending;
    await assert.rejects(ai.run("a", "space-a", input(1)), /已处理/);
    await assert.rejects(ai.run("b", "space-b", input(3)), /额度/);
    assert.equal(calls, 1);
  } finally {
    ai.close();
  }
});
test("invalid and failed model calls count toward limits and never leak raw provider errors", async () => {
  let calls = 0;
  const ai = new AiService({ ...env, AI_FREE_SPACE_DAILY: "1" }, async () => {
    calls++;
    throw new Error("provider echoed " + config.key);
  });
  try {
    await assert.rejects(
      ai.run("a", "s", input(1)),
      (e) => !String(e).includes(config.key) && /输入已保留/.test(String(e)),
    );
    await assert.rejects(ai.run("a", "s", input(2)), /额度/);
    assert.equal(calls, 1);
  } finally {
    ai.close();
  }
});
test("real HTTP AI endpoints require pairing, keep credentials separate and never call the map", async () => {
  let calls = 0;
  const server = createApp(
    { ...env, AI_FREE_MODEL: "Qwen/Qwen3-8B" },
    undefined,
    async () => {
      calls++;
      return answer;
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req = async (
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await req("/api/ai/status")).status, 401);
    const created = await (
      await req("/api/life/create", "POST", { client: "mini" })
    ).json();
    const token = created.token;
    assert.ok(token);
    const status = await (
      await req("/api/ai/status", "GET", undefined, token)
    ).json();
    assert.equal(status.free.model, "Qwen/Qwen3-8B");
    const saved = await req("/api/ai/settings", "PUT", config, token);
    assert.equal(saved.status, 200);
    assert.equal((await saved.text()).includes(config.key), false);
    assert.equal((await req("/api/life", "GET", undefined, token)).status, 200);
    const parsed = await req("/api/ai/parse", "POST", input(1), token);
    assert.equal(parsed.status, 200);
    assert.equal((await parsed.json()).model, "Qwen/Qwen3-8B");
    assert.equal(calls, 1);
    await req("/api/life/session", "DELETE", undefined, token);
    assert.equal(
      (await req("/api/ai/status", "GET", undefined, token)).status,
      401,
    );
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});
test("shared planning session preserves text on error, clears keys and waits for explicit confirmation", async () => {
  const store = new Map<string, unknown>();
  let body: any;
  let fail = false;
  const session = new PlanningSession({
    get: (k) => store.get(k),
    set: (k, v) => {
      store.set(k, v);
    },
    notify: () => {},
    request: async <T>(path: string, method?: string, value?: unknown) => {
      body = value;
      if (fail) throw new Error("今天额度已用完");
      return (
        path.endsWith("parse")
          ? { draft: JSON.parse(answer), model: "test" }
          : { free: { configured: false }, own: { configured: false } }
      ) as T;
    },
  });
  session.set("text", "45分钟买菜回来，50元预算");
  await session.parse();
  assert.equal(session.state.reviewed, true);
  assert.equal(store.has("yike-life"), false);
  assert.equal(session.confirm().tripMinutes, 45);
  fail = true;
  await session.parse();
  assert.match(session.state.error, /额度/);
  assert.match(session.state.text, /买菜/);
  session.set("key", config.key);
  await session.saveSettings();
  assert.equal(session.state.key, "");
  assert.equal(JSON.stringify([...store]).includes(config.key), false);
  session.mode("manual");
  session.set("walkingMinutes", "90");
  assert.throws(() => session.confirm(), /超过/);
  session.close();
});

test("shared database lease also serializes separate service instances and empty path uses persistent default", async () => {
  const root = mkdtempSync(join(tmpdir(), "yike-ai-lease-"));
  const settings = {
    ...env,
    PERSONAL_DATA_PATH: join(root, "life.sqlite"),
    AI_DATA_PATH: "",
  };
  let finish: (s: string) => void = () => {},
    calls = 0;
  const a = new AiService(
    settings,
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const b = new AiService(settings, async () => {
    calls++;
    return answer;
  });
  try {
    a.save("a", config);
    assert.equal(b.status("a", "s").own.configured, true);
    const pending = a.run("a", "s", input(1));
    await assert.rejects(b.run("b", "t", input(2)), /正在/);
    finish(answer);
    await pending;
    await b.run("b", "t", input(3));
    assert.equal(calls, 1);
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("deadline aborts the provider, spends one reservation and never retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined,
    calls = 0;
  const ai = new AiService(env, async (_c, _p, s) => {
    signal = s;
    calls++;
    return new Promise<string>(() => {});
  });
  try {
    const pending = ai.run("a", "s", input(1));
    const rejected = assert.rejects(pending, /超时/);
    t.mock.timers.tick(25001);
    await rejected;
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
    assert.equal(ai.status("a", "s").free.remaining, 2);
  } finally {
    ai.close();
  }
});
