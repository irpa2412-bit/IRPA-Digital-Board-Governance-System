import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { PDFDocument } from "pdf-lib";

const apiKey=process.env.STAGING_FIREBASE_WEB_API_KEY||"";
const project=process.env.STAGING_FIREBASE_PROJECT_ID||"";
const email=process.env.STAGING_CRYPTO_TEST_EMAIL||"";
const password=process.env.STAGING_CRYPTO_TEST_PASSWORD||"";
const authority=process.env.STAGING_CRYPTO_TEST_AUTHORITY||"";
const expectedUid=process.env.STAGING_CRYPTO_TEST_SIGNER_UID||"";
const expectedKeyId=process.env.STAGING_CRYPTO_TEST_KEY_ID||"";
const base=String(process.env.STAGING_GATEWAY_URL||"").replace(/\/+$/,"");
for(const [name,value] of Object.entries({STAGING_FIREBASE_WEB_API_KEY:apiKey,STAGING_FIREBASE_PROJECT_ID:project,STAGING_CRYPTO_TEST_EMAIL:email,STAGING_CRYPTO_TEST_PASSWORD:password,STAGING_CRYPTO_TEST_AUTHORITY:authority,STAGING_CRYPTO_TEST_SIGNER_UID:expectedUid,STAGING_CRYPTO_TEST_KEY_ID:expectedKeyId,STAGING_GATEWAY_URL:base}))assert.ok(value,name+" is required.");
assert.notEqual(project,"irpa-digital-board-governance","Production Firebase project is forbidden in staging acceptance.");

const loginResponse=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+encodeURIComponent(apiKey),{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({email,password,returnSecureToken:true})
});
const login=await loginResponse.json().catch(()=>({}));
assert.equal(loginResponse.ok,true,"Staging test account sign-in failed: "+(login.error?.message||loginResponse.status));
assert.equal(login.localId,expectedUid,"Staging test account UID does not match the UID used for staging key custody.");
const tokenClaims=JSON.parse(Buffer.from(String(login.idToken||"").split(".")[1]||"","base64url").toString("utf8"));
assert.equal(tokenClaims.aud,project,"Firebase ID token audience is not the staging project.");
assert.equal(tokenClaims.iss,"https://securetoken.google.com/"+project,"Firebase ID token issuer is not the staging project.");
const authHeaders={Authorization:"Bearer "+login.idToken};
async function ownFirestoreDocument(collection){
  const response=await fetch("https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(project)+"/databases/(default)/documents/"+collection+"/"+encodeURIComponent(expectedUid),{headers:authHeaders});
  const data=await response.json().catch(()=>({}));
  assert.equal(response.ok,true,"Staging "+collection+" record is not readable for the authenticated test account.");
  return data;
}
const [signatureProfile,signerIdentity]=await Promise.all([
  ownFirestoreDocument("signatureProfiles"),
  ownFirestoreDocument("signerIdentities")
]);
const firestoreString=(record,key)=>record?.fields?.[key]?.stringValue||"";
assert.equal(firestoreString(signatureProfile,"status"),"Active","Staging test signer must have an Active Signature Profile.");
assert.ok(firestoreString(signatureProfile,"signatureUrl").startsWith("data:image/"),"Staging test signer must have a saved Signature Profile specimen.");
assert.equal(firestoreString(signerIdentity,"authorityStatus"),"Current","Staging test signer must have Current Signer Identity authority.");
assert.ok(firestoreString(signerIdentity,"authorityRole")&&firestoreString(signerIdentity,"authorityRole")!=="Not yet assigned","Staging test signer must have a registered signing authority.");

async function readJson(response,label){
  const body=await response.json().catch(()=>({}));
  assert.equal(response.ok,true,label+" failed with HTTP "+response.status+": "+(body.error||"no error detail"));
  assert.notEqual(body.ok,false,label+" returned ok=false");
  return body;
}
async function signingJson(path,token,label){
  const response=await fetch(base+path,{headers:{...authHeaders,"x-signing-token":token}});
  return readJson(response,label);
}
async function sha256(bytes){
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

const pdf=await PDFDocument.create();
const page=pdf.addPage([595.28,841.89]);
page.drawText("IRPA isolated staging cryptographic acceptance transaction",{x:48,y:760,size:14});
page.drawText("Test data only. No production record or secret is used.",{x:48,y:730,size:9});
const originalBytes=await pdf.save();
const originalHash=await sha256(originalBytes);
const stamp=Date.now().toString(36);
const documentId="DOC-STAGING-CRYPTO-"+stamp;
const externalReference="IRPA-STAGING-CRYPTO-"+stamp;
const uploadForm=new FormData();
uploadForm.append("documentId",documentId);
uploadForm.append("title","IRPA Staging Cryptographic Acceptance");
uploadForm.append("classification","Restricted");
uploadForm.append("archives","board-governance");
uploadForm.append("file",new Blob([originalBytes],{type:"application/pdf"}),"staging-crypto-acceptance.pdf");
const uploadResponse=await fetch(base+"/api/documents",{method:"POST",headers:authHeaders,body:uploadForm});
const uploaded=await readJson(uploadResponse,"Staging controlled-PDF upload");
assert.equal(uploaded.documentId,documentId);
assert.equal(uploaded.sha256,originalHash);
const retrievedOriginal=await fetch(base+"/api/documents/"+encodeURIComponent(documentId)+"/pdf",{headers:authHeaders});
assert.equal(retrievedOriginal.ok,true,"Stored source PDF could not be retrieved.");
assert.equal(retrievedOriginal.headers.get("x-document-sha256"),originalHash);
assert.equal(await sha256(new Uint8Array(await retrievedOriginal.arrayBuffer())),originalHash);

const envelopePayload={
  externalReference,
  returnTokens:true,
  documentId,
  title:"IRPA Staging Cryptographic Acceptance",
  classification:"Restricted",
  archives:["board-governance"],
  signingMode:"Sequential",
  signers:[{uid:expectedUid,email,name:"IRPA Staging Crypto Test Signer",order:1}],
  fields:[
    {fieldId:"staging-name",type:"Name",page:1,x:8,y:18,width:45,height:8,signerUid:expectedUid,required:true},
    {fieldId:"staging-signature",type:"Signature",page:1,x:8,y:30,width:45,height:10,signerUid:expectedUid,required:true}
  ]
};
const envelopeResponse=await fetch(base+"/api/envelopes",{method:"POST",headers:{...authHeaders,"content-type":"application/json"},body:JSON.stringify(envelopePayload)});
const envelope=await readJson(envelopeResponse,"Staging authenticated envelope creation");
assert.ok(envelope.envelopeId);
assert.equal(envelope.invitations?.[0]?.status,"Sent","Staging invitation transport did not confirm delivery.");
assert.ok(Array.isArray(envelope.tokens)&&envelope.tokens.length===1,"Staging-only acceptance token was not returned.");
const signingToken=envelope.tokens[0];
const opened=await signingJson("/api/sign/open",signingToken,"Authenticated signing open");
assert.equal(opened.signer.authenticated,true);
assert.equal(opened.signer.uid,undefined,"Signer UID must not be exposed by the open endpoint.");
assert.equal(opened.canSign,true);
assert.equal(opened.fields.length,2);
assert.equal(opened.fields.every(field=>field.signerUid===expectedUid),true);

const signedResponse=await fetch(base+"/api/sign/submit",{
  method:"POST",headers:{...authHeaders,"content-type":"application/json"},
  body:JSON.stringify({
    token:signingToken,
    signature:{type:"typed",value:"IRPA Staging Crypto Test Signer"},
    fieldValues:{"staging-name":"IRPA Staging Crypto Test Signer","staging-signature":"IRPA Staging Crypto Test Signer"},
    manualAuthorityIdentification:authority,
    consent:true
  })
});
const signed=await readJson(signedResponse,"Staging signing and cryptographic completion");
assert.equal(signed.status,"Completed");
assert.equal(signed.completed,true);

const status=await signingJson("/api/sign/status",signingToken,"Completed signing status");
assert.equal(status.status,"Completed");
assert.equal(status.externalReference,externalReference);
assert.equal(status.auditChainValid,true);
assert.equal(status.completion.cryptographicEvidenceIds.length,1);
assert.equal(status.signers[0].uid,expectedUid);
assert.equal(status.completion.finalHash,await sha256(new Uint8Array(await (await fetch(base+"/api/sign/pdf",{headers:{...authHeaders,"x-signing-token":signingToken}})).arrayBuffer())));

const pdfResponse=await fetch(base+"/api/sign/pdf",{headers:{...authHeaders,"x-signing-token":signingToken}});
assert.equal(pdfResponse.ok,true,"Completed PDF retrieval failed.");
const completedBytes=new Uint8Array(await pdfResponse.arrayBuffer());
const completedHash=await sha256(completedBytes);
assert.equal(completedHash,status.completion.finalHash);
assert.equal(pdfResponse.headers.get("x-document-sha256"),completedHash);
const validPdfResponse=await fetch(base+"/api/sign/verify",{
  method:"POST",headers:{...authHeaders,"x-signing-token":signingToken,"content-type":"application/pdf"},body:completedBytes
});
const validPdf=await readJson(validPdfResponse,"Completed PDF integrity verification");
assert.equal(validPdf.verified,true);
assert.equal(validPdf.documentHash,completedHash);

const evidenceResponse=await fetch(base+"/api/sign/evidence",{headers:{...authHeaders,"x-signing-token":signingToken}});
const evidenceResult=await readJson(evidenceResponse,"Persisted cryptographic evidence retrieval");
assert.equal(evidenceResult.auditChainValid,true);
assert.equal(evidenceResult.documentHash,completedHash);
assert.equal(evidenceResult.evidence.length,1);
const evidence=evidenceResult.evidence[0];
assert.equal(evidence.envelopeId,envelope.envelopeId);
assert.equal(evidence.signerUid,expectedUid);
assert.equal(evidence.keyId,expectedKeyId,"Gateway did not use the exact ephemeral key injected for this staging signer.");
assert.equal(evidence.documentHash,completedHash);
assert.equal(evidence.status,"SEALED");
assert.equal("privateKey" in evidence,false);
assert.equal("privateKeyPkcs8" in evidence,false);
const publicKey=await webcrypto.subtle.importKey("jwk",{...evidence.publicKeyJwk,ext:true,key_ops:["verify"]},{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
const signature=Buffer.from(evidence.signature.replace(/-/g,"+").replace(/_/g,"/"),"base64");
const evidenceSignatureValid=await webcrypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},publicKey,signature,new TextEncoder().encode(evidence.canonicalPayload));
assert.equal(evidenceSignatureValid,true,"Persisted evidence signature did not independently verify.");
assert.equal(JSON.parse(evidence.canonicalPayload).documentHash,completedHash);
assert.equal(JSON.parse(evidence.canonicalPayload).envelopeId,envelope.envelopeId);
assert.equal(JSON.parse(evidence.canonicalPayload).signerUid,expectedUid);

const tamperedBytes=new Uint8Array(completedBytes);
tamperedBytes[tamperedBytes.length-1]^=1;
assert.notEqual(await sha256(tamperedBytes),completedHash);
const tamperedResponse=await fetch(base+"/api/sign/verify",{
  method:"POST",headers:{...authHeaders,"x-signing-token":signingToken,"content-type":"application/pdf"},body:tamperedBytes
});
assert.equal(tamperedResponse.status,409,"Gateway did not reject a tampered completed PDF.");

const beforeRetry=status.eventCount;
const retryResponse=await fetch(base+"/api/sign/submit",{
  method:"POST",headers:{...authHeaders,"content-type":"application/json"},
  body:JSON.stringify({token:signingToken,signature:{type:"typed",value:"IRPA Staging Crypto Test Signer"},fieldValues:{"staging-name":"IRPA Staging Crypto Test Signer","staging-signature":"IRPA Staging Crypto Test Signer"},manualAuthorityIdentification:authority,consent:true})
});
const retry=await readJson(retryResponse,"Idempotent signing retry");
assert.equal(retry.idempotent,true);
const afterRetry=await signingJson("/api/sign/status",signingToken,"Post-retry status");
assert.equal(afterRetry.eventCount,beforeRetry,"Idempotent retry changed the Gateway audit chain.");
assert.equal(afterRetry.completion.cryptographicEvidenceIds.length,1,"Idempotent retry duplicated cryptographic evidence.");
assert.equal(afterRetry.auditChainValid,true);

console.log("STAGING_RUNTIME_CRYPTO_ACCEPTANCE=PASS");
console.log(JSON.stringify({
  project,
  signerUid:expectedUid,
  envelopeId:envelope.envelopeId,
  sourceHash:originalHash,
  completedHash:completedHash,
  evidenceId:evidence.evidenceId,
  evidenceKeyId:evidence.keyId,
  evidenceSignatureValid,
  tamperedPdfRejected:true,
  idempotentRetry:true,
  auditChainValid:afterRetry.auditChainValid
}));
