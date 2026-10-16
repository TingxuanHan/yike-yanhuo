import { readFile } from "node:fs/promises";
import { parseContourAudit } from "../src/core/contour-audit.js";
const path = process.argv[2];
if (!path) throw new Error("请指定Web导出的抽点复核JSON文件。");
const audit = parseContourAudit(await readFile(path, "utf8"));
console.log(
  JSON.stringify({
    schema: audit.schema,
    evidence: audit.evidence,
    verifiedPoints: audit.plan.count,
    metrics: audit.metrics,
    paired: audit.paired,
    externalApiCalls: 0,
  }),
);
