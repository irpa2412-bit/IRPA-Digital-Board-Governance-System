import test from "node:test";
import assert from "node:assert/strict";
import { persistCompletedSignatureEnvelope } from "../src/signatureMirror.mjs";

test("completion mirror creates a signer-specific signature register record from each archived signer copy", async () => {
  const documents = new Map([["signatureEnvelopes/IRPA-ENV-TEST", {
    id:"IRPA-ENV-TEST",documentId:"DOC-TEST",documentReference:"IRPA-DOC-TEST",recordOrigin:"TRIAL",trialData:true,
    title:"Test governance resolution",signers:[]
  }]]);
  const writes = [];
  const getDocument = async path => documents.get(path) || null;
  const updateDocument = async (path, fields) => {
    writes.push({path,fields});
    documents.set(path,{...(documents.get(path)||{}),...fields});
  };
  await persistCompletedSignatureEnvelope({
    envelope:{
      id:"ENV-TEST",externalReference:"IRPA-ENV-TEST",documentId:"DOC-TEST",title:"Test governance resolution",
      signers:[
        {id:"S1",uid:null,identityType:"email-link",name:"Chair",email:"chair@example.test",role:"Review",signerDeclarations:{name:"Chair",title:"Board Chairperson"},status:"Signed",signedAt:"2026-11-15T10:00:00.000Z"},
        {id:"S2",uid:null,identityType:"email-link",name:"Secretary",email:"secretary@example.test",role:"Review",signerDeclarations:{name:"Secretary",title:"Board Secretary"},status:"Signed",signedAt:"2026-11-15T10:01:00.000Z"}
      ]
    },
    completion:{
      finalHash:"a".repeat(64),completedAt:"2026-11-15T10:02:00.000Z",
      primaryStorageId:"archive-file",
      files:[
        {kind:"archive",archiveKey:"board-governance",id:"archive-file"},
        {kind:"signer-copy",signerId:"S1",id:"chair-copy"},
        {kind:"signer-copy",signerId:"S2",id:"secretary-copy"}
      ]
    },
    getDocument,updateDocument,now:()=>"2026-11-15T10:02:01.000Z"
  });
  const chair = writes.find(x=>x.path==="signatures/gateway-IRPA-ENV-TEST-S1")?.fields;
  const secretary = writes.find(x=>x.path==="signatures/gateway-IRPA-ENV-TEST-S2")?.fields;
  assert.equal(chair.recordOrigin,"TRIAL");
  assert.equal(chair.trialData,true);
  assert.equal(chair.signerArchiveFileId,"chair-copy");
  assert.equal(chair.signatureAuthority,"");
  assert.equal(chair.signatureAuthorityVerificationStatus,"NotRequired");
  assert.equal(chair.signerDeclarations.title,"Board Chairperson");
  assert.equal(chair.signerArchiveUrl,"https://drive.google.com/file/d/chair-copy/view");
  assert.equal(chair.cryptographicEvidenceStatus,"GatewayAuditOnly","mirror must not claim cryptographic verification without a signer evidence record");
  assert.equal(secretary.signerArchiveFileId,"secretary-copy");
  assert.equal(secretary.signatureAuthority,"");
  assert.equal(secretary.signatureAuthorityVerificationStatus,"NotRequired");
  assert.equal(secretary.signerDeclarations.title,"Board Secretary");
  assert.equal(secretary.status,"Signed");
});


test("email signer mirror includes signer ID, declarations and verified per-signer evidence",async()=>{
  const writes=[];
  const envelope={id:"ENV-EMAIL",externalReference:"IRPA-ENV-EMAIL",documentId:"DOC-EMAIL",signers:[{
    id:"S1",identityType:"email-link",uid:null,email:"external@example.test",name:"External Signer",status:"Signed",signedAt:"2026-11-16T15:10:00.000Z",
    declaredParticulars:{name:"Owner Name",title:"Supplier"},
    signerDeclarations:{name:"External Name",title:"Consultant"},
    declarationDiscrepancy:{detected:true,fields:["name","title"],ownerDeclared:{name:"Owner Name",title:"Supplier"},signerDeclared:{name:"External Name",title:"Consultant"}}
  }]};
  await persistCompletedSignatureEnvelope({
    envelope,
    completion:{finalHash:"d".repeat(64),completedAt:"2026-11-16T15:11:00.000Z",primaryStorageId:"archive-email",files:[{kind:"signer-copy",signerId:"S1",id:"external-copy"}],signerEvidence:[{signerId:"S1",evidenceId:"CRYPTO-EMAIL-1",identityType:"email-link"}]},
    getDocument:async()=>({documentId:"DOC-EMAIL"}),
    updateDocument:async(path,fields)=>writes.push({path,fields}),
    now:()=>"2026-11-16T15:11:01.000Z"
  });
  const record=writes.find(item=>item.path==="signatures/gateway-IRPA-ENV-EMAIL-S1")?.fields;
  assert.ok(record);
  assert.equal(record.signerUid,null);
  assert.equal(record.signerId,"S1");
  assert.equal(record.signerIdentityType,"email-link");
  assert.equal(record.cryptographicEvidenceStatus,"Verified");
  assert.equal(record.signatureAuthority,"");
  assert.equal(record.signatureAuthorityVerificationStatus,"NotRequired");
  assert.deepEqual(record.ownerDeclaredParticulars,{name:"Owner Name",title:"Supplier"});
  assert.deepEqual(record.signerDeclarations,{name:"External Name",title:"Consultant"});
  assert.equal(record.declarationDiscrepancy.detected,true);
});

test("completion mirror fails closed when an assigned signer archive copy is missing", async () => {
  const updates=[];
  await assert.rejects(()=>persistCompletedSignatureEnvelope({
    envelope:{id:"ENV-MISSING",externalReference:"IRPA-ENV-MISSING",documentId:"DOC-MISSING",signers:[
      {id:"S1",uid:"signer-uid",name:"Signer",email:"signer@example.test",status:"Signed"}
    ]},
    completion:{finalHash:"b".repeat(64),completedAt:"2026-11-15T10:02:00.000Z",primaryStorageId:"archive-file",files:[{kind:"archive",id:"archive-file"}]},
    getDocument:async path=>path==="signatureEnvelopes/IRPA-ENV-MISSING"?{documentId:"DOC-MISSING"}:null,
    updateDocument:async(path,fields)=>updates.push({path,fields})
  }),/archive copy is missing/);
  assert.equal(updates.some(x=>x.path.startsWith("signatures/")),false);
});
