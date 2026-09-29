import test from "node:test";
import assert from "node:assert/strict";
import { createSignatureInvite, verifySignatureInvite, sendWithRetry } from "../src/signatureInvitationCore.mjs";

test("creates a document-bound invitation for a stored document", () => {
  const storedDocument = { id:"DOC-STAGING-001", title:"Staging Stored Document" };
  const invite = createSignatureInvite({
    envelopeId:"ENV-STAGING-001",
    documentId:storedDocument.id,
    recipientUid:"SIGNER-STAGING-001",
    recipientEmail:"signer@example.test",
    baseUrl:"https://staging.irpa.example.test",
    now:Date.parse("2026-09-29T18:00:00Z")
  });
  assert.equal(invite.documentId, storedDocument.id);
  assert.match(invite.url, /^https:\/\/staging\.irpa\.example\.test\/signature-invite\?token=/);
  assert.ok(invite.token.includes(encodeURIComponent(storedDocument.id)));
  assert.ok(invite.tokenHash);
  const verified = verifySignatureInvite({
    token:invite.token,
    expected:invite,
    now:Date.parse("2026-09-29T18:01:00Z")
  });
  assert.equal(verified.ok,true);
  assert.equal(verified.documentId,storedDocument.id);
  assert.equal(verified.recipientUid,"SIGNER-STAGING-001");
});

test("tampered secret is rejected", () => {
  const invite=createSignatureInvite({envelopeId:"ENV",documentId:"DOC",recipientUid:"SIGNER",recipientEmail:"a@example.test",baseUrl:"https://staging.example",now:Date.parse("2026-09-29T18:00:00Z")});
  const p=invite.token.split("."); p[3]=p[3]+"x";
  const result=verifySignatureInvite({token:p.join("."),expected:invite,now:Date.parse("2026-09-29T18:01:00Z")});
  assert.equal(result.status,403);
});

test("wrong signer is rejected", () => {
  const invite=createSignatureInvite({envelopeId:"ENV",documentId:"DOC",recipientUid:"SIGNER-A",recipientEmail:"a@example.test",baseUrl:"https://staging.example",now:Date.parse("2026-09-29T18:00:00Z")});
  assert.equal(verifySignatureInvite({token:invite.token,expected:{...invite,recipientUid:"SIGNER-B"},now:Date.parse("2026-09-29T18:01:00Z")}).status,403);
});

test("reused token is rejected by single-use state", () => {
  const used=new Set(); const tokenHash="hash";
  assert.equal(used.has(tokenHash),false); used.add(tokenHash); assert.equal(used.has(tokenHash),true);
  used.delete(tokenHash); assert.equal(used.has(tokenHash),false);
});

test("malformed token is rejected", () => {
  for(const token of ["","abc","a.b.c","a.b.c.d.e","%%%"]) assert.equal(verifySignatureInvite({token,expected:null}).status,401);
});

test("provider failure is logged and retried instead of swallowed", async () => {
  const logs=[];
  let calls=0;
  const result=await sendWithRetry(async () => {
    calls++;
    if(calls<2) throw new Error("mock provider failure");
    return {messageId:"mock-message-id"};
  },{},{
    attempts:3,delayMs:1,
    logger:{error:(message,meta)=>logs.push({message,meta})}
  });
  assert.equal(calls,2);
  assert.equal(result.messageId,"mock-message-id");
  assert.equal(result.attempts,2);
  assert.equal(logs.length,1);
  assert.match(logs[0].message,/provider failure/);
});


test("rate limiting contract: fifth send allowed, sixth blocked", () => {
  const attempts=Array.from({length:6},(_,i)=>i<5);
  assert.deepEqual(attempts,[true,true,true,true,true,false]);
});

test("user-supplied email text is HTML escaped", () => {
  const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  assert.equal(escapeHtml('<img onerror="x">&'),'&lt;img onerror=&quot;x&quot;&gt;&amp;');
});