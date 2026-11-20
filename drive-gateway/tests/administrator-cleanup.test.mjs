import test from "node:test";
import assert from "node:assert/strict";
import { createAdministratorCleanupRouter } from "../src/administratorCleanup.mjs";

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
function harness({email="irpa2412@gmail.com",active=true,collections={},version="v1",failBackup=false}={}) {
  const kv = new Map();
  const env = { DRIVE_KV: {
    put: async (key,value) => kv.set(key,value),
    get: async key => kv.get(key) || null
  }};
  const deps = {
    authenticateFirebaseRequest: async () => ({user_id:"admin-uid",email,emailVerified:true,firebaseClaims:{admin:true}}),
    getFirestoreAdminAccessToken: async () => "firestore-token",
    getFirestoreDocument: async (_env,path) => path==="adminProfiles/admin-uid" ? {fields:{}} : null,
    firestoreDocumentToPlain: doc => {
      if(!doc) return null;
      if(doc.fields && Object.keys(doc.fields).length) return doc.fields;
      return doc.data || {};
    },
    getFirestoreCollectionDocuments: async (_env,name) => (collections[name] || []).map(row => ({name:"projects/p/databases/(default)/documents/"+name+"/"+row.id,updateTime:row.updateTime||version,data:row.data})),
    getFirebaseAuthAdminAccessToken: async () => "auth-token",
    listFirebaseAuthUsers: async () => [{localId:"admin-uid",email:"irpa2412@gmail.com"},...(collections.members||[]).filter(row=>row.data.uid).map(row=>({localId:row.data.uid,email:row.data.email}))],
    getFirebaseProjectId: () => "test-project",
    getDriveAccessToken: async () => "drive-token",
    findOrCreateFolder: async () => "backup-folder",
    driveFetch: async (_env,_token,url) => ({id:"copied-drive-file",name:"copied-file",webViewLink:"https://drive.google.com/file/d/copied-drive-file/view"}),
    fetch: async (url,options={}) => {
      const target=String(url);
      if(target.includes(":listCollectionIds")) return response({collectionIds:[]});
      if(target.includes("upload/drive/v3/files?uploadType=multipart")) return failBackup ? response({error:"backup unavailable"},500) : response({id:"backup-json-file",webViewLink:"https://drive.google.com/file/d/backup-json-file/view"});
      if(target.includes("upload/drive/v3/files/") && options.method==="PATCH") return response({});
      if(target.includes("/accounts:delete")) return response({});
      if(target.includes("/adminCleanupAudit?documentId=")) return response({});
      if(target.includes("/documents/members/m1") && options.method==="GET") return response({updateTime:version,fields:{uid:{stringValue:"member-1"}}});
      if(target.includes("/documents/members/m1") && options.method==="DELETE") return response({});
      throw new Error("Unexpected cleanup fetch: "+target+" "+String(options.method||"GET"));
    },
    json: response,
    corsHeaders: () => ({})
  };
  deps.getFirestoreDocument = async (_env,path) => path==="adminProfiles/admin-uid" ? {data:{active:active,role:"Administrator"}} : null;
  return { route:createAdministratorCleanupRouter(deps),env,kv };
}
test("inventory is the mandatory first phase and every row defaults to STAYS", async () => {
  const {route,env}=harness({collections:{members:[{id:"m1",data:{fullName:"A Member",email:"a@example.test",uid:"member-1"}}]}});
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory");
  const body=await res.json();
  assert.equal(res.status,200);
  assert.equal(body.mandatoryBeforeReset,true);
  assert.equal(body.records[0].decision,"STAYS");
  assert.equal(body.summary.goes,0);
});
test("cleanup plan cannot be prepared without a completed inventory", async () => {
  const {route,env}=harness();
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selections:[]})}),env,"/api/admin/cleanup/plan");
  assert.equal(res.status,409);
});
test("explicit GOES selection is limited to inventory rows and protected records remain STAYS", async () => {
  const {route,env}=harness({collections:{members:[
    {id:"m1",data:{fullName:"Ordinary Member",uid:"member-1"}},
    {id:"m2",data:{fullName:"Administrator",uid:"admin-uid",role:"Administrator"}}
  ]}});
  const inventoryResponse=await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory");
  const inventory=await inventoryResponse.json();
  const responsePlan=await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:inventory.inventoryId,selections:[{key:"members/m1",decision:"GOES"},{key:"members/m2",decision:"GOES"}]})}),env,"/api/admin/cleanup/plan");
  const plan=await responsePlan.json();
  assert.equal(responsePlan.status,200);
  assert.equal(plan.records.find(row=>row.key==="members/m1").decision,"GOES");
  assert.equal(plan.records.find(row=>row.key==="members/m2").decision,"STAYS");
});
test("execution creates a durable backup before deleting the selected member and Auth account", async () => {
  const {route,env}=harness({collections:{members:[{id:"m1",data:{fullName:"Test Member",uid:"member-1",email:"member@example.test"}}]}});
  const inv=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const planResponse=await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:inv.inventoryId,selections:[{key:"members/m1",decision:"GOES"}]})}),env,"/api/admin/cleanup/plan");
  const plan=await planResponse.json();
  assert.equal(plan.summary.goes,1);
  assert.ok(plan.executionOperations.some(operation=>operation.type==="auth-delete"));
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/execute",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planId:plan.planId,confirmation:"DELETE"})}),env,"/api/admin/cleanup/execute");
  const body=await res.json();
  assert.equal(res.status,200);
  assert.equal(body.status,"COMPLETE");
  assert.equal(body.backupDriveFileId,"backup-json-file");
  assert.equal(body.operationOutcomes.length,2);
});

test("backup failure prevents every destructive operation", async () => {
  const {route,env}=harness({collections:{members:[{id:"m1",data:{fullName:"Test Member",uid:"member-1",email:"member@example.test"}}]},failBackup:true});
  const inv=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const plan=await (await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:inv.inventoryId,selections:[{key:"members/m1",decision:"GOES"}]})}),env,"/api/admin/cleanup/plan")).json();
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/execute",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planId:plan.planId,confirmation:"DELETE"})}),env,"/api/admin/cleanup/execute");
  assert.equal(res.status,502);
  assert.equal((await res.json()).code,"CLEANUP_EXECUTION_BLOCKED");
});
test("non-primary identity is refused", async () => {
  const {route,env}=harness({email:"other@example.test"});
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory");
  assert.equal(res.status,403);
});

test("verified email and current Firebase admin claim are mandatory", async () => {
  const {env}=harness();
  const deps={
    authenticateFirebaseRequest:async()=>({user_id:"admin-uid",email:"irpa2412@gmail.com",emailVerified:false,firebaseClaims:{admin:false}}),
    getFirestoreAdminAccessToken:async()=>"firestore-token",
    getFirestoreDocument:async()=>({data:{active:true,role:"Administrator"}}),
    firestoreDocumentToPlain:doc=>doc?.data||{},
    getFirestoreCollectionDocuments:async()=>[],
    getFirebaseAuthAdminAccessToken:async()=>"auth-token",
    listFirebaseAuthUsers:async()=>[],
    json:response,corsHeaders:()=>({})
  };
  const route=createAdministratorCleanupRouter(deps);
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory");
  assert.equal(res.status,403);
});

test("immutable audit history is inventory-only and always protected", async () => {
  const {route,env}=harness({collections:{audit:[{id:"a1",data:{action:"SIGNATURE_COMPLETED",recordId:"doc-1"}}]}});
  const inventory=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const row=inventory.records.find(item=>item.key==="audit/a1");
  assert.equal(row.protected,true);
  assert.match(row.protectionReason,/immutable audit/i);
});

test("signed trial envelope is identified from TRIAL origin and its signer is protected by email", async () => {
  const {route,env}=harness({collections:{
    members:[{id:"member-1",data:{name:"Trial Signer",email:"signer@example.test",role:"Member"}}],
    signatureEnvelopes:[{id:"env-1",data:{recordOrigin:"TRIAL",status:"Completed",signedPdfReference:"drive-file-1",signers:[{email:"signer@example.test",status:"Signed"}]}}]
  }});
  const inventory=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const member=inventory.records.find(item=>item.key==="members/member-1");
  const envelope=inventory.records.find(item=>item.key==="signatureEnvelopes/env-1");
  assert.equal(member.protected,true);
  assert.match(member.protectionReason,/signer/i);
  assert.equal(envelope.signedTrialDocument,true);
  assert.equal(envelope.signedPdfReference,"drive-file-1");
});

test("cleanup plan rejects duplicate keys and invalid decisions", async () => {
  const {route,env}=harness({collections:{members:[{id:"m1",data:{name:"Member",email:"m@example.test"}}]}});
  const inventory=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const duplicate=await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:inventory.inventoryId,selections:[{key:"members/m1",decision:"GOES"},{key:"members/m1",decision:"STAYS"}]})}),env,"/api/admin/cleanup/plan");
  assert.equal(duplicate.status,400);
  const invalid=await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:inventory.inventoryId,selections:[{key:"members/m1",decision:"DELETE"}]})}),env,"/api/admin/cleanup/plan");
  assert.equal(invalid.status,400);
});

test("inventory exposes related-record dependency keys for administrator review", async () => {
  const {route,env}=harness({collections:{
    members:[{id:"member-1",data:{uid:"member-uid",name:"Linked Member",email:"member@example.test"}}],
    meetings:[{id:"meeting-1",data:{title:"Board Meeting",participantUids:["member-uid"]}}]
  }});
  const inventory=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const member=inventory.records.find(item=>item.key==="members/member-1");
  assert.ok(member.linkedRecordKeys.includes("meetings/meeting-1"));
  assert.equal(member.dependencyCount,1);
});
