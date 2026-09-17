const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");
initializeApp(); const db = getFirestore();
async function stableId(v){return crypto.createHash("sha256").update(String(v)).digest("hex");}
async function notify({recipientUids,type,title,body,module,recordId,route="/",priority="normal",eventKey}){for(const recipientUid of [...new Set((recipientUids||[]).filter(Boolean).map(String))]){const id=await stableId(`${eventKey}|${recipientUid}`);await db.collection("notifications").doc(id).set({recipientUid,type,title,body,module,recordId:recordId||null,route,priority,read:false,createdByUid:"system",createdAt:FieldValue.serverTimestamp()},{merge:true});}}
async function meetingRecipients(meetingId,meeting={}){if(!meetingId)return[];const ids=new Set([...(meeting.participantUids||[]),...(meeting.attendeeUids||[]),...(meeting.memberUids||[])].filter(Boolean));const snap=await db.collection("meetingSubscriptions").where("meetingId","==",meetingId).get();snap.forEach(d=>{const x=d.data();[x.uid,x.userId,x.memberUid].filter(Boolean).forEach(v=>ids.add(v));});return[...ids];}

async function deleteCollectionDocs(collectionName){
  const ref=db.collection(collectionName);
  let deleted=0;
  while(true){
    const snap=await ref.limit(400).get();
    if(snap.empty)break;
    const batch=db.batch();
    snap.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
    deleted+=snap.size;
    if(snap.size<400)break;
  }
  return deleted;
}

exports.resetTrialData = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  const admin=adminSnap.exists ? adminSnap.data() : null;
  if(!admin || admin.active!==true) throw new HttpsError("permission-denied","Administrator authorization is required.");
  if(request.data?.confirmation!=="RESET IRPA TRIAL DATA") throw new HttpsError("failed-precondition","The exact confirmation phrase is required.");

  const [memberSnap,employeeSnap]=await Promise.all([
    db.collection("members").get(),
    db.collection("employees").get()
  ]);
  const memberCount=memberSnap.size;
  const employeeCount=employeeSnap.size;
  const auditRef=db.collection("audit").doc();
  await auditRef.set({
    action:"RESET_TRIAL_DATA",
    category:"SYSTEM_ADMINISTRATION",
    description:"Controlled administrator-only reset of trial member and employee data.",
    performedByUid:uid,
    performedByEmail:request.auth.token?.email||admin.email||null,
    memberRecordsTargeted:memberCount,
    employeeRecordsTargeted:employeeCount,
    status:"Started",
    createdAt:FieldValue.serverTimestamp()
  });

  try{
    const [membersDeleted,employeesDeleted]=await Promise.all([
      deleteCollectionDocs("members"),
      deleteCollectionDocs("employees")
    ]);
    await db.collection("employeeCounters").doc("employees").set({currentNumber:0,nextNumber:1,updatedAt:FieldValue.serverTimestamp(),resetByUid:uid},{merge:true});
    await db.collection("memberCounters").doc("members").set({currentNumber:0,nextNumber:1,updatedAt:FieldValue.serverTimestamp(),resetByUid:uid},{merge:true});
    await auditRef.update({status:"Completed",membersDeleted,employeesDeleted,completedAt:FieldValue.serverTimestamp()});
    return {success:true,membersDeleted,employeesDeleted};
  }catch(error){
    await auditRef.update({status:"Failed",error:String(error?.message||error),failedAt:FieldValue.serverTimestamp()});
    throw new HttpsError("internal","The trial-data reset failed. The audit record has been retained.");
  }
});

exports.dispatchGovernanceNotification=onDocumentCreated("notifications/{notificationId}",async event=>{const s=event.data;if(!s)return;const n=s.data();if(!n.recipientUid)return;const ts=await db.collection("notificationTokens").doc(n.recipientUid).collection("tokens").get();const tokens=ts.docs.map(d=>d.get("token")).filter(Boolean);if(!tokens.length){await s.ref.update({deliveryStatus:"no_tokens",deliveryUpdatedAt:FieldValue.serverTimestamp()});return;}try{const r=await getMessaging().sendEachForMulticast({tokens,notification:{title:String(n.title||"IRPA Governance"),body:String(n.body||"")},data:{notificationId:event.params.notificationId,type:String(n.type||"GOVERNANCE_EVENT"),module:String(n.module||""),recordId:String(n.recordId||""),route:String(n.route||"/"),priority:String(n.priority||"normal")},webpush:{fcmOptions:{link:n.route||"/"}}});const invalid=new Set(["messaging/registration-token-not-registered","messaging/invalid-registration-token"]);await Promise.all(r.responses.map((x,i)=>!x.success&&x.error&&invalid.has(x.error.code)?ts.docs[i].ref.delete():null));await s.ref.update({deliveryStatus:r.successCount?"sent":"failed",sentCount:r.successCount,failureCount:r.failureCount,deliveryUpdatedAt:FieldValue.serverTimestamp()});}catch(e){await s.ref.update({deliveryStatus:"failed",deliveryError:e.message||String(e),deliveryUpdatedAt:FieldValue.serverTimestamp()});}});
exports.authorizationWorkflowNotifications=onDocumentUpdated("workflowActions/{workflowId}",async event=>{const b=event.data.before.data(),a=event.data.after.data();if(a.workflowType!=="Authorization"||a.module!=="Authorization & Approvals"||b.status===a.status)return;const recipients={Submitted:[a.reviewerUid,a.approverUid],"Under Review":[a.approverUid],Returned:[a.requestedByUid],Approved:[a.implementerUid,a.requestedByUid],Rejected:[a.requestedByUid],Completed:[a.requestedByUid,a.approverUid]}[a.status]||[];await notify({recipientUids:recipients,type:`AUTHORIZATION_${a.status.replace(/\s+/g,"_").toUpperCase()}`,title:`Authorization ${a.status}`,body:`${a.reference||a.title||"Authorization request"} moved from ${b.status} to ${a.status}.`,module:"Authorization & Approvals",recordId:event.params.workflowId,route:"/authorization-approvals",priority:["Rejected","Returned"].includes(a.status)?"high":"normal",eventKey:`${event.params.workflowId}|${a.status}|${a.workflowVersion||1}`});});
exports.meetingCreatedNotifications=onDocumentCreated("meetings/{meetingId}",async event=>{const a=event.data?.data();if(!a)return;const r=await meetingRecipients(event.params.meetingId,a);await notify({recipientUids:r,type:"MEETING_SCHEDULED",title:"Meeting scheduled",body:`${a.title||"IRPA meeting"} has been scheduled for ${a.date||"the scheduled date"} at ${a.startTime||"the scheduled time"}.`,module:"Meetings",recordId:event.params.meetingId,route:"/meetings",eventKey:`${event.params.meetingId}|SCHEDULED`});});
exports.meetingWorkflowNotifications=onDocumentUpdated("meetings/{meetingId}",async event=>{const b=event.data.before.data(),a=event.data.after.data();const changed=["status","date","startTime","endTime","venue","proceedingsStatus","votingStatus"].some(k=>String(b[k]||"")!==String(a[k]||""));if(!changed)return;const r=await meetingRecipients(event.params.meetingId,a);if(!r.length)return;const status=a.status||"Updated";await notify({recipientUids:r,type:`MEETING_${String(status).replace(/\s+/g,"_").toUpperCase()}`,title:`Meeting ${status}`,body:`${a.title||"IRPA meeting"} has been updated.`,module:"Meetings",recordId:event.params.meetingId,route:"/meetings",eventKey:`${event.params.meetingId}|UPDATE|${a.updatedAt?.seconds||Date.now()}|${status}`});});
exports.signatureCreatedNotifications=onDocumentCreated("signatureEnvelopes/{envelopeId}",async event=>{const a=event.data?.data();if(!a)return;const next=a.currentSignerUid?[a.currentSignerUid]:(a.recipients||[]).map(r=>r.uid).filter(Boolean);await notify({recipientUids:next,type:"SIGNATURE_REQUESTED",title:"Signature action required",body:`${a.title||"A controlled document"} is ready for your signature.`,module:"Signature Platform",recordId:event.params.envelopeId,route:"/signature-platform",priority:"high",eventKey:`${event.params.envelopeId}|SIGNATURE_REQUESTED`});});
exports.signatureWorkflowNotifications=onDocumentUpdated("signatureEnvelopes/{envelopeId}",async event=>{const b=event.data.before.data(),a=event.data.after.data();if(b.status===a.status&&b.currentSignerUid===a.currentSignerUid&&b.lastSignedByUid===a.lastSignedByUid)return;const all=a.participantUids||(a.recipients||[]).map(r=>r.uid).filter(Boolean);const r=a.status==="Completed"?all.filter(x=>x!==a.lastSignedByUid):a.currentSignerUid?[a.currentSignerUid]:all.filter(x=>x!==a.lastSignedByUid);const type=a.status==="Completed"?"SIGNATURE_COMPLETED":a.lastSignedByUid?"SIGNATURE_COMPLETED_BY_SIGNER":"SIGNATURE_REQUESTED";await notify({recipientUids:r,type,title:a.status==="Completed"?"Signature process completed":"Signature action required",body:`${a.title||"Controlled document"} is ${a.status||"in progress"}.`,module:"Signature Platform",recordId:event.params.envelopeId,route:"/signature-platform",priority:type==="SIGNATURE_REQUESTED"?"high":"normal",eventKey:`${event.params.envelopeId}|${type}|${a.lastSignedAt?.seconds||a.updatedAt?.seconds||Date.now()}`});});
exports.votingCreatedNotifications=onDocumentCreated("votingIssues/{issueId}",async event=>{const a=event.data?.data();if(!a)return;const meeting=a.meetingId?((await db.collection("meetings").doc(a.meetingId).get()).data()||{}):{};const r=await meetingRecipients(a.meetingId,meeting);await notify({recipientUids:r,type:"VOTING_OPENED",title:"Anonymous voting opened",body:`Anonymous voting is open for ${a.votingReference||a.meetingReference||"the meeting matter"}.`,module:"Voting",recordId:event.params.issueId,route:"/voting",priority:"high",eventKey:`${event.params.issueId}|OPENED`});});
exports.votingWorkflowNotifications=onDocumentUpdated("votingIssues/{issueId}",async event=>{const b=event.data.before.data(),a=event.data.after.data();if(b.status===a.status&&b.result===a.result)return;const meeting=a.meetingId?((await db.collection("meetings").doc(a.meetingId).get()).data()||{}):{};const r=await meetingRecipients(a.meetingId,meeting);if(!r.length)return;const closed=a.status==="Closed";await notify({recipientUids:r,type:closed?"VOTING_CLOSED":"VOTING_UPDATED",title:closed?"Voting closed":"Voting updated",body:closed?`The voting process for ${a.votingReference||a.meetingReference||"the meeting matter"} has closed. Result: ${a.result||"Pending"}.`:`The voting process for ${a.votingReference||a.meetingReference||"the meeting matter"} has been updated.`,module:"Voting",recordId:event.params.issueId,route:"/voting",priority:"high",eventKey:`${event.params.issueId}|${closed?"CLOSED":"UPDATED"}|${a.result||a.status}`});});