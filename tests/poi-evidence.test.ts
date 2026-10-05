import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  parseEvidenceFile,
  applyEvidenceFile,
  evidenceFile,
} from "../src/core/poi-evidence.js";
import { parseResultFile } from "../src/shared/result-file.js";
import { reviewState } from "../src/shared/facility-review.js";
import { facilityCount } from "../src/core/facilities.js";
import { coverageSummary } from "../src/core/coverage.js";
import type { FacilityEvidence } from "../src/shared/types.js";

const evidence = (
  status: FacilityEvidence["status"],
  source = "测试台账",
  checkedAt = "2026-10-05T02:00:00.000Z",
): FacilityEvidence => ({
  source,
  recordId: "001",
  checkedAt,
  status,
  basis: "测试用例，不代表真实设施核验",
});

test("source-scoped IDs preserve conflicts and same-source history", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const facility = result.facilities[0];
  const file = {
    format: "yike-poi-evidence-v1" as const,
    resultId: result.id,
    entries: [
      { facilityId: facility.id, evidence: evidence("confirmed") },
      { facilityId: facility.id, evidence: evidence("closed", "另一来源") },
    ],
  };
  const reviewed = applyEvidenceFile(result, file);
  assert.equal(reviewState(reviewed.facilities[0]), "conflict");
  assert.equal(reviewed.facilities[0].evidence?.length, 2);
  assert.equal(
    facility.evidence,
    undefined,
    "original result remains recoverable",
  );
  const updated = applyEvidenceFile(reviewed, {
    ...file,
    entries: [
      {
        facilityId: facility.id,
        evidence: evidence("confirmed", "另一来源", "2026-10-05T03:00:00.000Z"),
      },
    ],
  });
  assert.equal(reviewState(updated.facilities[0]), "confirmed");
  assert.equal(
    updated.facilities[0].evidence?.length,
    3,
    "prior source versions are retained",
  );
  assert.equal(
    applyEvidenceFile(updated, evidenceFile(updated)).facilities[0].evidence
      ?.length,
    3,
    "reimport is idempotent",
  );
});

test("closed facilities no longer count as reachable or support coverage, without claiming proven absence", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const markets = result.facilities.filter((f) => f.category === "market");
  const original = facilityCount(result.facilities, "market", 15);
  const reviewed = applyEvidenceFile(result, {
    format: "yike-poi-evidence-v1",
    resultId: result.id,
    entries: markets.map((f) => ({
      facilityId: f.id,
      evidence: evidence("closed"),
    })),
  });
  assert.ok(original > 0);
  assert.equal(facilityCount(reviewed.facilities, "market", 15), 0);
  assert.ok(
    coverageSummary(reviewed).find((r) => r.category === "market")!.unknown > 0,
  );
  assert.ok(
    reviewed.gaps
      .filter((g) => g.category === "market")
      .every((g) => g.status === "unknown"),
  );
  assert.deepEqual(reviewed.usage, result.usage);
  assert.deepEqual(reviewed.contours, result.contours);
});

test("evidence import rejects wrong report, unknown IDs, excessive files and missing provenance atomically", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const file = {
    format: "yike-poi-evidence-v1",
    resultId: result.id,
    entries: [
      { facilityId: result.facilities[0].id, evidence: evidence("confirmed") },
    ],
  };
  for (const bad of [
    { ...file, resultId: "other" },
    {
      ...file,
      entries: [
        ...file.entries,
        { facilityId: "not-found", evidence: evidence("closed") },
      ],
    },
    {
      ...file,
      entries: [
        {
          facilityId: result.facilities[0].id,
          evidence: { ...evidence("confirmed"), basis: "" },
        },
      ],
    },
    {
      ...file,
      entries: [
        {
          facilityId: result.facilities[0].id,
          evidence: { ...evidence("confirmed"), checkedAt: "next year" },
        },
      ],
    },
  ])
    assert.throws(() => parseEvidenceFile(JSON.stringify(bad), result));
  assert.throws(() => parseEvidenceFile(" ".repeat(500001), result), /500KB/);
  assert.ok(result.facilities.every((f) => !f.evidence));
});

test("result round-trip keeps provenance, strips foreign fields and reconciles stale gap claims", async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  for (const f of result.facilities)
    if (f.category === "market")
      f.evidence = [
        { ...evidence("closed"), token: "discard" } as FacilityEvidence,
      ];
  const replay = parseResultFile(JSON.stringify(result));
  assert.ok(!JSON.stringify(replay).includes("discard"));
  assert.equal(replay.complete.market, false);
  assert.ok(
    replay.gaps.some((g) => g.category === "market" && g.status === "unknown"),
  );
  assert.deepEqual(parseResultFile(JSON.stringify(replay)), replay);
});
