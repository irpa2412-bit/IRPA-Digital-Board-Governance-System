import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentLifecycleRouter, buildMultipartBody } from "../src/documentLifecycle.mjs";

function plain(fields){return Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,v?.stringValue??v?.booleanValue??v?.integerValue??(v?.arrayValue?.values||undefined)]));}
function makeDeps(state){
  return {
    FIREBASE_PROJECT_ID:"irpa-digital-board-governance",
    allowedContentTypes:new Set(["application/pdf","text/plain"]),
    authenticateFirebaseRequest:async()=>({user_id:"emp-1",email:"employee@irpa.or.tz",token:"token"}),
    getFirestoreDocument:async(_env,path)=>{
      if(path==="adminProfiles/emp-1")return null;
      if(path==="members/emp-1")return null;
      if(path==="employees/emp-1")return {fields:{status:{stringValue:"Active"},department:{stringValue:"Finance"},roles:{arrayValue:{values:[{stringValue:"Finance Officer"}]}}}};
      if(path.startsWith("documents/"))return state.docs[path.split("/").pop()]||null;
      return null;
    },
    firestoreDocumentToPlain:doc=>doc?.plain||plain(doc?.fields),
    getDriveAccessToken:async()=> "drive-token",
    driveFetch:async(_env,_token,path,options={})=>{
      if(options.method==="DELETE"){state.deletedFiles.push(path);if(state.failDelete)throw new Error("simulated Drive rollback failure");return {};}
      if(path.includes("/copy"))return {id:"copied-"+Math.random().toString(16).slice(2)};
      if(path.includes("?fields=id,name,mimeType,size,description,trashed"))return {id:"drive-1",name:"test.pdf",mimeType:"application/pdf",size:"4",description:JSON.stringify({irpaGovernance:true,irpaDocumentLifecycle:true,documentId:"LIFE-test"})};
      return {id:"drive-1",name:"test.pdf",mimeType:"application/pdf",size:"4"};
    },
    findOrCreateFolder:async(_env,_token,name)=>"folder-"+name.replace(/\s+/g,"-"),
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
