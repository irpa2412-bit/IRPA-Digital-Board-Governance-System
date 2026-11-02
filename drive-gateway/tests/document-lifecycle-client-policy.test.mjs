import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const client=fs.readFileSync(path.join(root,"src","firebase","documentLifecycle.js"),"utf8");
const gatewayResolver=fs.readFileSync(path.join(root,"src","firebase","gatewayUrl.js"),"utf8");
const viteConfig=fs.readFileSync(path.join(root,"vite.config.js"),"utf8");

test("Trial keeps its staging route in production builds while staging builds use one isolated gateway",()=>{
  assert.match(client,/import \{ getGoogleDriveGatewayUrl, getTrialGoogleDriveGatewayUrl \} from "\.\/gatewayUrl";/);
  assert.match(client,/if\(environment==="TRIAL"\)return getTrialGoogleDriveGatewayUrl\(\)/);
  assert.match(client,/if\(environment==="ACTUAL"\)return getGoogleDriveGatewayUrl\(\)/);
  assert.match(gatewayResolver,/import\.meta\.env\.VITE_GOOGLE_DRIVE_GATEWAY_URL/);
  assert.match(gatewayResolver,/if\s*\(\(import\.meta\.env\.VITE_IRPA_STAGING_BUILD === "true"\)\s*&& !configuredGatewayUrl\)/);
  assert.match(gatewayResolver,/export function getTrialGoogleDriveGatewayUrl\(\)/);
  assert.match(gatewayResolver,/return configuredGatewayUrl \|\| import\.meta\.env\.VITE_IRPA_DEFAULT_GATEWAY_URL/);
  assert.match(viteConfig,/"import\.meta\.env\.VITE_IRPA_STAGING_BUILD": JSON\.stringify\(String\(stagingBuild\)\)/);
  assert.match(viteConfig,/"import\.meta\.env\.VITE_IRPA_DEFAULT_GATEWAY_URL": JSON\.stringify\(stagingBuild \? STAGING_GATEWAY_URL : PRODUCTION_GATEWAY_URL\)/);
  assert.doesNotMatch(client,/irpa-google-drive-gateway\.irpa-governance\.workers\.dev/);
  assert.match(client,/Choose Trial\/Test or Actual Institutional Records in the Data Environment Gate before using Documents/);
  assert.doesNotMatch(client,/if\(!staging\)throw new Error/);
});
