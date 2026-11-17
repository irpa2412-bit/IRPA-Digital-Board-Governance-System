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
    signers:[{uid:"signer-uid",identityType:"email-link",email:"signer@example.test",name:"Assigned Signer",title:"Board Secretary",routingPosition:1}],
    fields:[{fieldId:"SIGN-1",type:"Signature",page:1,x:10,y:10,width:25,height:10,signerUid:"signer-uid",required:true}]
  });
  return{ctx,sent,created,externalReference};
}

test("signing invitation body uses real line breaks and a token-gated email link",()=>{
  const message=buildEmailSigningInvitationMessage({name:"Assigned Signer",link:"https://irpa.example.test/?emailSignToken=token",title:"Invitation test",ownerName:"Document Owner",role:"Board Secretary",action:"Sign",fieldCount:1,expiresAt:"2026-11-24T12:00:00.000Z"});
  assert.ok(message.text.includes("\n\n"));
  assert.doesNotMatch(message.text,/\\n/);
  assert.equal(message.subject,"Signature requested: Invitation test");
  assert.match(message.text,/No account is needed/);
});

test("initial Gateway invitation contains the portal envelope ID and a one-time signer token",async()=>{
  const f=await fixture();
  assert.equal(f.sent.length,1);
  const url=new URL(f.sent[0].link);
  assert.equal(url.pathname,"/");
  assert.equal(url.searchParams.get("signEnvelope"),null);
  assert.match(url.searchParams.get("emailSignToken"),/^ENV-[0-9a-f]+\.S1\.[0-9a-f]{64}$/);
});

test("owner can resend a failed or missing Gateway invitation with a rotated token",async()=>{
  const f=await fixture();
  const original=new URL(f.sent[0].link).searchParams.get("emailSignToken");
  const result=await resendInvitation(f.ctx,{uid:"owner-uid",isAdmin:false},f.created.envelopeId,"S1");
  assert.equal(result.deliveryStatus,"Sent");
  assert.equal(f.sent.length,2);
  const replacement=new URL(f.sent[1].link);
  assert.equal(replacement.pathname,"/");
  assert.notEqual(replacement.searchParams.get("emailSignToken"),original);
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
