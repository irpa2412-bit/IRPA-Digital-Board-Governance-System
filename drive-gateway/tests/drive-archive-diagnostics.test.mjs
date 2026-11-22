import test from "node:test";
import assert from "node:assert/strict";
import {probeDriveArchiveDestinations} from "../src/driveArchiveDiagnostics.mjs";

function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});}
function installFetch({duplicates=false,missing=false}={}){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input)),method=String(init.method||"GET").toUpperCase();calls.push({url,method});
  if(url.hostname==="oauth2.googleapis.com")return response({scope:"https://www.googleapis.com/auth/drive.file"});
  if(url.pathname==="/drive/v3/about")return response({storageQuota:{usage:"50",limit:"100"}});
  if(url.pathname==="/drive/v3/files"&&method==="GET"){
   const name=(url.searchParams.get("q")||"").match(/name='([^']+)'/)?.[1]||"";
   if(missing&&name==="Archive")return response({files:[]});
   const id={Root:"root-folder-123456",Archive:"archive-folder-234567",Document:"document-folder-345678"}[name];
   if(!id)return response({files:[]});
   const rows=[{id,name,owners:[{emailAddress:"drive-owner@example.org"}],createdTime:"2026-11-23T00:00:00Z",capabilities:{canAddChildren:true}}];
   if(duplicates&&name==="Archive")rows.push({...rows[0],id:"duplicate-root-654321"});
   return response({files:rows});
  }
  if(url.pathname==="/drive/v3/files/document-folder-345678")return response({id:"document-folder-345678",capabilities:{canAddChildren:true}});
  throw new Error("Unexpected diagnostic request: "+method+" "+url);
 };
 return{calls,restore:()=>{globalThis.fetch=original;}};
}

test("per-destination archive probe reports masked IDs, scopes, quota and never writes",async()=>{
 const mock=installFetch();
 try{
  const result=await probeDriveArchiveDestinations({env:{},helpers:{async getDriveAccessToken(){return"short-lived-token";}},rootFolderName:"Root",paths:[{name:"Board archive",destinationType:"archive",path:"Archive/Document/file.pdf"}]});
  assert.equal(result.tokenRefreshResult,"SUCCESS");
  assert.deepEqual(result.oauthScopes,["https://www.googleapis.com/auth/drive.file"]);
  assert.equal(result.quota.usedBytes,50);assert.equal(result.quota.freeBytes,50);
  assert.equal(result.destinations[0].probe,"PASS");
  assert.equal(result.destinations[0].folderIdMasked,"…345678");
  assert.equal(result.destinations[0].matchedByName,1);
  assert.equal(result.destinations[0].owner,"drive-owner@example.org");
  assert.equal(result.destinations[0].creator,"NOT_RECORDED");
  assert.ok(mock.calls.every(call=>call.method==="GET"));
 }finally{mock.restore();}
});

test("duplicate folder names are denied rather than choosing an ambiguous archive",async()=>{
 const mock=installFetch({duplicates:true});
 try{
  const result=await probeDriveArchiveDestinations({env:{},helpers:{async getDriveAccessToken(){return"token";}},rootFolderName:"Root",paths:[{name:"Owner copy",path:"Archive/Document/file.pdf"}]});
  assert.equal(result.destinations[0].probe,"DENIED");
  assert.equal(result.destinations[0].reasonCode,"MULTIPLE_FOLDER_MATCHES");
  assert.equal(result.destinations[0].matchedByName,2);
  assert.ok(mock.calls.every(call=>call.method==="GET"));
 }finally{mock.restore();}
});

test("missing archive folders are reported without creating them",async()=>{
 const mock=installFetch({missing:true});
 try{
  const result=await probeDriveArchiveDestinations({env:{},helpers:{async getDriveAccessToken(){return"token";}},rootFolderName:"Root",paths:[{name:"Signer copy",path:"Archive/Document/file.pdf"}]});
  assert.equal(result.destinations[0].probe,"DENIED");
  assert.equal(result.destinations[0].reasonCode,"FOLDER_NOT_FOUND");
  assert.equal(result.destinations[0].matchedByName,0);
  assert.ok(mock.calls.every(call=>call.method==="GET"));
 }finally{mock.restore();}
});
