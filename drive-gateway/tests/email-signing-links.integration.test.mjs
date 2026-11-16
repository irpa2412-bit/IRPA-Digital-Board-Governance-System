import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {createEnvelope,openEmailSigning,openSigning,getSigningPdf,resendInvitation,revokeInvitation,canAuthenticatedSignerAccess} from "../src/signing.mjs";
import {sha256Hex} from "../src/util.mjs";
import {genericEmailSigningFailure} from "../src/emailSigningLinks.mjs";

const NOW=new Date("2026-11-16T08:00:00.000Z");
async function fixture({authority=true,failMail=false,signers=null,fields=[]}={}) {
  const sent=[];
  let now=NOW;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test",IRPA_EMAIL_SIGNING_LINK_TTL_DAYS:"7"},
    now:()=>new Date(now),
    verifyUser:async()=>null,
    sendInvitation:async message=>{sent.push(message);if(failMail)throw new Error("SMTP rejected");},
    logger:{error(){}}
  });
  const bytes=new TextEncoder().encode("%PDF-1.7\nIRPA read-only email signing preview");
  const source=await ctx.storage.put({path:"source/email-link.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-EMAIL-"+Math.random().toString(16).slice(2,10);
  await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"email-link.pdf",title:"Email Link Governance Instrument",classification:"Restricted"});
  const created=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.org",name:"Document Owner",isAdmin:false},{documentId,externalReference:"IRPA-EXT-"+Math.random().toString(16).slice(2,10),archives:["board-governance"],signingMode:"Sequential",signers:signers||[{identityType:"email-link",email:"Board.Secretary@example.org",name:"Client supplied name",authorityRole:"Board Secretary",order:1,role:"Client supplied role"}],fields});
  const envelope=await ctx.meta.get("envelopes",created.envelopeId);
  const token=new URL(sent[0].link).searchParams.get("emailSignToken");
  return {ctx,sent,created,envelope,token,now:value=>{now=value}};
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
  const stored=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(stored.signers[0].emailLinkStatus,"opened");
  assert.equal(stored.signers[0].emailLinkOpenCount,1);
  const pdf=await getSigningPdf(f.ctx,f.token,null);
  assert.equal(pdf.fileName,"email-link.pdf");
  await assert.rejects(()=>openEmailSigning(f.ctx,f.token,"198.51.100.8"),new RegExp(genericEmailSigningFailure().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
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
  await revokeInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  const revoked=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(revoked.signers[0].emailLinkStatus,"revoked");
  await assert.rejects(()=>openEmailSigning(f.ctx,oldToken,"198.51.100.10"));
  const resent=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(resent.deliveryStatus,"Sent");
  const newToken=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  assert.notEqual(newToken,oldToken);
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(current.signers[0].emailLinkStatus,"issued");
  assert.equal(current.signers[0].emailLinkTokenHistory.at(-1).status,"revoked");
});

test("email-link assignment does not require a register or authority-matrix match",async()=>{
  const f=await fixture({authority:false});
  assert.equal(f.envelope.signers[0].identityType,"email-link");
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

test("invitation token exposes only its exact signer fields and never a saved signature profile",async()=>{
  const f=await fixture({
    signers:[
      {identityType:"email-link",email:"first@example.org",name:"First Assignee",order:1},
      {identityType:"email-link",email:"second@example.org",name:"Second Assignee",order:2}
    ],
    fields:[
      {fieldId:"first-signature",type:"Signature",signerId:"S1",page:1,x:10,y:10,width:20,height:8,required:true},
      {fieldId:"second-signature",type:"Signature",signerId:"S2",page:1,x:40,y:10,width:20,height:8,required:true}
    ]
  });
  await openEmailSigning(f.ctx,f.token,"198.51.100.22");
  const first=await openSigning(f.ctx,f.token,null);
  assert.deepEqual(first.fields.map(field=>field.fieldId),["first-signature"]);
  assert.equal(first.fields[0].signerId,"S1");
  assert.equal(first.signer.emailVerified,true);
  assert.equal(JSON.stringify(first).includes("signatureProfiles"),false);
  assert.equal(JSON.stringify(first).includes("signatureUrl"),false);
  const secondToken=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  await assert.rejects(()=>openSigning(f.ctx,f.created.envelopeId+".S2."+f.token.split(".")[2],null));
  await openEmailSigning(f.ctx,secondToken,"198.51.100.23");
  const second=await openSigning(f.ctx,secondToken,null);
  assert.deepEqual(second.fields.map(field=>field.fieldId),["second-signature"]);
  assert.equal(canAuthenticatedSignerAccess({identityType:"email-link",emailLinkStatus:"opened"},null),true);
  assert.equal(canAuthenticatedSignerAccess({identityType:"email-link",emailLinkStatus:"issued"},null),false);
});
