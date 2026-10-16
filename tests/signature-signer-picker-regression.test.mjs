import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const portal = fs.readFileSync("src/pages/SignaturePlatform.jsx", "utf8");
const platform = fs.readFileSync("src/firebase/signaturePlatform.js", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

test("PDF designer receives the active draft envelope context", () => {
  assert.match(portal, /function PDFDesigner\(\{url,documentId,envelopeId=null/);
  assert.match(portal, /<PDFDesigner url=\{documentUrl\} documentId=\{documentId\} envelopeId=\{draftEnvelopeId\}/);
});

test("signer UID linking requires a unique active employee email match", () => {
  assert.match(portal, /employeeUidsByEmail/);
  assert.match(portal, /linkedUids\.length===1/);
  assert.match(portal, /\["active","activated","current"\]/);
  assert.doesNotMatch(portal, /uid:\s*member\.id/);
});

test("draft envelope preserves controlled-document origin without bypassing actual-data gate", () => {
  assert.match(platform, /const sourceDocumentSnap=await getDoc\(doc\(db,"documents",documentId\)\)/);
  assert.match(platform, /recordOrigin,trialData:recordOrigin==="TRIAL"/);
  assert.match(rules, /function actualCreateAllowed\(\)\{return actualDataAccessOpen\(\)\|\|trialDataRecord\(request\.resource\.data\);\}/);
  assert.match(rules, /match \/signatureEnvelopes\/\{id\}.*actualCreateAllowed\(\)/);
});
test("uploaded controlled PDF is handed directly into the field palette before signing", () => {
  assert.match(portal, /setDocumentId\(initialDocument\.id\);setDocumentUrl\(url\);setTitle\(initialDocument\.title/);
  assert.match(portal, /setSigningCircle\("Document Selected"\);setTab\("Prepare Envelope"\)/);
  assert.match(portal, /initialDocument\.fileUrl\|\|initialDocument\.documentUrl\|\|initialDocument\.storageUrl\|\|initialDocument\.pdfUrl/);
});

test("pre-envelope Drive PDF uses the document-scoped download route", () => {
  assert.match(portal, /import\{downloadControlledDocumentBytes,downloadSignatureBytes\}from"\.\.\/firebase\/signatureStorage"/);
  assert.match(portal, /envelopeId\?await downloadSignatureBytes\([^;]+:await downloadDriveBytes\(url\.slice\("drive:\/\/".length\),documentId\)/);
});
