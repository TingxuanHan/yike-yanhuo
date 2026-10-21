import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { QuotaSnapshot } from "../shared/types.js";

export type QuotaKind = "route" | "search" | "other" | "map";
export class QuotaError extends Error {}
export class QuotaLedger {
  private queue: Promise<unknown> = Promise.resolve();
  private state = { day: "", route: 0, search: 0, other: 0, map: 0 };
  private loaded = false;
  constructor(
    private limits: Record<QuotaKind, number>,
    private path?: string,
    private now: () => number = Date.now,
  ) {}
  async snapshot(): Promise<QuotaSnapshot> {
    await this.take("route", 0);
    const { day, ...used } = this.state;
    return { day, used: { ...used }, limits: { ...this.limits } };
  }
  async take(kind: QuotaKind, count: number): Promise<void> {
    const operation = this.queue.then(async () => {
      if (!Number.isInteger(count) || count < 0)
        throw new QuotaError("调用计数无效。");
      if (!this.loaded) {
        if (this.path) {
          try {
            const value = JSON.parse(await readFile(this.path, "utf8"));
            if (
              typeof value.day !== "string" ||
              ["route", "search", "other", "map"].some(
                (k) => !Number.isInteger(value[k]) || value[k] < 0,
              )
            )
              throw new Error("invalid");
            this.state = {
              day: value.day,
              route: value.route,
              search: value.search,
              other: value.other,
              map: value.map,
            };
          } catch (error) {
            if (!(
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ENOENT"
            ))
              throw new QuotaError(
                "本地调用计数无法读取，请检查配额记录后重试。",
              );
          }
        }
        this.loaded = true;
      }
      const day = new Date(this.now() + 8 * 3600_000)
        .toISOString()
        .slice(0, 10);
      if (day !== this.state.day)
        this.state = { day, route: 0, search: 0, other: 0, map: 0 };
      if (count > 0 && this.state[kind] + count > this.limits[kind])
        throw new QuotaError(
          "已达到本地当日调用预算，停止继续请求。请核对控制台额度后再调整。",
        );
      this.state[kind] += count;
      if (this.path && count > 0) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = this.path + ".tmp";
        await writeFile(temporary, JSON.stringify(this.state) + "\n");
        await rename(temporary, this.path);
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
