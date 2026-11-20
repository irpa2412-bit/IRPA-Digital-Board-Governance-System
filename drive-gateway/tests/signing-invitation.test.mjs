import test from "node:test";
import assert from "node:assert/strict";
import { buildEsignContext } from "../src/esignContext.mjs";
import { createEnvelope, getEnvelopeStatus, resendInvitation, revokeInvitation, openEmailSigning, openSigning } from "../src/signing.mjs";
import { sha256Hex } from "../src/util.mjs";
import { route as esignRoute } from "../src/router.mjs";
import { buildInvitationMessage } from "../src/invitationEmail.mjs";

async function fixture({failResend=false,emailLink=false}={}) {
  const sent=[];
  const logs=[];
  let calls=0;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
    verifyUser:async()=>null,
    sendInvitation:async invitation=>{calls++;if(failResend&&calls>1)throw Object.assign(new Error("IRPA SMTP error 535: authentication failed"),{code:"EAUTH"});sent.push(invitation);},
    logger:{error:(event,details)=>logs.push({event,details})}
  });
  const bytes=new TextEncoder().encode("%PDF-1.7\nIRPA test PDF");
  const source=await ctx.storage.put({path:"source/test.pdf",bytes,contentType:"application/pdf",metadata:{}});
  const documentId="DOC-INV-"+Date.now()+"-"+Math.random().toString(16).slice(2,8);
  await ctx.meta.create("documents",documentId,{
    id:documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:source.id,
    sha256:await sha256Hex(bytes),fileName:"test.pdf",title:"Invitation test",classification:"Restricted"
  });
  const externalReference="IRPA-ENV-"+Date.now()+"-"+Math.random().toString(16).slice(2,8);
  const created=await createEnvelope(ctx,{uid:"owner-uid",isAdmin:false},{
    documentId,externalReference,title:"Invitation test",classification:"Restricted",
    archives:["board-governance"],signingMode:"Sequential",
    signers:[emailLink?{identityType:"email-link",email:"signer@example.test",name:"Assigned Signer",order:1}:{uid:"signer-uid",email:"signer@example.test",name:"Assigned Signer",order:1}],
    fields:[{fieldId:"SIGN-1",type:"Signature",page:1,x:10,y:10,width:25,height:10,...(emailLink?{signerId:"S1"}:{signerUid:"signer-uid"}),required:true}]
  });
  return{ctx,sent,created,externalReference,logs};
}

test("Gateway invitation plain-text body uses real line breaks, not escaped newline text",()=>{
  const message=buildInvitationMessage({name:"Assigned Signer",link:"https://irpa.example.test/sign?gatewayToken=token&signEnvelope=IRPA-ENV-1"});
  assert.ok(message.text.includes("\n\n"));
  assert.doesNotMatch(message.text,/\\n/);
});

test("initial Gateway invitation contains the portal envelope ID and a one-time signer token",async()=>{
  const f=await fixture();
  assert.equal(f.sent.length,1);
  const url=new URL(f.sent[0].link);
  assert.equal(url.pathname,"/sign");
  assert.equal(url.searchParams.get("signEnvelope"),f.externalReference);
  assert.match(url.searchParams.get("gatewayToken"),/^ENV-[0-9a-f]+\.S1\.[0-9a-f]{64}$/);
});

test("owner can resend a failed or missing Gateway invitation with a rotated token",async()=>{
  const f=await fixture();
  const original=new URL(f.sent[0].link).searchParams.get("gatewayToken");
  const result=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(result.deliveryStatus,"Sent");
  assert.equal(f.sent.length,2);
  const replacement=new URL(f.sent[1].link);
  assert.equal(replacement.searchParams.get("signEnvelope"),f.externalReference);
  assert.notEqual(replacement.searchParams.get("gatewayToken"),original);
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.signers[0].invitation,"Sent");
});

test("failed Gateway invitation retry preserves the previous delivery state and does not report delivery success",async()=>{
  const f=await fixture({failResend:true});
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),/could not be delivered/);
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.signers[0].invitation,"Sent","a failed replacement must not overwrite the previous accepted delivery state");
  const diagnostic=f.logs.find(item=>item.event==="SIGNING_INVITATION_DELIVERY_FAILED");
  assert.ok(diagnostic,"SMTP failure must be recorded in Gateway logs");
  assert.equal(diagnostic.details.smtpResponseCode,535);
  assert.equal(diagnostic.details.failureClass,"permanent-provider-rejection");
  assert.equal(diagnostic.details.retryable,false);
  assert.equal(JSON.stringify(diagnostic).includes("signer@example.test"),false);
});

test("another user cannot resend a signer invitation",async()=>{
  const f=await fixture();
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"intruder-uid",isAdmin:false},f.created.envelopeId,"S1"),/Not authorized/);
});


test("email-link signer receives the email-signing URL and redeems the exact one-time token",async()=>{
  const f=await fixture({emailLink:true});
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].emailLink,true);
  const url=new URL(f.sent[0].link);
  assert.equal(url.pathname,"/");
  const token=url.searchParams.get("emailSignToken");
  assert.match(token,/^ENV-[0-9a-f]+\.S1\.[0-9a-f]{64}$/);
  assert.equal(url.searchParams.has("gatewayToken"),false);
  const opened=await openEmailSigning(f.ctx,token,"192.0.2.10");
  assert.equal(opened.ok,true);
  assert.equal(opened.signer.email,"signer@example.test");
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.signers[0].emailLinkStatus,"opened");
});

test("email-link resend rotates the bearer token and makes the prior invitation unusable",async()=>{
  const f=await fixture({emailLink:true});
  const first=new URL(f.sent[0].link).searchParams.get("emailSignToken");
  await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  const second=new URL(f.sent[1].link).searchParams.get("emailSignToken");
  assert.notEqual(second,first);
  await assert.rejects(()=>openEmailSigning(f.ctx,first,"192.0.2.11"),/This link was replaced\. Please use the newest email\./);
  const opened=await openEmailSigning(f.ctx,second,"192.0.2.12");
  assert.equal(opened.ok,true);
});


test("failed email-link resend keeps the previously delivered bearer link usable",async()=>{
  const f=await fixture({failResend:true,emailLink:true});
  const first=new URL(f.sent[0].link).searchParams.get("emailSignToken");
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),/could not be delivered/i);
  const opened=await openEmailSigning(f.ctx,first,"192.0.2.22");
  assert.equal(opened.ok,true);
  assert.equal(opened.signer.id,"S1");
});

test("owner can replace invited, opened, legacy-expiry-metadata, revoked, failed and interrupted unsigned email links",async()=>{
  const states=["invited","opened","legacy-expiry-metadata","revoked","send-failed","interrupted"];
  for(const state of states){
    const f=await fixture({emailLink:true});
    const oldLink=new URL(f.sent[0].link).searchParams.get("emailSignToken");
    if(state==="opened"||state==="interrupted")await openEmailSigning(f.ctx,oldLink,"192.0.2.31");
    if(state==="legacy-expiry-metadata"){const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);const signer={...current.signers[0],tokenExpiresAt:"2000-01-01T00:00:00.000Z",emailLinkExpiresAt:"2000-01-01T00:00:00.000Z"};await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:[signer]},{ifVersion:current._v});}
    if(state==="revoked")await revokeInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
    if(state==="send-failed"){const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:[{...current.signers[0],invitation:"Failed",deliveryStageCode:"SMTP_AUTH"}]},{ifVersion:current._v});}
    if(state==="interrupted"){const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);assert.equal(current.signers[0].status,"Pending");assert.equal(current.signers[0].emailLinkStatus,"opened");assert.equal(current.signers[0].partialSignature,undefined);}
    const sent=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
    assert.equal(sent.deliveryStatus,"Sent",state);assert.equal(sent.linkExpiresAt,null,state);assert.equal(sent.expiresAt,undefined,state);
    const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
    assert.equal(current.signers[0].emailLinkStatus,"issued",state);assert.equal(current.signers[0].status,"Pending",state);
    assert.equal(current.signers[0].tokenExpiresAt,undefined,state);assert.equal(current.signers[0].emailLinkExpiresAt,undefined,state);
    await assert.rejects(()=>openEmailSigning(f.ctx,oldLink,"192.0.2.32"),/This link was replaced\. Please use the newest email\./,state);
    const newLink=new URL(f.sent[1].link).searchParams.get("emailSignToken");
    const opened=await openEmailSigning(f.ctx,newLink,"192.0.2.33");assert.equal(opened.ok,true,state);
  }
});

test("owner can resend an expired account signer link with a fresh expiry",async()=>{
  const f=await fixture();
  const oldLink=new URL(f.sent[0].link).searchParams.get("gatewayToken");
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{expiresAt:"2000-01-01T00:00:00.000Z",signers:[{...current.signers[0],tokenExpiresAt:"2000-01-01T00:00:00.000Z"}]},{ifVersion:current._v});
  const sent=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  const newLink=new URL(f.sent[1].link).searchParams.get("gatewayToken");
  assert.notEqual(newLink,oldLink);assert.ok(Date.parse(sent.expiresAt)>Date.now());
  await assert.rejects(()=>openSigning(f.ctx,oldLink,{uid:"signer-uid"}),/This link was replaced\. Please use the newest email\./);
  const opened=await openSigning(f.ctx,newLink,{uid:"signer-uid"});assert.equal(opened.signer.id,"S1");
});

test("resend is restricted to the current sequence position and permits it once predecessors have signed",async()=>{
  const f=await fixture();
  const env=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const second={...env.signers[0],id:"S2",order:2,uid:"signer-two",name:"Second Signer",email:"second@example.test",tokenHash:await sha256Hex("second-token"),tokenExpiresAt:env.expiresAt};
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:[...env.signers,second]},{ifVersion:env._v});
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S2"),/not yet at the current signing position/i);
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:current.signers.map(s=>s.id==="S1"?{...s,status:"Signed",signedAt:"2026-11-19T12:00:00.000Z"}:s)},{ifVersion:current._v});
  const result=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S2");
  assert.equal(result.signerId,"S2");assert.match(new URL(f.sent.at(-1).link).searchParams.get("gatewayToken"),new RegExp("^"+f.created.envelopeId+"\\.S2\\."));
});

test("same email in separate signer positions keeps independent signer IDs and tokens",async()=>{
  const f=await fixture();
  const env=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const originalS1=env.signers[0].tokenHash;
  const second={...env.signers[0],id:"S2",order:1,uid:"another-identity",name:"Same Email, Different Role",tokenHash:await sha256Hex("second-token"),tokenExpiresAt:env.expiresAt};
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:[...env.signers,second]},{ifVersion:env._v});
  await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S2");
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  assert.equal(current.signers.find(s=>s.id==="S1").tokenHash,originalS1);
  assert.match(new URL(f.sent.at(-1).link).searchParams.get("gatewayToken"),new RegExp("^"+f.created.envelopeId+"\\.S2\\."));
});

test("a signed signer or completed/cancelled envelope cannot receive a replacement link",async()=>{
  const f=await fixture();
  const env=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  await f.ctx.meta.update("envelopes",f.created.envelopeId,{signers:[{...env.signers[0],status:"Signed"}]},{ifVersion:env._v});
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),/completed signing/);
  for(const status of ["Completed","Cancelled"]){
    const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
    await f.ctx.meta.update("envelopes",f.created.envelopeId,{status,signers:[{...current.signers[0],status:"Pending"}]},{ifVersion:current._v});
    await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),/completed or cancelled/i);
  }
});

test("failed replacement reports the SMTP stage and preserves the prior link",async()=>{
  const f=await fixture({emailLink:true});
  const original=new URL(f.sent[0].link).searchParams.get("emailSignToken");
  const current=await f.ctx.meta.get("envelopes",f.created.envelopeId);
  const originalTokenHash=current.signers[0].tokenHash;
  const originalSend=f.ctx.sendInvitation;
  f.ctx.sendInvitation=async invitation=>{if(invitation.signerId==="S1")throw Object.assign(new Error("SMTP authentication failed"),{stageCode:"SMTP_AUTH"});return originalSend(invitation)};
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),error=>error.code==="SMTP_AUTH");
  const afterFailure=await f.ctx.meta.get("envelopes",f.created.envelopeId);assert.equal(afterFailure.signers[0].tokenHash,originalTokenHash);
  const opened=await openEmailSigning(f.ctx,original,"192.0.2.44");assert.equal(opened.ok,true);
});

test("replaced email signing links show the explicit replacement notice through the public open route",async()=>{
  const f=await fixture({emailLink:true});
  const oldLink=new URL(f.sent[0].link).searchParams.get("emailSignToken");
  await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  const response=await esignRoute(new Request("https://irpa.example.test/api/sign/email/open",{headers:{"x-signing-token":oldLink}}),f.ctx);
  assert.equal(response.status,410);
  const body=await response.json();
  assert.equal(body.error,"This link was replaced. Please use the newest email.");
});
