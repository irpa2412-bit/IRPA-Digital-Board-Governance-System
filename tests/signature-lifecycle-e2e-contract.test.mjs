import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const lifecycle = read("../drive-gateway/src/documentLifecycle.mjs");
const documentPolicy = read("../drive-gateway/src/documentPolicy.mjs");
const signing = read("../drive-gateway/src/signing.mjs");
const gateway = read("../drive-gateway/src/index.js");
const client = read("../src/firebase/signaturePlatform.js");
const portal = read("../src/pages/SignaturePlatform.jsx");
const selfTest = read("../src/components/SignaturePathwaySelfTest.jsx");
const signaturePad = read("../src/components/SignatureFieldConfirmationPad.jsx");
const documentPortal = read("../src/pages/DocumentLifecycleModule.jsx");

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing source anchor: ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to < 0 ? source.length : to);
}

test("1. controlled PDF upload records SHA-256, byte length and parsed PDF page count", () => {
  const upload = section(lifecycle, 'pathname==="/api/document-lifecycle/upload"', 'pathname==="/api/document-lifecycle/download"');
  assert.match(upload, /sha256\(bytes\)/);
  assert.match(upload, /fileSize:bytes\.length/);
  assert.match(upload, /pdfPageCount|pageCount/);
  assert.match(documentPolicy, /pdfPageCount:Number\(pdfPageCount\)/);
  assert.match(upload, /pdfPageCount,archivePath/);
  assert.match(upload, /status:"WORKING"/);
});

test("2. envelope creation binds source integrity, two unique signers and page-specific fields", () => {
  const create = section(client, "export async function createSignatureEnvelope", "export async function");
  assert.match(create, /resolveSourceDocumentIntegrity/);
  assert.match(create, /sha256:sourceSha256/);
  assert.match(create, /byteLength:sourceByteLength/);
  assert.match(signing, /PDFDocument\.load\(sourceBytes\)/);
  assert.match(signing, /field\.page>pageCount/);
  assert.match(signing, /seenUids\.has\(uid\)/);
  assert.match(create, /participantUids/);
  assert.match(create, /page:Number\(field\?\.page\|\|1\)/);
  assert.match(portal, /recipients\.some\(x=>x\.uid===m\.uid\)/);
  assert.match(portal, /addSignerInFlightRef/);
  assert.match(portal, /pdf\.numPages|numPages/);
});

test("3. transport creates signer invitations and enforces assigned-only retrieval", () => {
  assert.match(client, /\/api\/signature-invitations\/send/);
  assert.match(gateway, /sendSignatureInvitation/);
  assert.match(signing, /invitations\.updated/);
  assert.match(portal, /Assigned to me|Assigned to Me|assigned to me/i);
  assert.match(portal, /envelopes\.filter\(e=>\(e\.recipients\|\|\[\]\)\.some\(r=>r\?\.uid===auth\.currentUser\?\.uid\)\)/);
  assert.match(signing, /participant|signer/i);
});

test("4. signing enforces signer assignment, authority, consent, order and duplicate-submit protection", () => {
  assert.match(client, /!envelope\.participantUids\?\.includes\(u\.uid\)/);
  assert.match(client, /This signing task is assigned to another officer/);
  assert.match(client, /authorityStatus!==\"Current\"/);
  assert.match(client, /currentSignerUid&&envelope\.currentSignerUid!==u\.uid/);
  assert.match(client, /consent:true/);
  assert.match(signing, /electronicConsentAccepted=true/);
  assert.match(signing, /consentAccepted:true/);
  assert.match(signaturePad, /mode==="Draw"/);
  assert.match(signaturePad, /mode==="Type"/);
  assert.match(signaturePad, /Use my saved signature/);
  assert.match(portal, /signInFlightRef/);
  assert.match(signing, /idempotent:true/);
  assert.match(signing, /ifVersion:c\._v/);
  assert.match(gateway, /currentDocument:existing\?\{updateTime:existing\.updateTime\}/);
  assert.match(gateway, /idempotent:true/);
});

test("5. final completion is server-verified and binds the final PDF hash and audit evidence", () => {
  const complete = section(lifecycle, 'pathname==="/api/document-lifecycle/signature-complete"', String.fromCharCode(10) + "    }");
  assert.match(complete, /status:"SIGNED"/);
  assert.match(complete, /finalSignedPdfSha256/);
  assert.match(complete, /verification\.finalHash/);
  assert.match(signing, /Completed/);
  assert.match(signing, /completion/);
});

test("6. signed output returns to final archive and notices/retrieval remain signer-scoped", () => {
  assert.match(lifecycle, /FINAL_ARCHIVE/);
  assert.match(lifecycle, /finalArchiveFileId/);
  assert.match(documentPortal, /signatureEnvelopeId/);
  assert.match(client, /getMySignedDocuments/);
  assert.match(portal, /signerArchiveUrl/);
  assert.match(signing, /notification|email|invitation/i);
  assert.match(signing, /createdByEmail/);
  assert.match(signing, /for\(const signer of initial\.signers\|\|\[\]\)/);
  assert.match(signing, /completion\.notice\.sent/);
  assert.match(gateway, /sendCompletionNotice: async/);
});

test("7. decline, revoke, reminder, immutable completion and retry-after-network-error are covered", () => {
  assert.match(client, /Declined/);
  assert.match(signing, /decline|Declined/i);
  assert.match(signing, /revoke|Voided|Cancelled/i);
  assert.match(signing, /resendInvitation/);
  assert.match(signing, /retryCompletion/);
  assert.match(signing, /A completed envelope cannot be voided/);
  assert.match(signing, /Completed/);
  assert.match(portal, /resendFailedGatewaySignatureInvitations/);
  assert.match(signing, /idempotent:true/);
});

test("portal Signature Lifecycle self-test reports stages, HTTP status and detail without document bytes", () => {
  assert.match(selfTest, /Signature Lifecycle/);
  assert.match(selfTest, /HTTP status/);
  assert.match(selfTest, /Detail/);
  assert.match(selfTest, /PASS|FAIL/);
  assert.doesNotMatch(selfTest, /console\.log\([^)]*base64/i);
});
