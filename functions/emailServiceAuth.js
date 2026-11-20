"use strict";

// Server-to-Worker identity for trusted email dispatch. The resulting ID token
// is project-signed by Firebase Authentication; no shared Worker secret is used.

const EMAIL_SERVICE_UID = "irpa-email-dispatcher";
const FIREBASE_WEB_API_KEYS = Object.freeze({
  "irpa-digital-board-governance": "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  "irpa-dbg-staging-a73ec": "AIzaSyA6UmHtP-mRr99rBw57_-qrD4_mFSBnZ38"
});

async function createEmailDeliveryIdToken({
  env = process.env,
  fetchFn = fetch,
  auth,
  projectId
} = {}) {
  let resolvedProject = projectId;
  if (!resolvedProject) resolvedProject = require("firebase-admin/app").getApp().options.projectId || env.GCLOUD_PROJECT || env.GCP_PROJECT;
  const project = String(resolvedProject || "").trim();
  const authClient = auth || require("firebase-admin/auth").getAuth();
  const apiKey = String(env.FIREBASE_WEB_API_KEY || FIREBASE_WEB_API_KEYS[project] || "").trim();
  if (!project || !apiKey) throw new Error("Firebase email-service authentication is not configured for this project.");

  const customToken = await authClient.createCustomToken(EMAIL_SERVICE_UID, {
    irpaEmailDeliveryService: true
  });
  const response = await fetchFn(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.localId !== EMAIL_SERVICE_UID || typeof payload.idToken !== "string" || !payload.idToken) {
    throw new Error("Firebase could not issue the email-service identity token.");
  }
  return payload.idToken;
}

module.exports = { EMAIL_SERVICE_UID, createEmailDeliveryIdToken };
