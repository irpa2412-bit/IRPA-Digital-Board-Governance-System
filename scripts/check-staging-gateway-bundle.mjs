import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const stagingProject = "irpa-dbg-staging-a73ec";
const stagingGateway = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const productionHostname = "irpa-google-drive-gateway.irpa-governance.workers.dev";

if (process.env.VITE_IRPA_ENVIRONMENT !== "staging") {
  throw new Error("Staging bundle check requires VITE_IRPA_ENVIRONMENT=staging.");
}
if (process.env.VITE_FIREBASE_PROJECT_ID !== stagingProject) {
  throw new Error("Staging bundle check refused a non-staging Firebase project.");
}
if (process.env.VITE_GOOGLE_DRIVE_GATEWAY_URL !== stagingGateway) {
  throw new Error("Staging bundle check requires the isolated staging gateway URL.");
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }));
  return nested.flat();
}

const outputFiles = await filesUnder("dist");
if (!outputFiles.length) throw new Error("Staging build output is empty.");
const contents = await Promise.all(outputFiles.map(file => readFile(file, "utf8")));
const bundle = contents.join("\n");
if (bundle.includes(productionHostname)) {
  throw new Error("Staging bundle contains the production Google Drive gateway hostname.");
}
if (!bundle.includes(stagingGateway) || !bundle.includes(stagingProject)) {
  throw new Error("Staging bundle is missing the staging gateway hostname or Firebase project ID.");
}
console.log("STAGING_GATEWAY_BUNDLE_ISOLATION=PASS");
