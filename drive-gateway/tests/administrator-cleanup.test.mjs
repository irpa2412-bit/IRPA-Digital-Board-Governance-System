import test from "node:test";
import assert from "node:assert/strict";
import { createAdministratorCleanupRouter } from "../src/administratorCleanup.mjs";

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
function harness({email="irpa2412@gmail.com",active=true,collections={}}={}) {
  const kv = new Map();
  const env = { DRIVE_KV: {
    put: async (key,value) => kv.set(key,value),
    get: async key => kv.get(key) || null
  }};
  const deps = {
    authenticateFirebaseRequest: async () => ({user_id:"admin-uid",email}),
    getFirestoreAdminAccessToken: async () => "firestore-token",
    getFirestoreDocument: async (_env,path) => path==="adminProfiles/admin-uid" ? {fields:{}} : null,
    firestoreDocumentToPlain: doc => {
      if(!doc) return null;
      if(doc.fields && Object.keys(doc.fields).length) return doc.fields;
      return doc.data || {};
    },
    getFirestoreCollectionDocuments: async (_env,name) => (collections[name] || []).map(row => ({name:"projects/p/databases/(default)/documents/"+name+"/"+row.id,data:row.data})),
    getFirebaseAuthAdminAccessToken: async () => "auth-token",
    listFirebaseAuthUsers: async () => [{localId:"admin-uid",email:"irpa2412@gmail.com"}],
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
test("execution stays locked even after typed confirmation until destructive acceptance gates pass", async () => {
  const {route,env}=harness();
  const inv=await (await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory")).json();
  const plan=await (await route(new Request("https://gateway.test/api/admin/cleanup/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:inv.inventoryId,selections:[]})}),env,"/api/admin/cleanup/plan")).json();
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/execute",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planId:plan.planId,confirmation:"DELETE"})}),env,"/api/admin/cleanup/execute");
  const body=await res.json();
  assert.equal(res.status,423);
  assert.equal(body.code,"EXECUTOR_NOT_READY");
});
test("non-primary identity is refused", async () => {
  const {route,env}=harness({email:"other@example.test"});
  const res=await route(new Request("https://gateway.test/api/admin/cleanup/inventory"),env,"/api/admin/cleanup/inventory");
  assert.equal(res.status,403);
});
