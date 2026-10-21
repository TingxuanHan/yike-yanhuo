import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { replayPlanningEvidence } from "../src/core/planning-evidence.js";
const path = process.argv[2];
if (!path) throw new Error("请传入多条件补点或绕行诊断导出的JSON文件路径。");
if ((await stat(path)).size > 8_000_000) throw new Error("依据文件超过8MB。");
const raw = await readFile(path, "utf8");
console.log(
  JSON.stringify({
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    ...replayPlanningEvidence(raw),
  }),
);
