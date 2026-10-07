import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";

// Execute the actual page and platform adapter against a real keyless HTTP server.
// This checks contracts, not WeChat rendering, permissions or phone compatibility.
test("mini page records a location, pairs with Web, preserves a conflicting draft and opens a shared scenario", async (t) => {
  const app = createApp({});
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => {
    app.closeAllConnections();
    app.close();
  });
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const storage = new Map<string, any>([["yike-server", base]]);
  let page: any;
  const modules = new Map<string, any>();
  const root = resolve("miniprogram");
  const wx = {
    getStorageSync: (k: string) => storage.get(k),
    setStorageSync: (k: string, v: any) => storage.set(k, structuredClone(v)),
    removeStorageSync: (k: string) => storage.delete(k),
    chooseLocation: (o: any) =>
      o.success({
        name: "未收录小店",
        address: "上海测试巷",
        latitude: 31.2,
        longitude: 121.5,
      }),
    request: (o: any) =>
      void fetch(o.url, {
        method: o.method,
        headers: o.header,
        ...(o.data && o.method !== "GET"
          ? { body: JSON.stringify(o.data) }
          : {}),
      })
        .then(async (r) =>
          o.success({ statusCode: r.status, data: await r.json() }),
        )
        .catch(o.fail),
  };
  function load(path: string): any {
    path = resolve(path);
    assert.ok(path.startsWith(root + sep));
    if (modules.has(path)) return modules.get(path);
    const module = { exports: {} };
    modules.set(path, module.exports);
    const wrapper = vm.runInNewContext(
      `(function(require,module,exports){${readFileSync(path, "utf8")}\n})`,
      {
        wx,
        Page: (p: any) => {
          page = p;
        },
        setTimeout,
        clearTimeout,
      },
    );
    wrapper(
      (name: string) => load(resolve(dirname(path), name)),
      module,
      module.exports,
    );
    modules.set(path, module.exports);
    return module.exports;
  }
  load(resolve(root, "pages/home/index.js"));
  page.setData = function (patch: Record<string, any>) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split(".");
      let o = this.data;
      for (const part of parts.slice(0, -1)) o = o[part];
      o[parts.at(-1)!] = value;
    }
  };
  page.onLoad();
  t.after(() => page.onUnload());
  await page.choose();
  await page.remember();
  assert.equal(page.data.book.places[0].position.system, "gcj02");
  await page.create();
  assert.equal(page.data.connected, true);
  page.data.book.familiarRoutes = [
    {
      id: "to-shop",
      name: "去小店的熟路",
      checkedOn: "2026-10-01",
      steps: [
        { title: "东门", instruction: "沿人行道走" },
        { title: "蓝色雨棚", instruction: "从东侧入口进" },
      ],
    },
  ];
  page.data.book.restPoints = [
    {
      id: "rest-shop",
      name: "雨棚下长椅",
      position: page.data.book.places[0].position,
      checkedOn: "2026-10-01",
      validUntil: "2026-10-30",
      note: "座位在北侧",
    },
  ];
  await page.push();
  assert.equal(page.data.revision, 1);
  await page.pair();
  const web = await fetch(base + "/api/life/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: page.data.pairCode, client: "web" }),
  });
  const cookie = web.headers.get("set-cookie")!.split(";")[0];
  const call = (path: string, method = "GET", body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const snapshot = (await (await call("/api/life")).json()) as any;
  assert.equal(snapshot.book.places[0].name, "未收录小店");
  assert.equal(snapshot.book.familiarRoutes[0].steps[1].title, "蓝色雨棚");
  assert.equal(snapshot.book.restPoints[0].position.system, "gcj02");
  snapshot.book.familiarRoutes[0].steps[1].instruction = "从Web补充：东侧入口";
  snapshot.book.places[0].landmark = "东门雨棚";
  await call("/api/life", "PUT", snapshot);
  page.data.book.places[0].landmark = "本机未同步草稿";
  await page.push();
  assert.match(page.data.error, /另一台设备已更新/);
  assert.equal(page.data.book.places[0].landmark, "本机未同步草稿");
  await page.pull();
  await page.applyIncoming({ currentTarget: { dataset: { merge: false } } });
  assert.equal(page.data.book.places[0].landmark, "东门雨棚");
  assert.equal(
    page.data.book.familiarRoutes[0].steps[1].instruction,
    "从Web补充：东侧入口",
  );
  await page.demo();
  assert.equal(page.data.result.mode, "demo");
  page.data.book.preferences.minutes = 20;
  await page.scenario();
  assert.equal(page.data.result.scenario.preferences.minutes, 20);
  await page.shareReport();
  const reports = (await (await call("/api/life/reports")).json()) as any[];
  assert.equal(reports.length, 1);
  const report = (await (
    await call(`/api/life/reports/${reports[0].id}`)
  ).json()) as any;
  assert.equal(report.scenario.preferences.minutes, 20);
  assert.equal(
    ((await (await call("/api/quota")).json()) as any).used.route,
    0,
  );
  await page.disconnect();
  assert.equal(storage.has("yike-token"), false);
});
