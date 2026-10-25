import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { commitFirestoreDocumentAndAudit } from "../src/index.js";

test("signature-complete atomic commit sends valid document and audit writes", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const env = {
    FIREBASE_PROJECT_ID: "irpa-unit-test",
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "irpa-unit-test",
      client_email: "unit-test@irpa-unit-test.iam.gserviceaccount.com",
      private_key: privateKey,
    }),
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "unit-test-token", expires_in: 300 }), { status: 200 });
    }
    return new Response(JSON.stringify({ writeResults: [{}, {}], commitTime: "2026-10-25T00:00:00Z" }), { status: 200 });
  };
  try {
    const documentFields = {
      status: { stringValue: "SIGNED" },
      signatureStatus: { stringValue: "COMPLETED" },
      signatureEnvelopeId: { stringValue: "ENV-123" },
      signedAt: { timestampValue: "2026-10-25T00:00:00.000Z" },
    };
    const auditFields = {
      action: { stringValue: "DOCUMENT_LIFECYCLE_SIGNATURE_COMPLETED" },
      collection: { stringValue: "documents" },
      recordId: { stringValue: "DOC-123" },
      details: { mapValue: { fields: { envelopeId: { stringValue: "ENV-123" } } } },
      actorUid: { stringValue: "user-1" },
      actorEmail: { nullValue: null },
      createdAt: { timestampValue: "2026-10-25T00:00:00.000Z" },
    };
    await commitFirestoreDocumentAndAudit(env, "DOC-123", "unused-user-token", documentFields, Object.keys(documentFields), auditFields);
    const commit = requests.find(x => x.url.endsWith("/documents:commit"));
    assert.ok(commit, "Firestore commit request should be sent");
    const body = JSON.parse(commit.options.body);
    assert.equal(body.writes.length, 2);
    assert.equal(body.writes[0].update.name, "projects/irpa-unit-test/databases/(default)/documents/documents/DOC-123");
    assert.equal(body.writes[1].update.name.startsWith("projects/irpa-unit-test/databases/(default)/documents/audit/"), true);
    assert.deepEqual(body.writes[0].updateMask.fieldPaths, Object.keys(documentFields));
    assert.equal(body.writes[0].update.fields.status.stringValue, "SIGNED");
    assert.equal(body.writes[0].update.fields.signatureStatus.stringValue, "COMPLETED");
    assert.equal(body.writes[0].update.fields.signatureEnvelopeId.stringValue, "ENV-123");
    assert.deepEqual(body.writes[1].currentDocument, { exists: false });
    const inspect = value => {
      if (Array.isArray(value)) return value.forEach(inspect);
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          assert.notEqual(child, undefined, `undefined value at ${key}`);
          inspect(child);
        }
      }
    };
    inspect(body);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
