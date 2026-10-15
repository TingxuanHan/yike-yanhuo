import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ServiceError } from "./baidu.js";
import {
  cleanNoticeQuery,
  cleanObservation,
  noticeKind,
  noticeRelation,
  noticeTarget,
  summarizeNotice,
  targetKey,
  type NoticeRecord,
  type NoticeTarget,
  type NoticeKind,
  type NoticeView,
  type NoticeFeed,
} from "../shared/neighborhood.js";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
type Row = { id: string; kind: NoticeKind; target: string; touched: number };
export class NeighborhoodStore {
  constructor(
    private db: DatabaseSync,
    private now = () => Date.now(),
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS neighbor_events(id TEXT PRIMARY KEY, target_key TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, touched INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS neighbor_target ON neighbor_events(target_key,kind);
      CREATE TABLE IF NOT EXISTS neighbor_observations(event TEXT NOT NULL, actor TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(event,actor));
      CREATE TABLE IF NOT EXISTS neighbor_audit(event TEXT NOT NULL, actor TEXT NOT NULL, body TEXT NOT NULL, received INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS neighbor_requests(actor TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, event TEXT NOT NULL, received INTEGER NOT NULL, PRIMARY KEY(actor,request));`);
  }
  private sweep() {
    const before = this.now() - 30 * 86400000;
    this.db
      .prepare(
        "DELETE FROM neighbor_observations WHERE event IN (SELECT id FROM neighbor_events WHERE touched<?)",
      )
      .run(before);
    this.db.prepare("DELETE FROM neighbor_events WHERE touched<?").run(before);
    this.db.prepare("DELETE FROM neighbor_audit WHERE received<?").run(before);
    this.db
      .prepare("DELETE FROM neighbor_requests WHERE received<?")
      .run(before);
  }
  private row(id: string): Row {
    const row = this.db
      .prepare("SELECT * FROM neighbor_events WHERE id=?")
      .get(id) as Row | undefined;
    if (!row)
      throw new ServiceError("这条提醒已移除或过了保留期限，请刷新。", 404);
    return row;
  }
  private records(id: string): NoticeRecord[] {
    return (
      this.db
        .prepare("SELECT body FROM neighbor_observations WHERE event=?")
        .all(id) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  private view(row: Row, actor: string): NoticeView {
    const records = this.records(row.id),
      target: NoticeTarget = JSON.parse(row.target);
    const mine = records.find((r) => r.actor === actor);
    const publicObservation = (r: NoticeRecord) => ({
      state: r.state,
      basis: r.basis,
      at: r.at,
      note: r.note,
    });
    return {
      id: row.id,
      target,
      kind: row.kind,
      kindLabel: noticeKind(row.kind).label,
      ...summarizeNotice(row.kind, records, this.now()),
      demo: target.position.system === "demo",
      distance: 0,
      relation: "",
      mine: mine
        ? {
            ...publicObservation(mine),
            version: mine.version,
            withdrawn: mine.withdrawn,
          }
        : null,
      notes: records
        .filter((r) => !r.withdrawn)
        .sort((a, b) => b.at - a.at)
        .slice(0, 5)
        .map((r) => ({ ...publicObservation(r), receivedAt: r.receivedAt })),
    };
  }
  query(owner: string, raw: unknown): NoticeFeed {
    const q = cleanNoticeQuery(raw),
      actor = digest(owner);
    this.sweep();
    const rows = this.db
      .prepare("SELECT * FROM neighbor_events ORDER BY touched DESC")
      .all() as Row[];
    const notices = rows.flatMap((row) => {
      const relation = noticeRelation(JSON.parse(row.target), row.kind, q);
      if (!relation) return [];
      const view = this.view(row, actor);
      return view.state === "withdrawn" && !view.mine
        ? []
        : [{ ...view, ...relation }];
    });
    const priority = {
      conflict: 0,
      supported: 1,
      unverified: 2,
      clear: 3,
      expired: 4,
      withdrawn: 5,
    };
    notices.sort(
      (a, b) =>
        priority[a.state] - priority[b.state] ||
        a.distance - b.distance ||
        (b.lastObserved ?? 0) - (a.lastObserved ?? 0),
    );
    return {
      asOf: this.now(),
      notices: notices.slice(0, 50),
      truncated: notices.length > 50,
    };
  }
  write(
    owner: string,
    id: string | null,
    raw: Record<string, unknown>,
  ): NoticeView {
    if (raw.share !== true)
      throw new ServiceError(
        "请确认把这次观察共享给使用同一服务的其他用户。",
        400,
      );
    if (
      typeof raw.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{12,80}$/.test(raw.requestId)
    )
      throw new ServiceError("提交编号无效，请重新打开提醒。", 400);
    const actor = digest(owner),
      fingerprint = digest(JSON.stringify([id, raw]));
    this.sweep();
    const receipt = this.db
      .prepare("SELECT * FROM neighbor_requests WHERE actor=? AND request=?")
      .get(actor, raw.requestId) as
      { fingerprint: string; event: string } | undefined;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new ServiceError("这次提交内容已变化，请刷新后重新提交。", 409);
      return this.view(this.row(receipt.event), actor);
    }
    const observation =
      raw.withdraw === true
        ? null
        : cleanObservation(raw.observation, this.now());
    if (!id && (!observation || observation.state !== "present"))
      throw new ServiceError(
        "新提醒需要填写你发现的问题；恢复反馈请在原提醒下确认。",
        400,
      );
    const count = this.db
      .prepare(
        "SELECT count(*) AS n FROM neighbor_audit WHERE actor=? AND received>?",
      )
      .get(actor, this.now() - 86400000) as { n: number };
    if (count.n >= 40)
      throw new ServiceError(
        "今天的共享操作较多，请明天再补充；已有提醒仍可查看。",
        429,
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let row: Row;
      if (!id) {
        const target = noticeTarget(raw.target),
          kind = noticeKind(raw.kind).id,
          key = targetKey(target);
        const existing = this.db
          .prepare(
            "SELECT * FROM neighbor_events WHERE target_key=? AND kind=? ORDER BY touched DESC LIMIT 1",
          )
          .get(key, kind) as Row | undefined;
        if (existing) row = existing;
        else {
          const total = this.db
            .prepare("SELECT count(*) AS n FROM neighbor_events")
            .get() as { n: number };
          if (total.n >= 5000)
            throw new ServiceError(
              "提醒容量暂满，请联系维护者清理过期记录。",
              503,
            );
          row = {
            id: randomUUID(),
            kind,
            target: JSON.stringify(target),
            touched: this.now(),
          };
          this.db
            .prepare("INSERT INTO neighbor_events VALUES(?,?,?,?,?)")
            .run(row.id, key, row.kind, row.target, row.touched);
        }
      } else row = this.row(id);
      const mine = this.records(row.id).find((r) => r.actor === actor);
      if (raw.version !== (mine?.version ?? 0))
        throw new ServiceError(
          "你的另一台设备已更新反馈，请刷新后核对再提交。",
          409,
        );
      if (raw.withdraw === true && (!mine || mine.withdrawn))
        throw new ServiceError("没有可撤回的本人反馈。", 409);
      const record: NoticeRecord = {
        ...(observation ?? mine!),
        actor,
        version: (mine?.version ?? 0) + 1,
        receivedAt: this.now(),
        withdrawn: raw.withdraw === true,
      };
      const body = JSON.stringify(record);
      this.db
        .prepare(
          "INSERT INTO neighbor_observations VALUES(?,?,?) ON CONFLICT(event,actor) DO UPDATE SET body=excluded.body",
        )
        .run(row.id, actor, body);
      this.db
        .prepare("INSERT INTO neighbor_audit VALUES(?,?,?,?)")
        .run(row.id, actor, body, this.now());
      this.db
        .prepare("UPDATE neighbor_events SET touched=? WHERE id=?")
        .run(this.now(), row.id);
      this.db
        .prepare("INSERT INTO neighbor_requests VALUES(?,?,?,?,?)")
        .run(actor, raw.requestId, fingerprint, row.id, this.now());
      this.db.exec("COMMIT");
      return this.view(row, actor);
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
