import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "firebase/storage": "/src/firebase/signatureStorage.js"
    }
  },
  server: { port: 5173 }
});
