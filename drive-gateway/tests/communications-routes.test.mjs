import test from "node:test";
import assert from "node:assert/strict";
import { communicationsRoutes } from "../src/communicationsRoutes.mjs";

function harness(role="Communications Officer",uid="author",options={}){
 const values=new Map();
 const env={IRPA_ENVIRONMENT:options.environment||"staging",FIREBASE_PROJECT_ID:"irpa-dbg-staging-a73ec",IRPA_PRODUCTION_CUTOVER:"false",DRIVE_KV:{get:async k=>values.get(k)??null,put:async(k,v)=>values.set(k,v)}};
 const deps={
  authenticateFirebaseRequest:async()=>({uid,user_id:uid,token:"test"}),
  getFirestoreDocument:async(_env,path)=>options.admin&&path==="adminProfiles/"+uid?{active:true}:null,
  getInstitutionalProfileForUser:async()=>({memberRecord:{role,status:"Active"}}),
  firestoreDocumentToPlain:v=>v,
  publishMetaContent:async(_env,args)=>({platform:args.platform,accountId:args.accountId,postId:"page_post_123",publishedAt:"2026-11-09T10:00:00.000Z"}),
  corsHeaders:()=>({"Content-Type":"application/json"})
 };
 const call=async(path,method="GET",body)=>communicationsRoutes(new Request("https://worker.test"+path,{method,headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,deps);
 return {call,env,values,deps};
}
test("editorial routes require authenticated active role",async()=>{const h=harness();const r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"Title",content:"Body"});assert.equal(r.status,201)});
test("create, submit, and approve require a distinct approver",async()=>{const a=harness("Communications Officer","author");let r=await a.call("/api/communications/editorial/items","POST",{kind:"post",title:"T",content:"B"});const id=(await r.json()).item.id;r=await a.call("/api/communications/editorial/items/"+id+"/submit","POST",{});assert.equal(r.status,200);r=await a.call("/api/communications/editorial/items/"+id+"/approve","POST",{});assert.equal(r.status,403);const p=harness("Approver","reviewer");p.values.set("communications:editorial:items",a.values.get("communications:editorial:items"));r=await p.call("/api/communications/editorial/items/"+id+"/approve","POST",{});assert.equal(r.status,200);assert.equal((await r.json()).item.status,"Approved")});
test("pause-all defaults to paused and only admin may change it",async()=>{const h=harness();let r=await h.call("/api/communications/publishing/pause");assert.equal((await r.json()).paused,true);r=await h.call("/api/communications/publishing/pause","POST",{paused:false});assert.equal(r.status,403)});
test("audit log is approver-only",async()=>{const h=harness();const r=await h.call("/api/communications/editorial/audit");assert.equal(r.status,403)});
test("social publishing router is included and manual export never publishes",async()=>{const h=harness();const r=await h.call("/api/communications/social/export","POST",{platform:"x",content:{text:"Draft for review"}});assert.equal(r.status,200);const data=await r.json();assert.equal(data.mode,"manual-export");assert.equal(data.published,undefined)});
test("administrator can use the explicit self-approval override in staging only",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"Staging test",content:"Approved test content",platforms:["facebook"]});
 const item=(await r.json()).item;
 await h.call("/api/communications/editorial/items/"+item.id+"/submit","POST",{});
 r=await h.call("/api/communications/editorial/items/"+item.id+"/approve","POST",{stagingAdminOverride:true});
 const result=await r.json();
 assert.equal(r.status,200);
 assert.equal(result.item.status,"Approved");
 assert.equal(result.item.approvalMode,"STAGING_ADMIN_OVERRIDE");
 assert.equal(result.item.approvedRevision,result.item.revision);
});
test("administrator self-approval override is rejected outside staging",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"production"});
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"Production test",content:"Must not self approve"});
 const item=(await r.json()).item;
 await h.call("/api/communications/editorial/items/"+item.id+"/submit","POST",{});
 r=await h.call("/api/communications/editorial/items/"+item.id+"/approve","POST",{stagingAdminOverride:true});
 assert.equal(r.status,403);
});
test("publishing uses the saved approved item and writes a publishing audit event",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 h.values.set("communications:publishing:paused","false");
 h.values.set("communications:editorial:items",JSON.stringify([{id:"saved-1",kind:"post",status:"Approved",approvedBy:"reviewer",approvedAt:"2026-11-09T09:00:00.000Z",approvedRevision:2,revision:2,authorUid:"author",content:"Verified test content",platforms:["facebook"]}]));
 let called=null;h.deps.publishMetaContent=async(_env,args)=>{called=args;return {platform:"facebook",accountId:args.accountId,postId:"page_post_456",publishedAt:"2026-11-09T10:00:00.000Z"};};
 const r=await h.call("/api/communications/social/publish","POST",{itemId:"saved-1",platform:"facebook",accountId:"page-1"});
 const result=await r.json();
 assert.equal(r.status,200);
 assert.equal(result.published,true);
 assert.equal(called.uid,"admin");
 assert.equal(called.text,"Verified test content");
 const audit=JSON.parse(h.values.get("communications:publishing:audit"));
 assert.equal(audit[0].action,"PUBLISHED");
 assert.equal(audit[0].postId,"page_post_456");
});
test("publishing rejects client-forged approval data and does not call the platform",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 h.values.set("communications:publishing:paused","false");
 h.values.set("communications:editorial:items",JSON.stringify([{id:"saved-draft",status:"Draft",revision:1,authorUid:"admin",content:"Draft"}]));
 let calls=0;h.deps.publishMetaContent=async()=>{calls++;return {postId:"should-not-exist"};};
 const r=await h.call("/api/communications/social/publish","POST",{platform:"facebook",accountId:"page-1",item:{id:"saved-draft",status:"Approved",approvedBy:"fake",approvedAt:"now",approvedRevision:1,revision:1}});
 assert.equal(r.status,403);
 assert.equal(calls,0);
});
test("global publishing pause blocks the platform adapter",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 h.values.set("communications:editorial:items",JSON.stringify([{id:"approved-1",status:"Approved",approvedBy:"reviewer",approvedAt:"now",approvedRevision:1,revision:1,authorUid:"author",content:"Test",platforms:["facebook"]}]));
 let calls=0;h.deps.publishMetaContent=async()=>{calls++;return {postId:"should-not-exist"};};
 const r=await h.call("/api/communications/social/publish","POST",{itemId:"approved-1",platform:"facebook",accountId:"page-1"});
 assert.equal(r.status,423);
 assert.equal(calls,0);
});

test("publishing audit combines platform outcomes with governance pause and approval events",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 h.values.set("communications:publishing:audit",JSON.stringify([{id:"p1",action:"PUBLISHED",itemId:"item-1",platform:"facebook",postId:"page_post_1",at:"2026-11-09T10:00:00.000Z"}]));
 h.values.set("communications:editorial:audit",JSON.stringify([{id:"g2",action:"CREATED",itemId:"item-2",at:"2026-11-09T08:00:00.000Z"},{id:"g1",action:"PUBLISHING_PAUSE_CHANGED",paused:true,at:"2026-11-09T09:00:00.000Z"}]));
 const r=await h.call("/api/communications/social/audit");
 const data=await r.json();
 assert.equal(r.status,200);
 assert.equal(data.events.length,3);
 assert.equal(data.events[0].action,"PUBLISHED");
 assert.equal(data.events[1].action,"PUBLISHING_PAUSE_CHANGED");
 assert.equal(data.events[2].action,"CREATED");
});
test("publishing audit is denied to a non-reviewer communications author",async()=>{
 const h=harness("Communications Officer","author");
 const r=await h.call("/api/communications/social/audit");
 assert.equal(r.status,403);
});

test("social API publishing is disabled outside isolated staging",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"production"});
 h.values.set("communications:publishing:paused","false");
 h.values.set("communications:editorial:items",JSON.stringify([{id:"prod-item",status:"Approved",approvedBy:"reviewer",approvedAt:"now",approvedRevision:1,revision:1,authorUid:"author",content:"Must not publish",platforms:["facebook"]}]));
 let calls=0;h.deps.publishMetaContent=async()=>{calls++;return {postId:"not-allowed"};};
 const r=await h.call("/api/communications/social/publish","POST",{itemId:"prod-item",platform:"facebook",accountId:"page-1"});
 assert.equal(r.status,403);
 assert.equal(calls,0);
});
test("duplicate and unresolved publishing attempts are blocked before another platform call",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 h.values.set("communications:publishing:paused","false");
 h.values.set("communications:editorial:items",JSON.stringify([{id:"published-1",status:"Approved",approvedBy:"reviewer",approvedAt:"now",approvedRevision:1,revision:1,authorUid:"author",content:"Test",platforms:["facebook"]}]));
 h.values.set("communications:publishing:audit",JSON.stringify([{id:"a1",attemptId:"a1",action:"PUBLISHED",itemId:"published-1",platform:"facebook",accountId:"page-1"}]));
 let calls=0;h.deps.publishMetaContent=async()=>{calls++;return {postId:"another-post"};};
 let r=await h.call("/api/communications/social/publish","POST",{itemId:"published-1",platform:"facebook",accountId:"page-1"});
 assert.equal(r.status,409);
 h.values.set("communications:publishing:audit",JSON.stringify([{id:"a2",action:"PUBLISH_REQUESTED",itemId:"published-1",platform:"facebook",accountId:"page-1"}]));
 r=await h.call("/api/communications/social/publish","POST",{itemId:"published-1",platform:"facebook",accountId:"page-1"});
 assert.equal(r.status,409);
 assert.equal(calls,0);
});

test("administrator self-approval override also requires the exact staging Firebase project and cutover flag",async()=>{
 const h=harness("Administrator","admin",{admin:true,environment:"staging"});
 h.env.FIREBASE_PROJECT_ID="irpa-digital-board-governance";
 h.env.IRPA_PRODUCTION_CUTOVER="true";
 let r=await h.call("/api/communications/editorial/items","POST",{kind:"post",title:"Misconfigured environment",content:"Must not self approve"});
 const item=(await r.json()).item;
 await h.call("/api/communications/editorial/items/"+item.id+"/submit","POST",{});
 r=await h.call("/api/communications/editorial/items/"+item.id+"/approve","POST",{stagingAdminOverride:true});
 assert.equal(r.status,403);
});

test("designated approver can inspect audit but cannot publish without publishing authority",async()=>{
 const h=harness("Approver","reviewer");
 h.values.set("communications:publishing:paused","false");
 h.values.set("communications:editorial:items",JSON.stringify([{id:"approved-for-reviewer",status:"Approved",approvedBy:"author",approvedAt:"now",approvedRevision:1,revision:1,authorUid:"author",content:"Test",platforms:["facebook"]}]));
 let calls=0;h.deps.publishMetaContent=async()=>{calls++;return {postId:"not-allowed"};};
 const audit=await h.call("/api/communications/social/audit");
 assert.equal(audit.status,200);
 const publish=await h.call("/api/communications/social/publish","POST",{itemId:"approved-for-reviewer",platform:"facebook",accountId:"page-1"});
 assert.equal(publish.status,403);
 assert.equal(calls,0);
});
