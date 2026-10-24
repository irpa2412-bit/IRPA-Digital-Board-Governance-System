import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const STAGING_PROJECT_ID = "irpa-dbg-staging-a73ec";
const STAGING_GATEWAY_URL = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const PRODUCTION_GATEWAY_URL = "https://irpa-google-drive-gateway.irpa-governance.workers.dev";

export default defineConfig(({ mode }) => {
  const stagingBuild = mode === "staging" ||
    process.env.VITE_IRPA_ENVIRONMENT === "staging" ||
    process.env.VITE_FIREBASE_PROJECT_ID === STAGING_PROJECT_ID;
  const configuredGatewayUrl = String(process.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "").trim().replace(/\\/+$/, "");

  if (stagingBuild && !configuredGatewayUrl) {
    throw new Error("Refusing staging build: VITE_GOOGLE_DRIVE_GATEWAY_URL is required.");
  }
  if (stagingBuild && configuredGatewayUrl !== STAGING_GATEWAY_URL) {
    throw new Error("Refusing staging build: VITE_GOOGLE_DRIVE_GATEWAY_URL must point to the isolated staging gateway.");
  }

  return {
    define: {
      __IRPA_STAGING_BUILD__: JSON.stringify(stagingBuild),
      __IRPA_DEFAULT_GATEWAY_URL__: JSON.stringify(stagingBuild ? STAGING_GATEWAY_URL : PRODUCTION_GATEWAY_URL)
    },
    plugins: [react()],
    resolve: {
      alias: {
        "firebase/storage": "/src/firebase/signatureStorage.js"
      }
    },
    server: { port: 5173 }
  };
});
