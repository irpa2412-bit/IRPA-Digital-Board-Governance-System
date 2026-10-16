import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { requireSupportedSignatureRoutingMode } from "../src/firebase/signatureWorkflowPolicy.js";

test("Sequential and Parallel are the only supported Signature Portal routing modes", () => {
  assert.equal(requireSupportedSignatureRoutingMode("Sequential"), "Sequential");
  assert.equal(requireSupportedSignatureRoutingMode("Parallel"), "Parallel");
  assert.equal(requireSupportedSignatureRoutingMode(undefined), "Sequential");
});

test("unsupported and malformed routing modes fail closed", () => {
  assert.throws(() => requireSupportedSignatureRoutingMode("Mixed"), /not yet supported/);
  assert.throws(() => requireSupportedSignatureRoutingMode(""), /not yet supported/);
  assert.throws(() => requireSupportedSignatureRoutingMode("parallel"), /not yet supported/);
});

test("Signature Portal signing reads use the scoped download route and preserve envelope identity", () => {
  const platform = fs.readFileSync(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");

  assert.match(platform, /downloadSignatureBytes/);
  assert.match(platform, /fetchBytes\(envelope\.signedDocumentUrl\|\|envelope\.documentUrl,envelope\.documentId,envelope\.id\)/);
  assert.doesNotMatch(page, /downloadDriveBytes/);
  assert.doesNotMatch(page, /<option>Mixed<\/option>/);
  assert.match(storage, /\/api\/signature-file\/download/);
  assert.match(storage, /metadata\.customMetadata\?\.envelopeId/);
  assert.match(gateway, /url\.pathname === "\/api\/signature-file\/download"/);
  assert.match(gateway, /canReadSignatureAsset/);
});

test("uploaded controlled PDF enters the pre-signing palette with scoped document access", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  const storage = fs.readFileSync(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");
  assert.match(page, /setDocumentId\(initialDocument\.id\);setDocumentUrl\(url\)/);
  assert.match(page, /setSigningCircle\("Document Selected"\);setTab\("Prepare Envelope"\)/);
  assert.match(page, /import\{downloadControlledDocumentBytes,downloadSignatureBytes\}from"\.\.\/firebase\/signatureStorage"/);
  assert.match(page, /envelopeId\?await downloadSignatureBytes\([^;]+:await downloadControlledDocumentBytes\(url\.slice\("drive:\/\/"\.length\),documentId\)/);
  assert.match(storage, /export async function downloadControlledDocumentBytes\(fileId, documentId\)/);
  assert.match(storage, /if \(!fileId \|\| !documentId\) throw new Error/);
});

test("PDF palette resolves controlled Drive PDFs in archive, initial selection and upload paths", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /function controlledPdfUrl\(document=\{\}\)/);
  assert.match(page, /if\(driveId\)return `drive:\/\/\$\{driveId\}`/);
  assert.match(page, /setDocumentUrl\(controlledPdfUrl\(d\)\)/);
  assert.match(page, /setDocumentUrl\(controlledPdfUrl\(doc\)\)/);
  assert.match(page, /setDocumentUrl\(controlledPdfUrl\(selectedDoc\)\)/);
  assert.match(page, /const url=controlledPdfUrl\(initialDocument\)/);
});
