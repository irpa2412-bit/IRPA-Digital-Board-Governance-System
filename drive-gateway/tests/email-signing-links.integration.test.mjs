import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {createEnvelope,openEmailSigning,requestEmailSigningCode,confirmEmailSigningCode,getSigningPdf,resendInvitation,revokeInvitation,changeSignerEmail,remindInvitation} from "../src/signing.mjs";
import {sha256Hex} from "../src/util.mjs";
import {genericEmailSigningFailure} from "../src/emailSigningLinks.mjs";
import {PDFDocument} from "pdf-lib";
import {openSigning,sign,declineSigning,voidEnvelope} from "../src/signing.mjs";
import {route} from "../src/router.mjs";

const NOW=new Date("2026-11-16T08:00:00.000Z");
async function fixture({failMail=false,signers=null}={}) {
  const sent=[],verificationCodes=[],kvStore=new Map();
  const kv={get:async key=>kvStore.get(key)||null,put:async(key,value)=>{kvStore.set(key,value);},delete:async key=>{kvStore.delete(key);}};
  let now=NOW;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7",DRIVE_KV:kv},
    now:()=>new Date(now),
    verifyUser:async()=>null,
    sendInvitation:async message=>{sent.push(message);if(failMail)throw new Error("SMTP rejected");},
    sendEmailVerificationCode:async message=>{verificationCodes.push(message);},
    logger:{error(){}}
  });
  const sourcePdf=await PDFDocument.create();sourcePdf.addPage([595.28,841.89]);const bytes=await sourcePdf.save();
  const source=await ctx.storage.put({path:"source/email-link.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-EMAIL-"+Math.random().toString(16).slice(2,10);
  await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"email-link.pdf",title:"Email Link Governance Instrument",classification:"Restricted"});
  ctx.allowReturnTokens=true;
  const signerInputs=signers||[{identityType:"email-link",email:"Board.Secretary@example.org",name:"Client supplied name",title:"Board Secretary",routingPosition:1}];
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{documentId,externalReference:"IRPA-EXT-"+Math.random().toString(16).slice(2,10),archives:["board-governance"],signingMode:"Sequential",signers:signerInputs,returnTokens:true});
  const envelope=await ctx.meta.get("envelopes",created.envelopeId);
  const token=sent[0]?new URL(sent[0].link).searchParams.get("emailSignToken"):created.tokens?.[0];
  return {ctx,sent,verificationCodes,kvStore,created,envelope,tokens:created.tokens||[],token,now:value=>{now=value}};
}

test("invalid token failures are rate-limited by token and IP with one neutral response",async()=>{
  const f=await fixture();
  const repeated="ENV-UNKNOWN.S1."+"a".repeat(64);
  let message="";
  for(let index=0;index<8;index++){
    await assert.rejects(()=>openEmailSigning(f.ctx,repeated,"198.51.100.21"),error=>{message=error.message;return error.message===genericEmailSigningFailure();});
  }
  await assert.rejects(()=>openEmailSigning(f.ctx,repeated,"198.51.100.21"),error=>error.message===genericEmailSigningFailure());
  for(let index=0;index<12;index++){
    const secret=index.toString(16).padStart(64,"0");
    await assert.rejects(()=>openEmailSigning(f.ctx,"ENV-UNKNOWN.S1."+secret,"198.51.100.21"),error=>error.message===genericEmailSigningFailure());
  }
  await assert.rejects(()=>openEmailSigning(f.ctx,"ENV-UNKNOWN.S1."+"f".repeat(64),"198.51.100.21"),error=>error.message===genericEmailSigningFailure());
  assert.equal(message,genericEmailSigningFailure());
});

test("signer-list mutations retain Firestore-style compare-and-set and UID duplicate protection",()=>{
  const source=fs.readFileSync(new URL("../src/signing.mjs",import.meta.url),"utf8");
  assert.match(source,/ctx\.meta\.update\("envelopes",id,patch,\{ifVersion:c\._v\}\)/);
  assert.match(source,/if\(uid&&seenUids\.has\(uid\)\)throw new HttpError\(400,"Duplicate signer UID\."/);
  assert.match(source,/if\(seenEmails\.has\(email\)\)throw new HttpError\(400,"Duplicate signer email\."/);
});

test("email-link signer is stored with token hash, email hash, expiry and issued status; mail is sent once",async()=>{
  const f=await fixture();
  const signer=f.envelope.signers[0];
  assert.equal(signer.identityType,"email-link");
  assert.equal(signer.emailLinkStatus,"issued");
  assert.equal(signer.emailLinkAttemptCount,0);
  assert.equal(signer.emailLinkOpenCount,0);
  assert.equal(signer.emailLinkExpiresAt,"2026-11-23T08:00:00.000Z");
  assert.equal(signer.tokenHash,await sha256Hex(f.token.split(".")[2]));
  assert.equal(signer.emailHash,await sha256Hex("board.secretary@example.org"));
  assert.equal(JSON.stringify(signer).includes(f.token.split(".")[2]),false);
  assert.equal(signer.authorityVerification,undefined);
  assert.equal(signer.name,"Client supplied name");
  assert.deepEqual(signer.declaredParticulars,{name:"Client supplied name",title:"Board Secretary"});
  assert.equal(f.sent.length,1);
  assert.match(f.sent[0].link,/emailSignToken=/);
  assert.match(f.sent[0].link,/\/\?emailSignToken=/);
});

test("email link opens once, changes status to opened and exposes only its controlled PDF",async()=>{
  const f=await fixture();
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.8");
  assert.equal(opened.ok,true);
  assert.equal(opened.title,"Email Link Governance Instrument");
  assert.equal(opened.ownerName,"Document Owner");
  assert.notEqual(opened.sessionToken,f.token,"the one-time invitation token must be replaced by a browser-session token");
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"opened");
  assert.equal(stored.signers[0].emailLinkOpenCount,1);
  assert.equal(stored.signers[0].tokenHash,await sha256Hex(opened.sessionToken.split(".")[2]));
  assert.notEqual(stored.signers[0].tokenHash,await sha256Hex(f.token.split(".")[2]));
  const pdf=await getSigningPdf(f.ctx,opened.sessionToken,null);
  assert.equal(pdf.fileName,"email-link.pdf");
  await assert.rejects(()=>openEmailSigning(f.ctx,f.token,"198.51.100.8"),error=>error.message===genericEmailSigningFailure());
  const resumed=await openEmailSigning(f.ctx,opened.sessionToken,"198.51.100.8");
  assert.equal(resumed.ok,true);
  assert.equal(resumed.sessionToken,opened.sessionToken);
  const resumedEnvelope=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(resumedEnvelope.signers[0].emailLinkOpenCount,1,"resuming the session must not redeem the invitation a second time");
});

test("no-session invitation opens only the email-code step and consumes the token after code confirmation",async()=>{
  const f=await fixture();
  const page=fs.readFileSync(new URL("../../src/pages/EmailSigningReadOnlyPage.jsx",import.meta.url),"utf8");
  assert.match(page,/Confirm your email/);
  assert.match(page,/Confirm email and continue/);
  const openResponse=await route(new Request("https://gateway.example.test/api/sign/email/open",{headers:{"x-signing-token":f.token}}),f.ctx);
  const openBody=await openResponse.json();
  assert.equal(openResponse.status,200);
  assert.equal(openBody.requiresEmailCode,true);
  assert.equal(f.verificationCodes.length,1);
  assert.match(f.verificationCodes[0].code,/^\d{6}$/);
  const before=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(before.signers[0].emailLinkStatus,"issued");
  const confirmResponse=await route(new Request("https://gateway.example.test/api/sign/email/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:f.token,code:f.verificationCodes[0].code})}),f.ctx);
  const confirmed=await confirmResponse.json();
  assert.equal(confirmResponse.status,200);
  assert.equal(confirmed.ok,true);
  assert.notEqual(confirmed.sessionToken,f.token);
  const after=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(after.signers[0].emailLinkStatus,"opened");
  const replay=await route(new Request("https://gateway.example.test/api/sign/email/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:f.token,code:f.verificationCodes[0].code})}),f.ctx);
  assert.equal(replay.status,404);
});

test("three owner-routed signers receive invitations stage by stage; early links cannot sign",async()=>{
  const f=await fixture({signers:[
    {identityType:"email-link",email:"one@example.org",name:"Signer One",routingPosition:1},
    {identityType:"email-link",email:"two@example.org",name:"Signer Two",routingPosition:2},
    {identityType:"email-link",email:"three@example.org",name:"Signer Three",routingPosition:3}
  ]});
  assert.equal(f.sent.length,1);
  assert.equal(f.envelope.signers[0].invitation,"Sent");
  assert.equal(f.envelope.signers[1].invitation,"Waiting");
  assert.equal(f.envelope.signers[2].invitation,"Waiting");
  const early=await route(new Request("https://gateway.example.test/api/sign/email/open",{headers:{"x-signing-token":f.tokens[1]}}),f.ctx);
  assert.equal(early.status,409);
  assert.match((await early.json()).error,/Not your turn yet/);
  const redeem=async token=>{await requestEmailSigningCode(f.ctx,token);const code=f.verificationCodes.at(-1).code;return confirmEmailSigningCode(f.ctx,token,code);};
  const first=await redeem(f.tokens[0]);
  await sign(f.ctx,{token:first.sessionToken,signature:{type:"typed",value:"Signer One"},declarations:{name:"Signer One"},consent:true,user:null});
  assert.equal(f.sent.length,2);
  const afterOne=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(afterOne.signers[1].emailLinkStatus,"issued");
  assert.equal(afterOne.signers[2].emailLinkStatus,"waiting");
  const secondToken=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  const second=await redeem(secondToken);
  await sign(f.ctx,{token:second.sessionToken,signature:{type:"typed",value:"Signer Two"},declarations:{name:"Signer Two"},consent:true,user:null});
  assert.equal(f.sent.length,3);
  const thirdToken=new URL(f.sent[2].link).searchParams.get("emailSignToken");
  const third=await redeem(thirdToken);
  const completed=await sign(f.ctx,{token:third.sessionToken,signature:{type:"typed",value:"Signer Three"},declarations:{name:"Signer Three"},consent:true,user:null});
  assert.equal(completed.completed,true);
  const final=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(final.status,"Completed");
  assert.deepEqual(final.signers.map(s=>s.routingPosition),[1,2,3]);
});

test("same-position signers are parallel and next position waits for every signer in the group",async()=>{
  const f=await fixture({signers:[
    {identityType:"email-link",email:"one@example.org",name:"Signer One",routingPosition:1},
    {identityType:"email-link",email:"two@example.org",name:"Signer Two",routingPosition:1},
    {identityType:"email-link",email:"three@example.org",name:"Signer Three",routingPosition:2}
  ]});
  assert.equal(f.sent.length,2);
  const first=await openEmailSigning(f.ctx,f.tokens[0]);
  await sign(f.ctx,{token:first.sessionToken,signature:{type:"typed",value:"Signer One"},declarations:{name:"Signer One"},consent:true,user:null});
  assert.equal(f.sent.length,2);
  const beforeSecond=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(beforeSecond.signers[2].emailLinkStatus,"waiting");
  const second=await openEmailSigning(f.ctx,f.tokens[1]);
  await sign(f.ctx,{token:second.sessionToken,signature:{type:"typed",value:"Signer Two"},declarations:{name:"Signer Two"},consent:true,user:null});
  assert.equal(f.sent.length,3);
  const afterSecond=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(afterSecond.signers[2].emailLinkStatus,"issued");
});

test("decline and owner void stop routing and do not release later invitations",async()=>{
  const declined=await fixture({signers:[
    {identityType:"email-link",email:"one@example.org",name:"Signer One",routingPosition:1},
    {identityType:"email-link",email:"two@example.org",name:"Signer Two",routingPosition:2}
  ]});
  const opened=await openEmailSigning(declined.ctx,declined.tokens[0]);
  await declineSigning(declined.ctx,{token:opened.sessionToken,reason:"I decline this request.",user:null});
  assert.equal(declined.sent.length,1);
  assert.equal((await declined.ctx.meta.get("envelopes",declined.created.envelopeId)).status,"Declined");
  const voided=await fixture({signers:[
    {identityType:"email-link",email:"one@example.org",name:"Signer One",routingPosition:1},
    {identityType:"email-link",email:"two@example.org",name:"Signer Two",routingPosition:2}
  ]});
  await voidEnvelope(voided.ctx,{uid:"owner-uid",isAdmin:false},voided.created.envelopeId,"Owner voided the test envelope.");
  assert.equal(voided.sent.length,1);
  const saved=await voided.ctx.meta.get("envelopes",voided.created.envelopeId);
  assert.equal(saved.status,"Voided");
  assert.equal(saved.signers[1].emailLinkStatus,"revoked");
});

test("expired, tampered, unknown and revoked links return the same neutral response",async()=>{
  const f=await fixture();
  const wrong=f.token.slice(0,-1)+(f.token.endsWith("0")?"1":"0");
  await assert.rejects(()=>openEmailSigning(f.ctx,wrong,"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  await assert.rejects(()=>openEmailSigning(f.ctx,"ENV-UNKNOWN.S1."+"a".repeat(64),"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  f.now(new Date("2026-11-23T08:00:01.000Z"));
  await assert.rejects(()=>openEmailSigning(f.ctx,f.token,"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("owner revoke invalidates a guest link; resend rotates token and revokes the previous hash",async()=>{
  const f=await fixture();
  const oldToken=f.token;
  const opened=await openEmailSigning(f.ctx,oldToken,"198.51.100.10");
  const oldSession=opened.sessionToken;
  await revokeInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  const revoked=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(revoked.signers[0].emailLinkStatus,"revoked");
  await assert.rejects(()=>openEmailSigning(f.ctx,oldToken,"198.51.100.10"));
  await assert.rejects(()=>getSigningPdf(f.ctx,oldSession,null));
  const resent=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(resent.deliveryStatus,"Sent");
  const newToken=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  assert.notEqual(newToken,oldToken);
  assert.notEqual(newToken,oldSession);
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(current.signers[0].emailLinkStatus,"issued");
  assert.equal(current.signers[0].emailLinkTokenHistory.at(-1).status,"revoked");
});


test("external email-link signer declares a required name and optional title without a Firebase UID",async()=>{
  const f=await fixture();
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.22");
  assert.equal(opened.ok,true);
  assert.equal(opened.signer.identityType,"email-link");
  assert.equal(opened.signer.authenticated,true);
  const signed=await sign(f.ctx,{
    token:opened.sessionToken,
    signature:{type:"typed",value:"Vendor Signer"},
    declarations:{name:"Vendor Signer"},
    consent:true,
    user:null
  });
  assert.equal(signed.completed,true);
  assert.equal(signed.status,"Completed");
  const completed=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(completed.signers[0].uid,null);
  assert.deepEqual(completed.signers[0].signerDeclarations,{name:"Vendor Signer",title:""});
  assert.equal(completed.signers[0].declarationDiscrepancy.detected,true);
  assert.deepEqual(completed.signers[0].declarationDiscrepancy.fields,["name"]);
  const pdf=await getSigningPdf(f.ctx,opened.sessionToken,null);
  assert.equal(pdf.fileName.includes("-signed-"),true);
  const replay=await sign(f.ctx,{token:opened.sessionToken,signature:{type:"typed",value:"Vendor Signer"},declarations:{name:"Vendor Signer"},consent:true,user:null});
  assert.equal(replay.idempotent,true,"a second submission must not create another signature");
});

test("email-link invitations do not require register, authority-matrix or Firebase UID matches",async()=>{
  const f=await fixture({authority:false});
  assert.equal(f.envelope.signers[0].identityType,"email-link");
  assert.equal(f.envelope.signers[0].uid,null);
  assert.equal(f.envelope.signers[0].emailLinkStatus,"issued");
  assert.equal(f.envelope.signers[0].authorityVerification,undefined);
});

test("duplicate email signer is refused and login-bound signing remains UID authenticated",async()=>{
  const f=await fixture();
  await assert.rejects(()=>createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org"},{documentId:f.envelope.documentId,archives:["board-governance"],signingMode:"Sequential",signers:[{email:"same@example.org",order:1},{email:"SAME@example.org",order:2}]}),/Duplicate signer email/);
  const {canAuthenticatedSignerAccess}=await import("../src/signing.mjs");
  assert.equal(canAuthenticatedSignerAccess({uid:"registered-uid"},{uid:"registered-uid"}),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"registered-uid"},{uid:"guest"}),false);
});


test("staging and production require email-link identity for every signer, retaining optional profile UID association",async()=>{
  const f=await fixture();
  const ctx={...f.ctx,env:{...f.ctx.env,IRPA_ENVIRONMENT:"staging"}};
  const owner={uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false};
  for(const signer of [
    {email:"member@example.org",uid:"registered-member-uid",name:"Registered Member"},
    {email:"member@example.org",uid:"registered-member-uid",identityType:"account",name:"Registered Member"},
    {email:"member@example.org",identityType:"other",name:"Invalid identity"}
  ]){
    await assert.rejects(
      ()=>createEnvelope(ctx,owner,{documentId:f.envelope.documentId,archives:["board-governance"],signingMode:"Sequential",signers:[signer]}),
      error=>error?.status===400&&error.message.includes("Every signer must use the invited email-link identity")
    );
  }
  const registered=await createEnvelope(ctx,owner,{documentId:f.envelope.documentId,archives:["board-governance"],signingMode:"Sequential",signers:[{email:"member@example.org",uid:"registered-member-uid",identityType:"email-link",name:"Registered Member"}]});
  assert.equal(registered.status,"Sent");
  const registeredSaved=await ctx.meta.get("envelopes",registered.envelopeId);
  assert.equal(registeredSaved.signers[0].uid,"registered-member-uid");
  assert.equal(registeredSaved.signers[0].identityType,"email-link");
  const guest=await createEnvelope(ctx,owner,{documentId:f.envelope.documentId,archives:["board-governance"],signingMode:"Sequential",signers:[{email:"guest@example.org",identityType:"email-link",name:"External Guest"}]});
  assert.equal(guest.status,"Sent");
  const guestSaved=await ctx.meta.get("envelopes",guest.envelopeId);
  assert.equal(guestSaved.signers[0].uid,null);
  assert.equal(guestSaved.signers[0].identityType,"email-link");
});

test("owner can change signer email before opening; old invitation token is revoked and a new link is issued",async()=>{
  const f=await fixture();
  const oldToken=f.token;
  const changed=await changeSignerEmail(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1",{email:"replacement@example.org",name:"Replacement Signer",title:"External Reviewer"});
  assert.equal(changed.emailChanged,true);
  const replacementToken=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  assert.notEqual(replacementToken,oldToken);
  await assert.rejects(()=>openEmailSigning(f.ctx,oldToken),error=>error.message===genericEmailSigningFailure());
  const saved=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(saved.signers[0].email,"replacement@example.org");
  assert.equal(saved.signers[0].name,"Replacement Signer");
  assert.equal(saved.signers[0].title,"External Reviewer");
  assert.equal(saved.signers[0].emailLinkStatus,"issued");
  assert.equal(saved.signers[0].emailLinkTokenHistory.at(-1).status,"revoked");
});

test("owner reminders are rate-limited to one per signer per hour",async()=>{
  const f=await fixture();
  const first=await remindInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(first.deliveryStatus,"Sent");
  await assert.rejects(()=>remindInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),error=>error.status===429&&/last hour/.test(error.message));
  const saved=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.ok(saved.signers[0].lastReminderAt);
});

test("email-link signer can revoke before submission and the session token is invalidated",async()=>{
  const f=await fixture();
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.23");
  const revoked=await declineSigning(f.ctx,{token:opened.sessionToken,reason:"Signer revoked before submission.",ip:"198.51.100.23",user:null});
  assert.equal(revoked.revoked,true);
  assert.equal(revoked.status,"Declined");
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.status,"Declined");
  assert.equal(stored.signers[0].status,"Declined");
  assert.equal(stored.signers[0].emailLinkStatus,"revoked");
  assert.equal(stored.signers[0].emailLinkTokenHistory.at(-1).status,"revoked_by_signer");
  assert.equal(stored.events.at(-1).type,"email_link.revoked_by_signer");
  await assert.rejects(()=>getSigningPdf(f.ctx,opened.sessionToken,null));
  await assert.rejects(()=>sign(f.ctx,{token:opened.sessionToken,signature:{type:"typed",value:"Signer"},declarations:{name:"Signer",title:"Officer"},consent:true,user:null}));
});
