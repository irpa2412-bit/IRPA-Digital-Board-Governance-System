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

test("wrong document token is denied", () => {
  const invite = createSignatureInvite({
    envelopeId:"ENV-STAGING-002",documentId:"DOC-A",recipientUid:"SIGNER-A",recipientEmail:"a@example.test",
    baseUrl:"https://staging.irpa.example.test",now:Date.parse("2026-09-29T18:00:00Z")
  });
  const forged = invite.token.replace(encodeURIComponent("DOC-A"),encodeURIComponent("DOC-B"));
  const result = verifySignatureInvite({token:forged,expected:invite,now:Date.parse("2026-09-29T18:01:00Z")});
  assert.equal(result.ok,false);
  assert.equal(result.status,403);
});

test("expired token is denied", () => {
  const now=Date.parse("2026-09-29T18:00:00Z");
  const invite=createSignatureInvite({
    envelopeId:"ENV-STAGING-003",documentId:"DOC-C",recipientUid:"SIGNER-C",recipientEmail:"c@example.test",
    baseUrl:"https://staging.irpa.example.test",now,ttlMs:60_000
  });
  const result=verifySignatureInvite({token:invite.token,expected:invite,now:now+61_000});
  assert.equal(result.ok,false);
  assert.equal(result.status,403);
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
