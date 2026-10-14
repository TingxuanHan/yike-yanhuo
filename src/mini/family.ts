import {
  cleanFamily,
  cleanLocation,
  latestLocation,
  locationSummary,
  tripLocation,
  LOCATION_KEY,
  cleanReceipt,
  type FamilyShare,
  type FamilySnapshot,
  type LocationRecord,
  type RealPosition,
} from "../shared/family.js";
export * from "../shared/family.js";
interface Deps {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  locate: () => Promise<LocationRecord>;
  confirm: (message: string) => Promise<boolean>;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  notify: (s: FamilyState) => void;
  speedMps: number;
  now?: () => number;
}
export interface FamilyState {
  phone: string;
  draftPhone: string;
  snapshot: FamilySnapshot | null;
  summary: ReturnType<typeof locationSummary>;
  share: FamilyShare | null;
  invite: string;
  shareOutdated: boolean;
  locating: boolean;
  busy: boolean;
  locationFailed: boolean;
  error: string;
  status: string;
  shareFresh: boolean;
  receiptStatus: string;
}
export class FamilySession {
  state: FamilyState;
  private alive = false;
  private epoch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private lastAttempt = -Infinity;
  private endRequested = false;
  private polling = false;
  private now: () => number;
  constructor(private deps: Deps) {
    this.now = deps.now ?? Date.now;
    const phone = String(deps.get("yike-help-phone") || "");
    this.state = {
      phone,
      draftPhone: phone,
      snapshot: null,
      summary: locationSummary(null),
      share: null,
      invite: "",
      shareOutdated: false,
      locating: false,
      busy: false,
      locationFailed: false,
      error: "",
      status: "",
      shareFresh: false,
      receiptStatus: "",
    };
    this.readLocal();
  }
  private readLocal() {
    let trip: LocationRecord | null = null;
    try {
      trip = tripLocation(
        this.deps.get("yike-active-trip") as Parameters<typeof tripLocation>[0],
        this.now(),
      );
    } catch {
      /* Damaged trip is not position evidence. */
    }
    const record = latestLocation(
      [this.deps.get(LOCATION_KEY), trip, this.state.snapshot?.record],
      this.now(),
    );
    this.state.snapshot = record
      ? cleanFamily({ record, speedMps: this.deps.speedMps }, this.now())
      : null;
  }
  private emit() {
    if (this.state.share && !this.state.shareFresh && !this.state.receiptStatus)
      this.state.receiptStatus = "正在核对新回应，下方是上次收到的记录。";
    this.state.summary = locationSummary(this.state.snapshot, this.now());
    this.state.shareOutdated =
      !!this.state.share &&
      JSON.stringify(this.state.snapshot) !==
        JSON.stringify(this.state.share.snapshot);
    this.deps.notify({ ...this.state });
  }
  private tick() {
    clearTimeout(this.timer);
    if (!this.alive) return;
    if (this.state.share && this.state.share.expiresAt <= this.now()) {
      this.state.share = null;
      this.state.invite = "";
      this.state.status = "位置链接已到期。";
    }
    this.readLocal();
    this.emit();
    if (this.state.share) void this.refreshShare();
    this.timer = setTimeout(() => this.tick(), 15000);
  }
  reopen() {
    this.alive = true;
    this.tick();
    if (!this.state.share) void this.restore();
  }
  close() {
    this.alive = false;
    this.epoch++;
    this.state.locating = false;
    this.state.shareFresh = false;
    clearTimeout(this.timer);
  }
  phone(value: string) {
    this.state.draftPhone = value.replace(/[^+0-9]/g, "").slice(0, 20);
    this.emit();
  }
  savePhone() {
    this.state.error = "";
    try {
      const phone = this.state.draftPhone;
      if (phone && !/^\+?\d{3,19}$/.test(phone))
        throw new Error("请填写有效的电话号码。");
      this.deps.set("yike-help-phone", phone);
      this.state.phone = phone;
      this.state.status = phone
        ? "家人电话已保存在本机，下次可直接拨打。"
        : "已移除本机家人电话。";
    } catch (e) {
      this.state.error = (e as Error).message;
    }
    this.emit();
  }
  async locate() {
    if (this.state.locating) return;
    if (this.now() - this.lastAttempt < 30_000) {
      this.message("刚刚已尝试定位，请稍等30秒再试。仍可拨打家人电话。");
      return;
    }
    this.lastAttempt = this.now();
    const epoch = ++this.epoch;
    this.state.locating = true;
    this.state.error = "";
    this.emit();
    try {
      const record = cleanLocation(await this.deps.locate(), this.now());
      if (!this.alive || epoch !== this.epoch) return;
      this.deps.set(LOCATION_KEY, record);
      this.state.snapshot = { record, speedMps: this.deps.speedMps };
      this.state.locationFailed = false;
      this.state.status = "位置已获取并保存在本机，尚未发送给家人。";
    } catch (e) {
      if (!this.alive || epoch !== this.epoch) return;
      this.state.locationFailed = true;
      this.state.error = (e as Error).message;
      this.readLocal();
      this.state.status = this.state.snapshot
        ? "暂用最近确认的记录，请注意记录时间和估算条件。"
        : "没有可用记录，仍可直接拨打电话。";
    } finally {
      if (epoch === this.epoch) {
        this.state.locating = false;
        this.emit();
      }
    }
  }
  async confirmPlace(name: string, position: RealPosition) {
    if (
      !(await this.deps.confirm(
        `确认你现在就在“${name}”？这会记下当前时间和此地点坐标；只保存在本机，分享需另行确认。`,
      ))
    )
      return;
    try {
      const record = cleanLocation(
        {
          source: "confirmed",
          name,
          position,
          at: this.now(),
          accuracyM: null,
        },
        this.now(),
      );
      this.deps.set(LOCATION_KEY, record);
      this.state.snapshot = { record, speedMps: this.deps.speedMps };
      this.state.error = "";
      this.state.status = "已记下你本人确认的地点。";
    } catch (e) {
      this.state.error = (e as Error).message;
    }
    this.emit();
  }
  message(text: string) {
    this.state.status = text;
    this.emit();
  }
  async copyText(copy: (text: string) => Promise<unknown>) {
    if (!this.state.snapshot) return;
    this.emit();
    if (
      !(await this.deps.confirm(
        "复制这条位置记录、时间、坐标和估算说明？复制后请自行发给信任的家人。",
      ))
    )
      return;
    try {
      await copy(this.state.summary.text);
      this.message("位置说明已复制，请发给家人；内容会随时间过时。");
    } catch {
      this.message(
        "复制未成功，可以让家人看下方位置说明，或在电话中描述地标。",
      );
    }
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
      if (this.endRequested) {
        this.endRequested = false;
        await this.end();
      }
    }
  }
  async share() {
    if (this.state.busy || !this.state.snapshot) return;
    const snapshot = cleanFamily(this.state.snapshot, this.now());
    if (
      !(await this.deps.confirm(
        "将这条位置记录的坐标、名称、时间及步行估算上传，生成1小时有效的家人链接？持有链接的人可查看；不会持续定位。重新分享会使旧链接失效，可随时停止。",
      ))
    )
      return;
    await this.action(async () => {
      const r = await this.deps.request<{ view: FamilyShare; invite: string }>(
        "/api/life/family",
        "POST",
        { snapshot },
      );
      this.state.share = r.view;
      this.state.shareFresh = true;
      this.state.receiptStatus = "";
      this.state.invite = r.invite;
      this.deps.set("yike-family-share", { id: r.view.id, invite: r.invite });
      this.state.status =
        "位置卡已生成，请自行发给家人。仅分享这一次记录，没有持续定位。";
    });
  }
  async restore() {
    const epoch = this.epoch;
    const saved = this.deps.get("yike-family-share") as {
      id?: string;
      invite?: string;
    } | null;
    if (!saved?.id || !/^[a-f0-9-]{36}$/.test(saved.id) || this.state.busy)
      return;
    await this.action(async () => {
      try {
        const restored = await this.deps.request<FamilyShare>(
          `/api/life/family/${saved.id}`,
        );
        if (!this.alive || epoch !== this.epoch) return;
        this.state.share = restored;
        this.state.shareFresh = true;
        this.state.receiptStatus = "";
        this.state.invite = saved.invite ?? "";
      } catch (e) {
        if (!this.alive || epoch !== this.epoch) return;
        if ([404, 410].includes((e as { status: number }).status)) {
          this.state.share = null;
          this.state.invite = "";
          this.deps.set("yike-family-share", null);
        } else {
          this.state.shareFresh = false;
          this.state.receiptStatus =
            "暂时无法核对新回应，下方仅是上次收到的记录。可直接拨打电话。";
          throw e;
        }
      }
    });
  }
  async refreshShare() {
    const id = this.state.share?.id,
      epoch = this.epoch;
    if (!id || this.polling || this.state.busy || !this.alive) return;
    this.polling = true;
    try {
      const view = await this.deps.request<FamilyShare>(
        `/api/life/family/${id}`,
      );
      if (!this.alive || epoch !== this.epoch || this.state.share?.id !== id)
        return;
      this.state.share = view;
      this.state.shareFresh = true;
      this.state.receiptStatus = "";
    } catch (e) {
      if (!this.alive || epoch !== this.epoch || this.state.share?.id !== id)
        return;
      this.state.shareFresh = false;
      this.state.receiptStatus =
        "暂时无法核对新回应，下方仅是上次收到的记录。可直接拨打电话。";
      if ([404, 410].includes((e as { status: number }).status)) {
        this.state.share = null;
        this.state.invite = "";
        this.deps.set("yike-family-share", null);
        this.state.status = "位置分享已停止或到期。";
      }
    } finally {
      this.polling = false;
      if (this.alive) this.emit();
    }
  }
  async end() {
    if (this.state.busy) {
      this.endRequested = true;
      return;
    }
    const id = this.state.share?.id;
    if (!id) return;
    await this.action(async () => {
      await this.deps.request(`/api/life/family/${id}`, "DELETE");
      this.state.share = null;
      this.state.invite = "";
      this.deps.set("yike-family-share", null);
      this.state.status =
        "已停止位置分享，原链接失效。已复制的文字或截图无法收回。";
    });
  }
}

export interface FamilyReplyState {
  view: FamilyShare | null;
  name: string;
  error: string;
  status: string;
  busy: boolean;
  time: number;
}
export class FamilyReplySession {
  state: FamilyReplyState = {
    view: null,
    name: "",
    error: "",
    status: "",
    busy: false,
    time: Date.now(),
  };
  private alive = false;
  private epoch = 0;
  private reading = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending: {
    revision: number;
    receipt: ReturnType<typeof cleanReceipt>;
  } | null = null;
  constructor(
    private deps: {
      request: (method?: string, body?: unknown) => Promise<FamilyShare>;
      notify: (s: FamilyReplyState) => void;
    },
  ) {}
  private emit() {
    if (this.alive) this.deps.notify({ ...this.state });
  }
  reopen() {
    this.alive = true;
    void this.refresh();
  }
  close() {
    this.alive = false;
    this.epoch++;
    clearTimeout(this.timer);
    this.state.view = null;
  }
  name(value: string) {
    this.state.name = value.slice(0, 20);
    this.emit();
  }
  async refresh() {
    if (!this.alive || this.reading || this.state.busy) return;
    clearTimeout(this.timer);
    this.reading = true;
    const epoch = this.epoch;
    let ended = false;
    try {
      const view = await this.deps.request();
      if (!this.alive || epoch !== this.epoch) return;
      this.state.view = view;
      this.state.time = Date.now();
      this.state.error = "";
      if (this.pending && view.receipt?.id === this.pending.receipt.id) {
        this.pending = null;
        this.state.status =
          "已核对：这条回应已保存，对方打开位置卡页面后可查看。";
      }
    } catch (e) {
      if (!this.alive || epoch !== this.epoch) return;
      this.state.view = null;
      this.state.error = (e as Error).message;
      this.state.status = "";
      ended = [404, 410].includes((e as { status: number }).status);
    } finally {
      this.reading = false;
      this.emit();
      if (this.alive && !ended)
        this.timer = setTimeout(() => void this.refresh(), 15000);
    }
  }
  async reply(kind: string) {
    if (!this.alive || this.state.busy || this.reading || !this.state.view)
      return;
    const epoch = this.epoch;
    try {
      const receipt = cleanReceipt({
        id: `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        name: this.state.name,
        kind,
      });
      if (
        !this.pending ||
        this.pending.receipt.kind !== receipt.kind ||
        this.pending.receipt.name !== receipt.name
      )
        this.pending = { revision: this.state.view.revision ?? 1, receipt };
      this.state.busy = true;
      this.state.error = "";
      this.state.status = "正在发送回应…";
      this.emit();
      const view = await this.deps.request("POST", this.pending);
      if (!this.alive || epoch !== this.epoch) return;
      this.state.view = view;
      this.pending = null;
      this.state.time = Date.now();
      this.state.status =
        "回应已保存，对方打开位置卡页面后可查看。需要马上联系时，请直接打电话。";
    } catch (e) {
      if (!this.alive || epoch !== this.epoch) return;
      const status = (e as { status: number }).status;
      this.state.error = (e as Error).message;
      this.state.status = "尚未确认回应是否送达，请刷新核对或重试。";
      if (status === 409) {
        this.pending = null;
        this.state.status = "已有其他回应，刷新核对后再发送。";
      }
      if ([404, 410].includes(status)) {
        this.state.view = null;
        this.pending = null;
      }
    } finally {
      this.state.busy = false;
      this.emit();
      clearTimeout(this.timer);
      if (this.alive)
        this.timer = setTimeout(
          () => void this.refresh(),
          epoch !== this.epoch ? 0 : 15000,
        );
    }
  }
}
