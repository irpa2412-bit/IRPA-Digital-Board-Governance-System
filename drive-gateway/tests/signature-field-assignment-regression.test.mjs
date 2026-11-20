import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createEnvelope,openEmailSigning,openSigning} from "../src/signing.mjs";

const bytes=new TextEncoder().encode("%PDF-1.7\nIRPA signer assignment regression fixture");
const hash=createHash("sha256").update(bytes).digest("hex");
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test("Gateway envelope creation and openSigning retain three shared-email identities and nine assigned fields",async()=>{
  const document={id:"DOC-FIELD-ASSIGNMENT",ownerUid:"owner-uid",status:"Stored",primaryStorageId:"source",sha256:hash,fileSize:bytes.byteLength,title:"Assignment regression"};
  const store={};
  const invitations=[];
  const ctx={
    env:{IRPA_ENVIRONMENT:"test"},
    config:{ttlDays:7,emailLinkTtlDays:7,appUrl:"https://irpa.example.test"},
    now:()=>new Date("2026-11-19T12:00:00.000Z"),
    storage:{get:async id=>id==="source"?bytes:null},
    sendInvitation:async message=>{invitations.push(message);},
    meta:{
      get:async(collection,id)=>collection==="documents"&&id===document.id?document:collection==="envelopes"?store[id]||null:null,
      create:async(collection,id,value)=>{if(collection==="envelopes")store[id]={...value,_v:1};},
      update:async(collection,id,patch)=>{Object.assign(store[id],patch);store[id]._v++;}
    }
  };
  const recipients=[
    {identityType:"email-link",email:"shared@example.test",name:"Person A",roleAssignments:[{role:"Chair"}],order:1},
    {identityType:"email-link",email:"shared@example.test",name:"Person B",roleAssignments:[{role:"Secretary"}],order:1},
    {identityType:"email-link",email:"shared@example.test",name:"Person C",roleAssignments:[{role:"Treasurer"}],order:1}
  ];
  const fields=recipients.flatMap((recipient,index)=>Array.from({length:3},(_,n)=>({
    fieldId:`S${index+1}-F${n+1}`,type:"Signature",signerId:`S${index+1}`,
    page:[1,2,3,4][(index+n)%4],x:0.4225,y:0.385,width:0.125,height:0.032,
    coordinateSpace:"visible-page-fraction-v1",required:true
  })));
  const result=await createEnvelope(ctx,{uid:"owner-uid",email:"owner@example.test",name:"Owner"},{documentId:document.id,archives:["board-governance"],signingMode:"Parallel",signers:recipients,fields});
  assert.equal(result.ok,true);
  const envelope=store[result.envelopeId];
  assert.equal(envelope.signers.length,3);
  assert.equal(new Set(envelope.signers.map(s=>s.id)).size,3);
  assert.equal(new Set(envelope.signers.map(s=>s.email)).size,1);
  assert.equal(envelope.fields.length,9);
  assert.deepEqual(envelope.fields.map(f=>f.signerId),Array.from({length:3},(_,i)=>Array(3).fill(`S${i+1}`)).flat());
  for(let i=0;i<3;i++){
    const signer=envelope.signers[i];
    assert.equal(envelope.fields.filter(f=>f.signerId===signer.id).length,3);
    const invitation=invitations.find(item=>item.signerId===signer.id);
    assert.ok(invitation, "each unique signer identity receives its own invitation");
    const token=new URL(invitation.link).searchParams.get("emailSignToken");
    assert.ok(token);
    const session=await openEmailSigning(ctx,token,"192.0.2.10");
    const opened=await openSigning(ctx,session.sessionToken,null);
    assert.equal(opened.signer.id,signer.id);
    assert.equal(opened.fields.length,3);
    assert.ok(opened.fields.every(field=>field.signerId===signer.id));
    for(const field of opened.fields){
      assert.ok(field.width>0&&field.height>0);
      assert.equal(field.page,[1,2,3,4][(i+Number(field.fieldId.slice(-1))-1)%4]);
      close(field.x,0.4225);close(field.y,0.385);close(field.width,0.125);close(field.height,0.032);
    }
  }
});

test("Gateway rejects missing, unknown, or zero-size field assignments with the exact validation error",async()=>{
  const {validateEnvelopeFields}=await import("../src/signing.mjs");
  const signers=[{id:"S1",identityType:"email-link",roleAssignments:[{role:"Chair"}]}];
  for(const field of [
    {fieldId:"missing-signer",type:"Signature",page:1,x:0.1,y:0.1,width:0.2,height:0.1},
    {fieldId:"unknown-signer",type:"Signature",signerId:"S2",page:1,x:0.1,y:0.1,width:0.2,height:0.1},
    {fieldId:"zero-width",type:"Signature",signerId:"S1",page:1,x:0.1,y:0.1,width:0,height:0.1}
  ])assert.throws(()=>validateEnvelopeFields([field],signers),{status:400,message:"A signing field is invalid or assigned to an unauthorized signer."});
});
