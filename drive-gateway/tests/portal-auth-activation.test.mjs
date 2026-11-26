import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import handler from "../src/index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "portal-auth-test-key", alg: "RS256", use: "sig" };
const serviceAccount = {
  project_id: "irpa-digital-board-governance",
  client_email: "irpa-auth-test@irpa-digital-board-governance.iam.gserviceaccount.com",
  private_key: privateKeyPem
};

function idToken(uid, email) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "portal-auth-test-key", typ: "JWT" });
  const payload = encode({
    iss: "https://securetoken.google.com/irpa-digital-board-governance",
    aud: "irpa-digital-board-governance",
    sub: uid,
    user_id: uid,
    email,
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  const unsigned = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return unsigned + "." + signer.sign(privateKey).toString("base64url");
}

async function requestSessionProfile({ uid, email, records = {} }) {
  const originalFetch = global.fetch;
  const token = idToken(uid, email);
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push(target);
    if (target === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "portal-auth-test-admin-token", expires_in: 3600 }), { status: 200 });
    }
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    const match = target.match(/\/documents\/(adminProfiles|members|employees|signatureProfiles)\/([^/?]+)/);
    if (match) {
      const [, collection, documentId] = match;
      const record = records[collection + "/" + documentId];
      if (record) return new Response(JSON.stringify({ name: "projects/irpa-digital-board-governance/databases/(default)/documents/" + collection + "/" + documentId, fields: record }), { status: 200 });
      return new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
    }
    if (target.includes("/documents:runQuery")) return new Response(JSON.stringify([]), { status: 200 });
    throw new Error("Unexpected external request in portal-auth test: " + target);
  };
  try {
    const response = await handler.fetch(new Request("https://gw.test/api/session/profile", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: "{}"
    }), {
      FIREBASE_PROJECT_ID: "irpa-digital-board-governance",
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount)
    });
    return { response, requests };
  } finally {
    global.fetch = originalFetch;
  }
}

test("active Administrator profile passes portal authentication", async () => {
  const { response } = await requestSessionProfile({
    uid: "portal-admin-uid",
    email: "admin@example.org",
    records: { "adminProfiles/portal-admin-uid": { active: { booleanValue: true }, role: { stringValue: "Administrator" } } }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("active personal signatureProfile authorizes the document owner", async () => {
  const { response } = await requestSessionProfile({
    uid: "portal-owner-uid",
    email: "owner@example.org",
    records: { "signatureProfiles/portal-owner-uid": {
      uid: { stringValue: "portal-owner-uid" },
      email: { stringValue: "owner@example.org" },
      displayName: { stringValue: "Court Document Owner" },
      role: { stringValue: "Document Owner" },
      status: { stringValue: "Active" },
      accountActivated: { booleanValue: true }
    } }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("unregistered non-administrator without an active owner profile is denied", async () => {
  const { response } = await requestSessionProfile({ uid: "portal-unregistered-uid", email: "unregistered@example.org" });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "NOT_ACTIVATED");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
});

test("inactive unsigned personal profile is denied with a traceable auth error", async () => {
  const { response } = await requestSessionProfile({
    uid: "portal-unsigned-uid",
    email: "unsigned@example.org",
    records: { "signatureProfiles/portal-unsigned-uid": {
      uid: { stringValue: "portal-unsigned-uid" },
      email: { stringValue: "unsigned@example.org" },
      status: { stringValue: "Pending" },
      accountActivated: { booleanValue: false }
    } }
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "NOT_ACTIVATED");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
});

test("invalid Firebase token returns TOKEN_INVALID with a request ID", async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    throw new Error("Unexpected external request");
  };
  try {
    const response = await handler.fetch(new Request("https://gw.test/api/session/profile", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-valid-token" },
      body: "{}"
    }), { FIREBASE_PROJECT_ID: "irpa-digital-board-governance" });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.code, "TOKEN_INVALID");
    assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
  } finally {
    global.fetch = originalFetch;
  }
});
