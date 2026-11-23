import { PDFDocument } from "pdf-lib";
import { canonicalJson, sha256Hex } from "../../src/util.mjs";
import { createSignatureRecoveryRouter } from "../../src/signatureRecovery.mjs";

const envelopeId = "ENV-WORKER-TEST";
const ownerUid = "owner-worker-test";
const stampIds = Array.from({ length: 12 }, (_, index) => "STAMP-" + String(index + 1).padStart(2, "0"));

async function createFixture() {
  const sourcePdf = await PDFDocument.create();
  sourcePdf.addPage([612, 792]);
  const source = new Uint8Array(await sourcePdf.save());
  const sourceHash = await sha256Hex(source);
  const records = new Map();
  const files = new Map([["source-worker-test", source]]);
  const meta = {
    async get(collection, id) {
      const value = records.get(collection + "/" + id);
      return value ? structuredClone(value) : null;
    },
    async list(collection) {
      return [...records.entries()].filter(([key]) => key.startsWith(collection + "/")).map(([, value]) => structuredClone(value));
    },
    async create(collection, id, value) {
      records.set(collection + "/" + id, structuredClone(value));
    },
    async update(collection, id, value) {
      records.set(collection + "/" + id, structuredClone(value));
    }
  };
  const storage = {
    async get(id) { const value = files.get(id); return value ? new Uint8Array(value) : null; },
    async put() { throw new Error("Drive/storage writes are forbidden in this test"); },
    async delete() { throw new Error("Storage deletes are forbidden in this test"); }
  };
  const signerValue = "Verified signer specimen";
  const fieldValues = Object.fromEntries(stampIds.map((id, index) => [id, "Verified stamp " + (index + 1)]));
  const hashes = await Promise.all(stampIds.map(async fieldId => ({ fieldId, type: "Signature", hash: await sha256Hex(fieldValues[fieldId]) })));
  let events = [];
  for (const event of [
    { type: "signer.role_assignment.completed", signerId: "SIGNER-1", at: "2026-11-22T10:00:00.000Z", roleAssignmentIndex: 0, signatureFieldHashes: hashes },
    { type: "signer.signed", signerId: "SIGNER-1", at: "2026-11-22T10:01:00.000Z", signatureHash: await sha256Hex(signerValue) }
  ]) {
    const body = { ...event, prevHash: events.length ? events.at(-1).hash : "GENESIS" };
    events.push({ ...body, hash: await sha256Hex(canonicalJson(body)) });
  }
  await meta.create("documents", "DOC-WORKER-TEST", { id: "DOC-WORKER-TEST", primaryStorageId: "source-worker-test", sha256: sourceHash });
  await meta.create("envelopes", envelopeId, {
    id: envelopeId, documentId: "DOC-WORKER-TEST", documentHash: sourceHash, createdBy: ownerUid,
    status: "CompletionFailed", title: "Workers runtime emergency retrieval test",
    fields: stampIds.map((fieldId, index) => ({
      fieldId, type: "Signature", page: 1, x: 0.05 + (index % 4) * 0.23, y: 0.08 + Math.floor(index / 4) * 0.22,
      width: 0.18, height: 0.08, coordinateSpace: "visible-page-fraction-v1", signerId: "SIGNER-1", roleAssignmentIndex: 0
    })),
    signers: [{
      id: "SIGNER-1", name: "Workers Runtime Signer", email: "worker-test@example.test", status: "Signed",
      signedAt: "2026-11-22T10:01:00.000Z", signatureValue: signerValue, signatureType: "typed", fieldValues
    }],
    events, completionFailure: { stage: "WRITE_ARCHIVE_COPIES" }
  });
  return {
    env: { IRPA_ENVIRONMENT: "test" }, meta, storage,
    now() { throw new Error("ctx.now() must not be called by emergency retrieval"); }
  };
}

const contextPromise = createFixture();
const router = createSignatureRecoveryRouter({
  authenticateFirebaseRequest: async () => ({ user_id: ownerUid, token: "runtime-test-token" }),
  getFirestoreDocument: async () => null,
  buildContext: () => contextPromise,
  json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
  corsHeaders: () => ({ "content-type": "application/json" })
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await router(request, env, url.pathname);
    return response || new Response("Not found", { status: 404 });
  }
};
