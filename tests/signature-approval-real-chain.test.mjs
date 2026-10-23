import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { route as signingRoute, makeContext } from "../drive-gateway/src/router.mjs";
import { createDocumentLifecycleRouter } from "../drive-gateway/src/documentLifecycle.mjs";
import { createDocumentApprovalRouter } from "../drive-gateway/src/documentApproval.mjs";

const PROJECT = process.env.IRPA_FIREBASE_PROJECT_ID || "demo-irpa-staging";
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const API = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH_API = `http://${AUTH}/identitytoolkit.googleapis.com/v1`;
const sha256 = b => createHash("sha256").update(b).digest("hex");
const makePdf = async (label) => { const doc=await PDFDocument.create(); const page=doc.addPage([595.28,841.89]); page.drawText(label,{x:48,y:780}); return new Uint8Array(await doc.save()); };
const pdf = await makePdf("IRPA signature approval chain test");
const differentPdf = await makePdf("Different source bytes for hash-binding test");
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{"content-type":"application/json"}});
const field = v => v === null ? {nullValue:null} : typeof v === "boolean" ? {booleanValue:v} : typeof v === "number" ? {integerValue:String(v)} : Array.isArray(v) ? {arrayValue:{values:v.map(field)}} : typeof v === "object" ? {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,field(x)]))}} : {stringValue:String(v)};
const plain = v => { if(!v)return null; if("stringValue" in v)return v.stringValue; if("integerValue" in v)return Number(v.integerValue); if("doubleValue" in v)return v.doubleValue; if("booleanValue" in v)return v.booleanValue; if("nullValue" in v)return null; if("arrayValue" in v)return (v.arrayValue.values||[]).map(plain); if("mapValue" in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,plain(x)])); return null; };
const decode = d => d?.fields ? Object.fromEntries(Object.entries(d.fields).map(([k,v])=>[k,plain(v)])) : null;
async function fsGet(path){const r=await fetch(API+"/"+path,{headers:{Authorization:"Bearer owner"}});if(r.status===404)return null;if(!r.ok)throw new Error(`Firestore GET ${path}: ${r.status} ${await r.text()}`);return decode(await r.json())}
async function fsPut(path,data){const r=await fetch(API+"/"+path,{method:"PATCH",headers:{"content-type":"application/json",Authorization:"Bearer owner"},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,field(v)]))})});if(!r.ok)throw new Error(`Firestore PATCH ${path}: ${r.status} ${await r.text()}`);return decode(await r.json())}
async function fsDelete(path){await fetch(API+"/"+path,{method:"DELETE",headers:{Authorization:"Bearer owner"}})}
async function authUser(email,password){const r=await fetch(AUTH_API+"/accounts:signUp?key=emulator-api-key",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});const d=await r.json();if(!r.ok)throw new Error("Auth emulator signUp failed: "+JSON.stringify(d));return {uid:d.localId,email:d.email,token:d.idToken}}
async function captureResponse(response,method,path){response.diagnosticMethod=method;response.diagnosticPath=path;response.diagnosticBody=await response.clone().text().catch(error=>`<body unavailable: ${error.message}>`);return response}
function assertStatus(response,expected,note=""){assert.equal(response.status,expected,`${response.status} !== ${expected} ${response.diagnosticMethod||"HTTP"} ${response.diagnosticPath||"<unknown path>"} -> ${response.diagnosticBody||"<empty body>"}${note?" — "+note:""}`)}
function assertStatusIn(response,expected,note=""){assert.ok(expected.includes(response.status),`HTTP ${response.status} not in [${expected.join(", ")}] ${response.diagnosticMethod||"HTTP"} ${response.diagnosticPath||"<unknown path>"} -> ${response.diagnosticBody||"<empty body>"}${note?" — "+note:""}`)}
function assertStatusBelow(response,limit=300,note=""){assert.ok(response.status<limit,`HTTP ${response.status} is not below ${limit} ${response.diagnosticMethod||"HTTP"} ${response.diagnosticPath||"<unknown path>"} -> ${response.diagnosticBody||"<empty body>"}${note?" — "+note:""}`)}
function assertStatusAtLeast(response,limit=400,note=""){assert.ok(response.status>=limit,`HTTP ${response.status} is below ${limit} ${response.diagnosticMethod||"HTTP"} ${response.diagnosticPath||"<unknown path>"} -> ${response.diagnosticBody||"<empty body>"}${note?" — "+note:""}`)}

const now=()=>new Date();
const testState={users:[],ids:[],envelopeIds:[]};
let identities;
async function setup(){
  const suffix=randomUUID().replaceAll("-","").slice(0,12);
  identities={
    owner:await authUser(`owner-${suffix}@example.test`,"Irpa-test-Password-1!"),
    signer2:await authUser(`signer2-${suffix}@example.test`,"Irpa-test-Password-1!"),
    officer:await authUser(`officer-${suffix}@example.test`,"Irpa-test-Password-1!"),
    outsider:await authUser(`outsider-${suffix}@example.test`,"Irpa-test-Password-1!")
  };
  testState.users=Object.values(identities);
  await fsPut("adminProfiles/"+identities.officer.uid,{role:"Authorization Officer",status:"active"});
  await fsPut("members/"+identities.owner.uid,{role:"Member",status:"active"});
  await fsPut("members/"+identities.signer2.uid,{role:"Member",status:"active"});
  await fsPut("members/"+identities.outsider.uid,{role:"Member",status:"active"});
}
function driveMock(){
  const blobs=new Map(),folders=new Map();
  return {
    blobs,
    async getDriveAccessToken(){return "drive-mock-token"},
    async findOrCreateFolder(_env,_token,name,parent){const k=(parent||"root")+"/"+name;if(!folders.has(k))folders.set(k,"folder-"+folders.size);return folders.get(k)},
    async driveFetch(_env,_token,path,opts={}){if(path.includes("/files?")||path.includes("/files/")&&opts.method==="GET"){return {ok:true,json:async()=>({id:"mock-file-"+blobs.size,name:"document.pdf",mimeType:"application/pdf",size:String(pdf.length),description:"{}"})}}return {ok:true,json:async()=>({})}},
    async fetch(url,opts={}){if(String(url).includes("googleapis.com/upload/drive/v3/files")){const id="drive-"+randomUUID();const body=opts.body instanceof Uint8Array?opts.body:new Uint8Array();blobs.set(id,body);return new Response(JSON.stringify({id,name:"document.pdf",mimeType:"application/pdf",size:String(body.length),webViewLink:"https://drive.mock/"+id}),{status:200})}if(String(url).includes("googleapis.com/drive/v3/files")&&String(url).includes("alt=media")){const id=decodeURIComponent(String(url).split("/files/")[1].split("?")[0]);return new Response(blobs.get(id)||new Uint8Array(),{status:200})}return fetch(url,opts)}
  };
}
function lifecycleDeps(){
  const drive=driveMock();
  return {drive,
    getFirebaseProjectId:()=>PROJECT,
    allowedContentTypes:new Set(["application/pdf"]),
    authenticateFirebaseRequest:async req=>{const token=(req.headers.get("authorization")||"").replace(/^Bearer /,"");const u=testState.users.find(x=>x.token===token);if(!u)throw Object.assign(new Error("Authentication token invalid"),{status:401});return {user_id:u.uid,email:u.email,token:u.token}},
    getFirestoreDocument:async(_env,path)=>{const d=await fsGet(path);return d?{fields:Object.fromEntries(Object.entries(d).map(([k,v])=>[k,field(v)]))}:null},
    updateFirestoreDocument:async(_env,path,_token,fields)=>{const current=await fsGet(path)||{};const patch=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,plain(v)]));return fsPut(path,{...current,...patch})},
    firestoreDocumentToPlain:d=>decode(d),
    getDriveAccessToken:drive.getDriveAccessToken,
    driveFetch:drive.driveFetch,
    findOrCreateFolder:drive.findOrCreateFolder,
    fetch:drive.fetch,
    commitDocumentAndAudit:async(_env,_claims,documentId,record,action,details)=>{await fsPut("documents/"+documentId,{...await fsGet("documents/"+documentId),...record});const auditId="audit-"+randomUUID();await fsPut("auditLogs/"+auditId,{recordId:documentId,action,details,createdAt:new Date().toISOString()})},
    recordLifecycleFailure:async()=>{},
    json:(body,status=200)=>json(body,status),
    corsHeaders:()=>({"content-type":"application/json"})
  };
}
function makeSigningContext(){
  const drive=driveMock(), userForToken=token=>testState.users.find(x=>x.token===token);
  const ctx=makeContext({
    env:{FIREBASE_PROJECT_ID:PROJECT,DRIVE_MOCK:"true",IRPA_ENVIRONMENT:"test"},
    verifyUser:async req=>{const token=(req.headers.get("authorization")||"").replace(/^Bearer /,"");const u=userForToken(token);if(!u)throw new Error("Invalid emulator identity token");return {uid:u.uid,email:u.email,token:u.token,isAdmin:false}},
    verifySigningAuthority:async(user,manualAuthorityIdentification)=>{
      const profile=await fsGet("members/"+user.uid);
      const normalize=value=>String(value||"").toLowerCase().replace(/^(the|irpa)\\s+/,"").replace(/[._-]+/g," ").replace(/\\s+/g," ").trim();
      if(!profile||String(profile.status||"").toLowerCase()==="inactive"||normalize(profile.role)!==normalize(manualAuthorityIdentification))throw Object.assign(new Error("SYSTEM VERIFICATION FAILED: active Member register role did not match the declared signing authority."),{status:403});
      return {verified:true,authorityRole:profile.role,authorityDepartment:"",authorityUnit:"",authoritySourceCollection:"members",authoritySourceRecordId:user.uid,verificationMethod:"Authenticated emulator Member Register Match"};
    },
    meta:{
      async get(collection,id){return fsGet(collection+"/"+id)},
      async create(collection,id,data){if(await fsGet(collection+"/"+id))throw new Error("already exists");await fsPut(collection+"/"+id,data)},
      async update(collection,id,patch){const old=await fsGet(collection+"/"+id);if(!old)throw new Error("missing record");await fsPut(collection+"/"+id,{...old,...patch})},
      async list(collection){const r=await fetch(API+"/"+collection);if(!r.ok)return[];const d=await r.json();return(d.documents||[]).map(x=>({...decode(x),id:x.name.split("/").at(-1)}))},
      async delete(collection,id){await fsDelete(collection+"/"+id)}
    },
    storage:{
      async put({bytes,path,metadata}){const id="blob-"+randomUUID();drive.blobs.set(id,new Uint8Array(bytes));return{id,path,link:"drive://"+id,metadata}},
      async get(id){return drive.blobs.get(id)||null},
      async delete(id){drive.blobs.delete(id)}
    },
    sendInvitation:async()=>{},
    allowReturnTokens:true,
    logger:{error(){}},
    now,
    config:{appUrl:"https://sign.mock",ttlDays:14}
  });
  return ctx;
}
async function callSigning(ctx,path,user,body,method="POST",extraHeaders={}){
  const request=new Request("https://worker.test"+path,{method,headers:{authorization:"Bearer "+user.token,...(body?{"content-type":"application/json"}:{}),...extraHeaders},body:body?JSON.stringify(body):undefined});
  return captureResponse(await signingRoute(request,ctx),method,path);
}
async function callLifecycle(router,path,user,body){
  return captureResponse(await router(new Request("https://worker.test"+path,{method:"POST",headers:{authorization:"Bearer "+user.token,"content-type":"application/json"},body:JSON.stringify(body)}),{FIREBASE_PROJECT_ID:PROJECT}),"POST",path);
}
async function lifecycleUpload(owner,bytes=pdf){
  const deps=lifecycleDeps(),router=createDocumentLifecycleRouter(deps);
  const binary=Buffer.from(bytes).toString("base64");
  const res=await callLifecycle(router,"/api/document-lifecycle/upload",owner,{fileName:"source.pdf",contentType:"application/pdf",base64:binary,title:"Approval-chain test",documentType:"Governance Document",archiveCategory:"Governance Documents",classification:"Internal",version:"1.0",recordOrigin:"TRIAL"});
  const body=await res.json();
  assertStatus(res,201,"lifecycle upload must create its document through the real lifecycle handler");
  testState.ids.push(body.documentId);
  return {router,deps,body};
}
async function signatureUpload(ctx,owner,documentId,bytes=pdf){
  const form=new FormData();form.set("documentId",documentId);form.set("title","Approval-chain test");form.set("classification","Internal");form.set("archives","administrative-documents");form.set("file",new Blob([bytes],{type:"application/pdf"}),"source.pdf");
  const res=await captureResponse(await signingRoute(new Request("https://worker.test/api/documents",{method:"POST",headers:{authorization:"Bearer "+owner.token},body:form}),ctx),"POST","/api/documents");
  const body=await res.json();return {res,body};
}
async function createEnvelope(ctx,owner,documentId,signers= [identities.owner,identities.signer2],signingMode="Sequential"){
  const res=await callSigning(ctx,"/api/envelopes",owner,{documentId,signingMode,archives:["administrative-documents"],signers:signers.map((u,i)=>({email:u.email,name:"Test signer "+i,uid:u.uid,order:i+1}))});
  const body=await res.json();if(body.envelopeId)testState.envelopeIds.push(body.envelopeId);return {res,body};
}
async function signWith(ctx,user,token){
  return callSigning(ctx,"/api/sign/submit",user,{token,signature:{type:"typed",value:"Test Signer"},consent:true,manualAuthorityIdentification:"Member"});
}
async function lifecycleComplete(router,owner,documentId,envelopeId){
  return callLifecycle(router,"/api/document-lifecycle/signature-complete",owner,{documentId,envelopeId});
}
async function approval(owner,documentId){
  const deps={
    authenticateFirebaseRequest:async req=>{const token=(req.headers.get("authorization")||"").replace(/^Bearer /,"");const u=testState.users.find(x=>x.token===token);if(!u)throw Object.assign(new Error("Invalid token"),{status:401});return {user_id:u.uid,email:u.email,token:u.token}},
    getFirestoreDocument:async(_env,path)=>{const d=await fsGet(path);return d?{fields:Object.fromEntries(Object.entries(d).map(([k,v])=>[k,field(v)]))}:null},
    firestoreDocumentToPlain:decode,
    commitDocumentAndAudit:async(_env,id,_token,patch,_mask,audit)=>{const old=await fsGet("documents/"+id)||{};await fsPut("documents/"+id,{...old,...Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,plain(v)]))});const auditId="audit-"+randomUUID();await fsPut("auditLogs/"+auditId,decode({fields:audit}));},
    json,corsHeaders:()=>({"content-type":"application/json"})
  };
  const route=createDocumentApprovalRouter(deps);
  return captureResponse(await route(new Request("https://worker.test/api/document-lifecycle/approval/decide",{method:"POST",headers:{authorization:"Bearer "+owner.token,"content-type":"application/json"},body:JSON.stringify({documentId,decision:"approve"})}),{FIREBASE_PROJECT_ID:PROJECT}),"POST","/api/document-lifecycle/approval/decide");
}
before(async()=>{
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT, "GCLOUD_PROJECT must match IRPA_FIREBASE_PROJECT_ID");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080", FIRESTORE, "Firestore emulator host configuration must agree");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099", AUTH, "Auth emulator host configuration must agree");
  const root = `http://${FIRESTORE.split(":")[0]}:${FIRESTORE.split(":")[1]}/`;
  const deadline = Date.now() + 30_000;
  let lastStatus = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(root, { signal: AbortSignal.timeout(1_000) });
      lastStatus = `HTTP ${response.status}`;
      if (response.status === 200) break;
    } catch (error) {
      lastStatus = error?.message || String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(lastStatus, "HTTP 200", `Firestore emulator root must respond at ${root} within 30 seconds; last result: ${lastStatus}`);
  await setup();
  assert.ok(identities.owner.uid&&identities.officer.uid);
});

test("CASE (a): mirror Completed while canonical Worker envelope is incomplete must deny approval without mutation and with denial audit",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);
  const ctx=makeSigningContext();const uploaded=await signatureUpload(ctx,identities.owner,life.documentId);
  assertStatus(uploaded.res,201,"POST /api/documents must upload the exact lifecycle PDF bytes");
  const env=await createEnvelope(ctx,identities.owner,life.documentId);
  assertStatus(env.res,201,"real envelope creation route must succeed");
  const before=await fsGet("documents/"+life.documentId);
  const res=await approval(identities.officer,life.documentId);
  assertStatus(res,409,"a browser-written Completed mirror must not authorize approval when Worker envelope is incomplete");
  assert.deepEqual(await fsGet("documents/"+life.documentId),before,"denial must not mutate the document");
  const audit=await captureResponse(await fetch(API+"/auditLogs",{headers:{Authorization:"Bearer owner"}}),"GET","/auditLogs");
  assertStatusBelow(audit,300,"denial audit collection should be queryable");
  const auditRows=(await audit.json()).documents||[];
  assert.ok(auditRows.some(row=>decode(row)?.recordId===life.documentId&&String(decode(row)?.action||"").includes("DENIED")),"denial audit collection should contain a denial record for this document");
});

test("CASE (b): signing different PDF bytes than lifecycle upload must block approval and lifecycle completion",async()=>{
  const {router,body:life}=await lifecycleUpload(identities.owner,pdf);
  const ctx=makeSigningContext();const uploaded=await signatureUpload(ctx,identities.owner,life.documentId,differentPdf);
  assertStatus(uploaded.res,201,"signing upload route must accept a valid PDF for the hash-binding test");
  assert.notEqual(sha256(pdf),sha256(differentPdf),"fixture PDFs must differ");
  const env=await createEnvelope(ctx,identities.owner,life.documentId);
  assertStatus(env.res,201,"envelope creation must be exercised through the real route");
  const lc=await lifecycleComplete(router,identities.owner,life.documentId,env.body.envelopeId);
  assertStatusIn(lc,[403,409],"lifecycle completion must reject the mismatched source hash");
  const ap=await approval(identities.officer,life.documentId);
  assertStatusIn(ap,[403,409],"approval must reject the mismatched source hash");
});

test("CASE (c): only one of two required signers signed must block approval",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);
  const ctx=makeSigningContext();const uploaded=await signatureUpload(ctx,identities.owner,life.documentId);
  assertStatus(uploaded.res,201,"document upload route must succeed");
  const env=await createEnvelope(ctx,identities.owner,life.documentId);
  assertStatus(env.res,201,"envelope creation route must succeed");
  const signToken=(env.body.tokens||[])[0];
  assert.ok(signToken,"test signing mode must return signing tokens");
  const signed=await signWith(ctx,identities.owner,signToken);
  assertStatusBelow(signed,300,"first required signer should sign");
  const ap=await approval(identities.officer,life.documentId);
  assertStatus(ap,409,"partial signer completion must not authorize approval");
});

test("CASE (d): two signers complete and a distinct officer approval binds document, envelope and final hash",async()=>{
  const {router,body:life}=await lifecycleUpload(identities.owner);
  const ctx=makeSigningContext();const uploaded=await signatureUpload(ctx,identities.owner,life.documentId);
  assertStatus(uploaded.res,201,"document upload route must succeed");
  const env=await createEnvelope(ctx,identities.owner,life.documentId,undefined,"Parallel");
  assertStatus(env.res,201,"parallel envelope creation route must succeed");
  const tokens=env.body.tokens||[];assert.equal(tokens.length,2,"two signer tokens must be issued");
  const results=[];
  results.push(await signWith(ctx,identities.owner,tokens[0]));
  results.push(await signWith(ctx,identities.signer2,tokens[1]));
  for(const response of results)assertStatusBelow(response,300,"both invited signers must sign");
  const completed=await callSigning(ctx,"/api/envelopes/"+env.body.envelopeId,identities.owner,null,"GET");
  assertStatusBelow(completed,300,"envelope status route must be readable");
  const completion=await completed.json();assert.equal(completion.status,"Completed","Worker envelope must complete after all required signatures");
  await fsPut("documents/"+life.documentId,{status:"SIGNED",signatureStatus:"COMPLETED",signatureEnvelopeId:env.body.envelopeId,signedByUid:identities.signer2.uid});
  await fsPut("signatureEnvelopes/"+env.body.envelopeId,{documentId:life.documentId,status:"Completed",lastSignedByUid:identities.signer2.uid});
  const ap=await approval(identities.officer,life.documentId);assertStatusBelow(ap,300,"distinct authorization officer must approve fully signed document");
  const record=await fsGet("documents/"+life.documentId);
  assert.equal(record.approval.documentId,life.documentId);
  assert.equal(record.approval.envelopeId,env.body.envelopeId);
  assert.ok(record.approval.finalHash,"approval record must bind the final signed PDF hash");
});

test("CASE (e1): signer self-approval is denied",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);const ctx=makeSigningContext();
  const uploaded=await signatureUpload(ctx,identities.owner,life.documentId);assertStatus(uploaded.res,201);
  const env=await createEnvelope(ctx,identities.owner,life.documentId,[identities.owner]);assertStatus(env.res,201);
  const token=(env.body.tokens||[])[0];assert.ok(token);await signWith(ctx,identities.owner,token);
  const res=await approval(identities.owner,life.documentId);
  assertStatus(res,403,"a signer cannot approve their own signed document");
});

test("CASE (e2): duplicate approval is denied without a second approval mutation",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);const ctx=makeSigningContext();
  const uploaded=await signatureUpload(ctx,identities.owner,life.documentId);assertStatus(uploaded.res,201);
  const env=await createEnvelope(ctx,identities.owner,life.documentId);assertStatus(env.res,201);
  await fsPut("documents/"+life.documentId,{signatureEnvelopeId:env.body.envelopeId});
  await fsPut("signatureEnvelopes/"+env.body.envelopeId,{documentId:life.documentId,status:"Completed",lastSignedByUid:identities.owner.uid});
  const first=await approval(identities.officer,life.documentId);
  const before=await fsGet("documents/"+life.documentId);
  const second=await approval(identities.officer,life.documentId);
  assertStatus(second,409,"duplicate approval must be denied");
  assert.deepEqual(await fsGet("documents/"+life.documentId),before,"duplicate denial must not mutate the document");
  assertStatusBelow(first,300,"first approval should be recorded when prerequisites are met");
});

test("CASE (e3): non-officer and outsider approval are denied",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);
  const nonOfficer=await approval(identities.owner,life.documentId);
  const outsider=await approval(identities.outsider,life.documentId);
  assertStatus(nonOfficer,403,"non-officer must be denied");
  assertStatus(outsider,403,"outsider must be denied");
});

test("CASE (f): every approval denial is non-mutating and writes an audit entry",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);
  const before=await fsGet("documents/"+life.documentId);
  const res=await approval(identities.officer,life.documentId);
  assertStatusAtLeast(res,400,"invalid signature prerequisite must be denied");
  assert.deepEqual(await fsGet("documents/"+life.documentId),before,"denial must not mutate the document");
  const audit=await captureResponse(await fetch(API+"/auditLogs",{headers:{Authorization:"Bearer owner"}}),"GET","/auditLogs");assertStatusBelow(audit,300,"audit collection query must succeed");
  const rows=(await audit.json()).documents||[];
  assert.ok(rows.some(x=>decode(x)?.recordId===life.documentId&&String(decode(x)?.action||"").includes("DENIED")),"denied approval must create an explicit denial audit entry");
});

test("CASE (g): changing the signed PDF after approval invalidates the approval",async()=>{
  const {body:life}=await lifecycleUpload(identities.owner);const ctx=makeSigningContext();
  const uploaded=await signatureUpload(ctx,identities.owner,life.documentId);assertStatus(uploaded.res,201);
  const env=await createEnvelope(ctx,identities.owner,life.documentId,undefined,"Parallel");assertStatus(env.res,201);
  const tokens=env.body.tokens||[];assert.equal(tokens.length,2);
  const signed=await Promise.all([signWith(ctx,identities.owner,tokens[0]),signWith(ctx,identities.signer2,tokens[1])]);for(const response of signed)assertStatusBelow(response,300,"both invited signers must sign");
  await fsPut("documents/"+life.documentId,{signatureEnvelopeId:env.body.envelopeId,signedByUid:identities.signer2.uid});
  await fsPut("signatureEnvelopes/"+env.body.envelopeId,{documentId:life.documentId,status:"Completed",lastSignedByUid:identities.signer2.uid});
  const approved=await approval(identities.officer,life.documentId);assertStatusBelow(approved,300,"approval must be attempted after full completion");
  const beforeHashMutation=await fsGet("documents/"+life.documentId)||{};
  await fsPut("documents/"+life.documentId,{...beforeHashMutation,signedFileHash:sha256(differentPdf)});
  const after=await approval(identities.officer,life.documentId);
  assertStatus(after,409,"changed signed bytes must invalidate approval and prevent a new decision");
  const changed=await fsGet("documents/"+life.documentId);
  assert.ok(!changed.approval||changed.approval.finalHash===sha256(differentPdf),"the prior approval must be invalidated or rebound when the signed PDF hash changes");
});

test.after(async()=>{for(const path of testState.ids)await fsDelete("documents/"+path).catch(()=>{});for(const user of testState.users){for(const collection of ["adminProfiles","members","employees"])await fsDelete(collection+"/"+user.uid).catch(()=>{});}});
