import assert from "node:assert/strict";
import {createHash,createSign} from "node:crypto";
import {PDFDocument} from "pdf-lib";

const PROJECT="irpa-dbg-staging-a73ec";
const project=process.env.STAGING_FIREBASE_PROJECT_ID||"";
const apiKey=process.env.STAGING_FIREBASE_WEB_API_KEY||"";
const base=String(process.env.STAGING_GATEWAY_URL||"").replace(/\/+$/,"");
const ownerEmail=process.env.STAGING_TEST_EMAIL||"";
const ownerPassword=process.env.STAGING_TEST_PASSWORD||"";
const signerEmail=process.env.STAGING_CRYPTO_TEST_EMAIL||"";
const saText=process.env.STAGING_FIREBASE_SERVICE_ACCOUNT_JSON||"";
const gatewayPattern=/^https:\/\/irpa-google-drive-gateway-staging\.[a-z0-9-]+\.workers\.dev$/i;
const setupChecks=[];
let activeStep="Staging-only target guard",gatewayVersion="not reported";
function redact(value){return String(value??"").slice(0,300).replace(/Bearer\s+[^\s,;"]+/ig,"Bearer [REDACTED]").replace(/AIza[0-9A-Za-z_-]{20,}/g,"[REDACTED_API_KEY]").replace(/(password|token|secret)(["=: ]+)[^", ]+/ig,"$1$2[REDACTED]").replace(/[\r\n\t]+/g," ");}
function report(){for(const item of setupChecks)console.log("ACCEPTANCE_ROW\t"+item.name+"\t"+item.result+"\t"+redact(item.error||"—"));}
async function step(name,fn){activeStep=name;try{await fn();setupChecks.push({name,result:"PASS",error:""});console.log("PASS: "+name);}catch(error){const message=redact(error?.message||error);setupChecks.push({name,result:"FAIL",error:message});console.error("FAIL: "+name+" :: "+message);if(name==="Staging-only target and owner credentials guard")throw error;}}
function encode(value){if(value===null||value===undefined)return{nullValue:null};if(typeof value==="boolean")return{booleanValue:value};if(typeof value==="number"&&Number.isInteger(value))return{integerValue:String(value)};if(typeof value==="number")return{doubleValue:value};if(Array.isArray(value))return{arrayValue:{values:value.map(encode)}};if(typeof value==="object")return{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};return{stringValue:String(value)};}
function decode(value){if(!value||typeof value!=="object")return value;if("stringValue"in value)return value.stringValue;if("integerValue"in value)return Number(value.integerValue);if("doubleValue"in value)return value.doubleValue;if("booleanValue"in value)return value.booleanValue;if("timestampValue"in value)return value.timestampValue;if("nullValue"in value)return null;if("arrayValue"in value)return(value.arrayValue.values||[]).map(decode);if("mapValue"in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));return value;}
function plain(document){return Object.fromEntries(Object.entries(document?.fields||{}).map(([k,v])=>[k,decode(v)]));}
function fsUrl(path){assert.equal(project,PROJECT,"Refusing Firestore request: project is not staging.");return"https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents/"+path;}
async function checkedFetch(...args){const response=await globalThis.fetch(...args);if(!response.ok){const body=await response.clone().text().catch(()=>"");throw new Error("HTTP "+response.status+" response body: "+redact(body));}return response;}
async function signIn(email,password){const response=await checkedFetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+encodeURIComponent(apiKey),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});const body=await response.json().catch(()=>({}));const claims=JSON.parse(Buffer.from(String(body.idToken||"").split(".")[1]||"","base64url").toString("utf8"));assert.equal(claims.aud,PROJECT);assert.equal(claims.iss,"https://securetoken.google.com/"+PROJECT);assert.ok(body.localId&&body.idToken);return body;}
async function serviceToken(){let sa;try{sa=JSON.parse(saText);}catch{throw Error("Staging service-account secret is invalid JSON.");}assert.equal(sa.project_id,PROJECT);const now=Math.floor(Date.now()/1000),b64=value=>Buffer.from(value).toString("base64url");const unsigned=b64(JSON.stringify({alg:"RS256",typ:"JWT"}))+"."+b64(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+300}));const signer=createSign("RSA-SHA256");signer.update(unsigned);signer.end();const assertion=unsigned+"."+signer.sign(sa.private_key,"base64url");const response=await checkedFetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});const body=await response.json();assert.ok(body.access_token);return body.access_token;}
async function createDoc(token,collection,id,data){const response=await checkedFetch(fsUrl(collection)+"?documentId="+encodeURIComponent(id),{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))})});return response.json();}
async function readDoc(token,collection,id){const response=await checkedFetch(fsUrl(collection+"/"+encodeURIComponent(id)),{headers:{Authorization:"Bearer "+token}});return plain(await response.json());}
async function jsonResponse(response,label){const body=await response.json().catch(()=>({}));const detail=String([body.diagnosticCode,body.diagnosticMessage,body.code,body.error,body.message].filter(Boolean).join(" | ")).replace(/Bearer\s+\S+/gi,"Bearer [redacted]").replace(/[\r\n\t]+/g," ").slice(0,300);assert.equal(response.ok,true,label+" failed (HTTP "+response.status+")"+(detail?": "+detail:""));assert.notEqual(body.ok,false,label+" returned ok=false");return body;}
async function sha(bytes){return createHash("sha256").update(Buffer.from(bytes)).digest("hex");}
async function main(){
 let owner,serviceAccess,ownerHeaders,documentId,portalEnvelopeId,gatewayEnvelopeId,sourceHash,signingToken,sessionToken,signedPdfHash,finalHash,signedFileId;
 await step("Staging-only target and owner credentials guard",async()=>{
  assert.equal(project,PROJECT);assert.match(base,gatewayPattern);assert.equal(new URL(base).protocol,"https:");
  assert.ok(apiKey&&ownerEmail&&ownerPassword&&signerEmail&&saText,"Required staging owner, signer mailbox or service-account settings are missing.");
  assert.notEqual(ownerEmail.toLowerCase(),signerEmail.toLowerCase(),"The signer mailbox must be distinct from the owner account.");
  const health=await jsonResponse(await checkedFetch(base+"/health",{headers:{"cache-control":"no-cache"}}),"Staging Gateway health");
  gatewayVersion=String(health.version||"not reported");if(process.env.GITHUB_SHA)assert.equal(gatewayVersion,process.env.GITHUB_SHA);
 });
 await step("Authenticate envelope owner and staging Firestore service account",async()=>{
  [owner,serviceAccess]=await Promise.all([signIn(ownerEmail,ownerPassword),serviceToken()]);
  ownerHeaders={Authorization:"Bearer "+owner.idToken,"x-irpa-staging-diagnostics":"1"};
 });
 const stamp=Date.now().toString(36);documentId="DOC-STAGING-LIFECYCLE-"+stamp;portalEnvelopeId="STAGING-SIGN-"+stamp;
 await step("Create controlled staging PDF and reject client-supplied signed state",async()=>{
  const pdf=await PDFDocument.create();pdf.addPage([595.28,841.89]).drawText("IRPA staging signature lifecycle acceptance",{x:48,y:760,size:15});
  const bytes=await pdf.save();sourceHash=await sha(bytes);const form=new FormData();
  form.append("documentId",documentId);form.append("title","Staging Signature Lifecycle Acceptance");form.append("classification","Internal");form.append("archives","board-governance");form.append("status","SIGNED");form.append("signatureStatus","COMPLETED");form.append("file",new Blob([bytes],{type:"application/pdf"}),"staging-signature-lifecycle.pdf");
  const uploaded=await jsonResponse(await checkedFetch(base+"/api/documents",{method:"POST",headers:ownerHeaders,body:form}),"Staging controlled-document upload");
  assert.equal(uploaded.documentId,documentId);assert.equal(uploaded.sha256,sourceHash);assert.notEqual(uploaded.status,"SIGNED");assert.notEqual(uploaded.signatureStatus,"COMPLETED");
 });
 await step("Seed owner-controlled portal lifecycle records without signer UID or authority role",async()=>{
  const now=new Date().toISOString();
  await createDoc(serviceAccess,"documents",documentId,{documentId,title:"Staging Signature Lifecycle Acceptance",ownerUid:owner.localId,ownerEmail:ownerEmail,classification:"Restricted",archiveCategory:"Administrative Documents",status:"PENDING_SIGNATURE",fileName:"staging-signature-lifecycle.pdf",recordOrigin:"STAGING",createdAt:now,updatedAt:now});
  await createDoc(serviceAccess,"signatureEnvelopes",portalEnvelopeId,{envelopeReference:portalEnvelopeId,title:"Staging Signature Lifecycle Acceptance",documentId,senderUid:owner.localId,status:"In Progress",signingMode:"Sequential",participantUids:[owner.localId],actionUids:[],currentSignerUid:null,signers:[{uid:null,identityType:"email-link",name:"IRPA Staging Email Signer",email:signerEmail,title:"Optional staging title",routingPosition:1,status:"Pending"}],createdAt:now,recordOrigin:"STAGING"});
  const seeded=await readDoc(serviceAccess,"signatureEnvelopes",portalEnvelopeId);assert.equal(seeded.signers[0].uid,null);assert.equal(seeded.signers[0].identityType,"email-link");assert.equal(seeded.signers[0].role,undefined);
 });
 await step("Create email-link Gateway envelope and assign fields by email",async()=>{
  const response=await checkedFetch(base+"/api/envelopes",{method:"POST",headers:{...ownerHeaders,"content-type":"application/json"},body:JSON.stringify({externalReference:portalEnvelopeId,returnTokens:true,documentId,title:"Staging Signature Lifecycle Acceptance",status:"Completed",signatureStatus:"COMPLETED",classification:"Restricted",archives:["board-governance"],signingMode:"Sequential",signers:[{identityType:"email-link",email:signerEmail,name:"IRPA Staging Email Signer",title:"Optional staging title",routingPosition:1}],fields:[{fieldId:"staging-email-name",type:"Name",page:1,x:8,y:18,width:50,height:8,signerEmail:signerEmail,required:true},{fieldId:"staging-email-signature",type:"Signature",page:1,x:8,y:30,width:50,height:10,signerEmail:signerEmail,required:true}]})});
  const created=await jsonResponse(response,"Email-link Gateway envelope creation");gatewayEnvelopeId=created.envelopeId;assert.ok(gatewayEnvelopeId);assert.equal(created.status,"Sent");assert.ok(Array.isArray(created.tokens)&&created.tokens.length===1);signingToken=created.tokens[0];
 });
 await step("Open invitation without account and confirm email with one-time code",async()=>{
  const opened=await jsonResponse(await fetch(base+"/api/sign/email/open",{headers:{"x-signing-token":signingToken}}),"No-session email-link open");
  assert.equal(opened.requiresEmailCode,true);assert.ok(opened.testOnlyCode,"Staging test mode did not return the one-time code to the acceptance runner.");
  const confirmed=await jsonResponse(await fetch(base+"/api/sign/email/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:signingToken,code:opened.testOnlyCode})}),"Email code confirmation");
  sessionToken=confirmed.sessionToken;assert.ok(sessionToken);assert.equal(confirmed.signer.uid,undefined);assert.equal(confirmed.canSign,true);assert.equal(confirmed.fields.length,2);assert.equal(confirmed.fields.every(field=>field.signerEmail===signerEmail),true);
 });
 await step("Sign as the email-verified signer without Firebase login or authority prompt",async()=>{
  const signaturePng="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==";
  const signed=await jsonResponse(await fetch(base+"/api/sign/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:sessionToken,signature:{type:"field-applications"},fieldApplications:[{fieldId:"staging-email-signature",confirmed:true,page:1,x:8,y:30,width:50,height:10,value:signaturePng}],fieldValues:{"staging-email-name":"IRPA Staging Email Signer"},declarations:{name:"IRPA Staging Email Signer",title:"Optional staging title"},signatureConfirmed:true,consent:true})}),"Email-link signer submission");
  assert.equal(signed.status,"Completed");assert.equal(signed.completed,true);
  const status=await jsonResponse(await fetch(base+"/api/sign/status",{headers:{"x-signing-token":sessionToken}}),"Completed signer status");
  assert.equal(status.status,"Completed");assert.equal(status.signers.length,1);assert.equal(status.signers[0].identityType,"email-link");assert.equal(status.signers[0].uid,undefined);assert.equal(status.signers[0].displayStatus,"signed");assert.ok(status.completion?.finalHash);finalHash=status.completion.finalHash;
  const pdfResponse=await checkedFetch(base+"/api/sign/pdf",{headers:{"x-signing-token":sessionToken}});const signedBytes=Buffer.from(await pdfResponse.arrayBuffer());signedPdfHash=await sha(signedBytes);assert.equal(signedPdfHash,finalHash);assert.equal(pdfResponse.headers.get("x-document-sha256"),signedPdfHash);
  const unrelated=await globalThis.fetch(base+"/api/sign/pdf");assert.ok([401,403,404].includes(unrelated.status));console.log("STAGE_LIFECYCLE_SIGNER_UID=NOT_REQUIRED");
 });
 await step("Verify cryptographic evidence and idempotent retry",async()=>{
  const evidence=await jsonResponse(await fetch(base+"/api/sign/evidence",{headers:{"x-signing-token":sessionToken}}),"Email-link cryptographic evidence");
  assert.equal(evidence.signerUid,null);assert.equal(evidence.signerIdentityType,"email-link");assert.equal(JSON.parse(evidence.canonicalPayload).signerUid,null);assert.equal(JSON.parse(evidence.canonicalPayload).signerIdentityType,"email-link");
  const signaturePng="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==";
  const retry=await jsonResponse(await fetch(base+"/api/sign/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:sessionToken,signature:{type:"field-applications"},fieldApplications:[{fieldId:"staging-email-signature",confirmed:true,page:1,x:8,y:30,width:50,height:10,value:signaturePng}],fieldValues:{"staging-email-name":"IRPA Staging Email Signer"},declarations:{name:"IRPA Staging Email Signer",title:"Optional staging title"},signatureConfirmed:true,consent:true})}),"Idempotent signing retry");
  assert.equal(retry.idempotent,true);assert.equal(retry.completed,true);
 });
 await step("Verify portal envelope mirror and signer record",async()=>{
  const portal=await readDoc(serviceAccess,"signatureEnvelopes",portalEnvelopeId);
  assert.equal(portal.status,"Completed");assert.equal(portal.documentId,documentId);assert.ok(portal.signedDocumentUrl||portal.ownerCompletedDocumentUrl);
  assert.equal(portal.signers.length,1);assert.equal(portal.signers[0].uid,null);assert.equal(portal.signers[0].identityType,"email-link");assert.equal(portal.signers[0].status,"Signed");assert.equal(portal.lastSignedByUid,null);
  const signerRecord=await readDoc(serviceAccess,"signatures","gateway-"+gatewayEnvelopeId+"-S1");
  assert.equal(signerRecord.signerUid,null);assert.equal(signerRecord.signerIdentityType,"email-link");assert.equal(signerRecord.signatureAuthorityVerificationStatus,"NotRequired");
  signedFileId=portal.signedPdfReference;assert.ok(signedFileId);
 });
 await step("Verify signature trail records verified email rather than UID authority",async()=>{
  const response=await checkedFetch("https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents:runQuery",{method:"POST",headers:{Authorization:"Bearer "+serviceAccess,"content-type":"application/json"},body:JSON.stringify({structuredQuery:{from:[{collectionId:"signatureEvents"}],where:{fieldFilter:{field:{fieldPath:"envelopeId"},op:"EQUAL",value:{stringValue:portalEnvelopeId}}},limit:100}})});
  const rows=await response.json();const events=(Array.isArray(rows)?rows:[]).filter(row=>row.document).map(row=>plain(row.document));
  assert.ok(events.some(item=>item.event==="Gateway Signer Signed"&&item.signerId==="S1"&&item.actorEmail===signerEmail));assert.ok(events.some(item=>item.event==="Gateway Signing Completed"&&item.actorEmail===signerEmail));
 });
 await step("Complete document lifecycle and verify immutable audit state",async()=>{
  const response=await checkedFetch(base+"/api/document-lifecycle/signature-complete",{method:"POST",headers:{...ownerHeaders,"content-type":"application/json"},body:JSON.stringify({documentId,envelopeId:portalEnvelopeId})});
  const result=await jsonResponse(response,"Lifecycle signature completion");assert.equal(result.status,"SIGNED");assert.equal(result.documentId,documentId);
  const doc=await readDoc(serviceAccess,"documents",documentId);assert.equal(doc.status,"SIGNED");assert.equal(doc.signatureStatus,"COMPLETED");assert.equal(doc.signatureEnvelopeId,portalEnvelopeId);assert.ok(doc.signedAt);
  const auditResponse=await checkedFetch("https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents:runQuery",{method:"POST",headers:{Authorization:"Bearer "+serviceAccess,"content-type":"application/json"},body:JSON.stringify({structuredQuery:{from:[{collectionId:"audit"}],where:{fieldFilter:{field:{fieldPath:"recordId"},op:"EQUAL",value:{stringValue:documentId}}},limit:100}})});
  const auditRows=await auditResponse.json();const records=(Array.isArray(auditRows)?auditRows:[]).filter(row=>row.document).map(row=>plain(row.document));assert.ok(records.some(item=>item.action==="DOCUMENT_LIFECYCLE_SIGNATURE_COMPLETED"));
 });
 await step("Verify final PDF hash, signed archive reference and owner copy",async()=>{
  assert.ok(signedPdfHash);assert.equal(signedPdfHash,finalHash);assert.ok(signedFileId);
  const status=await jsonResponse(await fetch(base+"/api/envelopes/"+encodeURIComponent(gatewayEnvelopeId)+"/status",{headers:ownerHeaders}),"Owner envelope status");
  assert.equal(status.status,"Completed");assert.ok(status.completion.files.some(file=>file.kind==="signer-copy"));assert.ok(status.completion.files.some(file=>file.kind==="owner-copy"));
 });
 const failed=setupChecks.filter(item=>item.result==="FAIL");report();
 if(failed.length){console.error("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=FAIL");process.exitCode=1;return;}
 console.log("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=PASS");
 console.log(JSON.stringify({project:PROJECT,gatewayVersion,stages:setupChecks.map(item=>({name:item.name,result:item.result}))}));
}
main().catch(error=>{const detail=redact(error?.message||error);setupChecks.push({name:activeStep,result:"FAIL",error:detail});console.error("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=FAIL");console.error("FAILING_STEP="+activeStep);console.error("DETAIL="+detail);report();process.exitCode=1;});
