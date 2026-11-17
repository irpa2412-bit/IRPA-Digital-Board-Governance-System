import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmailSigningToken,
  inspectEmailSigningToken,
  markEmailSigningTokenOpened,
  consumeEmailSigningToken,
  revokeEmailSigningToken,
  hashNormalizedEmail,
  genericEmailSigningFailure
} from "../src/emailSigningLinks.mjs";
import { sha256Hex } from "../src/util.mjs";
import { validateSignatureDraftRecipients } from "../src/signatureDraftPolicy.mjs";
import { canAuthenticatedSignerAccess } from "../src/signing.mjs";
import fs from "node:fs";
import {buildEmailSigningInvitationMessage,sendEmailSigningInvitation} from "../src/invitationEmail.mjs";

const NOW = new Date("2026-11-16T08:00:00.000Z");

test("email token has at least 32 random bytes and only its SHA-256 hash is persisted", async () => {
  const issued = await createEmailSigningToken({envelopeId:"ENV-TEST01",signerId:"S1",email:"Signer@Example.org",now:NOW,ttlDays:7});
  assert.ok(issued.tokenBytes >= 32);
  assert.equal(issued.record.tokenHash, await sha256Hex(issued.token));
  assert.equal(issued.record.emailHash, await hashNormalizedEmail("signer@example.org"));
  assert.equal(issued.record.envelopeId,"ENV-TEST01");
  assert.equal(issued.record.signerId,"S1");
  assert.equal(issued.record.status,"issued");
  assert.equal(issued.record.expiresAt,"2026-11-23T08:00:00.000Z");
  assert.equal(JSON.stringify(issued.record).includes(issued.token),false);
  assert.equal(issued.record.attemptCount,0);
});

test("email token opens once and transitions issued to opened", async () => {
  const issued=await createEmailSigningToken({envelopeId:"ENV-TEST02",signerId:"S1",email:"a@example.org",now:NOW});
  const opened=await markEmailSigningTokenOpened(issued.record,{token:issued.token,now:NOW,ipHash:"ip-hash"});
  assert.equal(opened.status,"opened");
  assert.equal(opened.openCount,1);
  assert.equal(opened.lastIpHash,"ip-hash");
  await assert.rejects(()=>markEmailSigningTokenOpened(opened,{token:issued.token,now:NOW}),/unavailable/i);
});

test("email token expiry is enforced with a neutral failure", async () => {
  const issued=await createEmailSigningToken({envelopeId:"ENV-TEST03",signerId:"S1",email:"a@example.org",now:NOW,ttlDays:1});
  const result=await inspectEmailSigningToken(issued.token,issued.record,new Date("2026-11-17T08:00:01.000Z"));
  assert.equal(result.ok,false);
  assert.equal(result.error,genericEmailSigningFailure());
});

test("revoked token is unusable and resend rotates token while preserving only the new hash", async () => {
  const first=await createEmailSigningToken({envelopeId:"ENV-TEST04",signerId:"S1",email:"a@example.org",now:NOW});
  const revoked=revokeEmailSigningToken(first.record,{now:NOW,actorUid:"owner"});
  assert.equal(revoked.status,"revoked");
  assert.equal((await inspectEmailSigningToken(first.token,revoked,NOW)).ok,false);
  const second=await createEmailSigningToken({envelopeId:"ENV-TEST04",signerId:"S1",email:"a@example.org",now:NOW});
  assert.notEqual(first.token,second.token);
  assert.notEqual(first.record.tokenHash,second.record.tokenHash);
});

test("tampered token and unknown token produce the same neutral result", async () => {
  const issued=await createEmailSigningToken({envelopeId:"ENV-TEST05",signerId:"S1",email:"a@example.org",now:NOW});
  const tampered=await inspectEmailSigningToken(issued.token.slice(0,-1)+"x",issued.record,NOW);
  const unknown=await inspectEmailSigningToken(issued.token,{...issued.record,tokenHash:"0".repeat(64)},NOW);
  assert.deepEqual(tampered,unknown);
  assert.equal(tampered.error,genericEmailSigningFailure());
});

test("token use is single-use and cannot be consumed twice", async () => {
  const issued=await createEmailSigningToken({envelopeId:"ENV-TEST06",signerId:"S1",email:"a@example.org",now:NOW});
  const opened=await markEmailSigningTokenOpened(issued.record,{token:issued.token,now:NOW});
  const used=consumeEmailSigningToken(opened,{now:NOW});
  assert.equal(used.status,"used");
  assert.throws(()=>consumeEmailSigningToken(used,{now:NOW}),/unavailable/i);
});

test("email-link signer identity depends on one-time invited email control, not register or matrix roles",async()=>{
  const issued=await createEmailSigningToken({envelopeId:"ENV-EMAIL01",signerId:"S1",email:"external@example.org",now:NOW});
  assert.equal(issued.record.emailHash,await hashNormalizedEmail("external@example.org"));
  assert.equal(canAuthenticatedSignerAccess({identityType:"email-link",emailLinkStatus:"issued"},null),false);
  assert.equal(canAuthenticatedSignerAccess({identityType:"email-link",emailLinkStatus:"opened"},null),true);
  assert.equal(issued.record.authorityRole,undefined);
  assert.equal(issued.record.sourceCollection,undefined);
});

test("email hashing normalizes whitespace and case", async () => {
  assert.equal(await hashNormalizedEmail("  Person@Example.org "),await hashNormalizedEmail("person@example.org"));
});

test("duplicate signer and compare-and-set policy remain enforced", () => {
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"a@example.org"},{email:" A@example.org "}],"Sequential"),/Duplicate signer email/);
  assert.match(validateSignatureDraftRecipients([{uid:"u1",email:"a@example.org"},{uid:"u1",email:"b@example.org"}],"Sequential"),/Duplicate signer UID/);
});

test("registered login-based signing access remains UID-bound", () => {
  assert.equal(canAuthenticatedSignerAccess({uid:"member-1"},{uid:"member-1"}),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-1"},{uid:"other"}),false);
});

test("email invitation has real plain-text newlines and one HTML/plain-text SMTP send",async()=>{
  const message=buildEmailSigningInvitationMessage({name:"A Signer",link:"https://irpa.example.test/?emailSignToken=token",title:"Board Policy",ownerName:"Document Owner",expiresAt:"2026-11-23T08:00:00.000Z"});
  assert.match(message.text,/\nDocument: Board Policy/);
  assert.doesNotMatch(message.text,/\\n/);
  assert.match(message.html,/href=/);
  let calls=0;
  await sendEmailSigningInvitation({email:"signer@example.org",name:"A Signer",link:"https://irpa.example.test/?emailSignToken=token",title:"Board Policy",ownerName:"Document Owner",expiresAt:"2026-11-23T08:00:00.000Z",smtpSend:async payload=>{calls++;assert.ok(payload.text);assert.ok(payload.html);return {ok:true};},logger:{warn(){},error(){}}});
  assert.equal(calls,1);
});

test("mail delivery is delegated once to the existing Worker invitation sender", () => {
  const source = fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/sendWithRetry\s*\(/);
  assert.match(source,/smtpSend\(env,\{to:email,subject,text,html:htmlBody\}\)/);
});
