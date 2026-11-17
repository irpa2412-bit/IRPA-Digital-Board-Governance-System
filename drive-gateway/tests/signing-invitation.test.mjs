import test from "node:test";
import assert from "node:assert/strict";
import { buildEsignContext } from "../src/esignContext.mjs";
import { createEnvelope, getEnvelopeStatus, resendInvitation } from "../src/signing.mjs";
import { sha256Hex } from "../src/util.mjs";
import { buildEmailSigningInvitationMessage } from "../src/invitationEmail.mjs";

async function fixture({failResend=false}={}) {
  const sent=[];
  let calls=0;
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test",IRPA_APP_URL:"https://irpa.example.test"},
    verifyUser:async()=>null,
    sendInvitation:async invitation=>{calls++;if(failResend&&calls>1)throw new Error("SMTP unavailable");sent.push(invitation);},
    logger:{error(){}}
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
    signers:[{identityType:"email-link",email:"signer@example.test",name:"Assigned Signer",order:1}],
    fields:[{fieldId:"SIGN-1",type:"Signature",page:1,x:10,y:10,width:25,height:10,signerId:"S1",required:true}]
  });
  return{ctx,sent,created,externalReference};
}

test("Gateway invitation plain-text body uses real line breaks, not escaped newline text",()=>{
  const message=buildEmailSigningInvitationMessage({name:"Assigned Signer",link:"https://irpa.example.test/?emailSignToken=token",title:"Invitation test",ownerName:"Document Owner"});
  assert.ok(message.text.includes("\n\n"));
  assert.doesNotMatch(message.text,/\\n/);
});

test("initial Gateway invitation is a single-use email-link and does not use the account-activation route",async()=>{
  const f=await fixture();
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].emailLink,true);
  const url=new URL(f.sent[0].link);
  assert.equal(url.pathname,"/");
  assert.match(url.searchParams.get("emailSignToken"),/^ENV-[0-9a-f]+\.S1\.[0-9a-f]{64}$/);
  assert.equal(url.searchParams.has("gatewayToken"),false);
  assert.equal(url.searchParams.has("signEnvelope"),false);
});

test("owner can resend a failed or missing Gateway invitation with a rotated token",async()=>{
  const f=await fixture();
  const original=new URL(f.sent[0].link).searchParams.get("emailSignToken");
  const result=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(result.deliveryStatus,"Sent");
  assert.equal(f.sent.length,2);
  const replacement=new URL(f.sent[1].link);
  assert.notEqual(replacement.searchParams.get("emailSignToken"),original);
  assert.equal(replacement.searchParams.has("gatewayToken"),false);
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.signers[0].invitation,"Sent");
});

test("failed Gateway invitation retry remains explicitly Failed and does not report delivery success",async()=>{
  const f=await fixture({failResend:true});
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1"),/could not be delivered/);
  const status=await getEnvelopeStatus(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId);
  assert.equal(status.signers[0].invitation,"Failed");
});

test("another user cannot resend a signer invitation",async()=>{
  const f=await fixture();
  await assert.rejects(()=>resendInvitation(f.ctx,{uid:"intruder-uid",isAdmin:false},f.created.envelopeId,"S1"),/Not authorized/);
});
