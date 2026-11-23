import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDocumentLifecycleRouter, buildMultipartBody } from "../src/documentLifecycle.mjs";

function plain(fields){return Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,v?.stringValue??v?.booleanValue??v?.integerValue??(v?.arrayValue?.values||undefined)]));}
function makeDeps(state){
  return {
    FIREBASE_PROJECT_ID:"irpa-digital-board-governance",
    allowedContentTypes:new Set(["application/pdf","text/plain"]),
    authenticateFirebaseRequest:async()=>state.adminUser?({user_id:"admin-1",email:"administrator@irpa.or.tz",token:"token"}):state.researchUser?({user_id:"research-1",email:"research@irpa.or.tz",token:"token"}):({user_id:"emp-1",email:"employee@irpa.or.tz",token:"token"}),
    getFirestoreAdminAccessToken:async()=> "worker-admin-token",
    getFirestoreDocument:async(_env,path)=>{
      if(path==="adminProfiles/admin-1")return state.adminUser?{fields:{active:{booleanValue:true}}}:null;
      if(path==="adminProfiles/emp-1")return null;
      if(path==="members/emp-1")return null;
      if(path==="employees/emp-1")return {fields:{status:{stringValue:"Active"},department:{stringValue:"Finance"},roles:{arrayValue:{values:[{stringValue:"Finance Officer"}]}}}};
      if(path==="employees/research-1")return {fields:{status:{stringValue:"Active"},department:{stringValue:"Research, Statistics and Knowledge"},roles:{arrayValue:{values:[{stringValue:"Research Officer"}]}}}};
      if(path.startsWith("documents/"))return state.docs[path.split("/").pop()]||null;
      if(path.startsWith("signatureEnvelopes/"))return state.envelopes?.[path.split("/").pop()]?{plain:state.envelopes[path.split("/").pop()]}:null;
      return null;
    },
    firestoreDocumentToPlain:doc=>doc?.plain||plain(doc?.fields),
    updateFirestoreDocument:async(_env,path,_token,fields)=>{const id=path.split("/").pop();if(path.startsWith("signatureEnvelopes/"))state.envelopes[id]={...(state.envelopes[id]||{}),...plain(fields)};return {ok:true};},
    verifyCanonicalSignatureEnvelope:state.verifyCanonicalSignatureEnvelope|| (async()=>({ok:false,error:"Canonical verification fixture not configured"})),
    getDriveAccessToken:async()=> "drive-token",
    driveFetch:async(_env,_token,path,options={})=>{
      if(options.method==="DELETE"){state.deletedFiles.push(path);if(state.failDelete)throw new Error("simulated Drive rollback failure");return {};}
      if(path.includes("/copy"))return {id:"copied-"+Math.random().toString(16).slice(2)};
      if(path.includes("?fields=id,name,mimeType,size,description,trashed")){const registered=Object.values(state.docs).find(row=>row.plain?.fileId&&path.includes(encodeURIComponent(row.plain.fileId)));return {id:registered?.plain.fileId||"drive-1",name:registered?.plain.fileName||"test.pdf",mimeType:"application/pdf",size:"4",description:JSON.stringify({irpaGovernance:true,irpaDocumentLifecycle:true,documentId:registered?.plain.documentId||"LIFE-test"})};}
      return {id:"drive-1",name:"test.pdf",mimeType:"application/pdf",size:"4"};
    },
    findOrCreateFolder:async(_env,_token,name)=>{state.folderCalls??=[];state.folderCalls.push(name);return "folder-"+name.replace(/\s+/g,"-");},
    fetch:async(url)=>{if(String(url).includes("alt=media"))return new Response(state.downloadBytes||new TextEncoder().encode("test"),{status:200,headers:{"content-type":"application/pdf"}});return new Response(JSON.stringify({id:"drive-upload-1",name:"test.pdf",mimeType:"application/pdf",size:"4",webViewLink:"https://drive.example/test"}),{status:200,headers:{"content-type":"application/json"}});},
    recordLifecycleFailure:async(_env,claims,documentId,action,details)=>{state.failureEvents??=[];state.failureEvents.push({documentId,actorUid:claims.user_id,action,details});return {auditId:"failure-audit-1"};},
    commitDocumentAndAudit:async(_env,documentId,_token,documentFields,documentMask,auditFields,{createOnly=false}={})=>{
      if(state.failAudit)throw new Error("simulated atomic document/audit commit failure");
      if(createOnly&&state.docs[documentId])throw new Error("document already exists");
      const current=state.docs[documentId]?.fields||{};
      const next={...current};
      for(const key of documentMask){if(Object.hasOwn(documentFields,key))next[key]=documentFields[key];else delete next[key];}
      state.docs[documentId]={fields:next,plain:{...(state.docs[documentId]?.plain||{}),...plain(documentFields)}};
      state.writes.push({path:"documents/"+documentId,fields:documentFields});
      state.writes.push({path:"audit/"+documentId,fields:auditFields});
      return {ok:true};
    },
    json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json",...headers}}),
    corsHeaders:()=>({})
  };
}
const env={};
function req(path,body){return new Request("https://example.test"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})}

test("restricted upload is denied server-side without restricted permission",async()=>{
  const state={docs:{},writes:[],deletedFiles:[]};const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/upload",{fileName:"x.pdf",contentType:"application/pdf",base64:btoa("test"),title:"Restricted",documentType:"Finance",archiveCategory:"Finance Documents",classification:"Restricted"}),env);
  assert.equal(response.status,403);assert.match(await response.text(),/Restricted document upload permission/);
});

test("PDF owner profile removal hides only the owner listing and preserves the verified archive file",async()=>{
  const doc={documentId:"LIFE-test",fileId:"drive-1",fileName:"test.pdf",contentType:"application/pdf",sha256:"a".repeat(64),classification:"Internal",ownerUid:"emp-1",status:"WORKING"};
  const state={docs:{"LIFE-test":{plain:doc}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/profile-hide",{documentId:"LIFE-test"}),env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.profileRemoved,true);
  assert.equal(result.systemRecordPreserved,true);
  assert.equal(result.driveFileDeleted,false);
  assert.equal(state.docs["LIFE-test"].plain.ownerProfileHiddenByUid,"emp-1");
  assert.equal(state.deletedFiles.length,0);
  assert.equal(state.writes.length,2);
  assert.equal(state.writes[1].fields.action.stringValue,"DOCUMENT_LIFECYCLE_OWNER_PROFILE_HIDDEN");
  assert.equal(state.writes[1].fields.details.mapValue.fields.systemRecordPreserved.booleanValue,true);
});
test("PDF owner profile removal is denied to a non-owner",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",fileName:"test.pdf",contentType:"application/pdf",ownerUid:"another-user"}}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/profile-hide",{documentId:"LIFE-test"}),env);
  assert.equal(response.status,403);
  assert.equal(state.writes.length,0);
  assert.equal(state.deletedFiles.length,0);
});
test("PDF owner profile removal is blocked when the archive copy cannot be verified",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",fileName:"test.pdf",contentType:"application/pdf",ownerUid:"emp-1"}}},writes:[],deletedFiles:[]};
  const deps=makeDeps(state);
  deps.driveFetch=async()=>({id:"wrong-file",name:"test.pdf",mimeType:"application/pdf",description:JSON.stringify({irpaGovernance:true,documentId:"other-document"})});
  const router=createDocumentLifecycleRouter(deps);
  const response=await router(req("/api/document-lifecycle/profile-hide",{documentId:"LIFE-test"}),env);
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/archive PDF could be verified/);
  assert.equal(state.writes.length,0);
  assert.equal(state.deletedFiles.length,0);
});
test("completed PDF profile removal requires a signed or final archive copy",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",fileName:"test.pdf",contentType:"application/pdf",ownerUid:"emp-1",status:"SIGNED"}}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/profile-hide",{documentId:"LIFE-test"}),env);
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/archive copy is available/);
  assert.equal(state.writes.length,0);
  assert.equal(state.deletedFiles.length,0);
});
test("PDF owner profile removal rejects non-PDF documents",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",fileName:"notes.txt",contentType:"text/plain",ownerUid:"emp-1"}}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/profile-hide",{documentId:"LIFE-test"}),env);
  assert.equal(response.status,415);
  assert.equal(state.writes.length,0);
});
test("download requires documentId even when fileId is supplied",async()=>{
  const state={docs:{},writes:[]};const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/download",{fileId:"drive-1"}),env);
  assert.equal(response.status,400);assert.match(await response.text(),/Document ID is required/);
});

test("wrong fileId is rejected against registered document",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"registered-file",classification:"Confidential",ownerUid:"emp-1"}}},writes:[]};const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/download",{documentId:"LIFE-test",fileId:"other-file"}),env);
  assert.equal(response.status,409);assert.match(await response.text(),/does not match/);
});

test("post-signature cannot be reached before signed state",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",classification:"Internal",ownerUid:"emp-1",status:"WORKING",archiveCategory:"Finance Documents",title:"Test",reference:"IRPA-DOC-1"}}},writes:[]};const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/transition",{documentId:"LIFE-test",targetStage:"POST_SIGNATURE"}),env);
  assert.equal(response.status,403);assert.match(await response.text(),/Only signed documents/);
});

test("share is restricted to owner or administrator",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",classification:"Confidential",ownerUid:"someone-else",authorizedUids:[]}}},writes:[]};const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/share",{documentId:"LIFE-test",targetUid:"another-user"}),env);
  assert.equal(response.status,403);assert.match(await response.text(),/owner or an administrator/);
});


test("multipart body uses real CRLF separators and preserves binary payload",()=>{
  const boundary="irpa-test-boundary";
  const bytes=new TextEncoder().encode("PDF-BYTES");
  const multipart=buildMultipartBody({boundary,folderId:"folder-1",fileName:"test.pdf",contentType:"application/pdf",bytes,description:{irpaGovernance:true}});
  const decoded=new TextDecoder().decode(multipart.body);
  assert.match(decoded,/--irpa-test-boundary\r\nContent-Type: application\/json/);
  assert.match(decoded,/\r\n--irpa-test-boundary\r\nContent-Type: application\/pdf\r\n\r\nPDF-BYTES\r\n--irpa-test-boundary--/);
  assert.equal(decoded.includes("\\r\\n"),false);
});

test("upload rolls back Drive file when atomic document/audit commit fails",async()=>{
  const state={docs:{},writes:[],deletedFiles:[],failAudit:true};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  await assert.rejects(
    router(req("/api/document-lifecycle/upload",{fileName:"test.pdf",contentType:"application/pdf",base64:btoa("test"),title:"Test document",documentType:"Other",archiveCategory:"Administrative Documents",classification:"Internal"}),env),
    /simulated atomic document\/audit commit failure/
  );
  assert.deepEqual(state.writes,[]);
  assert.deepEqual(state.deletedFiles,["/drive/v3/files/drive-upload-1"]);
  assert.equal(state.failureEvents.length,1);
  assert.match(state.failureEvents[0].documentId,/^LIFE-/);
  assert.equal(state.failureEvents[0].actorUid,"emp-1");
  assert.equal(state.failureEvents[0].action,"UPLOAD");
  assert.equal(state.failureEvents[0].details.failureReason,"simulated atomic document/audit commit failure");
  assert.equal(state.failureEvents[0].details.driveFileId,"drive-upload-1");
  assert.equal(state.failureEvents[0].details.rollbackStatus,"SUCCEEDED");
});

test("Research Officer can upload a Research Archive record into Research Documents",async()=>{
  const state={docs:{},writes:[],deletedFiles:[],researchUser:true};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/upload",{fileName:"research.pdf",contentType:"application/pdf",base64:btoa("test"),title:"Research Archive Record",documentType:"Research Archive",archiveCategory:"Research Documents",classification:"Internal"}),env);
  assert.equal(response.status,201);
  const saved=Object.values(state.docs)[0];
  assert.equal(saved.plain.documentType,"Research Archive");
  assert.equal(saved.plain.archiveCategory,"Research Documents");
});

test("active Administrator outside Research can upload and retrieve a Confidential Research Archive record",async()=>{
  const state={docs:{},writes:[],deletedFiles:[],adminUser:true,downloadBytes:new TextEncoder().encode("test")};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const uploaded=await router(req("/api/document-lifecycle/upload",{fileName:"research.pdf",contentType:"application/pdf",base64:btoa("test"),title:"Administrator Research Archive Record",documentType:"Research Archive",archiveCategory:"Research Documents",classification:"Confidential"}),env);
  assert.equal(uploaded.status,201);
  const result=await uploaded.json();
  const saved=state.docs[result.documentId].plain;
  assert.equal(saved.ownerType,"ADMINISTRATOR");
  assert.equal(saved.department||null,null);
  assert.equal(saved.documentType,"Research Archive");
  assert.equal(saved.archiveCategory,"Research Documents");
  assert.equal(saved.classification,"Confidential");
  assert.ok(state.folderCalls.includes("Research Documents"));
  assert.ok(state.folderCalls.includes("Confidential"));
  const retrieved=await router(req("/api/document-lifecycle/download",{documentId:result.documentId,fileId:result.fileId}),env);
  assert.equal(retrieved.status,200);
  const downloaded=await retrieved.json();
  assert.equal(atob(downloaded.base64),"test");
  assert.equal(downloaded.sha256,saved.sha256);
});

test("Research Archive UI selection defaults its category and classification to Research Documents and Confidential",async()=>{
  const source=await readFile(new URL("../../src/pages/DocumentLifecycleModule.jsx",import.meta.url),"utf8");
  assert.match(source,/if\(value==="Research Archive"\)\{setArchiveCategory\("Research Documents"\);setClassification\("Confidential"\);\}/);
});

test("successful upload atomically writes document registry and audit event",async()=>{
  const state={docs:{},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/upload",{fileName:"test.pdf",contentType:"application/pdf",base64:btoa("test"),title:"Test document",documentType:"Other",archiveCategory:"Administrative Documents",classification:"Internal"}),env);
  assert.equal(response.status,201);
  assert.equal(state.writes.length,2);
  assert.match(state.writes[0].path,/^documents\/LIFE-/);
  assert.match(state.writes[1].path,/^audit\/LIFE-/);
  const saved=Object.values(state.docs)[0];
  assert.equal(saved.fields.sha256.stringValue.length,64);
});

const TEST_SHA256="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

test("download retrieves stored bytes and verifies the registered SHA-256 digest",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",fileName:"test.pdf",sha256:TEST_SHA256,classification:"Internal",ownerUid:"emp-1",status:"WORKING"}}},writes:[],downloadBytes:new TextEncoder().encode("test")};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/download",{documentId:"LIFE-test",fileId:"drive-1"}),env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.sha256,TEST_SHA256);
  assert.equal(atob(result.base64),"test");
});

test("download rejects retrieved bytes whose SHA-256 differs from the register",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",fileName:"test.pdf",sha256:"0".repeat(64),classification:"Internal",ownerUid:"emp-1",status:"WORKING"}}},writes:[],downloadBytes:new TextEncoder().encode("test")};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/download",{documentId:"LIFE-test",fileId:"drive-1"}),env);
  assert.equal(response.status,409);
  assert.match(await response.text(),/integrity verification failed/i);
});

test("failed Drive rollback is explicitly recorded and reported after atomic commit failure",async()=>{
  const state={docs:{},writes:[],deletedFiles:[],failAudit:true,failDelete:true,failureEvents:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  await assert.rejects(
    router(req("/api/document-lifecycle/upload",{fileName:"test.pdf",contentType:"application/pdf",base64:btoa("test"),title:"Test document",documentType:"Other",archiveCategory:"Administrative Documents",classification:"Internal"}),env),
    /rollback was incomplete; failure audit RECORDED/
  );
  assert.equal(state.failureEvents.length,1);
  assert.equal(state.failureEvents[0].action,"UPLOAD");
  assert.equal(state.failureEvents[0].details.rollbackStatus,"FAILED");
  assert.equal(state.failureEvents[0].details.rollbackError,"simulated Drive rollback failure");
});


test("translated derivative inherits the source classification and all access grants server-side",async()=>{
  const source={
    documentId:"LIFE-source-confidential",reference:"IRPA-DOC-2026-SOURCE01",title:"Confidential board minute",
    fileName:"board-minute.pdf",fileId:"drive-source-1",sha256:"a".repeat(64),ownerUid:"emp-1",ownerType:"EMPLOYEE",
    department:"Governance",unit:"Board Secretariat",documentType:"Governance",archiveCategory:"Governance Documents",
    classification:"Confidential",accessPolicy:"CONTROLLED",authorizedUids:["emp-1","board-member-2"],
    authorizedRoles:["Board Member","Executive Director"],authorizedDepartments:["Governance","Board Secretariat"],
    status:"FINAL_ARCHIVE",authorizationStatus:"AUTHORIZED",signatureStatus:"COMPLETED",
    postSignatureStatus:"COMPLETED",finalArchiveStatus:"ARCHIVED",version:"2.0"
  };
  const state={docs:{"LIFE-source-confidential":{plain:source}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/upload",{
    fileName:"translated-minute.txt",contentType:"text/plain",base64:btoa("Confidential translated content"),
    title:"Translated confidential board minute",documentType:"Other",
    archiveCategory:"Governance Documents",classification:"Confidential",parentDocumentId:"LIFE-source-confidential"
  }),env);
  assert.equal(response.status,201);
  const saved=Object.values(state.docs).find(row=>row.plain?.translationDerivative)?.plain;
  assert.ok(saved,"translated derivative registry record should be committed");
  assert.equal(saved.classification,"Confidential");
  assert.equal(saved.accessPolicy,"CONTROLLED");
  assert.equal(saved.archiveCategory,"Governance Documents");
  assert.equal(saved.documentType,"Governance");
  assert.equal(saved.ownerUid,"emp-1");
  assert.deepEqual(saved.authorizedUids.map(value=>value.stringValue),["emp-1","board-member-2"]);
  assert.deepEqual(saved.authorizedRoles.map(value=>value.stringValue),["Board Member","Executive Director"]);
  assert.deepEqual(saved.authorizedDepartments.map(value=>value.stringValue),["Governance","Board Secretariat"]);
  assert.equal(saved.parentDocumentId,"LIFE-source-confidential");
  assert.equal(saved.inheritedAccessFromDocumentId,"LIFE-source-confidential");
});

test("translated derivative upload is denied if client attempts to lower source classification",async()=>{
  const source={documentId:"LIFE-source-confidential",reference:"IRPA-DOC-2026-SOURCE01",title:"Confidential board minute",fileName:"board-minute.pdf",fileId:"drive-source-1",ownerUid:"emp-1",department:"Governance",documentType:"Governance",archiveCategory:"Governance Documents",classification:"Confidential",accessPolicy:"CONTROLLED",authorizedUids:["emp-1"],authorizedRoles:["Board Member"],authorizedDepartments:["Governance"]};
  const state={docs:{"LIFE-source-confidential":{plain:source}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/upload",{
    fileName:"translated-minute.txt",contentType:"text/plain",base64:btoa("Confidential translated content"),
    title:"Translated confidential board minute",documentType:"Governance",
    archiveCategory:"Administrative Documents",classification:"Internal",parentDocumentId:"LIFE-source-confidential"
  }),env);
  assert.equal(response.status,403);
  assert.match(await response.text(),/retain the source document's classification and archive category/i);
  assert.deepEqual(state.writes,[]);
});

test("generic lifecycle transition cannot mark a document Signed without canonical Gateway completion",async()=>{
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",classification:"Internal",ownerUid:"emp-1",uploadedByUid:"emp-1",authorizedUids:["emp-1"],archiveCategory:"Finance Documents",title:"Test",reference:"IRPA-DOC-1",status:"PENDING_SIGNATURE",signatureStatus:"PENDING"}}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/transition",{documentId:"LIFE-test",targetStage:"SIGNED"}),env);
  assert.equal(response.status,409);
  assert.match(await response.text(),/only be set by canonical Gateway signature completion/);
  assert.equal(state.writes.length,0);
  const lowercase=await router(req("/api/document-lifecycle/transition",{documentId:"LIFE-test",targetStage:"signed"}),env);
  assert.equal(lowercase.status,409);
  assert.equal(state.writes.length,0);
});


test("Firebase-only signature completion records ELECTRONIC_UNVERIFIED on document and envelope",async()=>{
  const envelopeId="firebase-env-1";
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",classification:"Internal",ownerUid:"emp-1",authorizedUids:["emp-1"],archiveCategory:"Finance Documents",title:"Test",reference:"IRPA-DOC-1",status:"PENDING_SIGNATURE"}}},envelopes:{[envelopeId]:{documentId:"LIFE-test",status:"Completed",lastSignedByUid:"signer-9",recipients:[{uid:"signer-9",status:"Signed"}],signedDocumentUrl:"https://drive.google.com/file/d/drive-signed-9/view"}},writes:[],deletedFiles:[]};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/signature-complete",{documentId:"LIFE-test",envelopeId}),env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.signatureAssurance,"ELECTRONIC_UNVERIFIED");
  assert.equal(state.docs["LIFE-test"].plain.signatureAssurance,"ELECTRONIC_UNVERIFIED");
  assert.equal(state.docs["LIFE-test"].plain.signedByUid,"signer-9");
  assert.equal(state.envelopes[envelopeId].signatureAssurance,"ELECTRONIC_UNVERIFIED");
  assert.notEqual(state.docs["LIFE-test"].plain.signedByUid,"emp-1");
});

test("Worker signature completion refuses an envelope without canonical signer quorum",async()=>{
  const envelopeId="firebase-env-worker";
  const state={docs:{"LIFE-test":{plain:{documentId:"LIFE-test",fileId:"drive-1",classification:"Internal",ownerUid:"emp-1",authorizedUids:["emp-1"],archiveCategory:"Finance Documents",title:"Test",reference:"IRPA-DOC-1",status:"PENDING_SIGNATURE"}}},envelopes:{[envelopeId]:{documentId:"LIFE-test",status:"Completed",gatewayEnvelopeId:"gateway-env-1",lastSignedByUid:"signer-9",recipients:[{uid:"signer-9",status:"Signed"}]}},writes:[],deletedFiles:[],verifyCanonicalSignatureEnvelope:async()=>({ok:false,error:"Canonical Gateway signer quorum is incomplete."})};
  const router=createDocumentLifecycleRouter(makeDeps(state));
  const response=await router(req("/api/document-lifecycle/signature-complete",{documentId:"LIFE-test",envelopeId}),env);
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/quorum is incomplete/);
  assert.equal(state.writes.length,0);
});
