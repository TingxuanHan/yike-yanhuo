import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { QuotaLedger } from "../dist/server/server/quota.js";

async function main() {
  if (!process.argv.includes("--run")) {
    console.log(
      "本诊断最多发送4次请求，输出状态码，不显示密钥。请先停止本地服务，再执行 node scripts/check-key-roles.mjs --run。",
    );
    return;
  }
  const env = parseEnv(await readFile(".env", "utf8"));
  const entries = [
    { configuredAs: "browser", ak: env.BAIDU_BROWSER_AK?.trim() },
    { configuredAs: "server", ak: env.BAIDU_SERVER_AK?.trim() },
  ];
  if (entries.some((entry) => !entry.ak))
    throw new Error("missing configuration");
  const secrets = entries.map((entry) => entry.ak);
  const ledger = new QuotaLedger(
    { route: 500, search: 12, other: 20, map: 100 },
    resolve(".cache/baidu-quota.json"),
  );
  const services = process.argv.includes("--map-only")
    ? ["mapVerification"]
    : ["geocoding", "mapVerification"];
  const evidence = {
    timestamp: new Date().toISOString(),
    maxRequests: services.length * 2,
    checks: [],
  };
  for (const entry of entries) {
    for (const service of services) {
      const url = new URL(
        service === "geocoding" ? "/geocoding/v3/" : "/",
        "https://api.map.baidu.com",
      );
      url.search = new URLSearchParams(
        service === "geocoding"
          ? {
              address: "上海市杨浦区抚顺路社区睦邻中心",
              output: "json",
              ret_coordtype: "bd09ll",
              ak: entry.ak,
            }
          : {
              qt: "verify",
              v: "4.0",
              type: "webgl",
              ak: entry.ak,
              callback: "__yikeVerify",
            },
      ).toString();
      const check = { configuredAs: entry.configuredAs, service };
      await ledger.take(service === "geocoding" ? "other" : "map", 1);
      try {
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          headers: {
            Referer: "http://127.0.0.1:8787/",
            BMAP_PROXY_URL: "http://127.0.0.1:8787/api/map-sdk",
          },
        });
        check.http = response.status;
        const raw = await response.text();
        check.credentialEcho = secrets.some(
          (secret) =>
            raw.includes(secret) || raw.includes(encodeURIComponent(secret)),
        );
        const payload = raw.trim().startsWith("{")
          ? raw
          : raw.match(/__yikeVerify\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/)?.[1];
        const reply = JSON.parse(payload ?? "");
        const code =
          reply.error ??
          reply.result?.error ??
          reply.statuscode ??
          reply.status;
        check.code = Number.isFinite(Number(code)) ? Number(code) : "unknown";
        if (check.code === "unknown") {
          check.responseKeys = Object.keys(reply);
          check.resultKeys =
            reply.result && typeof reply.result === "object"
              ? Object.keys(reply.result)
              : [];
        }
        if (service === "geocoding" && check.code === 0)
          check.validLocation =
            typeof reply.result?.location?.lng === "number" &&
            typeof reply.result?.location?.lat === "number";
      } catch {
        check.error = "network_or_response_format";
      }
      evidence.checks.push(check);
      console.log(JSON.stringify(check));
      await delay(2000);
    }
  }
  await mkdir(".cache", { recursive: true });
  await writeFile(
    process.argv.includes("--map-only")
      ? ".cache/ak-map-diagnostics.json"
      : ".cache/ak-diagnostics.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
main().catch(() => {
  console.error("诊断未完成，请检查本地配置或额度记录。");
  process.exitCode = 1;
});
