import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isCurrentSigningAuthorityRecord } from "../src/signingAuthorityPolicy.mjs";
import { signatureDraftOwnershipAllowed, validateSignatureDraftRecipients } from "../src/signatureDraftPolicy.mjs";
import { verifyCanonicalSignatureEnvelope } from "../src/canonicalSignatureVerification.mjs";
import { createCryptographicEvidence, exportPublicKeyJwk, generateSignerKeyPair } from "../src/cryptographicGate.mjs";
import { sha256Hex } from "../src/util.mjs";
import { assertGatewaySigningResponse } from "../../src/firebase/signatureGatewayResponse.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Gateway envelope creation rejects duplicate UIDs and duplicate emails and validates signing mode", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /if\(!\["Sequential","Parallel"\]\.includes\(signingMode\)\)/);
  assert.match(source, /if\(seenEmails\.has\(email\.toLowerCase\(\)\)\)/);
  assert.match(source, /if\(uid&&seenUids\.has\(uid\)\)throw new HttpError\(400,"Duplicate signer UID\."/);
  assert.match(source, /meta\.create\("externalReferences",reservationKey/);
});

test("Completed Gateway envelopes are immutable to the void operation", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /if\(e\.status==="Completed"\)throw new HttpError\(409,"A completed envelope cannot be voided\."/);
  assert.match(source, /if\(c\.status==="Completed"\)throw new HttpError\(409,"A completed envelope cannot be voided\."/);
});

test("signer status limits UID disclosure to the caller, owner or administrator", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /user\.uid===env\.createdBy\|\|user\.isAdmin===true/);
  assert.match(source, /privileged\|\|s\.id===signer\.id\?\(s\.uid\|\|null\):null/);
});

test("signing authority accepts only Active, current, unexpired UID-bound register records", () => {
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityStatus:"Current",authorityExpiresAt:"2027-01-01T00:00:00Z"}, "u1", Date.parse("2026-11-03T00:00:00Z")), true);
  for (const status of ["Suspended","Terminated","Disabled","Expired","Unknown","Inactive"]) {
    assert.equal(isCurrentSigningAuthorityRecord({status,uid:"u1"}, "u1"), false, status+" must fail closed");
  }
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityStatus:"Expired"}, "u1"), false);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u2",matchedByEmail:true}, "u1"), false);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",matchedByEmail:true}, "u1"), true);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityExpiresAt:"2026-01-01T00:00:00Z"}, "u1", Date.parse("2026-11-03T00:00:00Z")), false);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityExpiresAt:{seconds:1798761600}}, "u1", Date.parse("2026-11-03T00:00:00Z")), true);
  assert.equal(isCurrentSigningAuthorityRecord({status:"Active",uid:"u1",authorityExpiresAt:"not-a-date"}, "u1"), false);
});

test("signature draft ownership and recipient policy have positive and negative cases", async () => {
  assert.equal(signatureDraftOwnershipAllowed({ownerUid:"u1"},"u1",false), true);
  assert.equal(signatureDraftOwnershipAllowed({ownerUid:"u2"},"u1",true), true);
  assert.equal(signatureDraftOwnershipAllowed({ownerUid:"u2"},"u1",false), false);
  assert.equal(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"},{uid:"u2",email:"two@example.org"}],"Sequential"), null);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"},{uid:"u1",email:"two@example.org"}],"Sequential"), /Duplicate signer UID/);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"},{uid:"u2",email:"ONE@example.org"}],"Sequential"), /Duplicate signer email/);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"one@example.org"}],"Invalid"), /Signing mode/);
  const source = await read("../src/index.js");
  assert.match(source, /status:"Draft",signingMode,recipients/);
});

test("lifecycle completion requires canonical Gateway quorum, PDF hash and cryptographic evidence", async () => {
  const index = await read("../src/index.js");
  const canonical = await read("../src/canonicalSignatureVerification.mjs");
  const lifecycle = await read("../src/documentLifecycle.mjs");
  assert.match(index, /verifyCanonicalSignatureEnvelopeRecord\(ctx,envelopeId\)/);
  assert.match(canonical, /envelope\.status!=="Completed"/);
  assert.match(canonical, /signers\.some\(s=>s\.status!=="Signed"\|\|!s\.uid\|\|!s\.signedAt\)/);
  assert.match(canonical, /finalHash!==envelope\.completion\.finalHash/);
  assert.match(canonical, /verifyCryptographicEvidence\(evidence/);
  assert.match(lifecycle, /deps\.verifyCanonicalSignatureEnvelope\(env,gatewayEnvelopeId\)/);
  assert.match(lifecycle, /signedByUid:lastSignedByUid/);
  assert.doesNotMatch(lifecycle, /signedByUid:envelope\.lastSignedByUid\|\|claims\.user_id/);
});

test("CompletionFailed is rejected by the client and successful Gateway completion is accepted", async () => {
  assert.deepEqual(assertGatewaySigningResponse({ok:true},{ok:true,status:"Completed",completed:true}),{ok:true,status:"Completed",completed:true});
  assert.throws(()=>assertGatewaySigningResponse({ok:true},{ok:true,status:"CompletionFailed",completed:false}),/final PDF completion failed/);
  assert.throws(()=>assertGatewaySigningResponse({ok:false},{ok:false,error:"Gateway unavailable"}),/Gateway unavailable/);
  const platform = await read("../../src/firebase/signaturePlatform.js");
  assert.match(platform, /const overall=gatewayStatus\.status==="Completed"/);
  assert.match(platform, /gatewaySigningStatus:String\(gatewayStatus\.status\|\|"Unknown"\)/);
});

test("mirror retry records a bounded exponential retry deadline", async () => {
  const source = await read("../src/signing.mjs");
  assert.match(source, /mirrorNextRetryAt/);
  assert.match(source, /Math\.min\(60\*60\*1000,30\*1000\*Math\.pow\(2/);
});

async function canonicalFixture(){
  const keys=await generateSignerKeyPair(),bytes=new TextEncoder().encode("%PDF-1.7\nIRPA signed PDF");
  const finalHash=await sha256Hex(bytes),signedAt="2026-11-03T10:00:00.000Z",signatureValue="authenticated-signer-signature";
  const evidence=await createCryptographicEvidence({keyId:"test-key-1",signer:{uid:"u1",signerId:"S1",envelopeId:"ENV-1",signatureHash:await sha256Hex(signatureValue),signatureType:"typed",privateKey:keys.privateKey,publicKey:keys.publicKey},publicKeyJwk:await exportPublicKeyJwk(keys.publicKey),documentHash:finalHash,chainHead:"a".repeat(64),signedAt});
  const envelope={id:"ENV-1",externalReference:"IRPA-ENV-1",documentId:"DOC-1",status:"Completed",signers:[{id:"S1",uid:"u1",status:"Signed",signedAt,signatureValue}],completion:{finalHash,primaryStorageId:"signed-pdf",cryptographicEvidenceIds:[evidence.evidenceId],lastSignedByUid:"u1"}};
  const ctx={meta:{get:async(collection,id)=>collection==="envelopes"&&id==="ENV-1"?envelope:null,list:async collection=>collection==="cryptographicEvidence"?[evidence]:[]},storage:{get:async id=>id==="signed-pdf"?bytes:null}};
  return{ctx,envelope,evidence,bytes,finalHash};
}

test("canonical lifecycle verifier accepts a quorum-complete PDF with matching signer evidence", async()=>{
  const fixture=await canonicalFixture();
  const result=await verifyCanonicalSignatureEnvelope(fixture.ctx,"ENV-1");
  assert.equal(result.ok,true);
  assert.equal(result.finalHash,fixture.finalHash);
  assert.equal(result.lastSignedByUid,"u1");
});

test("canonical lifecycle verifier rejects missing signer quorum, missing evidence, bad PDF hash and wrong final signer", async()=>{
  const quorum=await canonicalFixture();quorum.envelope.signers[0].status="Pending";
  assert.equal((await verifyCanonicalSignatureEnvelope(quorum.ctx,"ENV-1")).ok,false);
  const missingEvidence=await canonicalFixture();missingEvidence.ctx.meta.list=async()=>[];
  assert.equal((await verifyCanonicalSignatureEnvelope(missingEvidence.ctx,"ENV-1")).ok,false);
  const badHash=await canonicalFixture();badHash.envelope.completion.finalHash="f".repeat(64);
  assert.equal((await verifyCanonicalSignatureEnvelope(badHash.ctx,"ENV-1")).ok,false);
  const wrongFinalSigner=await canonicalFixture();wrongFinalSigner.envelope.completion.lastSignedByUid="u2";
  assert.equal((await verifyCanonicalSignatureEnvelope(wrongFinalSigner.ctx,"ENV-1")).ok,false);
});

test("canonical lifecycle verifier rejects evidence tampering and signer-signature substitution", async()=>{
  const fixture=await canonicalFixture();
  fixture.ctx.meta.list=async()=>[{...fixture.evidence,signature:"AAAA"}];
  assert.equal((await verifyCanonicalSignatureEnvelope(fixture.ctx,"ENV-1")).ok,false);
  const changed=await canonicalFixture();changed.envelope.signers[0].signatureValue="different-signature";
  assert.equal((await verifyCanonicalSignatureEnvelope(changed.ctx,"ENV-1")).ok,false);
});
