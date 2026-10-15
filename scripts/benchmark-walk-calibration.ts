import { mkdir, writeFile } from "node:fs/promises";
import {
  prepareWalk,
  finishWalk,
  calibrationExport,
  type WalkTrial,
} from "../src/shared/walk-calibration.js";

// Constructed observations exercise the protocol; they are not measured human walks.
const epoch = Date.parse("2026-10-16T00:00:00.000Z");
const cases = [
  {
    id: "steady-slower",
    label: "稳定较慢步速",
    train: [0.8, 0.8, 0.8],
    later: [0.8, 0.8, 0.8],
    waits: [0, 30, 60],
  },
  {
    id: "steady-with-stops",
    label: "稳定步速并有等灯停歇",
    train: [1, 1, 1],
    later: [1, 1, 1],
    waits: [30, 90, 120],
  },
  {
    id: "changed-habit",
    label: "后续走法改变，建议可能更差",
    train: [0.8, 0.8, 0.8],
    later: [1.2, 1.2, 1.2],
    waits: [0, 30, 0],
  },
  {
    id: "inconsistent-history",
    label: "历史步速差异过大，暂不给建议",
    train: [0.5, 1, 2],
    later: [],
    waits: [],
  },
];
const output = cases.map((c) => {
  const history: WalkTrial[] = [];
  const speeds = [...c.train, ...c.later];
  speeds.forEach((speed, i) => {
    const started = epoch + i * 3600000;
    const meters = i < 3 ? 100 : [100, 200, 300][i - 3]!;
    const stopped = i < 3 ? 0 : c.waits[i - 3]!;
    const pending = prepareWalk(
      {
        label: `构造路段${i + 1}`,
        meters,
        distanceSource: "measured",
        usual: true,
      },
      1.2,
      history,
      started,
      `walk-${c.id}-${i}`,
    );
    history.push(
      finishWalk(pending, meters / speed + stopped, stopped, started + 1800000),
    );
  });
  return {
    id: c.id,
    label: c.label,
    evidence: "simulation",
    baselineMps: 1.2,
    ...calibrationExport(history, epoch + 24 * 3600000),
  };
});
const artifact = {
  format: "yike-calibration-benchmark-v1",
  evidence: "simulation",
  scenarioCount: cases.length,
  liveApiCalls: 0,
  explanation:
    "固定构造场景，先建立3条历史记录，再准备并观察后续记录。两种方法比较同一批后续记录；所有距离和用时均为程序构造，不构成真实居民精度证据。",
  results: output,
};
await mkdir("docs/experiments", { recursive: true });
await writeFile(
  "docs/experiments/walk-calibration-simulation.json",
  JSON.stringify(artifact, null, 2) + "\n",
);
const rows = output.map(
  (c) =>
    `| ${c.label} | ${c.summary.evaluationCount} | ${c.summary.baselineMaeSeconds ?? "—"} | ${c.summary.calibratedMaeSeconds ?? "—"} | ${c.summary.ready ? "可试用" : "暂不给建议"} |`,
);
await writeFile(
  "docs/experiments/walk-calibration-simulation.md",
  [
    "# 实走校准协议的固定构造对照",
    "",
    artifact.explanation,
    "",
    "运行：`npm run benchmark:walk`。没有地图、模型、定位或录音调用。",
    "",
    "| 构造场景 | 成对后续记录数 | 当时设置平均绝对误差（秒） | 事先建议平均绝对误差（秒） | 最终建议状态 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "基线为每条准备记录中的1.2米/秒；建议为准备前有效历史步速的中位数。总用时减去停留后才作为纯步行观测。记录不足、步速最大值与最小值之比超过1.5时不给建议；本阈值是产品保护规则，尚未人群验证。",
    "",
    "后续走法改变时，历史建议可能劣于默认步速，不能声称校准必然提升精度。实际界面保留两边误差、排除原因和原始预测，用户需重新积累相近路况记录。",
    "",
    "公开构造文件内部的 distanceSource=measured 只用于覆盖算法中的本人填报分支；顶层 evidence=simulation、场景名称及路段名称均明确标注构造。绝不能把该文件导入为用户的真实实走证据。",
    "",
    "明细：[JSON](walk-calibration-simulation.json)。实际现场采集步骤见[实走校准](../walk-calibration.md)。",
    "",
  ].join("\n"),
);
for (const c of output)
  console.log(
    `${c.label}: paired=${c.summary.evaluationCount}, baselineMAE=${c.summary.baselineMaeSeconds}, priorMAE=${c.summary.calibratedMaeSeconds}`,
  );
