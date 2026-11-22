import type { CapacitorConfig } from "@capacitor/cli";

// The Android package ships the built dist locally for offline startup.
// Do not set server.url: that would force remote-only startup and break offline use.
// Canonical production web origin: https://irpa-digital-board-governance-frontend.irpa-governance.workers.dev/
const config:CapacitorConfig={appId:"tz.or.irpa.governance",appName:"IRPA Digital Governance",webDir:"dist",android:{allowMixedContent:false}};
export default config;