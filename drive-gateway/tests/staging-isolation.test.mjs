import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDriveRootFolderName } from "../src/esignContext.mjs";

test("staging Drive storage requires a dedicated root folder", () => {
  assert.equal(
    getDriveRootFolderName({ IRPA_ENVIRONMENT: "staging", DRIVE_ROOT_FOLDER_NAME: "IRPA Governance System - STAGING" }),
    "IRPA Governance System - STAGING"
  );
  assert.throws(
    () => getDriveRootFolderName({ IRPA_ENVIRONMENT: "staging", DRIVE_ROOT_FOLDER_NAME: "IRPA Governance System" }),
    /dedicated staging root folder/
  );
  assert.equal(getDriveRootFolderName({ IRPA_ENVIRONMENT: "production" }), "IRPA Governance System");
});

test("Wrangler staging project and application URLs are isolated from production", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const production = toml.split("[vars]")[1]?.split("[[kv_namespaces]]")[0] || "";
  const staging = toml.split("[env.staging.vars]")[1]?.split("[[env.staging.kv_namespaces]]")[0] || "";

  assert.match(production, /FIREBASE_PROJECT_ID = "irpa-digital-board-governance"/);
  assert.match(production, /IRPA_APP_URL = "https:\/\/irpa-digital-board-governance\.web\.app"/);
  assert.match(staging, /IRPA_ENVIRONMENT = "staging"/);
  assert.match(staging, /FIREBASE_PROJECT_ID = "irpa-dbg-staging-a73ec"/);
  assert.doesNotMatch(staging, /FIREBASE_PROJECT_ID = "irpa-digital-board-governance"/);
  assert.match(staging, /IRPA_APP_URL = "https:\/\/irpa-dbg-staging-a73ec\.web\.app"/);
  assert.match(staging, /DRIVE_ROOT_FOLDER_NAME = "IRPA Governance System - STAGING"/);
  assert.match(staging, /META_REDIRECT_URI = "https:\/\/irpa-google-drive-gateway-staging\.irpa-governance\.workers\.dev\/api\/communications\/meta\/callback"/);
  assert.match(staging, /IRPA_PRODUCTION_CUTOVER = "false"/);
});

test("staging workflow enforces the approved Firebase project, app origin, scoped credentials, and dedicated KV namespace", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/staging-gateway-e2e.yml", import.meta.url), "utf8");
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const stagingKv = toml.split("[[env.staging.kv_namespaces]]")[1] || "";
  assert.ok(stagingKv.includes('id = "5ea76010553049a2b98c8493c37fbbc4"'));
  assert.ok(workflow.includes('test "$PROJECT" = "irpa-dbg-staging-a73ec"'));
  assert.ok(workflow.includes('test "$APP_URL" = "https://irpa-dbg-staging-a73ec.web.app"'));
  assert.ok(workflow.includes('test "$id" = "5ea76010553049a2b98c8493c37fbbc4"'));
  assert.ok(workflow.includes("secrets.STAGING_CLOUDFLARE_API_TOKEN"));
  assert.ok(workflow.includes("secrets.STAGING_CLOUDFLARE_ACCOUNT_ID"));
  assert.ok(!workflow.includes("secrets.CLOUDFLARE_API_TOKEN"));
  assert.ok(!workflow.includes("secrets.CLOUDFLARE_ACCOUNT_ID"));
});
