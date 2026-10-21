import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// An OS-owned loopback listener expires even after an abrupt process exit.
// It prevents a server and manual verification script sharing a ledger from
// running independent request queues at the same time.
export async function acquireQuotaLease(
  ledgerPath: string,
): Promise<() => Promise<void>> {
  const path = resolve(ledgerPath);
  const digest = createHash("sha256")
    .update(process.platform === "win32" ? path.toLowerCase() : path)
    .digest();
  const port = 38000 + (digest.readUInt16BE(0) % 20000);
  const lease = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    lease.once("error", () =>
      reject(
        new Error(
          "同一项目已有真实地图服务或实测脚本运行（或预算保护端口被占用）。请先关闭已有运行，再重试。",
        ),
      ),
    );
    lease.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  lease.unref();
  return () => new Promise<void>((resolve) => lease.close(() => resolve()));
}
