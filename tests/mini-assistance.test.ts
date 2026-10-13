import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { miniRuntime } from "./helpers/mini.js";
const settle = async (page: any) => {
  for (let i = 0; i < 100 && page.session.state.busy; i++)
    await new Promise((r) => setTimeout(r, 5));
};
test("native owner and helper pages share one trip without exchanging device credentials, preserve drafts on stale suggestions, and revoke access", async (t) => {
  const server = createApp({
    HOST: "127.0.0.1",
    PERSONAL_DATA_PATH: ":memory:",
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
  const storage = new Map<string, any>([
    ["yike-server", base],
    ["yike-token", account.token],
  ]);
  let helperCredentials = false,
    paid = 0;
  const network = (helper = false) => ({
    request: (o: any) => {
      if (helper && (o.header.Authorization || o.header.Cookie))
        helperCredentials = true;
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
  const owner = miniRuntime(storage, network()).page("trip");
  owner.onLoad();
  owner.onShow();
  let helper: any;
  t.after(() => {
    owner.onUnload();
    helper?.onUnload();
    server.closeAllConnections();
    server.close();
  });
  await owner.calculate();
  await owner.start({
    currentTarget: { dataset: { id: owner.data.plans[0].id } },
  });
  await owner.startHelp();
  assert.ok(owner.data.assistance.view);
  const share = owner.onShareAppMessage(),
    params = new URLSearchParams(share.path.split("?")[1]);
  const helperStorage = new Map<string, any>([
    ["yike-token", "unrelated-device-key"],
    ["yike-server", "https://unused.invalid"],
  ]);
  helper = miniRuntime(helperStorage, network(true)).page("assistance");
  helper.onLoad(Object.fromEntries(params));
  helper.onShow();
  await settle(helper);
  assert.ok(helper.data.view);
  assert.equal(helperCredentials, false);
  helper.session.field("note", "原地等我看看");
  await owner.step({ currentTarget: { dataset: { kind: "leave" } } });
  await owner.refreshHelp();
  await helper.refresh();
  assert.equal(helper.data.stale, true);
  assert.equal(helper.data.note, "原地等我看看");
  helper.reset();
  helper.session.field("note", "到达后请先确认位置");
  await helper.send();
  await owner.refreshHelp();
  assert.equal(owner.data.assistance.view.proposal.note, "到达后请先确认位置");
  await owner.rejectHelp();
  await helper.refresh();
  assert.equal(helper.data.view.proposal, null);
  await owner.step({ currentTarget: { dataset: { kind: "arrive" } } });
  await owner.refreshHelp();
  await helper.refresh();
  helper.reset();
  helper.session.field("kind", "plan");
  helper.session.field("speed", "0.7");
  helper.session.field("note", "慢一些回来");
  await helper.send();
  await owner.refreshHelp();
  const old = storage.get("yike-active-trip");
  await owner.acceptHelp();
  assert.equal(storage.get("yike-active-trip").input.draft.speedMps, 0.7);
  assert.deepEqual(storage.get("yike-active-trip").completed, old.completed);
  owner.session.selectEntrance(owner.data.active.currentId);
  owner.session.entranceField("photo", "data:image/png;base64,iVBORw0KGgo=");
  owner.session.entranceField("instruction", "测试入口");
  owner.saveEntrance();
  assert.equal(storage.get("yike-life").entrances.length, 1);
  await owner.removeEntrance();
  assert.equal(storage.get("yike-life").entrances.length, 0);
  await owner.endHelp();
  await helper.refresh();
  assert.match(helper.data.error, /已结束或到期/);
  assert.equal(helper.data.view, null);
  assert.equal(paid, 0);
  assert.equal(helperCredentials, false);
});
