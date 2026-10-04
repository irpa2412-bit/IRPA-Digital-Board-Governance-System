import { Conflict, VersionConflict } from "./adapters.mjs";

const mockRecords = new Map();
const mockObjects = new Map();
let mockSeq = 0;

export class EsignRecordDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const body = await request.json();
    return this.state.blockConcurrencyWhile(async () => {
      const key = String(body.key || "");
      if (!key) return Response.json({ ok:false, error:"Missing record key." }, {status:400});

      if (key === "__index__") {
        const keys = (await this.state.storage.get("keys")) || {};
        if (body.op === "add") { keys[body.recordKey] = true; await this.state.storage.put("keys",keys); return Response.json({ok:true}); }
        if (body.op === "remove") { delete keys[body.recordKey]; await this.state.storage.put("keys",keys); return Response.json({ok:true}); }
        if (body.op === "list") return Response.json({ok:true,keys:Object.keys(keys)});
      }

      if (body.operation === "auth-get") {
        return Response.json({ok:true,state:await this.state.storage.get("authState") || {}});
      }

      if (body.operation === "auth-set") {
        await this.state.storage.put("authState", body.state || {});
        return Response.json({ok:true});
      }

      if (body.operation === "auth-expire-lock") {
        const current = await this.state.storage.get("authState") || {};
        await this.state.storage.put("authState",{stage:"SECOND",failedAttempts:0,lockUntilMs:0,updatedAt:Date.now()});
        return Response.json({ok:true,previousStage:current.stage || null});
      }

      if (body.operation === "auth-clear") {
        await this.state.storage.put("authState",{stage:"FIRST",failedAttempts:0,lockUntilMs:0,updatedAt:Date.now()});
        return Response.json({ok:true});
      }

      if (body.operation === "auth-record-failure") {
        const current = await this.state.storage.get("authState") || {};
        const now = Date.now();
        if (current.stage === "SUSPENDED") return Response.json({ok:true,status:"SUSPENDED",resetRequired:true,remainingAttempts:0});
        if (current.stage === "LOCKED" && Number(current.lockUntilMs || 0) > now) {
          return Response.json({ok:true,status:"LOCKED",retryAfterSeconds:Math.ceil((current.lockUntilMs-now)/1000),remainingAttempts:0,resetRequired:false});
        }
        const stage = String(current.stage || "FIRST");
        const limit = stage === "SECOND" ? 3 : 3;
        const failedAttempts = Number(current.failedAttempts || 0) + 1;
        if (failedAttempts < limit) {
          await this.state.storage.put("authState",{stage,failedAttempts,lockUntilMs:0,updatedAt:now});
          return Response.json({ok:true,status:stage,remainingAttempts:limit-failedAttempts,resetRequired:false});
        }
        if (stage === "FIRST") {
          await this.state.storage.put("authState",{stage:"LOCKED",failedAttempts:0,lockUntilMs:now+5*60*1000,updatedAt:now});
          return Response.json({ok:true,status:"LOCKED",retryAfterSeconds:300,remainingAttempts:0,resetRequired:false});
        }
        await this.state.storage.put("authState",{stage:"SUSPENDED",failedAttempts,lockUntilMs:0,updatedAt:now});
        return Response.json({ok:true,status:"SUSPENDED",remainingAttempts:0,resetRequired:true});
      }

      if (body.operation === "next-reference") {
        const current = await this.state.storage.get("documentReferenceCounter") || {};
        const year = new Date().getUTCFullYear();
        const currentYear = Number(current.year || 0);
        const nextNumber = currentYear === year ? Number(current.nextNumber || 1) : 1;
        const reference = "IRPA-DOC-" + year + "-" + String(nextNumber).padStart(5,"0");
        await this.state.storage.put("documentReferenceCounter",{year,nextNumber:nextNumber+1,updatedAt:Date.now()});
        return Response.json({ok:true,reference,year});
      }

      if (body.op === "get") return Response.json({ok:true, value:await this.state.storage.get("record") || null});
      if (body.op === "create") {
        if (await this.state.storage.get("record")) return Response.json({ok:false,error:"exists"},{status:409});
        await this.state.storage.put("record",{...body.value,_v:1});
        return Response.json({ok:true});
      }
      if (body.op === "update") {
        const current = await this.state.storage.get("record");
        if (!current) return Response.json({ok:false,error:"not found"},{status:404});
        if (body.ifVersion !== undefined && current._v !== body.ifVersion) return Response.json({ok:false,error:"version conflict"},{status:409});
        await this.state.storage.put("record",{...current,...body.patch,_v:current._v+1});
        return Response.json({ok:true});
      }
      if (body.op === "delete") {
        await this.state.storage.delete("record");
        return Response.json({ok:true});
      }
      return Response.json({ok:false,error:"Unsupported operation."},{status:400});
    });
  }
}

function mockMeta() {
  return {
    async get(c,id){ return structuredClone(mockRecords.get(c+"/"+id) || null); },
    async create(c,id,d){ const k=c+"/"+id; if(mockRecords.has(k)) throw new Conflict(); mockRecords.set(k,{...structuredClone(d),_v:1}); },
    async update(c,id,p,{ifVersion}={}){ const k=c+"/"+id,r=mockRecords.get(k); if(!r) throw new Error("not found"); if(ifVersion!==undefined&&r._v!==ifVersion) throw new VersionConflict(); mockRecords.set(k,{...r,...structuredClone(p),_v:r._v+1}); },
    async delete(c,id){ mockRecords.delete(c+"/"+id); },
    async list(c){ return [...mockRecords.entries()].filter(([k])=>k.startsWith(c+"/")).map(([k,v])=>({id:k.slice(c.length+1),...structuredClone(v)})); }
  };
}
function mockStorage() {
  return {
    async put(x){ const id="mock-"+(++mockSeq); mockObjects.set(id,{...x,bytes:new Uint8Array(x.bytes)}); return {id,link:"mock://"+id}; },
    async get(id){ const x=mockObjects.get(id); return x ? new Uint8Array(x.bytes) : null; },
    async delete(id){ mockObjects.delete(id); }
  };
}
async function doCall(ns,name,body) {
  const r=await ns.get(ns.idFromName(name)).fetch("https://esign.internal",{method:"POST",body:JSON.stringify(body),headers:{"content-type":"application/json"}});
  const x=await r.json(); if(!r.ok) { if(x.error==="exists") throw new Conflict(); if(x.error==="version conflict") throw new VersionConflict(); throw new Error(x.error||"Durable Object error"); } return x;
}
function doMeta(env) {
  return {
    async get(c,id){ const r=await doCall(env.ESIGN_DO,c+"/"+id,{op:"get",key:c+"/"+id}); return r.value; },
    async create(c,id,d){ await doCall(env.ESIGN_DO,c+"/"+id,{op:"create",key:c+"/"+id,value:d}); await doCall(env.ESIGN_DO,"__index__",{op:"add",recordKey:c+"/"+id,key:"__index__"}); },
    async update(c,id,p,o={}){ await doCall(env.ESIGN_DO,c+"/"+id,{op:"update",key:c+"/"+id,patch:p,ifVersion:o.ifVersion}); },
    async delete(c,id){ await doCall(env.ESIGN_DO,c+"/"+id,{op:"delete",key:c+"/"+id}); await doCall(env.ESIGN_DO,"__index__",{op:"remove",recordKey:c+"/"+id,key:"__index__"}); },
    async list(c){ const keys=(await doCall(env.ESIGN_DO,"__index__",{op:"list",key:"__index__"})).keys.filter(k=>k.startsWith(c+"/")); const out=[]; for(const k of keys){const r=await doCall(env.ESIGN_DO,k,{op:"get",key:k}); if(r.value) out.push({id:k.slice(c.length+1),...r.value});} return out; }
  };
}
async function driveFolder(env, accessToken, path) {
  let parent=await findFolder(env,accessToken,"IRPA Governance System",null);
  for(const part of path.split("/").filter(Boolean)) parent=await findFolder(env,accessToken,part,parent);
  return parent;
}
async function findFolder(env,token,name,parent) {
  const q=[`name='${name.replaceAll("'","\\'")}'`,"mimeType='application/vnd.google-apps.folder'","trashed=false",parent?`'${parent}' in parents`:null].filter(Boolean).join(" and ");
  const x=await driveFetch(env,token,"/drive/v3/files?q="+encodeURIComponent(q)+"&spaces=drive&pageSize=10&fields=files(id)");
  if(x.files?.[0]?.id) return x.files[0].id;
  return (await driveFetch(env,token,"/drive/v3/files",{method:"POST",body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",...(parent?{parents:[parent]}:{})})})).id;
}
function driveStorage(env, helpers) {
  if(env.DRIVE_MOCK==="true") return mockStorage();
  return {
    async put({path,bytes,contentType,metadata}) {
      const parts=path.split("/"); const name=parts.pop(); const folder=await driveFolder(env,await helpers.getDriveAccessToken(env),parts.join("/"));
      const token=await helpers.getDriveAccessToken(env);
      const meta={name,parents:[folder],mimeType:contentType,description:JSON.stringify(metadata||{})};
      const boundary="esign-"+crypto.randomUUID(), enc=new TextEncoder();
      const head=enc.encode(`--${boundary}\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n${JSON.stringify(meta)}\\r\\n--${boundary}\\r\\nContent-Type: ${contentType}\\r\\n\\r\\n`);
      const tail=enc.encode(`\\r\\n--${boundary}--`), body=new Uint8Array(head.length+bytes.length+tail.length);
      body.set(head); body.set(bytes,head.length); body.set(tail,head.length+bytes.length);
      const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${boundary}`},body});
      const x=await r.json(); if(!r.ok) throw new Error(x.error?.message||"Google Drive upload failed.");
      return {id:x.id,link:x.webViewLink||`https://drive.google.com/file/d/${x.id}/view`};
    },
    async get(id){const token=await helpers.getDriveAccessToken(env); const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,{headers:{Authorization:`Bearer ${token}`}}); return r.ok?new Uint8Array(await r.arrayBuffer()):null;},
    async delete(id){const token=await helpers.getDriveAccessToken(env); const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}}); if(!r.ok&&r.status!==404) throw new Error("Google Drive deletion failed.");}
  };
}
export function buildEsignContext({env,verifyUser,sendInvitation,logger,now,driveHelpers}) {
  return {
    meta:env.DRIVE_MOCK==="true"?mockMeta():doMeta(env),
    storage:driveStorage(env,driveHelpers),
    verifyUser,
    sendInvitation,
    logger:logger||console,
    now:now||(()=>new Date()),
    config:{appUrl:String(env.IRPA_APP_URL||"https://irpa-digital-board-governance.web.app").replace(/\/$/,""),ttlDays:14},
    allowReturnTokens:env.DRIVE_MOCK==="true"
  };
}
