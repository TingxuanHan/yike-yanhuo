import { mkdir, writeFile } from "node:fs/promises";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import {
  contourAuditPlan,
  executeContourAudit,
  parseContourAudit,
} from "../src/core/contour-audit.js";
const report = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
report.id = "contour-audit-demo-v1";
report.generatedAt = "2026-10-16T00:00:00.000Z";
report.elapsedMs = 0;
const records = [];
await mkdir(".cache/contour-audit", { recursive: true });
for (const minutes of [5, 15])
  for (const count of [6, 12]) {
    const audit = await executeContourAudit(
      report,
      contourAuditPlan(report, minutes, count),
      new DemoProvider(),
      undefined,
      undefined,
      () => "2026-10-16T01:00:00.000Z",
    );
    parseContourAudit(JSON.stringify(audit));
    records.push(audit);
    await writeFile(
      `.cache/contour-audit/demo-${minutes}-${count}.json`,
      JSON.stringify(audit, null, 2) + "\n",
    );
  }
await writeFile(
  ".cache/contour-audit/simulation.json",
  JSON.stringify(
    { evidence: "simulation", externalApiCalls: 0, records },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    evidence: "simulation",
    externalApiCalls: 0,
    cases: records.map((a) => ({
      minutes: a.plan.minutes,
      count: a.plan.count,
      metrics: a.metrics,
      paired: a.paired,
    })),
  }),
);
