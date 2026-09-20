import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tz.or.irpa.governance",
  appName: "IRPA Digital Governance",
  webDir: "dist",
  server: {
    url: "https://irpa-digital-board-governance.web.app",
    cleartext: false
  }
};

export default config;
