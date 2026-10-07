import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentLifecycleRouter } from "../src/documentLifecycle.mjs";

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
      if(options.method==="DELETE")return {};
      if(path.includes("/copy"))return {id:"copied-"+Math.random().toString(16).slice(2)};
      if(path.includes("?fields=id,name,mimeType,size,description,trashed"))return {id:"drive-1",name:"test.pdf",mimeType:"application/pdf",size:"4",description:JSON.stringify({irpaGovernance:true,irpaDocumentLifecycle:true,documentId:"LIFE-test"})};
      return {id:"drive-1",name:"test.pdf",mimeType:"application/pdf",size:"4"};
    },
    findOrCreateFolder:async(_env,_token,name)=>"folder-"+name.replace(/\s+/g,"-"),
    updateFirestoreDocument:async(_env,path,_token,fields)=>{state.writes.push({path,fields});return {name:path};},
    json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json",...headers}}),
    corsHeaders:()=>({})
  };
}
const env={};
function req(path,body){return new Request("https://example.test"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})}

test("restricted upload is denied server-side without restricted permission",async()=>{
  const state={docs:{},writes:[]};const router=createDocumentLifecycleRouter(makeDeps(state));
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
