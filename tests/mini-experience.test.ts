import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { personalize } from "../src/core/personalize.js";
import {
  emptyBook,
  cleanBook,
  cleanPlace,
  MAX_PHOTO_LENGTH,
  type PersonalPlace,
} from "../src/shared/life.js";
import {
  mapPosition,
  reportView,
  scenario,
  facilityPlace,
  placeList,
} from "../src/mini/experience.js";
import { miniRuntime } from "./helpers/mini.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("community tour preserves personal preferences and saved report while showing original timed contours", () => {
  const runtime = miniRuntime();
  const page = runtime.page();
  page.onLoad();
  const before = JSON.stringify([...runtime.storage.entries()]);
  const original = page.data.result;
  page.openReview();
  page.reviewExample();
  assert.equal(page.data.reviewMode, true);
  assert.equal(page.data.simpleMode, false);
  assert.equal(page.data.result.scenario, undefined);
  page.quickTime({ currentTarget: { dataset: { minutes: 5 } } });
  assert.equal(page.data.minutes, 5);
  page.filter({ currentTarget: { dataset: { id: "school" } } });
  assert.equal(page.data.minutes, 5);
  page.reviewStep({ currentTarget: { dataset: { step: "coverage" } } });
  assert.equal(page.data.showCoverage, true);
  assert.ok(page.data.coveragePoints.every((p: any) => p.seconds <= 300));
  page.onShow();
  assert.equal(page.data.simpleMode, false);
  page.closeReview();
  assert.equal(page.data.result.id, original.id);
  assert.equal(page.data.simpleMode, true);
  assert.equal(JSON.stringify([...runtime.storage.entries()]), before);
  page.onUnload();
});

test("native coverage inspector works offline and replaces stale selection when time or category changes", () => {
  const page = miniRuntime().page();
  page.onLoad();
  page.coverageToggle();
  assert.equal(page.data.showCoverage, true);
  assert.ok(page.data.coveragePoints.length > 0);
  assert.ok(page.data.coverageSelected.reasons.length > 0);
  page.coveragePointChange({
    detail: { value: page.data.coveragePoints.length - 1 },
  });
  page.coverageCategoryChange({ detail: { value: 1 } });
  assert.equal(page.data.coverageCategory, "pharmacy");
  assert.match(page.data.coverageSelected.id, /^pharmacy:/);
  const result = structuredClone(page.data.result);
  result.samples = [];
  page.setResult(result, false);
  assert.equal(page.data.coverageSelected, null);
  assert.equal(page.data.coverageOptions.length, 0);
  page.onUnload();
});

const place: PersonalPlace = {
  id: "shop",
  name: "巷口小店",
  address: "测试巷12号",
  landmark: "蓝色雨棚",
  note: "入口有台阶",
  visitedOn: "2026-10-07",
  source: "personal",
  position: { system: "gcj02", lng: 121.5, lat: 31.2 },
  favorite: true,
  openingHours: "9:00—17:00",
  photo: "data:image/png;base64,iVBORw0KGgo=",
};
test("large photo books render in bounded updates and privacy denial preserves draft access", async () => {
  const places = Array.from({ length: 11 }, (_, i) => ({
    ...place,
    id: `large-${i}`,
    photo: "data:image/png;base64," + "A".repeat(60000),
  }));
  const storage = new Map<string, any>([
    ["yike-life", { ...emptyBook(), places }],
  ]);
  let listener: any,
    removed = false;
  const page = miniRuntime(storage, {
    onNeedPrivacyAuthorization: (fn: any) => {
      listener = fn;
    },
    offNeedPrivacyAuthorization: () => {
      removed = true;
    },
    requirePrivacyAuthorize: (o: any) =>
      listener((result: any) =>
        result.event === "agree" ? o.success({}) : o.fail({}),
      ),
  }).page();
  page.onLoad();
  page.onShow();
  page.save(page.data.book);
  const pending = page.choose();
  assert.equal(page.data.showPrivacy, true);
  page.privacyDecline();
  await pending;
  assert.equal(page.data.showPrivacy, false);
  assert.match(page.data.error, /草稿/);
  page.onHide();
  assert.equal(removed, true);
  page.onUnload();
});
test("mini templates use reactive conditions and bind existing page methods", () => {
  for (const name of ["home", "card", "outings", "shopping", "movement"]) {
    const runtime = miniRuntime(),
      page = runtime.page(name);
    const source = readFileSync(`miniprogram/pages/${name}/index.wxml`, "utf8");
    const template =
      source +
      (source.includes("/components/privacy.wxml")
        ? readFileSync("miniprogram/components/privacy.wxml", "utf8")
        : "");
    for (const match of template.matchAll(/\{\{([\s\S]+?)\}\}/g))
      assert.doesNotThrow(
        () => new vm.Script(`(${match[1]})`),
        `${name}: invalid template expression`,
      );
    for (const match of template.matchAll(/wx:(?:if|elif|for)="([^"]+)"/g))
      assert.match(match[1], /^\{\{[\s\S]+\}\}$/);
    for (const match of template.matchAll(
      /bind(?:tap|input|change|markertap|agreeprivacyauthorization)="([^"]+)"/g,
    ))
      assert.equal(typeof page[match[1]], "function", `${name}:${match[1]}`);
  }
});
test("mini scenarios match the core, preserve coordinate provenance, and never map demo or WGS84 as real points", async () => {
  const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const prefs = { ...emptyBook().preferences, minutes: 20, speedMps: 0.8 };
  const mini = scenario(source, prefs),
    core = personalize(source, prefs);
  assert.deepEqual(mini.contours, core.contours);
  assert.equal(reportView(mini).mapNative, false);
  assert.equal(mapPosition({ system: "demo", x: 0, y: 0 }), null);
  assert.equal(mapPosition({ system: "wgs84", lng: 121.5, lat: 31.2 }), null);
  assert.equal(
    facilityPlace(mini, mini.facilities[0].id).position.system,
    "demo",
  );
  assert.deepEqual(mapPosition(place.position), { lng: 121.5, lat: 31.2 });
  const bd = mapPosition({ system: "bd09", lng: 121.5065, lat: 31.206 });
  assert.ok(
    Math.abs(bd!.lng - 121.5) < 0.0002 && Math.abs(bd!.lat - 31.2) < 0.0005,
  );
  const real = {
    ...mini,
    mode: "baidu" as const,
    center: { ...mini.center, geo: { lng: 121.5065, lat: 31.206 } },
  };
  real.contours = [
    {
      minutes: 20,
      areaKm2: 0.1,
      clipped: false,
      polygons: [
        [
          [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 0],
          ],
          [
            [20, 20],
            [30, 20],
            [20, 30],
            [20, 20],
          ],
        ],
      ],
    },
  ];
  const view = reportView(real);
  assert.equal(view.mapNative, true);
  assert.equal(view.mapPolygons.length, 0);
  assert.equal(view.mapPolylines.length, 2);
  assert.equal(view.mapHasHoles, true);
  assert.equal(
    facilityPlace(real, real.facilities[0].id).position.system,
    "bd09",
  );
});
test("place books keep cross-client photos and favorites, while rejecting unsafe or excessive photos", () => {
  assert.deepEqual(cleanPlace(place), place);
  assert.equal(
    cleanBook({ ...emptyBook(), places: [place] }).places[0].photo,
    place.photo,
  );
  for (const photo of [
    "https://example.test/a.png",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64," + "A".repeat(MAX_PHOTO_LENGTH),
  ])
    assert.throws(() => cleanPlace({ ...place, photo }));
  assert.throws(() =>
    cleanBook({
      ...emptyBook(),
      places: Array.from({ length: 20 }, (_, i) => ({
        ...place,
        id: `p${i}`,
        photo: "data:image/png;base64," + "A".repeat(60000),
      })),
    }),
  );
  assert.equal(
    placeList([place, { ...place, id: "other", favorite: false }], "雨棚", true)
      .length,
    1,
  );
});
test("offline home changes time locally, preserves denied-location drafts and calibrates pace", async () => {
  const storage = new Map<string, any>(),
    runtime = miniRuntime(storage),
    page = runtime.page();
  page.onLoad();
  assert.equal(page.data.result.mode, "demo");
  await page.quickTime({ currentTarget: { dataset: { minutes: 10 } } });
  assert.equal(page.data.minutes, 10);
  page.field({
    currentTarget: { dataset: { key: "form.name" } },
    detail: { value: "还没定位的小店" },
  });
  page.field({
    currentTarget: { dataset: { key: "form.address" } },
    detail: { value: "街道门牌" },
  });
  await page.choose();
  assert.match(page.data.error, /草稿/);
  await page.remember();
  assert.equal(page.data.book.places.length, 0);
  assert.equal(storage.get("yike-place-draft").form.name, "还没定位的小店");
  page.onUnload();
  const resumed = miniRuntime(storage).page();
  resumed.onLoad();
  assert.equal(resumed.data.form.address, "街道门牌");
  resumed.data.calibrationSeconds = "125";
  await resumed.calibrate();
  assert.equal(resumed.data.book.preferences.speedMps, 0.8);
  resumed.data.calibrationSeconds = "0";
  await resumed.calibrate();
  assert.match(resumed.data.error, /50—333秒/);
  resumed.onUnload();
});
test("photo and favorite survive mini editing; failed draft storage never reports success", async () => {
  const storage = new Map<string, any>([
    ["yike-life", { ...emptyBook(), places: [place] }],
  ]);
  const page = miniRuntime(storage).page();
  page.onLoad();
  await page.edit({ currentTarget: { dataset: { id: place.id } } });
  page.data.form.landmark = "新的雨棚";
  await page.remember();
  assert.equal(page.data.book.places[0].photo, place.photo);
  assert.equal(page.data.book.places[0].favorite, true);
  page.onUnload();
  const failure = miniRuntime(new Map(), {
    setStorageSync: () => {
      throw new Error("full");
    },
  }).page();
  failure.onLoad();
  failure.data.form.name = "地址草稿";
  await failure.remember();
  assert.match(failure.data.error, /尚未保存/);
  assert.ok(!failure.data.status.includes("已保存地址草稿"));
  failure.onUnload();
});
test("a received mini card uses no device credential, leaves pairing unchanged and handles expiry", async () => {
  const storage = new Map<string, any>([
    ["yike-token", "private-device-token"],
    ["yike-server", "https://home.example"],
  ]);
  let request: any,
    expired = false;
  const runtime = miniRuntime(storage, {
    request: (o: any) => {
      request = o;
      o.success(
        expired
          ? { statusCode: 404, data: { error: "卡片已过期" } }
          : {
              statusCode: 200,
              data: { place, expiresAt: "2026-10-14T00:00:00Z" },
            },
      );
    },
  });
  const page = runtime.page("card");
  await page.onLoad({
    share: "a".repeat(32),
    server: "https://family.example",
  });
  assert.equal(page.data.place.name, place.name);
  assert.equal(request.url, "https://family.example/api/card");
  assert.equal(request.header.Authorization, undefined);
  assert.equal(request.header["X-Yike-Card"], "a".repeat(32));
  assert.equal(storage.get("yike-token"), "private-device-token");
  assert.equal(storage.get("yike-server"), "https://home.example");
  assert.match(page.onShareAppMessage().path, /pages\/card\/index/);
  expired = true;
  await page.load();
  assert.equal(page.data.place, null);
  assert.match(page.data.error, /过期/);
  page.onUnload();
});
