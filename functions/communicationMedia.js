const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {defineSecret}=require("firebase-functions/params");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");

const WORDPRESS_BASE_URL=defineSecret("WORDPRESS_BASE_URL");
const WORDPRESS_USERNAME=defineSecret("WORDPRESS_USERNAME");
const WORDPRESS_APPLICATION_PASSWORD=defineSecret("WORDPRESS_APPLICATION_PASSWORD");
const db=getFirestore();

const AUTHOR_ROLES=["Communications Officer","Communications Manager","Media Officer","Public Relations Officer","Director Outreach","Outreach Director","Director Community Development","Community Development Director","Executive Director","Administrator"];
const REVIEW_ROLES=["Executive Director","Director Outreach","Outreach Director","Director Community Development","Community Development Director","Administrator"];

function roleValues(record){
  if(!record)return [];
  return [record.role,record.title,record.position,record.departmentalRole,...(Array.isArray(record.roles)?record.roles:[]),...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),...(Array.isArray(record.selectedRoles)?record.selectedRoles:[])]
    .filter(Boolean).flatMap(v=>String(v).split(",").map(s=>s.trim()).filter(Boolean));
}
function isActive(record){
  return !!record && (["Active","Activated"].includes(String(record.status||""))||record.registrationStatus==="Activated"||record.employmentStatus==="Active");
}
async function accessFor(uid,email,tokenRoles=[]){
  if(email==="irpa2412@gmail.com"||tokenRoles.includes("Administrator"))return {admin:true,author:true,reviewer:true,roles:["Administrator"]};
  const [adminSnap,memberSnap,employeeSnap]=await Promise.all([
    db.collection("adminProfiles").doc(uid).get(),
    db.collection("members").doc(uid).get(),
    db.collection("employees").doc(uid).get()
  ]);
  const admin=adminSnap.exists&&adminSnap.data()?.active===true;
  const member=memberSnap.exists?memberSnap.data():null;
  const employee=employeeSnap.exists?employeeSnap.data():null;
  const roles=[...new Set([...tokenRoles,...roleValues(member),...roleValues(employee)])];
  const active=admin||isActive(member)||isActive(employee);
  return {admin,author:admin||(active&&roles.some(r=>AUTHOR_ROLES.includes(r))),reviewer:admin||(active&&roles.some(r=>REVIEW_ROLES.includes(r))),roles};
}

exports.publishCommunicationMediaItem=onCall({
  region:"us-central1",
  secrets:[WORDPRESS_BASE_URL,WORDPRESS_USERNAME,WORDPRESS_APPLICATION_PASSWORD],
  timeoutSeconds:60,
  memory:"256MiB"
},async request=>{
  if(!request.auth?.uid)throw new HttpsError("unauthenticated","Sign in to publish IRPA content.");
  const uid=request.auth.uid;
  const email=String(request.auth.token?.email||"");
  const tokenRoles=Array.isArray(request.auth.token?.irpaRoles)?request.auth.token.irpaRoles:[];
  const access=await accessFor(uid,email,tokenRoles);
  if(!access.reviewer)throw new HttpsError("permission-denied","Your registered IRPA role does not permit website publishing.");
  const itemId=String(request.data?.itemId||"").trim();
  if(!/^[A-Za-z0-9_-]{1,150}$/.test(itemId))throw new HttpsError("invalid-argument","A valid communications item ID is required.");
  const ref=db.collection("communicationMediaItems").doc(itemId);
  const snap=await ref.get();
  if(!snap.exists)throw new HttpsError("not-found","The communications item was not found.");
  const item=snap.data()||{};
  if(item.status==="Published"&&item.wpPostId&&item.publicUrl)return {success:true,alreadyPublished:true,publicUrl:item.publicUrl,message:"This item is already published; no duplicate post was created."};
  if(item.status!=="Approved")throw new HttpsError("failed-precondition","Only content with recorded Approved status can be published.");
  if(!["Website Article","Press Release","Social Media"].includes(item.type))throw new HttpsError("failed-precondition","Only website articles and press releases can be published through WordPress.");
  const title=String(item.title||"").trim();
  const body=String(item.body||"").trim();
  if(!title||!body||title.length>180||body.length>30000)throw new HttpsError("failed-precondition","The approved item is missing required content or exceeds the permitted length.");
  let base;
  try{base=new URL(WORDPRESS_BASE_URL.value())}catch{throw new HttpsError("failed-precondition","WORDPRESS_BASE_URL is not a valid URL.");}
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash)throw new HttpsError("failed-precondition","The WordPress base URL must be a clean HTTPS URL without embedded credentials, query strings or fragments.");
  const root=base.toString().replace(/\/$/,"");
  const endpoint=root+"/wp-json/wp/v2/posts";
  const username=WORDPRESS_USERNAME.value().trim();
  const password=WORDPRESS_APPLICATION_PASSWORD.value().replace(/\s/g,"");
  if(!username||!password)throw new HttpsError("failed-precondition","WordPress publishing secrets are incomplete.");
  const auth="Basic "+Buffer.from(username+":"+password,"utf8").toString("base64");
  const escapeHtml=value=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/\'/g,"&#39;");
  const safeContent=body.split(/\\n{2,}/).map(paragraph=>"<p>"+escapeHtml(paragraph).replace(/\\n/g,"<br>")+"</p>").join("\\n");
  let response;
  try{
    response=await fetch(endpoint,{method:"POST",headers:{"Authorization":auth,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({title,content:safeContent,excerpt:escapeHtml(String(item.summary||"").slice(0,600)),slug:"irpa-"+itemId,status:"publish",comment_status:"closed",ping_status:"closed"}),signal:AbortSignal.timeout(45000)});
  }catch(error){
    console.error("IRPA WordPress publishing network failure",error?.name||"Error");
    throw new HttpsError("unavailable","The IRPA website could not be reached. The approved item remains approved and can be retried.");
  }
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!Number.isInteger(payload.id)||!payload.link){
    console.error("IRPA WordPress publishing rejected",JSON.stringify({status:response.status,code:payload.code||null}));
    throw new HttpsError("failed-precondition","WordPress rejected the publishing request. The item remains approved; verify the dedicated account's post-publishing permissions.");
  }
  const publishedAt=FieldValue.serverTimestamp();
  await ref.update({status:"Published",wpPostId:payload.id,publicUrl:String(payload.link),publishedAt,publishedByUid:uid,publishedByEmail:email,updatedAt:publishedAt,updatedByUid:uid,updatedByEmail:email});
  await db.collection("audit").add({action:"COMMUNICATION_MEDIA_PUBLISHED",category:"COMMUNICATIONS",collection:"communicationMediaItems",recordId:itemId,actorUid:uid,actorEmail:email,details:{type:item.type,channel:item.channel,wpPostId:payload.id,publicUrl:String(payload.link),approvedBeforePublishing:true},createdAt:FieldValue.serverTimestamp()});
  return {success:true,publicUrl:String(payload.link),wpPostId:payload.id,message:"Approved content was published to the IRPA website."};
});
