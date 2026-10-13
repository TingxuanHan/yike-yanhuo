import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  cleanPlanning,
  parsePlanningAnswer,
  type AiStatus,
} from "../shared/planning.js";
import {
  EDIT_SYSTEM,
  applyPlanningEdit,
  planningDiff,
} from "../shared/planning-edit.js";
import {
  chatTransport,
  cleanModelConfig,
  MAX_COMPLETION,
  MAX_THINKING,
  PLANNING_SYSTEM,
  type AiTransport,
  type ModelConfig,
} from "./ai-transport.js";
import { ServiceError } from "./baidu.js";
import { requireZeroPrice } from "./ai-pricing.js";
import {
  cleanAudio,
  voiceTransport,
  VOICE_MODEL,
  type VoiceTransport,
} from "./voice-transport.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const day = (now: number) =>
  new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const limit = (s: string | undefined, fallback: number, max: number) => {
  const n = Number(s ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw new Error("AI额度配置无效。");
  return n;
};
export class AiService {
  private db: DatabaseSync;
  private key: Buffer;
  private hosts: Set<string>;
  private platform: ModelConfig | null;
  private busy = false;
  private closed = false;
  private active: AbortController | null = null;
  private freeLimit: number;
  private globalLimit: number;
  private ownLimit: number;
  private tokenLimit: number;
  private freeLocalLimits: boolean;
  constructor(
    env: NodeJS.ProcessEnv,
    private transport: AiTransport = chatTransport,
    private now = () => Date.now(),
    private verifyFree = requireZeroPrice,
    private voice = voiceTransport as VoiceTransport,
  ) {
    const path =
      env.AI_DATA_PATH ||
      (env.PERSONAL_DATA_PATH && env.PERSONAL_DATA_PATH !== ":memory:"
        ? `${env.PERSONAL_DATA_PATH}.ai`
        : ":memory:");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const keyPath = `${path}.key`;
    if (env.AI_ENCRYPTION_KEY) {
      if (!/^[a-f0-9]{64}$/i.test(env.AI_ENCRYPTION_KEY))
        throw new Error("AI_ENCRYPTION_KEY须为64位十六进制随机值。");
      this.key = Buffer.from(env.AI_ENCRYPTION_KEY, "hex");
    } else if (path === ":memory:") this.key = randomBytes(32);
    else {
      if (!existsSync(keyPath)) {
        try {
          writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      }
      this.key = readFileSync(keyPath);
      if (this.key.length !== 32)
        throw new Error("AI密钥存储无法打开，请恢复匹配的加密文件。");
    }
    this.hosts = new Set([
      "api.siliconflow.cn",
      "openrouter.ai",
      "api.deepseek.com",
      "api-inference.modelscope.cn",
      "api.groq.com",
      ...(env.AI_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ]);
    this.platform = env.AI_FREE_KEY
      ? cleanModelConfig(
          {
            baseUrl: env.AI_FREE_BASE_URL,
            model: env.AI_FREE_MODEL,
            key: env.AI_FREE_KEY,
          },
          this.hosts,
        )
      : null;
    this.freeLimit = limit(env.AI_FREE_SPACE_DAILY, 3, 100);
    this.globalLimit = limit(env.AI_FREE_DAILY_REQUESTS, 20, 10000);
    this.ownLimit = limit(env.AI_OWN_DEVICE_DAILY, 20, 1000);
    this.tokenLimit = limit(env.AI_FREE_DAILY_TOKEN_BUDGET, 60000, 10000000);
    this.freeLocalLimits = env.AI_FREE_LOCAL_LIMITS !== "false";
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS credentials(owner TEXT PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, day TEXT NOT NULL, owner TEXT NOT NULL, space TEXT NOT NULL, mode TEXT NOT NULL, tokens INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS request_day ON requests(day);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY, until INTEGER NOT NULL);`);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.active?.abort();
    this.db.close();
    this.key.fill(0);
  }
  private read(owner: string): ModelConfig | null {
    const r = this.db
      .prepare("SELECT payload FROM credentials WHERE owner=? AND expires>?")
      .get(owner, this.now()) as { payload: string } | undefined;
    if (!r) return null;
    try {
      const b = Buffer.from(r.payload, "base64"),
        decipher = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
      decipher.setAAD(Buffer.from(owner));
      decipher.setAuthTag(b.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(b.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch {
      throw new ServiceError(
        "当前设备的接口设置无法解密，请删除后重新保存。",
        409,
      );
    }
  }
  save(token: string, input: unknown) {
    const config = cleanModelConfig(input, this.hosts),
      owner = hash(token),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(owner));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(config), "utf8"),
      cipher.final(),
    ]);
    this.db
      .prepare("INSERT OR REPLACE INTO credentials VALUES (?,?,?)")
      .run(
        owner,
        Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"),
        this.now() + 30 * 86400000,
      );
  }
  remove(token: string) {
    this.db.prepare("DELETE FROM credentials WHERE owner=?").run(hash(token));
  }
  private used(where: string, ...args: string[]) {
    return this.db
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(tokens),0) AS tokens FROM requests WHERE day=? AND ${where}`,
      )
      .get(day(this.now()), ...args) as { n: number; tokens: number };
  }
  status(token: string, space: string): AiStatus {
    const own = this.read(hash(token)),
      free = this.used("mode='free' AND space=?", space),
      global = this.used("mode='free'"),
      device = this.used("owner=? AND mode='own'", hash(token));
    return {
      free: {
        configured: !!this.platform,
        model: this.platform?.model ?? "",
        limit: this.freeLocalLimits ? this.freeLimit : null,
        remaining: this.platform
          ? !this.freeLocalLimits
            ? null
            : Math.max(
                0,
                Math.min(
                  this.freeLimit - free.n,
                  this.globalLimit - global.n,
                  Math.floor(
                    (this.tokenLimit - global.tokens) / this.reservation(600),
                  ),
                ),
              )
          : 0,
      },
      own: {
        configured: !!own,
        baseUrl: own?.baseUrl ?? "",
        model: own?.model ?? "",
        remaining: Math.max(0, this.ownLimit - device.n),
        limit: this.ownLimit,
      },
      resetsAt: new Date(
        Date.parse(`${day(this.now())}T00:00:00+08:00`) + 86400000,
      ).toISOString(),
    };
  }
  private reservation(length: number) {
    return (
      Buffer.byteLength(PLANNING_SYSTEM, "utf8") +
      length * 4 +
      MAX_COMPLETION +
      MAX_THINKING +
      256
    );
  }
  async run(token: string, space: string, input: Record<string, unknown>) {
    if (
      !["free", "own"].includes(String(input.mode)) ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > 600 ||
      typeof input.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{12,80}$/.test(input.requestId)
    )
      throw new ServiceError("请填写600字内需求并明确选择模型来源。", 400);
    const current =
      input.current === undefined ? null : cleanPlanning(input.current);
    if (this.busy)
      throw new ServiceError("正在整理另一条需求，请稍后再试。", 429);
    const owner = hash(token),
      config = input.mode === "free" ? this.platform : this.read(owner);
    if (!config)
      throw new ServiceError(
        input.mode === "free"
          ? "基础AI尚未开通，可先手工填写条件。"
          : "请先保存当前设备的接口设置。",
        503,
      );
    const id = hash(owner + ":" + input.requestId),
      tokens = this.reservation(current ? 1800 : 600);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM credentials WHERE expires<=?")
        .run(this.now());
      this.db
        .prepare("DELETE FROM requests WHERE day<?")
        .run(day(this.now() - 7 * 86400000));
      const lease = this.db
        .prepare("SELECT until FROM lease WHERE id=1")
        .get() as { until: number } | undefined;
      if (lease && lease.until > this.now())
        throw new ServiceError("模型服务正在处理请求，请稍后再试。", 429);
      if (this.db.prepare("SELECT id FROM requests WHERE id=?").get(id))
        throw new ServiceError(
          "这次请求已处理或已发送，请核对结果后再主动重新整理。",
          409,
        );
      const status = this.status(token, space);
      const remaining = (input.mode === "free" ? status.free : status.own)
        .remaining;
      if (remaining !== null && remaining < 1)
        throw new ServiceError(
          "今天的此项额度已用完，可手工填写；不会切换到其他接口。",
          429,
        );
      this.db
        .prepare("INSERT INTO requests VALUES (?,?,?,?,?,?)")
        .run(id, day(this.now()), owner, space, String(input.mode), tokens);
      this.db
        .prepare("INSERT OR REPLACE INTO lease VALUES (1,?)")
        .run(this.now() + 35000);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.busy = true;
    const controller = new AbortController();
    this.active = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new ServiceError("整理超时，输入已保留。可以手工填写条件。", 504),
          );
        }, 25000);
      });
      const answer = await Promise.race([
        (async () => {
          if (input.mode === "free" && !this.freeLocalLimits)
            await this.verifyFree(config, controller.signal);
          controller.signal.throwIfAborted();
          return this.transport(
            config,
            current
              ? JSON.stringify({ current, text: input.text })
              : (input.text as string),
            controller.signal,
            current ? EDIT_SYSTEM : undefined,
          );
        })(),
        timeout,
      ]);
      if (answer.includes(config.key)) throw new Error();
      const draft = current
        ? applyPlanningEdit(current, input.text, answer)
        : parsePlanningAnswer(answer, input.text);
      return {
        draft,
        source: input.mode,
        model: config.model,
        changes: current ? planningDiff(current, draft) : [],
      };
    } catch (e) {
      // Never relay provider text, credentials, raw JSON or a prompt back as an error.
      if (e instanceof ServiceError) throw e;
      throw new ServiceError(
        "模型未返回有效条件，输入已保留。请手工填写或重新整理。",
        502,
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.active = null;
      this.busy = false;
      if (!this.closed) this.db.prepare("DELETE FROM lease WHERE id=1").run();
    }
  }
  voiceStatus() {
    return {
      configured:
        !!this.platform &&
        this.platform.baseUrl === "https://api.siliconflow.cn/v1",
      model: VOICE_MODEL,
      maxSeconds: 45,
    };
  }
  async transcribe(
    token: string,
    space: string,
    input: Record<string, unknown>,
  ) {
    if (!this.voiceStatus().configured || !this.platform)
      throw new ServiceError("语音服务尚未配置，请先打字。", 503);
    if (
      typeof input.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{12,80}$/.test(input.requestId)
    )
      throw new ServiceError("语音请求编号无效。", 400);
    const clip = cleanAudio(input),
      id = hash(hash(token) + ":voice:" + input.requestId),
      config = { ...this.platform, model: VOICE_MODEL };
    if (this.busy)
      throw new ServiceError("正在处理另一条需求，请稍后再试。", 429);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM requests WHERE day<?")
        .run(day(this.now() - 7 * 86400000));
      const lease = this.db
        .prepare("SELECT until FROM lease WHERE id=1")
        .get() as { until: number } | undefined;
      if (lease && lease.until > this.now())
        throw new ServiceError("模型服务正在处理请求，请稍后再试。", 429);
      if (this.db.prepare("SELECT id FROM requests WHERE id=?").get(id))
        throw new ServiceError("本段语音已发送，请核对结果后再主动重试。", 409);
      this.db
        .prepare("INSERT INTO requests VALUES (?,?,?,?,?,?)")
        .run(id, day(this.now()), hash(token), space, "voice", 0);
      this.db
        .prepare("INSERT OR REPLACE INTO lease VALUES(1,?)")
        .run(this.now() + 35000);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    const controller = new AbortController();
    this.active = controller;
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ServiceError("语音识别超时，请主动重试或直接打字。", 504));
        }, 30000);
      });
      const text = await Promise.race([
        (async () => {
          await this.verifyFree(config, controller.signal);
          controller.signal.throwIfAborted();
          return this.voice(config, clip, controller.signal);
        })(),
        timeout,
      ]);
      if (text.includes(config.key) || text.length > 600 || !text.trim())
        throw new ServiceError("语音结果无效，请重新录制。", 502);
      return { text, model: VOICE_MODEL };
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError("语音识别未完成，请主动重试或直接打字。", 502);
    } finally {
      clearTimeout(timer);
      controller.abort();
      clip.bytes.fill(0);
      this.active = null;
      this.busy = false;
      if (!this.closed) this.db.prepare("DELETE FROM lease WHERE id=1").run();
    }
  }
}
