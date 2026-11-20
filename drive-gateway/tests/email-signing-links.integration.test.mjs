import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {createEnvelope,openEmailSigning,getSigningPdf,resendInvitation,revokeInvitation,getEnvelopeStatus} from "../src/signing.mjs";
import {sha256Hex} from "../src/util.mjs";
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


test("owner signs in the portal before any other signer is invited; completing owner signature releases the next signer",async()=>{
  const sent=[];let now=NOW;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7"},
    now:()=>new Date(now),verifyUser:async()=>null,sendInvitation:async message=>sent.push(message),logger:{error(){}}
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

test("email-link signer is stored without time-based expiry; mail is sent once",async()=>{
  const f=await fixture();
  const signer=f.envelope.signers[0];
  assert.equal(signer.identityType,"email-link");
  assert.equal(signer.emailLinkStatus,"issued");
  assert.equal(signer.emailLinkAttemptCount,0);
  assert.equal(signer.emailLinkOpenCount,0);
  assert.equal(signer.emailLinkExpiresAt,undefined,"email-link invitations must not expire with time");
  assert.equal(signer.tokenExpiresAt,undefined,"email-link token must not inherit the envelope expiry");
  assert.equal(signer.tokenHash,await sha256Hex(f.token.split(".")[2]));
  assert.equal(signer.emailHash,await sha256Hex("board.secretary@example.org"));
  assert.equal(JSON.stringify(signer).includes(f.token.split(".")[2]),false);
  assert.equal(signer.authorityVerification,undefined);
  assert.equal(signer.name,"Client supplied name");
  assert.deepEqual(signer.declaredParticulars,{name:"Client supplied name",title:"",occupation:"",capacity:""});
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].expiresAt,undefined,"the dispatched signer invitation carries no time-based expiry");
  assert.match(f.sent[0].link,/emailSignToken=/);
  assert.match(f.sent[0].link,/\/\?emailSignToken=/);
});

test("email signing links have no time expiry but become unusable after use or revocation",async()=>{
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

test("email link remains valid after opening without signing and reopens from the same URL",async()=>{
  const f=await fixture();
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.8");
  assert.equal(opened.ok,true);
  assert.equal(opened.title,"Email Link Governance Instrument");
  assert.equal(opened.ownerName,"Document Owner");
  assert.equal(opened.sessionToken,f.token,"opening must not rotate or consume the email invitation");
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"opened");
  assert.equal(stored.signers[0].emailLinkOpenCount,1);
  assert.equal(stored.signers[0].tokenHash,await sha256Hex(f.token.split(".")[2]));
  const pdf=await getSigningPdf(f.ctx,f.token,null);
  assert.equal(pdf.fileName,"email-link.pdf");
  f.now(new Date("2027-11-16T08:00:00.000Z"));
  const reopened=await openEmailSigning(f.ctx,f.token,"198.51.100.8");
  assert.equal(reopened.ok,true,"the same opened-but-unused email link remains valid after one year");
  assert.equal(reopened.sessionToken,f.token);
  const reopenedEnvelope=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(reopenedEnvelope.signers[0].emailLinkOpenCount,2);
});

test("tampered and unknown links return the same neutral response",async()=>{
  const f=await fixture();
  const wrong=f.token.slice(0,-1)+(f.token.endsWith("0")?"1":"0");
  await assert.rejects(()=>openEmailSigning(f.ctx,wrong,"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  await assert.rejects(()=>openEmailSigning(f.ctx,"ENV-UNKNOWN.S1."+"a".repeat(64),"198.51.100.9"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("an unused email signing link remains valid indefinitely before and after opening despite legacy expiry fields",async()=>{
  const f=await fixture();
  const legacy=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  legacy.signers[0].emailLinkExpiresAt="2026-11-23T08:00:00.000Z";
  legacy.signers[0].tokenExpiresAt="2026-11-23T08:00:00.000Z";
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:legacy.signers});
  f.now(new Date("2027-11-24T08:00:00.000Z"));
  const opened=await openEmailSigning(f.ctx,f.token,"198.51.100.19");
  assert.equal(opened.ok,true,"the invitation remains valid more than one year after issue and ignores legacy expiry fields");
  assert.equal(opened.linkExpiresAt,null,"the signer invitation has no time-based expiry");
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"opened");
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.signers[0].linkExpiresAt,null);
  assert.equal(status.signers[0].linkExpired,false);
  f.now(new Date("2028-11-24T08:00:00.000Z"));
  const reopened=await openEmailSigning(f.ctx,f.token,"198.51.100.19");
  assert.equal(reopened.ok,true,"opening without signing does not expire the same email invitation");
  assert.equal(reopened.sessionToken,f.token);
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
  assert.equal(resent.linkExpiresAt,null,"resent email-link invitations remain non-expiring");
  assert.equal(f.sent[1].expiresAt,undefined,"resend must not add an expiry date");
  const newToken=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  assert.notEqual(newToken,oldToken);
  assert.notEqual(newToken,oldSession);
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(current.signers[0].emailLinkStatus,"issued");
  assert.equal(current.signers[0].emailLinkTokenHistory.at(-1).status,"replaced");
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
