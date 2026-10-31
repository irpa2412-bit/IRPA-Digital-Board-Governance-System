import test from "node:test";
import assert from "node:assert/strict";
import { verifySourceDocumentIntegrity } from "../drive-gateway/src/signing.mjs";

const bytes = new TextEncoder().encode("%PDF-1.7");
const hash = "a4f4e2d1"; // replaced below with the real digest for the fixture

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

test("Gateway accepts a legacy envelope when neither envelope nor source has expected metadata", async () => {
  const result = await verifySourceDocumentIntegrity(bytes, {}, {});
  assert.deepEqual(result, { expectedHash: null, expectedSize: null });
});

test("Gateway accepts a matching envelope hash and size", async () => {
  const expectedHash = await sha256(bytes);
  const result = await verifySourceDocumentIntegrity(bytes, { sha256: expectedHash, byteLength: bytes.byteLength }, { sha256: "different", fileSize: 999 });
  assert.equal(result.expectedHash, expectedHash);
  assert.equal(result.expectedSize, bytes.byteLength);
});

test("Gateway blocks a mismatching expected hash or size", async () => {
  const expectedHash = await sha256(bytes);
  await assert.rejects(() => verifySourceDocumentIntegrity(bytes, { sha256: "0".repeat(64) }, {}), /integrity check/);
  await assert.rejects(() => verifySourceDocumentIntegrity(bytes, { byteLength: bytes.byteLength + 1 }, {}), /integrity check/);
  assert.equal((await verifySourceDocumentIntegrity(bytes, {}, { sha256: expectedHash, fileSize: bytes.byteLength })).expectedHash, expectedHash);
});
