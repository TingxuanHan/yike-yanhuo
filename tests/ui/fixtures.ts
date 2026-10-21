import { test as base, expect } from "@playwright/test";
// Existing full-workspace flows exercise that mode explicitly; simple mode has its own journey tests.
export const test = base.extend<{ fullMode: void }>({
  fullMode: [
    async ({ page }, use) => {
      await page.addInitScript(() =>
        localStorage.setItem("yike-simple-mode", "false"),
      );
      await use();
    },
    { auto: true },
  ],
});
export { expect };
