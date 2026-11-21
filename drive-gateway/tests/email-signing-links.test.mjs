import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmailSigningToken,
  inspectEmailSigningToken,
  markEmailSigningTokenOpened,
  consumeEmailSigningToken,
  revokeEmailSigningToken,
  hashNormalizedEmail,
  resolveEmailSignerAuthority,
  genericEmailSigningFailure
} from "../src/emailSigningLinks.mjs";
import { sha256Hex } from "../src/util.mjs";
import { validateSignatureDraftRecipients } from "../src/signatureDraftPolicy.mjs";
import { canAuthenticatedSignerAccess } from "../src/signing.mjs";
import fs from "node:fs";
import {buildEmailSigningInvitationMessage,sendEmailSigningInvitation,sendWithRetry} from "../src/invitationEmail.mjs";
import {resolveOptionalEmailLinkProfileUid,resendInvitation,chainEvents,createEnvelope,recordEmailLinkStage,getEnvelopeStatus} from "../src/signing.mjs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {runEmailStage,EMAIL_LINK_STAGE_CODES} from "../src/invitationEmail.mjs";
import {route as esignRoute,makeContext} from "../src/router.mjs";

const NOW = new Date("2026-11-16T08:00:00.000Z");

test("email signing invitation clearly states its EAT expiry",()=>{
  const message=buildEmailSigningInvitationMessage({name:"A Signer",link:"https://irpa.example.test/?emailSignToken=token",title:"Board Policy",ownerName:"Document Owner",expiresAt:"2026-11-23T08:00:00.000Z"});
  assert.match(message.text,/Link expiry:.*EAT/i);
  assert.match(message.text,/after expiry or replacement/i);
  assert.match(message.html,/Link expiry:.*EAT/i);
});

test("email token has at least 32 random bytes and only its SHA-256 hash is persisted", async () => {
  const issued = await createEmailSigningToken({envelopeId:"ENV-TEST01",signerId:"S1",email:"Signer@Example.org",now:NOW});
  assert.ok(issued.tokenBytes >= 32);
  assert.equal(issued.record.tokenHash, await sha256Hex(issued.token));
  assert.equal(issued.record.emailHash, await hashNormalizedEmail("signer@example.org"));
  assert.equal(issued.record.envelopeId,"ENV-TEST01");
  assert.equal(issued.record.signerId,"S1");
  assert.equal(issued.record.status,"issued");
  assert.equal(issued.record.expiresAt,undefined,"the standalone token primitive does not own envelope expiry");
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

test("standalone email token inspection remains separate from envelope expiry policy", async () => {
  const issued=await createEmailSigningToken({envelopeId:"ENV-TEST03",signerId:"S1",email:"a@example.org",now:NOW});
  const result=await inspectEmailSigningToken(issued.token,issued.record,new Date("2027-11-16T08:00:01.000Z"));
  assert.equal(result.ok,true);
  assert.equal(result.record,issued.record);
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

test("authority is derived from an active register email match and matrix role, never client-supplied role", async () => {
  const result=resolveEmailSignerAuthority({
    email:"Board.Secretary@Example.org",
    memberRecords:[{id:"m1",email:"board.secretary@example.org",status:"Active",role:"Board Secretary"}],
    employeeRecords:[],
    matrix:[{role:"Board Secretary",canSign:true,active:true}],
    now:NOW
  });
  assert.equal(result.verified,true);
  assert.equal(result.authorityRole,"Board Secretary");
  const denied=resolveEmailSignerAuthority({
    email:"board.secretary@example.org",
    memberRecords:[{id:"m1",email:"board.secretary@example.org",status:"Inactive",role:"Board Secretary"}],
    employeeRecords:[],
    matrix:[{role:"Board Secretary",canSign:true,active:true}],
    now:NOW
  });
  assert.equal(denied.verified,false);
});

test("email hashing normalizes whitespace and case", async () => {
  assert.equal(await hashNormalizedEmail("  Person@Example.org "),await hashNormalizedEmail("person@example.org"));
});

test("shared delivery email is allowed while duplicate signer identity remains blocked", () => {
  assert.equal(validateSignatureDraftRecipients([{uid:"person-1",email:"shared@example.org"},{uid:"person-2",email:" SHARED@example.org "}],"Sequential"),null);
  assert.match(validateSignatureDraftRecipients([{uid:"person-1",email:"a@example.org"},{uid:"person-1",email:"b@example.org"}],"Sequential"),/Duplicate signer UID/);
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

test("failed SMTP invitation stages retain structured diagnostics for the sender report",async()=>{
  const captured=[];
  const failure=Object.assign(new Error("IRPA SMTP error 535"),{smtpResponseCode:535,smtpEnhancedStatusCode:"5.7.8",smtpReplyCategory:"AUTH_FAILED",stageCode:"SMTP_AUTH"});
  await assert.rejects(()=>sendEmailSigningInvitation({
    email:"signer@gmail.com",name:"Gmail Signer",link:"https://irpa.example.test/?emailSignToken=secret",title:"Board Policy",ownerName:"Document Owner",
    smtpSend:async ({onStage})=>runEmailStage("SMTP_AUTH",async()=>{throw failure},onStage),
    onStage:async(stage,outcome,category,diagnostics)=>captured.push({stage,outcome,category,diagnostics}),
    logger:{error(){}},sleep:async()=>{}
  }),/535/);
  assert.equal(captured.length,1);
  assert.deepEqual(captured[0],{stage:"SMTP_AUTH",outcome:"failure",category:"AUTH_FAILED",diagnostics:{stageCode:"SMTP_AUTH",smtpResponseCode:535,smtpEnhancedStatusCode:"5.7.8",errorCode:null,deliveryOutcome:"not-confirmed"}});
});

test("failed invitation delivery generates a dedicated sender report and exposes recipient-level failures",async()=>{
  const reports=[];
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
    verifyUser:async()=>null,
    sendInvitation:async invitation=>{
      await invitation.onStage("SMTP_AUTH","failure","AUTH_FAILED",{smtpResponseCode:535,smtpEnhancedStatusCode:"5.7.8"});
      throw Object.assign(new Error("IRPA SMTP error 535"),{stageCode:"SMTP_AUTH",smtpResponseCode:535,smtpEnhancedStatusCode:"5.7.8",smtpReplyCategory:"AUTH_FAILED"});
    },
    logger:{error(){}}
  });
  ctx.sendDeliveryReport=async report=>reports.push(report);
  const bytes=new TextEncoder().encode("%PDF-1.7\\nIRPA sender delivery report test");
  const stored=await ctx.storage.put({path:"source/delivery-report.pdf",bytes,contentType:"application/pdf",metadata:{}});
  await ctx.meta.create("documents","DOC-DELIVERY-REPORT",{id:"DOC-DELIVERY-REPORT",status:"Stored",ownerUid:"owner",primaryStorageId:stored.id,sha256:await sha256Hex(bytes),fileName:"delivery-report.pdf",title:"Delivery Report Test",classification:"Restricted"});
  const created=await createEnvelope(ctx,{uid:"owner",email:"owner@example.org",name:"Document Owner",isAdmin:false},{documentId:"DOC-DELIVERY-REPORT",title:"Delivery Report Test",archives:["board-governance"],signingMode:"Sequential",signers:[{identityType:"email-link",email:"signer@gmail.com",name:"Gmail Signer",order:1}],fields:[{fieldId:"SIGN-REPORT",type:"Signature",page:1,x:10,y:10,width:25,height:10,signerId:"S1",required:true}]});
  assert.equal(reports.length,1);
  assert.equal(reports[0].to,"owner@example.org");
  assert.match(reports[0].subject,/email delivery failure report/i);
  assert.match(reports[0].text,/signer@gmail.com/);
  assert.match(reports[0].text,/SMTP_AUTH/);
  assert.match(reports[0].text,/535/);
  assert.doesNotMatch(JSON.stringify(reports[0]),/emailSignToken|secret/);
  const status=await getEnvelopeStatus(ctx,{uid:"owner",isAdmin:false},created.envelopeId);
  assert.equal(status.deliveryReport.failed,1);
  assert.equal(status.deliveryReport.failures[0].email,"signer@gmail.com");
  assert.equal(status.deliveryReport.failures[0].smtpReplyCategory,"AUTH_FAILED");
  assert.equal(status.deliveryReport.failures[0].smtpResponseCode,535);
  assert.equal(status.deliveryReport.reportStatus,"sent");
  assert.equal(status.auditChainValid,true);
});

test("mail delivery is delegated once to the existing Worker invitation sender", () => {
  const source = fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/sendWithRetry\s*\(/);
  assert.match(source,/smtpSend\(env,\{to:email,subject,text,html:htmlBody\}\)/);
});


test("email-link invitations retry transient SMTP 4xx responses but do not retry permanent 5xx responses",async()=>{
  let attempts=0;
  const accepted=await sendWithRetry(async()=>{attempts++;if(attempts<3)throw new Error("IRPA SMTP error 451");return "250 2.0.0 accepted";},{sleep:async()=>{},logger:{error(){}}});
  assert.equal(accepted,"250 2.0.0 accepted");
  assert.equal(attempts,3,"temporary provider throttling is retried within the bounded policy");
  attempts=0;
  await assert.rejects(()=>sendWithRetry(async()=>{attempts++;throw new Error("IRPA SMTP error 550");},{sleep:async()=>{},logger:{error(){}}}),/550/);
  assert.equal(attempts,1,"permanent recipient rejection is not retried");
  const source=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/return sendInvitationWithRetry\(\(\)=>smtpSend\(env,\{to,subject,text,html,onStage\}\),\{logger:console\}\);/);
});

test("profile lookup errors and a 3-second timeout never block an unregistered signer invitation",async()=>{
  async function attempt(resolveEmailLinkProfileUid,suffix){
    const sent=[];
    const ctx=buildEsignContext({
      env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
      verifyUser:async()=>null,
      sendInvitation:async invitation=>sent.push(invitation),
      logger:{error(){}}
    });
    ctx.resolveEmailLinkProfileUid=resolveEmailLinkProfileUid;
    const bytes=new TextEncoder().encode("%PDF-1.7\\nIRPA optional profile test");
    const source=await ctx.storage.put({path:`source/${suffix}.pdf`,bytes,contentType:"application/pdf",metadata:{}});
    const documentId=`DOC-OPT-${suffix}`;
    await ctx.meta.create("documents",documentId,{id:documentId,status:"Stored",ownerUid:"owner",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"test.pdf",title:"Profile lookup test",classification:"Restricted"});
    const created=await createEnvelope(ctx,{uid:"owner",isAdmin:false},{documentId,title:"Profile lookup test",archives:["board-governance"],signingMode:"Sequential",signers:[{identityType:"email-link",email:"unregistered@example.org",name:"Unregistered Signer",order:1}],fields:[{fieldId:"SIGN-1",type:"Signature",page:1,x:10,y:10,width:25,height:10,signerId:"S1",required:true}]});
    assert.equal(sent.length,1);
    assert.equal(sent[0].to,"unregistered@example.org");
    assert.equal(sent[0].name,"Unregistered Signer");
    assert.match(sent[0].link,/emailSignToken=/);
    const status=await (await import("../src/signing.mjs")).getEnvelopeStatus(ctx,{uid:"owner",isAdmin:false},created.envelopeId);
    assert.equal(status.signers[0].profileUid??null,null);
  }
  await attempt(async()=>{throw new Error("profile service unavailable")},"THROW");
  await attempt(()=>new Promise(()=>{}),"TIMEOUT");
});

test("three positions sharing one mailbox retain separate signer IDs, token hashes, and invitation deliveries",async()=>{
  const mailbox="shared@example.org",deliveries=[];
  const signers=[];
  for(let index=1;index<=3;index++){
    const signerId=`S${index}`;
    const issued=await createEmailSigningToken({envelopeId:"ENV-SHARED01",signerId,email:mailbox,now:NOW});
    signers.push({id:signerId,token:issued.token,tokenHash:issued.record.tokenHash});
    deliveries.push({to:mailbox,signerId,token:issued.token});
  }
  assert.deepEqual(signers.map(x=>x.id),["S1","S2","S3"]);
  assert.equal(new Set(signers.map(x=>x.token)).size,3);
  assert.equal(new Set(signers.map(x=>x.tokenHash)).size,3);
  assert.equal(deliveries.length,3);
  assert.deepEqual(deliveries.map(x=>x.signerId),["S1","S2","S3"]);
  assert.ok(deliveries.every(x=>x.to===mailbox));
});

test("email signing token rejects a different signer ID and an incorrect token",async()=>{
  const issued=await createEmailSigningToken({envelopeId:"ENV-IDENTITY01",signerId:"S1",email:"a@example.org",now:NOW});
  const wrongSigner=`ENV-IDENTITY01.S2.${issued.token.split(".")[2]}`;
  const wrongToken=`ENV-IDENTITY01.S1.${"0".repeat(64)}`;
  assert.equal((await inspectEmailSigningToken(wrongSigner,issued.record,NOW)).ok,false);
  assert.equal((await inspectEmailSigningToken(wrongToken,issued.record,NOW)).ok,false);
});

test("failed resend preserves the previous active email-link token",async()=>{
  const originalHash="a".repeat(64),events=await chainEvents([],{type:"envelope.created",at:NOW.toISOString(),actor:"owner"});
  let record={_v:1,id:"ENV-RESEND01",createdBy:"owner",status:"Active",title:"Test",ownerName:"Owner",signers:[{id:"S1",email:"signer@example.org",name:"Signer",order:1,status:"Pending",identityType:"email-link",emailLinkStatus:"issued",tokenHash:originalHash,emailLinkTokenHistory:[],invitation:"Sent"}],events};
  const ctx={
    meta:{
      get:async(collection,id)=>collection==="envelopes"&&id===record.id?structuredClone(record):null,
      update:async(collection,id,patch,{ifVersion})=>{assert.equal(ifVersion,record._v);record={...record,...structuredClone(patch),_v:record._v+1};}
    },
    now:()=>NOW,
    config:{appUrl:"https://irpa.example.org",emailLinkTtlDays:7},
    sendInvitation:async()=>{throw new Error("SMTP unavailable")},
    logger:{error(){}}
  };
  await assert.rejects(()=>resendInvitation(ctx,{uid:"owner",email:"owner@example.org"},record.id,"S1"),/could not be delivered/i);
  assert.equal(record.signers[0].tokenHash,originalHash);
  assert.equal(record.signers[0].emailLinkStatus,"issued");
  assert.deepEqual(record.signers[0].emailLinkTokenHistory,[]);
});


test("concurrent signer resends are serialized and the delivered token is the persisted active token",async()=>{
  const originalHash="a".repeat(64),events=await chainEvents([],{type:"envelope.created",at:NOW.toISOString(),actor:"owner"});
  let record={_v:1,id:"ENV-RESEND-RACE",createdBy:"owner",status:"Active",title:"Test",ownerName:"Owner",signers:[{id:"S1",email:"signer@example.org",name:"Signer",order:1,status:"Pending",identityType:"email-link",emailLinkStatus:"issued",tokenHash:originalHash,tokenExpiresAt:"2026-11-23T08:00:00.000Z",emailLinkExpiresAt:"2026-11-23T08:00:00.000Z",emailLinkTokenHistory:[],invitation:"Sent"}],events};
  let releaseSend,markSendStarted;
  const sendStarted=new Promise(resolve=>{markSendStarted=resolve});
  const holdSend=new Promise(resolve=>{releaseSend=resolve});
  const sent=[];
  const ctx={
    meta:{
      get:async(collection,id)=>collection==="envelopes"&&id===record.id?structuredClone(record):null,
      update:async(collection,id,patch,{ifVersion})=>{assert.equal(ifVersion,record._v);record={...record,...structuredClone(patch),_v:record._v+1};}
    },
    now:()=>NOW,
    config:{appUrl:"https://irpa.example.org",emailLinkTtlDays:7},
    sendInvitation:async invitation=>{sent.push(invitation);markSendStarted();await holdSend;},
    logger:{error(){}}
  };
  const first=resendInvitation(ctx,{uid:"owner",email:"owner@example.org"},record.id,"S1");
  await sendStarted;
  await assert.rejects(()=>resendInvitation(ctx,{uid:"owner",email:"owner@example.org"},record.id,"S1"),/already in progress/i);
  assert.equal(record.signers[0].tokenHash,originalHash,"old link remains active while delivery is pending");
  releaseSend();
  const result=await first;
  const deliveredToken=new URL(sent[0].link).searchParams.get("emailSignToken");
  assert.equal(record.signers[0].tokenHash,await sha256Hex(deliveredToken.split(".")[2]));
  assert.equal(record.signers[0].tokenExpiresAt,result.expiresAt);
  assert.equal(record.signers[0].emailLinkExpiresAt,result.expiresAt);
  assert.equal(record.signers[0].emailLinkStatus,"issued");
  assert.equal(record.signers[0].resendAttempt,undefined);
  assert.equal(record.signers[0].emailLinkTokenHistory.at(-1).tokenHash,originalHash);
});

test("every SMTP and email-link failure stage returns only its sanitized stage code",async()=>{
  for(const stage of EMAIL_LINK_STAGE_CODES){
    const events=[];
    await assert.rejects(()=>runEmailStage(stage,async()=>{throw new Error("IRPA SMTP error 535 recipient private@example.org password=do-not-log")},async(code,outcome,category)=>events.push({code,outcome,category})),error=>{
      assert.equal(error.stageCode,stage);
      assert.doesNotMatch(error.message,/private@example\.org|password=|do-not-log/i);
      return true;
    });
    assert.deepEqual(events,[{code:stage,outcome:"failure",category:stage==="SMTP_AUTH"?"AUTH_FAILED":"UNKNOWN"}]);
  }
});

test("email-link delivery stages are appended individually to the envelope audit chain without email or token data",async()=>{
  const ctx=buildEsignContext({env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test"},verifyUser:async()=>null,sendInvitation:async()=>{},logger:{error(){}}});
  const events=await chainEvents([],{type:"envelope.created",at:NOW.toISOString(),actor:"owner"});
  await ctx.meta.create("envelopes","ENV-STAGE01",{id:"ENV-STAGE01",createdBy:"owner",status:"Active",signers:[{id:"S1",identityType:"email-link"}],events});
  for(const stage of EMAIL_LINK_STAGE_CODES)await recordEmailLinkStage(ctx,"ENV-STAGE01","S1",stage,"success",stage==="SMTP_AUTH"?"AUTH_FAILED":"UNKNOWN");
  const record=await ctx.meta.get("envelopes","ENV-STAGE01");
  const stages=record.events.filter(event=>event.type==="email_link.stage");
  assert.deepEqual(stages.map(event=>event.stage),EMAIL_LINK_STAGE_CODES);
  assert.ok(stages.every(event=>event.outcome==="success"&&event.signerId==="S1"));
  assert.equal(stages.find(event=>event.stage==="SMTP_AUTH").smtpReplyCategory,"AUTH_FAILED");
  assert.doesNotMatch(JSON.stringify(stages),/private@example\.org|emailSignToken|password|tokenHash|tokenValue/i);
});

test("smtp-selfcheck rejects non-admin and non-owner callers before invoking SMTP",async()=>{
  let sends=0;
  const ctx=makeContext({verifyUser:async()=>({uid:"ordinary-user",isAdmin:false,isOwner:false}),smtpSelfCheck:async()=>{sends++;return{ok:true}}});
  const response=await esignRoute(new Request("https://irpa.example.org/api/sign/smtp-selfcheck",{method:"POST"}),ctx);
  assert.equal(response.status,403);
  assert.equal(sends,0);
});

test("smtp-selfcheck permits an authenticated system owner and invokes exactly one send",async()=>{
  let sends=0;
  const ctx=makeContext({verifyUser:async()=>({uid:"system-owner",isAdmin:false,isOwner:true}),smtpSelfCheck:async()=>{sends++;return{ok:true,stageCode:"SUBMIT"}}});
  const response=await esignRoute(new Request("https://irpa.example.org/api/sign/smtp-selfcheck",{method:"POST"}),ctx);
  assert.equal(response.status,200);
  assert.equal(sends,1);
  assert.deepEqual(await response.json(),{ok:true,stageCode:"SUBMIT"});
});


test("createEnvelope sends three distinct email-link invitations to three signer positions sharing one mailbox",async()=>{
  const sent=[];
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
    verifyUser:async()=>null,
    sendInvitation:async invitation=>sent.push(invitation),
    logger:{error(){}}
  });
  const bytes=new TextEncoder().encode("%PDF-1.7\\nIRPA shared mailbox positions");
  const source=await ctx.storage.put({path:"source/shared-mailbox.pdf",bytes,contentType:"application/pdf",metadata:{}});
  await ctx.meta.create("documents","DOC-SHARED-THREE",{id:"DOC-SHARED-THREE",status:"Stored",ownerUid:"owner",primaryStorageId:source.id,sha256:await sha256Hex(bytes),fileName:"shared.pdf",title:"Shared mailbox test",classification:"Restricted"});
  const signers=[1,2,3].map(index=>({identityType:"email-link",email:"shared@example.org",name:`Signer ${index}`,order:1}));
  const fields=[1,2,3].map(index=>({fieldId:`SIGN-${index}`,type:"Signature",page:1,x:10,y:10,width:25,height:10,signerId:`S${index}`,required:true}));
  const created=await createEnvelope(ctx,{uid:"owner",isAdmin:false},{documentId:"DOC-SHARED-THREE",title:"Shared mailbox test",archives:["board-governance"],signingMode:"Parallel",signers,fields});
  assert.equal(created.invitations.length,3);
  assert.equal(sent.length,3);
  const tokens=sent.map(invitation=>new URL(invitation.link).searchParams.get("emailSignToken"));
  assert.deepEqual(tokens.map(token=>token.split(".")[1]),["S1","S2","S3"]);
  assert.equal(new Set(tokens).size,3);
  assert.ok(sent.every(invitation=>invitation.to==="shared@example.org"&&invitation.emailLink===true));
});


test("parallel-mode signer can receive a resend without waiting for earlier signer positions",async()=>{
  const events=await chainEvents([],{type:"envelope.created",at:NOW.toISOString(),actor:"owner"});
  let record={_v:1,id:"ENV-PARALLEL-RESEND",createdBy:"owner",status:"Active",signingMode:"Parallel",title:"Parallel Test",ownerName:"Owner",signers:[
    {id:"S1",email:"first@example.org",name:"First",order:1,status:"Pending",identityType:"email-link",emailLinkStatus:"issued",tokenHash:"a".repeat(64),invitation:"Sent"},
    {id:"S2",email:"second@example.org",name:"Second",order:2,status:"Pending",identityType:"email-link",emailLinkStatus:"issued",tokenHash:"b".repeat(64),invitation:"Sent"}
  ],events};
  const sent=[];
  const ctx={
    meta:{
      get:async(collection,id)=>collection==="envelopes"&&id===record.id?structuredClone(record):null,
      update:async(collection,id,patch,{ifVersion})=>{assert.equal(ifVersion,record._v);record={...record,...structuredClone(patch),_v:record._v+1};}
    },
    now:()=>NOW,
    config:{appUrl:"https://irpa.example.org",emailLinkTtlDays:7},
    sendInvitation:async invitation=>{sent.push(invitation);},
    logger:{error(){}}
  };
  const result=await resendInvitation(ctx,{uid:"owner",email:"owner@example.org"},record.id,"S2");
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"second@example.org");
  assert.equal(record.signers[1].invitation,"Sent");
  assert.equal(record.signers[1].tokenHash,await sha256Hex(new URL(sent[0].link).searchParams.get("emailSignToken").split(".")[2]));
  assert.equal(result.signerId,"S2");
});
