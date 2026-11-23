import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {createEnvelope,openEmailSigning,previewEmailSigning,getSigningPdf,resendInvitation,resendAllUnsignedInvitations,revokeInvitation,getEnvelopeStatus,recordEmailLinkStage} from "../src/signing.mjs";
import {sha256Hex} from "../src/util.mjs";
import {persistSignerProgressMirror} from "../src/signatureMirror.mjs";
import {buildSmtpRecipientEnvelope} from "../src/invitationEmail.mjs";
import {genericEmailSigningFailure,createEmailSigningToken,inspectEmailSigningToken,markEmailSigningTokenOpened,consumeEmailSigningToken,revokeEmailSigningToken} from "../src/emailSigningLinks.mjs";
import {PDFDocument} from "pdf-lib";
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


test("email-link signer progress is mirrored immediately without completing or distributing the envelope",async()=>{
  const f=await fixture();
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const second={...stored.signers[0],id:"S2",uid:null,profileUid:null,name:"Second Signer",email:"second@example.org",status:"Pending",signedAt:null,order:2,tokenHash:"b".repeat(64),emailLinkStatus:"issued",emailLinkSessionStatus:"revoked",emailLinkSessionHash:null};
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{
    signers:[stored.signers[0],second],
    fields:[{fieldId:"FIRST-SIGNATURE",type:"Signature",signerId:"S1",page:1,x:10,y:10,width:20,height:8,required:true},{fieldId:"SECOND-SIGNATURE",type:"Signature",signerId:"S2",page:1,x:40,y:10,width:20,height:8,required:true}],
    signingMode:"Parallel",
    status:"InProgress"
  });
  let mirrored=null;
  f.ctx.persistSignerProgress=async({envelope})=>{mirrored=structuredClone(envelope);};
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.81");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result=await sign(f.ctx,{
    token:opened.sessionToken,
    signature:{type:"drawn",value:png},
    fieldApplications:[{fieldId:"FIRST-SIGNATURE",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],
    fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Client supplied name"}
  });
  assert.equal(result.status,"InProgress");
  assert.equal(result.completed,false);
  assert.ok(mirrored,"successful non-final email-link signing triggers mirror synchronization");
  assert.equal(mirrored.status,"InProgress");
  assert.equal(mirrored.signers.find(item=>item.id==="S1").status,"Signed");
  assert.equal(mirrored.signers.find(item=>item.id==="S2").status,"Pending");
  assert.equal(mirrored.completion,null,"no completion record is created for a partially signed envelope");
});

test("refreshing a partially signed email-link envelope reconciles a stale signer mirror",async()=>{
  const f=await fixture();
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const signer={...stored.signers[0],status:"Signed",signedAt:"2026-11-22T10:00:00.000Z"};
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:[signer],status:"InProgress"});
  let reconciled=null;
  f.ctx.persistSignerProgress=async({envelope})=>{reconciled=structuredClone(envelope);};
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.status,"InProgress");
  assert.equal(status.signers[0].status,"Signed");
  assert.ok(reconciled,"status refresh attempts reconciliation of a previously stale mirror");
  assert.equal(reconciled.signers[0].status,"Signed");
  assert.equal(reconciled.status,"InProgress");
});

test("a) IRPA-account owner at position 1 signs and automatically emails Gmail X at position 2",async()=>{
  const sent=[];let now=NOW;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7"},
    now:()=>new Date(now),verifyUser:async()=>null,sendInvitation:async message=>sent.push(message),logger:{error(){}}
  });
  const sourcePdf=await PDFDocument.create();sourcePdf.addPage([595.28,841.89]);const bytes=await sourcePdf.save();
  const source=await ctx.storage.put({path:"source/owner-first.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-OWNER-FIRST";
  await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"owner-first.pdf",title:"Owner First Signing",classification:"Restricted"});
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@irpa.or.tz",name:"Document Owner",isAdmin:false},{
    documentId,externalReference:"IRPA-OWNER-FIRST",archives:["board-governance"],signingMode:"Sequential",ownerPreSignEmail:"owner@irpa.or.tz",ownerPreSignSignerId:"S1",
    signers:[
      {identityType:"account",uid:"owner-uid",email:"owner@irpa.or.tz",name:"Document Owner",order:1,role:"Document Owner"},
      {identityType:"email-link",email:"gmail-x@gmail.com",name:"Gmail Signer",order:2,role:"Signer"}
    ],
    fields:[
      {fieldId:"OWNER-SIGNATURE",type:"Signature",signerId:"S1",page:1,x:10,y:10,width:20,height:8,required:true},
      {fieldId:"NEXT-SIGNATURE",type:"Signature",signerId:"S2",page:1,x:40,y:10,width:20,height:8,required:true}
    ]
  });
  assert.equal(created.status,"Awaiting Owner Signature");
  assert.equal(sent.length,0,"the owner portal-first signing flow does not send the owner an email");
  assert.ok(created.ownerSigningToken,"the authenticated owner receives the portal signing token");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result=await sign(ctx,{
    token:created.ownerSigningToken,user:{uid:"owner-uid"},
    signature:{type:"drawn",value:png},
    fieldApplications:[{fieldId:"OWNER-SIGNATURE",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],
    fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Document Owner"}
  });
  assert.equal(result.status,"InProgress");
  assert.equal(result.nextInvitations.status,"sent");
  assert.equal(sent.length,1,"the next position is dispatched automatically after the owner signs");
  assert.equal(sent[0].to,"gmail-x@gmail.com","hand-off targets the next signer's own email, not the owner");
  assert.equal(sent[0].signerId,"S2");
  assert.equal(sent[0].position,2);
  const stored=await ctx.meta.get("envelopes",created.envelopeId);
  assert.equal(stored.signers[0].status,"Signed");
  assert.equal(stored.signers[1].invitation,"Sent");
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

test("email-link signer is stored with token hash and email hash but no calendar expiry; mail is sent once",async()=>{
  const f=await fixture();
  const signer=f.envelope.signers[0];
  assert.equal(signer.identityType,"email-link");
  assert.equal(signer.emailLinkStatus,"issued");
  assert.equal(signer.emailLinkAttemptCount,0);
  assert.equal(signer.emailLinkOpenCount,0);
  assert.equal(signer.emailLinkExpiresAt,undefined,"email invitations do not carry a calendar expiry");
  assert.equal(signer.tokenExpiresAt,undefined,"email invitations do not inherit envelope/token expiry");
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

test("email token primitive has no calendar expiry but becomes unusable after use or revocation",async()=>{
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

test("an unused email signing link remains redeemable beyond the former configured expiry",async()=>{
  const f=await fixture();
  f.now(new Date("2028-11-24T08:00:00.000Z"));
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.19");
  assert.equal(opened.ok,true);
  assert.ok(opened.sessionToken,"reopening the original invitation creates a fresh session");
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"issued");
  assert.equal(stored.signers[0].emailLinkExpiresAt,undefined);
  assert.equal(stored.signers[0].tokenExpiresAt,undefined);
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

test("e) three sequential positions on one mailbox receive distinct mocked-SMTP messages and safe audit notices",async()=>{
  const f=await fixture();
  const sent=[],audits=[];let messageNumber=0;
  f.ctx.sendInvitationAudit=async record=>audits.push(record);
  f.ctx.sendInvitation=async message=>{
    const messageId="<mock-"+(++messageNumber)+"@irpa.or.tz>";
    sent.push({...message,messageId});
    for(const stage of ["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"])
      await message.onStage?.(stage,"success",stage==="SUBMIT"?"ACCEPTED":"UNKNOWN",{messageId});
    await message.onAudit?.({messageId,smtpReplyCategory:"ACCEPTED"});
    return "250 MOCK ACCEPTED";
  };
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,
    externalReference:"IRPA-THREE-SHARED-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[1,2,3].map(index=>({identityType:"email-link",email:"shared@example.org",name:"Signer "+index,order:index,role:"Signer"})),
    fields:[1,2,3].map(index=>({fieldId:"SHARED-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,1,"only the first sequential position is initially invited");
  await recordEmailLinkStage(f.ctx,created.envelopeId,"S1","SUBMIT","success","ACCEPTED");
  const ownerStatus=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},created.envelopeId);
  assert.equal(ownerStatus.signers[0].delivery.state,"Accepted by the mail server");
  assert.equal(ownerStatus.signers[0].delivery.smtpReplyCategory,"ACCEPTED");
  const tokenIds=[];
  for(let position=1;position<=3;position++){
    const invitation=sent[position-1];
    assert.equal(invitation.to,"shared@example.org");
    assert.equal(invitation.signerId,"S"+position);
    assert.equal(invitation.position,position);
    assert.equal(invitation.positionCount,3);
    const token=new URL(invitation.link).searchParams.get("emailSignToken");
    tokenIds.push(token);
    const opened=await openEmailSigning(f.ctx,token,"198.51.100."+position);
    const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const result=await sign(f.ctx,{
      token:opened.sessionToken,
      signature:{type:"drawn",value:png},
      fieldApplications:[{fieldId:"SHARED-SIGN-"+position,confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],
      fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Signer "+position}
    });
    if(position<3){
      assert.equal(result.status,"InProgress");
      assert.equal(sent.length,position+1);
    }
  }
  assert.equal(sent.length,3);
  assert.equal(new Set(tokenIds).size,3);
  assert.deepEqual(sent.map(item=>item.signerId),["S1","S2","S3"]);
  assert.equal(new Set(sent.map(item=>item.messageId)).size,3,"each position has a unique SMTP Message-ID");
  assert.equal(audits.length,3,"one audit message follows each accepted invitation");
  assert.equal(new Set(audits.map(item=>item.messageId)).size,3);
  for(const audit of audits){
    const serialized=JSON.stringify(audit);
    assert.equal(serialized.includes("shared@example.org"),false,"audit contains no full recipient address");
    assert.equal(serialized.includes("emailSignToken"),false,"audit contains no signing token");
    assert.equal(serialized.includes("https://"),false,"audit contains no signing link");
    assert.equal(audit.recipientPrefix,"sha");
    assert.equal(audit.recipientDomain,"example.org","audit subject must retain only the masked local part and recipient domain");
    assert.equal(audit.invitationKind,"creation");
  }
});


test("parallel creation sends every position to its own normalized typed mailbox without profile substitution",async()=>{
  const f=await fixture();
  const sent=[];
  const profileLookups=[];
  f.ctx.sendInvitation=async message=>sent.push(message);
  f.ctx.resolveEmailLinkProfileUid=async(email,name)=>{profileLookups.push({email,name});return "profile-uid-"+name.replace(/\s+/g,"-").toLowerCase();};
  const sharedTyped="  Shared.Mailbox@GMAIL.COM  ";
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner-account@irpa.or.tz",name:"Owner Account",isAdmin:false},{
    documentId:f.envelope.documentId,
    externalReference:"IRPA-PARALLEL-RECIPIENT-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Parallel",
    signers:[1,2,3].map(index=>({identityType:"email-link",email:sharedTyped,name:"Signer "+index,order:index})),
    fields:[1,2,3].map(index=>({fieldId:"PARALLEL-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,3,"parallel mode must email every signer position");
  assert.deepEqual(sent.map(item=>item.to),["shared.mailbox@gmail.com","shared.mailbox@gmail.com","shared.mailbox@gmail.com"]);
  assert.deepEqual(sent.map(item=>item.signerId),["S1","S2","S3"]);
  assert.deepEqual(sent.map(item=>item.position),[1,2,3]);
  assert.ok(sent.every(item=>item.positionCount===3));
  const stored=await f.ctx.meta.get("envelopes",created.envelopeId);
  assert.ok(stored.signers.every(signer=>signer.email==="shared.mailbox@gmail.com"));
  const expectedEmailHash=await sha256Hex("shared.mailbox@gmail.com");
  assert.ok(stored.signers.every(signer=>signer.emailHash===expectedEmailHash));
  assert.ok(stored.signers.every(signer=>signer.profileUid&&signer.profileUid.startsWith("profile-uid-")));
  assert.ok(profileLookups.every(item=>item.email==="shared.mailbox@gmail.com"));
  const tokens=sent.map(item=>new URL(item.link).searchParams.get("emailSignToken"));
  assert.deepEqual(tokens.map(token=>token.split(".")[1]),["S1","S2","S3"]);
  assert.equal(new Set(tokens).size,3);
});

test("resend and resend-all always use each pending signer's own stored address",async()=>{
  const f=await fixture();
  const sent=[];
  f.ctx.sendInvitation=async message=>sent.push(message);
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner-account@irpa.or.tz",name:"Owner Account",isAdmin:false},{
    documentId:f.envelope.documentId,
    externalReference:"IRPA-RESEND-RECIPIENT-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Parallel",
    signers:[
      {identityType:"email-link",email:"first.signer@gmail.com",name:"First Signer",order:1},
      {identityType:"email-link",email:"second.signer@outlook.com",name:"Second Signer",order:2},
      {identityType:"email-link",email:"third.signer@yahoo.com",name:"Third Signer",order:3}
    ],
    fields:[1,2,3].map(index=>({fieldId:"RESEND-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.deepEqual(sent.map(item=>item.to),["first.signer@gmail.com","second.signer@outlook.com","third.signer@yahoo.com"]);
  sent.length=0;
  await resendInvitation(f.ctx,{uid:"owner-uid",email:"owner-account@irpa.or.tz"},created.envelopeId,"S2");
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"second.signer@outlook.com");
  sent.length=0;
  const all=await resendAllUnsignedInvitations(f.ctx,{uid:"owner-uid",email:"owner-account@irpa.or.tz"},created.envelopeId);
  assert.equal(all.attempted,3);
  assert.equal(all.sent,3);
  assert.deepEqual(sent.map(item=>item.to),["first.signer@gmail.com","second.signer@outlook.com","third.signer@yahoo.com"]);
});


test("b) owner is not a signer; the same Gmail mailbox receives one invitation per sequential signer position",async()=>{
  const f=await fixture(),sent=[];
  f.ctx.sendInvitation=async message=>sent.push(message);
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,externalReference:"IRPA-B-SHARED-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[1,2].map(index=>({identityType:"email-link",email:"same-gmail@example.com",name:"Signer "+index,order:index,role:"Signer"})),
    fields:[1,2].map(index=>({fieldId:"B-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,1,"only position 1 is invited at creation in sequential mode");
  assert.equal(sent[0].to,"same-gmail@example.com");
  assert.equal(sent[0].signerId,"S1");
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  const opened=await openEmailSigning(f.ctx,token,"198.51.100.71");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result=await sign(f.ctx,{token:opened.sessionToken,signature:{type:"drawn",value:png},fieldApplications:[{fieldId:"B-SIGN-1",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Signer 1"}});
  assert.equal(result.nextInvitations.status,"sent");
  assert.equal(sent.length,2);
  assert.deepEqual(sent.map(item=>item.signerId),["S1","S2"]);
  assert.deepEqual(sent.map(item=>item.to),["same-gmail@example.com","same-gmail@example.com"]);
  assert.equal(sent[1].position,2);
});

test("d) parallel signing sends every signer position at envelope creation without email deduplication",async()=>{
  const f=await fixture(),sent=[];
  f.ctx.sendInvitation=async message=>sent.push(message);
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,externalReference:"IRPA-D-PARALLEL-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Parallel",
    signers:[1,2,3].map(index=>({identityType:"email-link",email:"parallel-gmail@example.com",name:"Parallel "+index,order:index,role:"Signer"})),
    fields:[1,2,3].map(index=>({fieldId:"D-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,3,"parallel mode emails all positions during creation");
  assert.deepEqual(sent.map(item=>item.signerId),["S1","S2","S3"]);
  assert.deepEqual(sent.map(item=>item.position),[1,2,3]);
  assert.deepEqual(sent.map(item=>item.to),["parallel-gmail@example.com","parallel-gmail@example.com","parallel-gmail@example.com"]);
  const tokens=sent.map(item=>new URL(item.link).searchParams.get("emailSignToken"));
  assert.equal(new Set(tokens).size,3,"each position has its own signer-bound token");
  assert.equal(created.invitations.length,3);
});

test("c) the owner's IRPA address at position 1 is emailed and Gmail X is automatically emailed at position 2",async()=>{
  const f=await fixture(),sent=[];
  f.ctx.sendInvitation=async message=>sent.push(message);
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@irpa.or.tz",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,externalReference:"IRPA-F-OWNER-MAILBOX-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[
      {identityType:"email-link",email:"owner@irpa.or.tz",name:"Owner mailbox signer",order:1,role:"Signer"},
      {identityType:"email-link",email:"gmail-x@gmail.com",name:"Gmail X",order:2,role:"Signer"}
    ],
    fields:[1,2].map(index=>({fieldId:"F-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"owner@irpa.or.tz","the owner-address signer receives its own invitation rather than being deduplicated");
  assert.equal(sent[0].signerId,"S1");
  assert.equal(created.invitations[1].status,"Pending");
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  const opened=await openEmailSigning(f.ctx,token,"198.51.100.73");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result=await sign(f.ctx,{token:opened.sessionToken,signature:{type:"drawn",value:png},fieldApplications:[{fieldId:"F-SIGN-1",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Owner mailbox signer"}});
  assert.equal(result.nextInvitations.status,"sent");
  assert.equal(sent.length,2);
  assert.equal(sent[1].to,"gmail-x@gmail.com","the hand-off uses the next signer's own Gmail address, not the owner or previous signer");
  assert.equal(sent[1].signerId,"S2");
});


test("audit-email failure never blocks or repeats an accepted invitation",async()=>{
  const f=await fixture(),sent=[];
  f.ctx.sendInvitationAudit=async()=>{throw new Error("audit mailbox unavailable");};
  f.ctx.sendInvitation=async message=>{
    sent.push(message);
    await message.onStage?.("SUBMIT","success","ACCEPTED",{messageId:"<accepted-once@irpa.or.tz>"});
    await message.onAudit?.({messageId:"<accepted-once@irpa.or.tz>",smtpReplyCategory:"ACCEPTED"});
    return "250 MOCK ACCEPTED";
  };
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,externalReference:"IRPA-AUDIT-FAIL-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[{identityType:"email-link",email:"audit-test@gmail.com",name:"Audit Test",order:1}],
    fields:[{fieldId:"AUDIT-FAIL-SIGN",type:"Signature",signerId:"S1",page:1,x:10,y:10,width:20,height:8,required:true}]
  });
  assert.equal(sent.length,1,"the invitation is submitted exactly once");
  assert.equal(created.invitations[0].status,"Sent");
  const stored=await f.ctx.meta.get("envelopes",created.envelopeId);
  assert.equal(stored.signers[0].invitation,"Sent");
});

test("a failed next-position SMTP hand-off is returned and recorded on the envelope with its stage code",async()=>{
  const f=await fixture(),sent=[];
  f.ctx.sendInvitation=async message=>{
    sent.push(message);
    if(message.signerId==="S2"){const error=new Error("mock SMTP connection failed");error.stageCode="SMTP_CONNECT";throw error;}
    return "250 MOCK ACCEPTED";
  };
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,externalReference:"IRPA-HANDOFF-FAIL-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[1,2].map(index=>({identityType:"email-link",email:"handoff@example.com",name:"Signer "+index,order:index})),
    fields:[1,2].map(index=>({fieldId:"HANDOFF-FAIL-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,1);
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  const opened=await openEmailSigning(f.ctx,token,"198.51.100.72");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result=await sign(f.ctx,{token:opened.sessionToken,signature:{type:"drawn",value:png},fieldApplications:[{fieldId:"HANDOFF-FAIL-1",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Signer 1"}});
  assert.equal(result.nextInvitations.status,"failed");
  assert.deepEqual(result.nextInvitations.failures,[{signerId:"S2",stageCode:"SMTP_CONNECT"}]);
  assert.equal(sent.length,2,"the hand-off was attempted once, without resend or duplicate invitation");
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},created.envelopeId);
  assert.equal(status.signers[1].delivery.state,"Failed");
  assert.equal(status.signers[1].deliveryStageCode,"SMTP_CONNECT");
  assert.equal(status.signers[1].invitation,"Failed (SMTP_CONNECT)");
});

test("mock SMTP proves creation, resend and resend-all RCPT TO and To header equal each typed signer address",async()=>{
  const f=await fixture();
  const sent=[];
  f.ctx.resolveEmailLinkProfileUid=async()=>"registered-profile-uid-not-an-email";
  f.ctx.sendInvitation=async message=>{
    const envelope=buildSmtpRecipientEnvelope({
      from:'"IRPA Digital Signing" <administrator@irpa.or.tz>',
      to:message.to,subject:"Please sign: Recipient test - "+message.name,
      text:"plain invitation",html:"<p>html invitation</p>"
    });
    const toHeader=envelope.mime.match(/^To:\s*(.+)$/m)?.[1]||"";
    sent.push({...message,smtpRecipient:envelope.recipient,rcptCommand:envelope.rcptCommand,toHeader});
  };
  const typed=["  Owner.Gmail@GMAIL.COM  ","  Assigned.Person@Example.org ","Assigned.Person@example.org"];
  const expected=["owner.gmail@gmail.com","assigned.person@example.org","assigned.person@example.org"];
  const owner={uid:"owner-uid",email:"owner-account@irpa.or.tz",name:"Document Owner",isAdmin:false};
  const created=await createEnvelope(f.ctx,owner,{
    documentId:f.envelope.documentId,
    externalReference:"IRPA-MOCK-SMTP-ROUTING-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Parallel",
    signers:typed.map((email,index)=>({identityType:"email-link",email,name:"Signer "+(index+1),order:index+1})),
    fields:[1,2,3].map(index=>({fieldId:"MOCK-SMTP-SIGN-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  const assertTrace=(rows,emails)=>{
    assert.deepEqual(rows.map(item=>item.smtpRecipient),emails);
    assert.deepEqual(rows.map(item=>item.rcptCommand),emails.map(email=>"RCPT TO:<"+email+">"));
    assert.deepEqual(rows.map(item=>item.toHeader),emails.map(email=>"<"+email+">"));
    for(let index=0;index<rows.length;index++){
      assert.equal(rows[index].to,emails[index]);
      console.log("MOCK SMTP RCPT TO / To",JSON.stringify({position:rows[index].position,rcptTo:rows[index].rcptCommand,toHeader:rows[index].toHeader,typed:typed[rows[index].position-1]||emails[index]}));
    }
  };
  assert.equal(sent.length,3,"parallel creation sends every signer position");
  assertTrace(sent,expected);
  const stored=await f.ctx.meta.get("envelopes",created.envelopeId);
  assert.deepEqual(stored.signers.map(signer=>signer.email),expected);
  for(let index=0;index<expected.length;index++){
    assert.equal(stored.signers[index].emailHash,await sha256Hex(expected[index]));
    assert.equal(stored.signers[index].profileUid,"registered-profile-uid-not-an-email");
  }
  sent.length=0;
  await resendInvitation(f.ctx,owner,created.envelopeId,"S2");
  assert.equal(sent.length,1);
  assertTrace(sent,[expected[1]]);
  sent.length=0;
  const bulk=await resendAllUnsignedInvitations(f.ctx,owner,created.envelopeId);
  assert.equal(bulk.attempted,3);
  assert.equal(bulk.failed,0);
  assertTrace(sent,expected);
});


test("f) the owner's IRPA address at a later signer position is not deduplicated against the owner account",async()=>{
  const f=await fixture(),sent=[];
  f.ctx.sendInvitation=async message=>sent.push(message);
  const created=await createEnvelope(f.ctx,{uid:"owner-uid",email:"owner@irpa.or.tz",name:"Document Owner",isAdmin:false},{
    documentId:f.envelope.documentId,externalReference:"IRPA-F-LATER-OWNER-"+Math.random().toString(16).slice(2,10),
    archives:["board-governance"],signingMode:"Sequential",
    signers:[
      {identityType:"email-link",email:"gmail-x@gmail.com",name:"Gmail X",order:1},
      {identityType:"email-link",email:"owner@irpa.or.tz",name:"Owner-address signer",order:2}
    ],
    fields:[1,2].map(index=>({fieldId:"F-LATER-"+index,type:"Signature",signerId:"S"+index,page:1,x:10,y:10,width:20,height:8,required:true}))
  });
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"gmail-x@gmail.com");
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  const opened=await openEmailSigning(f.ctx,token,"198.51.100.74");
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result=await sign(f.ctx,{token:opened.sessionToken,signature:{type:"drawn",value:png},fieldApplications:[{fieldId:"F-LATER-1",confirmed:true,page:1,x:0.1,y:0.1,width:0.2,height:0.08,coordinateSpace:"visible-page-fraction-v1",value:png}],fieldValues:{},signatureConfirmed:true,consent:true,declarations:{name:"Gmail X"}});
  assert.equal(result.nextInvitations.status,"sent");
  assert.equal(sent.length,2);
  assert.equal(sent[1].signerId,"S2");
  assert.equal(sent[1].to,"owner@irpa.or.tz","the owner's address is still the assigned recipient for that signer position");
});

test("owner refresh synchronizes overall in-progress document status even when signer assignments are unchanged",async()=>{
  const writes=[];
  const envelope={id:"ENV-STATUS-REFRESH",externalReference:"IRPA-STATUS-REFRESH",status:"InProgress",signers:[{id:"S1",uid:"owner-uid",profileUid:"owner-uid",identityType:"account",name:"Document Owner",email:"owner@example.org",status:"Pending",signedAt:null}]};
  const existing={documentId:"DOC-STATUS-REFRESH",status:"Completed",gatewayStatus:"Completed",gatewaySigningStatus:"Completed",signers:[{signerId:"S1",uid:"owner-uid",status:"Pending",signedAt:null}]};
  const changed=await persistSignerProgressMirror({envelope,getDocument:async()=>existing,updateDocument:async(path,fields)=>writes.push({path,fields}),now:()=>"2026-11-22T11:30:00.000Z"});
  assert.equal(changed,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].path,"signatureEnvelopes/IRPA-STATUS-REFRESH");
  assert.equal(writes[0].fields.status,"InProgress");
  assert.equal(writes[0].fields.gatewayStatus,"InProgress");
  assert.equal(writes[0].fields.gatewaySigningStatus,"InProgress");
  assert.equal(writes[0].fields.signers[0].status,"Pending");
});

test("owner refresh retries completed Firebase mirror and validates signed PDF and signer evidence",async()=>{
  const f=await fixture();
  const signedBytes=new Uint8Array([1,2,3,4,5]);
  const signedFile=await f.ctx.storage.put({path:"completed/refresh.pdf",bytes:signedBytes,contentType:"application/pdf",metadata:{}});
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const signer={...stored.signers[0],status:"Signed",signedAt:"2026-11-22T10:00:00.000Z"};
  const completion={primaryStorageId:signedFile.id,finalHash:await sha256Hex(signedBytes),completedAt:"2026-11-22T10:00:00.000Z",files:[{kind:"signer-copy",signerId:signer.id,id:"signer-copy-file"}]};
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{status:"Completed",signers:[signer],completion,mirrorStatus:"Completed"});
  let calls=0;
  f.ctx.persistCompletedSignatureEnvelope=async()=>{calls++;};
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(calls,1);
  assert.equal(status.status,"Completed");
  assert.equal(status.mirrorSync.status,"updated");
  assert.equal(status.mirrorStatus,"Completed");
});

test("owner refresh refuses to mirror Completed while any required signer remains pending",async()=>{
  const f=await fixture();
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{status:"Completed",completion:{primaryStorageId:"missing",finalHash:"invalid",completedAt:"2026-11-22T10:00:00.000Z",files:[]}});
  let calls=0;
  f.ctx.persistCompletedSignatureEnvelope=async()=>{calls++;};
  await assert.rejects(()=>getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId),/every required signer as signed/);
  assert.equal(calls,0);
});


test("owner refresh reports a Firebase mirror failure instead of silently claiming a successful refresh",async()=>{
  const f=await fixture();
  f.ctx.persistSignerProgress=async()=>{throw new Error("private Firestore transport detail");};
  await assert.rejects(()=>getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId),/Firebase status synchronization failed/);
});
