import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=path=>fs.readFileSync(path,"utf8");
const gatewaySigning=read("drive-gateway/src/signing.mjs");
const gatewayRouter=read("drive-gateway/src/router.mjs");
const gatewayIndex=read("drive-gateway/src/index.js");
const clientCore=read("src/firebase/signaturePlatform.js");
const clientUi=read("src/pages/SignaturePlatform.jsx");
const firestoreRules=read("firestore.rules");
const mirror=read("drive-gateway/src/signatureMirror.mjs");

test("Gateway invitation URL carries the portal envelope ID as well as its one-time signing token",()=>{
  assert.match(gatewaySigning,/gatewayToken=\$\{encodeURIComponent\(token\)\}&signEnvelope=\$\{encodeURIComponent\(externalReference\|\|""\)\}/);
});

test("Gateway token remains available after the app removes it from the address bar",()=>{
  assert.match(clientCore,/sessionStorage\.getItem\("irpaGatewaySigningToken"\)/);
});

test("Gateway-connected signers are shown the ordinary assigned PDF and signing palette",()=>{
  assert.doesNotMatch(clientUi,/selected\?\.gatewayEnvelopeId\?<section/);
  assert.match(clientUi,/SigningDocumentViewer/);
  assert.match(clientUi,/SignatureFieldConfirmationPad/);
  assert.match(clientUi,/selected\.gatewayEnvelopeId&&window\.sessionStorage\.getItem\("irpaGatewaySigningToken"\)/);
});

test("Gateway signing does not attempt browser-side writes to authoritative signature collections",()=>{
  const start=clientCore.indexOf("async function signEnvelopeThroughGateway");
  const end=clientCore.indexOf("export async function signEnvelope",start);
  assert.ok(start>=0&&end>start);
  const body=clientCore.slice(start,end);
  assert.doesNotMatch(body,/\b(updateDoc|setDoc|recordEnvelopeEvent)\s*\(/);
  assert.match(body,/submitGatewaySignature/);
  assert.match(body,/verifyGatewaySignedPdf/);
});

test("Gateway invitation retry route is owner-authenticated and included in Worker route allowlist",()=>{
  assert.ok(gatewayRouter.includes(String.raw`invitations\/(S\d{1,2})\/resend`));
  assert.ok(gatewayIndex.includes(String.raw`invitations\/S\d{1,2}\/resend`));
  assert.match(gatewaySigning,/export async function resendInvitation/);
});
test("Gateway completion mirror writes signer-specific archive references for My Documents",()=>{
  assert.match(mirror,/signatures\/\+signatureRecordId/);
  assert.match(mirror,/signerArchiveUrl/);
  assert.match(mirror,/kind==="signer-copy"/);
});

test("Gateway-backed envelope, signature and audit writes are denied to browser clients",()=>{
  assert.match(firestoreRules,/function gatewaySignatureEnvelope\(/);
  assert.match(firestoreRules,/resource\.data\.get\("gatewayEnvelopeId",null\)==null/);
  assert.match(firestoreRules,/!gatewaySignatureEnvelope\(request\.resource\.data\.get\("envelopeId",""\)\)/);
});
