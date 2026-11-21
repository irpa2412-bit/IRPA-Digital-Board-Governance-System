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
import {buildEmailSigningInvitationMessage,buildSignerInvitationSubject,buildSigningInvitationAuditMessage,sendEmailSigningInvitation,sendWithRetry,validateRecipient} from "../src/invitationEmail.mjs";
import {resolveOptionalEmailLinkProfileUid,resendInvitation,resendAllUnsignedInvitations,chainEvents,createEnvelope,recordEmailLinkStage} from "../src/signing.mjs";
import {buildEsignContext} from "../src/esignContext.mjs";
import {runEmailStage,EMAIL_LINK_STAGE_CODES} from "../src/invitationEmail.mjs";
import {buildSmtpRecipientEnvelope} from "../src/mailDelivery.js";
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
import {buildEmailSigningInvitationMessage,buildSigningInvitationAuditMessage,sendEmailSigningInvitation,sendWithRetry,validateRecipient} from "../src/invitationEmail.mjs";
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


test("email-link invitations retry transient SMTP 4xx responses but do not retry permanent 5xx responses",async()=>{
  let attempts=0;
  const accepted=await sendWithRetry(async()=>{attempts++;if(attempts<3)throw new Error("IRPA SMTP error 451");return "250 2.0.0 accepted";},{sleep:async()=>{},logger:{error(){}}});
  assert.equal(accepted,"250 2.0.0 accepted");
  assert.equal(attempts,3,"temporary provider throttling is retried within the bounded policy");
  attempts=0;
  await assert.rejects(()=>sendWithRetry(async()=>{attempts++;throw new Error("IRPA SMTP error 550");},{sleep:async()=>{},logger:{error(){}}}),/550/);
  assert.equal(attempts,1,"permanent recipient rejection is not retried");
  const source=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/return sendInvitationWithRetry\(\(\)=>smtpSend\(env,\{to,subject,text,html,fromName:"IRPA Digital Signing",onStage\}\),\{logger:console\}\);/);
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
  assert.equal(result.signingLink,sent[0].link,"the returned sharing URL must be the exact link delivered to this signer");
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

test("production signing mail uses a signer-position subject, IRPA signing sender name and unique Message-ID/date headers",()=>{
  const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  const mime=fs.readFileSync(new URL("../src/mailDelivery.js",import.meta.url),"utf8");
  assert.match(worker,/buildSignerInvitationSubject/);
  assert.match(worker,/fromName:"IRPA Digital Signing"/);
  assert.match(worker,/Message-ID: /);
  assert.match(worker,/Date: /);
  assert.match(worker,/@irpa\.or\.tz/);
  assert.match(mime,/Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime,/Content-Type: text\/html; charset=UTF-8/);
  assert.match(mime,/Content-Type: multipart\/alternative/);
});

test("owner/admin SMTP self-check accepts a typed recipient and rejects other roles before sending",()=>{
  const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(worker,/const body=await request\.json\(\)\.catch\(\(\)=>null\)/);
  assert.match(worker,/const to=validateRecipient\(body\?\.to\)/);
  assert.match(worker,/!active\|\|!\["administrator","owner"\]\.includes\(role\)/);
  assert.match(worker,/messageId,stages/);
});


test("typed signer addresses are trimmed and lower-cased; display names and multiple recipients are rejected",()=>{
  assert.equal(validateRecipient("  Alice.Example@GMAIL.COM  "),"alice.example@gmail.com");
  assert.equal(validateRecipient("Alice Example <alice@gmail.com>"),null);
  assert.equal(validateRecipient("alice@gmail.com, second@gmail.com"),null);
  const smtp=buildSmtpRecipientEnvelope({from:'"IRPA Digital Signing" <administrator@irpa.or.tz>',to:"  Alice.Example@GMAIL.COM  ",subject:"Please sign: Board Minute - Alice",text:"plain",html:"<p>html</p>"});
  assert.equal(smtp.recipient,"alice.example@gmail.com");
  assert.equal(smtp.rcptCommand,"RCPT TO:<alice.example@gmail.com>");
  assert.match(smtp.mime,/^To: <alice\.example@gmail\.com>$/m);
  assert.equal((smtp.mime.match(/^To:/gm)||[]).length,1);
  assert.throws(()=>buildSmtpRecipientEnvelope({from:"a@irpa.or.tz",to:"alice@gmail.com,bob@gmail.com",subject:"x",text:"x",html:"<p>x</p>"}),/valid recipient/i);
});

test("signing audit email exposes only the first three address characters and no recipient domain",()=>{
  const audit=buildSigningInvitationAuditMessage({recipientPrefix:"dan",position:2,positionCount:3,title:"Board Minutes",envelopeId:"ENV-PRIVACY01",messageId:"<unique@irpa.or.tz>",smtpReplyCategory:"ACCEPTED",at:NOW});
  assert.equal(audit.to,"info@irpa.or.tz");
  assert.equal(audit.subject,"AUDIT: invitation to dan... position 2 of 3 - Board Minutes");
  assert.match(audit.text,/Position: 2 of 3/);
  assert.match(audit.text,/ACCEPTED/);
  assert.match(audit.text,/EAT/);
  assert.doesNotMatch(audit.subject+" "+audit.text+" "+audit.html,/daniel|gmail\.com|emailSignToken|https?:\/\/|[a-f0-9]{64}/i);
});


test("parallel creation, resend and resend-all preserve each typed signer address through SMTP RCPT TO and To header",async()=>{
  const typed=["  Owner.Gmail@Example.org ","second@example.org","OWNER.GMAIL@example.org"];
  const expected=typed.map(value=>value.trim().toLowerCase());
  const sent=[];
  const owner={uid:"owner",email:"owner@irpa.or.tz",name:"Document Owner",isAdmin:false};
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
    verifyUser:async()=>null,
    sendInvitation:async invitation=>{
      const envelope=buildSmtpRecipientEnvelope({
        from:'"IRPA Digital Signing" <sender@irpa.or.tz>',
        to:invitation.to,
        subject:"Please sign: Shared mailbox test - Signer",
        text:"Invitation text",
        html:"<p>Invitation text</p>"
      });
      const toHeader=envelope.mime.match(/^To: <([^>]+)>$/m)?.[1]||null;
      sent.push({...invitation,smtpRecipient:envelope.recipient,rcptCommand:envelope.rcptCommand,toHeader});
      return "250 2.0.0 accepted";
    },
    logger:{error(){}}
  });
  ctx.resolveEmailLinkProfileUid=async()=> "profile-for-another-person";
  const bytes=new TextEncoder().encode("%PDF-1.7\nIRPA exact recipient route test");
  const source=await ctx.storage.put({path:"source/exact-recipient.pdf",bytes,contentType:"application/pdf",metadata:{}});
  await ctx.meta.create("documents","DOC-EXACT-RECIPIENT",{
    id:"DOC-EXACT-RECIPIENT",status:"Stored",ownerUid:owner.uid,
    primaryStorageId:source.id,sha256:await sha256Hex(bytes),
    fileName:"exact-recipient.pdf",title:"Shared mailbox test",classification:"Restricted"
  });
  const signers=typed.map((email,index)=>({
    identityType:"email-link",email,name:"Signer "+(index+1),order:index+1
  }));
  const fields=signers.map((signer,index)=>({
    fieldId:"EXACT-SIGN-"+(index+1),type:"Signature",page:1,x:10,y:10,width:25,height:10,
    signerId:"S"+(index+1),required:true
  }));
  const created=await createEnvelope(ctx,owner,{
    documentId:"DOC-EXACT-RECIPIENT",title:"Shared mailbox test",
    archives:["board-governance"],signingMode:"Parallel",signers,fields
  });
  const stored=await ctx.meta.get("envelopes",created.envelopeId);
  assert.equal(sent.length,3,"parallel mode must invite every signer position at creation");
  assert.deepEqual(stored.signers.map(signer=>signer.email),expected,"signer records and envelope recipients must retain the typed address after trim/lower-case");
  for(let index=0;index<expected.length;index++){
    assert.equal(stored.signers[index].emailHash,await hashNormalizedEmail(expected[index]),"the token record email hash must bind to the typed address");
    assert.equal(sent[index].to,expected[index],"the invitation sender must use the signer row address, never a profile or owner substitution");
    assert.equal(sent[index].smtpRecipient,expected[index]);
    assert.equal(sent[index].rcptCommand,"RCPT TO:<"+expected[index]+">");
    assert.equal(sent[index].toHeader,expected[index],"the To header must contain exactly the same single recipient as SMTP RCPT TO");
    console.log("MOCK SMTP recipient",JSON.stringify({position:index+1,typed:typed[index],rcptTo:sent[index].rcptCommand,toHeader:sent[index].toHeader}));
  }
  assert.equal(new Set(sent.map(item=>item.toHeader)).size,2,"two positions may share one mailbox without collapsing signer positions");
  const resent=await resendInvitation(ctx,owner,created.envelopeId,"S2");
  assert.equal(resent.signingLink,sent.at(-1).link,"the owner receives only the exact same signer-specific link accepted by SMTP");
  assert.equal(sent.at(-1).to,expected[1],"single-signer resend must use that signer's own stored address");
  assert.equal(sent.at(-1).rcptCommand,"RCPT TO:<"+expected[1]+">");
  assert.equal(sent.at(-1).toHeader,expected[1]);
  const resentAll=await resendAllUnsignedInvitations(ctx,owner,created.envelopeId);
  assert.equal(resentAll.attempted,3);
  assert.equal(resentAll.failed,0);
  assert.ok(resentAll.results.every(item=>!Object.prototype.hasOwnProperty.call(item,"signingLink")),"bulk resend must not expose every bearer link in its aggregate response");
  assert.deepEqual(sent.slice(-3).map(item=>item.to),expected,"resend-all must address each unsigned signer position independently");
  assert.deepEqual(sent.slice(-3).map(item=>item.rcptCommand),expected.map(email=>"RCPT TO:<"+email+">"));
  assert.deepEqual(sent.slice(-3).map(item=>item.toHeader),expected);
});

test("signing invitation recipient validation rejects display names and comma-separated recipient lists",()=>{
  assert.equal(validateRecipient("Signer <signer@example.org>"),null);
  assert.equal(validateRecipient("one@example.org,two@example.org"),null);
  assert.equal(validateRecipient("signer@example.org,"),null);
  assert.equal(validateRecipient("  Signer@Example.org  "),"signer@example.org");
});

test("invitation audit message includes only a three-character recipient prefix and required delivery evidence",()=>{
  const audit=buildSigningInvitationAuditMessage({
    recipientPrefix:"daniel",position:2,positionCount:3,
    title:"Board Policy",envelopeId:"ENV-AUDIT-01",messageId:"<unique@irpa.or.tz>",
    smtpReplyCategory:"ACCEPTED",at:NOW
  });
  assert.equal(audit.to,"info@irpa.or.tz");
  assert.equal(audit.subject,"AUDIT: invitation to dan... position 2 of 3 - Board Policy");
  assert.match(audit.text,/Time \\(EAT\\):/);
  assert.match(audit.text,/Position: 2 of 3/);
  assert.match(audit.text,/Message-ID: <unique@irpa\\.or\\.tz>/);
  assert.match(audit.text,/SMTP reply category: ACCEPTED/);
  assert.doesNotMatch(JSON.stringify(audit),/daniel@example\\.org|example\\.org|emailSignToken|https?:\\/\\/|secret-token/i);
});


test("signing invitation uses one distinct Message-ID per signer position and the exact ordinal subject",()=>{
  const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(worker,/const messageId="<"\+crypto\.randomUUID\(\)\+"@irpa\.or\.tz>"/);
  assert.match(worker,/buildSignerInvitationSubject/);
  assert.match(worker,/fromName:"IRPA Digital Signing"/);
  assert.match(worker,/Message-ID: /);
  assert.match(worker,/Date: /);
});

test("audit send is best-effort and never changes invitation acceptance or failure",()=>{
  const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(worker,/try\{await onAudit\?\.\(\{messageId,lastCategory/);
  assert.match(worker,/SIGNING_INVITATION_AUDIT_EMAIL_FAILED/);
  assert.match(worker,/if\(failure\)throw failure;\s*return result;/);
});

test("signing SMTP messages use a unique Message-ID, named From, and separate plain-text and HTML parts",()=>{
  const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  const mail=fs.readFileSync(new URL("../src/mailDelivery.js",import.meta.url),"utf8");
  assert.match(worker,/const messageId="<"\+crypto\.randomUUID\(\)\+"@irpa\.or\.tz>"/);
  assert.match(worker,/buildSignerInvitationSubject\\(\\{title:safeTitle,position,positionCount,name:safeName\\}\\)/);
  assert.match(worker,/fromName:"IRPA Digital Signing"/);
  assert.match(worker,/Message-ID: "\+generatedMessageId/);
  assert.equal((worker.match(/await onAudit\?\./g)||[]).length,1,"each invitation attempt must make one non-blocking audit attempt");
  assert.match(mail,/Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mail,/Content-Type: text\/html; charset=UTF-8/);
});


test("failed invitation audit includes both the failure stage code and SMTP reply category",()=>{
  const audit=buildSigningInvitationAuditMessage({
    recipientPrefix:"abc",position:2,positionCount:3,title:"Board Policy",
    envelopeId:"ENV-FAIL-AUDIT",messageId:"<failed@irpa.or.tz>",
    smtpReplyCategory:"AUTH_FAILED",stageCode:"SMTP_AUTH",at:NOW
  });
  assert.equal(audit.subject,"AUDIT: invitation to abc... position 2 of 3 - Board Policy");
  assert.match(audit.text,/Stage code: SMTP_AUTH/);
  assert.match(audit.text,/SMTP reply category: AUTH_FAILED/);
  assert.doesNotMatch(audit.text,/abc@example\\.com|emailSignToken|https?:\\/\\//);
});


test("three shared-mailbox signer positions produce three distinct exact subjects",()=>{
  const subjects=[1,2,3].map(position=>buildSignerInvitationSubject({title:"Shared Mailbox Agreement",position,positionCount:3,name:"Daniel Mollel"}));
  assert.deepEqual(subjects,[
    "Please sign: Shared Mailbox Agreement (signer 1 of 3) - Daniel",
    "Please sign: Shared Mailbox Agreement (signer 2 of 3) - Daniel",
    "Please sign: Shared Mailbox Agreement (signer 3 of 3) - Daniel"
  ]);
  assert.equal(new Set(subjects).size,3);
});
