import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { PDFDocument } from "pdf-lib";

const apiKey=process.env.STAGING_FIREBASE_WEB_API_KEY||"";
const project=process.env.STAGING_FIREBASE_PROJECT_ID||"";
const email=process.env.STAGING_CRYPTO_TEST_EMAIL||"";
const password=process.env.STAGING_CRYPTO_TEST_PASSWORD||"";
const expectedUid=process.env.STAGING_CRYPTO_TEST_SIGNER_UID||"";
const expectedKeyId=process.env.STAGING_CRYPTO_TEST_KEY_ID||"";
const base=String(process.env.STAGING_GATEWAY_URL||"").replace(/\/+$/,"");
for(const [name,value] of Object.entries({STAGING_FIREBASE_WEB_API_KEY:apiKey,STAGING_FIREBASE_PROJECT_ID:project,STAGING_CRYPTO_TEST_EMAIL:email,STAGING_CRYPTO_TEST_PASSWORD:password,STAGING_CRYPTO_TEST_SIGNER_UID:expectedUid,STAGING_CRYPTO_TEST_KEY_ID:expectedKeyId,STAGING_GATEWAY_URL:base}))assert.ok(value,name+" is required.");
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
const authHeaders={Authorization:"Bearer "+login.idToken,"x-irpa-staging-diagnostics":"1"};
async function readJson(response,label){
  const body=await response.json().catch(()=>({}));
  const detail=body.diagnosticMessage?` [${body.diagnosticCode||"Error"}] ${body.diagnosticMessage}`:(body.error||"no error detail");
  assert.equal(response.ok,true,label+" failed with HTTP "+response.status+": "+detail);
  assert.notEqual(body.ok,false,label+" returned ok=false");
  return body;
}
async function signingJson(path,token,label){
  const response=await fetch(base+path,{headers:{"x-signing-token":token}});
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
console.log("STAGING_CONTROLLED_PDF_UPLOAD_DIAGNOSTICS=ENABLED (staging-only; redacted; isolated runtime acceptance)");
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
  signers:[{identityType:"email-link",email,name:"IRPA Staging Crypto Test Signer",title:"Staging acceptance signer",routingPosition:1}],
  fields:[
    {fieldId:"staging-name",type:"Name",page:1,x:8,y:18,width:45,height:8,signerEmail:email,required:true},
    {fieldId:"staging-signature",type:"Signature",page:1,x:8,y:30,width:45,height:10,signerUid:expectedUid,required:true}
  ]
};
const envelopeResponse=await fetch(base+"/api/envelopes",{method:"POST",headers:{...authHeaders,"content-type":"application/json"},body:JSON.stringify(envelopePayload)});
let envelope;
try {
  envelope=await readJson(envelopeResponse,"Staging authenticated envelope creation");
} catch (error) {
  console.error("STAGING_INVITATION_DELIVERY_FAILED",JSON.stringify({
    smtpHost:"mail.irpa.or.tz",
    smtpPort:465,
    error:String(error?.message||error).slice(0,1000)
  }));
  throw error;
}
assert.ok(envelope.envelopeId);
if (envelope.invitations?.[0]?.status !== "Sent") {
  console.error("STAGING_INVITATION_DELIVERY_FAILED",JSON.stringify({
    smtpHost:"mail.irpa.or.tz",
    smtpPort:465,
    error:String(envelope.invitations?.[0]?.error||envelope.invitations?.[0]?.message||envelope.error||"Invitation transport did not confirm delivery.").slice(0,1000)
  }));
}
assert.equal(envelope.invitations?.[0]?.status,"Sent","Staging invitation transport did not confirm delivery.");
assert.ok(Array.isArray(envelope.tokens)&&envelope.tokens.length===1,"Staging-only acceptance token was not returned.");
const signingToken=envelope.tokens[0];
console.log("STAGE_ENVELOPE_CREATED=PASS");
const openResponse=await fetch(base+"/api/sign/email/open",{headers:{"x-signing-token":signingToken}});
const openChallenge=await readJson(openResponse,"No-session email-link open");
assert.equal(openChallenge.requiresEmailCode,true);
assert.ok(openChallenge.testOnlyCode,"Staging-only one-time code was not returned to the acceptance runner.");
console.log("STAGE_EMAIL_LINK_NO_SESSION=PASS");
const confirmResponse=await fetch(base+"/api/sign/email/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:signingToken,code:openChallenge.testOnlyCode})});
const opened=await readJson(confirmResponse,"Email code confirmation");
const sessionToken=opened.sessionToken;
assert.ok(sessionToken);
assert.equal(opened.signer.authenticated,true);
assert.equal(opened.signer.uid,undefined);
assert.equal(opened.canSign,true);
assert.equal(opened.fields.length,2);
assert.equal(opened.fields.every(field=>field.signerEmail===email),true);
console.log("STAGE_EMAIL_CODE_VERIFICATION=PASS");
const signaturePng="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==";
const signedResponse=await fetch(base+"/api/sign/submit",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({
    token:sessionToken,
    signature:{type:"field-applications"},
    fieldApplications:[{fieldId:"staging-signature",confirmed:true,page:1,x:8,y:30,width:45,height:10,value:signaturePng}],
    fieldValues:{"staging-name":"IRPA Staging Crypto Test Signer"},
    declarations:{name:"IRPA Staging Crypto Test Signer",title:"Staging acceptance signer"},
    signatureConfirmed:true,
    consent:true
  })
});
const signed=await readJson(signedResponse,"Staging signing and cryptographic completion");
assert.equal(signed.status,"Completed");
assert.equal(signed.completed,true);

const status=await signingJson("/api/sign/status",sessionToken,"Completed signing status");
assert.equal(status.status,"Completed");
assert.equal(status.externalReference,externalReference);
assert.equal(status.auditChainValid,true);
assert.equal(status.completion.cryptographicEvidenceIds.length,1);
assert.equal(status.signers[0].uid,undefined);
assert.equal(status.completion.finalHash,await sha256(new Uint8Array(await (await fetch(base+"/api/sign/pdf",{headers:{"x-signing-token":sessionToken}})).arrayBuffer())));

const pdfResponse=await fetch(base+"/api/sign/pdf",{headers:{"x-signing-token":sessionToken}});
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
assert.equal(evidence.signerUid,null);
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
assert.equal(JSON.parse(evidence.canonicalPayload).signerUid,null);
assert.equal(JSON.parse(evidence.canonicalPayload).signerIdentityType,"email-link");

const tamperedBytes=new Uint8Array(completedBytes);
tamperedBytes[tamperedBytes.length-1]^=1;
assert.notEqual(await sha256(tamperedBytes),completedHash);
const tamperedResponse=await fetch(base+"/api/sign/verify",{
  method:"POST",headers:{...authHeaders,"x-signing-token":signingToken,"content-type":"application/pdf"},body:tamperedBytes
});
assert.equal(tamperedResponse.status,409,"Gateway did not reject a tampered completed PDF.");

const beforeRetry=status.eventCount;
const retryResponse=await fetch(base+"/api/sign/submit",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({token:sessionToken,signature:{type:"field-applications"},fieldApplications:[{fieldId:"staging-signature",confirmed:true,page:1,x:8,y:30,width:45,height:10,value:signaturePng}],fieldValues:{"staging-name":"IRPA Staging Crypto Test Signer"},declarations:{name:"IRPA Staging Crypto Test Signer",title:"Staging acceptance signer"},signatureConfirmed:true,consent:true})
});
const retry=await readJson(retryResponse,"Idempotent signing retry");
assert.equal(retry.idempotent,true);
const afterRetry=await signingJson("/api/sign/status",sessionToken,"Post-retry status");
assert.equal(afterRetry.eventCount,beforeRetry,"Idempotent retry changed the Gateway audit chain.");
assert.equal(afterRetry.completion.cryptographicEvidenceIds.length,1,"Idempotent retry duplicated cryptographic evidence.");
assert.equal(afterRetry.auditChainValid,true);

console.log("STAGE_FINAL_SIGNER_COMPLETED=PASS");
console.log("STAGE_CRYPTO_EVIDENCE=PASS");
console.log("STAGE_TAMPER_REJECTION=PASS");
console.log("STAGE_IDEMPOTENT_RETRY=PASS");

async function createRoutedEnvelope(label,signers,attachments=[]){
  const response=await fetch(base+"/api/envelopes",{method:"POST",headers:{...authHeaders,"content-type":"application/json"},body:JSON.stringify({externalReference:"IRPA-STAGING-ROUTE-"+stamp+"-"+label,documentId,title:"IRPA owner routing acceptance "+label,classification:"Restricted",archives:["board-governance"],signingMode:"Sequential",signers:signers.map(s=>({...s,identityType:"email-link"})),attachments,returnTokens:true})});
  const body=await readJson(response,"Staging owner-routed envelope "+label);
  assert.ok(body.envelopeId);assert.equal(body.tokens.length,signers.length);
  return body;
}
async function openVerifiedSession(token,label){
  const response=await fetch(base+"/api/sign/email/open",{headers:{"x-signing-token":token}});
  const challenge=await readJson(response,label+" email-link open");
  assert.equal(challenge.requiresEmailCode,true);
  assert.ok(challenge.testOnlyCode);
  const confirmed=await fetch(base+"/api/sign/email/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,code:challenge.testOnlyCode})});
  const session=await readJson(confirmed,label+" email-code confirmation");
  assert.ok(session.sessionToken);
  return {sessionToken:session.sessionToken,attachments:session.attachments||[]};
}
async function submitEmailSigner(session,name,label){
  const response=await fetch(base+"/api/sign/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:session.sessionToken||session,signature:{type:"typed",value:name},declarations:{name},consent:true})});
  return readJson(response,label+" signature submission");
}
const baseEmail=email.toLowerCase();
const emailParts=baseEmail.split("@");
assert.equal(emailParts.length,2,"The staging signer email must be a valid address.");
const routeEmail=tag=>emailParts[0]+"+"+stamp+"-"+tag+"@"+emailParts[1];

console.log("STAGE_1_EMAIL_LINK_IDENTITY=PASS");
const attendancePdf=await PDFDocument.create();attendancePdf.addPage([300,200]).drawText("Optional attendance sheet — staging test",{x:24,y:150,size:12});const attendanceBytes=await attendancePdf.save();const attendanceDocumentId="DOC-STAGING-ATT-"+stamp;const attendanceForm=new FormData();attendanceForm.append("documentId",attendanceDocumentId);attendanceForm.append("title","Optional Attendance Sheet");attendanceForm.append("classification","Restricted");attendanceForm.append("archives","board-governance");attendanceForm.append("file",new Blob([attendanceBytes],{type:"application/pdf"}),"optional-attendance-sheet.pdf");const attendanceUpload=await readJson(await fetch(base+"/api/documents",{method:"POST",headers:authHeaders,body:attendanceForm}),"Optional attendance attachment upload");assert.equal(attendanceUpload.documentId,attendanceDocumentId);
const sequential=await createRoutedEnvelope("SEQUENTIAL",[
  {email:routeEmail("one"),name:"Routing Signer One",routingPosition:1},
  {email:routeEmail("two"),name:"Routing Signer Two",routingPosition:2},
  {email:routeEmail("three"),name:"Routing Signer Three",routingPosition:3}
],[{documentId:attendanceDocumentId}]);
assert.deepEqual(sequential.invitations.map(item=>item.status),["Sent","Waiting","Waiting"]);
const earlyResponse=await fetch(base+"/api/sign/email/open",{headers:{"x-signing-token":sequential.tokens[1]}});
assert.equal(earlyResponse.status,409);
assert.match((await earlyResponse.json()).error,/Not your turn yet/);
console.log("STAGE_2_EARLY_LINK_BLOCKED=PASS");
const sequentialOne=await openVerifiedSession(sequential.tokens[0],"Position 1 signer");
assert.equal(sequentialOne.attachments.length,1);assert.equal(sequentialOne.attachments[0].title,"Optional Attendance Sheet");const attachmentResponse=await fetch(base+"/api/sign/email/attachments/A1",{headers:{"x-signing-token":sequentialOne.sessionToken}});assert.equal(attachmentResponse.ok,true);assert.equal(attachmentResponse.headers.get("x-content-sha256"),sequentialOne.attachments[0].hash);assert.equal(await sha256(new Uint8Array(await attachmentResponse.arrayBuffer())),sequentialOne.attachments[0].hash);console.log("STAGE_OPTIONAL_ATTACHMENT_HASH_AND_VISIBILITY=PASS");
const sequentialOneResult=await submitEmailSigner(sequentialOne,"Routing Signer One","Position 1 signer");
assert.equal(sequentialOneResult.completed,false);
const tokenTwo=sequentialOneResult.releasedTokens?.find(item=>item.signerId==="S2")?.token;
assert.ok(tokenTwo,"Position 2 invitation token was not released after position 1 completed.");
console.log("STAGE_3_POSITION_1_RELEASED_POSITION_2=PASS");
const sequentialTwo=await openVerifiedSession(tokenTwo,"Position 2 signer");
const sequentialTwoResult=await submitEmailSigner(sequentialTwo,"Routing Signer Two","Position 2 signer");
const tokenThree=sequentialTwoResult.releasedTokens?.find(item=>item.signerId==="S3")?.token;
assert.ok(tokenThree,"Position 3 invitation token was not released after position 2 completed.");
console.log("STAGE_4_POSITION_2_RELEASED_POSITION_3=PASS");
const sequentialThree=await openVerifiedSession(tokenThree,"Position 3 signer");
const sequentialThreeResult=await submitEmailSigner(sequentialThree,"Routing Signer Three","Position 3 signer");
assert.equal(sequentialThreeResult.completed,true);
const sequentialStatus=await fetch(base+"/api/envelopes/"+encodeURIComponent(sequential.envelopeId)+"/status",{headers:authHeaders});
const sequentialOwnerStatus=await readJson(sequentialStatus,"Sequential envelope owner status");
assert.equal(sequentialOwnerStatus.status,"Completed");
assert.deepEqual(sequentialOwnerStatus.signers.map(s=>s.routingPosition),[1,2,3]);
assert.ok(sequentialOwnerStatus.signers.every(s=>s.displayStatus==="signed"));
console.log("STAGE_5_LAST_SIGNER_COMPLETED_AND_CERTIFICATE_ORDER=PASS");

const parallel=await createRoutedEnvelope("PARALLEL",[
  {email:routeEmail("parallel-one"),name:"Parallel Signer One",routingPosition:1},
  {email:routeEmail("parallel-two"),name:"Parallel Signer Two",routingPosition:1},
  {email:routeEmail("parallel-three"),name:"Parallel Signer Three",routingPosition:2}
]);
assert.deepEqual(parallel.invitations.map(item=>item.status),["Sent","Sent","Waiting"]);
const parallelOne=await openVerifiedSession(parallel.tokens[0],"Parallel signer one");
const parallelOneResult=await submitEmailSigner(parallelOne,"Parallel Signer One","Parallel signer one");
assert.equal(parallelOneResult.releasedTokens,undefined,"The next position must wait until both parallel signers have signed.");
const parallelTwo=await openVerifiedSession(parallel.tokens[1],"Parallel signer two");
const parallelTwoResult=await submitEmailSigner(parallelTwo,"Parallel Signer Two","Parallel signer two");
const parallelThreeToken=parallelTwoResult.releasedTokens?.find(item=>item.signerId==="S3")?.token;
assert.ok(parallelThreeToken);
const parallelThree=await openVerifiedSession(parallelThreeToken,"Parallel position two");
const parallelThreeResult=await submitEmailSigner(parallelThree,"Parallel Signer Three","Parallel position two");
assert.equal(parallelThreeResult.completed,true);
console.log("STAGE_6_PARALLEL_POSITION_RELEASE=PASS");

const declined=await createRoutedEnvelope("DECLINE",[
  {email:routeEmail("decline-one"),name:"Declining Signer",routingPosition:1},
  {email:routeEmail("decline-two"),name:"Waiting Signer",routingPosition:2}
]);
const declineSession=await openVerifiedSession(declined.tokens[0],"Declining signer");
const declineResponse=await fetch(base+"/api/sign/decline",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:declineSession,reason:"Staging acceptance decline test"})});
const declineResult=await readJson(declineResponse,"Signer decline");
assert.equal(declineResult.status,"Declined");
const declinedStatus=await readJson(await fetch(base+"/api/envelopes/"+encodeURIComponent(declined.envelopeId)+"/status",{headers:authHeaders}),"Declined envelope status");
assert.equal(declinedStatus.status,"Declined");
assert.equal(declinedStatus.signers[1].displayStatus,"waiting");
console.log("STAGE_7_DECLINE_STOPS_CHAIN=PASS");

const voided=await createRoutedEnvelope("VOID",[
  {email:routeEmail("void-one"),name:"Voided Signer One",routingPosition:1},
  {email:routeEmail("void-two"),name:"Voided Signer Two",routingPosition:2}
]);
const voidResponse=await fetch(base+"/api/envelopes/"+encodeURIComponent(voided.envelopeId)+"/void",{method:"POST",headers:{...authHeaders,"content-type":"application/json"},body:JSON.stringify({reason:"Staging acceptance void test"})});
const voidResult=await readJson(voidResponse,"Owner void");
assert.equal(voidResult.status,"Voided");
const voidedStatus=await readJson(await fetch(base+"/api/envelopes/"+encodeURIComponent(voided.envelopeId)+"/status",{headers:authHeaders}),"Voided envelope status");
assert.equal(voidedStatus.status,"Voided");
assert.equal(voidedStatus.signers[1].emailLinkStatus,"revoked");
console.log("STAGE_8_VOID_STOPS_CHAIN=PASS");

const changed=await createRoutedEnvelope("CHANGE-EMAIL",[
  {email:routeEmail("old-address"),name:"Original Signer",routingPosition:1}
]);
const changedResponse=await fetch(base+"/api/envelopes/"+encodeURIComponent(changed.envelopeId)+"/invitations/S1/email",{method:"POST",headers:{...authHeaders,"content-type":"application/json"},body:JSON.stringify({email:routeEmail("new-address"),name:"Replacement Signer",title:"External Reviewer"})});
const changedResult=await readJson(changedResponse,"Owner signer email replacement");
assert.equal(changedResult.emailChanged,true);
assert.ok(changedResult.token);
const oldLink=await fetch(base+"/api/sign/email/open",{headers:{"x-signing-token":changed.tokens[0]}});
assert.equal(oldLink.status,404,"The old email link must be revoked after changing the address.");
const newSession=await openVerifiedSession(changedResult.token,"Replacement signer");
assert.ok(newSession);
console.log("STAGE_9_EMAIL_CHANGE_REVOKES_OLD_LINK=PASS");

const remind=await createRoutedEnvelope("REMINDER",[
  {email:routeEmail("reminder"),name:"Reminder Signer",routingPosition:1}
]);
const reminderPath="/api/envelopes/"+encodeURIComponent(remind.envelopeId)+"/invitations/S1/remind";
const reminderOne=await fetch(base+reminderPath,{method:"POST",headers:authHeaders});
assert.equal(reminderOne.ok,true);
const reminderTwo=await fetch(base+reminderPath,{method:"POST",headers:authHeaders});
assert.equal(reminderTwo.status,429,"A second reminder inside one hour must be rejected.");
console.log("STAGE_10_REMINDER_HOURLY_LIMIT=PASS");

const finalRoutingPdf=await fetch(base+"/api/sign/pdf",{headers:{"x-signing-token":sequentialThree.sessionToken}});
assert.equal(finalRoutingPdf.ok,true);
const routingPdfBytes=new Uint8Array(await finalRoutingPdf.arrayBuffer());
assert.ok(routingPdfBytes.length>1000);
console.log("STAGE_11_COMPLETION_CERTIFICATE_PDF=PASS");

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
