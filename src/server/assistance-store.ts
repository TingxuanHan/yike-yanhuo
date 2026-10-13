import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  cleanAssistSnapshot,
  cleanAssistProposal,
  type AssistView,
} from "../shared/assistance.js";
import { ServiceError } from "./baidu.js";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
interface Row {
  id: string;
  owner: string;
  token_hash: string;
  body: string;
  expires: number;
  closed: number;
}
export class AssistanceStore {
  constructor(
    private db: DatabaseSync,
    private now = () => Date.now(),
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS assistance(id TEXT PRIMARY KEY, owner TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0);`,
    );
  }
  private prune() {
    this.db
      .prepare(
        "UPDATE assistance SET body='',closed=1 WHERE expires<=? AND closed=0",
      )
      .run(this.now());
    this.db
      .prepare("DELETE FROM assistance WHERE expires<?")
      .run(this.now() - 86400000);
  }
  private row(id: unknown, owner?: string, token?: unknown) {
    this.prune();
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw new ServiceError("协助链接不完整。", 400);
    const row = this.db
      .prepare("SELECT * FROM assistance WHERE id=?")
      .get(id) as unknown as Row | undefined;
    const allowed =
      row &&
      (owner
        ? row.owner === owner
        : typeof token === "string" &&
          /^[A-Za-z0-9_-]{43}$/.test(token) &&
          row.token_hash === digest(token));
    if (!allowed)
      throw new ServiceError("无法访问这次协助，请让家人重新发送链接。", 404);
    if (row.closed || row.expires <= this.now())
      throw new ServiceError("这次协助已结束或到期，请重新发起。", 410);
    return row;
  }
  read(id: unknown, owner?: string, token?: unknown): AssistView {
    return JSON.parse(this.row(id, owner, token).body);
  }
  list(owner: string) {
    this.prune();
    return (
      this.db
        .prepare(
          "SELECT body FROM assistance WHERE owner=? AND closed=0 ORDER BY expires DESC",
        )
        .all(owner) as { body: string }[]
    ).map((r) => JSON.parse(r.body) as AssistView);
  }
  create(owner: string, input: unknown) {
    const snapshot = cleanAssistSnapshot(input);
    const active = this.list(owner);
    if (active.some((v) => v.snapshot.tripId === snapshot.tripId))
      throw new ServiceError(
        "这趟已有协助，请恢复现有会话，或结束后重新发起。",
        409,
      );
    if (active.length >= 3)
      throw new ServiceError("请先结束其他协助，再发起新会话。", 409);
    const invite = randomBytes(32).toString("base64url"),
      id = randomUUID();
    const view: AssistView = {
      id,
      revision: 1,
      snapshotVersion: 1,
      expiresAt: this.now() + 3600000,
      updatedAt: this.now(),
      snapshot,
      proposal: null,
      outcome: "等待家人建议",
    };
    this.db
      .prepare(
        "INSERT INTO assistance (id,owner,token_hash,body,expires) VALUES (?,?,?,?,?)",
      )
      .run(id, owner, digest(invite), JSON.stringify(view), view.expiresAt);
    return { view, invite };
  }
  private check(view: AssistView, revision: unknown) {
    if (revision !== view.revision)
      throw new ServiceError("协助内容已更新，请刷新后再操作。", 409);
  }
  private save(view: AssistView) {
    view.revision++;
    view.updatedAt = this.now();
    this.db
      .prepare("UPDATE assistance SET body=? WHERE id=?")
      .run(JSON.stringify(view), view.id);
    return view;
  }
  update(id: string, owner: string, revision: unknown, input: unknown) {
    const view = this.read(id, owner);
    this.check(view, revision);
    const snapshot = cleanAssistSnapshot(input);
    if (snapshot.tripId !== view.snapshot.tripId)
      throw new ServiceError("不能将另一次行程放进当前协助。", 400);
    if (JSON.stringify(snapshot) === JSON.stringify(view.snapshot)) return view;
    view.snapshot = snapshot;
    view.snapshotVersion++;
    if (view.proposal) {
      view.proposal = null;
      view.outcome = "行程或照片已更新，旧建议已失效";
    }
    return this.save(view);
  }
  propose(id: string, token: unknown, revision: unknown, input: unknown) {
    const view = this.read(id, undefined, token);
    // Retry of an acknowledged proposal must not create a second suggestion.
    if (
      view.proposal &&
      typeof input === "object" &&
      input &&
      "id" in input &&
      input.id === view.proposal.id
    ) {
      const retry = cleanAssistProposal(input, view);
      if (JSON.stringify(retry) === JSON.stringify(view.proposal)) return view;
    }
    this.check(view, revision);
    if (view.proposal)
      throw new ServiceError("已有建议等待本人确认，请等对方处理。", 409);
    view.proposal = cleanAssistProposal(input, view);
    view.outcome = "建议已送达，等待本人确认";
    return this.save(view);
  }
  resolve(
    id: string,
    owner: string,
    revision: unknown,
    proposalId: unknown,
    decision: unknown,
  ) {
    const view = this.read(id, owner);
    this.check(view, revision);
    if (
      !view.proposal ||
      proposalId !== view.proposal.id ||
      !["accepted", "rejected"].includes(String(decision))
    )
      throw new ServiceError("建议已变化，请刷新后核对。", 409);
    view.proposal = null;
    view.outcome =
      decision === "accepted" ? "本人已采纳建议" : "本人保留原安排";
    return this.save(view);
  }
  close(id: string, owner: string) {
    this.prune();
    const row = this.db
      .prepare("SELECT owner FROM assistance WHERE id=?")
      .get(id) as { owner: string } | undefined;
    if (!row || row.owner !== owner)
      throw new ServiceError("协助不存在。", 404);
    this.db
      .prepare("UPDATE assistance SET body='',closed=1 WHERE id=?")
      .run(id);
    return { ok: true };
  }
}
