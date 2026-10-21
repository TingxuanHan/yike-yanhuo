import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { miniRuntime } from "./helpers/mini.js";
import { createApp } from "../src/server/app.js";
import { emptyBook } from "../src/shared/life.js";
test("native simple mode survives restart and retains family entry without changing private data", async () => {
  const saved = new Map<string, any>([["yike-life", emptyBook()]]);
  const runtime = miniRuntime(saved),
    p = runtime.page();
  p.onLoad();
  assert.equal(p.data.simpleMode, true);
  await p.simple();
  assert.equal(saved.get("yike-simple-mode"), false);
  const q = miniRuntime(saved).page();
  q.onLoad();
  assert.equal(q.data.simpleMode, false);
  await q.simple();
  assert.equal(saved.get("yike-simple-mode"), true);
  assert.deepEqual(saved.get("yike-life"), emptyBook());
});
test("native family page uses one-shot consent, shares scoped card and explicit receipt without device credentials, then revokes both", async (t) => {
  const server = createApp({
    HOST: "127.0.0.1",
    PERSONAL_DATA_PATH: ":memory:",
  });
  let owner: any, helper: any;
  t.after(() => {
    owner?.onUnload();
    helper?.onUnload();
    server.closeAllConnections();
    return new Promise<void>((r) => server.close(() => r()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const account = await (
    await fetch(base + "/api/life/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"client":"mini"}',
    })
  ).json();
  const record = {
    source: "confirmed",
    at: Date.now() - 120000,
    name: "测试门口（构造）",
    position: { system: "gcj02", lng: 121.5, lat: 31.2 },
    accuracyM: null,
  };
  const store = new Map<string, any>([
    ["yike-token", account.token],
    ["yike-server", base],
    ["yike-location-record", record],
  ]);
  let denied = true,
    fixes = 0,
    calls = 0,
    paid = 0,
    leaked = false;
  const network = (helper = false) => ({
    request: (o: any) => {
      if (helper && (o.header.Authorization || o.header.Cookie)) leaked = true;
      if (/\/api\/(ai|outings\/routes|analyses)/.test(o.url)) paid++;
      void fetch(o.url, {
        method: o.method,
        headers: o.header,
        ...(o.data ? { body: JSON.stringify(o.data) } : {}),
      })
        .then(async (r) =>
          o.success({ statusCode: r.status, data: await r.json() }),
        )
        .catch(o.fail);
    },
  });
  owner = miniRuntime(store, {
    ...network(),
    requirePrivacyAuthorize: (o: any) => (denied ? o.fail({}) : o.success({})),
    getLocation: (o: any) => {
      fixes++;
      o.success({ longitude: 121.49, latitude: 31.21, accuracy: 20 });
    },
    makePhoneCall: (o: any) => {
      calls++;
      o.success({});
    },
  }).page("family");
  owner.onLoad();
  owner.onShow();
  assert.equal(fixes, 0);
  owner.phone({ detail: { value: "10086" } });
  owner.savePhone();
  await owner.call();
  assert.equal(calls, 1);
  await owner.locate();
  assert.equal(fixes, 0);
  assert.equal(owner.data.snapshot.record.at, record.at);
  assert.equal(owner.data.locationFailed, true);
  // A separate page session models the user returning later with privacy enabled.
  owner.onUnload();
  denied = false;
  owner = miniRuntime(store, {
    ...network(),
    requirePrivacyAuthorize: (o: any) => o.success({}),
    getLocation: (o: any) => {
      fixes++;
      o.success({ longitude: 121.49, latitude: 31.21, accuracy: 20 });
    },
  }).page("family");
  owner.onLoad();
  owner.onShow();
  await owner.locate();
  assert.equal(fixes, 1);
  assert.equal(owner.data.snapshot.record.source, "device");
  assert.equal(owner.data.mapAvailable, true);
  assert.equal(owner.data.markers[0].iconPath, "/assets/place.png");
  assert.equal(owner.data.circles[0].radius, owner.data.summary.radiusM);
  assert.equal(owner.data.share, null);
  await owner.share();
  assert.ok(owner.data.share);
  const options = Object.fromEntries(
    new URLSearchParams(owner.onShareAppMessage().path.split("?")[1]),
  );
  helper = miniRuntime(
    new Map([["yike-token", "unrelated-secret"]]),
    network(true),
  ).page("family");
  helper.onLoad(options);
  helper.onShow();
  for (let i = 0; i < 80 && !helper.data.ready; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(helper.data.snapshot.record.source, "device");
  assert.ok(helper.data.summary.radiusM > 0);
  assert.equal(leaked, false);
  assert.equal(owner.data.share.receipt, null);
  helper.replyName({ detail: { value: "家人测试" } });
  await helper.reply({ currentTarget: { dataset: { kind: "coming" } } });
  assert.match(helper.data.status, /回应已保存/);
  await owner.refreshReceipt();
  assert.equal(owner.data.share.receipt.kind, "coming");
  assert.match(owner.data.receiptText, /家人测试.*正在过来/);
  assert.equal(leaked, false);
  assert.equal(
    (
      await fetch(base + "/api/family/" + owner.data.share.id, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: 2,
          receipt: { id: "reply-no-auth", kind: "seen", name: "test" },
        }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(base + "/api/family/" + owner.data.share.id, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Yike-Family": options.key,
          origin: "https://untrusted.invalid",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/life/family/" + owner.data.share.id, {
        headers: { "X-Yike-Family": options.key },
      })
    ).status,
    401,
  );
  const id = owner.data.share.id;
  await owner.end();
  assert.equal(owner.data.share, null);
  const ended = await fetch(base + "/api/family/" + id, {
    headers: { "X-Yike-Family": options.key },
  });
  assert.equal(ended.status, 410);
  await helper.refreshViewer();
  assert.equal(helper.data.snapshot, null);
  assert.equal(helper.data.markers.length, 0);
  await helper.reply({ currentTarget: { dataset: { kind: "seen" } } });
  assert.equal(helper.data.snapshot, null);
  assert.equal(paid, 0);
});
