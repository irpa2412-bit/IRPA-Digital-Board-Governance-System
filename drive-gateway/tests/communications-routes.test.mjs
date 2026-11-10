import test from "node:test";
import assert from "node:assert/strict";
import { communicationsRoutes } from "../src/communicationsRoutes.mjs";

function harness(role="Communications Officer",uid="author"){
 const values=new Map();const env={DRIVE_KV:{get:async k=>values.get(k)??null,put:async(k,v)=>values.set(k,v)}};
 const deps={
  authenticateFirebaseRequest:async()=>({uid,user_id:uid,token:"test"}),
  getFirestoreDocument:async()=>null,
  getFirestoreCollectionDocuments:async(_env,name)=>name==="members"&&role!=="Administrator"?[{name:"members/"+uid,data:{status:"Active",role}}]:name==="adminProfiles"&&role==="Administrator"?[{name:"adminProfiles/"+uid,data:{active:true}}]:[],
  getInstitutionalProfileForUser:async()=>({memberRecord:{role,status:"Active"}}),
  firestoreDocumentToPlain:v=>v?.data||v,
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

test("social drafts persist bilingual metadata, immutable revisions, and HTTPS-only manual posting",async()=>{
 const h=harness("Administrator","owner");
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST update",content:"Verified update",contentSw:"Taarifa iliyothibitishwa",platforms:["facebook"],hashtags:"#IRPA",campaignTag:"TEST",altText:"TEST image",imageUrl:"https://example.org/test.jpg"});
 assert.equal(r.status,201);const item=(await r.json()).item;assert.equal(item.contentSw,"Taarifa iliyothibitishwa");assert.equal(item.campaignTag,"TEST");
 r=await h.call("/api/communications/editorial/items/"+item.id,"PATCH",{content:"Revised verified update"});assert.equal(r.status,200);assert.equal((await r.json()).item.revision,2);
 r=await h.call("/api/communications/editorial/items/"+item.id+"/revisions");assert.equal(r.status,200);const revisions=(await r.json()).revisions;assert.equal(revisions.length,1);assert.equal(revisions[0].content,"Verified update");
 r=await h.call("/api/communications/editorial/items/"+item.id+"/posted","POST",{liveUrl:"http://example.org/post"});assert.equal(r.status,400);
 r=await h.call("/api/communications/editorial/items/"+item.id+"/posted","POST",{liveUrl:"https://example.org/post",postedAt:"2026-11-09T12:00:00Z"});assert.equal(r.status,200);assert.equal((await r.json()).item.status,"Exported");
});
test("social post creation blocks credentials, private contacts, confidential records, non-HTTPS links and missing media alt text",async()=>{
 const h=harness("Administrator","owner");
 for(const content of ["password: example","Call +255 712 345 678","Confidential project record","Private contact daniel@example.com"]){
  const r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST",content});
  assert.equal(r.status,400,content);
 }
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST",content:"Safe content",link:"http://example.org"});assert.equal(r.status,400);
 r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST",content:"Safe content",imageUrl:"https://example.org/a.jpg"});assert.equal(r.status,400);
});

test("sole enrolled administrator may approve own item only with typed reason and audit evidence",async()=>{
 const h=harness("Administrator","only-admin");
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST",content:"Verified TEST content"});
 const id=(await r.json()).item.id;
 await h.call("/api/communications/editorial/items/"+id+"/submit","POST",{});
 r=await h.call("/api/communications/editorial/items/"+id+"/approve","POST",{reason:""});
 assert.equal(r.status,400);
 r=await h.call("/api/communications/editorial/items/"+id+"/approve","POST",{reason:"Reviewed evidence and verified the TEST content."});
 assert.equal(r.status,200);
 const approved=(await r.json()).item;
 assert.equal(approved.status,"Approved");
 assert.equal(approved.approvalReason,"Reviewed evidence and verified the TEST content.");
 const events=JSON.parse(h.values.get("communications:editorial:audit"));
 const event=events.find(x=>x.action==="APPROVE");
 assert.equal(event.actorUid,"only-admin");
 assert.equal(event.approvalMode,"SOLE_ADMINISTRATOR");
 assert.equal(event.reason,approved.approvalReason);
 assert.ok(event.at);
});
test("administrator self-approval is denied when any second enrolled user exists",async()=>{
 const h=harness("Administrator","admin");
 const call=async(path,method="GET",body)=>communicationsRoutes(new Request("https://worker.test"+path,{method,headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})}),h.env,{
  authenticateFirebaseRequest:async()=>({uid:"admin",user_id:"admin",token:"test"}),
  getFirestoreDocument:async()=>null,
  getFirestoreCollectionDocuments:async(_env,name)=>name==="adminProfiles"?[{name:"adminProfiles/admin",data:{active:true}}]:name==="members"?[{name:"members/second-user",data:{status:"Active",role:"Communications Officer"}}]:[],
  getInstitutionalProfileForUser:async()=>({memberRecord:{role:"Administrator",status:"Active"}}),
  firestoreDocumentToPlain:v=>v?.data||v,corsHeaders:()=>({"Content-Type":"application/json"})
 });
 let r=await call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST",content:"Verified TEST content"});
 const id=(await r.json()).item.id;
 await call("/api/communications/editorial/items/"+id+"/submit","POST",{});
 r=await call("/api/communications/editorial/items/"+id+"/approve","POST",{reason:"I reviewed the content and evidence."});
 assert.equal(r.status,403);
 assert.match((await r.json()).error,/another enrolled user exists/);
});
test("non-administrator author cannot use sole-administrator self-approval",async()=>{
 const h=harness("Communications Officer","author");
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"TEST",content:"Verified TEST content"});
 const id=(await r.json()).item.id;
 await h.call("/api/communications/editorial/items/"+id+"/submit","POST",{});
 r=await h.call("/api/communications/editorial/items/"+id+"/approve","POST",{reason:"I approve this myself with a reason."});
 assert.equal(r.status,403);
});
