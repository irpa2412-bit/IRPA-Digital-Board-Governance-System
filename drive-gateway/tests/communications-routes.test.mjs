import test from "node:test";
import assert from "node:assert/strict";
import { communicationsRoutes } from "../src/communicationsRoutes.mjs";

function harness(role="Communications Officer",uid="author"){
 const values=new Map();const env={DRIVE_KV:{get:async k=>values.get(k)??null,put:async(k,v)=>values.set(k,v)}};
 const deps={
  authenticateFirebaseRequest:async()=>({uid,user_id:uid,token:"test"}),
  getFirestoreDocument:async()=>null,
  getInstitutionalProfileForUser:async()=>({memberRecord:{role,status:"Active"}}),
  firestoreDocumentToPlain:v=>v,
  corsHeaders:()=>({"Content-Type":"application/json"})
 };
 const call=async(path,method="GET",body)=>communicationsRoutes(new Request("https://worker.test"+path,{method,headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,deps);
 return {call,env,values};
}
test("editorial routes require authenticated active role",async()=>{const h=harness();const r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"Title",content:"Body"});assert.equal(r.status,201)});
test("create, submit, and approve require a distinct approver",async()=>{const a=harness("Communications Officer","author");let r=await a.call("/api/communications/editorial/items","POST",{kind:"post",title:"T",content:"B"});const id=(await r.json()).item.id;r=await a.call("/api/communications/editorial/items/"+id+"/submit","POST",{});assert.equal(r.status,200);r=await a.call("/api/communications/editorial/items/"+id+"/approve","POST",{});assert.equal(r.status,403);const p=harness("Approver","reviewer");p.values.set("communications:editorial:items",a.values.get("communications:editorial:items"));r=await p.call("/api/communications/editorial/items/"+id+"/approve","POST",{});assert.equal(r.status,200);assert.equal((await r.json()).item.status,"Approved")});
test("pause-all defaults to paused and only admin may change it",async()=>{const h=harness();let r=await h.call("/api/communications/publishing/pause");assert.equal((await r.json()).paused,true);r=await h.call("/api/communications/publishing/pause","POST",{paused:false});assert.equal(r.status,403)});
test("audit log is approver-only",async()=>{const h=harness();const r=await h.call("/api/communications/editorial/audit");assert.equal(r.status,403)});
test("social publishing router is included and manual export never publishes",async()=>{const h=harness();const r=await h.call("/api/communications/social/export","POST",{platform:"x",content:{text:"Draft for review"}});assert.equal(r.status,200);const data=await r.json();assert.equal(data.mode,"manual-export");assert.equal(data.published,undefined)});
