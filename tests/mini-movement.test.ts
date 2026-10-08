import test from "node:test";
import assert from "node:assert/strict";
import { miniRuntime } from "./helpers/mini.js";
import { cleanMovementTrip } from "../src/shared/movement.js";
import { cleanBook } from "../src/shared/life.js";

const event = (dataset: Record<string, unknown> = {}, value?: unknown) => ({
  currentTarget: { dataset },
  detail: { value },
});
test("native shopping and errands hand over their selected distances; movement drafts and preferences survive reload", async () => {
  const storage = new Map<string, any>();
  let navigation = "",
    copied = "";
  const overrides = {
    navigateTo: (o: any) => {
      navigation = o.url;
      o.success({});
    },
    setClipboardData: (o: any) => {
      copied = o.data;
      o.success({});
    },
  };
  for (const name of ["shopping", "outings"]) {
    const page = miniRuntime(storage, overrides).page(name);
    page.onLoad();
    if (name === "shopping") await page.calculate();
    else await page.errands();
    assert.equal(page.data.error, "");
    assert.ok(page.data.plans.length > 0);
    await page.movement(event({ index: 0 }));
    assert.equal(navigation, "/pages/movement/index");
    const trip = cleanMovementTrip(storage.get("yike-movement-trip"));
    assert.equal(trip.source, name === "shopping" ? "shopping" : "errands");
    assert.ok(trip.stops.every((s) => s.meters >= 0));
    const movement = miniRuntime(storage, overrides).page("movement");
    movement.onLoad();
    movement.onShow();
    assert.equal(movement.data.ready, true);
    movement.mode(event({ mode: "alternating" }));
    movement.field(event({ key: "targetMinutes" }, "30"));
    movement.calculate();
    assert.equal(movement.data.error, "");
    assert.equal(movement.data.preview.complete, true);
    assert.equal(movement.data.preview.feasible, true);
    assert.ok(
      movement.data.preview.legs
        .at(-1)
        .phases.every((p: any) => p.kind !== "brisk"),
    );
    await movement.copy();
    assert.match(copied, /不是实际运动记录/);
    assert.ok(copied.includes(trip.stops[0].name));
    movement.save();
    assert.equal(
      cleanBook(storage.get("yike-life")).movement?.targetMinutes,
      30,
    );
    movement.field(event({ key: "targetMinutes" }, "40"));
    assert.equal(movement.data.preview, null);
    assert.equal(
      cleanBook(storage.get("yike-life")).movement?.targetMinutes,
      30,
    );
    movement.onUnload();
    const reloaded = miniRuntime(storage, overrides).page("movement");
    reloaded.onLoad();
    assert.equal(reloaded.data.settings.targetMinutes, 40);
    await reloaded.load();
    assert.equal(reloaded.data.settings.targetMinutes, 30);
    reloaded.field(event({ key: "continuousMinutes" }, "1"));
    reloaded.calculate();
    assert.equal(reloaded.data.preview.feasible, false);
    await reloaded.copy();
    assert.match(reloaded.data.error, /完整方案/);
    reloaded.field(event({ key: "continuousMinutes" }, "0"));
    reloaded.field(event({ key: "briskMps" }, "0"));
    reloaded.calculate();
    assert.equal(reloaded.data.preview, null);
    assert.match(reloaded.data.error, /步速/);
    reloaded.onUnload();
    storage.delete("yike-movement-draft");
    if (name === "shopping") page.field(event({ key: "minutes" }, 0));
    else page.field(event({ key: "budget", number: true }, 0));
    await page.movement(event({ index: 0 }));
    assert.match(page.data.error, /完整|选择/);
    page.onUnload();
  }
});
test("movement storage failure retains input and does not claim a saved preference", () => {
  const page = miniRuntime(new Map(), {
    setStorageSync: () => {
      throw new Error("storage full");
    },
  }).page("movement");
  page.onLoad();
  page.field(event({ key: "targetMinutes" }, "35"));
  assert.equal(page.data.settings.targetMinutes, 35);
  assert.match(page.data.error, /草稿尚未保存/);
  page.save();
  assert.match(page.data.error, /内容尚未保存/);
  assert.equal(page.data.status, "");
  page.calculate();
  assert.equal(page.data.preview.complete, true);
  assert.match(page.data.preview.goal, /还差/);
  page.onUnload();
});
