const platform = require("../../platform/index.js");
const api = require("../../services/api.js");
const { cleanBook, emptyBook } = require("../../shared/life.js");
const { parseResultFile } = require("../../shared/experience.js");
const { ShoppingSession } = require("../../shared/shopping-ui.js");
Page({
  data: {
    ready: false,
    error: "",
    careMode: false,
    showStores: false,
    openNotes: "",
    kinds: [
      { id: "item", name: "商品单价" },
      { id: "person", name: "店铺每人消费参考" },
      { id: "visit", name: "店铺每次消费参考" },
    ],
    stocks: [
      { id: "unknown", name: "有货情况不清楚" },
      { id: "seen", name: "当时有货" },
      { id: "out", name: "当时缺货" },
    ],
    sources: [
      { id: "noted", name: "看到的标价" },
      { id: "paid", name: "实际买过的单价" },
    ],
    shopCounts: [1, 2, 3],
  },
  onLoad() {
    try {
      const book = cleanBook(platform.get("yike-life") || emptyBook()),
        raw = platform.get("yike-last-report"),
        report = raw ? parseResultFile(JSON.stringify(raw)) : null;
      this.bookStamp = JSON.stringify(book);
      this.session = new ShoppingSession(book, report, {
        get: (k) => platform.get(k),
        set: (k, v) => platform.set(k, v),
        save: (b) => {
          platform.set("yike-life", cleanBook(b));
          this.bookStamp = JSON.stringify(b);
        },
        request: (path, method, body) => api.request(path, method, body),
        notify: (s) => this.render(s),
      });
      this.setData({ ready: true, careMode: !!platform.get("yike-care-mode") });
      this.render(this.session.state);
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  render(s) {
    const restOptions = [{ id: "", name: "不安排休息点" }, ...s.rests];
    this.setData({
      ...s,
      originIndex: Math.max(
        0,
        s.origins.findIndex((v) => v.id === s.originId),
      ),
      storeIndex: Math.max(
        0,
        s.stores.findIndex((v) => v.id === s.form.storeId),
      ),
      restOptions,
      restIndex: Math.max(
        0,
        restOptions.findIndex((v) => v.id === s.restId),
      ),
      kindIndex: Math.max(
        0,
        this.data.kinds.findIndex((v) => v.id === s.form.kind),
      ),
      stockIndex: Math.max(
        0,
        this.data.stocks.findIndex((v) => v.id === s.form.stock),
      ),
      sourceIndex: Math.max(
        0,
        this.data.sources.findIndex((v) => v.id === s.form.source),
      ),
      selectedCount: s.stores.filter((v) => v.checked).length,
    });
  },
  onShow() {
    if (!this.session) return;
    this.session.reopen();
    try {
      const b = cleanBook(platform.get("yike-life") || emptyBook()),
        stamp = JSON.stringify(b);
      if (stamp !== this.bookStamp) {
        this.bookStamp = stamp;
        this.session.sync(b);
      }
    } catch (e) {
      this.session.message(e.message, true);
    }
  },
  onUnload() {
    this.session?.close();
  },
  care() {
    const value = !this.data.careMode;
    platform.set("yike-care-mode", value);
    this.setData({ careMode: value });
  },
  field(e) {
    this.session.change(e.currentTarget.dataset.key, e.detail.value);
  },
  tab(e) {
    this.session.change("tab", e.currentTarget.dataset.tab);
  },
  mode(e) {
    this.session.change(
      "demo",
      e.currentTarget.dataset.demo === true ||
        e.currentTarget.dataset.demo === "true",
    );
  },
  toggle(e) {
    const key = e.currentTarget.dataset.key;
    this.session.change(key, !this.data[key]);
  },
  item(e) {
    const { index, key } = e.currentTarget.dataset;
    this.session.item(Number(index), key, e.detail.value);
  },
  editItem(e) {
    const id = e.currentTarget.dataset.id;
    this.session.change("editItem", this.data.editItem === id ? "" : id);
  },
  alternative(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.session.item(i, "alternatives", !this.data.items[i].alternatives);
  },
  addItem() {
    this.session.addItem();
  },
  removeItem(e) {
    this.session.removeItem(Number(e.currentTarget.dataset.index));
  },
  saveList() {
    this.session.saveList();
  },
  async loadList() {
    if (
      await platform.confirm(
        "载入地点簿中保存的清单和预算，会替换当前购物草稿。",
      )
    )
      this.session.loadList();
  },
  select(e) {
    const { kind } = e.currentTarget.dataset,
      i = Number(e.detail.value);
    if (kind === "origin")
      this.session.change("originId", this.data.origins[i].id);
    else if (kind === "rest")
      this.session.change("restId", this.data.restOptions[i].id);
    else if (kind === "count") this.session.change("maxShops", i + 1);
    else {
      const list = {
        store: this.data.stores,
        kind: this.data.kinds,
        stock: this.data.stocks,
        source: this.data.sources,
      }[kind];
      this.session.form(kind === "store" ? "storeId" : kind, list[i].id);
    }
  },
  stores() {
    this.setData({ showStores: !this.data.showStores });
  },
  store(e) {
    const id = e.currentTarget.dataset.id,
      r = this.data.stores.find((v) => v.id === id);
    this.session.store(id, "checked", !r.checked);
  },
  opening(e) {
    const { id, key } = e.currentTarget.dataset;
    this.session.store(id, key, e.detail.value);
  },
  clearOpening(e) {
    const id = e.currentTarget.dataset.id;
    this.session.store(id, "open", "");
    this.session.store(id, "close", "");
  },
  form(e) {
    this.session.form(e.currentTarget.dataset.key, e.detail.value);
  },
  like() {
    this.session.form("liked", !this.data.form.liked);
  },
  newPrice() {
    this.session.newPrice();
    platform.reveal?.(".price-editor");
  },
  savePrice() {
    this.session.savePrice();
  },
  usePrice(e) {
    this.session.usePrice(e.currentTarget.dataset.id);
    platform.reveal?.(".shopping-heading");
  },
  reprice(e) {
    this.session.reprice(e.currentTarget.dataset.id);
    platform.reveal?.(".price-editor");
  },
  block(e) {
    this.session.block(e.currentTarget.dataset.id);
  },
  removePrice(e) {
    this.session.removePrice(e.currentTarget.dataset.id);
  },
  undo() {
    this.session.undo();
  },
  stop() {
    this.session.stop();
  },
  notes(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ openNotes: this.data.openNotes === id ? "" : id });
  },
  async calculate() {
    await this.session.calculate();
    if (this.data.plans.length) platform.reveal?.(".shopping-result");
  },
  async copy(e) {
    try {
      await platform.clipboard(
        this.session.planText(Number(e.currentTarget.dataset.index)),
      );
      this.session.message("购物安排已复制。");
    } catch (e) {
      this.session.message(e.message, true);
    }
  },
});
