import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
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


test("Add Signer draft contract persists resolved source SHA-256 and byte length", async () => {
  const [component, platform] = await Promise.all([
    readFile(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8")
  ]);
  const addSigner = component.slice(component.indexOf("async function addSigner"), component.indexOf("function removeSigner"));
  const saveDraft = platform.slice(platform.indexOf("export async function saveSignatureWorkflowDraft"), platform.indexOf("export async function finalizeSignatureWorkflowDraft"));
  assert.match(addSigner, /saveSignatureWorkflowDraft/, "Add Signer must save the workflow draft");
  assert.match(saveDraft, /resolveSourceDocumentIntegrity/, "draft saving must resolve controlled-document integrity");
  assert.match(saveDraft, /sha256:sourceSha256,byteLength:sourceByteLength/, "draft payload must persist both integrity fields");
});
\n\ntest("post-merge signer authority department fallback is declared after its source record", async () => {\n  const source = await readFile(new URL("../functions/index.js", import.meta.url), "utf8");\n  const match = source.indexOf("const matchingRecords=uniqueRecords.filter");\n  const selected = source.indexOf("const source=matchingRecords[0];", match);\n  const department = source.indexOf("const authorityDepartment=String(source.department||\"\").trim();", selected);\n  const unit = source.indexOf("const authorityUnit=String(source.unit||source.unitName||\"\").trim()||authorityDepartment;", department);\n  assert.ok(match >= 0 && selected > match && department > selected && unit > department, "authorityDepartment must be declared from the selected, validated register record before the unit fallback uses it");\n});\n