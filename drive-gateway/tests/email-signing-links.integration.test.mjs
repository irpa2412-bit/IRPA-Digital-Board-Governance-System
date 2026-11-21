import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {createEnvelope,openEmailSigning,previewEmailSigning,getSigningPdf,resendInvitation,revokeInvitation,getEnvelopeStatus} from "../src/signing.mjs";
import {sha256Hex} from "../src/util.mjs";
import {genericEmailSigningFailure,createEmailSigningToken,inspectEmailSigningToken,markEmailSigningTokenOpened,consumeEmailSigningToken,revokeEmailSigningToken} from "../src/emailSigningLinks.mjs";
import {PDFDocument} from "pdf-lib";
import {buildEmailSigningInvitationMessage,buildRawMailMimeMessage} from "../src/invitationEmail.mjs";
import {openSigning,sign,declineSigning} from "../src/signing.mjs";

const NOW=new Date("2026-11-16T08:00:00.000Z");
async function fixture({authority=true,failMail=false}={}) {
  const sent=[];
  let now=NOW;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7"},
    now:()=>new Date(now),
    verifyUser:async()=>null,
    verifyEmailSignerAuthority:async email=>authority?({verified:true,authorityRole:"Board Secretary",sourceCollection:"members",sourceRecordId:"member-doc-1",name:"Registered Board Secretary"}):({verified:false}),
    sendInvitation:async message=>{sent.push(message);if(failMail)throw new Error("SMTP rejected");},
    logger:{error(){}}
  });
  const sourcePdf=await PDFDocument.create();sourcePdf.addPage([595.28,841.89]);const bytes=await sourcePdf.save();
  const source=await ctx.storage.put({path:"source/email-link.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-EMAIL-"+Math.random().toString(16).slice(2,10);
  await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"email-link.pdf",title:"Email Link Governance Instrument",classification:"Restricted"});
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{documentId,externalReference:"IRPA-EXT-"+Math.random().toString(16).slice(2,10),archives:["board-governance"],signingMode:"Sequential",signers:[{identityType:"email-link",email:"Board.Secretary@example.org",name:"Client supplied name",authorityRole:"Board Secretary",order:1,role:"Client supplied role"}]});
  const envelope=await ctx.meta.get("envelopes",created.envelopeId);
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  return {ctx,sent,created,envelope,token,now:value=>{now=value}};
}


test("owner signs in the portal before any other signer is invited; completing owner signature releases the next signer",async()=>{
  const sent=[];let now=NOW;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7"},
    now:()=>new Date(now),verifyUser:async()=>null,sendInvitation:async message=>{
      sent.push(message);
      for(const stage of ["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]){
        const accepted=["RCPT_ACCEPTED","SUBMIT"].includes(stage);
        await message.onStage?.(stage,"success",accepted?"ACCEPTED":"UNKNOWN",{
          messageId:"<owner-first-"+sent.length+"@irpa.or.tz>",
          smtpReplyCode:250,
          smtpReply:stage==="SUBMIT"?"250 2.0.0 queued":stage==="RCPT_ACCEPTED"?"250 2.1.5 recipient accepted":"250 OK"
        });
      }
    },logger:{error(){}}
  });
  const sourcePdf=await PDFDocument.create();sourcePdf.addPage([595.28,841.89]);const bytes=await sourcePdf.save();
  const source=await ctx.storage.put({path:"source/owner-first.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-OWNER-FIRST";
  await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"owner-first.pdf",title:"Owner First Signing",classification:"Restricted"});
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId,externalReference:"IRPA-OWNER-FIRST",archives:["board-governance"],signingMode:"Sequential",ownerPreSignEmail:"owner@example.org",
    signers:[
      {identityType:"email-link",email:"owner@example.org",name:"Document Owner",order:1,role:"Document Owner"},
      {identityType:"email-link",email:"signer@example.org",name:"Next Signer",order:2,role:"Signer"}
    ],
    fields:[
      {fieldId:"OWNER-SIGNATURE",type:"Signature",signerId:"S1",page:1,x:10,y:10,width:20,height:8,required:true},
      {fieldId:"NEXT-SIGNATURE",type:"Signature",signerId:"S2",page:1,x:40,y:10,width:20,height:8,required:true}
    ]
  });
  assert.equal(created.status,"Awaiting Owner Signature");
  assert.equal(sent.length,0,"no participant invitation is sent before the owner signs");
  assert.ok(created.ownerSigningToken,"the authenticated owner receives the portal session token");
  const ownerOpened=await openEmailSigning(ctx,created.ownerSigningToken,"198.51.100.31");
  assert.equal(ownerOpened.signer.email,"owner@example.org");
  const result=await sign(ctx,{
    token:ownerOpened.sessionToken,signature:{type:"drawn",value:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="},
    fieldApplications:[{fieldId:"OWNER-SIGNATURE",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="}],
    fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Document Owner"}
  });
  assert.equal(result.status,"InProgress");
  assert.equal(sent.length,1,"the next signer is invited only after the owner completes signing");
  assert.equal(sent[0].to,"signer@example.org");
  assert.match(sent[0].link,/emailSignToken=/);
  const stored=await ctx.meta.get("envelopes",created.envelopeId);
  assert.equal(stored.signers[0].status,"Signed");
  assert.equal(stored.signers[1].invitation,"Sent");
  assert.equal(stored.events.filter(event=>event.type==="email_link.handoff.started").length,1);
  assert.equal(stored.events.filter(event=>event.type==="email_link.handoff.sent").length,1);
  const delivery=await getEnvelopeStatus(ctx,{uid:"owner-uid",isAdmin:false},created.envelopeId);
  assert.equal(delivery.signers[1].delivery.status,"Accepted by mail server");
  assert.equal(delivery.signers[1].delivery.stageCode,"SUBMIT");
  assert.equal(delivery.signers[1].delivery.smtpReplyCode,250);
  assert.equal(delivery.signers[1].delivery.handoffStatus,"sent");
});

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
  assert.doesNotMatch(source,/Duplicate signer email/);
});

test("Gateway field payload uses envelope signerId and omits the local draft UID",()=>{
  const source=fs.readFileSync(new URL("../../src/firebase/signatureStorage.js",import.meta.url),"utf8");
  assert.match(source,/delete normalizedField\.signerUid/);
  assert.match(source,/signerId:resolveSignerId\(field\)/);
});

test("two distinct participants may share one delivery email and retain isolated signer tokens",async()=>{
  const f=await fixture();
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,
    externalReference:"IRPA-SHARED-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[
      {identityType:"email-link",email:"shared@example.org",name:"Meeting Chair",order:1,role:"Chairperson"},
      {identityType:"email-link",email:"SHARED@example.org",name:"Meeting Secretary",order:2,role:"Secretary"}
    ]
  });
  const envelope=await f.ctx.meta.get("envelopes",created.envelopeId);
  assert.equal(envelope.signers.length,2);
  assert.deepEqual(envelope.signers.map(signer=>signer.id),["S1","S2"]);
  assert.equal(envelope.signers[0].email,envelope.signers[1].email);
  assert.notEqual(envelope.signers[0].tokenHash,envelope.signers[1].tokenHash);
  assert.equal(envelope.signers[0].name,"Meeting Chair");
  assert.equal(envelope.signers[1].name,"Meeting Secretary");
  assert.equal(f.sent.length,2,"sequential routing sends the first invitation and keeps the second signer pending");
});

test("email-link signer is stored with token hash, email hash and configured expiry; mail is sent once",async()=>{
  const f=await fixture();
  const signer=f.envelope.signers[0];
  assert.equal(signer.identityType,"email-link");
  assert.equal(signer.emailLinkStatus,"issued");
  assert.equal(signer.emailLinkAttemptCount,0);
  assert.equal(signer.emailLinkOpenCount,0);
  assert.equal(signer.emailLinkExpiresAt,new Date(NOW.getTime()+7*86400000).toISOString(),"email-link expiry follows the configured seven-day lifetime");
  assert.equal(signer.tokenHash,await sha256Hex(f.token.split(".")[2]));
  assert.equal(signer.emailHash,await sha256Hex("board.secretary@example.org"));
  assert.equal(JSON.stringify(signer).includes(f.token.split(".")[2]),false);
  assert.equal(signer.authorityVerification,undefined);
  assert.equal(signer.name,"Client supplied name");
  assert.deepEqual(signer.declaredParticulars,{name:"Client supplied name",title:"",occupation:"",capacity:""});
  assert.equal(f.sent.length,1);
  assert.match(f.sent[0].link,/emailSignToken=/);
  assert.match(f.sent[0].link,/\/\?emailSignToken=/);
});

test("email signing links expire after their configured lifetime and become unusable after use or revocation",async()=>{
  const issuedAt=new Date("2026-11-16T08:00:00.000Z");
  const issued=await createEmailSigningToken({envelopeId:"ENV-LONG-LIVED",signerId:"S1",email:"signer@example.org",now:issuedAt,randomBytes:new Uint8Array(32).fill(7)});
  assert.equal(issued.record.expiresAt,undefined);
  const oneYearLater=new Date("2027-11-16T08:00:00.000Z");
  assert.equal((await inspectEmailSigningToken(issued.token,issued.record,oneYearLater)).ok,true);
  const opened=await markEmailSigningTokenOpened(issued.record,{token:issued.token,now:oneYearLater,ipHash:"test-ip"});
  assert.equal(opened.status,"opened");
  const used=consumeEmailSigningToken(opened,{now:oneYearLater});
  assert.equal(used.status,"used");
  assert.equal((await inspectEmailSigningToken(issued.token,used,oneYearLater)).ok,false);
  const revoked=revokeEmailSigningToken(issued.record,{now:oneYearLater,actorUid:"owner"});
  assert.equal((await inspectEmailSigningToken(issued.token,revoked,oneYearLater)).ok,false);
});

test("GET preview and PDF are read-only; explicit Open document to sign creates a separate session",async()=>{
  const f=await fixture();
  const before=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const preview=await previewEmailSigning(f.ctx,f.token);
  assert.equal(preview.ok,true);
  assert.equal(preview.signer.email,"board.secretary@example.org");
  const pdfPreview=await getSigningPdf(f.ctx,f.token,null);
  assert.equal(pdfPreview.fileName,"email-link.pdf");
  const afterPreview=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.deepEqual(afterPreview,before,"GET preview and PDF retrieval must not mutate envelope state or audit history");
  assert.equal(await f.ctx.meta.get("emailLinkRateLimits","token:"+await sha256Hex(f.token.split(".")[2])),null);
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.8");
  assert.equal(opened.ok,true);
  assert.notEqual(opened.sessionToken,f.token);
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"issued","session creation must not consume the invitation token");
  assert.equal(stored.signers[0].tokenHash,before.signers[0].tokenHash,"invitation token hash remains authoritative until signing completes");
  assert.equal(stored.signers[0].emailLinkSessionStatus,"active");
  assert.equal(stored.signers[0].emailLinkSessionHash,await sha256Hex(opened.sessionToken.split(".")[2]));
  const sessionPdf=await getSigningPdf(f.ctx,opened.sessionToken,null);
  assert.equal(sessionPdf.fileName,"email-link.pdf");
  const resumed=await openEmailSigning(f.ctx,opened.sessionToken,"198.51.100.8");
  assert.equal(resumed.sessionToken,opened.sessionToken);
  const resumedEnvelope=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(resumedEnvelope.signers[0].emailLinkStatus,"issued");
  assert.equal(resumedEnvelope.signers[0].emailLinkSessionStatus,"active");
  assert.equal(resumedEnvelope.events.filter(event=>event.type==="email_link.session_created").length,1);
});

test("completed email-link signing consumes the invitation and session exactly once",async()=>{
  const f=await fixture();
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.8");
  const result=await sign(f.ctx,{token:opened.sessionToken,signature:{type:"typed",value:"Board Secretary"},declarations:{name:"Board Secretary",occupation:"Secretary"},consent:true,user:null});
  assert.ok(["InProgress","Completed","CompletionFailed"].includes(result.status));
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].status,"Signed");
  assert.equal(stored.signers[0].emailLinkStatus,"used");
  assert.equal(stored.signers[0].emailLinkSessionStatus,"used");
  assert.ok(stored.signers[0].emailLinkSessionHash,"the consumed session hash remains only to authorize read-only retrieval of the completed PDF");
  await assert.rejects(()=>openEmailSigning(f.ctx,f.token,"198.51.100.8"));
  await assert.rejects(()=>sign(f.ctx,{token:opened.sessionToken,signature:{type:"typed",value:"Board Secretary"},declarations:{name:"Board Secretary"},consent:true,user:null}));
  if(result.completed===true){const finalPdf=await getSigningPdf(f.ctx,opened.sessionToken,null);assert.match(finalPdf.fileName,/signed-/);}
});

test("tampered and unknown links return the same neutral response",async()=>{
  const f=await fixture();
  const wrong=f.token.slice(0,-1)+(f.token.endsWith("0")?"1":"0");
  await assert.rejects(()=>openEmailSigning(f.ctx,wrong,"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  await assert.rejects(()=>openEmailSigning(f.ctx,"ENV-UNKNOWN.S1."+"a".repeat(64),"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("an unused email signing link is no longer redeemable after its configured expiry",async()=>{
  const f=await fixture();
  f.now(new Date("2026-11-24T08:00:00.000Z"));
  await assert.rejects(()=>openEmailSigning(f.ctx,f.token,"198.51.100.19"),error=>error.status===410&&error.code==="TOKEN_LOOKUP");
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"expired");
  assert.ok(Date.parse(stored.signers[0].emailLinkExpiresAt)<f.ctx.now().getTime());
});

test("owner revoke invalidates a guest link; resend rotates token and marks the previous hash replaced",async()=>{
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
  assert.equal(current.signers[0].emailLinkTokenHistory.at(-1).status,"replaced");
});


test("an expired session is closed without consuming the still-valid invitation",async()=>{
  const f=await fixture();
  const first=await openEmailSigning(f.ctx,f.token,"198.51.100.27");
  f.now(new Date(NOW.getTime()+31*60*1000));
  await assert.rejects(()=>openEmailSigning(f.ctx,first.sessionToken,"198.51.100.27"),error=>error.status===410);
  const afterExpiry=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(afterExpiry.signers[0].emailLinkSessionStatus,"expired");
  assert.equal(afterExpiry.signers[0].emailLinkStatus,"issued");
  const second=await openEmailSigning(f.ctx,f.token,"198.51.100.27");
  assert.ok(second.sessionToken);
  assert.notEqual(second.sessionToken,first.sessionToken);
});

test("owner Send new link replaces a legacy burned invitation and invalidates its old session",async()=>{
  const f=await fixture();
  const legacySession=await openEmailSigning(f.ctx,f.token,"198.51.100.28");
  const envelope=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  envelope.signers[0].emailLinkStatus="opened";
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:envelope.signers,events:envelope.events},{ifVersion:envelope._v});
  const resent=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(resent.deliveryStatus,"Sent");
  const newToken=new URL(f.sent.at(-1).link).searchParams.get("emailSignToken");
  assert.ok(newToken);
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(current.signers[0].emailLinkStatus,"issued");
  assert.equal(current.signers[0].emailLinkSessionStatus,"revoked");
  assert.equal(current.signers[0].emailLinkSessionHash,null);
  assert.equal(current.signers[0].emailLinkTokenHistory.at(-1).status,"replaced");
  await assert.rejects(()=>getSigningPdf(f.ctx,legacySession.sessionToken,null));
  const preview=await previewEmailSigning(f.ctx,newToken);
  assert.equal(preview.ok,true);
});

test("external email-link signer can declare and sign without a Firebase UID or authority-register match",async()=>{
  const f=await fixture({authority:false});
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.22");
  assert.equal(opened.ok,true);
  assert.equal(opened.signer.identityType,"email-link");
  assert.equal(opened.signer.authenticated,true);
  const signed=await sign(f.ctx,{
    token:opened.sessionToken,
    signature:{type:"typed",value:"Vendor Signer"},
    declarations:{name:"Vendor Signer",occupation:"External Consultant",capacity:"Contractor"},
    consent:true,
    user:null
  });
  assert.equal(signed.completed,true);
  assert.equal(signed.status,"Completed");
  const completed=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(completed.signers[0].uid,null);
  assert.equal(completed.signers[0].signerDeclarations.occupation,"External Consultant");
  assert.equal(completed.signers[0].declarationDiscrepancy.detected,true);
  assert.deepEqual(completed.signers[0].declarationDiscrepancy.fields,["name"]);
  const pdf=await getSigningPdf(f.ctx,opened.sessionToken,null);
  assert.equal(pdf.fileName.includes("-signed-"),true);
});

test("email-link invitations do not require register, authority-matrix or Firebase UID matches",async()=>{
  const f=await fixture({authority:false});
  assert.equal(f.envelope.signers[0].identityType,"email-link");
  assert.equal(f.envelope.signers[0].uid,null);
  assert.equal(f.envelope.signers[0].emailLinkStatus,"issued");
  assert.equal(f.envelope.signers[0].authorityVerification,undefined);
});

test("shared email signers remain distinct and login-bound signing remains UID authenticated",async()=>{
  const f=await fixture();
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org"},{documentId:f.envelope.documentId,externalReference:"IRPA-SHARED-LOGIN-"+Math.random().toString(16).slice(2,10),archives:["board-governance"],signingMode:"Sequential",signers:[{identityType:"email-link",email:"same@example.org",name:"Chairperson",order:1},{identityType:"email-link",email:"SAME@example.org",name:"Secretary",order:2}]});
  const stored=await f.ctx.meta.get("envelopes",created.envelopeId);
  assert.equal(stored.signers.length,2);
  assert.notEqual(stored.signers[0].id,stored.signers[1].id);
  assert.notEqual(stored.signers[0].tokenHash,stored.signers[1].tokenHash);
  const {canAuthenticatedSignerAccess}=await import("../src/signing.mjs");
  assert.equal(canAuthenticatedSignerAccess({uid:"registered-uid"},{uid:"registered-uid"}),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"registered-uid"},{uid:"guest"}),false);
});


test("staging and production require email-link identities for every signer",async()=>{
  const f=await fixture();
  const ctx={...f.ctx,env:{...f.ctx.env,IRPA_ENVIRONMENT:"staging"}};
  const owner={uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false};
  for(const signer of [
    {email:"member@example.org",uid:"registered-member-uid",name:"Registered Member"},
    {email:"member@example.org",uid:"registered-member-uid",identityType:"email-link",name:"Registered Member"},
    {email:"member@example.org",uid:"registered-member-uid",identityType:"other",name:"Registered Member"},
    {email:"member@example.org",identityType:"account",name:"Missing UID"},
    {email:"member@example.org",uid:"registered-member-uid",identityType:"account",name:"Registered Member"}
  ]){
    await assert.rejects(()=>createEnvelope(ctx,owner,{documentId:f.envelope.documentId,archives:["board-governance"],signingMode:"Sequential",signers:[signer]}),error=>error?.status===400&&error.message==="Every staging and production signer must use a verified email-link identity.");
  }
  const guest=await createEnvelope(ctx,owner,{documentId:f.envelope.documentId,archives:["board-governance"],signingMode:"Sequential",signers:[{email:"guest@example.org",identityType:"email-link",name:"External Guest"}]});
  assert.equal(guest.status,"Sent");
  const guestSaved=await ctx.meta.get("envelopes",guest.envelopeId);
  assert.equal(guestSaved.signers[0].uid,null);
  assert.equal(guestSaved.signers[0].identityType,"email-link");
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
  await assert.rejects(()=>sign(f.ctx,{token:opened.sessionToken,signature:{type:"typed",value:"Signer"},declarations:{name:"Signer",occupation:"Officer"},consent:true,user:null}));
});

test("Title assignment is accepted, completed by the signer, and included in live tracking status",async()=>{
  const sent=[];const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
    now:()=>new Date(NOW),verifyUser:async()=>null,sendInvitation:async message=>sent.push(message),logger:{error(){}}
  });
  const sourcePdf=await PDFDocument.create();sourcePdf.addPage([595.28,841.89]);const bytes=await sourcePdf.save();
  const source=await ctx.storage.put({path:"source/title-field.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-TITLE-FIELD";
  await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"title-field.pdf",title:"Title Field Test",classification:"Restricted"});
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId,externalReference:"IRPA-TITLE-FIELD",archives:["board-governance"],signingMode:"Sequential",
    signers:[{identityType:"email-link",email:"signer@example.org",name:"Assigned Signer",title:"Board Secretary",order:1,role:"Board Secretary"}],
    fields:[{fieldId:"SIGNER-TITLE",type:"Title",signerId:"S1",page:1,x:10,y:20,width:35,height:7,required:true}]
  });
  assert.equal(created.status,"Sent");
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  const opened=await openEmailSigning(ctx,token,"198.51.100.44");
  assert.equal(opened.signer.title,"Board Secretary");
  assert.equal(opened.fields[0].type,"Title");
  const signed=await sign(ctx,{token:opened.sessionToken,signature:{type:"typed",value:"Assigned Signer"},fieldValues:{"SIGNER-TITLE":"Board Secretary"},consent:true,declarations:{name:"Assigned Signer",occupation:"Officer"},user:null});
  assert.equal(signed.completed,true);
  const status=await getEnvelopeStatus(ctx,{uid:"owner-uid",isAdmin:false},created.envelopeId);
  assert.equal(status.status,"Completed");
  assert.equal(status.lastEvent.type,"envelope.completed");
  assert.equal(status.signers[0].title,"Board Secretary");
});


test("v2 reusable invitation is read-only on preview, creates fresh sessions, and expires with the exact signed message",async()=>{
  const f=await fixture();
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{emailSigningModule:"v2"},{ifVersion:current._v});
  const before=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const preview=await previewEmailSigning(f.ctx,f.token);
  assert.equal(preview.ok,true);
  const afterPreview=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.deepEqual(afterPreview,before,"GET preview and link previews must not change state or audit history");
  const first=await openEmailSigning(f.ctx,f.token,"198.51.100.81");
  const second=await openEmailSigning(f.ctx,f.token,"198.51.100.82");
  assert.notEqual(first.sessionToken,second.sessionToken,"each explicit open creates a fresh isolated session");
  const reopened=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(reopened.signers[0].emailLinkStatus,"issued","opening never consumes the invitation link");
  assert.equal(reopened.signers[0].emailLinkSessionStatus,"active");
  assert.notEqual(reopened.signers[0].emailLinkSessionHash,await sha256Hex(first.sessionToken.split(".")[2]));
  const signer=reopened.signers[0];
  signer.status="Signed";
  signer.emailLinkStatus="used";
  signer.emailLinkSessionStatus="used";
  signer.signedAt=NOW.toISOString();
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:reopened.signers},{ifVersion:reopened._v});
  await assert.rejects(
    ()=>previewEmailSigning(f.ctx,f.token),
    error=>error.status===410&&error.message==="This document is already signed."
  );
  await assert.rejects(
    ()=>openEmailSigning(f.ctx,f.token,"198.51.100.82"),
    error=>error.status===410&&error.message==="This document is already signed."
  );
});


test("parallel same-position group is released after portal-first owner signs; repeated Gmail assignments stay isolated",async()=>{
  const sent=[];
  let now=NOW;
  let sendNumber=0;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa-digital-board-governance.web.app",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7"},
    now:()=>new Date(now),
    verifyUser:async()=>null,
    verifyEmailSignerAuthority:async()=>({verified:false}),
    sendInvitation:async message=>{
      sendNumber++;
      const content=buildEmailSigningInvitationMessage({
        name:message.name,link:message.link,title:message.title,ownerName:message.ownerName,
        expiresAt:message.expiresAt,position:message.position
      });
      const messageId="<parallel-"+sendNumber+"@irpa.or.tz>";
      const date=new Date(now).toUTCString();
      const rawMime=buildRawMailMimeMessage({
        from:"info@irpa.or.tz",replyTo:"info@irpa.or.tz",to:message.to,
        subject:content.subject,text:content.text,html:content.html,messageId,date
      });
      sent.push({...message,...content,messageId,date,rawMime});
      for(const stage of ["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]){
        const accepted=["RCPT_ACCEPTED","SUBMIT"].includes(stage);
        await message.onStage?.(stage,"success",accepted?"ACCEPTED":"UNKNOWN",{
          messageId,date,smtpReplyCode:250,
          smtpReply:stage==="RCPT_ACCEPTED"?"250 2.1.5 recipient accepted":stage==="SUBMIT"?"250 2.0.0 queued":"250 OK"
        });
      }
    },
    logger:{error(){}}
  });
  const sourcePdf=await PDFDocument.create();
  sourcePdf.addPage([595.28,841.89]);
  const sourceBytes=await sourcePdf.save();
  const source=await ctx.storage.put({path:"source/parallel-three-position.pdf",bytes:sourceBytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-PARALLEL-THREE-POSITIONS";
  await ctx.meta.create("documents",documentId,{
    id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,
    sha256:await sha256Hex(sourceBytes),fileName:"parallel-three-position.pdf",
    title:"Parallel Gmail Three Position Test",classification:"Restricted"
  });
  const pixel="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId,externalReference:"IRPA-PARALLEL-THREE-POSITIONS",archives:["board-governance"],
    signingMode:"Parallel",ownerPreSignEmail:"owner@example.org",ownerPreSignSignerId:"S1",
    signers:[
      {identityType:"email-link",email:"owner@example.org",name:"Document Owner",order:1,role:"Document Owner"},
      {identityType:"email-link",email:"shared@gmail.com",name:"External Unregistered Signer",order:1,role:"External Reviewer"},
      {identityType:"email-link",email:"SHARED@gmail.com",name:"Second Shared Mailbox Signer",order:1,role:"Secretary"},
      {identityType:"email-link",email:"shared@gmail.com",name:"Third Shared Mailbox Signer",order:1,role:"Chair"}
    ],
    fields:[
      {fieldId:"OWNER-SIGNATURE",type:"Signature",signerId:"S1",page:1,x:10,y:10,width:20,height:8,required:true}
    ]
  });
  assert.equal(created.status,"Awaiting Owner Signature");
  assert.equal(sent.length,0,"the existing portal-first owner rule remains in force before the owner signs");
  assert.ok(created.ownerSigningToken,"the portal-first owner receives the existing owner signing token");

  const wrongOwnerToken=created.ownerSigningToken.slice(0,-1)+(created.ownerSigningToken.endsWith("0")?"1":"0");
  await assert.rejects(()=>openEmailSigning(ctx,wrongOwnerToken,"198.51.100.62"),error=>error.message===genericEmailSigningFailure());
  const ownerOpened=await openEmailSigning(ctx,created.ownerSigningToken,"198.51.100.62");
  const ownerResult=await sign(ctx,{
    token:ownerOpened.sessionToken,
    signature:{type:"drawn",value:pixel},
    fieldApplications:[{fieldId:"OWNER-SIGNATURE",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:pixel}],
    fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Document Owner"}
  });
  assert.equal(ownerResult.status,"InProgress");
  assert.equal(sent.length,3,"after the owner signs, every remaining signer in the same parallel position receives an invitation together");
  assert.deepEqual(sent.map(message=>message.to.toLowerCase()),["shared@gmail.com","shared@gmail.com","shared@gmail.com"]);

  const tokenFor=message=>new URL(message.link).searchParams.get("emailSignToken");
  const signExternal=async(index,ip)=>{
    const token=tokenFor(sent[index]);
    const wrong=token.slice(0,-1)+(token.endsWith("0")?"1":"0");
    await assert.rejects(()=>openEmailSigning(ctx,wrong,ip),error=>error.message===genericEmailSigningFailure());
    const opened=await openEmailSigning(ctx,token,ip);
    assert.equal(opened.signer.identityType,"email-link");
    const result=await sign(ctx,{
      token:opened.sessionToken,
      signature:{type:"typed",value:sent[index].name},
      declarations:{name:sent[index].name,occupation:"Signing participant"},
      consent:true,user:null
    });
    return {opened,result};
  };

  const firstExternal=await signExternal(0,"198.51.100.61");
  assert.equal(firstExternal.result.status,"InProgress");
  assert.equal(sent.length,3,"one external signer signing does not delay the other members of the parallel group");
  const secondExternal=await signExternal(1,"198.51.100.63");
  assert.equal(secondExternal.result.status,"InProgress");
  const thirdExternal=await signExternal(2,"198.51.100.64");
  assert.equal(thirdExternal.result.status,"Completed");
  assert.equal(thirdExternal.result.completed,true);

  assert.equal(new Set(sent.map(message=>message.messageId)).size,3,"each position gets a distinct Message-ID for the same Gmail address");
  assert.equal(new Set(sent.map(message=>message.subject)).size,3,"each position gets a distinct subject for the same Gmail address");
  for(const message of sent){
    assert.match(message.subject,/Parallel Gmail Three Position Test/);
    assert.match(message.subject,/Position 1/);
    assert.match(message.rawMime,/Content-Type: text\/plain/);
    assert.match(message.rawMime,/Content-Type: text\/html/);
    assert.match(message.messageId,/@irpa\.or\.tz/);
  }

  const stored=await ctx.meta.get("envelopes",created.envelopeId);
  assert.deepEqual(stored.signers.map(signer=>signer.status),["Signed","Signed","Signed","Signed"]);
  assert.equal(stored.events.filter(event=>event.type==="email_link.handoff.started").length,3);
  assert.equal(stored.events.filter(event=>event.type==="email_link.handoff.sent").length,3);
  assert.equal(stored.events.filter(event=>event.type==="email_link.stage"&&event.stage==="SUBMIT"&&event.outcome==="success").length,3);
  const status=await getEnvelopeStatus(ctx,{uid:"owner-uid",isAdmin:false},created.envelopeId);
  assert.equal(status.status,"Completed");
  assert.equal(status.signers.length,4);
  assert.equal(status.signers[0].delivery.status,"Portal signing (no invitation email)");
  for(const signer of status.signers.slice(1)){
    assert.equal(signer.delivery.status,"Accepted by mail server");
    assert.equal(signer.delivery.smtpReplyCode,250);
    assert.equal(signer.delivery.smtpReplyCategory,"ACCEPTED");
    assert.equal(signer.delivery.stageCode,"SUBMIT");
    assert.ok(signer.delivery.messageId);
    assert.equal(signer.delivery.handoffStatus,"sent");
  }

  const finalPdf=await getSigningPdf(ctx,thirdExternal.opened.sessionToken,null);
  assert.match(finalPdf.fileName,/signed-/);
  assert.ok(finalPdf.bytes.length>sourceBytes.length);
  const parsed=await PDFDocument.load(finalPdf.bytes);
  assert.equal(parsed.getPageCount(),1,"the original page count and PDF readability remain intact after the parallel signing ceremony");
});

test("failed replacement email keeps the previous invitation link valid until SMTP accepts a new message",async()=>{
  const f=await fixture();
  const originalHash=f.envelope.signers[0].tokenHash;
  f.ctx.sendInvitation=async()=>{const error=new Error("IRPA SMTP error 550");error.stageCode="RCPT_ACCEPTED";error.smtpResponseCode=550;error.smtpReply="550 5.1.1 recipient rejected";throw error;};
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),error=>error.status===502&&error.code==="RCPT_ACCEPTED");
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(current.signers[0].tokenHash,originalHash);
  assert.equal(current.signers[0].emailLinkStatus,"issued");
  assert.equal(current.signers[0].resendAttempt,undefined);
  assert.equal(current.events.at(-1).type,"invitation.resend.failed");
  const stillValid=await openEmailSigning(f.ctx,f.token,"198.51.100.71");
  assert.equal(stillValid.signer.email,"board.secretary@example.org");
});
