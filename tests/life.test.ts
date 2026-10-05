import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { LifeStore } from "../src/server/life-store.js";
import { createApp } from "../src/server/app.js";
import { cleanBook, cleanPlace, emptyBook } from "../src/shared/life.js";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";

const place = {
  id: "test-place",
  name: "巷口小店",
  address: "小巷1号",
  landmark: "蓝色雨棚",
  note: "上午营业",
  visitedOn: "2026-10-05",
  source: "personal" as const,
  position: { system: "gcj02" as const, lng: 121.5, lat: 31.2 },
};
test("private records are validated and credentials or foreign owner fields are discarded", () => {
  const cleaned = cleanPlace({
    ...place,
    ak: "must-not-survive",
    owner: "someone",
  });
  assert.deepEqual(cleaned, place);
  assert.throws(() =>
    cleanPlace({
      ...place,
      position: { ...place.position, system: "unknown" },
    }),
  );
  assert.throws(() => cleanPlace({ ...place, visitedOn: "2026-02-30" }));
  assert.throws(() => cleanBook({ ...emptyBook(), places: [place, place] }));
});
test("persistent spaces isolate owners, pairing is single-use and expiring, updates use compare-and-swap", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "yike-life-"));
  const path = join(dir, "life.sqlite");
  let now = Date.now();
  let db = new LifeStore(path, () => now);
  t.after(() => {
    db.close();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Invalid cleanup target");
    rmSync(dir, { recursive: true });
  });
  const a = db.create(),
    b = db.create(),
    owner = db.authenticate(a.token),
    other = db.authenticate(b.token);
  const book = { ...emptyBook(), places: [place] };
  db.write(owner, 0, book);
  assert.throws(() => db.write(owner, 0, { ...book, places: [] }));
  assert.equal(db.read(other).book.places.length, 0);
  const code = db.pair(owner).code;
  const paired = db.redeem(code);
  assert.equal(db.authenticate(paired.token), owner);
  assert.deepEqual(paired.snapshot.book, book);
  assert.throws(() => db.redeem(code));
  const expired = db.pair(owner).code;
  now += 300_001;
  assert.throws(() => db.redeem(expired));
  db.revoke(paired.token);
  assert.throws(() => db.authenticate(paired.token));
  const report = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  db.saveReport(owner, report);
  assert.throws(() =>
    db.saveReport(owner, {
      ...report,
      center: { ...report.center, label: "modified" },
    }),
  );
  assert.equal(db.reports(owner).length, 1);
  assert.equal(db.reports(other).length, 0);
  assert.throws(() => db.report(other, report.id));
  db.close();
  db = new LifeStore(path, () => now);
  assert.equal(db.read(owner).book.places[0].name, place.name);
  assert.equal(db.report(owner, report.id).id, report.id);
  assert.ok(
    !readFileSync(path).includes(Buffer.from(a.token)),
    "raw device token must not be persisted",
  );
});
test("public server requires pairing auth, protects jobs and handles stale writes with HTTP409", async (t) => {
  assert.throws(() => createApp({ HOST: "0.0.0.0" }), /HTTPS/);
  const invite = "test-invite-12345678901234567890";
  const app = createApp({
    PUBLIC_ORIGIN: "https://example.test",
    SPACE_INVITE_CODE: invite,
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => {
    app.closeAllConnections();
    app.close();
  });
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const call = (path: string, method = "GET", data?: unknown, token?: string) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  assert.equal((await call("/api/quota")).status, 401);
  assert.equal((await call("/api/life")).status, 401);
  assert.equal(
    (await call("/api/life/create", "POST", { client: "mini" })).status,
    403,
  );
  const a = (await (
    await call("/api/life/create", "POST", { invite, client: "mini" })
  ).json()) as any;
  const b = (await (
    await call("/api/life/create", "POST", { invite, client: "mini" })
  ).json()) as any;
  assert.equal(
    (
      await call(
        "/api/life",
        "PUT",
        { revision: 0, book: { ...emptyBook(), places: [place] } },
        a.token,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/life",
        "PUT",
        { revision: 0, book: emptyBook() },
        a.token,
      )
    ).status,
    409,
  );
  const pair = (await (
    await call("/api/life/pair", "POST", {}, a.token)
  ).json()) as any;
  const web = await call("/api/life/redeem", "POST", {
    code: pair.code,
    client: "web",
  });
  assert.match(
    web.headers.get("set-cookie")!,
    /HttpOnly; SameSite=Strict.*Secure/,
  );
  assert.equal("token" in ((await web.json()) as any), false);
  const job = (await (
    await call("/api/analyses", "POST", { mode: "demo" }, a.token)
  ).json()) as any;
  assert.equal(
    (await call(`/api/analyses/${job.id}`, "GET", undefined, b.token)).status,
    404,
  );
  assert.equal(
    (await call(`/api/analyses/${job.id}`, "DELETE", undefined, a.token))
      .status,
    200,
  );
});
