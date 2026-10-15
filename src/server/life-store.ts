import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  cleanBook,
  cleanPlace,
  emptyBook,
  type LifeSnapshot,
  type PersonalPlace,
} from "../shared/life.js";
import { ServiceError } from "./baidu.js";
import { parseResultFile } from "../shared/result-file.js";
import { AssistanceStore } from "./assistance-store.js";
import { FamilyStore } from "./family-store.js";
import { NeighborhoodStore } from "./neighborhood-store.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86400_000;
export class LifeStore {
  private db: DatabaseSync;
  readonly assistance: AssistanceStore;
  readonly family: FamilyStore;
  readonly neighborhood: NeighborhoodStore;
  constructor(
    path = ":memory:",
    private now = () => Date.now(),
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, book TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(token_hash TEXT PRIMARY KEY, space TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings(code_hash TEXT PRIMARY KEY, space TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports(space TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, saved TEXT NOT NULL, PRIMARY KEY(space,id));
      CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, space TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, expires INTEGER NOT NULL);`);
    this.assistance = new AssistanceStore(this.db, this.now);
    this.family = new FamilyStore(this.db, this.now);
    this.neighborhood = new NeighborhoodStore(this.db, this.now);
  }
  close() {
    this.db.close();
  }
  private device(space: string) {
    this.db.prepare("DELETE FROM devices WHERE expires < ?").run(this.now());
    const count = this.db
      .prepare("SELECT count(*) AS n FROM devices WHERE space=?")
      .get(space) as { n: number };
    if (count.n >= 12)
      throw new ServiceError(
        "已连接12台设备，请先在不再使用的设备上断开连接。",
        409,
      );
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO devices VALUES (?,?,?)")
      .run(hash(token), space, this.now() + 30 * DAY);
    return token;
  }
  create() {
    const space = randomUUID();
    this.db
      .prepare("INSERT INTO spaces VALUES (?,?,?,?)")
      .run(
        space,
        0,
        JSON.stringify(emptyBook()),
        new Date(this.now()).toISOString(),
      );
    return { token: this.device(space), snapshot: this.read(space) };
  }
  authenticate(token: string | undefined) {
    if (!token || token.length > 100)
      throw new ServiceError("请先连接私人地点簿。", 401);
    const row = this.db
      .prepare("SELECT space FROM devices WHERE token_hash=? AND expires>?")
      .get(hash(token), this.now()) as { space: string } | undefined;
    if (!row)
      throw new ServiceError("连接已失效，请在已连接的设备上生成配对码。", 401);
    return row.space;
  }
  revoke(token: string) {
    this.db.prepare("DELETE FROM devices WHERE token_hash=?").run(hash(token));
  }
  read(space: string): LifeSnapshot {
    const row = this.db
      .prepare("SELECT revision,book,updated FROM spaces WHERE id=?")
      .get(space) as
      { revision: number; book: string; updated: string } | undefined;
    if (!row) throw new ServiceError("地点簿不存在。", 404);
    return {
      revision: row.revision,
      updatedAt: row.updated,
      book: cleanBook(JSON.parse(row.book)),
    };
  }
  write(space: string, revision: unknown, value: unknown) {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0)
      throw new ServiceError("同步版本无效。", 400);
    let book;
    try {
      book = cleanBook(value);
    } catch (e) {
      throw new ServiceError((e as Error).message, 400);
    }
    const update = this.db
      .prepare(
        "UPDATE spaces SET revision=revision+1,book=?,updated=? WHERE id=? AND revision=?",
      )
      .run(
        JSON.stringify(book),
        new Date(this.now()).toISOString(),
        space,
        revision as number,
      );
    if (!update.changes)
      throw new ServiceError(
        "另一台设备已更新。请先下载本机备份，再读取服务器版本后合并；本机内容已保留。",
        409,
      );
    return this.read(space);
  }
  pair(space: string) {
    this.db
      .prepare("DELETE FROM pairings WHERE expires<=? OR space=?")
      .run(this.now(), space);
    const code = randomBytes(9).toString("base64url");
    this.db
      .prepare("INSERT INTO pairings VALUES (?,?,?)")
      .run(hash(code), space, this.now() + 5 * 60_000);
    return { code, expiresAt: new Date(this.now() + 5 * 60_000).toISOString() };
  }
  createCard(space: string, value: unknown) {
    let place: PersonalPlace;
    try {
      place = cleanPlace(value);
    } catch (e) {
      throw new ServiceError((e as Error).message, 400);
    }
    const { favorite: _favorite, ...snapshot } = place;
    this.db.prepare("DELETE FROM cards WHERE expires<=?").run(this.now());
    const count = this.db
      .prepare("SELECT count(*) AS n FROM cards WHERE space=?")
      .get(space) as { n: number };
    if (count.n >= 20)
      throw new ServiceError("最多保留20张有效分享卡，请先撤销旧卡片。", 409);
    const id = randomUUID(),
      token = randomBytes(24).toString("base64url");
    const createdAt = new Date(this.now()).toISOString(),
      expires = this.now() + 7 * DAY;
    this.db
      .prepare("INSERT INTO cards VALUES (?,?,?,?,?,?)")
      .run(
        id,
        space,
        hash(token),
        JSON.stringify(snapshot),
        createdAt,
        expires,
      );
    return { id, token, expiresAt: new Date(expires).toISOString() };
  }
  sharedCard(token: unknown) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token))
      throw new ServiceError(
        "地点卡链接无效或已过期，请联系分享者重新生成。",
        404,
      );
    const row = this.db
      .prepare(
        "SELECT body,created,expires FROM cards WHERE token_hash=? AND expires>?",
      )
      .get(hash(token), this.now()) as
      { body: string; created: string; expires: number } | undefined;
    if (!row)
      throw new ServiceError(
        "地点卡已过期或被撤销，请联系分享者重新生成。",
        404,
      );
    return {
      place: cleanPlace(JSON.parse(row.body)),
      createdAt: row.created,
      expiresAt: new Date(row.expires).toISOString(),
    };
  }
  cards(space: string) {
    const rows = this.db
      .prepare(
        "SELECT id,body,created,expires FROM cards WHERE space=? AND expires>? ORDER BY created DESC",
      )
      .all(space, this.now()) as {
      id: string;
      body: string;
      created: string;
      expires: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: JSON.parse(r.body).name as string,
      createdAt: r.created,
      expiresAt: new Date(r.expires).toISOString(),
    }));
  }
  revokeCard(space: string, id: string) {
    const result = this.db
      .prepare("DELETE FROM cards WHERE space=? AND id=?")
      .run(space, id);
    if (!result.changes)
      throw new ServiceError("地点卡不存在或已被撤销。", 404);
    return { ok: true };
  }
  reports(space: string) {
    const rows = this.db
      .prepare(
        "SELECT id,body,saved FROM reports WHERE space=? ORDER BY saved DESC",
      )
      .all(space) as { id: string; body: string; saved: string }[];
    return rows.map((r) => {
      const b = JSON.parse(r.body);
      return {
        id: r.id,
        label: b.center.label,
        mode: b.mode,
        savedAt: r.saved,
      };
    });
  }
  report(space: string, id: string) {
    const row = this.db
      .prepare("SELECT body FROM reports WHERE space=? AND id=?")
      .get(space, id) as { body: string } | undefined;
    if (!row) throw new ServiceError("报告不存在或已被移除。", 404);
    return parseResultFile(row.body);
  }
  saveReport(space: string, raw: unknown) {
    let report;
    try {
      report = parseResultFile(JSON.stringify(raw));
    } catch (e) {
      throw new ServiceError((e as Error).message, 400);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const count = this.db
        .prepare("SELECT count(*) AS n FROM reports WHERE space=?")
        .get(space) as { n: number };
      const exists = this.db
        .prepare("SELECT body FROM reports WHERE space=? AND id=?")
        .get(space, report.id) as { body: string } | undefined;
      if (exists && exists.body !== JSON.stringify(report))
        throw new ServiceError(
          "服务器已有同编号的不同报告。请先备份并移除旧共享，再保存新版。",
          409,
        );
      if (count.n >= 5 && !exists)
        throw new ServiceError(
          "最多共享5份报告，请先移除不再需要的报告。",
          409,
        );
      this.db
        .prepare(
          "INSERT INTO reports VALUES (?,?,?,?) ON CONFLICT(space,id) DO UPDATE SET body=excluded.body,saved=excluded.saved",
        )
        .run(
          space,
          report.id,
          JSON.stringify(report),
          new Date(this.now()).toISOString(),
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { ok: true };
  }
  deleteReport(space: string, id: string) {
    this.db
      .prepare("DELETE FROM reports WHERE space=? AND id=?")
      .run(space, id);
    return { ok: true };
  }
  redeem(code: unknown) {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{12}$/.test(code))
      throw new ServiceError("配对码无效或已过期。", 400);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT space FROM pairings WHERE code_hash=? AND expires>?")
        .get(hash(code), this.now()) as { space: string } | undefined;
      if (!row) throw new ServiceError("配对码无效或已过期。", 400);
      const token = this.device(row.space);
      this.db.prepare("DELETE FROM pairings WHERE code_hash=?").run(hash(code));
      const snapshot = this.read(row.space);
      this.db.exec("COMMIT");
      return { token, snapshot };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
