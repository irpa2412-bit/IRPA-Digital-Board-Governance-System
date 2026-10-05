import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { redeemInvitationToken } from "../src/invitationRedemption.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function makeEnv(invitation) {
  const kv = new Map();
  return {
    FIREBASE_PROJECT_ID: "irpa-digital-board-governance",
    IRPA_APP_URL: "https://irpa-digital-board-governance.web.app",
    FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "irpa-digital-board-governance",
      client_email: "irpa-test@irpa-digital-board-governance.iam.gserviceaccount.com",
      private_key: privateKeyPem
    }),
    DRIVE_KV: {
      async get(key) { return kv.get(key) ?? null; },
      async put(key, value) { kv.set(key, value); }
    },
    invitation
  };
}

function invitationDocument(tokenHash) {
  return {
    name: "projects/irpa-digital-board-governance/databases/(default)/documents/invitations/invite-123",
    updateTime: "2026-10-05T06:00:00.000000Z",
    fields: {
      email: { stringValue: "newmember@example.com" },
      name: { stringValue: "New Member" },
      status: { stringValue: "Sent" },
      invitationTokenVersion: { stringValue: "2" },
      invitationTokenHash: { stringValue: tokenHash },
      invitationExpiresAt: { timestampValue: "2026-10-06T06:00:00.000Z" },
      invitationRedeemedAt: { nullValue: null },
      invitationRedeemedUid: { nullValue: null }
    }
  };
}

test("Cloudflare invitation redemption preserves the existing Firebase UID", async () => {
  const secret = "test-secret";
  const tokenHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer), b => b.toString(16).padStart(2, "0")).join("");
  const env = makeEnv();
  const invitation = invitationDocument(tokenHash);
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 });
    }
    if (String(url).includes("/documents/invitations/")) {
      return new Response(JSON.stringify(invitation), { status: 200 });
    }
    if (String(url).endsWith("/projects/irpa-digital-board-governance/accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{
          localId: "EXISTING-UID-123",
          email: "newmember@example.com",
          providerUserInfo: [{ providerId: "password", federatedId: "newmember@example.com" }]
        }]
      }), { status: 200 });
    }
    if (String(url).endsWith("/documents:commit")) {
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.writes[0].currentDocument.updateTime, invitation.updateTime);
      assert.equal(body.writes[0].update.fields.invitationRedeemedUid.stringValue, "EXISTING-UID-123");
      assert.equal(body.writes[0].updateTransforms[0].fieldPath, "invitationRedeemedAt");
      return new Response(JSON.stringify({ commitTime: "2026-10-05T06:01:00.000000Z" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const request = new Request("https://irpa-google-drive-gateway.irpa-governance.workers.dev/api/invitations/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.IRPA_APP_URL },
      body: JSON.stringify({ token: `invite-123.${secret}` })
    });
    const response = await redeemInvitationToken(request, env);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.uid, "EXISTING-UID-123");
    assert.equal(data.invitationId, "invite-123");
    assert.equal(typeof data.customToken, "string");

    const payload = JSON.parse(Buffer.from(data.customToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(payload.uid, "EXISTING-UID-123");
    assert.equal(payload.claims.irpaInvitationRedeemed, true);
    assert.equal(calls.filter(url => url.includes("identitytoolkit.googleapis.com")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare invitation redemption rejects malformed tokens before administrative calls", async () => {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("Administrative call should not occur.");
  };

  try {
    const request = new Request("https://irpa-google-drive-gateway.irpa-governance.workers.dev/api/invitations/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.IRPA_APP_URL },
      body: JSON.stringify({ token: "malformed-token" })
    });
    const response = await redeemInvitationToken(request, env);
    const data = await response.json();
    assert.equal(response.status, 400);
    assert.equal(data.ok, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
