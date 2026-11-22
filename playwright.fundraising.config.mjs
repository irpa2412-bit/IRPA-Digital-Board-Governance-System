import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "fundraising-registry-responsive.spec.mjs",
  timeout: 30000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/tests/browser/fundraising-registry-harness.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
