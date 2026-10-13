import {
  makeAssistSnapshot,
  type AssistView,
  type AssistProposal,
  type EntranceGuide,
} from "../shared/assistance.js";
import { tripBasis } from "../shared/trip-adjust.js";
import type { ActiveTrip } from "../shared/trip.js";
export * from "../shared/assistance.js";
export interface AssistState {
  view: AssistView | null;
  invite: string;
  busy: boolean;
  error: string;
  status: string;
}
interface Deps {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  active: () => ActiveTrip | null;
  notify: (state: AssistState) => void;
  confirm: (text: string) => Promise<boolean>;
  apply: (
    proposal: AssistProposal,
    snapshot: AssistView["snapshot"],
  ) => Promise<void>;
}
export class AssistanceSession {
  state: AssistState = {
    view: null,
    invite: "",
    busy: false,
    error: "",
    status: "",
  };
  private id = "";
  private alive = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private deps: Deps) {
    const saved = deps.get("yike-assistance") as {
      id?: string;
      invite?: string;
      tripId?: string;
    } | null;
    if (saved && /^[a-f0-9-]{36}$/.test(saved.id ?? "")) {
      this.id = saved.id!;
      this.state.invite = saved.invite ?? "";
    }
  }
  private emit() {
    this.deps.notify({ ...this.state });
  }
  close() {
    this.alive = false;
    clearTimeout(this.timer);
  }
  reopen() {
    this.alive = true;
    if (this.id) void this.refresh();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.alive && this.id)
      this.timer = setTimeout(() => void this.refresh(), 5000);
  }
  private async action(fn: () => Promise<void>) {
    if (this.state.busy) return;
    this.state.busy = true;
    this.state.error = "";
    this.emit();
    try {
      await fn();
    } catch (e) {
      this.state.error = (e as Error).message;
    } finally {
      this.state.busy = false;
      this.emit();
      this.schedule();
    }
  }
  async start(request: string, guide: EntranceGuide | null) {
    if (this.state.busy || this.id) return;
    const a = this.deps.active();
    if (!a) return;
    if (
      !(await this.deps.confirm(
        `分享本次出发点、最近确认的地点、剩余目的地${guide ? "和这张入口照片" : ""}？链接持有人可以查看和提出建议，修改仍需你确认；1小时到期，可随时结束。`,
      ))
    )
      return;
    await this.action(async () => {
      const active = this.deps.active();
      if (!active || active.id !== a.id)
        throw new Error("行程已变化，请重新发起。");
      const r = await this.deps.request<{ view: AssistView; invite: string }>(
        "/api/life/assistance",
        "POST",
        { snapshot: makeAssistSnapshot(active, request, guide) },
      );
      this.id = r.view.id;
      this.state.view = r.view;
      this.state.invite = r.invite;
      this.deps.set("yike-assistance", {
        id: this.id,
        tripId: active.id,
        invite: r.invite,
      });
      this.state.status = "协助已开启，请把协助卡发给信任的家人。";
    });
  }
  async restore() {
    await this.action(async () => {
      const a = this.deps.active();
      const rows = await this.deps.request<AssistView[]>(
        "/api/life/assistance",
      );
      const view = rows.find((v) => v.snapshot.tripId === a?.id);
      if (!view) throw new Error("没有可恢复的协助，请发起新会话。");
      this.id = view.id;
      this.state.view = view;
      this.state.invite = "";
      this.deps.set("yike-assistance", {
        id: this.id,
        tripId: a!.id,
        invite: "",
      });
      this.state.status = "已恢复协助。若家人没有原链接，可结束后重新发起。";
    });
  }
  private clear() {
    this.id = "";
    this.state.view = null;
    this.state.invite = "";
    this.deps.set("yike-assistance", null);
    this.deps.set("yike-assist-decision", null);
  }
  async refresh() {
    if (!this.id) return;
    await this.action(async () => {
      const a = this.deps.active();
      if (!a || (this.state.view && a.id !== this.state.view.snapshot.tripId)) {
        await this.deps.request(`/api/life/assistance/${this.id}`, "DELETE");
        this.clear();
        return;
      }
      let view = await this.deps.request<AssistView>(
        `/api/life/assistance/${this.id}`,
      );
      if (view.snapshot.tripId !== a.id) {
        await this.deps.request(`/api/life/assistance/${this.id}`, "DELETE");
        this.clear();
        return;
      }
      const receipt = this.deps.get("yike-assist-decision") as {
        id: string;
        proposalId: string;
        decision: string;
      } | null;
      if (receipt?.id === this.id) {
        if (view.proposal?.id === receipt.proposalId)
          view = await this.deps.request<AssistView>(
            `/api/life/assistance/${this.id}/decision`,
            "POST",
            { revision: view.revision, ...receipt },
          );
        this.deps.set("yike-assist-decision", null);
      }
      if (view.snapshot.basis !== tripBasis(a))
        view = await this.deps.request<AssistView>(
          `/api/life/assistance/${this.id}`,
          "PUT",
          {
            revision: view.revision,
            snapshot: makeAssistSnapshot(
              a,
              view.snapshot.request,
              view.snapshot.guide,
            ),
          },
        );
      this.state.view = view;
      this.state.status = view.outcome;
    });
  }
  async sharePhoto(guide: EntranceGuide) {
    if (!this.id || !this.deps.active()) return;
    if (
      !(await this.deps.confirm(
        "把这张照片及入口说明分享给本次协助的家人？旧照片上的待处理建议会失效。",
      ))
    )
      return;
    await this.action(async () => {
      const view = await this.deps.request<AssistView>(
        `/api/life/assistance/${this.id}`,
      );
      this.state.view = await this.deps.request<AssistView>(
        `/api/life/assistance/${this.id}`,
        "PUT",
        {
          revision: view.revision,
          snapshot: makeAssistSnapshot(
            this.deps.active()!,
            view.snapshot.request,
            guide,
          ),
        },
      );
      this.state.status = "照片已分享，家人现在可以标记入口。";
    });
  }
  async decide(accept: boolean) {
    const displayed = this.state.view?.proposal;
    if (!this.id || !displayed) return;
    await this.action(async () => {
      const view = await this.deps.request<AssistView>(
          `/api/life/assistance/${this.id}`,
        ),
        a = this.deps.active();
      this.state.view = view;
      if (
        !a ||
        view.proposal?.id !== displayed.id ||
        view.snapshot.basis !== tripBasis(a)
      )
        throw new Error("行程或建议已变化，请刷新后再核对。");
      if (accept) await this.deps.apply(view.proposal, view.snapshot);
      const receipt = {
        id: this.id,
        proposalId: displayed.id,
        decision: accept ? "accepted" : "rejected",
      };
      this.deps.set("yike-assist-decision", receipt);
      this.state.view = await this.deps.request<AssistView>(
        `/api/life/assistance/${this.id}/decision`,
        "POST",
        { revision: view.revision, ...receipt },
      );
      this.deps.set("yike-assist-decision", null);
      this.state.status = accept
        ? "已采纳，行程仍由你确认到达。"
        : "已保留原安排。";
    });
  }
  async end() {
    if (!this.id) return;
    await this.action(async () => {
      await this.deps.request(`/api/life/assistance/${this.id}`, "DELETE");
      this.clear();
      this.state.status = "协助已结束，原链接已失效。";
    });
  }
}
