import {
  contourAuditPlan,
  executeContourAudit,
  contourAuditView,
  parseContourAudit,
} from "../core/contour-audit.js";
import { DemoProvider } from "../core/demo.js";
import { parseResultFile } from "../shared/result-file.js";
import type { AnalysisResult, Job } from "../shared/types.js";
import type {
  ContourAuditPlan,
  ContourAuditResult,
} from "../shared/contour-audit.js";

export interface ContourAuditState {
  busy: boolean;
  prepared: boolean;
  error: string;
  status: string;
  plan: ContourAuditPlan | null;
  view: ReturnType<typeof contourAuditView> | null;
}
export class ContourAuditSession {
  state: ContourAuditState = {
    busy: false,
    prepared: false,
    error: "",
    status: "",
    plan: null,
    view: null,
  };
  private source: AnalysisResult | null = null;
  private minutes = 15;
  private count = 6;
  private epoch = 0;
  private alive = true;
  private prepared: {
    fingerprint?: string;
    requestId: string;
    plan: ContourAuditPlan;
  } | null = null;
  private audit: ContourAuditResult | null = null;
  private job: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private rejectWait: ((error: Error) => void) | undefined;
  constructor(
    private deps: {
      request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
      notify: (state: ContourAuditState) => void;
      delayMs?: number;
    },
  ) {}
  private emit() {
    if (this.alive) this.deps.notify({ ...this.state });
  }
  private current(token: number) {
    return this.alive && token === this.epoch;
  }
  private cancelJob(id: string) {
    void this.deps.request(`/api/analyses/${id}`, "DELETE").catch(() => {});
  }
  stop(announce = true) {
    this.epoch++;
    clearTimeout(this.timer);
    this.rejectWait?.(new Error("复核已停止"));
    this.rejectWait = undefined;
    if (this.job) this.cancelJob(this.job);
    this.job = null;
    this.state.busy = false;
    this.prepared = null;
    this.state.prepared = false;
    if (announce)
      this.state.status = "已停止等待；已发出的读取可能计入用量，原报告保留。";
    this.emit();
  }
  setInput(source: AnalysisResult | null, minutes: number, count: number) {
    if (
      this.source === source &&
      this.minutes === minutes &&
      this.count === count
    )
      return;
    this.stop(false);
    this.source = source;
    this.minutes = minutes;
    this.count = count;
    this.audit = null;
    this.state = {
      busy: false,
      prepared: false,
      error: "",
      status: "",
      plan: null,
      view: null,
    };
    this.emit();
  }
  async preview() {
    if (this.state.busy || !this.source || !this.alive) return;
    this.stop(false);
    const token = this.epoch,
      source = this.source;
    this.audit = null;
    this.state = {
      busy: true,
      prepared: false,
      error: "",
      status: "正在固定复核位置和原预测",
      plan: null,
      view: null,
    };
    this.emit();
    try {
      const local = contourAuditPlan(source, this.minutes, this.count);
      const value =
        source.mode === "demo"
          ? { plan: local, fingerprint: undefined }
          : await this.deps.request<{
              plan: ContourAuditPlan;
              fingerprint: string;
            }>("/api/contour-audit/preview", "POST", {
              result: source,
              minutes: this.minutes,
              count: this.count,
            });
      if (!this.current(token)) return;
      if (
        JSON.stringify(value.plan) !== JSON.stringify(local) ||
        (source.mode === "baidu" &&
          !/^[a-f0-9]{64}$/.test(value.fingerprint ?? ""))
      )
        throw new Error("预览方案与当前报告不一致，请重新预览。");
      this.prepared = {
        ...value,
        requestId: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
      this.state.plan = value.plan;
      this.state.prepared = true;
      this.state.status =
        source.mode === "demo"
          ? "已固定示例点，确认后在本机演练。"
          : "已固定位置和预测，确认后才读取路线。";
    } catch (e) {
      if (this.current(token)) {
        this.state.error = (e as Error).message;
        this.state.status = "";
      }
    } finally {
      if (this.current(token)) {
        this.state.busy = false;
        this.emit();
      }
    }
  }
  async run() {
    if (!this.prepared || !this.source || this.state.busy || !this.alive)
      return;
    const token = this.epoch,
      source = this.source,
      prepared = this.prepared;
    this.state.busy = true;
    this.state.error = "";
    this.state.status = "先冻结预测，再读取固定位置";
    this.emit();
    try {
      let audit: ContourAuditResult;
      if (source.mode === "demo") {
        audit = await executeContourAudit(
          source,
          prepared.plan,
          new DemoProvider(),
          undefined,
          (done, total) => {
            if (this.current(token)) {
              this.state.status = `本机演练 ${done}/${total}`;
              this.emit();
            }
          },
        );
      } else {
        const started = await this.deps.request<{ id: string }>(
          "/api/contour-audit",
          "POST",
          {
            result: source,
            minutes: this.minutes,
            count: this.count,
            fingerprint: prepared.fingerprint,
            requestId: prepared.requestId,
            confirmed: true,
          },
        );
        if (!this.current(token)) {
          this.cancelJob(started.id);
          return;
        }
        this.job = started.id;
        const deadline = Date.now() + 300_000;
        for (;;) {
          const job = await this.deps.request<Job>(
            `/api/analyses/${started.id}`,
          );
          if (!this.current(token)) return;
          if (job.status === "done" && job.contourAudit) {
            audit = parseContourAudit(JSON.stringify(job.contourAudit));
            break;
          }
          if (job.status !== "running")
            throw new Error(job.error || "复核未完成，原报告保留。");
          if (Date.now() >= deadline)
            throw new Error("复核等待超时，请先停止并核对用量。");
          this.state.status = `${job.progress.stage} ${job.progress.done}/${job.progress.total}`;
          this.emit();
          await new Promise<void>((resolve, reject) => {
            this.rejectWait = reject;
            this.timer = setTimeout(() => {
              this.rejectWait = undefined;
              resolve();
            }, this.deps.delayMs ?? 800);
          });
          if (!this.current(token)) return;
        }
      }
      if (!this.current(token)) return;
      if (
        JSON.stringify(audit.report) !==
          JSON.stringify(parseResultFile(JSON.stringify(source))) ||
        JSON.stringify(audit.plan) !== JSON.stringify(prepared.plan)
      )
        throw new Error("返回的复核来源已变化，结果未采用。");
      this.audit = audit;
      this.state.view = contourAuditView(audit);
      this.job = null;
      this.prepared = null;
      this.state.prepared = false;
      this.state.status = "复核完成，原轮廓保持原样；可导出依据或重新预览。";
    } catch (e) {
      if (this.current(token)) {
        if (this.job) this.cancelJob(this.job);
        this.job = null;
        this.state.error = (e as Error).message;
        this.state.status = "复核未完成，原报告保留。";
      }
    } finally {
      if (this.current(token)) {
        this.state.busy = false;
        this.emit();
      }
    }
  }
  result() {
    if (!this.audit || !this.state.view)
      throw new Error("请先完成当前报告的抽点复核。");
    return this.audit;
  }
  dispose() {
    this.alive = false;
    this.stop(false);
  }
  reopen() {
    this.alive = true;
  }
}
