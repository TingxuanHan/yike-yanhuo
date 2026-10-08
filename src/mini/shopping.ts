import { cleanBook, emptyBook, type LifeBook } from "../shared/life.js";
import { cleanJourney } from "../shared/journey.js";
import {
  allPairs,
  cleanNode,
  todayLocal,
  type OutingNode,
  type RouteBundle,
  type RestPoint,
} from "../shared/outings.js";
import {
  cleanPrice,
  cleanShopping,
  cleanShoppingItem,
  defaultShopping,
  latestPrices,
  matchingQuotes,
  planShopping,
  priceFresh,
  productKey,
  validateShopping,
  type PriceRecord,
  type ShoppingBook,
  type ShoppingItem,
  type ShoppingOptions,
  type ShoppingStore,
} from "../shared/shopping.js";
import {
  demoScene,
  minutesText,
  OutingRouteCache,
  sceneFromReport,
  type OutingScene,
} from "./outings.js";
import type { AnalysisResult, QuotaSnapshot } from "../shared/types.js";
export * from "../shared/shopping.js";

const uuid = () =>
  `shop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const moneyText = (low: number, high: number) =>
  low === high ? `¥${low.toFixed(2)}` : `¥${low.toFixed(2)}—${high.toFixed(2)}`;
export const priceText = (q: PriceRecord) =>
  q.low === null
    ? "价格待确认"
    : `${moneyText(q.low, q.high!)} / ${q.kind === "person" ? "人" : q.kind === "visit" ? "次" : q.product.unit}`;
export function demoShopping() {
  const scene = demoScene();
  const stores = [
    scene.facilities[0],
    {
      id: "shop-b",
      name: "巷尾平价店",
      position: { system: "demo" as const, x: -1000, y: 200 },
    },
    {
      id: "shop-c",
      name: "街角便利店",
      position: { system: "demo" as const, x: -200, y: 0 },
    },
  ];
  const items: ShoppingItem[] = [
    {
      id: "eggs",
      name: "鸡蛋",
      spec: "6枚装",
      unit: "盒",
      brand: "",
      quantity: 1,
      alternatives: false,
    },
    {
      id: "greens",
      name: "青菜",
      spec: "500克",
      unit: "份",
      brand: "",
      quantity: 1,
      alternatives: false,
    },
    {
      id: "milk",
      name: "纯牛奶",
      spec: "250毫升×4盒",
      unit: "提",
      brand: "示例牧场",
      quantity: 1,
      alternatives: false,
    },
  ];
  const values = [
    [12, 6, 22],
    [9, 4, 18],
    [14, 7, 23],
  ];
  const prices: PriceRecord[] = stores.flatMap((store, i) =>
    items.map((item, j) => ({
      id: `demo-price-${i}-${j}`,
      store,
      product: {
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        brand: item.brand,
      },
      kind: "item",
      low: values[i][j],
      high: values[i][j] + 2,
      observedOn: todayLocal(),
      validDays: 7,
      stock: "unknown",
      source: "noted",
      liked: false,
    })),
  );
  return { stores, items, prices };
}
export interface PriceForm {
  storeId: string;
  name: string;
  spec: string;
  unit: string;
  brand: string;
  kind: string;
  low: string;
  high: string;
  observedOn: string;
  validDays: string;
  stock: string;
  source: string;
  liked: boolean;
}
const blankPrice = (): PriceForm => ({
  storeId: "",
  name: "",
  spec: "",
  unit: "份",
  brand: "",
  kind: "item",
  low: "",
  high: "",
  observedOn: todayLocal(),
  validDays: "7",
  stock: "unknown",
  source: "noted",
  liked: false,
});
interface StoreRow extends ShoppingStore {
  checked: boolean;
}
export interface PriceRow {
  removable: boolean;
  id: string;
  title: string;
  store: string;
  price: string;
  detail: string;
  item: boolean;
  blocked: boolean;
  liked: boolean;
}
export interface PlanRow {
  id: string;
  title: string;
  total: string;
  cost: string;
  coverage: string;
  budget: string;
  comparison: string;
  rows: { id: string; title: string; detail: string; buy: string }[];
  notes: string[];
}
export interface ShoppingView {
  editItem: string;
  priceQuery: string;
  tab: "list" | "prices";
  demo: boolean;
  label: string;
  originId: string;
  origins: OutingNode[];
  items: ShoppingItem[];
  options: ShoppingOptions;
  prefs: LifeBook["preferences"];
  stores: StoreRow[];
  rests: RestPoint[];
  restId: string;
  form: PriceForm;
  prices: PriceRow[];
  plans: PlanRow[];
  busy: boolean;
  status: string;
  error: string;
  showSettings: boolean;
  showEditor: boolean;
  undo: boolean;
  modeNotice: string;
}
interface Dependencies {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  save: (book: LifeBook) => void;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  notify: (s: ShoppingView) => void;
}
export class ShoppingSession {
  state: ShoppingView;
  private book: LifeBook;
  private report: AnalysisResult | null;
  private cache: OutingRouteCache;
  private cancelled = false;
  private alive = true;
  private undone: PriceRecord | null = null;
  private undoneItem: ShoppingItem | null = null;
  constructor(
    book: LifeBook,
    report: AnalysisResult | null,
    private deps: Dependencies,
  ) {
    this.book = cleanBook(book);
    this.report = report;
    this.state = {
      editItem: "",
      priceQuery: "",
      tab: "list",
      demo: report?.mode !== "baidu",
      label: "",
      originId: "",
      origins: [],
      items: (book.shopping?.items ?? demoShopping().items).map((i) => ({
        ...i,
      })),
      options: { ...(book.shopping?.options ?? defaultShopping().options) },
      prefs: cleanJourney(book.preferences),
      stores: [],
      rests: [],
      restId: "",
      form: blankPrice(),
      prices: [],
      plans: [],
      busy: false,
      status: "",
      error: "",
      showSettings: false,
      showEditor: false,
      undo: false,
      modeNotice: "",
    };
    this.cache = new OutingRouteCache(deps.get("yike-outing-routes") || []);
    try {
      const raw = deps.get("yike-shopping-draft");
      if (raw) {
        if (JSON.stringify(raw).length > 25000)
          throw new Error("购物草稿过大，未自动恢复。");
        const d = raw as {
          items: ShoppingItem[];
          options: ShoppingOptions;
          form: PriceForm;
        };
        if (!Array.isArray(d.items) || d.items.length > 5)
          throw new Error("购物草稿格式无效。");
        this.state.items = d.items.map((i) => ({
          ...cleanShoppingItem({ ...i, quantity: 1 }, true),
          quantity:
            typeof i.quantity === "number" && Number.isFinite(i.quantity)
              ? i.quantity
              : 0,
        }));
        for (const key of Object.keys(
          this.state.options,
        ) as (keyof ShoppingOptions)[])
          if (
            typeof d.options?.[key] === "number" &&
            Number.isFinite(d.options[key])
          )
            this.state.options[key] = d.options[key];
        if (d.form)
          for (const key of Object.keys(
            this.state.form,
          ) as (keyof PriceForm)[]) {
            const v = d.form[key];
            if (key === "liked") {
              this.state.form.liked = !!v;
            } else if (typeof v === "string" && v.length <= 100)
              this.state.form[key] = v;
          }
      }
    } catch (e) {
      this.state.error = (e as Error).message;
    }
    this.refresh();
  }
  close() {
    this.alive = false;
    this.cancelled = true;
  }
  reopen() {
    this.alive = true;
  }
  emit() {
    if (this.alive) this.deps.notify({ ...this.state });
  }
  private draft() {
    this.deps.set("yike-shopping-draft", {
      items: this.state.items,
      options: this.state.options,
      form: this.state.form,
    });
  }
  private guard(fn: () => void) {
    try {
      fn();
      this.draft();
    } catch (e) {
      this.state.error = (e as Error).message;
    }
    this.emit();
  }
  private clear() {
    this.state.plans = [];
    this.state.error = "";
    this.state.status = "";
  }
  private stored() {
    return this.book.shopping ?? defaultShopping();
  }
  private quotes() {
    return [
      ...(this.state.demo ? demoShopping().prices : []),
      ...this.stored().prices.filter(
        (q) => (q.store.position.system === "demo") === this.state.demo,
      ),
    ];
  }
  private scene(): Omit<OutingScene, "origin"> & { origin: OutingNode | null } {
    if (this.state.demo) {
      const s = demoScene();
      s.facilities = demoShopping().stores.map((n) => ({
        ...n,
        category: "market",
      }));
      return s;
    }
    if (this.report?.mode === "baidu")
      return sceneFromReport(this.report, this.book);
    const real = this.book.places
      .filter((p) => p.position.system !== "demo")
      .map((p) => ({ ...cleanNode(p), id: `p-${p.id}`, category: "personal" }));
    return {
      origin: real[0] ?? null,
      facilities: real,
      rests: (this.book.restPoints ?? []).filter(
        (p) => p.position.system !== "demo",
      ),
      proposed: [],
      samples: [],
      mode: "baidu",
      label: real.length ? "私人地点簿" : "请先在地点簿记录出发点和店铺",
      date: todayLocal(),
    };
  }
  refresh() {
    const scene = this.scene(),
      old = new Map(this.state.stores.map((s) => [s.id, s]));
    const personal = this.book.places
      .filter((p) => (p.position.system === "demo") === this.state.demo)
      .map((p) => ({ ...cleanNode(p), id: `p-${p.id}` }));
    this.state.origins = !scene.origin
      ? []
      : [
          ...new Map(
            [scene.origin, ...personal].map((n) => [n.id, n]),
          ).values(),
        ];
    if (!this.state.origins.some((n) => n.id === this.state.originId))
      this.state.originId = this.state.origins[0]?.id ?? "";
    const candidates = [
      ...scene.facilities.filter((n) =>
        ["market", "personal"].includes(n.category),
      ),
      ...personal,
      ...this.quotes().map((q) => q.store),
    ];
    // Current location records take precedence over historical quote coordinates.
    const map = new Map<string, OutingNode>();
    for (const n of candidates) if (!map.has(n.id)) map.set(n.id, n);
    this.state.stores = [...map.values()]
      .filter((n) => n.id !== this.state.originId)
      .slice(0, 30)
      .map((n, i) => ({
        ...n,
        checked: old.get(n.id)?.checked ?? i < 5,
        open: old.get(n.id)?.open ?? "",
        close: old.get(n.id)?.close ?? "",
      }));
    this.state.rests = scene.rests.filter(
      (r) =>
        r.validUntil >= todayLocal() &&
        r.checkedOn <= todayLocal() &&
        r.id !== this.state.originId &&
        !this.state.stores.some((s) => s.id === r.id),
    );
    if (!this.state.rests.some((r) => r.id === this.state.restId))
      this.state.restId = "";
    this.state.label = this.state.demo
      ? "离线示例 · 店铺与价格均为构造数据"
      : scene.label;
    this.state.modeNotice = this.state.demo
      ? "可以先用示例试算，再切换到自己的地点和价格。"
      : "价格来自私人记录；当前库存、营业情况请在出发前确认。";
    if (!this.state.stores.some((s) => s.id === this.state.form.storeId))
      this.state.form.storeId = this.state.stores[0]?.id ?? "";
    this.state.prices = latestPrices(this.quotes())
      .sort(
        (a, b) =>
          Number(b.liked) - Number(a.liked) ||
          b.observedOn.localeCompare(a.observedOn),
      )
      .map((q) => ({
        removable: !q.id.startsWith("demo-price-"),
        id: q.id,
        title: `${q.product.name} · ${q.product.spec}${q.product.brand ? ` · ${q.product.brand}` : ""}`,
        store: q.store.name,
        price: priceText(q),
        detail: `${q.source === "paid" ? "曾实际买过" : "记录的标价"} · ${q.observedOn} · ${priceFresh(q) ? "参考期内" : "价格已过期"} · ${q.stock === "out" ? "记录为缺货" : "当前库存待确认"}`,
        item: q.kind === "item",
        blocked: this.stored().blocked.includes(productKey(q.product)),
        liked: q.liked,
      }))
      .filter((r) =>
        `${r.title} ${r.store}`
          .toLowerCase()
          .includes(this.state.priceQuery.trim().toLowerCase()),
      );
  }
  sync(book: LifeBook) {
    const next = cleanBook(book);
    if (JSON.stringify(next) === JSON.stringify(this.book)) return;
    this.book = next;
    this.clear();
    this.refresh();
    this.emit();
  }
  change(key: string, value: unknown) {
    if (this.state.busy) return;
    this.guard(() => {
      this.clear();
      if (key === "tab" && (value === "list" || value === "prices"))
        this.state.tab = value;
      else if (key === "editItem") this.state.editItem = String(value);
      else if (key === "priceQuery") {
        this.state.priceQuery = String(value).slice(0, 120);
        this.refresh();
      } else if (key === "demo") {
        this.state.demo = !!value;
        this.state.originId = "";
        this.state.stores = [];
        this.refresh();
      } else if (key === "originId") {
        this.state.originId = String(value);
        this.state.stores = [];
        this.refresh();
      } else if (key === "restId") this.state.restId = String(value);
      else if (key === "showSettings" || key === "showEditor")
        this.state[key] = !!value;
      else if (key === "departure")
        this.state.prefs = { ...this.state.prefs, departure: String(value) };
      else if (key === "speedMps")
        this.state.prefs = { ...this.state.prefs, speedMps: Number(value) };
      else if (
        key in this.state.options &&
        Object.prototype.hasOwnProperty.call(this.state.options, key)
      )
        this.state.options = { ...this.state.options, [key]: Number(value) };
    });
  }
  item(index: number, key: string, value: unknown) {
    if (this.state.busy) return;
    this.guard(() => {
      if (
        !this.state.items[index] ||
        !["name", "spec", "unit", "brand", "quantity", "alternatives"].includes(
          key,
        )
      )
        return;
      this.clear();
      this.state.items = this.state.items.map((i, n) =>
        n === index
          ? {
              ...i,
              [key]:
                key === "quantity"
                  ? Number(value)
                  : key === "alternatives"
                    ? !!value
                    : String(value).slice(0, key === "unit" ? 12 : 80),
            }
          : i,
      );
    });
  }
  addItem() {
    if (this.state.busy) return;
    this.guard(() => {
      if (this.state.items.length >= 5)
        throw new Error("一次最多安排5项商品。");
      this.clear();
      this.state.items = [
        ...this.state.items,
        {
          id: uuid(),
          name: "",
          spec: "",
          unit: "份",
          brand: "",
          quantity: 1,
          alternatives: false,
        },
      ];
      this.state.editItem = this.state.items[this.state.items.length - 1].id;
    });
  }
  removeItem(index: number) {
    if (this.state.busy) return;
    this.guard(() => {
      this.undoneItem = this.state.items[index] ?? null;
      this.undone = null;
      this.clear();
      this.state.items = this.state.items.filter((_, i) => i !== index);
      this.state.editItem = "";
      this.state.undo = !!this.undoneItem;
      this.state.status = "已移除该商品，可撤销。";
    });
  }
  store(id: string, key: string, value: unknown) {
    if (this.state.busy) return;
    this.guard(() => {
      if (!["checked", "open", "close"].includes(key)) return;
      this.clear();
      this.state.stores = this.state.stores.map((s) =>
        s.id === id
          ? { ...s, [key]: key === "checked" ? !!value : String(value) }
          : s,
      );
    });
  }
  form(key: string, value: unknown) {
    if (this.state.busy) return;
    this.guard(() => {
      if (Object.prototype.hasOwnProperty.call(this.state.form, key))
        this.state.form = {
          ...this.state.form,
          [key]: key === "liked" ? !!value : String(value).slice(0, 100),
        };
    });
  }
  private save(shopping: ShoppingBook) {
    const book = cleanBook({ ...this.book, shopping });
    this.deps.save(book);
    this.book = book;
    this.refresh();
  }
  saveList() {
    if (this.state.busy) return;
    this.guard(() => {
      this.save(
        cleanShopping({
          ...this.stored(),
          items: this.state.items,
          options: this.state.options,
        }),
      );
      this.state.status = "清单和预算已保存，可随地点簿同步。";
    });
  }
  loadList() {
    if (this.state.busy) return;
    this.guard(() => {
      if (!this.book.shopping)
        throw new Error("还没有已保存的清单，可先保存当前清单或同步地点簿。");
      this.state.items = this.book.shopping.items.map((i) => ({ ...i }));
      this.state.options = { ...this.book.shopping.options };
      this.clear();
      this.state.status = "已载入地点簿中保存的清单和预算。";
    });
  }
  newPrice() {
    this.guard(() => {
      this.state.form = {
        ...blankPrice(),
        storeId: this.state.stores[0]?.id ?? "",
      };
      this.state.showEditor = true;
      this.state.tab = "prices";
    });
  }
  savePrice() {
    if (this.state.busy) return;
    this.guard(() => {
      const f = this.state.form,
        store = this.state.stores.find((s) => s.id === f.storeId);
      if (!store) throw new Error("请先在地点簿保存店铺位置，再选择这家店。");
      const q = cleanPrice({
        id: uuid(),
        store,
        product: { name: f.name, spec: f.spec, unit: f.unit, brand: f.brand },
        kind: f.kind,
        low: f.low.trim() === "" ? null : Number(f.low),
        high:
          f.high.trim() === ""
            ? f.low.trim() === ""
              ? null
              : Number(f.low)
            : Number(f.high),
        observedOn: f.observedOn,
        validDays: Number(f.validDays),
        stock: f.stock,
        source: f.source,
        liked: f.liked,
      });
      this.save({ ...this.stored(), prices: [...this.stored().prices, q] });
      this.clear();
      this.state.status = "价格记录已保存；当前库存仍需到店确认。";
      this.state.showEditor = false;
      this.state.form = { ...blankPrice(), storeId: f.storeId };
    });
  }
  usePrice(id: string) {
    this.guard(() => {
      const q = this.quotes().find((r) => r.id === id);
      if (!q || q.kind !== "item") return;
      if (this.stored().blocked.includes(productKey(q.product)))
        throw new Error("该商品已设为不推荐，可先恢复推荐。");
      if (
        this.state.items.some((i) => productKey(i) === productKey(q.product))
      ) {
        this.state.status = "清单中已有这个规格，可直接调整数量。";
        return;
      }
      if (this.state.items.length >= 5)
        throw new Error("清单已满，请先移除不需要的商品。");
      this.clear();
      this.state.items = [
        ...this.state.items,
        { ...q.product, id: uuid(), quantity: 1, alternatives: false },
      ];
      this.state.tab = "list";
      this.state.status = "已加入清单。";
    });
  }
  reprice(id: string) {
    this.guard(() => {
      const q = this.quotes().find((r) => r.id === id);
      if (!q) return;
      this.state.form = {
        ...blankPrice(),
        ...q.product,
        storeId: q.store.id,
        kind: q.kind,
        source: "paid",
        stock: "seen",
        liked: q.liked,
      };
      this.state.tab = "prices";
      this.state.showEditor = true;
      this.state.status = "填写这次实际单价；没有买到可把状态改为缺货。";
    });
  }
  block(id: string) {
    this.guard(() => {
      const q = this.quotes().find((r) => r.id === id);
      if (!q) return;
      const key = productKey(q.product),
        b = this.stored();
      this.save({
        ...b,
        blocked: b.blocked.includes(key)
          ? b.blocked.filter((s) => s !== key)
          : [...b.blocked, key],
      });
      this.clear();
      this.state.status = "推荐偏好已保存。";
    });
  }
  removePrice(id: string) {
    this.guard(() => {
      const q = this.stored().prices.find((r) => r.id === id);
      if (!q) throw new Error("内置示例可用于练习补记，不支持删除。");
      this.save({
        ...this.stored(),
        prices: this.stored().prices.filter((r) => r.id !== id),
      });
      this.undone = q;
      this.undoneItem = null;
      this.clear();
      this.state.undo = true;
      this.state.status = "已移除这条记录，可撤销。";
    });
  }
  undo() {
    this.guard(() => {
      if (this.undoneItem) {
        if (this.state.items.length >= 5)
          throw new Error("清单已满，请先腾出一个位置再恢复。");
        this.state.items = [
          ...this.state.items.filter((i) => i.id !== this.undoneItem!.id),
          this.undoneItem,
        ];
        this.undoneItem = null;
        this.state.undo = false;
        this.clear();
        this.state.status = "商品已恢复。";
        return;
      }
      if (!this.undone) return;
      this.save({
        ...this.stored(),
        prices: [
          ...this.stored().prices.filter((r) => r.id !== this.undone!.id),
          this.undone,
        ],
      });
      this.undone = null;
      this.state.undo = false;
      this.clear();
      this.state.status = "价格记录已恢复。";
    });
  }
  stop() {
    this.cancelled = true;
    this.state.status = "正在停止；已发送的当前批次可能完成，随后不再读取。";
    this.emit();
  }
  message(value: string, error = false) {
    if (error) this.state.error = value;
    else this.state.status = value;
    this.emit();
  }
  async calculate() {
    if (this.state.busy) return;
    this.clear();
    this.state.busy = true;
    this.cancelled = false;
    this.emit();
    try {
      const s = this.state,
        origin = s.origins.find((n) => n.id === s.originId);
      if (!origin)
        throw new Error("请先保存出发点和店铺位置，再安排真实购物路线。");
      const selectedStores = s.stores.filter((n) => n.checked),
        rest = s.rests.find((n) => n.id === s.restId) ?? null;
      const data = cleanShopping({
        ...this.stored(),
        items: s.items,
        options: s.options,
        prices: latestPrices(this.quotes()),
      });
      validateShopping(data.items, data.options, selectedStores, origin, rest);
      cleanJourney(s.prefs);
      const stores = selectedStores.filter((store) =>
        data.items.some(
          (item) =>
            matchingQuotes(item, [store], data.prices, data.blocked).length,
        ),
      );
      if (!stores.length)
        throw new Error(
          "所选店铺还没有可用的同规格商品记录。请先补价格记忆，或恢复被排除的商品；尚未读取路线。",
        );
      const nodes = [origin, ...stores, ...(rest ? [rest] : [])],
        pairs = allPairs(nodes),
        pending = this.cache.pending(nodes, pairs).length;
      if (!s.demo && pending) {
        const q = await this.deps.request<QuotaSnapshot>("/api/quota");
        if (q.limits.route - q.used.route < pending * 2)
          throw new Error(
            "路线预算不足（需保留重试余量），请减少候选店铺或使用示例。",
          );
      }
      const bundle = await this.cache.obtain(
        nodes,
        pairs,
        (body) =>
          this.deps.request<RouteBundle>("/api/outings/routes", "POST", body),
        (done, total) => {
          this.deps.set("yike-outing-routes", this.cache.snapshot());
          s.status = `已读取${done}/${total}段路线${s.demo ? " · 示例不消耗接口额度" : ""}`;
          this.emit();
        },
        () => this.cancelled,
      );
      if (this.cancelled) throw new Error("已停止计算，已读取的路线仍保留。");
      const result = planShopping(bundle, origin, stores, data, s.prefs, rest);
      s.plans = result.plans.map((p, i) => ({
        id: `plan-${i}`,
        title: p.labels.join(" · "),
        total: `${minutesText(p.totalMinutes)} · ${p.finish}回到出发点`,
        cost: `${p.completePrice ? "预计支出" : "已知部分"} ${moneyText(p.low, p.high)}`,
        coverage: `${p.missing.length ? `尚缺：${p.missing.join("、")}` : "清单全部安排"}${p.unknown ? ` · ${p.unknown}项价格待确认` : ""}`,
        budget:
          p.budget === "within"
            ? "估算上限在预算内"
            : p.budget === "over"
              ? `估算上限超预算¥${(p.high - data.options.money).toFixed(2)}`
              : "整趟是否超预算待确认",
        comparison: p.comparison,
        rows: p.visits.map((v) => ({
          id: v.id,
          title: `${v.arrival} ${v.name}`,
          detail: `步行${minutesText(v.walkMinutes)}${v.stayMinutes ? ` · 停留${minutesText(v.stayMinutes)}` : ""}${v.waitMinutes ? ` · 等待${minutesText(v.waitMinutes)}` : ""}`,
          buy: p.purchases
            .filter((r) => r.quote?.store.id === v.id)
            .map(
              (r) =>
                `${r.item.name} ${r.quote!.product.brand}（${r.item.spec}）×${r.item.quantity}${r.item.unit} · ${r.known ? moneyText(r.quote!.low! * r.item.quantity, r.quote!.high! * r.item.quantity) : "价格待确认"}`,
            )
            .join("；"),
        })),
        notes: [
          ...(p.unknownOpening.length
            ? [`营业时间未确认：${p.unknownOpening.join("、")}`]
            : []),
          ...p.purchases
            .filter((r) => r.quote)
            .map((r) => `${r.item.name}：${r.reason}`),
        ],
      }));
      s.status =
        result.note +
        (result.missingRoutes
          ? ` 另有${result.missingRoutes}段路线待确认。`
          : "");
    } catch (e) {
      this.state.error = (e as Error).message;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  planText(index: number) {
    const p = this.state.plans[index];
    if (!p) return "";
    return `${this.state.label}\n${p.title}\n${p.total}\n${p.cost}；${p.coverage}；${p.budget}\n${p.rows.map((r) => `${r.title}：${r.buy || r.detail}`).join("\n")}\n路线仅表示站点顺序；请确认价格、营业与库存。`;
  }
}
