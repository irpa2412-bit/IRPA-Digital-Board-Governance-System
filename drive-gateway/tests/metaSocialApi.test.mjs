import test from "node:test";
import assert from "node:assert/strict";
import { createMetaSocialApiRouter } from "../src/metaSocialApi.mjs";

function kvStore() {
  const values = new Map();
  return {
    values,
    async get(key, type) { const value=values.get(key); if(value===undefined)return null; return type==="json"?JSON.parse(value):value; },
    async put(key,value) { values.set(key,typeof value==="string"?value:JSON.stringify(value)); },
    async delete(key) { values.delete(key); }
  };
}
function harness({role="Communications Officer",envOverrides={}}={}) {
  const kv=kvStore();
  const env={IRPA_ENVIRONMENT:"staging",META_APP_ID:"12345678901234",META_APP_SECRET:"not-a-real-secret",META_REDIRECT_URI:"https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev/api/communications/meta/callback",META_TOKEN_ENCRYPTION_KEY:btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),DRIVE_KV:kv,...envOverrides};
  const router=createMetaSocialApiRouter({
    authenticateFirebaseRequest:async()=>({user_id:"user-1",email:"test@example.invalid",token:"test-token"}),
    getFirestoreDocument:async()=>null,
    getInstitutionalProfileForUser:async()=>({memberRecord:{fields:{status:{stringValue:"Active"},role:{stringValue:role}}}}),
    firestoreDocumentToPlain:doc=>doc?.fields?Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,v.stringValue??v.booleanValue??null])):doc,
    json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...headers}}),
    corsHeaders:()=>({"Access-Control-Allow-Origin":"https://irpa.or.tz"})
  });
  return {router,env,kv};
}
test("Meta connect route is staging-only and requests read-only permissions",async()=>{
 const {router,env}=harness();
 const response=await router(new Request("https://gateway.example/api/communications/meta/connect",{method:"POST",headers:{Authorization:"Bearer firebase-test"}}),env);
 assert.equal(response.status,200);
 const body=await response.json();
 const auth=new URL(body.authorizationUrl);
 assert.equal(auth.hostname,"www.facebook.com");
 assert.equal(auth.searchParams.get("scope"),"pages_show_list,pages_read_engagement,instagram_basic");
 assert.equal(body.postingEnabled,false);
 assert.ok(!auth.searchParams.get("scope").includes("publish"));
 assert.equal((await router(new Request("https://gateway.example/api/communications/meta/status",{headers:{Authorization:"Bearer firebase-test"}}),env)).status,200);
});
test("Meta integration refuses production environment and production callback host",async()=>{
 const {router,env}=harness({envOverrides:{IRPA_ENVIRONMENT:"production"}});
 const response=await router(new Request("https://gateway.example/api/communications/meta/connect",{method:"POST"}),env);
 assert.equal(response.status,503);
 const bad=harness({envOverrides:{META_REDIRECT_URI:"https://irpa.or.tz/api/communications/meta/callback"}});
 const badResponse=await bad.router(new Request("https://gateway.example/api/communications/meta/connect",{method:"POST"}),bad.env);
 assert.equal(badResponse.status,503);
});
test("Meta connection status does not disclose token material",async()=>{
 const {router,env}=harness();
 const response=await router(new Request("https://gateway.example/api/communications/meta/status"),env);
 const body=await response.json();
 assert.equal(body.postingEnabled,false);
 assert.equal(body.connected,false);
 assert.equal("access_token" in body,false);
 assert.equal("encryptedToken" in body,false);
});
test("unauthorized roles cannot initiate Meta authorization",async()=>{
 const {router,env}=harness({role:"Finance Officer"});
 const response=await router(new Request("https://gateway.example/api/communications/meta/connect",{method:"POST"}),env);
 assert.equal(response.status,403);
});
test("OAuth callback rejects missing, expired and replayed state",async()=>{
 const {router,env}=harness();
 const missing=await router(new Request("https://gateway.example/api/communications/meta/callback?code=example"),env);
 assert.equal(missing.status,400);
 await env.DRIVE_KV.put("meta:oauth-state:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",JSON.stringify({uid:"user-1",createdAt:Date.now()-700000,environment:"staging"}));
 const expired=await router(new Request("https://gateway.example/api/communications/meta/callback?state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code=example"),env);
 assert.equal(expired.status,400);
 assert.equal(await env.DRIVE_KV.get("meta:oauth-state:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),null);
});
