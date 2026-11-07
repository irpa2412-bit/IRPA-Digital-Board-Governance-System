import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { ensureEnvelopePdfCopy } from "../src/signatureEnvelopeDrive.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const bytes = new TextEncoder().encode("%PDF-1.7\nIRPA fixture PDF bytes");
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function fixture(overrides = {}) {
  const files = new Map();
  let copyCalls = 0;
  const folders = new Map();
  const findOrCreateFolder = async (_env, _token, name, parentId = null) => {
    const key = name + ":" + (parentId || "root");
    if (!folders.has(key)) folders.set(key, "folder-" + (folders.size + 1));
    return folders.get(key);
  };
  const driveFetch = async (_env, _token, path, options = {}) => {
    if (path.includes("/drive/v3/files?q=")) {
      const id = [...files.keys()][0];
      return { files: id ? [files.get(id)] : [] };
    }
    if (path.includes("/copy?")) {
      copyCalls += 1;
      const body = JSON.parse(options.body);
      const id = "copy-file-123";
      const file = { id, name: body.name, mimeType: "application/pdf", parents: body.parents, size: String(bytes.byteLength), trashed: false, appProperties: body.appProperties };
      files.set(id, file);
      return file;
    }
    if (path.includes("/drive/v3/files/")) return files.get("copy-file-123");
    throw new Error("Unexpected Drive API path " + path);
  };
  return {
    files, folders, findOrCreateFolder, driveFetch, get copyCalls() { return copyCalls; },
    downloadBytes: async () => overrides.bytes || bytes,
    options: {
      env: { DRIVE_ROOT_FOLDER_NAME: "IRPA Governance System" }, accessToken: "fixture",
      envelopeId: "IRPA-ENV-2026-12345678", ownerUid: "owner-1", sourceFileId: "source-file-123",
      sourceHash: overrides.sourceHash || (await sha256(bytes)), sourceByteLength: overrides.sourceByteLength || bytes.byteLength,
      sourceName: "Board Resolution", findOrCreateFolder, driveFetch,
      downloadBytes: async () => overrides.bytes || bytes
    }
  };
}

test("creates and verifies envelope PDF copy with expected parent and integrity", async () => {
  const f = fixture();
  const result = await ensureEnvelopePdfCopy(f.options);
  assert.equal(result.envelopeFileMimeType, "application/pdf");
  assert.equal(result.envelopeFileParentId, result.envelopeFolderId);
  assert.equal(result.envelopeFileSha256, f.options.sourceHash);
  assert.equal(result.envelopeFileSize, bytes.byteLength);
  assert.equal(f.copyCalls, 1);
});

test("retry reuses a Drive copy created before a failed Firestore persistence", async () => {
  const f = fixture();
  const first = await ensureEnvelopePdfCopy(f.options);
  // Model Firestore persistence failing after Drive has committed the copy.
  const second = await ensureEnvelopePdfCopy(f.options);
  assert.equal(second.envelopeFileId, first.envelopeFileId);
  assert.equal(f.copyCalls, 1);
});

test("rejects copied content whose hash differs from the source", async () => {
  const wrong = new TextEncoder().encode("%PDF-1.7\nchanged");
  const f = fixture({ bytes: wrong });
  await assert.rejects(() => ensureEnvelopePdfCopy(f.options), /byte length|SHA-256/);
});

test("rejects a source without a canonical Drive file ID", async () => {
  const f = fixture();
  await assert.rejects(() => ensureEnvelopePdfCopy({ ...f.options, sourceFileId: "https://example.test/file.pdf" }), /valid Google Drive file ID/);
});
