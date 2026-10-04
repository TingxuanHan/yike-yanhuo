import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import type { Job } from "../src/shared/types.js";

test("HTTP flow: configuration, validation, asynchronous analysis, cancellation and isolation", async (t) => {
  const server = createApp({ PORT: "8787" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (url: string, body: unknown, origin?: string) =>
    fetch(base + url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    });
  const config = (await (await fetch(base + "/api/config")).json()) as Record<
    string,
    unknown
  >;
  assert.equal(config.baiduConfigured, false);
  assert.ok(!("serverAk" in config));
  assert.equal(
    (
      await post("/api/analyses", {
        mode: "baidu",
        geo: { lng: 121.5, lat: 31.2 },
      })
    ).status,
    503,
  );
  assert.equal(
    (await post("/api/analyses", { mode: "demo", point: [5000, 0] })).status,
    400,
  );
  assert.equal(
    (await post("/api/analyses", { mode: "demo" }, "https://unrelated.invalid"))
      .status,
    403,
  );
  const start = await post("/api/analyses", { mode: "demo" });
  assert.equal(start.status, 202);
  const { id } = (await start.json()) as { id: string };
  let job: Job;
  do {
    await new Promise((r) => setTimeout(r, 10));
    job = (await (await fetch(base + `/api/analyses/${id}`)).json()) as Job;
  } while (job.status === "running");
  assert.equal(job.status, "done");
  assert.equal(job.result?.mode, "demo");
  assert.equal(job.result?.contours.length, 3);
  assert.equal((await fetch(base + "/api/analyses/unknown")).status, 404);
  const cancelled = (await (
    await fetch(base + `/api/analyses/${id}`, { method: "DELETE" })
  ).json()) as Job;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.result, undefined);
  assert.equal((await fetch(base + "/.env")).status, 404);
});
