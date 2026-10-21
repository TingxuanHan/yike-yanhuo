import { readFile, access } from "node:fs/promises";
import vm from "node:vm";
const project = JSON.parse(
  await readFile("miniprogram/project.config.json", "utf8"),
);
const app = JSON.parse(await readFile("miniprogram/app.json", "utf8"));
const module = { exports: {} };
vm.runInNewContext(await readFile("miniprogram/config.js", "utf8"), { module });
const checks = [];
checks.push(["正式AppID", /^wx[a-zA-Z0-9]{16}$/.test(project.appid)]);
checks.push([
  "HTTPS服务地址",
  /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(module.exports.apiBaseUrl || ""),
]);
for (const file of [
  "shared/experience.js",
  "shared/demo.js",
  "assets/place.png",
  ...app.pages.flatMap((p) => [p + ".js", p + ".wxml"]),
]) {
  try {
    await access("miniprogram/" + file);
    checks.push([file, true]);
  } catch {
    checks.push([file, false]);
  }
}
for (const [label, ok] of checks)
  console.log(`${ok ? "已配置" : "待完成"}：${label}`);
console.log(
  "本检查不访问微信后台，不验证账号类目、位置权限、隐私声明、认证备案、服务器持久化或手机效果。以上仍须逐项完成体验版验收。",
);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
