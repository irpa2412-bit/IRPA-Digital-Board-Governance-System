import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash,createSign} from "node:crypto";
import {PDFDocument} from "pdf-lib";

const PROJECT="irpa-dbg-staging-a73ec";
const project=process.env.STAGING_FIREBASE_PROJECT_ID||"";
const apiKey=process.env.STAGING_FIREBASE_WEB_API_KEY||"";
const base=String(process.env.STAGING_GATEWAY_URL||"").replace(/\/+$/,"");
const adminEmail=process.env.STAGING_TEST_EMAIL||"",adminPassword=process.env.STAGING_TEST_PASSWORD||"";
const signerEmail=process.env.STAGING_CRYPTO_TEST_EMAIL||"",signerPassword=process.env.STAGING_CRYPTO_TEST_PASSWORD||"";
const saText=process.env.STAGING_FIREBASE_SERVICE_ACCOUNT_JSON||"";
const gatewayPattern=/^https:\/\/irpa-google-drive-gateway-staging\.[a-z0-9-]+\.workers\.dev$/i;
let activeStep="Staging-only target guard";const passed=[];let gatewayVersion="not retrieved";

function writeSummary(ok,failed="",detail=""){
  if(!process.env.GITHUB_STEP_SUMMARY)return;
  const rows=["## Staging signature-to-lifecycle acceptance","","- Result: "+(ok?"PASS":"FAIL"),"- Project: "+PROJECT,"- Gateway: "+(base||"not configured"),"- Gateway version: "+gatewayVersion,"- Completed checks: "+(passed.join("; ")||"none"),"- Failing step: "+(failed||"None"),"- Detail: "+String(detail|| (ok?"All assertions passed.":"See failed step output.")).replace(/[\r\n]+/g," ").slice(0,300),"- Production targets were not used.",""];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,rows.join("\n"));
}
async function step(name,fn){activeStep=name;await fn();passed.push(name);console.log("PASS: "+name);}
function encode(v){if(v===null||v===undefined)return{nullValue:null};if(typeof v==="boolean")return{booleanValue:v};if(typeof v==="number"&&Number.isInteger(v))return{integerValue:String(v)};if(typeof v==="number")return{doubleValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};if(typeof v==="object")return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};return{stringValue:String(v)};}
function decode(v){if(!v||typeof v!=="object")return v;if("stringValue"in v)return v.stringValue;if("integerValue"in v)return Number(v.integerValue);if("doubleValue"in v)return v.doubleValue;if("booleanValue"in v)return v.booleanValue;if("timestampValue"in v)return v.timestampValue;if("nullValue"in v)return null;if("arrayValue"in v)return(v.arrayValue.values||[]).map(decode);if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));return v;}
function plain(d){return Object.fromEntries(Object.entries(d?.fields||{}).map(([k,v])=>[k,decode(v)]));}
function fsUrl(path){assert.equal(project,PROJECT,"Refusing Firestore request: project is not staging.");return"https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents/"+path;}
async function signIn(email,password){const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+encodeURIComponent(apiKey),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});const b=await r.json().catch(()=>({}));assert.equal(r.ok,true,"Staging test account sign-in failed (HTTP "+r.status+").");const c=JSON.parse(Buffer.from(String(b.idToken||"").split(".")[1]||"","base64url").toString("utf8"));assert.equal(c.aud,PROJECT,"Firebase token is not scoped to staging.");assert.equal(c.iss,"https://securetoken.google.com/"+PROJECT,"Firebase token issuer is not staging.");assert.ok(b.localId&&b.idToken,"Firebase sign-in did not return an authenticated identity.");return b;}
async function adminToken(){let sa;try{sa=JSON.parse(saText);}catch{throw Error("Staging service-account secret is invalid JSON.");}assert.equal(sa.project_id,PROJECT,"Service account is not scoped to staging.");const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(x).toString("base64url");const u=b64(JSON.stringify({alg:"RS256",typ:"JWT"}))+"."+b64(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+300}));const sig=createSign("RSA-SHA256");sig.update(u);sig.end();const assertion=u+"."+sig.sign(sa.private_key,"base64url");const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});const b=await r.json().catch(()=>({}));assert.equal(r.ok,true,"Staging service-account token request failed.");assert.ok(b.access_token,"No staging Firestore access token returned.");return b.access_token;}
async function createDoc(token,collection,id,data){const r=await fetch(fsUrl(collection)+"?documentId="+encodeURIComponent(id),{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))})});assert.equal(r.ok,true,"Could not create staging "+collection+" fixture (HTTP "+r.status+").");return r.json();}
async function readDoc(token,collection,id){const r=await fetch(fsUrl(collection+"/"+encodeURIComponent(id)),{headers:{Authorization:"Bearer "+token}});assert.equal(r.ok,true,"Could not read staging "+collection+" record (HTTP "+r.status+").");return plain(await r.json());}
async function jsonResponse(r,label){const b=await r.json().catch(()=>({}));const safeDetail=String([b.diagnosticCode,b.diagnosticMessage,b.code,b.error,b.message].filter(Boolean).join(" | ")).replace(/Bearer\s+\S+/gi,"Bearer [redacted]").replace(/[\r\n\t]+/g," ").slice(0,300);assert.equal(r.ok,true,label+" failed (HTTP "+r.status+")"+(safeDetail?": "+safeDetail:"")+".");assert.notEqual(b.ok,false,label+" returned ok=false.");return b;}
async function sha(bytes){return createHash("sha256").update(Buffer.from(bytes)).digest("hex");}

async function main(){
  await step("Staging-only target and credentials guard",async()=>{
    assert.equal(project,PROJECT,"Wrong project ID; refusing test.");
    assert.match(base,gatewayPattern,"Gateway URL is not the isolated staging Worker.");
    assert.equal(new URL(base).protocol,"https:","Gateway must use HTTPS.");
    assert.ok(apiKey&&adminEmail&&adminPassword&&signerEmail&&signerPassword&&saText,"Required staging credentials are missing.");
    assert.notEqual(adminEmail.toLowerCase(),signerEmail.toLowerCase(),"Admin and signer test accounts must be distinct.");
    const healthResponse=await fetch(base+"/health",{headers:{"cache-control":"no-cache"}});
    assert.equal(healthResponse.ok,true,"Staging gateway health request failed (HTTP "+healthResponse.status+").");
    const health=await healthResponse.json();
    assert.equal(health.ok,true,"Staging gateway health response is not healthy.");
    gatewayVersion=String(health.version||"unknown");
    assert.notEqual(gatewayVersion,"unknown","Staging gateway health response did not include a version.");
    console.log("Gateway version: "+gatewayVersion);
  });
  let admin,signer,adminAccess,signerHeaders,adminHeaders,identity;
  await step("Authenticate staging admin and signer; verify signer authority",async()=>{
    [admin,signer,adminAccess]=await Promise.all([signIn(adminEmail,adminPassword),signIn(signerEmail,signerPassword),adminToken()]);
    signerHeaders={Authorization:"Bearer "+signer.idToken,"x-irpa-staging-diagnostics":"1"};
    adminHeaders={Authorization:"Bearer "+admin.idToken,"x-irpa-staging-diagnostics":"1"};
    identity=await readDoc(adminAccess,"signerIdentities",signer.localId);
    assert.equal(identity.authorityStatus,"Current","Signer authority must be Current.");
    assert.ok(identity.authorityRole&&identity.authorityRole!=="Not yet assigned","Signer needs registered authority.");
  });
  const stamp=Date.now().toString(36),documentId="DOC-STAGING-LIFECYCLE-"+stamp,portalEnvelopeId="STAGING-SIGN-"+stamp;
  let sourceHash="",gatewayEnvelopeId="",signingToken="";
  await step("Create staging PDF and gateway document",async()=>{
    const pdf=await PDFDocument.create(),page=pdf.addPage([595.28,841.89]);
    page.drawText("IRPA staging signature lifecycle acceptance",{x:48,y:760,size:15});
    page.drawText("Synthetic test only; not an operational record.",{x:48,y:730,size:10});
    const bytes=await pdf.save();sourceHash=await sha(bytes);
    const form=new FormData();form.append("documentId",documentId);form.append("title","Staging Signature Lifecycle Acceptance");form.append("classification","Internal");form.append("archives","board-governance");form.append("file",new Blob([bytes],{type:"application/pdf"}),"staging-signature-lifecycle.pdf");
    const uploaded=await jsonResponse(await fetch(base+"/api/documents",{method:"POST",headers:signerHeaders,body:form}),"Staging controlled-document upload");
    assert.equal(uploaded.documentId,documentId);assert.equal(uploaded.sha256,sourceHash);
  });
  await step("Assign Authorization Officer and seed staging lifecycle records",async()=>{
    const now=new Date().toISOString();
    await createDoc(adminAccess,"documents",documentId,{documentId,title:"Staging Signature Lifecycle Acceptance",ownerUid:admin.localId,ownerEmail:admin.email||adminEmail,classification:"Restricted",archiveCategory:"Administrative Documents",status:"PENDING_SIGNATURE",fileName:"staging-signature-lifecycle.pdf",recordOrigin:"STAGING",createdAt:now,updatedAt:now});
    await createDoc(adminAccess,"signatureEnvelopes",portalEnvelopeId,{envelopeReference:portalEnvelopeId,title:"Staging Signature Lifecycle Acceptance",documentId,senderUid:signer.localId,status:"In Progress",signingMode:"Sequential",participantUids:[admin.localId,signer.localId],actionUids:[signer.localId],currentSignerUid:signer.localId,signers:[{uid:signer.localId,name:"IRPA Staging Authorization Officer",email:signer.email||signerEmail,role:"Authorization Officer",action:"Authorization",order:1,status:"Pending"}],createdAt:now,recordOrigin:"STAGING"});
    const seeded=await readDoc(adminAccess,"signatureEnvelopes",portalEnvelopeId);assert.equal(seeded.documentId,documentId);assert.equal(seeded.signers?.[0]?.role,"Authorization Officer");
  });
  await step("Create linked signing envelope",async()=>{
    const b=await jsonResponse(await fetch(base+"/api/envelopes",{method:"POST",headers:{...signerHeaders,"content-type":"application/json"},body:JSON.stringify({externalReference:portalEnvelopeId,returnTokens:true,documentId,title:"Staging Signature Lifecycle Acceptance",classification:"Restricted",archives:["board-governance"],signingMode:"Sequential",signers:[{uid:signer.localId,email:signer.email||signerEmail,name:"IRPA Staging Authorization Officer",role:"Authorization Officer",action:"Authorization",order:1}],fields:[{fieldId:"staging-authorization-name",type:"Name",page:1,x:8,y:18,width:50,height:8,signerUid:signer.localId,required:true},{fieldId:"staging-authorization-signature",type:"Signature",page:1,x:8,y:30,width:50,height:10,signerUid:signer.localId,required:true}]})}),"Linked staging envelope creation");
    gatewayEnvelopeId=b.envelopeId;assert.ok(gatewayEnvelopeId,"Gateway envelope ID missing.");assert.ok(Array.isArray(b.tokens)&&b.tokens.length===1,"Staging signing token missing.");signingToken=b.tokens[0];
  });
  await step("Sign as the assigned Authorization Officer",async()=>{
    const opened=await jsonResponse(await fetch(base+"/api/sign/open",{headers:{...signerHeaders,"x-signing-token":signingToken}}),"Open Authorization Officer signing task");assert.equal(opened.canSign,true);
    const signed=await jsonResponse(await fetch(base+"/api/sign/submit",{method:"POST",headers:{...signerHeaders,"content-type":"application/json"},body:JSON.stringify({token:signingToken,signature:{type:"typed",value:"IRPA Staging Authorization Officer"},fieldValues:{"staging-authorization-name":"IRPA Staging Authorization Officer","staging-authorization-signature":"IRPA Staging Authorization Officer"},manualAuthorityIdentification:identity.authorityRole,consent:true})}),"Authorization Officer signature");
    assert.equal(signed.status,"Completed");assert.equal(signed.completed,true);
    const status=await jsonResponse(await fetch(base+"/api/sign/status",{headers:{...signerHeaders,"x-signing-token":signingToken}}),"Completed gateway envelope status");assert.equal(status.status,"Completed");assert.equal(status.externalReference,portalEnvelopeId);assert.equal(status.signers?.length,1);assert.equal(status.signers[0].status,"Signed");
  });
  await step("Verify Completed envelope and every signer in signature trail",async()=>{
    const portal=await readDoc(adminAccess,"signatureEnvelopes",portalEnvelopeId);assert.equal(portal.status,"Completed");assert.equal(portal.documentId,documentId);assert.ok(portal.signedDocumentUrl||portal.ownerCompletedDocumentUrl);assert.equal(portal.signers?.length,1);assert.equal(portal.signers[0].uid,signer.localId);assert.equal(portal.signers[0].status,"Signed");assert.equal(portal.signers[0].role,"Authorization Officer");
    const r=await fetch("https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents:runQuery",{method:"POST",headers:{Authorization:"Bearer "+adminAccess,"content-type":"application/json"},body:JSON.stringify({structuredQuery:{from:[{collectionId:"signatureEvents"}],where:{fieldFilter:{field:{fieldPath:"envelopeId"},op:"EQUAL",value:{stringValue:portalEnvelopeId}}},limit:100}})});
    const rows=await r.json().catch(()=>[]);assert.equal(r.ok,true,"Could not query staging signature trail.");const events=(Array.isArray(rows)?rows:[]).filter(x=>x.document).map(x=>plain(x.document));assert.ok(events.some(x=>x.event==="Gateway Signing Completed"&&x.actorUid===signer.localId),"Signature trail lacks the final signer completion event.");assert.equal(portal.lastSignedByUid,signer.localId);
  });
  await step("Complete document lifecycle and verify signed approval",async()=>{
    const response=await jsonResponse(await fetch(base+"/api/document-lifecycle/signature-complete",{method:"POST",headers:{...adminHeaders,"content-type":"application/json"},body:JSON.stringify({documentId,envelopeId:portalEnvelopeId})}),"Document lifecycle signature completion");
    assert.equal(response.status,"SIGNED");assert.equal(response.documentId,documentId);
    const doc=await readDoc(adminAccess,"documents",documentId);assert.equal(doc.status,"SIGNED");assert.equal(doc.signatureStatus,"COMPLETED");assert.equal(doc.signatureEnvelopeId,portalEnvelopeId);
  });
  writeSummary(true);console.log("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=PASS");console.log(JSON.stringify({project:PROJECT,documentId,gatewayEnvelopeId,portalEnvelopeId,signerUid:signer.localId,assignedRole:"Authorization Officer",signatureTrailVerified:true,lifecycleStatus:"SIGNED",approvalAccepted:true,sourceHash}));
}
main().catch(error=>{const detail=String(error?.message||error).replace(/[\r\n\t]+/g," ").slice(0,350);console.error("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=FAIL");console.error("FAILING_STEP="+activeStep);console.error("DETAIL="+detail);writeSummary(false,activeStep,detail);process.exitCode=1;});
