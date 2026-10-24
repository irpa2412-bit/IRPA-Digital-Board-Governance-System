import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const client=fs.readFileSync(path.join(root,"src","firebase","documentLifecycle.js"),"utf8");
const gatewayResolver=fs.readFileSync(path.join(root,"src","firebase","gatewayUrl.js"),"utf8");

test("document operations use the build-selected gateway in Trial and Actual modes",()=>{
  assert.match(client,/import \{ getGoogleDriveGatewayUrl \} from "\.\/gatewayUrl";/);
  assert.match(client,/if\(environment==="TRIAL"\|\|environment==="ACTUAL"\)return getGoogleDriveGatewayUrl\(\)/);
  assert.match(gatewayResolver,/import\.meta\.env\.VITE_GOOGLE_DRIVE_GATEWAY_URL/);
  assert.match(gatewayResolver,/__IRPA_STAGING_BUILD__ && !configuredGatewayUrl/);
  assert.doesNotMatch(client,/irpa-google-drive-gateway\.irpa-governance\.workers\.dev/);
  assert.match(client,/Choose Trial\/Test or Actual Institutional Records in the Data Environment Gate before using Documents/);
  assert.doesNotMatch(client,/if\(!staging\)throw new Error/);
});
