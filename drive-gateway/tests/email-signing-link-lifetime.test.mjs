import test from "node:test";
import assert from "node:assert/strict";
import {issueEmailSigningLink,inspectEmailSigningLink,createFreshSigningSession,commitEmailSigningResend} from "../src/emailSigning/index.mjs";
import {buildEmailSigningInvitationMessage} from "../src/invitationEmail.mjs";
import {sha256Hex} from "../src/util.mjs";

const now=new Date("2026-11-23T13:00:00.000Z");
const future=new Date("2028-11-23T13:00:00.000Z");

async function fixture({status="issued",envelopeStatus="Sent",signerStatus="Pending",sessionStatus=null,sessionHash=null,sessionExpiry=null}={}) {
 const issued=await issueEmailSigningLink({envelopeId:"ENV-LIFETIME-1",signerId:"S1",email:"signer@example.org",now,secret:"a".repeat(64)});
 return {issued,envelope:{id:"ENV-LIFETIME-1",status:envelopeStatus},signer:{id:"S1",status:signerStatus,tokenHash:issued.record.tokenHash,emailLinkStatus:status,emailLinkSessionStatus:sessionStatus,emailLinkSessionHash:sessionHash,emailLinkSessionExpiresAt:sessionExpiry}};
}

test("original invitation remains valid beyond the former 7-day expiry and has no expiry metadata",async()=>{
 const {issued,envelope,signer}=await fixture();
 signer.emailLinkExpiresAt="2026-11-30T13:00:00.000Z";
 signer.tokenExpiresAt=signer.emailLinkExpiresAt;
 const result=await inspectEmailSigningLink({token:`${envelope.id}.${signer.id}.${issued.token}`,envelope,signer,now:future});
 assert.equal(result.ok,true);
 assert.equal(result.expiry,null);
 assert.equal(issued.record.expiresAt,undefined);
});

test("legacy expired marker does not invalidate the current original invitation",async()=>{
 const {issued,envelope,signer}=await fixture({status:"expired"});
 signer.emailLinkExpiresAt="2026-11-30T13:00:00.000Z";
 const result=await inspectEmailSigningLink({token:`${envelope.id}.${signer.id}.${issued.token}`,envelope,signer,now:future});
 assert.equal(result.ok,true);
});

test("completed envelope restricts the original invitation to read-only access",async()=>{
 const {issued,envelope,signer}=await fixture({status:"opened",envelopeStatus:"Completed",signerStatus:"Signed"});
 const result=await inspectEmailSigningLink({token:`${envelope.id}.${signer.id}.${issued.token}`,envelope,signer,now:future});
 assert.equal(result.ok,true);
 assert.equal(result.tokenKind,"invitation");
});

test("temporary session expires independently while original invitation remains reusable",async()=>{
 const sessionSecret="b".repeat(64);
 const {issued,envelope,signer}=await fixture({sessionStatus:"active",sessionHash:await sha256Hex(sessionSecret),sessionExpiry:"2026-11-23T13:30:00.000Z"});
 const sessionToken=`${envelope.id}.${signer.id}.${sessionSecret}`;
 await assert.rejects(()=>inspectEmailSigningLink({token:sessionToken,envelope,signer,now:future}),error=>error.status===410);
 const original=await inspectEmailSigningLink({token:`${envelope.id}.${signer.id}.${issued.token}`,envelope,signer,now:future});
 assert.equal(original.ok,true);
});

test("fresh signing session receives its own 30-minute lifetime, not the invitation lifetime",()=>{
 const session=createFreshSigningSession({envelopeId:"ENV-LIFETIME-1",signerId:"S1",now,linkExpiresAt:"2026-11-23T13:05:00.000Z"});
 assert.equal(session.expiresAt,"2026-11-23T13:30:00.000Z");
});

test("successful resend rotates the invitation hash without adding a date expiry",async()=>{
 const {issued,envelope,signer}=await fixture();
 signer.resendAttempts=[{id:"attempt-1"}];
 const next=await commitEmailSigningResend(signer,{attemptId:"attempt-1",tokenHash:"c".repeat(64),now,emailHash:issued.record.emailHash});
 assert.equal(next.tokenHash,"c".repeat(64));
 assert.equal(next.emailLinkExpiresAt,null);
 assert.equal(next.tokenExpiresAt,null);
 assert.equal(next.emailLinkStatus,"issued");
 assert.equal(next.emailLinkTokenHistory[0].status,"replaced");
});

test("email invitation explicitly states that link remains available until completion or revocation",()=>{
 const message=buildEmailSigningInvitationMessage({name:"Signer",link:"https://irpa.example.test/?emailSignToken=token",title:"Board Minutes",ownerName:"IRPA"});
 assert.match(message.text,/no time-based expiry/i);
 assert.match(message.text,/until the envelope is completed/i);
 assert.match(message.text,/read-only access to the completed PDF/i);
 assert.doesNotMatch(message.text,/single-use|ask the document owner to resend/i);
});
