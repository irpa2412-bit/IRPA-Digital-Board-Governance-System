import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { resolveSourceDocumentIntegrity } from "../src/firebase/signatureSourceIntegrity.js";

test("uses SHA-256 and byte length already stored on the controlled document", async () => {
  const result = await resolveSourceDocumentIntegrity({
    sha256: "A".repeat(64),
    fileSize: 321,
    fileId: "drive-file-1"
  }, "drive://drive-file-1", "doc-1", async () => {
    throw new Error("download should not be needed when metadata is complete");
  });
  assert.deepEqual(result, { sha256: "a".repeat(64), byteLength: 321 });
});

test("computes integrity metadata for a legacy document from downloaded bytes", async () => {
  const bytes = new TextEncoder().encode("legacy controlled PDF bytes");
  const result = await resolveSourceDocumentIntegrity(
    { fileId: "legacy-file" },
    "https://drive.example/legacy-file",
    "legacy-doc",
    async fileId => {
      assert.equal(fileId, "legacy-file");
      return bytes;
    }
  );
  assert.deepEqual(result, {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength
  });
});

test("does not block signer assignment when source integrity metadata and source bytes are unavailable", async () => {
  const result = await resolveSourceDocumentIntegrity(
    { title: "Legacy document without integrity metadata" },
    "https://drive.example/unavailable",
    "legacy-doc",
    async () => { throw new Error("source download unavailable"); }
  );
  assert.deepEqual(result, { sha256: null, byteLength: null });
});
