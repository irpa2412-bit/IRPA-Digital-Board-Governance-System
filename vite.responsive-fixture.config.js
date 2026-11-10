import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(root, "tests/fixtures"),
  plugins: [react()],
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true
  }
});
