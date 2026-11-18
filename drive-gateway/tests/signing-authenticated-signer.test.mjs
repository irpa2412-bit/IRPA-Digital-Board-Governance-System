import assert from "node:assert/strict";
import test from "node:test";
import {canAuthenticatedSignerAccess,validateEnvelopeFields} from "../src/signing.mjs";

test("unbound legacy signers are rejected; email-link identity requires redeemed invitation",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:null,identityType:"legacy-token"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:undefined,identityType:"legacy-token"},undefined),false);
  assert.equal(canAuthenticatedSignerAccess({uid:null,identityType:"email-link",emailLinkStatus:"issued"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:null,identityType:"email-link",emailLinkStatus:"opened"},null),true);
});

test("UID-bound signer requires the matching authenticated UID",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"other-user"}),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-123"}),true);
});

test("UID-bound signer comparison is exact and cannot be bypassed by email alone",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-123",email:"different@example.com"}),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-124",email:"member@example.com"}),false);
});

import {createHash} from "node:crypto";
import {createEnvelope,sign} from "../src/signing.mjs";
import {readFileSync} from "node:fs";
const pdfSource=readFileSync(new URL("../src/pdf.mjs",import.meta.url),"utf8");
const signingSource=readFileSync(new URL("../src/signing.mjs",import.meta.url),"utf8");

test("staging signing does not require IRPA register authority but retains signer authentication and declarations",async()=>{
  const secret="a".repeat(64);
  const hash=createHash("sha256").update(secret).digest("hex");
  const envelope={
    id:"ENV-staging-test",
    documentId:"DOC-staging-test",
    documentHash:"unused-before-source-check",
    expiresAt:"2999-01-01T00:00:00.000Z",
    status:"Sent",
    signingMode:"Sequential",
    events:[],
    signers:[{id:"S1",uid:"staging-user",identityType:"account",status:"Pending",order:1,tokenHash:hash}]
  };
  const ctx={
    env:{IRPA_ENVIRONMENT:"staging"},
    now:()=>new Date("2026-10-24T00:00:00.000Z"),
    meta:{get:async(collection,id)=>collection==="envelopes"&&id===envelope.id?envelope:null},
    storage:{get:async()=>null}
  };
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      declarations:{name:"Staging Test Signer",occupation:"Independent Test Signer"},
      user:{uid:"other-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===403&&error.message==="Sign in as the invited signer to continue."
  );
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      declarations:{name:"Staging Test Signer",occupation:"Independent Test Signer"},
      user:{uid:"staging-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===409&&error.message==="The source document is unavailable."
  );
  await assert.rejects(
    sign(ctx,{
      token:envelope.id+".S1."+secret,
      signature:{type:"typed",value:"Staging test signer"},
      consent:true,
      user:{uid:"staging-user",email:"staging@example.invalid",token:"staging-id-token"}
    }),
    error=>error?.status===400&&error.message==="Enter your name before signing."
  );
});

test("production Gateway envelope rejects non-email-link signer identities",async()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\\naccount signer test");
  const documentHash=createHash("sha256").update(bytes).digest("hex");
  const document={id:"DOC-account-test",ownerUid:"owner-uid",status:"Stored",primaryStorageId:"source",sha256:documentHash,fileSize:bytes.byteLength};
  const ctx={env:{IRPA_ENVIRONMENT:"production",DRIVE_MOCK:"false"},config:{ttlDays:7,emailLinkTtlDays:7,appUrl:"https://irpa.or.tz"},now:()=>new Date("2026-11-17T10:15:30.000Z"),storage:{get:async id=>id==="source"?bytes:null},sendInvitation:async()=>{},meta:{get:async(collection,id)=>collection==="documents"&&id===document.id?document:null,create:async()=>{},update:async()=>{}}};
  await assert.rejects(()=>createEnvelope(ctx,{uid:"owner-uid",email:"owner@irpa.or.tz",name:"Owner"},{documentId:document.id,archives:["board-governance"],signingMode:"Sequential",signers:[{identityType:"account",uid:"account-signer-1",email:"signer@irpa.or.tz",name:"Account Signer",order:1}],fields:[{fieldId:"signature-1",type:"Signature",signerUid:"account-signer-1",page:1,x:10,y:80,width:24,height:9,required:true}]}),error=>error?.status===400&&error.message==="Every staging and production signer must use a verified email-link identity.");
});

test("assigned Date field is persisted from the Gateway signedAt timestamp, not the device value",async()=>{
  const secret="b".repeat(64),tokenHash=createHash("sha256").update(secret).digest("hex");
  const bytes=new TextEncoder().encode("%PDF-1.7\\nauthoritative date test");
  const documentHash=createHash("sha256").update(bytes).digest("hex");
  const envelope={
    id:"ENV-date-test",documentId:"DOC-date-test",documentHash,expiresAt:"2999-01-01T00:00:00.000Z",
    status:"Sent",signingMode:"Sequential",events:[],_v:1,
    signers:[
      {id:"S1",uid:"signer-uid",identityType:"account",status:"Pending",order:1,tokenHash},
      {id:"S2",uid:"next-signer",identityType:"account",status:"Pending",order:2,tokenHash:"c".repeat(64)}
    ],
    fields:[{fieldId:"date-1",type:"Date",page:1,x:10,y:80,width:24,height:6,signerId:"S1",signerUid:"signer-uid",required:true}]
  };
  const document={id:envelope.documentId,status:"Stored",ownerUid:"owner-uid",primaryStorageId:"source",sha256:documentHash,fileSize:bytes.byteLength};
  const at="2026-11-17T10:15:30.000Z";
  const ctx={
    env:{IRPA_ENVIRONMENT:"production"},
    now:()=>new Date(at),
    storage:{get:async id=>id==="source"?bytes:null},
    meta:{
      get:async(collection,id)=>collection==="envelopes"&&id===envelope.id?envelope:collection==="documents"&&id===document.id?document:null,
      update:async(collection,id,patch)=>{assert.equal(collection,"envelopes");assert.equal(id,envelope.id);Object.assign(envelope,patch);envelope._v++;}
    }
  };
  const result=await sign(ctx,{token:envelope.id+".S1."+secret,signature:{type:"typed",value:"Account Signer"},fieldValues:{"date-1":"wrong device clock"},consent:true,declarations:{name:"Account Signer",occupation:"Test Signer"},user:{uid:"signer-uid",email:"signer@irpa.or.tz",token:"verified-id-token"}});
  assert.equal(result.status,"InProgress");
  assert.equal(envelope.signers[0].signedAt,at);
  assert.equal(envelope.signers[0].fieldValues["date-1"],at);
});

test("signed PDF Date fields are rendered from the server UTC signing timestamp",()=>{
  assert.match(signingSource,/if\(assignedToSigner&&field\.type==="Date"\)signedFieldValues\[field\.fieldId\]=at/);
  assert.match(signingSource,/s\.fieldValues=signedFieldValues/);
  assert.match(pdfSource,/field\.type === "Date" && serverDateTime/);
  assert.match(pdfSource,/new Date\(signer\.signedAt\)\.toISOString\(\)/);
  assert.match(pdfSource,/UTC/);
});


test("Gateway preserves distinct signature-field responsibility indexes for one email-link signer",()=>{
  const signers=[{id:"S1",identityType:"email-link",roleAssignments:[{role:"Attendance"},{role:"Chairperson"}]}];
  const fields=validateEnvelopeFields([
    {fieldId:"F-ATTENDANCE",type:"Signature",signerId:"S1",roleAssignmentIndex:0,page:1,x:10,y:10,width:20,height:8},
    {fieldId:"F-CHAIR",type:"Signature",signerId:"S1",roleAssignmentIndex:1,page:2,x:10,y:10,width:20,height:8}
  ],signers);
  assert.deepEqual(fields.map(field=>field.roleAssignmentIndex),[0,1]);
  assert.throws(()=>validateEnvelopeFields([
    {fieldId:"F-INVALID",type:"Signature",signerId:"S1",roleAssignmentIndex:2,page:1,x:10,y:10,width:20,height:8}
  ],signers),/invalid or assigned/i);
  assert.throws(()=>validateEnvelopeFields([
    {fieldId:"F-MALFORMED",type:"Signature",signerId:"S1",roleAssignmentIndex:"second",page:1,x:10,y:10,width:20,height:8}
  ],signers),/invalid or assigned/i);
});
