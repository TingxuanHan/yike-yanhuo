import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { LifeStore } from "../src/server/life-store.js";
import { createApp } from "../src/server/app.js";
import { emptyBook } from "../src/shared/life.js";
const place = {
  id: "shop",
  name: "小店",
  address: "测试巷1号",
  landmark: "东门",
  note: "台阶",
  visitedOn: "",
  source: "personal",
  position: { system: "gcj02", lng: 121.5, lat: 31.2 },
  favorite: true,
};
test("family cards are isolated snapshots, expire at seven days and can only be revoked by the owner", (t) => {
  let now = Date.now();
  const db = new LifeStore(":memory:", () => now);
  t.after(() => db.close());
  const a = db.create(),
    b = db.create(),
    owner = db.authenticate(a.token),
    other = db.authenticate(b.token);
  const card = db.createCard(owner, place);
  place.name = "改名后的小店";
  assert.equal(db.sharedCard(card.token).place.name, "小店");
  assert.equal(db.sharedCard(card.token).place.favorite, undefined);
  assert.equal(db.cards(other).length, 0);
  assert.equal("token" in db.cards(owner)[0], false);
  assert.throws(() => db.authenticate(card.token));
  assert.throws(() => db.revokeCard(other, card.id));
  db.revokeCard(owner, card.id);
  assert.throws(() => db.sharedCard(card.token));
  const expired = db.createCard(owner, place);
  now += 7 * 86400000;
  assert.throws(() => db.sharedCard(expired.token));
  assert.equal(db.cards(owner).length, 0);
  for (let i = 0; i < 20; i++) db.createCard(owner, place);
  assert.throws(() => db.createCard(owner, place), /20/);
});
test("public card tokens grant no book or paid API access; owner revocation and payload limits hold over HTTP", async (t) => {
  const invite = "card-test-invite-12345678901234567890";
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
  const call = (
    path: string,
    method = "GET",
    data?: unknown,
    token?: string,
    card?: string,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(card ? { "X-Yike-Card": card } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const a = (await (
    await call("/api/life/create", "POST", { invite, client: "mini" })
  ).json()) as any;
  const b = (await (
    await call("/api/life/create", "POST", { invite, client: "mini" })
  ).json()) as any;
  const card = (await (
    await call("/api/life/cards", "POST", { place }, a.token)
  ).json()) as any;
  assert.match(card.token, /^[A-Za-z0-9_-]{32}$/);
  const publicRead = await call(
    "/api/card",
    "GET",
    undefined,
    undefined,
    card.token,
  );
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.headers.get("cache-control"), "no-store");
  assert.equal(((await publicRead.json()) as any).place.name, place.name);
  for (const path of ["/api/life", "/api/quota", "/api/life/cards"])
    assert.equal((await call(path, "GET", undefined, card.token)).status, 401);
  assert.equal(
    (
      await call(
        "/api/life",
        "PUT",
        { revision: 0, book: emptyBook() },
        card.token,
      )
    ).status,
    401,
  );
  assert.equal(
    (await call(`/api/life/cards/${card.id}`, "DELETE", undefined, b.token))
      .status,
    404,
  );
  const richBook = {
    ...emptyBook(),
    places: Array.from({ length: 6 }, (_, i) => ({
      ...place,
      id: `photo-${i}`,
      photo: "data:image/png;base64," + "A".repeat(60000),
    })),
  };
  assert.equal(
    (await call("/api/life", "PUT", { revision: 0, book: richBook }, a.token))
      .status,
    200,
  );
  assert.equal(
    (await call(`/api/life/cards/${card.id}`, "DELETE", undefined, a.token))
      .status,
    200,
  );
  assert.equal(
    (await call("/api/card", "GET", undefined, undefined, card.token)).status,
    404,
  );
  assert.equal((await call("/api/card")).status, 404);
});
