import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseResultFile } from "../src/shared/result-file.js";
import { parseContourAudit } from "../src/core/contour-audit.js";
import type { Job } from "../src/shared/types.js";

if (process.env.CONFIRM_BAIDU_AUDIT_LIVE !== "1")
  throw new Error(
    "真实复核会消耗路线额度；仅在确认后设置CONFIRM_BAIDU_AUDIT_LIVE=1。",
  );
const base = "http://127.0.0.1:8787";
const path = process.argv[2];
if (!path) throw new Error("请指定本机已有的原始百度报告，不读取或显示AK。");
async function request(path: string, method = "GET", data?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
const raw = await readFile(path, "utf8"),
  result = parseResultFile(raw);
if (result.mode !== "baidu" || result.scenario)
  throw new Error("需要原始百度测时报告。");
const quota = await request("/api/quota"),
  config = await request("/api/config");
if (!config.baiduConfigured || quota.limits.route - quota.used.route < 12)
  throw new Error("本地服务未配置或不足以预留12条路线，本轮未开始。");
const body = { result, minutes: 15, count: 6 },
  preview = await request("/api/contour-audit/preview", "POST", body);
await mkdir(".cache/contour-audit", { recursive: true });
const planned = {
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  fingerprint: preview.fingerprint,
  plan: preview.plan,
  createdAt: new Date().toISOString(),
};
await writeFile(
  ".cache/contour-audit/live-plan.json",
  JSON.stringify(planned, null, 2) + "\n",
  { flag: "wx" },
);
let id = "";
try {
  const started = await request("/api/contour-audit", "POST", {
    ...body,
    fingerprint: preview.fingerprint,
    confirmed: true,
    requestId: `audit-live-${Date.now()}`,
  });
  id = started.id;
  const deadline = Date.now() + 180_000;
  for (;;) {
    const job = (await request(`/api/analyses/${id}`)) as Job;
    if (job.status === "done" && job.contourAudit) {
      const audit = parseContourAudit(JSON.stringify(job.contourAudit));
      await writeFile(
        ".cache/contour-audit/live-evidence.json",
        JSON.stringify(audit, null, 2) + "\n",
        { flag: "wx" },
      );
      const after = await request("/api/quota");
      const lines = (await readFile(".cache/baidu-requests.jsonl", "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s));
      const starts = lines
        .filter(
          (v) =>
            v.service === "route" &&
            v.startedAt >= audit.plannedAt &&
            v.startedAt <= audit.completedAt,
        )
        .map((v) => Date.parse(v.startedAt));
      const gaps = starts.slice(1).map((time, i) => time - starts[i]);
      const summary = {
        evidence: "api-holdout",
        sourceSha256: planned.sourceSha256,
        baseGeneratedAt: result.baseGeneratedAt ?? result.generatedAt,
        plannedAt: audit.plannedAt,
        completedAt: audit.completedAt,
        minutes: audit.plan.minutes,
        count: audit.plan.count,
        metrics: audit.metrics,
        paired: audit.paired,
        usage: audit.usage,
        quotaRouteDelta: after.used.route - quota.used.route,
        rate: {
          minimumStartIntervalMs: gaps.length ? Math.min(...gaps) : null,
          maximumStartsInOneSecond: Math.max(
            0,
            ...starts.map(
              (t) => starts.filter((s) => s >= t && s < t + 1000).length,
            ),
          ),
        },
        fieldValidated: false,
      };
      await writeFile(
        ".cache/contour-audit/live-summary.json",
        JSON.stringify(summary, null, 2) + "\n",
        { flag: "wx" },
      );
      console.log(JSON.stringify(summary));
      break;
    }
    if (job.status !== "running") throw new Error(job.error || "本轮未完成。");
    if (Date.now() > deadline)
      throw new Error("本轮等待超时，停止后请检查已有记录。");
    await new Promise((r) => setTimeout(r, 500));
  }
} catch (e) {
  if (id) await request(`/api/analyses/${id}`, "DELETE").catch(() => {});
  throw e;
}
