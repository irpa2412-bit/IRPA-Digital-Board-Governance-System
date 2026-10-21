import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  resolve: {
    alias: {
      "firebase/storage": "/src/firebase/signatureStorage.js"
    }
  },
  server: { port: 5173 }
});
