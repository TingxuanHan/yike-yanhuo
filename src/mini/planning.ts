import {
  aiPresets,
  cleanPlanning,
  emptyPlanning,
  planningNotes,
  type AiStatus,
  type PlanningDraft,
} from "../shared/planning.js";
export * from "../shared/planning.js";
export const planningFields = [
  {
    key: "tripMinutes",
    label: "整趟上限（分钟）",
    hint: "5—180，包含停留和返程",
    type: "number",
  },
  {
    key: "shoppingBudget",
    label: "购物预算（元）",
    hint: "1—10000，仅用于购物",
    type: "number",
  },
  { key: "departure", label: "出发时刻", hint: "例如09:00", type: "text" },
  {
    key: "speedMps",
    label: "舒适步速（米/秒）",
    hint: "0.3—2，按自己的习惯",
    type: "number",
  },
  {
    key: "walkingMinutes",
    label: "希望步行（分钟）",
    hint: "1—90，后续在步行安排核对",
    type: "number",
  },
] as const;
const formOf = (p: PlanningDraft) =>
  Object.fromEntries(
    planningFields.map((f) => [
      f.key,
      p[f.key] === null ? "" : String(p[f.key]),
    ]),
  ) as Record<(typeof planningFields)[number]["key"], string>;
export interface PlanningView {
  text: string;
  mode: "free" | "own" | "manual";
  busy: boolean;
  error: string;
  status: string;
  service: AiStatus | null;
  settings: boolean;
  baseUrl: string;
  model: string;
  key: string;
  reviewed: boolean;
  form: ReturnType<typeof formOf>;
  tasks: string[];
  items: string;
  returnChoice: string;
  notes: string[];
  source: string;
}
interface Deps {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  notify: (s: PlanningView) => void;
}
export class PlanningSession {
  state: PlanningView = {
    text: "",
    mode: "free",
    busy: false,
    error: "",
    status: "",
    service: null,
    settings: false,
    baseUrl: aiPresets[0].baseUrl,
    model: aiPresets[0].model,
    key: "",
    reviewed: false,
    form: formOf(emptyPlanning()),
    tasks: [],
    items: "",
    returnChoice: "",
    notes: [],
    source: "",
  };
  private alive = true;
  constructor(private deps: Deps) {
    try {
      const raw = deps.get("yike-planning-draft") as {
        text: string;
        draft: PlanningDraft;
      } | null;
      if (raw && typeof raw.text === "string" && raw.text.length <= 600) {
        this.state.text = raw.text;
        this.fill(
          cleanPlanning(raw.draft),
          "已恢复本机条件，请核对后带入。",
          false,
        );
      }
    } catch {
      this.state.error = "上次条件草稿未能读取，请重新填写。";
    }
  }
  emit() {
    if (this.alive)
      this.deps.notify({
        ...this.state,
        form: { ...this.state.form },
        tasks: [...this.state.tasks],
      });
  }
  close() {
    this.alive = false;
    this.state.key = "";
  }
  hideKey() {
    this.state.key = "";
    this.emit();
  }
  message(s: string) {
    this.state.error = s;
    this.emit();
  }
  async refresh() {
    try {
      const s = await this.deps.request<AiStatus>("/api/ai/status");
      if (!this.alive) return;
      this.state.service = s;
      if (s.own.configured) {
        this.state.baseUrl = s.own.baseUrl;
        this.state.model = s.own.model;
      }
    } catch {
      this.state.service = null;
    }
    this.emit();
  }
  set(key: string, value: string) {
    if (this.state.busy) return;
    this.state.error = "";
    this.state.status = "";
    if (key in this.state.form)
      this.state.form[key as keyof typeof this.state.form] = value.slice(0, 10);
    else if (key === "text") this.state.text = value.slice(0, 600);
    else if (key === "items") this.state.items = value.slice(0, 150);
    else if (["baseUrl", "model", "key"].includes(key))
      this.state[key as "baseUrl" | "model" | "key"] = value.slice(0, 512);
    else if (key === "returnChoice" && ["", "yes", "no"].includes(value))
      this.state.returnChoice = value;
    this.emit();
  }
  mode(mode: string) {
    if (!this.state.busy && ["free", "own", "manual"].includes(mode)) {
      this.state.mode = mode as PlanningView["mode"];
      this.state.error = "";
      if (mode === "manual") this.state.reviewed = true;
      this.emit();
    }
  }
  toggleSettings() {
    this.state.settings = !this.state.settings;
    if (!this.state.settings) this.state.key = "";
    this.emit();
  }
  preset(i: number) {
    if (this.state.busy || !aiPresets[i]) return;
    this.state.baseUrl = aiPresets[i].baseUrl;
    this.state.model = aiPresets[i].model;
    this.state.key = "";
    this.emit();
  }
  task(id: string) {
    if (this.state.busy) return;
    const tasks = this.state.tasks.includes(id)
      ? this.state.tasks.filter((t) => t !== id)
      : [...this.state.tasks, id];
    if (tasks.length > 3) return this.message("最多选择三件事。");
    this.state.tasks = tasks;
    this.emit();
  }
  private fill(p: PlanningDraft, source: string, reviewed = true) {
    this.state.form = formOf(p);
    this.state.tasks = p.tasks;
    this.state.items = p.items.join("、");
    this.state.returnChoice =
      p.returnEasy === null ? "" : p.returnEasy ? "yes" : "no";
    this.state.reviewed = reviewed;
    this.state.source = source;
    this.state.notes = planningNotes(p);
  }
  draft(): PlanningDraft {
    const raw: Record<string, unknown> = {};
    for (const f of planningFields) {
      const v = this.state.form[f.key].trim();
      raw[f.key] = v ? (f.key === "departure" ? v : Number(v)) : null;
    }
    return cleanPlanning({
      ...raw,
      tasks: this.state.tasks,
      items: this.state.items
        .split(/[、,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      returnEasy:
        this.state.returnChoice === ""
          ? null
          : this.state.returnChoice === "yes",
    });
  }
  private async action(fn: () => Promise<void>) {
    if (this.state.busy) return;
    this.state.busy = true;
    this.state.error = "";
    this.state.status = "";
    this.emit();
    try {
      await fn();
    } catch (e) {
      this.state.error = (e as Error).message;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  async parse() {
    if (this.state.mode === "manual") {
      this.state.reviewed = true;
      this.emit();
      return;
    }
    const text = this.state.text,
      mode = this.state.mode;
    if (!text.trim()) return this.message("先说说这次想做什么。");
    await this.action(async () => {
      const result = await this.deps.request<{
        draft: PlanningDraft;
        model: string;
      }>("/api/ai/parse", "POST", { text, mode, requestId: this.id() });
      if (!this.alive) return;
      this.fill(
        cleanPlanning(result.draft),
        `由${result.model}整理 · 尚未应用`,
      );
      this.deps.set("yike-planning-draft", { text, draft: this.draft() });
      await this.refresh();
    });
  }
  private id() {
    return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  async saveSettings() {
    const input = {
      baseUrl: this.state.baseUrl,
      model: this.state.model,
      key: this.state.key,
    };
    await this.action(async () => {
      try {
        this.state.service = await this.deps.request<AiStatus>(
          "/api/ai/settings",
          "PUT",
          input,
        );
        this.state.status = "接口已加密保存，仅当前设备可使用。";
      } finally {
        this.state.key = "";
      }
    });
  }
  async removeSettings() {
    await this.action(async () => {
      this.state.service = await this.deps.request<AiStatus>(
        "/api/ai/settings",
        "DELETE",
      );
      this.state.key = "";
      this.state.status = "当前设备的接口已删除。";
    });
  }
  async testSettings() {
    await this.action(async () => {
      await this.deps.request("/api/ai/parse", "POST", {
        mode: "own",
        text: "45分钟内买菜回来，预算50元。",
        requestId: this.id(),
      });
      this.state.status = "连接成功，已用一条固定示例验证条件整理。";
      await this.refresh();
    });
  }
  confirm(): PlanningDraft {
    if (this.state.busy) throw new Error("请等本次整理结束。");
    const p = this.draft();
    if (p.walkingMinutes && p.tripMinutes && p.walkingMinutes > p.tripMinutes)
      throw new Error("步行目标超过整趟时间，请先修改。");
    this.state.notes = planningNotes(p);
    this.deps.set("yike-planning-draft", { text: this.state.text, draft: p });
    return p;
  }
}
