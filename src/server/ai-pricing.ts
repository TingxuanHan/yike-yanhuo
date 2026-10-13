import type { ModelConfig } from "./ai-transport.js";
import { ServiceError } from "./baidu.js";

export const SILICONFLOW_PRICING = "https://www.siliconflow.cn/pricing";

export function hasZeroTokenPrice(html: string, model: string): boolean {
  const flight = [
    ...html.matchAll(
      /<script[^>]*>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g,
    ),
  ]
    .flatMap((m) => {
      try {
        const entry = JSON.parse(m[1]);
        return typeof entry[1] === "string" ? [entry[1]] : [];
      } catch {
        return [];
      }
    })
    .join("");
  const rows: Record<string, unknown>[] = [];
  for (const line of flight.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    try {
      const stack: unknown[] = [JSON.parse(line.slice(colon + 1))];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (row.playgroundName === model && "componentCode" in row)
          rows.push(row);
        stack.push(...Object.values(row));
      }
    } catch {
      /* Non-JSON flight records do not contain pricing rows. */
    }
  }
  return (
    ["input-tokens", "output-tokens"].every((code) =>
      rows.some((r) => r.componentCode === code),
    ) &&
    rows.every(
      (r) =>
        typeof r.realTimePriceCnyUnit === "string" &&
        /^0+(?:\.0+)?$/.test(r.realTimePriceCnyUnit) &&
        r.unitZhCnName === "K tokens",
    )
  );
}

export async function requireZeroPrice(
  config: ModelConfig,
  signal: AbortSignal,
) {
  const unavailable = () =>
    new ServiceError(
      "暂时无法确认模型仍免费，已停止调用。请稍后再试或手工填写。",
      503,
    );
  if (config.baseUrl !== "https://api.siliconflow.cn/v1") throw unavailable();
  try {
    const response = await fetch(SILICONFLOW_PRICING, {
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) throw unavailable();
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    if (
      !hasZeroTokenPrice(Buffer.concat(chunks).toString("utf8"), config.model)
    )
      throw new ServiceError(
        "官网未确认此模型输入和输出均免费，已停止调用。请手工填写。",
        503,
      );
    signal.throwIfAborted();
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw unavailable();
  }
}
