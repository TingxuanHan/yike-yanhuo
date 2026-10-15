import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (resolve(process.cwd()) !== resolve(root))
  throw new Error("请从项目根目录构建小程序。");
const stage = ".cache/mini-source";
// Keep the live generated directory present while Developer Tools watches it.
// Removing it mid-build can leave its module index missing newly added files.
for (const relative of [stage]) {
  const target = resolve(root, relative);
  if (!target.startsWith(resolve(root) + sep))
    throw new Error("生成目录超出项目范围。");
  await rm(target, { recursive: true, force: true });
}
await mkdir(stage, { recursive: true });
await mkdir("miniprogram/shared", { recursive: true });
await writeFile(`${stage}/package.json`, JSON.stringify({ type: "commonjs" }));
for (const name of [
  "types",
  "journey",
  "life",
  "facility-review",
  "outings",
  "shopping",
  "movement",
  "planning",
  "planning-draft",
  "trip",
  "trip-feedback",
  "trip-adjust",
  "assistance",
  "entrance",
  "family",
  "departure",
  "walking-guide",
  "mobility",
  "walk-calibration",
])
  await copyFile(`src/shared/${name}.ts`, `${stage}/${name}.ts`);
