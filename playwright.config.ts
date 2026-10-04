import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8788",
    browserName: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
    viewport: { width: 1360, height: 1000 },
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node dist/server/server/index.js",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: false,
    env: {
      HOST: "127.0.0.1",
      PORT: "8788",
      BAIDU_SERVER_AK: "",
      BAIDU_BROWSER_AK: "",
    },
    timeout: 15000,
  },
});
