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
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    // Exercise the same built application that is shipped to users. Vite's
    // development dependency optimiser can invalidate lazy-loaded chunks
    // during the suite's repeated full-page portal navigations (504
    // "Outdated Optimize Dep"), leaving a blank shell unrelated to app logic.
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/",
    env: { VITE_USE_FIREBASE_EMULATORS: "true" },
    reuseExistingServer: false,
    timeout: 180000
  }
});
