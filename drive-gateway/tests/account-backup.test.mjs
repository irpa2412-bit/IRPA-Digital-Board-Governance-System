import test from "node:test";
import assert from "node:assert/strict";
import { createAccountBackupRouter } from "../src/accountBackup.mjs";

const owner = "custodian@example.org";
const env = {
  AUTHORIZED_DRIVE_EMAIL:owner,
  DRIVE_KV:{
    value:null,
    async get(){ return this.value; },
    async put(_key,value){ this.value=JSON.parse(value); }
  }
};
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const corsHeaders = () => ({ "Access-Control-Allow-Origin":"https://irpa.or.tz" });

test("account backup endpoints reject non-administrator callers before Drive access", async () => {
  const route = createAccountBackupRouter({
    authenticateFirebaseRequest:async()=>({firebaseClaims:{admin:false}}),
    getDriveAccessToken:async()=>{ throw new Error("Drive must not be called"); },
    corsHeaders,json
  });
  const response = await route(new Request("https://gateway.example/api/account-backup/provision",{method:"POST"}),env,"/api/account-backup/provision");
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,"ADMIN_REQUIRED");
});

test("provision creates a dedicated root-level folder and verifies owner-only permissions", async t => {
  const originalFetch = globalThis.fetch;
  t.after(()=>{ globalThis.fetch=originalFetch; });
  const calls=[];
  globalThis.fetch=async (url,options={}) => {
    const target=String(url);
    calls.push({url:target,options});
    if(target.includes("/drive/v3/files?q=")) return json({files:[]});
    if(target.includes("/drive/v3/files?fields=") && options.method==="POST") {
      const metadata=JSON.parse(options.body);
      assert.equal(metadata.name,"IRPA Account Backups (Restricted)");
      assert.equal(metadata.mimeType,"application/vnd.google-apps.folder");
      assert.equal("parents" in metadata,false);
      return json({id:"backup-folder-123",name:metadata.name,mimeType:metadata.mimeType,owners:[{emailAddress:owner}]});
    }
    if(target.includes("/permissions?")) return json({permissions:[{type:"user",emailAddress:owner,role:"owner"}]});
    if(target.includes("/drive/v3/files/backup-folder-123?")) return json({id:"backup-folder-123",name:"IRPA Account Backups (Restricted)",mimeType:"application/vnd.google-apps.folder",trashed:false,owners:[{emailAddress:owner}]});
    throw new Error("Unexpected Drive request " + target);
  };
  const route=createAccountBackupRouter({
    authenticateFirebaseRequest:async()=>({firebaseClaims:{admin:true}}),
    getDriveAccessToken:async()=>"drive-access-token",corsHeaders,json
  });
  const response=await route(new Request("https://gateway.example/api/account-backup/provision",{method:"POST"}),env,"/api/account-backup/provision");
  assert.equal(response.status,200);
  assert.equal((await response.json()).restricted,true);
  assert.equal(env.DRIVE_KV.value.folderId,"backup-folder-123");
  assert.ok(calls.some(call=>call.url.includes("/permissions?")));
});

test("provision refuses a dedicated folder shared with an additional principal", async t => {
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  env.DRIVE_KV.value=null;
  globalThis.fetch=async (url,options={})=>{
    const target=String(url);
    if(target.includes("/drive/v3/files?q=")) return json({files:[]});
    if(target.includes("/drive/v3/files?fields=") && options.method==="POST") {
      return json({id:"backup-folder-456",name:"IRPA Account Backups (Restricted)",mimeType:"application/vnd.google-apps.folder",owners:[{emailAddress:owner}]});
    }
    if(target.includes("/permissions?")) return json({permissions:[
      {type:"user",emailAddress:owner,role:"owner"},
      {type:"group",emailAddress:"staff@example.org",role:"reader"}
    ]});
    if(target.includes("/drive/v3/files/backup-folder-456?")) return json({id:"backup-folder-456",name:"IRPA Account Backups (Restricted)",mimeType:"application/vnd.google-apps.folder",trashed:false,owners:[{emailAddress:owner}]});
    throw new Error("Unexpected Drive request " + target);
  };
  const route=createAccountBackupRouter({
    authenticateFirebaseRequest:async()=>({firebaseClaims:{admin:true}}),
    getDriveAccessToken:async()=>"drive-access-token",corsHeaders,json
  });
  const response=await route(new Request("https://gateway.example/api/account-backup/provision",{method:"POST"}),env,"/api/account-backup/provision");
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,"BACKUP_FOLDER_HAS_UNAUTHORISED_ACCESS");
  assert.equal(env.DRIVE_KV.value,null);
});
