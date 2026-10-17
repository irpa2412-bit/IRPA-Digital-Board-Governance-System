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
  assert.match(staging, /IRPA_APP_URL = "https:\/\/irpa-dgb-meeting-room-staging\.irpa-governance\.workers\.dev"/);
  assert.match(staging, /DRIVE_ROOT_FOLDER_NAME = "IRPA Governance System - STAGING"/);
  assert.match(staging, /META_REDIRECT_URI = "https:\/\/irpa-google-drive-gateway-staging\.irpa-governance\.workers\.dev\/api\/communications\/meta\/callback"/);
  assert.match(staging, /IRPA_PRODUCTION_CUTOVER = "false"/);
});

test("staging workflow validates the approved frontend origin and fails closed on invalid optional Meta configuration", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/staging-gateway-e2e.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes('appUrl.hostname!=="irpa-dgb-meeting-room-staging.irpa-governance.workers.dev"'));
  assert.ok(workflow.includes('const valid = count === 3 && /^\\d+$/.test(values[0]) && Boolean(values[1].trim()) && decoded.length === 32;'));
  assert.ok(workflow.includes('const metaReady=/^\\d+$/.test(metaAppIdRaw)&&Boolean(String(process.env.META_APP_SECRET||"").trim())&&metaKey.length===32;'));
  assert.ok(workflow.includes('const metaAppId=metaReady?metaAppIdRaw:"";'));
  assert.ok(workflow.includes('Worker App ID remains blank and Meta endpoints stay disabled.'));
  assert.ok(!workflow.includes('if (!/^\\\\d+$/.test(values[0]))'));
});
