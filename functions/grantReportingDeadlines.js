const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const db = getFirestore();
const MILESTONES = new Set([30, 14, 7, 3, 1, 0]);
function cleanEmail(v){return String(v||"").trim().toLowerCase();}
function activeStatus(d){const s=String(d?.status||d?.employmentStatus||d?.registrationStatus||"Active").trim().toLowerCase();return !["inactive","disabled","suspended","expired","revoked"].includes(s);}
function parseDateOnly(v){const raw=String(v||"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const d=new Date(raw+"T00:00:00+03:00");return Number.isNaN(d.getTime())?null:d;}
function unique(list){return [...new Map(list.filter(x=>x?.uid&&x?.email).map(x=>[x.uid,x])).values()];}
async function ownerRecipients(ownerValue){
  const raw=String(ownerValue||"").trim();if(!raw)return[];
  const email=cleanEmail(raw),found=[];
  const add=snap=>snap?.forEach(d=>{const x=d.data()||{};if(x.uid&&activeStatus(x)&&cleanEmail(x.email))found.push({uid:String(x.uid),email:cleanEmail(x.email),name:String(x.name||x.fullName||x.email).trim()});});
  if(email.includes("@")){
    const [m,e]=await Promise.all([db.collection("members").where("email","==",email).limit(5).get(),db.collection("employees").where("email","==",email).limit(5).get()]);add(m);add(e);
  }
  if(!found.length){
    const [m,e]=await Promise.all([db.collection("members").where("name","==",raw).limit(5).get(),db.collection("employees").where("name","==",raw).limit(5).get()]);add(m);add(e);
  }
  return unique(found);
}
async function escalationRecipients(){
  const roles=new Set(["Executive Director","Director Finance & Administration","Finance Manager","Accountant","Finance Officer"]),found=[];
  const [m,e]=await Promise.all([db.collection("members").get(),db.collection("employees").get()]);
  for(const snap of [m,e])for(const doc of snap.docs){const x=doc.data()||{};if(!x.uid||!activeStatus(x)||!cleanEmail(x.email))continue;const rs=[x.role,x.boardPosition,...(Array.isArray(x.roles)?x.roles:[]),...(Array.isArray(x.assignedRoles)?x.assignedRoles:[])].map(v=>String(v||"").trim());if(rs.some(r=>roles.has(r)))found.push({uid:String(x.uid),email:cleanEmail(x.email),name:String(x.name||x.fullName||x.email).trim()});}
  return unique(found);
}
async function queueMail(recipient,o,donor,grant,days){
  const state=days<0?"OVERDUE":days===0?"DUE TODAY":"DUE IN "+days+" DAYS";
  const subject="IRPA-DBGS Grant Reporting Deadline — "+state;
  const text="Dear "+(recipient.name||recipient.email)+",\n\nIRPA-DBGS deadline control has identified a grant reporting obligation requiring attention.\n\nFunder: "+String(donor?.name||"Unidentified funder")+"\nReport: "+String(o.reportType||"Grant report")+"\nReporting period: "+String(o.reportingPeriod||"Not specified")+"\nDue date: "+String(o.dueDate||"Not specified")+"\nCurrent state: "+state+"\nResponsible owner: "+String(o.responsibleOwner||"Not specified")+"\nGrant: "+String(grant?.title||grant?.reference||o.grantId||"Linked grant")+"\n\nPlease update the reporting obligation in IRPA-DBGS when action is completed.\n\nImprovement of Rangeland in Pastoral Areas (IRPA)\nIRPA Digital Board Governance System";
  const ref=await db.collection("mail").add({to:recipient.email,message:{subject,text},systemGenerated:true,notificationType:"GRANT_REPORTING_DEADLINE",registeredRecipientUid:recipient.uid,registeredRecipientEmail:recipient.email,obligationId:o.id,donorId:o.donorId||null,grantId:o.grantId||null,dueDate:o.dueDate||null,deadlineState:state,daysUntilDue:days,createdAt:FieldValue.serverTimestamp()});return ref.id;
}
async function notify(recipient,o,donor,days){
  const id=crypto.createHash("sha256").update("grant-deadline|"+o.id+"|"+recipient.uid+"|"+new Date().toISOString().slice(0,10)).digest("hex");
  await db.collection("notifications").doc(id).set({recipientUid:recipient.uid,type:"GRANT_REPORTING_DEADLINE",title:"Grant reporting deadline: "+(days<0?"Overdue":days===0?"Due today":"Due in "+days+" days"),body:String(o.reportType||"Grant report")+" for "+String(donor?.name||"the registered funder")+" is "+(days<0?"overdue.":"due "+o.dueDate+"."),module:"Donor & Funder Relations",recordId:o.id,route:"/donor-funder-relations",priority:days<0?"high":"normal",read:false,createdByUid:"system",createdAt:FieldValue.serverTimestamp()},{merge:true});
}
async function processGrantReportingDeadlines(){
  const snapshot=await db.collection("grantReportingObligations").get(),donorCache=new Map(),grantCache=new Map();
  const summary={scanned:snapshot.size,remindersQueued:0,overdue:0,dueSoon:0,unresolvedOwners:0,errors:0};
  for(const doc of snapshot.docs){
    const o={id:doc.id,...doc.data()},status=String(o.status||"Open").toLowerCase();if(["submitted","closed","completed"].includes(status))continue;
    const due=parseDateOnly(o.dueDate);if(!due)continue;
    const days=Math.ceil((due.getTime()-Date.now())/86400000);if(days<0)summary.overdue++;else if(days<=30)summary.dueSoon++;
    if(!(days<0||MILESTONES.has(days)))continue;
    const today=new Date().toISOString().slice(0,10),key=days<0?"OVERDUE":String(days);if(o.lastReminderDate===today&&o.lastReminderKey===key)continue;
    let donor=null,grant=null;
    if(o.donorId){if(!donorCache.has(o.donorId))donorCache.set(o.donorId,await db.collection("donorFunders").doc(o.donorId).get());const s=donorCache.get(o.donorId);donor=s.exists?s.data():null;}
    if(o.grantId){if(!grantCache.has(o.grantId))grantCache.set(o.grantId,await db.collection("financeGrants").doc(o.grantId).get());const s=grantCache.get(o.grantId);grant=s.exists?s.data():null;}
    let recipients=await ownerRecipients(o.responsibleOwner);if(days<0)recipients=unique(recipients.concat(await escalationRecipients()));if(!recipients.length){summary.unresolvedOwners++;continue;}
    for(const recipient of recipients)try{const mailId=await queueMail(recipient,o,donor,grant,days);await notify(recipient,o,donor,days);summary.remindersQueued++;await doc.ref.set({lastReminderDate:today,lastReminderKey:key,lastReminderAt:FieldValue.serverTimestamp(),lastReminderMailId:mailId,updatedAt:FieldValue.serverTimestamp()},{merge:true});}catch(error){summary.errors++;console.error("Grant deadline reminder failed",o.id,recipient.email,error);}
  }
  await db.collection("audit").add({action:"GRANT_REPORTING_DEADLINE_AUDIT_COMPLETED",collection:"grantReportingObligations",recordId:"GRANT_DEADLINE_AUDIT",details:summary,actorUid:"SYSTEM",actorEmail:"system",createdAt:FieldValue.serverTimestamp()});
  return summary;
}
exports.grantReportingDeadlineAuditScheduled=onSchedule({schedule:"15 8 * * *",timeZone:"Africa/Dar_es_Salaam",region:"us-central1"},async()=>processGrantReportingDeadlines());
exports.grantReportingDeadlineAuditNow=onCall({region:"us-central1",timeoutSeconds:540},async request=>{
  const uid=request.auth?.uid;if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
  if(request.auth?.token?.mfaEnrolled!==true)throw new HttpsError("failed-precondition","Multi-factor authentication is required to run the grant deadline audit manually.");
  const snap=await db.collection("adminProfiles").doc(uid).get();if(snap.data()?.active!==true&&request.auth?.token?.admin!==true&&cleanEmail(request.auth?.token?.email)!=="irpa2412@gmail.com")throw new HttpsError("permission-denied","Administrator authorization is required.");
  const summary=await processGrantReportingDeadlines();await db.collection("audit").add({action:"GRANT_REPORTING_DEADLINE_AUDIT_MANUAL",collection:"grantReportingObligations",recordId:"GRANT_DEADLINE_AUDIT_MANUAL",details:summary,actorUid:uid,actorEmail:cleanEmail(request.auth?.token?.email),createdAt:FieldValue.serverTimestamp()});return{ok:true,summary};
});
