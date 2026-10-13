import { mkdir, copyFile, writeFile } from "node:fs/promises";
const stage = ".cache/mini-source";
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
