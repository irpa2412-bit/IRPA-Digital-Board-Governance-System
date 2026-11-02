import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const productionGateway = "https://irpa-google-drive-gateway.irpa-governance.workers.dev";
const stagingGateway = "https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev";
const source = await readFile("src/firebase/gatewayUrl.js", "utf8");
const vite = await readFile("vite.config.js", "utf8");

assert.match(source, /import\.meta\.env\.VITE_IRPA_STAGING_BUILD === "true"/, "staging build guard must remain in gatewayUrl.js");
assert.match(source, /configuredGatewayUrl \|\| import\.meta\.env\.VITE_IRPA_DEFAULT_GATEWAY_URL/, "gateway fallback must use the Vite-defined default");
assert.match(vite, /"import\.meta\.env\.VITE_IRPA_STAGING_BUILD": JSON\.stringify\(String\(stagingBuild\)\)/);
assert.match(vite, /"import\.meta\.env\.VITE_IRPA_DEFAULT_GATEWAY_URL": JSON\.stringify\(stagingBuild \? STAGING_GATEWAY_URL : PRODUCTION_GATEWAY_URL\)/);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }));
  return nested.flat();
}
const files = await filesUnder("dist");
assert.ok(files.length > 0, "production build output must not be empty");
const bundle = (await Promise.all(files.map(file => readFile(file, "utf8")))).join("\n");
assert.ok(bundle.includes(productionGateway), "production bundle must contain the production Cloudflare Worker gateway URL");
assert.ok(!bundle.includes(stagingGateway), "production bundle must not contain the staging Worker gateway URL");
console.log("PRODUCTION_GATEWAY_BUNDLE=PASS");
console.log("VITE_STAGING_GUARD_SOURCE=PASS");
