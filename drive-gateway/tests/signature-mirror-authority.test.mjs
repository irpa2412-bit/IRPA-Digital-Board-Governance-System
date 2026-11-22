import test from "node:test";
import assert from "node:assert/strict";
import {persistCompletedSignatureEnvelope} from "../src/signatureMirror.mjs";

function fixture(authorityVerification=null){
  const docs=new Map([["signatureEnvelopes/IRPA-SIG-001",{
    documentId:"DOC-001",
    title:"Partner Agreement",
    signers:[{email:"signer@example.org",role:"Review",action:"Review"}]
  }]]);
  const updates=[];
  const envelope={
    id:"ENV-EMAIL-001",
    externalReference:"IRPA-SIG-001",
    title:"Partner Agreement",
    signers:[{
      id:"S1",uid:null,identityType:"email-link",name:"External Signer",email:"signer@example.org",
      status:"Signed",signedAt:"2026-11-17T09:00:00.000Z",
      declaredParticulars:{name:"External Signer",occupation:"Consultant",capacity:"Supplier"},
      signerDeclarations:{name:"External Signer",occupation:"Consultant",capacity:"Supplier"},
      declarationDiscrepancy:{detected:false,fields:[]},
      authorityVerification
    }]
  };
  const completion={
    primaryStorageId:"signed-pdf-id",
    finalHash:"final-pdf-hash",
    completedAt:"2026-11-17T09:01:00.000Z",
    files:[{kind:"signer-copy",signerId:"S1",id:"signer-copy-id"}],
    signerEvidence:[]
  };
  return {
    envelope,completion,updates,
    getDocument:async path=>docs.get(path)||null,
    updateDocument:async(path,data)=>{updates.push({path,data});docs.set(path,{...(docs.get(path)||{}),...data});}
  };
}

test("email-link signer declaration is preserved separately and never marked as verified authority",async()=>{
  const f=fixture();
  await persistCompletedSignatureEnvelope({...f,getDocument:f.getDocument,updateDocument:f.updateDocument,now:()=>"2026-11-17T09:02:00.000Z"});
  const signature=f.updates.find(item=>item.path.startsWith("signatures/"))?.data;
  assert.ok(signature);
  assert.equal(signature.signerUid,null);
  assert.equal(signature.signerIdentityType,"email-link");
  assert.equal(signature.workflowRole,"Review");
  assert.equal(signature.signatureAuthority,"");
  assert.equal(signature.signatureAuthorityVerificationStatus,"NotVerified");
  assert.equal(signature.signerDeclarations.occupation,"Consultant");
  assert.equal(signature.ownerDeclaredParticulars.occupation,"Consultant");
  const signerEvent=f.updates.find(item=>item.path.startsWith("signatureEvents/gateway-signed-"))?.data;
  assert.equal(signerEvent.actorUid,"");
  assert.equal(signerEvent.actorEmail,"signer@example.org");
  assert.equal(signerEvent.signerId,"S1");
});

test("authority is marked verified only when an explicit verified authority result is present",async()=>{
  const f=fixture({verified:true,authorityRole:"Board Secretary",sourceCollection:"employees",sourceRecordId:"employee-001"});
  await persistCompletedSignatureEnvelope({...f,getDocument:f.getDocument,updateDocument:f.updateDocument,now:()=>"2026-11-17T09:02:00.000Z"});
  const signature=f.updates.find(item=>item.path.startsWith("signatures/"))?.data;
  assert.equal(signature.signatureAuthority,"Board Secretary");
  assert.equal(signature.signatureAuthorityVerificationStatus,"Verified");
});
