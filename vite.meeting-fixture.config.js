import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const mocks = resolve(process.cwd(), "tests/fixtures/mocks.js");

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "../firebase/data", replacement: mocks },
      { find: "../firebase/config", replacement: mocks },
      { find: "../firebase/meetingRecords", replacement: mocks },
      { find: "../firebase/signatureStorage", replacement: mocks }
    ]
  },
  optimizeDeps: {
    // Restrict discovery to the isolated fixture entry. The default root scan
    // also visits unrelated portal HTML files whose imports are not fixture-mocked.
    entries: ["tests/fixtures/meeting-portal-fixture.html"],
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime"
    ]
  },
  server: { host: "127.0.0.1", port: 4179, strictPort: true }
});
