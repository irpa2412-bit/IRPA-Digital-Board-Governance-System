import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const client=fs.readFileSync(path.join(root,"src","firebase","documentLifecycle.js"),"utf8");

test("trial document operations require an explicit isolated staging gateway",()=>{
  assert.match(client,/if\(environment==="TRIAL"\)/);
  assert.match(client,/VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL/);
  assert.match(client,/if\(!staging\)throw new Error\("Trial document operations are disabled until an isolated staging gateway is configured\."\)/);
  assert.match(client,/if\(environment==="ACTUAL"\)return PRODUCTION_GATEWAY_URL/);
  assert.match(client,/Choose Trial\/Test or Actual Institutional Records/);
});
