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


test("blob inspection reports contiguous chunks, in-memory PDF measurements, and never returns bytes", async () => {
  const pdfText = "%PDF-1.4\\n1 0 obj <</Type /Page>> endobj\\n%%EOF";
  const encoded = btoa(pdfText);
  const pages = [
    { body: { fields: { totalChunks: { integerValue: "1" }, fileSize: { integerValue: String(pdfText.length) } } } },
    { body: { collectionIds: ["chunks"] } },
    { body: { documents: [{ name: "projects/p/databases/(default)/documents/emergencyBlobs/blob-a/chunks/0", fields: { index: { integerValue: "0" }, data: { bytesValue: encoded }, note: { stringValue: "metadata-only" } } }] } },
    { status: 404 }, { status: 404 }, { status: 404 }, { status: 404 }
  ];
  const { route, calls } = fixture({ firestorePages: pages });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "inspectBlob", collectionPath: "emergencyBlobs", documentId: "blob-a" })
  }), {});
  assert.equal(response.status, 200);
  const resultText = await response.text();
  const result = JSON.parse(resultText);
  const detail = result.subcollections[0];
  assert.equal(detail.chunkDocumentCount, 1);
  assert.equal(detail.indexesContiguous, true);
  assert.equal(detail.totalChunksMatchesActual, true);
  assert.equal(detail.byteLength, pdfText.length);
  assert.equal(detail.startsWithPdfHeader, true);
  assert.equal(detail.mimeTypeImplied, "application/pdf");
  assert.equal(detail.pdfPageCount, 1);
  assert.equal(detail.parentSizeMatches, true);
  const expectedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pdfText));
  const expectedHash = Array.from(new Uint8Array(expectedDigest), byte => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(detail.sha256, expectedHash);
  assert.equal(resultText.includes(encoded), false);
  assert.equal(resultText.includes(pdfText), false);
  assert.equal(calls.length, 7, "one parent record is inspected in one bounded request");
});

test("blob inspection detects chunk index gaps and parent size mismatches", async () => {
  const data = "AB";
  const pages = [
    { body: { fields: { totalChunks: { integerValue: "3" }, fileSize: { integerValue: "99" } } } },
    { body: { collectionIds: ["chunks"] } },
    { body: { documents: [
      { name: "projects/p/databases/(default)/documents/emergencyBlobs/blob-gap/chunks/0", fields: { index: { integerValue: "0" }, data: { stringValue: "A" } } },
      { name: "projects/p/databases/(default)/documents/emergencyBlobs/blob-gap/chunks/2", fields: { index: { integerValue: "2" }, data: { stringValue: "B" } } }
    ] } },
    { status: 404 }, { status: 404 }, { status: 404 }, { status: 404 }
  ];
  const { route } = fixture({ firestorePages: pages });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "inspectBlob", collectionPath: "emergencyBlobs", documentId: "blob-gap" })
  }), {});
  const detail = (await response.json()).subcollections[0];
  assert.equal(detail.indexesContiguous, false);
  assert.equal(detail.chunkDocumentCount, 2);
  assert.equal(detail.totalChunksMatchesActual, false);
  assert.equal(detail.parentSizeMatches, false);
  assert.equal(detail.byteLength, data.length);
});

test("blob inspection reports missing chunk subcollections without reconstructing content", async () => {
  const pages = [
    { body: { fields: { totalChunks: { integerValue: "1" } } },
    { body: { collectionIds: [] } }
  ];
  const { route, calls } = fixture({ firestorePages: pages });
  const response = await route(new Request("https://worker.test/api/signature-pathway/emergency-storage", {
    method: "POST", headers: { Authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "inspectBlob", collectionPath: "emergencyBlobs", documentId: "blob-missing" })
  }), {});
  const result = await response.json();
  assert.deepEqual(result.subcollectionIds, []);
  assert.deepEqual(result.subcollections, []);
  assert.equal(calls.length, 2);
});
