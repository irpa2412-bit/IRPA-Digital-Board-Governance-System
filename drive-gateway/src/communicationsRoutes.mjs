import { createSocialPublishingRouter } from "./socialPublishing.mjs";

const AUTHOR_ROLES = new Set(["Administrator","Communications Officer","Communications Manager","Media Officer","Public Relations Officer","Executive Director","Approver"]);
const APPROVER_ROLES = new Set(["Administrator","Executive Director","Approver"]);
const KEY = "communications:editorial:items";
const AUDIT_KEY = "communications:editorial:audit";
const PAUSE_KEY = "communications:publishing:paused";
const asRoles = record => [record?.role,record?.title,record?.position,record?.departmentalRole,...(Array.isArray(record?.roles)?record.roles:[]),...(Array.isArray(record?.assignedRoles)?record.assignedRoles:[]),...(Array.isArray(record?.selectedRoles)?record.selectedRoles:[])].filter(Boolean).flatMap(v=>String(v).split(",").map(x=>x.trim()));
const now = () => new Date().toISOString();
const response = (json,status,cors) => new Response(JSON.stringify(json),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors}});
async function readJson(request){try{return await request.json()}catch{throw Object.assign(new Error("A JSON request body is required."),{status:400})}}
async function roleContext(request,env,deps){
 const claims=await deps.authenticateFirebaseRequest(request,env);
 if(!claims)throw Object.assign(new Error("Authentication required."),{status:401});
 const uid=String(claims.uid||claims.user_id||"");
 if(!uid)throw Object.assign(new Error("Authenticated user ID missing."),{status:401});
 let admin=false,roles=[];
 try{const d=await deps.getFirestoreDocument(env,"adminProfiles/"+uid,claims.token);const p=deps.firestoreDocumentToPlain(d);admin=p?.active===true;}catch{}
 if(admin)roles=["Administrator"];
 else{
  const profile=await deps.getInstitutionalProfileForUser(env,claims);
  const member=deps.firestoreDocumentToPlain(profile?.memberRecord), employee=deps.firestoreDocumentToPlain(profile?.employeeRecord);
  const active=r=>r&&(["Active","Activated"].includes(String(r.status||""))||r.registrationStatus==="Activated"||r.employmentStatus==="Active");
  roles=[...(active(member)?asRoles(member):[]),...(active(employee)?asRoles(employee):[])];
 }
 if(!roles.length)throw Object.assign(new Error("An active IRPA member/employee profile or administrator role is required."),{status:403});
 return {uid,roles,claims};
}
async function readItems(env){try{return JSON.parse(await env.DRIVE_KV.get(KEY)||"[]")}catch{return []}}
async function writeItems(env,items){await env.DRIVE_KV.put(KEY,JSON.stringify(items))}
async function audit(env,event){let rows=[];try{rows=JSON.parse(await env.DRIVE_KV.get(AUDIT_KEY)||"[]")}catch{} rows.push(event);await env.DRIVE_KV.put(AUDIT_KEY,JSON.stringify(rows.slice(-1000)))}
export async function communicationsRoutes(request,env,deps){
 const url=new URL(request.url), path=url.pathname, cors=deps.corsHeaders(request);
 if(!path.startsWith("/api/communications/editorial/")&&!path.startsWith("/api/communications/publishing/pause")&&!path.startsWith("/api/communications/social/"))return null;
 const social=createSocialPublishingRouter({authenticateFirebaseRequest:deps.authenticateFirebaseRequest,json:(body,status=200,headers={})=>response(body,status,headers),corsHeaders:deps.corsHeaders});
 if(path.startsWith("/api/communications/social/"))return social(request,env,path);
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 try{
  const actor=await roleContext(request,env,deps), admin=actor.roles.includes("Administrator"), canAuthor=actor.roles.some(r=>AUTHOR_ROLES.has(r)), canApprove=actor.roles.some(r=>APPROVER_ROLES.has(r));
  if(path==="/api/communications/publishing/pause"&&request.method==="GET")return response({ok:true,paused:String(await env.DRIVE_KV.get(PAUSE_KEY)||"true")!=="false"},200,cors);
  if(path==="/api/communications/publishing/pause"&&request.method==="POST"){
   if(!admin)throw Object.assign(new Error("Administrator role required to change the global pause switch."),{status:403});
   const body=await readJson(request),paused=body.paused!==false;
   await env.DRIVE_KV.put(PAUSE_KEY,paused?"true":"false");
   await audit(env,{id:crypto.randomUUID(),action:"PUBLISHING_PAUSE_CHANGED",actorUid:actor.uid,roles:actor.roles,at:now(),paused});
   return response({ok:true,paused},200,cors);
  }
  if(path==="/api/communications/editorial/audit"&&request.method==="GET"){
   if(!canApprove&&!admin)throw Object.assign(new Error("Approver role required to read the audit log."),{status:403});
   let events=[];try{events=JSON.parse(await env.DRIVE_KV.get(AUDIT_KEY)||"[]")}catch{}
   return response({ok:true,events:events.slice(-200).reverse()},200,cors);
  }
  if(!path.startsWith("/api/communications/editorial/"))return null;
  const action=path.slice("/api/communications/editorial/".length),items=await readItems(env);
  if(action==="items"&&request.method==="GET")return response({ok:true,items:items.filter(i=>admin||i.authorUid===actor.uid||canApprove)},200,cors);
  if(action==="items"&&request.method==="POST"){
   if(!canAuthor&&!admin)throw Object.assign(new Error("Communications Officer role required to create content."),{status:403});
   const body=await readJson(request),kind=["post","website-page"].includes(body.kind)?body.kind:"";
   const title=String(body.title||"").trim(),content=String(body.content||"").trim();
   if(!kind||!title||!content)throw Object.assign(new Error("kind (post or website-page), title and content are required."),{status:400});
   const item={id:crypto.randomUUID(),kind,title,content,language:body.language==="sw"?"sw":"en",platforms:Array.isArray(body.platforms)?body.platforms.filter(p=>["facebook","instagram","linkedin","x","youtube","whatsapp"].includes(p)):[],imageUrl:String(body.imageUrl||""),link:String(body.link||""),scheduledAt:String(body.scheduledAt||""),status:"Draft",authorUid:actor.uid,authorRoles:actor.roles,createdAt:now(),updatedAt:now(),revision:1};
   items.push(item);await writeItems(env,items);await audit(env,{id:crypto.randomUUID(),action:"CREATED",itemId:item.id,actorUid:actor.uid,roles:actor.roles,at:now(),revision:1});
   return response({ok:true,item},201,cors);
  }
  const match=action.match(/^items\/([^/]+)(?:\/(submit|approve|reject))?$/);
  if(match){
   const [,id,decision]=match,index=items.findIndex(i=>i.id===id);if(index<0)throw Object.assign(new Error("Content item not found."),{status:404});
   const item=items[index];if(!admin&&item.authorUid!==actor.uid&&!canApprove)throw Object.assign(new Error("You cannot access this content item."),{status:403});
   if(request.method==="PATCH"&&!decision){
    if(!admin&&!canAuthor)throw Object.assign(new Error("Communications Officer role required to edit content."),{status:403});
    if(item.status!=="Draft"&&item.status!=="Returned")throw Object.assign(new Error("Only drafts or returned items can be edited."),{status:409});
    const body=await readJson(request);for(const k of ["title","content","imageUrl","link","scheduledAt"])if(body[k]!==undefined)item[k]=String(body[k]);
    if(body.language!==undefined)item.language=body.language==="sw"?"sw":"en";
    if(body.platforms!==undefined)item.platforms=Array.isArray(body.platforms)?body.platforms.filter(p=>["facebook","instagram","linkedin","x","youtube","whatsapp"].includes(p)):[];
    item.revision++;item.updatedAt=now();item.status="Draft";item.approvedBy=null;item.approvedAt=null;
   }else if(request.method==="POST"&&decision==="submit"){
    if(item.authorUid!==actor.uid&&!admin)throw Object.assign(new Error("Only the author or an administrator may submit this item."),{status:403});
    if(!["Draft","Returned"].includes(item.status))throw Object.assign(new Error("Only a draft or returned item can be submitted."),{status:409});
    item.status="Pending Approval";item.submittedAt=now();item.submittedBy=actor.uid;
   }else if(request.method==="POST"&&(decision==="approve"||decision==="reject")){
    if(!canApprove&&!admin)throw Object.assign(new Error("Approver role required."),{status:403});
    if(item.authorUid===actor.uid)throw Object.assign(new Error("The author cannot approve or reject their own item."),{status:403});
    if(item.status!=="Pending Approval")throw Object.assign(new Error("Only items pending approval can be decided."),{status:409});
    const body=await readJson(request);
    if(decision==="approve"){item.status="Approved";item.approvedBy=actor.uid;item.approvedAt=now();item.approvedRevision=item.revision;}
    else{item.status="Returned";item.rejectionReason=String(body.reason||"Changes requested").slice(0,500);item.rejectedBy=actor.uid;item.rejectedAt=now();}
   }else throw Object.assign(new Error("Unsupported editorial action."),{status:405});
   items[index]=item;await writeItems(env,items);await audit(env,{id:crypto.randomUUID(),action:decision?decision.toUpperCase():"UPDATED",itemId:id,actorUid:actor.uid,roles:actor.roles,at:now(),status:item.status,revision:item.revision});
   return response({ok:true,item},200,cors);
  }
  return response({ok:false,error:"Editorial route not found."},404,cors);
 }catch(error){return response({ok:false,error:String(error?.message||"Request failed.")},error.status||403,cors)}
}
