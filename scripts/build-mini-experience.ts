import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { build } from "esbuild";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
await mkdir("miniprogram/shared", { recursive: true });
await mkdir("miniprogram/assets", { recursive: true });
await build({
  entryPoints: ["src/mini/experience.ts"],
  outfile: "miniprogram/shared/experience.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  minify: true,
  mainFields: ["module", "main"],
  legalComments: "inline",
});
await build({
  entryPoints: ["src/mini/outings.ts"],
  outfile: "miniprogram/shared/outings-ui.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  minify: true,
  legalComments: "inline",
});
const demo = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
await build({
  entryPoints: ["src/mini/planning.ts"],
  outfile: "miniprogram/shared/planning-ui.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  minify: true,
  legalComments: "inline",
});
await build({
  entryPoints: ["src/mini/shopping.ts"],
  outfile: "miniprogram/shared/shopping-ui.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  minify: true,
  legalComments: "inline",
});
demo.id = "offline-neighborhood-v1";
await build({
  entryPoints: ["src/mini/movement.ts"],
  outfile: "miniprogram/shared/movement-ui.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  minify: true,
  legalComments: "inline",
});
demo.generatedAt = "2026-10-07T00:00:00.000Z";
demo.elapsedMs = 0;
await writeFile(
  "miniprogram/shared/demo.js",
  `module.exports=${JSON.stringify(demo)};\n`,
);
await copyFile(
  "materials/wechat-avatar-v8-144.png",
  "miniprogram/assets/place.png",
);
