import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
const mocks = resolve(process.cwd(), "tests/fixtures/mocks.js");
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: "../firebase/data", replacement: mocks },
    { find: "../firebase/config", replacement: mocks },
    { find: "../firebase/meetingRecords", replacement: mocks },
    { find: "../firebase/signatureStorage", replacement: mocks }
  ] },
  server: { host: "127.0.0.1", port: 4179, strictPort: true }
});
