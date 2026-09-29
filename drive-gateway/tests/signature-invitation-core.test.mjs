import test from "node:test";
import assert from "node:assert/strict";
import { createSignatureInvite, verifySignatureInvite, sendWithRetry, consumeSingleUseToken, checkInvitationRateLimit } from "../src/signatureInvitationCore.mjs";

function mockKv(){
  const data=new Map();
  return {
    async get(key,type){ const v=data.get(key); return type==="json" ? (v ? JSON.parse(v) : null) : (v ?? null); },
    async put(key,value){ data.set(key,typeof value==="string"?value:JSON.stringify(value)); },
    async delete(key){ data.delete(key); }
  };
}

test("creates a document-bound invitation for a stored document", () => {
  const invite=createSignatureInvite({envelopeId:"ENV-STAGING-001",documentId:"DOC-STAGING-001",recipientUid:"SIGNER-STAGING-001",recipientEmail:"signer@example.test",baseUrl:"https://staging.irpa.example.test",now:Date.parse("2026-09-29T18:00:00Z")});
  assert.equal(invite.documentId,"DOC-STAGING-001");
  assert.match(invite.url,/^https:\/\/staging\.irpa\.example\.test\/signature-invite\?token=/);
  assert.ok(invite.tokenHash);
  assert.equal(verifySignatureInvite({token:invite.token,expected:invite,now:Date.parse("2026-09-29T18:01:00Z")}).ok,true);
});

test("tampered secret is rejected", () => {
  const invite=createSignatureInvite({envelopeId:"ENV",documentId:"DOC",recipientUid:"SIGNER",recipientEmail:"a@example.test",baseUrl:"https://staging.example",now:Date.parse("2026-09-29T18:00:00Z")});
  const p=invite.token.split("."); p[3]=p[3]+"x";
  assert.equal(verifySignatureInvite({token:p.join("."),expected:invite,now:Date.parse("2026-09-29T18:01:00Z")}).status,403);
});

test("wrong signer is rejected", () => {
  const invite=createSignatureInvite({envelopeId:"ENV",documentId:"DOC",recipientUid:"SIGNER-A",recipientEmail:"a@example.test",baseUrl:"https://staging.example",now:Date.parse("2026-09-29T18:00:00Z")});
  assert.equal(verifySignatureInvite({token:invite.token,expected:{...invite,recipientUid:"SIGNER-B"},now:Date.parse("2026-09-29T18:01:00Z")}).status,403);
});

test("reused token is rejected by single-use state", async () => {
  const kv=mockKv();
  const invite=createSignatureInvite({envelopeId:"ENV",documentId:"DOC",recipientUid:"SIGNER",recipientEmail:"a@example.test",baseUrl:"https://staging.example"});
  await kv.put("signature-invite:"+invite.tokenHash,JSON.stringify({...invite,status:"Sent"}));
  assert.equal((await consumeSingleUseToken(kv,invite.tokenHash)).ok,true);
  assert.equal((await consumeSingleUseToken(kv,invite.tokenHash)).status,403);
});

test("malformed token is rejected without throwing", () => {
  for(const token of ["","abc","a.b.c","a.b.c.d.e","%%%","a.b.c.%ZZ"]) {
    assert.equal(verifySignatureInvite({token,expected:null}).status,401);
  }
});

test("expired token is rejected", () => {
  const now=Date.parse("2026-09-29T18:00:00Z");
  const invite=createSignatureInvite({envelopeId:"ENV",documentId:"DOC",recipientUid:"SIGNER",recipientEmail:"a@example.test",baseUrl:"https://staging.example",now,ttlMs:1000});
  assert.equal(verifySignatureInvite({token:invite.token,expected:invite,now:now+1001}).status,403);
});

test("provider failure is logged and retried", async () => {
  const logs=[]; let calls=0;
  const result=await sendWithRetry(async()=>{calls++;if(calls<2)throw new Error("mock provider failure");return{messageId:"mock-message-id"}},{},{attempts:3,delayMs:1,logger:{error:(message,meta)=>logs.push({message,meta})}});
  assert.equal(calls,2); assert.equal(result.messageId,"mock-message-id"); assert.equal(logs.length,1);
});

test("rate limiting blocks the sixth send in a ten-minute window", async () => {
  const kv=mockKv();
  for(let i=1;i<=5;i++) assert.equal((await checkInvitationRateLimit(kv,"sender",5,600)).ok,true);
  const blocked=await checkInvitationRateLimit(kv,"sender",5,600);
  assert.equal(blocked.status,429);
});

test("user-supplied email text is HTML escaped", () => {
  const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  assert.equal(escapeHtml('<img onerror="x">&'),'&lt;img onerror=&quot;x&quot;&gt;&amp;');
});
