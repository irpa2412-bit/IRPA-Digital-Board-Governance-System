import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const client=fs.readFileSync(path.join(root,"src","firebase","documentLifecycle.js"),"utf8");

test("trial document operations route to the isolated staging gateway without a production fallback",()=>{
  assert.match(client,/const STAGING_GATEWAY_URL=String\(import\.meta\.env\.VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL\|\|"https:\/\/irpa-google-drive-gateway-staging\.irpa-governance\.workers\.dev"\)/);
  assert.match(client,/if\(environment==="TRIAL"\)\{\s*return STAGING_GATEWAY_URL;\s*\}/);
  assert.match(client,/if\(environment==="ACTUAL"\)return PRODUCTION_GATEWAY_URL/);
  assert.match(client,/Choose Trial\/Test or Actual Institutional Records in the Data Environment Gate before using Documents/);
  assert.doesNotMatch(client,/if\(!staging\)throw new Error/);
});
