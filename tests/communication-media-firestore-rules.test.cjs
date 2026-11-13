const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const fs = require("node:fs");

let env;
const projectId = "irpa-dbg-staging-a73ec";
const mediaAsset = uid => ({
  title: "Staging rules acceptance",
  originalFileName: "acceptance.pdf",
  contentType: "application/pdf",
  fileSize: 128,
  fileId: "drive-file-test",
  webViewLink: "https://drive.example.test/file",
  storageProvider: "Google Drive",
  purpose: "Communication Media",
  tags: "RULES TEST",
  mediaKind: "Document / Other",
  status: "Available",
  recordOrigin: "STAGING",
  uploadedByUid: uid,
  uploadedByEmail: "media-test@example.test",
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z"
});

const mediaItem = uid => ({
  title: "Staging media draft",
  type: "Press Release",
  body: "A draft created for the isolated staging rules test.",
  status: "Draft",
  recordOrigin: "STAGING",
  createdByUid: uid,
  createdByEmail: "media-test@example.test",
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z"
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.staging.rules", "utf8") }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("adminProfiles/media-admin").set({
      active: true,
      email: "media-admin@example.test",
      role: "Administrator"
    });
  });
});

test("active administrator profile can create a valid STAGING media asset", async () => {
  const db = env.authenticatedContext("media-admin", {
    email: "media-admin@example.test"
  }).firestore();
  await assertSucceeds(db.doc("communicationMediaAssets/allowed-asset").set(mediaAsset("media-admin")));
});

test("unauthenticated users cannot create a Communication Media asset", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(db.doc("communicationMediaAssets/anonymous-asset").set(mediaAsset("anonymous")));
});

test("authenticated users without an administrator or Communication Media role cannot create an asset", async () => {
  const db = env.authenticatedContext("unassigned-user", {
    email: "unassigned@example.test"
  }).firestore();
  await assertFails(db.doc("communicationMediaAssets/unauthorised-asset").set(mediaAsset("unassigned-user")));
});

test("a staging token cannot create a production-origin media asset", async () => {
  const db = env.authenticatedContext("media-admin", {
    email: "media-admin@example.test"
  }).firestore();
  await assertFails(db.doc("communicationMediaAssets/wrong-origin").set({
    ...mediaAsset("media-admin"),
    recordOrigin: "PRODUCTION"
  }));
});



test("active administrator profile can create a valid STAGING media item", async () => {
  const db = env.authenticatedContext("media-admin", {
    email: "media-admin@example.test"
  }).firestore();
  await assertSucceeds(db.doc("communicationMediaItems/allowed-item").set(mediaItem("media-admin")));
});

test("a staging token cannot create a production-origin media item", async () => {
  const db = env.authenticatedContext("media-admin", {
    email: "media-admin@example.test"
  }).firestore();
  await assertFails(db.doc("communicationMediaItems/wrong-origin").set({
    ...mediaItem("media-admin"),
    recordOrigin: "PRODUCTION"
  }));
});

test("Communication Media assets remain immutable after creation", async () => {
  const db = env.authenticatedContext("media-admin", {
    email: "media-admin@example.test"
  }).firestore();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("communicationMediaAssets/immutable-asset").set(mediaAsset("media-admin"));
  });
  const ref = db.doc("communicationMediaAssets/immutable-asset");
  await assertFails(ref.update({ title: "Attempted update" }));
  await assertFails(ref.delete());
});

test("HTTP 403 diagnostics report only redacted boolean rule predicates", () => {
  const workflow = fs.readFileSync(".github/workflows/staging-gateway-e2e.yml", "utf8");
  assert.match(workflow, /if\(createResponse\.status===403\)/);
  for (const field of [
    "tokenHasAdminClaim",
    "tokenEmailIsPrimaryAdmin",
    "adminProfileExists",
    "adminProfileActive",
    "uploaderUidMatchesAuthenticatedUid",
    "tokenAudienceMatchesRecordOrigin",
    "statusIsAvailable",
    "titlePresent",
    "originalFileNamePresent",
    "fileIdPresent",
    "fileSizeValid",
    "storageProviderIsGoogleDrive",
    "metadataKeysAllowed"
  ]) {
    assert.match(workflow, new RegExp(field + ":"));
  }
  assert.match(workflow, /STAGING_MEDIA_REGISTER_403_\+key\+\"=\"\+String\(value\)/);
});


test("the isolated staging rules use token-aware record origin for both media collections", () => {
  const rules = fs.readFileSync("firestore.staging.rules", "utf8");
  const config = JSON.parse(fs.readFileSync("firebase.staging.json", "utf8"));
  assert.equal(config.firestore.rules, "firestore.staging.rules");
  assert.ok(rules.includes("function communicationMediaRecordOriginMatches(data)"));
  const assets = rules.slice(rules.indexOf("match /communicationMediaAssets/{id}"), rules.indexOf("match /communicationMediaItems/{id}"));
  const items = rules.slice(rules.indexOf("match /communicationMediaItems/{id}"), rules.indexOf("match /communicationOperations"));
  assert.ok(assets.includes("communicationMediaRecordOriginMatches(request.resource.data)"));
  assert.ok(items.includes("communicationMediaRecordOriginMatches(request.resource.data)"));
  assert.ok(!assets.includes('request.resource.data.get("recordOrigin","")=="PRODUCTION"'));
  assert.ok(!items.includes('request.resource.data.get("recordOrigin","")=="PRODUCTION"'));
});

test("403 diagnostics trust the Admin SDK fixture and capture the structured Firestore error safely", () => {
  const workflow = fs.readFileSync(".github/workflows/staging-gateway-e2e.yml", "utf8");
  assert.match(workflow, /STAGING_MEDIA_ADMIN_PROFILE_EXISTS:/);
  assert.match(workflow, /STAGING_MEDIA_ADMIN_PROFILE_ACTIVE:/);
  assert.match(workflow, /STAGING_MEDIA_ADMIN_PROFILE_UID_MATCH:/);
  assert.ok(workflow.includes("const savedProfile=await profileRef.get()"));
  assert.ok(workflow.includes('savedProfile.get("active")!==true'));
  assert.match(workflow, /const createResponseText=await createResponse\.text\(\)/);
  assert.match(workflow, /STAGING_MEDIA_REGISTER_403_FIRESTORE_ERROR_CODE/);
  assert.match(workflow, /STAGING_MEDIA_REGISTER_403_FIRESTORE_ERROR_MESSAGE/);
  assert.doesNotMatch(workflow, /async function ownProfile\(/);
});
