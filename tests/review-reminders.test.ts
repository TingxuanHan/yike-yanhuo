import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  cleanEvidence,
  reviewReminders,
  reviewSchedule,
  reviewState,
  usableFacility,
} from "../src/shared/facility-review.js";
import {
  applyEvidenceFile,
  evidenceFile,
  parseEvidenceFile,
} from "../src/core/poi-evidence.js";
import { parseResultFile } from "../src/shared/result-file.js";
import type { Facility, FacilityEvidence } from "../src/shared/types.js";
import { miniRuntime } from "./helpers/mini.js";

const now = Date.parse("2026-10-15T00:00:00Z");
const evidence: FacilityEvidence = {
  source: "模拟台账",
  recordId: "M1",
  checkedAt: "2026-10-01T00:00:00Z",
  nextReviewAt: "2026-10-15T00:00:00Z",
  status: "confirmed",
  basis: "测试记录",
};
const facility: Facility = {
  id: "m",
  name: "模拟店铺",
  category: "market",
  point: [0, 0],
  address: "示例",
  evidence: [evidence],
};

test("review reminders use latest source records and never change historical conclusions", () => {
  const original = JSON.stringify(facility);
  assert.equal(reviewSchedule(facility, now).state, "due");
  assert.equal(reviewSchedule(facility, now - 1).state, "soon");
  assert.equal(reviewSchedule(facility, now - 8 * 86400000).state, "scheduled");
  assert.equal(usableFacility(facility), true);
  assert.equal(reviewState(facility), "confirmed");
  const renewed = {
    ...facility,
    evidence: [
      evidence,
      {
        ...evidence,
        checkedAt: "2026-10-15T01:00:00Z",
        nextReviewAt: "2026-11-15T00:00:00Z",
      },
    ],
  };
  assert.equal(reviewSchedule(renewed, now).state, "scheduled");
  const unscheduled = {
    ...renewed,
    evidence: [
      ...renewed.evidence,
      {
        ...evidence,
        checkedAt: "2026-10-16T00:00:00Z",
        nextReviewAt: undefined,
      },
    ],
  };
  assert.equal(reviewSchedule(unscheduled, now).state, "unscheduled");
  const conflict = {
    ...renewed,
    evidence: [
      ...renewed.evidence,
      { ...evidence, source: "另一来源", status: "closed" as const },
    ],
  };
  assert.equal(reviewState(conflict), "conflict");
  assert.equal(reviewSchedule(conflict, now).state, "due");
  assert.equal(usableFacility(conflict), false);
  assert.equal(JSON.stringify(facility), original);
  assert.equal(
    reviewSchedule({ ...facility, evidence: [] }, now).state,
    "unreviewed",
  );
});

test("deadline validation rejects invalid dates and deadlines before a review, while old files remain compatible", async () => {
  for (const nextReviewAt of [
    "2026-02-30T00:00:00Z",
    "2026-10-01T00:00:00Z",
    "yesterday",
    null,
    0,
  ])
    assert.throws(() => cleanEvidence({ ...evidence, nextReviewAt }));
  const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]),
    before = JSON.stringify(source);
  assert.deepEqual(parseResultFile(before).facilities, source.facilities);
  const reviewed = applyEvidenceFile(source, {
    format: "yike-poi-evidence-v1",
    resultId: source.id,
    entries: [{ facilityId: source.facilities[0].id, evidence }],
  });
  const restored = parseResultFile(JSON.stringify(reviewed));
  assert.equal(
    restored.facilities[0].evidence![0].nextReviewAt,
    "2026-10-15T00:00:00.000Z",
  );
  assert.equal(reviewReminders(restored.facilities, now).due, 1);
  assert.equal(
    reviewReminders(restored.facilities, now).items[0].entry.source,
    evidence.source,
  );
  assert.deepEqual(restored.contours, source.contours);
  const file = evidenceFile(restored);
  assert.deepEqual(parseEvidenceFile(JSON.stringify(file), source), file);
  assert.equal(JSON.stringify(source), before);
});

test("native reminders read shared report deadlines and preserve storage and recorded status", async () => {
  const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  source.facilities[0].evidence = [
    {
      ...evidence,
      checkedAt: "2000-01-01T00:00:00Z",
      nextReviewAt: "2000-02-01T00:00:00Z",
    },
  ];
  const storage = new Map<string, any>([["yike-last-report", source]]);
  const page = miniRuntime(storage).page();
  page.onLoad();
  page.openReview();
  const saved = JSON.stringify([...storage]),
    original = JSON.stringify(page.data.result);
  page.refreshReminders();
  assert.equal(page.data.reminders.due, 1);
  assert.equal(page.data.reminders.items[0].reviewLabel, "记录可用");
  assert.equal(JSON.stringify([...storage]), saved);
  assert.equal(JSON.stringify(page.data.result), original);
  page.closeReview();
  page.onUnload();
});
