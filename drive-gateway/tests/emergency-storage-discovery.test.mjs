import test from "node:test";
import assert from "node:assert/strict";
import { createEmergencyStorageDiscoveryRoute } from "../src/emergencyStorageDiscovery.mjs";

function fixture({ admin = true, firestorePages = [] } = {}) {
  const calls = [];
  const route = createEmergencyStorageDiscoveryRoute({
    async authenticateFirebaseRequest() {
      return { user_id: "admin-uid", email: admin ? "admin@example.org" : "member@example.org", token: "user-token" };
    },
    async getFirestoreDocument(_env, path) {
      assert.equal(path, "adminProfiles/admin-uid");
      return { fields: { active: { booleanValue: admin }, role: { stringValue: admin ? "Administrator" : "Member" } } };
    },
    async getFirestoreAdminAccessToken() { return "service-account-token"; },
    getFirebaseProjectId() { return "irpa-digital-board-governance"; },
    corsHeaders() { return {}; },
    async firestoreFetch(url, init) {
      calls.push({ url, init });
      const page = firestorePages.shift() || {};
      return new Response(JSON.stringify(page.body || page), { status: page.status || 200 });
    }
  });
  return { route, calls };
}

test("emergency storage discovery reports matching field metadata without returning values", async () => {
  const secretBytes = "FILE_BYTES_MUST_NEVER_LEAK";
  const { route, calls } = fixture({ firestorePages: [{
    body: {
      documents: [{
        name: "projects/p/databases/(default)/documents/emergencyCopies/copy-1",
        fields: {
          storageUri: { stringValue: "firestore-emergency://archive/IRPA-EMG-DOC-42" },
          bytes: { bytesValue: btoa(secretBytes) },
          payloadBase64: { stringValue: "U0VDUkVU" },
          chunks: { arrayValue: { values: [{ stringValue: "chunk-a" }, { stringValue: "chunk-b" }] } }
        }
      }]
    }
  }] });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "scan", collectionId: "emergencyCopies" })
  }), {});
  assert.equal(response.status, 200);
  const result = await response.text();
  const data = JSON.parse(result);
  assert.equal(data.hits.length, 1);
  assert.equal(data.hits[0].collectionPath, "emergencyCopies");
  assert.equal(data.hits[0].documentId, "copy-1");
  assert.ok(data.hits[0].fields.some(field => field.name === "bytes" && field.type === "bytes" && field.sizeBytes === secretBytes.length));
  assert.equal(data.hits[0].hasBytesField, true);
  assert.equal(data.hits[0].hasBase64Field, true);
  assert.equal(data.hits[0].hasChunksField, true);
  assert.equal(data.hits[0].chunkCount, 2);
  assert.equal(result.includes(secretBytes), false);
  assert.equal(result.includes(btoa(secretBytes)), false);
  assert.equal(result.includes("chunk-a"), false);
  assert.equal(calls.length, 1, "one collection page must cause exactly one Firestore subrequest");
});

test("emergency storage discovery returns an empty hit list when no matching values exist", async () => {
  const { route } = fixture({ firestorePages: [{
    body: { documents: [{ name: "projects/p/databases/(default)/documents/documents/ordinary", fields: { title: { stringValue: "Ordinary document" } } }] }
  }] });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "scan", collectionId: "documents" })
  }), {});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).hits, []);
});

test("emergency storage discovery denies a non-administrator before privileged Firestore access", async () => {
  const { route, calls } = fixture({ admin: false });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "collections" })
  }), {});
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("root collection listing uses one Firestore request and returns only collection IDs and cursor", async () => {
  const { route, calls } = fixture({ firestorePages: [{ body: { collectionIds: ["documents", "audit"], nextPageToken: "next-page" } }] });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "collections" })
  }), {});
  assert.deepEqual(await response.json(), { ok: true, collectionIds: ["documents", "audit"], nextPageToken: "next-page" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /:listCollectionIds/);
});


test("a completed discovery run writes one metadata-only audit event", async () => {
  const { route, calls } = fixture({ firestorePages: [{ body: { commitTime: "2026-11-15T18:00:00Z" } }] });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "audit", runId: "run-123", hitCount: 2, collectionCount: 1, scannedCollectionIds: ["documents"], completed: true })
  }), {});
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.audited, true);
  assert.equal(data.hitCount, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /:commit/);
  const write = JSON.parse(calls[0].init.body).writes[0];
  assert.equal(write.update.fields.action.stringValue, "EMERGENCY_STORAGE_DISCOVERY");
  assert.equal(write.update.fields.hitCount.integerValue, "2");
  assert.equal(write.update.fields.completed.booleanValue, true);
  assert.equal(JSON.stringify(write).includes("file-bytes"), false);
});
