import { mkdir, writeFile } from "node:fs/promises";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";

const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
await mkdir("reports", { recursive: true });
await writeFile(
  "reports/demo-analysis.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log("模拟体检已保存：reports/demo-analysis.json");
