import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolveGatewayUrl } from "./src/firebase/gatewayEnvironment.js";

export default defineConfig(({ mode }) => {
  // Enforce the Firebase/Gateway pairing at build time as well as runtime.
  // Missing project ID retains the app's existing production default; an
  // explicit staging Gateway without the matching staging Firebase project fails.
  resolveGatewayUrl(loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "firebase/storage": "/src/firebase/signatureStorage.js"
      }
    },
    server: { port: 5173 }
  };
});
