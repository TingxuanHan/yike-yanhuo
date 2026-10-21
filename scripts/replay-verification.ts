import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { parseVerificationEvidence } from "../src/core/verification.js";
import { coverageArea } from "../src/core/coverage-area.js";

const path = process.argv[2];
if (!path) throw new Error("请指定Web导出的补查前后JSON文件路径。");
const raw = await readFile(path, "utf8"),
  supplied = JSON.parse(raw.replace(/^\uFEFF/, "")),
  evidence = parseVerificationEvidence(raw.replace(/^\uFEFF/, ""));
assert.deepEqual(evidence.diff, supplied.diff, "导出摘要与报告复算不一致");
let maxConservationErrorSquareMeters = 0;
for (const report of [evidence.before, evidence.after]) {
  assert.equal(
    report.samples.filter((s) => s.travel.status === "ok").length,
    report.quality.knownSamples,
  );
  assert.equal(report.samples.length, report.quality.totalSamples);
  const area = coverageArea(
    report,
    evidence.diff.category,
    evidence.diff.minutes,
  );
  const error = Math.abs(
    Object.values(area.squareMeters).reduce((sum, n) => sum + n, 0) -
      area.totalSquareMeters,
  );
  assert.ok(error < 0.001, "覆盖分区面积不守恒");
  maxConservationErrorSquareMeters = Math.max(
    maxConservationErrorSquareMeters,
    error,
  );
}
assert.equal(
  evidence.after.baseGeneratedAt,
  evidence.before.baseGeneratedAt ??
    evidence.before.derivedFrom?.sourceGeneratedAt ??
    evidence.before.generatedAt,
);
console.log(
  JSON.stringify({
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    evidence: evidence.evidence,
    verifiedReports: 2,
    localSearches: evidence.after.localSearches?.length ?? 0,
    maxConservationErrorSquareMeters,
    externalApiCalls: 0,
  }),
);
