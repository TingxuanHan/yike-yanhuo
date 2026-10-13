import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (resolve(process.cwd()) !== resolve(root))
  throw new Error("请从项目根目录构建小程序。");
const stage = ".cache/mini-source";
for (const relative of [stage, "miniprogram/shared"]) {
  const target = resolve(root, relative);
  if (!target.startsWith(resolve(root) + sep))
    throw new Error("生成目录超出项目范围。");
  await rm(target, { recursive: true, force: true });
}
await mkdir(stage, { recursive: true });
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
  "trip",
  "trip-feedback",
  "trip-adjust",
  "assistance",
  "entrance",
])
  await copyFile(`src/shared/${name}.ts`, `${stage}/${name}.ts`);
