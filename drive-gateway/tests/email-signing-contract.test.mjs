import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  issueEmailSigningLink, inspectEmailSigningLink, createFreshSigningSession,
  canResendEmailSigningLink, reserveEmailSigningResend, rollbackEmailSigningResend,
  commitEmailSigningResend, updateEmailSignerContact, markEmailSignerSigned, maskEmailForConfirmation,
  formatEmailLinkExpiryEAT, EMAIL_SIGNING_ALREADY_SIGNED, EMAIL_SIGNING_RESEND_STATUSES
} from "../src/emailSigning/index.mjs";
import { inspectEmailSigningToken } from "../src/emailSigningLinks.mjs";
import { resendAllUnsignedInvitations, resendInvitation, updateSignerContact, chainEvents } from "../src/signing.mjs";
import { sha256Hex } from "../src/util.mjs";

const NOW = new Date("2026-11-20T17:00:00.000Z");
const EXPIRY = "2026-11-27T17:00:00.000Z";

async function fixture() {
  const issued = await issueEmailSigningLink({
    envelopeId: "ENV-CONTRACT01", signerId: "S1", email: "signer@example.org",
    now: NOW, expiresAt: EXPIRY, secret: "a".repeat(64)
  });
  const envelope = { id: "ENV-CONTRACT01", status: "Sent", expiresAt: EXPIRY, emailSigningModule: "v2" };
  const signer = {
    id: "S1", email: "signer@example.org", name: "Signer One", status: "Pending",
    identityType: "email-link", tokenHash: issued.record.tokenHash,
    emailHash: issued.record.emailHash, emailLinkStatus: "issued",
    emailLinkExpiresAt: EXPIRY, emailLinkTokenHistory: [], roleAssignments: [{ role: "Chair" }],
    fields: [{ fieldId: "F1", type: "Signature" }]
  };
  return { issued, envelope, signer };
}

test("one reusable invitation survives preview, close, reopen and a second device", async () => {
  const f = await fixture();
  const before = structuredClone(f.signer);
  const first = await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, ...f, now: NOW });
  assert.equal(first.ok, true);
  assert.deepEqual(f.signer, before, "read-only preview does not mutate signer state");
  const session1 = createFreshSigningSession({ envelopeId: f.envelope.id, signerId: "S1", now: NOW, linkExpiresAt: EXPIRY });
  f.signer.emailLinkSessionHash = await sha256Hex(session1.secret);
  f.signer.emailLinkSessionStatus = "active";
  f.signer.emailLinkSessionExpiresAt = session1.expiresAt;
  assert.equal((await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${session1.secret}`, ...f, now: NOW })).tokenKind, "session");
  const session2 = createFreshSigningSession({ envelopeId: f.envelope.id, signerId: "S1", now: new Date(NOW.getTime()+1000), linkExpiresAt: EXPIRY });
  f.signer.emailLinkSessionHash = await sha256Hex(session2.secret);
  f.signer.emailLinkSessionExpiresAt = session2.expiresAt;
  await assert.rejects(
    () => inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${session1.secret}`, ...f, now: NOW }),
    /unavailable|expired/i
  );
  assert.equal((await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, ...f, now: NOW })).tokenKind, "invitation");
  assert.notEqual(session1.token, session2.token, "a second device/open receives a fresh isolated session");
});

test("link preview is read-only and the explicit open creates a fresh session", async () => {
  const f = await fixture();
  const snapshot = structuredClone(f.signer);
  const preview = await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, ...f, now: NOW });
  assert.equal(preview.tokenKind, "invitation");
  assert.deepEqual(f.signer, snapshot);
  const opened = createFreshSigningSession({ envelopeId: f.envelope.id, signerId: "S1", now: NOW, linkExpiresAt: EXPIRY });
  assert.ok(opened.token);
  assert.equal(f.signer.emailLinkStatus, "issued", "opening does not consume the reusable invitation");
});

test("after signing, the same invitation reports the exact already-signed message", async () => {
  const f = await fixture();
  Object.assign(f.signer, markEmailSignerSigned(f.signer, NOW));
  await assert.rejects(
    () => inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, ...f, now: NOW }),
    error => error.message === EMAIL_SIGNING_ALREADY_SIGNED
  );
});

test("signing one position does not invalidate another position's independent link", async () => {
  const f = await fixture();
  const second = await issueEmailSigningLink({ envelopeId: f.envelope.id, signerId: "S2", email: "signer@example.org", now: NOW, expiresAt: EXPIRY, secret: "b".repeat(64) });
  const signer2 = { ...f.signer, id: "S2", tokenHash: second.record.tokenHash, emailLinkStatus: "issued", status: "Pending" };
  Object.assign(f.signer, markEmailSignerSigned(f.signer, NOW));
  await assert.rejects(() => inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, envelope: f.envelope, signer: f.signer, now: NOW }), error => error.message === EMAIL_SIGNING_ALREADY_SIGNED);
  assert.equal((await inspectEmailSigningLink({ token: `${f.envelope.id}.S2.${second.token}`, envelope: f.envelope, signer: signer2, now: NOW })).ok, true);
});

test("resend is allowed for all seven required unsigned statuses", () => {
  const f = { envelope: { id: "ENV-1", status: "Sent" }, signer: { id: "S1", status: "Pending" } };
  for (const status of EMAIL_SIGNING_RESEND_STATUSES) {
    f.signer.emailLinkStatus = status;
    assert.equal(canResendEmailSigningLink(f.envelope, f.signer), true, status);
  }
});

test("resend is blocked only after signing or a completed/cancelled envelope", () => {
  const signer = { id: "S1", status: "Pending" };
  assert.equal(canResendEmailSigningLink({ status: "Sent" }, signer), true);
  assert.equal(canResendEmailSigningLink({ status: "Completed" }, signer), false);
  assert.equal(canResendEmailSigningLink({ status: "Cancelled" }, signer), false);
  assert.equal(canResendEmailSigningLink({ status: "Sent" }, { ...signer, status: "Signed" }), false);
});

test("failed SMTP delivery rolls back only the reservation and preserves the old link", async () => {
  const f = await fixture();
  const oldHash = f.signer.tokenHash;
  const reserved = reserveEmailSigningResend(f.signer, "attempt-1", NOW);
  const rolledBack = rollbackEmailSigningResend(reserved, "attempt-1");
  assert.equal(rolledBack.tokenHash, oldHash);
  assert.equal(rolledBack.emailLinkStatus, "issued");
  assert.equal(rolledBack.resendAttempt, undefined);
  assert.equal((await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, envelope: f.envelope, signer: rolledBack, now: NOW })).ok, true);
});

test("accepted SMTP delivery replaces the old link only after acceptance", async () => {
  const f = await fixture();
  const reserved = reserveEmailSigningResend(f.signer, "attempt-2", NOW);
  const newLink = await issueEmailSigningLink({ envelopeId: f.envelope.id, signerId: "S1", email: f.signer.email, now: NOW, expiresAt: EXPIRY, secret: "c".repeat(64) });
  const committed = await commitEmailSigningResend(reserved, { attemptId: "attempt-2", tokenHash: newLink.record.tokenHash, expiresAt: EXPIRY, now: NOW, emailHash: newLink.record.emailHash });
  assert.equal(committed.tokenHash, newLink.record.tokenHash);
  assert.equal(committed.emailLinkTokenHistory.at(-1).status, "replaced");
  await assert.rejects(() => inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, envelope: f.envelope, signer: committed, now: NOW }), /replaced/i);
  assert.equal((await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${newLink.token}`, envelope: f.envelope, signer: committed, now: NOW })).ok, true);
});

test("bulk resend can select every unsigned signer independently", () => {
  const envelope = { status: "Sent" };
  const signers = [{ id: "S1", status: "Pending" }, { id: "S2", status: "Pending" }, { id: "S3", status: "Signed" }];
  const eligible = signers.filter(signer => canResendEmailSigningLink(envelope, signer));
  assert.deepEqual(eligible.map(signer => signer.id), ["S1", "S2"]);
});

test("contact correction preserves signer ID and assigned fields and returns an audit event", async () => {
  const f = await fixture();
  const updated = await updateEmailSignerContact(f.signer, { email: "new@example.org", name: "Corrected Name", now: NOW });
  assert.equal(updated.signer.id, "S1");
  assert.deepEqual(updated.signer.fields, f.signer.fields);
  assert.deepEqual(updated.signer.roleAssignments, f.signer.roleAssignments);
  assert.equal(updated.signer.email, "new@example.org");
  assert.equal(updated.signer.name, "Corrected Name");
  assert.equal(updated.audit.type, "email_link.signer_contact_updated");
  assert.equal(updated.audit.fieldsPreserved, true);
});

test("configured expiry is enforced and is displayed in EAT", async () => {
  const f = await fixture();
  await assert.rejects(() => inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, ...f, now: new Date("2026-11-28T00:00:00.000Z") }), /expired/i);
  assert.match(formatEmailLinkExpiryEAT(EXPIRY), /EAT$/);
});

test("legacy single-use token state is rejected by the reusable-link contract", async () => {
  const f = await fixture();
  const legacyRecord = { tokenHash: await sha256Hex(f.issued.token), status: "opened" };
  assert.equal((await inspectEmailSigningToken(f.issued.token, legacyRecord, NOW)).ok, false);
  assert.equal((await inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, ...f, now: NOW })).ok, true);
});


async function resendContext(signers,{failMail=false}={}){
  const sent=[];
  let record={
    _v:1,id:"ENV-BULK01",createdBy:"owner-uid",status:"Sent",emailSigningModule:"v2",
    signingMode:"Sequential",title:"Contract document",ownerName:"Owner",
    events:await chainEvents([],{type:"envelope.created",at:NOW.toISOString(),actor:"owner-uid"}),
    signers:signers.map((signer,index)=>({
      id:signer.id||"S"+(index+1),email:signer.email||"signer"+index+"@example.org",
      emailHash:signer.emailHash||"e".repeat(64),name:signer.name||"Signer "+index,
      identityType:"email-link",status:signer.status||"Pending",order:signer.order||index+1,
      tokenHash:signer.tokenHash||String(index+1).repeat(64).slice(0,64),
      emailLinkStatus:signer.emailLinkStatus||"issued",emailLinkTokenHistory:[],
      invitation:"Sent",roleAssignments:[{role:"Signer"}],fields:[{fieldId:"F"+index,type:"Signature"}]
    }))
  };
  const ctx={
    meta:{
      get:async(collection,id)=>collection==="envelopes"&&id===record.id?structuredClone(record):null,
      update:async(collection,id,patch,{ifVersion})=>{
        assert.equal(collection,"envelopes");assert.equal(id,record.id);assert.equal(ifVersion,record._v);
        record={...record,...structuredClone(patch),_v:record._v+1};
      }
    },
    now:()=>new Date(NOW),config:{appUrl:"https://irpa.example.org",emailLinkTtlDays:7,ttlDays:14},
    sendInvitation:async message=>{if(failMail){const error=new Error("IRPA SMTP error 550");error.stageCode="SUBMIT";throw error;}sent.push(message);return{ok:true};},
    logger:{error(){}}
  };
  return{ctx,sent,get record(){return record;}};
}

test("bulk resend delivers a separate replacement link for every unsigned signer in all seven required states",async()=>{
  const statuses=["invited","opened","expired","replaced","revoked","send failed","signing interrupted"];
  const f=await resendContext(statuses.map((status,index)=>({id:"S"+(index+1),email:"same@example.org",emailLinkStatus:status})).concat([{id:"S8",email:"signed@example.org",status:"Signed",emailLinkStatus:"used"}]));
  const result=await resendAllUnsignedInvitations(f.ctx,{uid:"owner-uid",email:"owner@example.org"},f.record.id);
  assert.equal(result.attempted,7);assert.equal(result.sent,7);assert.equal(result.failed,0);assert.equal(f.sent.length,7);
  assert.equal(new Set(f.sent.map(item=>item.link)).size,7,"same email in different signer positions gets independent links");
  const saved=await f.ctx.meta.get("envelopes",f.record.id);
  for(let index=0;index<7;index++)assert.equal(saved.signers[index].emailLinkStatus,"issued",statuses[index]);
  assert.equal(saved.signers[7].emailLinkStatus,"used");
});

test("actual resend is blocked after signer completion",async()=>{
  const f=await resendContext([{id:"S1",status:"Signed",emailLinkStatus:"used"}]);
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",email:"owner@example.org"},f.record.id,"S1"),error=>error.status===409&&/completed signing/.test(error.message));
  assert.equal(f.sent.length,0);
});
test("actual resend failure preserves the previous token hash and exposes the SMTP stage",async()=>{
  const f=await resendContext([{id:"S1",email:"one@example.org",emailLinkStatus:"send failed"}],{failMail:true});
  const oldHash=f.record.signers[0].tokenHash;
  const result=await resendAllUnsignedInvitations(f.ctx,{uid:"owner-uid",email:"owner@example.org"},f.record.id);
  assert.equal(result.failed,1);
  assert.equal(result.results[0].stageCode,"SUBMIT");
  const saved=await f.ctx.meta.get("envelopes",f.record.id);
  assert.equal(saved.signers[0].tokenHash,oldHash);
  assert.equal(saved.signers[0].resendAttempt,undefined);
  assert.deepEqual(saved.signers[0].resendAttempts,[],"failed resend releases only its own reservation");
  assert.equal(saved.events.at(-1).type,"invitation.resend.failed");
  assert.equal(saved.events.at(-1).stageCode,"SUBMIT");
});

test("actual contact correction retains signer ID and field assignments and appends an audit event",async()=>{
  const f=await resendContext([{id:"S1",email:"one@example.org"}]);
  const before=(await f.ctx.meta.get("envelopes",f.record.id)).signers[0];
  const result=await updateSignerContact(f.ctx,{uid:"owner-uid",email:"owner@example.org"},f.record.id,"S1",{email:"corrected@example.org",name:"Corrected Signer"});
  const saved=await f.ctx.meta.get("envelopes",f.record.id);
  assert.equal(result.signerId,"S1");
  assert.equal(saved.signers[0].id,before.id);
  assert.equal(saved.signers[0].email,"corrected@example.org");
  assert.deepEqual(saved.signers[0].fields,before.fields);
  assert.deepEqual(saved.signers[0].roleAssignments,before.roleAssignments);
  assert.equal(saved.events.at(-1).type,"email_link.signer_contact_updated");
});


test("a link cannot be transferred to another envelope or signer ID", async () => {
  const f = await fixture();
  await assert.rejects(() => inspectEmailSigningLink({
    token: `${f.envelope.id}.S1.${f.issued.token}`, envelope: f.envelope, signer: { ...f.signer, id: "S2" }, now: NOW
  }), /unavailable/i);
  await assert.rejects(() => inspectEmailSigningLink({
    token: `${f.envelope.id}.S1.${f.issued.token}`, envelope: { ...f.envelope, id: "ENV-OTHER" }, signer: f.signer, now: NOW
  }), /unavailable/i);
});

test("owner cancellation immediately invalidates an otherwise unexpired link", async () => {
  const f = await fixture();
  for (const status of ["Voided", "Cancelled", "Canceled"]) {
    await assert.rejects(
      () => inspectEmailSigningLink({ token: `${f.envelope.id}.S1.${f.issued.token}`, envelope: { ...f.envelope, status }, signer: f.signer, now: NOW }),
      /no longer active/i
    );
  }
});

test("parallel resend reservations do not block unsigned signers", () => {
  const f = { id: "S1", status: "Pending" };
  const one = reserveEmailSigningResend(f, "attempt-one", NOW);
  const two = reserveEmailSigningResend(one, "attempt-two", new Date(NOW.getTime()+1));
  assert.deepEqual(two.resendAttempts.map(item => item.id), ["attempt-one", "attempt-two"]);
  const rollback = rollbackEmailSigningResend(two, "attempt-one");
  assert.deepEqual(rollback.resendAttempts.map(item => item.id), ["attempt-two"]);
});

test("owner/admin SMTP self-check remains protected by the existing Worker route", () => {
  const router = fs.readFileSync(new URL("../src/router.mjs", import.meta.url), "utf8");
  const diagnostics = fs.readFileSync(new URL("../src/smtpDiagnostics.mjs", import.meta.url), "utf8");
  assert.ok(router.includes("/api/sign/smtp-selfcheck"));
  assert.ok(router.includes("user.isAdmin!==true&&user.isOwner!==true"));
  assert.ok(diagnostics.includes('profile?.fields?.role?.stringValue==="Administrator"'));
});


test("v2 invitation copy and Worker routes describe a reusable, signer-scoped link", () => {
  const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const signing = fs.readFileSync(new URL("../src/signing.mjs", import.meta.url), "utf8");
  assert.ok(worker.includes("Your link is reusable"));
  assert.ok(worker.includes("Previewing the link does not consume it"));
  assert.ok(worker.includes("reopen the same email link"));
  assert.ok(worker.includes("previewGatewayEmailSigning"));
  assert.ok(worker.includes("openGatewayEmailSigning"));
  assert.ok(signing.includes('emailSigningModule=EMAIL_SIGNING_REBUILD_ENABLED?"v2":"legacy"'));
  assert.ok(signing.includes('emailSigningModule==="v2"'));
});


test("resend confirmation masks the recipient and formats expiry in EAT", () => {
  assert.equal(maskEmailForConfirmation("board.secretary@example.org"), "bo***@example.org");
  assert.match(formatEmailLinkExpiryEAT(EXPIRY), /EAT$/);
});
