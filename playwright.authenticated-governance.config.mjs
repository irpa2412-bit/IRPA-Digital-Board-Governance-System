import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "authenticated-governance-regression.spec.mjs",
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/",
    env: { VITE_USE_FIREBASE_EMULATORS: "true" },
    reuseExistingServer: false,
    timeout: 45000
  }
});
