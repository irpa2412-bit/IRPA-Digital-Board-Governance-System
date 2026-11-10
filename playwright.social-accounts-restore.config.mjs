import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "social-media-accounts-restore-layout.test.mjs",
  timeout: 30000,
  reporter: "list",
  use: { browserName: "chromium" }
});
