import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { personalize } from "../src/core/personalize.js";
import { DEFAULT_JOURNEY } from "../src/shared/journey.js";
import {
  compareSitingConditions,
  sitingConditionDefaults,
  sitingConditionsEvidence,
} from "../src/core/siting-conditions.js";
import { detourEvidence } from "../src/core/detour-audit.js";
import { sitingOptions } from "../src/core/facility-siting.js";
import { replayPlanningEvidence } from "../src/core/planning-evidence.js";
import { parseResultFile } from "../src/shared/result-file.js";

const historical = process.argv[2];
await mkdir(".cache/planning-evidence", { recursive: true });
if (historical) {
  const raw = await readFile(historical, "utf8"),
    report = parseResultFile(raw);
  if (report.mode !== "baidu") throw new Error("历史对照需使用百度报告。");
  const evidence = detourEvidence(report, 15);
  const comparison = compareSitingConditions(
    report,
    "school",
    15,
    sitingOptions(report, "school", 15)
      .slice(0, 3)
      .map((p) => p.id),
    sitingConditionDefaults(report),
  );
  const output = {
    evidence: "historical-api-replay",
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    sourceId: report.id,
    baseGeneratedAt: report.baseGeneratedAt ?? report.generatedAt,
    counts: evidence.audit.counts,
    detourHotspots: evidence.audit.hotspots.length,
    conditionDomainSquareMeters: comparison.conditions.map(
      (c) => c.domainSquareMeters,
    ),
    maxGapGainSquareMeters: Math.max(
      ...comparison.plans.flatMap((p) =>
        p.values.map((v) => v.gainSquareMeters),
      ),
    ),
    checks: [
      replayPlanningEvidence(JSON.stringify(evidence)),
      replayPlanningEvidence(
        JSON.stringify(sitingConditionsEvidence(report, comparison)),
      ),
    ],
    externalApiCalls: 0,
    fieldValidated: false,
  };
  await writeFile(
    ".cache/planning-evidence/historical-summary.json",
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(JSON.stringify(output));
} else {
  const source = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  source.id = "planning-evidence-demo-v1";
  source.generatedAt = "2026-10-16T00:00:00.000Z";
  source.elapsedMs = 0;
  const shaped = structuredClone(source);
  shaped.id = "planning-evidence-ranking-change-v1";
  shaped.center.label = "构造情景：步速变化后的选址取舍";
  shaped.center.point = [0, 0];
  shaped.parameters.gapDistanceMeters = 400;
  shaped.parameters.searchRadiusMeters = 3000;
  shaped.facilities = [
    {
      id: "constructed-school",
      category: "school",
      name: "构造已有小学",
      address: "模拟位置",
      point: [0, 0],
      travel: { status: "ok", meters: 0, seconds: 0 },
    },
  ];
  for (const s of shaped.samples) {
    s.point = [
      s.point[0] - source.center.point[0],
      s.point[1] - source.center.point[1],
    ];
    s.travel = {
      status: "ok",
      meters: Math.hypot(...s.point),
      seconds: Math.hypot(...s.point) / 1.2,
    };
  }
  const changed = personalize(shaped, DEFAULT_JOURNEY, {
    id: shaped.id,
    createdAt: source.generatedAt,
  });
  const records = [source, changed].map((report, i) => {
    const options = sitingOptions(report, "school", 15);
    const chosen = i
      ? [-800, -400].map(
          (x) => options.find((p) => p.point[0] === x && p.point[1] === 0)!.id,
        )
      : options.slice(0, 3).map((p) => p.id);
    const config = {
      ...sitingConditionDefaults(report),
      ...(i ? { speedMps: 0.5 } : {}),
    };
    const comparison = compareSitingConditions(
      report,
      "school",
      15,
      chosen,
      config,
    );
    return {
      siting: sitingConditionsEvidence(report, comparison),
      detour: detourEvidence(report, 15),
    };
  });
  for (let i = 0; i < records.length; i++) {
    for (const kind of ["siting", "detour"] as const)
      await writeFile(
        `.cache/planning-evidence/${i}-${kind}.json`,
        JSON.stringify(records[i][kind], null, 2) + "\n",
      );
  }
  const output = {
    evidence: "simulation",
    externalApiCalls: 0,
    records,
    replay: records.flatMap((r) => [
      replayPlanningEvidence(JSON.stringify(r.siting)),
      replayPlanningEvidence(JSON.stringify(r.detour)),
    ]),
  };
  await writeFile(
    ".cache/planning-evidence/simulation.json",
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      evidence: output.evidence,
      replay: output.replay,
      winnerChange: records[1].siting.comparison.groups,
      cases: records.map((r) => ({
        id: r.siting.report.id,
        detours: r.detour.audit.hotspots.length,
        plans: r.siting.comparison.plans.map((p) => ({
          id: p.id,
          gain: p.values.map((v) => v.gainSquareMeters),
          maxRegret: p.maxRegretSquareMeters,
        })),
      })),
    }),
  );
}
