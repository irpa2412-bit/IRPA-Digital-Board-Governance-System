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
let activeStep="Staging-only target guard";const passed=[];const setupChecks=[];let gatewayVersion="not reported";

function redact(value){
  return String(value??"").slice(0,300).replace(/Bearer\\s+[^\\s,;"]+/ig,"Bearer [REDACTED]").replace(/AIza[0-9A-Za-z_-]{20,}/g,"[REDACTED_API_KEY]").replace(/(password|token|secret)(["=: ]+)[^", ]+/ig,"$1$2[REDACTED]").replace(/[\\r\\n\\t]+/g," ");
}
function writeSummary(){
  const rows=[...setupChecks,...(globalThis.__irpaPostSigningChecks||[])];
  for(const x of rows)console.log("ACCEPTANCE_ROW\\t"+x.portal+"\\t"+x.name+"\\t"+x.result+"\\t"+redact(x.error||"—").replace(/\\t/g," "));
}
async function step(name,fn){activeStep=name;try{await fn();passed.push(name);setupChecks.push({portal:"Signature Portal / Gateway",name,result:"PASS",error:""});console.log("PASS: "+name);}catch(error){const message=redact(error?.message||error);setupChecks.push({portal:"Signature Portal / Gateway",name,result:"FAIL",error:message});console.error("FAIL: "+name+" :: "+message);}}
function encode(v){if(v===null||v===undefined)return{nullValue:null};if(typeof v==="boolean")return{booleanValue:v};if(typeof v==="number"&&Number.isInteger(v))return{integerValue:String(v)};if(typeof v==="number")return{doubleValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};if(typeof v==="object")return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};return{stringValue:String(v)};}
function decode(v){if(!v||typeof v!=="object")return v;if("stringValue"in v)return v.stringValue;if("integerValue"in v)return Number(v.integerValue);if("doubleValue"in v)return v.doubleValue;if("booleanValue"in v)return v.booleanValue;if("timestampValue"in v)return v.timestampValue;if("nullValue"in v)return null;if("arrayValue"in v)return(v.arrayValue.values||[]).map(decode);if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));return v;}
function plain(d){return Object.fromEntries(Object.entries(d?.fields||{}).map(([k,v])=>[k,decode(v)]));}
function fsUrl(path){assert.equal(project,PROJECT,"Refusing Firestore request: project is not staging.");return"https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents/"+path;}
async function signIn(email,password){const r=await checkedFetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+encodeURIComponent(apiKey),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});const b=await r.json().catch(()=>({}));assert.equal(r.ok,true,"Staging test account sign-in failed (HTTP "+r.status+").");const c=JSON.parse(Buffer.from(String(b.idToken||"").split(".")[1]||"","base64url").toString("utf8"));assert.equal(c.aud,PROJECT,"Firebase token is not scoped to staging.");assert.equal(c.iss,"https://securetoken.google.com/"+PROJECT,"Firebase token issuer is not staging.");assert.ok(b.localId&&b.idToken,"Firebase sign-in did not return an authenticated identity.");return b;}
async function adminToken(){let sa;try{sa=JSON.parse(saText);}catch{throw Error("Staging service-account secret is invalid JSON.");}assert.equal(sa.project_id,PROJECT,"Service account is not scoped to staging.");const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(x).toString("base64url");const u=b64(JSON.stringify({alg:"RS256",typ:"JWT"}))+"."+b64(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+300}));const sig=createSign("RSA-SHA256");sig.update(u);sig.end();const assertion=u+"."+sig.sign(sa.private_key,"base64url");const r=await checkedFetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});const b=await r.json().catch(()=>({}));assert.equal(r.ok,true,"Staging service-account token request failed.");assert.ok(b.access_token,"No staging Firestore access token returned.");return b.access_token;}
async function createDoc(token,collection,id,data){const r=await checkedFetch(fsUrl(collection)+"?documentId="+encodeURIComponent(id),{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))})});assert.equal(r.ok,true,"Could not create staging "+collection+" fixture (HTTP "+r.status+").");return r.json();}
async function readDoc(token,collection,id){const r=await checkedFetch(fsUrl(collection+"/"+encodeURIComponent(id)),{headers:{Authorization:"Bearer "+token}});assert.equal(r.ok,true,"Could not read staging "+collection+" record (HTTP "+r.status+").");return plain(await r.json());}
async function jsonResponse(r,label){const b=await r.json().catch(()=>({}));const safeDetail=String([b.diagnosticCode,b.diagnosticMessage,b.code,b.error,b.message].filter(Boolean).join(" | ")).replace(/Bearer\s+\S+/gi,"Bearer [redacted]").replace(/[\r\n\t]+/g," ").slice(0,300);assert.equal(r.ok,true,label+" failed (HTTP "+r.status+")"+(safeDetail?": "+safeDetail:"")+".");assert.notEqual(b.ok,false,label+" returned ok=false.");return b;}
async function sha(bytes){return createHash("sha256").update(Buffer.from(bytes)).digest("hex");}

async function checkedFetch(...args){const r=await globalThis.fetch(...args);if(!r.ok){const body=await r.clone().text().catch(()=> "");throw new Error("HTTP "+r.status+" response body (first 300 chars): "+redact(body));}return r;}

async function main(){
  await step("Staging-only target and credentials guard",async()=>{
    assert.equal(project,PROJECT,"Wrong project ID; refusing test.");
    assert.match(base,gatewayPattern,"Gateway URL is not the isolated staging Worker.");
    assert.equal(new URL(base).protocol,"https:","Gateway must use HTTPS.");
    assert.ok(apiKey&&adminEmail&&adminPassword&&signerEmail&&signerPassword&&saText,"Required staging credentials are missing.");
    assert.notEqual(adminEmail.toLowerCase(),signerEmail.toLowerCase(),"Admin and signer test accounts must be distinct.");
    const healthResponse=await checkedFetch(base+"/health",{headers:{"cache-control":"no-cache"}});
    assert.equal(healthResponse.ok,true,"Staging gateway health request failed (HTTP "+healthResponse.status+").");
    const health=await healthResponse.json();
    assert.equal(health.ok,true,"Staging gateway health response is not healthy.");
    gatewayVersion=health.version ? String(health.version) : "not reported";
    if(process.env.GITHUB_SHA) assert.equal(gatewayVersion,process.env.GITHUB_SHA,"Staging gateway version does not match this workflow commit.");
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
    const uploaded=await jsonResponse(await checkedFetch(base+"/api/documents",{method:"POST",headers:signerHeaders,body:form}),"Staging controlled-document upload");
    assert.equal(uploaded.documentId,documentId);assert.equal(uploaded.sha256,sourceHash);
  });
  await step("Assign Authorization Officer and seed staging lifecycle records",async()=>{
    const now=new Date().toISOString();
    await createDoc(adminAccess,"documents",documentId,{documentId,title:"Staging Signature Lifecycle Acceptance",ownerUid:admin.localId,ownerEmail:admin.email||adminEmail,classification:"Restricted",archiveCategory:"Administrative Documents",status:"PENDING_SIGNATURE",fileName:"staging-signature-lifecycle.pdf",recordOrigin:"STAGING",createdAt:now,updatedAt:now});
    await createDoc(adminAccess,"signatureEnvelopes",portalEnvelopeId,{envelopeReference:portalEnvelopeId,title:"Staging Signature Lifecycle Acceptance",documentId,senderUid:signer.localId,status:"In Progress",signingMode:"Sequential",participantUids:[admin.localId,signer.localId],actionUids:[signer.localId],currentSignerUid:signer.localId,signers:[{uid:signer.localId,name:"IRPA Staging Authorization Officer",email:signer.email||signerEmail,role:"Authorization Officer",action:"Authorization",order:1,status:"Pending"}],createdAt:now,recordOrigin:"STAGING"});
    const seeded=await readDoc(adminAccess,"signatureEnvelopes",portalEnvelopeId);assert.equal(seeded.documentId,documentId);assert.equal(seeded.signers?.[0]?.role,"Authorization Officer");
  });
  await step("Create linked signing envelope",async()=>{
    const b=await jsonResponse(await checkedFetch(base+"/api/envelopes",{method:"POST",headers:{...signerHeaders,"content-type":"application/json"},body:JSON.stringify({externalReference:portalEnvelopeId,returnTokens:true,documentId,title:"Staging Signature Lifecycle Acceptance",classification:"Restricted",archives:["board-governance"],signingMode:"Sequential",signers:[{uid:signer.localId,email:signer.email||signerEmail,name:"IRPA Staging Authorization Officer",role:"Authorization Officer",action:"Authorization",order:1}],fields:[{fieldId:"staging-authorization-name",type:"Name",page:1,x:8,y:18,width:50,height:8,signerUid:signer.localId,required:true},{fieldId:"staging-authorization-signature",type:"Signature",page:1,x:8,y:30,width:50,height:10,signerUid:signer.localId,required:true}]})}),"Linked staging envelope creation");
    gatewayEnvelopeId=b.envelopeId;assert.ok(gatewayEnvelopeId,"Gateway envelope ID missing.");assert.ok(Array.isArray(b.tokens)&&b.tokens.length===1,"Staging signing token missing.");signingToken=b.tokens[0];
  });
  await step("Sign as the assigned Authorization Officer",async()=>{
    const opened=await jsonResponse(await checkedFetch(base+"/api/sign/open",{headers:{...signerHeaders,"x-signing-token":signingToken}}),"Open Authorization Officer signing task");assert.equal(opened.canSign,true);
    const signed=await jsonResponse(await checkedFetch(base+"/api/sign/submit",{method:"POST",headers:{...signerHeaders,"content-type":"application/json"},body:JSON.stringify({token:signingToken,signature:{type:"typed",value:"IRPA Staging Authorization Officer"},fieldValues:{"staging-authorization-name":"IRPA Staging Authorization Officer","staging-authorization-signature":"IRPA Staging Authorization Officer"},manualAuthorityIdentification:identity.authorityRole,consent:true})}),"Authorization Officer signature");
    assert.equal(signed.status,"Completed");assert.equal(signed.completed,true);
    const status=await jsonResponse(await checkedFetch(base+"/api/sign/status",{headers:{...signerHeaders,"x-signing-token":signingToken}}),"Completed gateway envelope status");assert.equal(status.status,"Completed");assert.equal(status.externalReference,portalEnvelopeId);assert.equal(status.signers?.length,1);assert.equal(status.signers[0].status,"Signed");
  });
  activeStep="Post-signing checks";
  const postSigningChecks=[];
  async function postCheck(name,fn){try{await fn();postSigningChecks.push({portal:"Signature Portal / Gateway",name,result:"PASS",error:""});console.log("PASS: "+name);}catch(error){const message=redact(error?.message||error);postSigningChecks.push({portal:"Signature Portal / Gateway",name,result:"FAIL",error:message});console.error("FAIL: "+name+" :: "+message);}}
  await postCheck("Mirror write",async()=>{
    const r=await checkedFetch(base+"/api/envelopes/"+encodeURIComponent(gatewayEnvelopeId)+"/status",{headers:signerHeaders});
    const b=await r.json().catch(()=>({}));
    assert.equal(r.ok,true,"Mirror status request failed (HTTP "+r.status+"): "+String(b.error||b.message||"no response detail"));
    let mirrorStatus=b.mirrorStatus??"unknown",mirrorError=b.mirrorError??"";
    if(mirrorStatus!=="Completed"){
      const rr=await checkedFetch(base+"/api/envelopes/"+encodeURIComponent(gatewayEnvelopeId)+"/resync",{method:"POST",headers:signerHeaders});
      const rb=await rr.json().catch(()=>({}));
      mirrorStatus=rb.mirrorStatus??rb.status??mirrorStatus;
      mirrorError=rb.mirrorError??rb.error??mirrorError;
    }
    assert.equal(mirrorStatus,"Completed","mirrorStatus="+String(mirrorStatus)+"; mirrorError="+String(mirrorError||"none"));
  });
  await postCheck("Portal envelope Completed",async()=>{
    const portal=await readDoc(adminAccess,"signatureEnvelopes",portalEnvelopeId);
    assert.equal(portal.status,"Completed","Portal envelope status is "+String(portal.status));
    assert.equal(portal.documentId,documentId,"Portal envelope documentId mismatch");
    assert.ok(portal.signedDocumentUrl||portal.ownerCompletedDocumentUrl,"Completed signed document URL is missing");
    assert.equal(portal.signers?.length,1,"Expected exactly one signer");
    assert.equal(portal.signers[0].uid,signer.localId,"Portal signer UID mismatch");
    assert.equal(portal.signers[0].status,"Signed","Portal signer status is "+String(portal.signers[0].status));
    assert.equal(portal.signers[0].role,"Authorization Officer","Portal signer role mismatch");
    assert.equal(portal.lastSignedByUid,signer.localId,"lastSignedByUid mismatch");
  });
  await postCheck("Signature trail event",async()=>{
    const r=await checkedFetch("https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(PROJECT)+"/databases/(default)/documents:runQuery",{method:"POST",headers:{Authorization:"Bearer "+adminAccess,"content-type":"application/json"},body:JSON.stringify({structuredQuery:{from:[{collectionId:"signatureEvents"}],where:{fieldFilter:{field:{fieldPath:"envelopeId"},op:"EQUAL",value:{stringValue:portalEnvelopeId}}},limit:100}})});
    const rows=await r.json().catch(()=>[]);
    assert.equal(r.ok,true,"Could not query staging signature trail (HTTP "+r.status+")");
    const events=(Array.isArray(rows)?rows:[]).filter(x=>x.document).map(x=>plain(x.document));
    assert.ok(events.some(x=>x.event==="Gateway Signing Completed"&&x.actorUid===signer.localId),"Signature trail lacks Gateway Signing Completed for final signer "+signer.localId);
  });
  await postCheck("Lifecycle SIGNED",async()=>{
    const r=await checkedFetch(base+"/api/document-lifecycle/signature-complete",{method:"POST",headers:{...adminHeaders,"content-type":"application/json"},body:JSON.stringify({documentId,envelopeId:portalEnvelopeId})});
    const b=await r.json().catch(()=>({}));
    assert.equal(r.ok,true,"Lifecycle signature completion failed (HTTP "+r.status+"): "+String(b.error||b.message||"no response detail"));
    assert.equal(b.status,"SIGNED","Lifecycle returned status "+String(b.status));
    assert.equal(b.documentId,documentId,"Lifecycle documentId mismatch");
  });
  await postCheck("Approval / persisted signed document",async()=>{
    const doc=await readDoc(adminAccess,"documents",documentId);
    assert.equal(doc.status,"SIGNED","Persisted document status is "+String(doc.status));
    assert.equal(doc.signatureStatus,"COMPLETED","Persisted signatureStatus is "+String(doc.signatureStatus));
    assert.equal(doc.signatureEnvelopeId,portalEnvelopeId,"Persisted signatureEnvelopeId mismatch");
    assert.ok(doc.signedAt,"Persisted signedAt timestamp is missing");
  });
  const unimplemented=[
    ["Signed-file reference and controlled resolution","No signed-file reference/resolution assertion is wired into this acceptance fixture."],
    ["Final signed-PDF SHA-256","The fixture does not retrieve a signed PDF to independently recompute the final hash."],
    ["Controlled retrieval: owner, assigned signer, unrelated user","The fixture has no dedicated unrelated-user credentials or complete retrieval matrix."],
    ["Audit: every signer and lifecycle completion","Current fixture verifies the final signer event only; it does not verify an event for every signer plus the lifecycle audit event."],
    ["Gateway rejects client-supplied SIGNED/Completed","No negative client-state mutation assertion is currently wired into this acceptance fixture."]
  ];
  for(const [name,error] of unimplemented)postSigningChecks.push({portal:"Signature Portal / Gateway",name,result:"FAIL",error});
  globalThis.__irpaPostSigningChecks=postSigningChecks;
  writeSummary();
  const failedChecks=[...setupChecks,...postSigningChecks].filter(x=>x.result==="FAIL");
  if(failedChecks.length){process.exitCode=1;const detail=failedChecks.map(x=>x.name+": "+x.error).join(" | ");console.error("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=FAIL");console.error("DETAIL="+redact(detail));return;}
  console.log("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=PASS");
  console.log(JSON.stringify({project:PROJECT,gatewayVersion,postSigningChecks}));

}
main().catch(error=>{const detail=redact(error?.message||error);setupChecks.push({portal:"Signature Portal / Gateway",name:activeStep,result:"FAIL",error:detail});console.error("STAGING_SIGNATURE_LIFECYCLE_ACCEPTANCE=FAIL");console.error("FAILING_STEP="+activeStep);console.error("DETAIL="+detail);writeSummary();process.exitCode=1;});
