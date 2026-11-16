import test from "node:test";
import assert from "node:assert/strict";
import {EsignRecordDurableObject,buildEsignContext} from "../src/esignContext.mjs";
import {buildCanonicalSigningPayload,createCryptographicEvidence,verifyCryptographicEvidence} from "../src/cryptographicGate.mjs";
import {sha256Hex} from "../src/util.mjs";

function durableObjectNamespace(){
  const instances=new Map();
  return {
    idFromName:name=>String(name),
    get:id=>{
      if(!instances.has(id)){
        const records=new Map();
        const state={
          storage:{
            get:async key=>records.get(key),
            put:async(key,value)=>records.set(key,value),
            delete:async key=>records.delete(key),
            transaction:async fn=>fn({get:async key=>records.get(key),put:async(key,value)=>records.set(key,value)}),
          },
          blockConcurrencyWhile:fn=>fn(),
        };
        const object=new EsignRecordDurableObject(state,{});
        instances.set(id,{fetch:request=>object.fetch(request)});
      }
      return instances.get(id);
    },
  };
}

test("external email signer key is held by the Gateway Durable Object and never returned to the caller",async()=>{
  const env={DRIVE_MOCK:"false",ESIGN_DO:durableObjectNamespace(),IRPA_APP_URL:"https://example.test"};
  const ctx=buildEsignContext({env,verifyUser:async()=>null,sendInvitation:async()=>{},logger:{error(){}}});
  const signer={envelopeId:"ENV-email-key",id:"S1",identityType:"email-link",emailHash:"a".repeat(64)};
  const first=await ctx.crypto.keyProvider.getSignerKeyForSigner(signer);
  const second=await ctx.crypto.keyProvider.getSignerKeyForSigner(signer);
  assert.match(first.keyId,/^EMAIL-[0-9a-f]{64}$/);
  assert.equal(second.keyId,first.keyId);
  assert.deepEqual(second.publicKeyJwk,first.publicKeyJwk);
  assert.equal(first.privateKey,undefined);
  assert.equal(typeof first.signCanonicalPayload,"function");
});

test("email-link cryptographic evidence binds envelope, signer ID, invited email hash and completed PDF",async()=>{
  const ctx=buildEsignContext({env:{DRIVE_MOCK:"false",ESIGN_DO:durableObjectNamespace()},verifyUser:async()=>null,sendInvitation:async()=>{},logger:{error(){}}});
  const signer={envelopeId:"ENV-email-proof",id:"S2",identityType:"email-link",emailHash:"b".repeat(64)};
  const key=await ctx.crypto.keyProvider.getSignerKeyForSigner(signer);
  const documentHash=await sha256Hex("exact-completed-pdf");
  const signatureHash=await sha256Hex("signer's declared signature");
  const chainHead=await sha256Hex("gateway audit chain head");
  const signedAt="2026-11-16T15:00:00.000Z";
  const evidence=await createCryptographicEvidence({
    keyId:key.keyId,
    signer:{...signer,signatureHash,signatureType:"typed",publicKey:key.publicKey,signCanonicalPayload:key.signCanonicalPayload},
    documentHash,chainHead,signedAt,publicKeyJwk:key.publicKeyJwk,
  });
  assert.equal(evidence.signerUid,null);
  assert.equal(evidence.signerIdentityType,"email-link");
  assert.equal(evidence.signerIdentityHash,signer.emailHash);
  assert.equal(await verifyCryptographicEvidence(evidence,{documentHash,signerIdentityType:"email-link",signerIdentityHash:signer.emailHash,publicKey:key.publicKey}),true);
  assert.equal(await verifyCryptographicEvidence(evidence,{documentHash,signerIdentityType:"email-link",signerIdentityHash:"c".repeat(64),publicKey:key.publicKey}),false);
  assert.equal(await verifyCryptographicEvidence(evidence,{documentHash:await sha256Hex("tampered-pdf"),signerIdentityType:"email-link",signerIdentityHash:signer.emailHash,publicKey:key.publicKey}),false);
});

test("email signer key refuses a payload for a different assignment",async()=>{
  const ctx=buildEsignContext({env:{DRIVE_MOCK:"false",ESIGN_DO:durableObjectNamespace()},verifyUser:async()=>null,sendInvitation:async()=>{},logger:{error(){}}});
  const signer={envelopeId:"ENV-bound",id:"S1",identityType:"email-link",emailHash:"d".repeat(64)};
  const key=await ctx.crypto.keyProvider.getSignerKeyForSigner(signer);
  const payload=buildCanonicalSigningPayload({
    envelopeId:"ENV-bound",signerId:"S2",signerIdentityType:"email-link",signerIdentityHash:signer.emailHash,
    documentHash:await sha256Hex("doc"),signatureHash:await sha256Hex("sig"),signatureType:"typed",
    signedAt:"2026-11-16T15:00:00.000Z",chainHead:await sha256Hex("chain"),keyId:key.keyId,
  });
  await assert.rejects(()=>key.signCanonicalPayload(payload),/could not seal|identity mismatch/i);
});
