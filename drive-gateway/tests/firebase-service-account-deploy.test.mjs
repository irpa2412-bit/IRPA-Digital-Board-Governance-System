import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/cloudflare-production-gateway.yml", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("production deploy safely syncs the Firebase service account secret to the exact Worker", () => {
  assert.match(workflow, /Sync Firebase service account secret to production Worker/);
  assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT_JSON: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT_JSON \}\}/);
  assert.match(workflow, /if \[\[ -n "\$\{FIREBASE_SERVICE_ACCOUNT_JSON:-\}" \]\]/);
  assert.match(workflow, /printf '%s' "\$FIREBASE_SERVICE_ACCOUNT_JSON" \| npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --config wrangler\.toml --name irpa-google-drive-gateway > \/tmp\/irpa-secret-sync\.log 2>&1/);
  assert.match(workflow, /Firebase secret sync failed; continuing with Worker deployment/);
  assert.match(workflow, /::warning::GitHub Actions secret FIREBASE_SERVICE_ACCOUNT_JSON is missing/);
  assert.doesNotMatch(workflow, /if: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(workflow, /echo\s+["']?\$FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(workflow, /deadline=\$\(\(SECONDS \+ 180\)\)/);
  assert.match(workflow, /sleep 5/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /Report failure details for phone-friendly logs/);
  assert.match(workflow, /tail -30/);
});

test("diagnostics classify Firebase service account failures without exposing values", () => {
  for (const status of [
    "binding absent",
    "not valid JSON",
    "JSON missing client_email, private_key or project_id",
    "project_id differs from FIREBASE_PROJECT_ID",
    "private key import failed"
  ]) assert.ok(source.includes(status), status);
  assert.match(source, /serviceAccountDiagnostic/);
  assert.match(source, /workerName:String\(env\.IRPA_WORKER_NAME/);
  assert.match(source, /workerEnvironment:String\(env\.IRPA_WORKER_ENVIRONMENT/);
  assert.match(source, /bindingNames:Object\.keys\(env \|\| \{\}\)\.sort\(\)/);
  assert.match(source, /crypto\.subtle\.importKey\("pkcs8", pemPrivateKeyBytes\(account\.private_key\)/);
});
