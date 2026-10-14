import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { cleanFamily, type FamilyShare } from "../shared/family.js";
import { ServiceError } from "./baidu.js";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export class FamilyStore {
  constructor(
    private db: DatabaseSync,
    private now = () => Date.now(),
  ) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS family_locations(id TEXT PRIMARY KEY, owner TEXT NOT NULL, token_hash TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0)",
    );
  }
  sweep() {
    this.db
      .prepare(
        "UPDATE family_locations SET body='',closed=1 WHERE expires<=? AND closed=0",
      )
      .run(this.now());
    this.db
      .prepare("DELETE FROM family_locations WHERE expires<?")
      .run(this.now() - 86400000);
  }
  create(owner: string, raw: unknown) {
    const snapshot = cleanFamily(raw, this.now());
    if (this.now() - snapshot.record.at > 86400000)
      throw new ServiceError("记录已超过一天，请确认新地点后再分享。", 400);
    this.sweep();
    const invite = randomBytes(32).toString("base64url");
    const view: FamilyShare = {
      id: randomUUID(),
      createdAt: this.now(),
      expiresAt: this.now() + 3600000,
      snapshot,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE family_locations SET body='',closed=1 WHERE owner=? AND closed=0",
        )
        .run(owner);
      this.db
        .prepare(
          "INSERT INTO family_locations(id,owner,token_hash,body,expires) VALUES(?,?,?,?,?)",
        )
        .run(
          view.id,
          owner,
          digest(invite),
          JSON.stringify(view),
          view.expiresAt,
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { view, invite };
  }
  private row(id: string, owner?: string, token?: unknown) {
    this.sweep();
    const r = this.db
      .prepare("SELECT * FROM family_locations WHERE id=?")
      .get(id) as
      | { owner: string; token_hash: string; body: string; closed: number }
      | undefined;
    if (
      !r ||
      !(owner
        ? owner === r.owner
        : typeof token === "string" &&
          /^[A-Za-z0-9_-]{43}$/.test(token) &&
          digest(token) === r.token_hash)
    )
      throw new ServiceError("位置链接无法访问，请让家人重新发送。", 404);
    if (r.closed) throw new ServiceError("位置分享已停止或到期。", 410);
    return r;
  }
  read(id: string, owner?: string, token?: unknown): FamilyShare {
    return JSON.parse(this.row(id, owner, token).body);
  }
  close(id: string, owner: string) {
    // Repeated revocation is safe, but never permits access from another space.
    const r = this.db
      .prepare("SELECT owner FROM family_locations WHERE id=?")
      .get(id) as { owner: string } | undefined;
    if (!r || r.owner !== owner)
      throw new ServiceError("位置分享不存在。", 404);
    this.db
      .prepare("UPDATE family_locations SET body='',closed=1 WHERE id=?")
      .run(id);
    return { ok: true };
  }
}
