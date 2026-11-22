import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "portal-responsive-browser.test.mjs",
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium"
  },
  webServer: {
    command: "npx vite --config vite.responsive-fixture.config.js --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/portal-layout-fixture.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
