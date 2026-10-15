import {
  NOTICE_DRAFT_KEY,
  NOTICE_KINDS,
  cleanNoticeQuery,
  cleanObservation,
  noticeTarget,
  type NoticeFeed,
  type NoticeKind,
  type NoticeQuery,
  type NoticeTarget,
  type NoticeView,
  type ObservationState,
} from "../shared/neighborhood.js";
export { NOTICE_KINDS };
import type { WalkingGuide, WalkingLeg } from "../shared/walking-guide.js";
export function guideNotices(leg: WalkingLeg, guide: WalkingGuide | null) {
  let path = guide?.path;
  let target = { name: leg.to.name, position: path?.at(-1) ?? leg.to.position };
  try {
    cleanNoticeQuery({ target, ...(path ? { path } : {}) });
  } catch {
    path = undefined;
    target = { name: leg.to.name, position: leg.to.position };
  }
  return {
    query: cleanNoticeQuery({ target, ...(path ? { path } : {}) }),
    choices: [
      { ...target, label: "目的地附近" },
      ...(path ? guide!.steps : []).flatMap((step, i) =>
        step.position
          ? [
              {
                name: `路段${i + 1}附近`,
                position: step.position,
                label: `第${i + 1}段起点：${step.instruction}`,
              },
            ]
          : [],
      ),
    ],
  };
}
interface Deps {
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  confirm: (message: string) => Promise<boolean>;
  notify: (state: NeighborhoodView) => void;
  now?: () => number;
}
export interface NoticeChoice extends NoticeTarget {
  label: string;
}
export interface NeighborhoodView {
  open: boolean;
  busy: boolean;
  error: string;
  status: string;
  feed: NoticeFeed | null;
  stale: boolean;
  asOf: string;
  editor: boolean;
  editing: string | null;
  kind: NoticeKind;
  observation: ObservationState;
  basis: "seen" | "heard";
  at: number;
  atLabel: string;
  age: number;
  note: string;
  name: string;
  share: boolean;
  choice: number;
  choices: NoticeChoice[];
  targetLabel: string;
  demo: boolean;
  stepsOnly: boolean;
  hasPath: boolean;
  draft: boolean;
  notices: (NoticeView & { observedLabel: string; notesLabel: string[] })[];
}
export class NeighborhoodSession {
  state: NeighborhoodView;
  private query: NoticeQuery;
  private epoch = 0;
  private live = true;
  private mineVersion = 0;
  private pending: { fingerprint: string; requestId: string } | null = null;
  private now: () => number;
  constructor(
    query: NoticeQuery,
    choices: NoticeChoice[],
    private deps: Deps,
  ) {
    this.query = cleanNoticeQuery(query);
    this.now = deps.now ?? Date.now;
    this.state = {
      open: false,
      busy: false,
      error: "",
      status: "",
      feed: null,
      stale: false,
      asOf: "",
      editor: false,
      editing: null,
      kind: "entrance_blocked",
      observation: "present",
      basis: "seen",
      at: this.now(),
      atLabel: "",
      age: 0,
      note: "",
      name: query.target.name,
      share: false,
      choice: 0,
      choices: choices.length
        ? choices.map((c) => ({ ...noticeTarget(c), label: c.label }))
        : [{ ...this.query.target, label: "这个地点附近" }],
      targetLabel: query.target.name,
      demo: query.target.position.system === "demo",
      stepsOnly: false,
      hasPath: !!query.path,
      draft: false,
      notices: [],
    };
    this.checkDraft();
  }
  private context() {
    return JSON.stringify(this.query);
  }
  private checkDraft() {
    try {
      const d = this.deps.get(NOTICE_DRAFT_KEY) as { context?: string };
      this.state.draft = d?.context === this.context();
    } catch {
      this.state.draft = false;
    }
  }
  private emit() {
    if (!this.live) return;
    const s = this.state,
      now = this.now();
    s.atLabel = new Date(s.at).toLocaleString("zh-CN");
    s.asOf = s.feed ? new Date(s.feed.asOf).toLocaleString("zh-CN") : "";
    if (
      s.feed &&
      (now < s.feed.asOf ||
        now - s.feed.asOf >= 300000 ||
        s.feed.notices.some(
          (n) => n.nextChangeAt !== null && now >= n.nextChangeAt,
        ))
    )
      s.stale = true;
    s.notices = (s.feed?.notices ?? []).map((n) => ({
      ...n,
      observedLabel: n.lastObserved
        ? new Date(n.lastObserved).toLocaleString("zh-CN")
        : "无保留的观察",
      notesLabel: n.notes.map(
        (o) =>
          `${o.basis === "seen" ? "亲见" : "转述"} · ${o.state === "present" ? "问题仍在" : o.state === "clear" ? "已可通行或营业" : "不能确认"} · ${new Date(o.at).toLocaleString("zh-CN")}：${o.note}`,
      ),
    }));
    this.deps.notify({ ...s });
  }
  tick() {
    this.emit();
  }
  reopen() {
    this.live = true;
    this.state.busy = false;
    this.emit();
  }
  dispose() {
    this.live = false;
    this.epoch++;
  }
  toggle() {
    this.state.open = !this.state.open;
    this.emit();
    if (this.state.open && !this.state.feed) void this.refresh();
  }
  async refresh() {
    if (this.state.busy) return;
    const epoch = ++this.epoch;
    this.state.busy = true;
    this.state.error = "";
    this.emit();
    try {
      const feed = await this.deps.request<NoticeFeed>(
        "/api/neighborhood/query",
        "POST",
        { ...this.query, stepsOnly: this.state.stepsOnly },
      );
      if (!this.live || epoch !== this.epoch) return;
      if (!feed || !Number.isFinite(feed.asOf) || !Array.isArray(feed.notices))
        throw new Error("提醒响应不完整，请稍后刷新。");
      this.state.feed = feed;
      this.state.stale = false;
    } catch (e) {
      if (this.live && epoch === this.epoch) {
        this.state.error = (e as Error).message;
        this.state.stale = true;
      }
    } finally {
      if (this.live && epoch === this.epoch) {
        this.state.busy = false;
        this.emit();
      }
    }
  }
  filter(value: boolean) {
    if (this.state.busy) return;
    this.state.stepsOnly = value;
    this.state.feed = null;
    void this.refresh();
  }
  begin(id?: string, state: ObservationState = "present") {
    if (this.state.busy) return;
    const item = id ? this.state.feed?.notices.find((n) => n.id === id) : null;
    if (id && !item) return;
    this.mineVersion = item?.mine?.version ?? 0;
    Object.assign(this.state, {
      editor: true,
      editing: id ?? null,
      kind: item?.kind ?? "entrance_blocked",
      observation: state,
      basis: "seen",
      at: this.now(),
      age: 0,
      note: "",
      name: item?.target.name ?? this.query.target.name,
      share: false,
      choice: 0,
      error: "",
      status: "",
    });
    this.pending = null;
    this.emit();
  }
  field(
    key: "note" | "name" | "kind" | "basis" | "share" | "observation",
    value: string | boolean,
  ) {
    if (this.state.busy) return;
    Object.assign(this.state, { [key]: value });
    this.emit();
  }
  choose(index: number) {
    if (this.state.busy || this.state.editing || !this.state.choices[index])
      return;
    this.state.choice = index;
    this.state.name = this.state.choices[index].name;
    this.emit();
  }
  age(minutes: number) {
    if (this.state.busy || ![0, 15, 60, 180, 720, 1440].includes(minutes))
      return;
    this.state.age = minutes;
    this.state.at = this.now() - minutes * 60000;
    this.emit();
  }
  private draftData() {
    const s = this.state;
    return {
      context: this.context(),
      form: {
        editing: s.editing,
        kind: s.kind,
        observation: s.observation,
        basis: s.basis,
        at: s.at,
        age: s.age,
        note: s.note,
        name: s.name,
        choice: s.choice,
      },
      version: this.mineVersion,
      pending: this.pending,
    };
  }
  saveDraft() {
    try {
      const d = this.draftData();
      this.deps.set(NOTICE_DRAFT_KEY, d);
      if (JSON.stringify(this.deps.get(NOTICE_DRAFT_KEY)) !== JSON.stringify(d))
        throw new Error();
      this.state.draft = true;
      this.state.status = "草稿仅保存在本机，尚未共享。";
    } catch {
      this.state.error = "草稿保存失败，请保持页面打开；内容尚未共享。";
    }
    this.emit();
  }
  restore() {
    try {
      const d = this.deps.get(NOTICE_DRAFT_KEY) as ReturnType<
        NeighborhoodSession["draftData"]
      >;
      if (
        !d ||
        d.context !== this.context() ||
        !this.state.choices[d.form.choice]
      )
        throw new Error();
      if (
        !Number.isFinite(d.form.at) ||
        typeof d.form.note !== "string" ||
        d.form.note.length > 240 ||
        typeof d.form.name !== "string" ||
        d.form.name.length > 80 ||
        !["seen", "heard"].includes(d.form.basis) ||
        !["present", "clear", "unsure"].includes(d.form.observation)
      )
        throw new Error();
      if (!NOTICE_KINDS.some((k) => k.id === d.form.kind)) throw new Error();
      Object.assign(this.state, d.form, {
        editor: true,
        share: false,
        status: "已恢复本机草稿，请重新核对时间并确认共享。",
      });
      this.mineVersion = d.version;
      this.pending = d.pending;
    } catch {
      this.state.error = "草稿已过期或格式无效，可重新填写。";
    }
    this.emit();
  }
  cancel() {
    if (!this.state.busy) {
      this.state.editor = false;
      this.state.share = false;
      this.emit();
    }
  }
  async submit() {
    if (this.state.busy) return;
    const s = this.state;
    try {
      if (!s.share) throw new Error("请先确认共享范围。");
      const observation = cleanObservation(
        { state: s.observation, basis: s.basis, at: s.at, note: s.note },
        this.now(),
      );
      const target = noticeTarget({
        name: s.name,
        position: s.choices[s.choice].position,
      });
      const body = {
        share: true,
        version: this.mineVersion,
        observation,
        ...(s.editing ? {} : { target, kind: s.kind }),
      };
      await this.send(s.editing, body);
    } catch (e) {
      s.error = (e as Error).message;
      this.emit();
    }
  }
  async withdraw(id: string) {
    const item = this.state.feed?.notices.find((n) => n.id === id);
    if (this.state.busy || !item?.mine || item.mine.withdrawn) return;
    if (
      !(await this.deps.confirm(
        "撤回自己的这份反馈？其他用户的观察会保留；你的反馈将不再计入当前提醒。",
      ))
    )
      return;
    await this.send(id, {
      share: true,
      version: item.mine.version,
      withdraw: true,
    });
  }
  private async send(id: string | null, body: Record<string, unknown>) {
    if (this.state.busy || !this.live) return;
    const fingerprint = JSON.stringify([id, body]);
    if (!this.pending || this.pending.fingerprint !== fingerprint)
      this.pending = {
        fingerprint,
        requestId: `notice_${this.now()}_${Math.random().toString(36).slice(2, 12)}`,
      };
    this.state.busy = true;
    this.state.error = "";
    this.state.status = "";
    this.emit();
    try {
      await this.deps.request<NoticeView>(
        `/api/neighborhood/events${id ? "/" + id : ""}`,
        "POST",
        { ...body, requestId: this.pending.requestId },
      );
      if (!this.live) return;
      this.state.editor = false;
      this.state.share = false;
      this.state.stale = true;
      this.pending = null;
      this.state.status = body.withdraw
        ? "你的反馈已撤回，其他记录保留。"
        : "反馈已共享。请刷新查看汇总，原行程保持不变。";
      try {
        const draft = this.deps.get(NOTICE_DRAFT_KEY) as { context?: string };
        if (draft?.context === this.context())
          this.deps.set(NOTICE_DRAFT_KEY, null);
      } catch {
        this.state.status += "旧草稿未能清除。";
      }
      this.checkDraft();
    } catch (e) {
      if (this.live) {
        this.state.error =
          (e as Error).message + " 输入已保留；连接中断时可用相同内容重试。";
        this.state.stale = true;
      }
    } finally {
      if (this.live) {
        this.state.busy = false;
        this.emit();
      }
    }
  }
}
