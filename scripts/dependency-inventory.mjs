import { readFile, writeFile, mkdir } from "node:fs/promises";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const rows = Object.entries(lock.packages)
  .filter(([path]) => path)
  .map(([path, p]) => ({
    name: path.split("node_modules/").at(-1),
    version: p.version,
    license: p.license ?? "UNDECLARED",
    use: p.dev ? "development" : "runtime",
    optional: !!p.optional,
    source: `https://www.npmjs.com/package/${path.split("node_modules/").at(-1)}/v/${p.version}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
if (rows.some((r) => r.license === "UNDECLARED"))
  throw new Error(
    "Dependency license declaration missing; review before release.",
  );
await mkdir("docs/governance", { recursive: true });
await writeFile(
  "docs/governance/dependencies.json",
  JSON.stringify(
    { lockfileVersion: lock.lockfileVersion, packages: rows },
    null,
    2,
  ) + "\n",
);
const head = `# 第三方依赖与材料说明\n\n依据当前package-lock.json，包含平台可选包；清单是许可证声明盘点，不等同于完整法律审计。项目自有代码采用MIT，上游软件各自保留原许可。生成命令：\`node scripts/dependency-inventory.mjs\`。\n\n- 分发依赖时保留其版权、LICENSE和NOTICE；本仓库不打包node_modules。准确源码位置见各包发布页及其Repository链接。\n- MPL-2.0项属于构建工具链（如lightningcss及平台包），不因项目采用MIT而改为MIT；如分发其二进制或修改源码，需保留对应通知并提供该部分源码获取途径。[Mozilla官方说明](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。\n- 百度地图数据、底图、商标与服务不属于本项目MIT授权范围；截图与小规模API案例仅作功能和实验说明，不作为开放地图数据集。完整原始实验数据仍在本机忽略目录。\n- 模型／语音服务及模型权重遵循供应商与模型自己的条款；仓库不分发模型权重或供应商密钥。\n- 视频使用本机中文语音和项目画面，没有引入第三方音乐；制作工具与系统字体不随源码打包。\n\n| 包 | 版本 | 许可证声明 | 用途 | 来源 |\n| --- | --- | --- | --- | --- |\n`;
await writeFile(
  "THIRD_PARTY_NOTICES.md",
  head +
    rows
      .map(
        (r) =>
          `| ${r.name} | ${r.version} | ${r.license} | ${r.use}${r.optional ? " / optional" : ""} | [发布页](${r.source}) |`,
      )
      .join("\n") +
    "\n",
);
console.log(JSON.stringify({ packages: rows.length, undeclared: 0 }));
