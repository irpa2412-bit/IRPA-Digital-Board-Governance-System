import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleDriveAuthorizationParams } from "../src/googleDriveOAuth.mjs";

test("Google Drive OAuth explicitly prompts for account selection and consent", () => {
  const params = buildGoogleDriveAuthorizationParams({
    clientId: "new-client-id.apps.googleusercontent.com",
    redirectUri: "https://irpa-google-drive-gateway.irpa-governance.workers.dev/oauth/callback",
    scope: "https://www.googleapis.com/auth/drive.file",
    state: "test-state"
  });

  assert.equal(params.get("client_id"), "new-client-id.apps.googleusercontent.com");
  assert.equal(params.get("redirect_uri"), "https://irpa-google-drive-gateway.irpa-governance.workers.dev/oauth/callback");
  assert.equal(params.get("prompt"), "select_account consent");
  assert.equal(params.get("login_hint"), null);
  assert.equal(params.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(params.get("state"), "test-state");
});
