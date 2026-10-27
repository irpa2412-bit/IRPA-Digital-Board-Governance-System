import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/cloudflare-production-gateway.yml", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("production deploy synchronizes Firebase service account secret without logging it", () => {
  assert.match(workflow, /Sync Firebase service account secret to production Worker/);
  assert.match(workflow, /secrets\.FIREBASE_SERVICE_ACCOUNT_JSON != ''/);
  assert.match(workflow, /printf '%s' "\$FIREBASE_SERVICE_ACCOUNT_JSON" \| npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --config wrangler\.toml --name irpa-google-drive-gateway/);
  assert.match(workflow, /Warn when Firebase service account secret is not configured/);
  assert.match(workflow, /::warning::GitHub Actions secret FIREBASE_SERVICE_ACCOUNT_JSON is missing/);
  assert.doesNotMatch(workflow, /echo\s+["']?\$FIREBASE_SERVICE_ACCOUNT_JSON/);
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
  assert.match(source, /crypto\.subtle\.importKey\("pkcs8", pemPrivateKeyBytes\(account\.private_key\)/);
});
