import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanMovement,
  defaultMovement,
  demoMovementTrip,
  planMovement,
  cleanMovementTrip,
} from "../src/shared/movement.js";
import { cleanBook, emptyBook, mergeBooks } from "../src/shared/life.js";
import { estimateJourney } from "../src/shared/journey.js";
import { movementView } from "../src/mini/movement.js";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("movement conserves route distance, separates walking from stops, and keeps the return gentle", () => {
  const t = demoMovementTrip(),
    s = { ...defaultMovement(), mode: "alternating" as const };
  const r = planMovement(t, s);
  assert.equal(r.feasible, true);
  assert.equal(r.complete, true);
  close(r.stayMinutes, 7);
  close(r.totalMinutes, r.walkingMinutes + r.waitingMinutes + r.stayMinutes);
  assert.ok(r.briskMinutes > 0);
  assert.equal(
    r.legs.at(-1)!.phases.some((p) => p.kind === "brisk"),
    false,
  );
  r.legs.forEach((l, i) =>
    close(
      l.phases.reduce((v, p) => v + p.meters, 0),
      t.stops[i].meters,
    ),
  );
  const copy = structuredClone(t);
  planMovement(t, s);
  assert.deepEqual(t, copy);
  for (const easy of [0.3, 0.73, 1.2, 1.87])
    for (const brisk of [easy + 0.01, Math.min(2, easy + 0.1)]) {
      const value = planMovement(t, { ...s, easyMps: easy, briskMps: brisk });
      close(
        value.walkingMinutes,
        value.legs.reduce((v, l) => v + l.walking, 0),
      );
      assert.ok(value.briskMinutes <= value.walkingMinutes);
    }
});
test("paced crossings use arrival time including earlier waits and exclude waiting from activity", () => {
  const t = demoMovementTrip();
  t.prefs = {
    ...t.prefs,
    departure: "08:57",
    signals: {
      ...t.prefs.signals,
      enabled: true,
      crossingsPerKm: 10,
      peakSeconds: 30,
      offPeakSeconds: 5,
    },
  };
  t.stops = [
    { id: "shop", name: "店", meters: 500, stayMinutes: 0 },
    { id: "home", name: "回家", meters: 500, stayMinutes: 0 },
  ];
  const r = planMovement(t, {
    ...defaultMovement(1),
    warmMinutes: 0,
    returnEasy: false,
  });
  const baseline = estimateJourney(500, { ...t.prefs, speedMps: 1 });
  close(r.legs[0].signalWait, baseline.waitingSeconds / 60);
  close(r.legs[0].walking, 500 / 60);
  const faster = planMovement(t, {
    ...defaultMovement(1),
    mode: "alternating",
    briskMps: 2,
    warmMinutes: 0,
    briskMinutes: 2,
    recoverMinutes: 2,
    returnEasy: false,
  });
  // 100m at 2m/s (08:57:50), then a 30s wait; another 50s walk still lands in peak.
  close(faster.legs[0].phases[1].seconds, 30);
  close(faster.legs[0].phases[3].seconds, 30);
  assert.ok(faster.walkingMinutes < r.walkingMinutes);
});
test("pacing rechecks opening windows, total budget, additional time and verified rests", () => {
  const t = demoMovementTrip(),
    s = { ...defaultMovement(), continuousMinutes: 12 };
  assert.equal(planMovement(t, s).feasible, true);
  t.stops[1].rest!.validUntil = "2026-01-01";
  t.stops[1].rest!.checkedOn = "2026-01-01";
  const expired = planMovement(t, s);
  assert.equal(expired.feasible, false);
  assert.match(expired.issues.join(), /连续步行/);
  const slow = planMovement(demoMovementTrip(), {
    ...defaultMovement(),
    easyMps: 0.5,
  });
  assert.match(slow.issues.join(), /整趟超出/);
  assert.match(slow.issues.join(), /超过允许/);
  const closed = demoMovementTrip();
  closed.stops[0].opening = { start: "09:00", end: "09:04" };
  const impossible = planMovement(closed, defaultMovement());
  assert.equal(impossible.complete, false);
  assert.equal(impossible.feasible, false);
  close(
    impossible.totalMinutes,
    impossible.walkingMinutes +
      impossible.waitingMinutes +
      impossible.stayMinutes,
  );
  close(
    impossible.walkingMinutes,
    impossible.legs.reduce((v, l) => v + l.walking, 0),
  );
  assert.match(movementView(impossible).extra, /暂不比较/);
  const midnight = demoMovementTrip();
  midnight.prefs.departure = "23:55";
  midnight.stops[0].opening = { start: "23:00", end: "02:00" };
  assert.match(planMovement(midnight, defaultMovement()).finish, /次日/);
});
test("goals are estimates, invalid settings are rejected and old books remain compatible", () => {
  const t = demoMovementTrip(),
    s = { ...defaultMovement(), targetMinutes: 90 };
  const r = planMovement(t, s);
  assert.ok(r.targetMissing > 60);
  assert.equal(r.feasible, true);
  assert.throws(() => cleanMovement({ ...s, briskMps: 3 }), /步速/);
  assert.throws(
    () => cleanMovement({ ...s, mode: "alternating", briskMps: s.easyMps }),
    /高于/,
  );
  assert.throws(
    () => cleanMovementTrip({ ...t, stops: [...t.stops, t.stops[0]] }),
    /重复/,
  );
  const a = cleanBook({ ...emptyBook(), movement: s });
  assert.equal(mergeBooks(emptyBook(), a).movement?.targetMinutes, 90);
  assert.equal(
    mergeBooks(a, { ...emptyBook(), movement: defaultMovement() }).movement
      ?.targetMinutes,
    90,
  );
  assert.equal(cleanBook(emptyBook()).movement, undefined);
});
