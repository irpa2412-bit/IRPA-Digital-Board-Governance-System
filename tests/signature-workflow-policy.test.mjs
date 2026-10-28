import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { requireSupportedSignatureRoutingMode } from "../src/firebase/signatureWorkflowPolicy.js";

const portal = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");

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
  assert.match(page, /signingStage&&envelopeId\?await downloadSignatureBytes\([^;]+:await downloadControlledDocumentBytes\(url\.slice\("drive:\/\/"\.length\),documentId\)/);
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


test("Signature Portal palette queries include document owner and signature owner access", () => {
  const data = fs.readFileSync("src/firebase/data.js", "utf8");
  const rules = fs.readFileSync("firestore.rules", "utf8");
  assert.match(data, /where\("ownerUid","==",uid\)/);
  assert.match(data, /where\("signatureOwnerUid","==",uid\)/);
  assert.match(data, /d\?\.driveFileId/);
  assert.match(rules, /resource\.data\.get\("ownerUid",""\)==request\.auth\.uid/);
  assert.match(rules, /resource\.data\.get\("signatureOwnerUid",""\)==request\.auth\.uid/);
});

test("adding the first signing officer creates a signature field assigned to that officer", () => {
  assert.match(portal, /const nextFields=fields\.map\(f=>\(\["Signature","Initials"\]\.includes\(f\.type\)&&!f\.signerUid\)/);
  assert.match(portal, /if\(!nextFields\.some\(f=>\["Signature","Initials"\]\.includes\(f\.type\)\)\)nextFields\.push\(makeField\("Signature",nextFields\.length,m\.uid,1\)\)/);
  assert.match(portal, /fields:nextFields/);
  assert.match(portal, /setFields\(nextFields\)/);
});


test("Signature Portal palette includes authenticated Documents Portal lifecycle PDFs", () => {
  const data = fs.readFileSync("src/firebase/data.js", "utf8");
  assert.match(data, /import \{ listLifecycleDocuments \} from "\.\/documentLifecycle\.js"/);
  assert.match(data, /const lifecycle=await listLifecycleDocuments\(\)/);
  assert.match(data, /lifecycle\?\.documents/);
  assert.match(data, /documentId\|\|item\?\.id/);
  assert.match(data, /item\?\.fileUrl\|\|\(fileId\?/);
  assert.ok(data.includes('item?.contentType||item?.mimeType||"application/pdf"'));
  assert.match(data, /d\?\.downloadUrl\|\|d\?\.downloadURL/);
  assert.match(data, /const byId=new Map\(results\.map\(item=>\[String\(item\.id\|\|item\.documentId\),item\]\)\)/);
});


test("archive-backed controlled PDFs remain discoverable and selectable in the Signature Portal palette", () => {
  const data = fs.readFileSync("src/firebase/data.js", "utf8");
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  for (const field of ["archiveFileId", "governanceArchiveFileId", "primaryArchiveFileId", "governanceArchiveFileWebViewLink"]) {
    assert.ok(data.includes(field), `document discovery must recognize ${field}`);
    assert.ok(page.includes(field), `palette URL resolution must recognize ${field}`);
  }
  assert.match(data, /if\(!\(d\?\.fileUrl\|\|d\?\.documentUrl\|\|d\?\.storageUrl\|\|d\?\.pdfUrl\|\|d\?\.downloadUrl\|\|d\?\.downloadURL\|\|driveId\)\)return false/);
  assert.match(page, /function controlledPdfUrl\(document=\{\}\)/);
});


test("Sign a Document initiation resolves the same primary and governance archive sources as the PDF palette", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /async function initiateSigning\(e\)[\s\S]*?const url=controlledPdfUrl\(source\)/);
  assert.match(page, /function controlledPdfUrl\(document=\{\}\)/);
});

test("Signature Portal PDF palette remains legible and reports retrieval failures", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /background:"#111827",color:"#f8fafc"/);
  assert.match(page, /background:"#ffffff"/);
  assert.match(page, /PDF could not be loaded\. Check your access to this controlled document/);
  assert.ok(page.includes('setPdf(null);setPageNum(1);setError("")'));
});


test("signature PDF palette uses controlled-document authorization during Draft preparation and signature-file authorization only in signing stage", () => {
  const page = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(page, /signingStage=false/);
  assert.match(page, /signingStage&&envelopeId\?await downloadSignatureBytes/);
  assert.match(page, /signingStage=\{tab===\"Sign Document\"\}/);
  const gateway = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
  assert.match(gateway, /metadataDocumentMatch:/);
  assert.match(gateway, /metadataEnvelopeMatch:/);
  assert.match(gateway, /fileLinkedToEnvelope:/);
  assert.match(gateway, /callerUid=/);
  assert.match(gateway, /callerRole=/);
});
