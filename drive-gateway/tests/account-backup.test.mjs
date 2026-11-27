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

test("download returns only an encrypted backup file inside the verified custodian folder", async t => {
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const encrypted=Buffer.from('{"version":1,"algorithm":"AES-256-GCM"}');
  globalThis.fetch=async (url,options={})=>{
    const target=String(url);
    if(target.includes("/drive/v3/files/backup-folder-123?fields=")) return json({
      id:"backup-folder-123",name:"IRPA Account Backups (Restricted)",
      mimeType:"application/vnd.google-apps.folder",trashed:false,owners:[{emailAddress:owner}]
    });
    if(target.includes("/permissions?")) return json({permissions:[{type:"user",emailAddress:owner,role:"owner"}]});
    if(target.includes("/drive/v3/files/backup-file-123?fields=")) return json({
      id:"backup-file-123",name:"irpa-account-backup-test.enc.json",
      mimeType:"application/vnd.irpa.account-backup+json",parents:["backup-folder-123"],
      trashed:false,size:String(encrypted.length)
    });
    if(target.includes("/drive/v3/files/backup-file-123?alt=media")) return new Response(encrypted);
    throw new Error("Unexpected Drive request "+target);
  };
  env.DRIVE_KV.value={folderId:"backup-folder-123",folderName:"IRPA Account Backups (Restricted)",custodianEmail:owner};
  const route=createAccountBackupRouter({
    authenticateFirebaseRequest:async()=>({firebaseClaims:{admin:true}}),
    getDriveAccessToken:async()=>"drive-access-token",corsHeaders,json
  });
  const response=await route(new Request("https://gateway.example/api/account-backup/download",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileId:"backup-file-123"})
  }),env,"/api/account-backup/download");
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.ok,true);
  assert.equal(result.sha256,await (async()=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encrypted))).map(b=>b.toString(16).padStart(2,"0")).join(""))());
  assert.equal(Buffer.from(result.encryptedPayload,"base64").toString(),encrypted.toString());
});

test("download refuses a file outside the dedicated backup folder", async t => {
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async (url)=>{
    const target=String(url);
    if(target.includes("/drive/v3/files/backup-folder-123?fields=")) return json({
      id:"backup-folder-123",name:"IRPA Account Backups (Restricted)",
      mimeType:"application/vnd.google-apps.folder",trashed:false,owners:[{emailAddress:owner}]
    });
    if(target.includes("/permissions?")) return json({permissions:[{type:"user",emailAddress:owner,role:"owner"}]});
    if(target.includes("/drive/v3/files/backup-file-999?fields=")) return json({
      id:"backup-file-999",name:"not-an-irpa-backup.enc.json",
      mimeType:"application/vnd.irpa.account-backup+json",parents:["other-folder"],trashed:false,size:"32"
    });
    throw new Error("Unexpected Drive request "+target);
  };
  env.DRIVE_KV.value={folderId:"backup-folder-123",folderName:"IRPA Account Backups (Restricted)",custodianEmail:owner};
  const route=createAccountBackupRouter({
    authenticateFirebaseRequest:async()=>({firebaseClaims:{admin:true}}),
    getDriveAccessToken:async()=>"drive-access-token",corsHeaders,json
  });
  const response=await route(new Request("https://gateway.example/api/account-backup/download",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fileId:"backup-file-999"})
  }),env,"/api/account-backup/download");
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,"BACKUP_FILE_OUTSIDE_CUSTODIAN_FOLDER");
});
