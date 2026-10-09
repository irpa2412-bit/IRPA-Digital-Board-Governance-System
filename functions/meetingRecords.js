const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("crypto");
const db=getFirestore();
const text=v=>String(v??"").trim();
const hash=v=>crypto.createHash("sha256").update(String(v),"utf8").digest("hex");
const TERMINAL=new Set(["completed","closed","cancelled","canceled","archived"]);
const RETENTION_YEARS={GOVERNANCE:7,ADMINISTRATIVE:5,STAFF:3,GENERAL:3,OTHER:3};
function categoryOf(m){const raw=text(m.meetingCategory||m.meetingPolicyId||m.category||m.meetingType).toUpperCase();if(["GOVERNANCE","BOARD","BOARD MEETING","BOARD COMMITTEE MEETING","ANNUAL GENERAL MEETING","SPECIAL MEETING"].includes(raw))return"GOVERNANCE";if(["ADMINISTRATIVE","MANAGEMENT","MANAGEMENT MEETING","ADMINISTRATION MEETING","OPERATIONS MEETING"].includes(raw))return"ADMINISTRATIVE";if(raw==="STAFF"||raw==="STAFF MEETING")return"STAFF";if(raw==="GENERAL"||raw==="GENERAL MEETING")return"GENERAL";return"OTHER";}
function addYears(date,years){const d=new Date(date);d.setUTCFullYear(d.getUTCFullYear()+years);return d;}
function admin(req){return req.auth?.token?.admin===true||text(req.auth?.token?.email).toLowerCase()==="irpa2412@gmail.com";}
async function context(req,meetingId){
 const uid=req.auth?.uid,email=text(req.auth?.token?.email).toLowerCase();
 if(!uid)throw new HttpsError("unauthenticated","Sign in to access meeting records.");
 if(!meetingId)throw new HttpsError("invalid-argument","Meeting ID is required.");
 const snap=await db.collection("meetings").doc(meetingId).get();
 if(!snap.exists)throw new HttpsError("not-found","Meeting record not found.");
 const meeting={id:snap.id,...snap.data()},cat=categoryOf(meeting);
 const chair=text(meeting.chairpersonEmail).toLowerCase()===email;
 const secretary=text(meeting.secretaryEmail).toLowerCase()===email;
 const memberSnap=await db.collection("members").doc(uid).get();
 const employeeSnap=await db.collection("employees").doc(uid).get();
 const identityActive=admin(req)||(memberSnap.exists&&["Active","Activated"].includes(text(memberSnap.data()?.status||memberSnap.data()?.registrationStatus)))||(employeeSnap.exists&&["Active","Activated"].includes(text(employeeSnap.data()?.status||employeeSnap.data()?.employmentStatus||employeeSnap.data()?.registrationStatus)));
 const listed=[...(meeting.participantUids||[]),...(meeting.attendeeUids||[]),...(meeting.memberUids||[]),...(meeting.invitedUids||[])].includes(uid);
 const sub=await db.collection("meetingSubscriptions").where("meetingId","==",meetingId).where("uid","==",uid).limit(1).get().catch(()=>({empty:true}));
 const subscribed=!sub.empty;
 const participant=listed||subscribed;
 if(!identityActive&&!participant)throw new HttpsError("permission-denied","An active IRPA identity or authorised meeting participant is required.");
 const canManage=admin(req)||chair||secretary||text(meeting.createdByUid)===uid;
 return {uid,email,meeting,category:cat,participant,canManage,canRead:canManage||participant,confidentiality:text(meeting.confidentialityClass)||(cat==="GOVERNANCE"?"BOARD_RESTRICTED":"INTERNAL")};
}
function recordLabel(type){return ({TRANSCRIPT:"Meeting Transcript",MINUTES_DRAFT:"Draft Minutes",MINUTES_FINAL:"Approved / Final Minutes",AI_MINUTES_DRAFT:"AI-Assisted Draft Minutes",AI_SUMMARY_DRAFT:"AI-Assisted Meeting Summary Draft",SUBSCRIBER_TRANSCRIPT_DRAFT:"Subscriber Proceedings Draft",DECISION_REGISTER:"Decision Register",ATTENDANCE_REGISTER:"Attendance Register",OTHER:"Other Meeting Record"})[type]||"Meeting Record";}
async function audit(action,ctx,recordId,details={}){await db.collection("audit").add({action,collection:"meetingRecords",recordId:recordId||null,details:{meetingId:ctx.meeting.id,meetingCategory:ctx.category,confidentialityClass:ctx.confidentiality,...details},actorUid:ctx.uid,actorEmail:ctx.email||null,createdAt:FieldValue.serverTimestamp()});}
exports.captureMeetingRecord=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const meetingId=text(req.data?.meetingId),type=text(req.data?.recordType).toUpperCase(),content=text(req.data?.content),title=text(req.data?.title);
 const ctx=await context(req,meetingId);
 if(!ctx.canManage)throw new HttpsError("permission-denied","Only the meeting administrator, chairperson or secretary may capture an authoritative meeting record.");
 if(!["TRANSCRIPT","MINUTES_DRAFT","MINUTES_FINAL","DECISION_REGISTER","ATTENDANCE_REGISTER","OTHER"].includes(type))throw new HttpsError("invalid-argument","Unsupported meeting record type.");
 if(!content)throw new HttpsError("invalid-argument","Record content is empty.");
 if(content.length>900000)throw new HttpsError("invalid-argument","Text record exceeds the 900,000 character limit. Store large files through the controlled Documents Portal.");
 if(type==="MINUTES_FINAL"){const approvalId=text(req.data?.approvalReference);if(!approvalId)throw new HttpsError("failed-precondition","Final minutes require an approved authorization record ID. Capture them as a draft until approved.");const approvalSnap=await db.collection("authorizationRequests").doc(approvalId).get();if(!approvalSnap.exists)throw new HttpsError("failed-precondition","The referenced authorization record was not found.");const approval=approvalSnap.data()||{};if(!["approved","authorized","completed"].includes(text(approval.status).toLowerCase())||approval.meetingId!==meetingId)throw new HttpsError("failed-precondition","The authorization record must be approved and linked to this meeting before final minutes can be captured.");}
 const now=new Date(),retentionYears=RETENTION_YEARS[ctx.category]||3,retainUntil=addYears(now,retentionYears);
 const ref=db.collection("meetingRecords").doc();
 const digest=hash(content);
 const data={meetingId,meetingReference:text(ctx.meeting.reference||ctx.meeting.title),meetingTitle:text(ctx.meeting.title),meetingCategory:ctx.category,meetingPolicyId:ctx.category,recordType:type,recordLabel:recordLabel(type),title:title||recordLabel(type),content,contentHash:digest,integrityAlgorithm:"SHA-256",integrityStatus:"VERIFIED_AT_CAPTURE",version:1,status:"Active",confidentialityClass:ctx.confidentiality,storageDestination:"FIRESTORE_MEETING_RECORDS",storagePath:null,documentPortalRequiredForBinary:true,approvalReference:text(req.data?.approvalReference)||null,legalHold:false,retentionYears,retainUntil,retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:ctx.uid,capturedByEmail:ctx.email||null,capturedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),deletedAt:null,deletionStatus:"NOT_ELIGIBLE"};
 await ref.set(data);
 await audit("MEETING_RECORD_CAPTURED",ctx,ref.id,{recordType:type,contentHash:digest,retentionYears,retainUntil:retainUntil.toISOString(),storageDestination:data.storageDestination});
 return {ok:true,recordId:ref.id,recordType:type,contentHash:digest,integrityStatus:data.integrityStatus,retentionYears,retainUntil:retainUntil.toISOString(),storageDestination:data.storageDestination};
});
exports.saveMeetingAssistantDraft=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const meetingId=text(req.data?.meetingId),type=text(req.data?.recordType).toUpperCase(),content=text(req.data?.content),title=text(req.data?.title);
 const ctx=await context(req,meetingId);
 if(!ctx.canRead)throw new HttpsError("permission-denied","Only an authorised participant or subscriber may save an AI Meeting Assistant draft.");
 if(!["AI_MINUTES_DRAFT","AI_SUMMARY_DRAFT","SUBSCRIBER_TRANSCRIPT_DRAFT"].includes(type))throw new HttpsError("invalid-argument","Only assistant drafts and subscriber transcript drafts may be saved through this operation.");
 if(!content)throw new HttpsError("invalid-argument","Draft content is empty.");
 if(content.length>900000)throw new HttpsError("invalid-argument","Draft exceeds the 900,000 character limit.");
 const now=new Date(),retentionYears=RETENTION_YEARS[ctx.category]||3,retainUntil=addYears(now,retentionYears);
 const ref=db.collection("meetingRecords").doc(),digest=hash(content);
 const data={
  meetingId,meetingReference:text(ctx.meeting.meetingReference||ctx.meeting.reference||ctx.meeting.title),
  meetingTitle:text(ctx.meeting.title),meetingCategory:ctx.category,meetingPolicyId:ctx.category,
  recordType:type,recordLabel:recordLabel(type),title:title||recordLabel(type),content,contentHash:digest,
  sourceTranscriptHash:text(req.data?.sourceTranscriptHash)||null,
  integrityAlgorithm:"SHA-256",integrityStatus:"VERIFIED_AT_CAPTURE",version:1,status:"Active",
  confidentialityClass:ctx.confidentiality,storageDestination:"FIRESTORE_MEETING_RECORDS",
  storagePath:null,documentPortalRequiredForBinary:true,draftOnly:true,approved:false,
  approvalStatus:"NOT_SUBMITTED",requiresHumanReview:true,
  createdFrom:"IRPA_AI_MEETING_ASSISTANT",legalHold:false,retentionYears,retainUntil,
  retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:ctx.uid,capturedByEmail:ctx.email||null,
  capturedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
  deletedAt:null,deletionStatus:"NOT_ELIGIBLE"
 };
 await ref.set(data);
 await audit("MEETING_ASSISTANT_DRAFT_SAVED",ctx,ref.id,{recordType:type,contentHash:digest,sourceTranscriptHash:data.sourceTranscriptHash,requiresHumanReview:true});
 return {ok:true,recordId:ref.id,recordType:type,contentHash:digest,integrityStatus:data.integrityStatus,draftOnly:true,approvalStatus:data.approvalStatus,requiresHumanReview:true};
});
exports.listMeetingRecords=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const meetingId=text(req.data?.meetingId),ctx=await context(req,meetingId);
 if(!ctx.canRead)throw new HttpsError("permission-denied","You are not authorised to list records for this meeting.");
 const snap=await db.collection("meetingRecords").where("meetingId","==",meetingId).get();
 const records=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.status==="Active").sort((a,b)=>(b.capturedAt?.toMillis?.()||0)-(a.capturedAt?.toMillis?.()||0));
 await audit("MEETING_RECORD_REGISTER_VIEWED",ctx,null,{recordCount:records.length});
 return {ok:true,records:records.map(r=>({id:r.id,title:r.title,recordType:r.recordType,recordLabel:r.recordLabel,contentHash:r.contentHash,integrityStatus:r.integrityStatus,confidentialityClass:r.confidentialityClass,version:r.version,capturedAt:r.capturedAt?.toDate?.().toISOString?.()||null,retainUntil:r.retainUntil?.toDate?.().toISOString?.()||null,retentionYears:r.retentionYears,legalHold:r.legalHold===true,deletionStatus:r.deletionStatus||"NOT_ELIGIBLE",storageDestination:r.storageDestination}))};
});
exports.retrieveMeetingRecord=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const recordId=text(req.data?.recordId);
 if(!recordId)throw new HttpsError("invalid-argument","Meeting record ID is required.");
 const snap=await db.collection("meetingRecords").doc(recordId).get();
 if(!snap.exists)throw new HttpsError("not-found","Meeting record not found.");
 const record={id:snap.id,...snap.data()},ctx=await context(req,record.meetingId);
 if(!ctx.canRead||record.status!=="Active")throw new HttpsError("permission-denied","This record is not available to this identity or is no longer active.");
 const actual=hash(record.content||"");
 if(actual!==record.contentHash) {await audit("MEETING_RECORD_INTEGRITY_FAILURE",ctx,recordId,{expectedHash:record.contentHash||null,actualHash:actual});throw new HttpsError("data-loss","Record integrity verification failed. Access is blocked and an audit event was recorded.");}
 await audit("MEETING_RECORD_RETRIEVED",ctx,recordId,{recordType:record.recordType,contentHash:actual});
 return {ok:true,record:{id:record.id,meetingId:record.meetingId,meetingReference:record.meetingReference,meetingTitle:record.meetingTitle,meetingCategory:record.meetingCategory,recordType:record.recordType,recordLabel:record.recordLabel,title:record.title,content:record.content,contentHash:record.contentHash,integrityAlgorithm:record.integrityAlgorithm,integrityStatus:"VERIFIED",confidentialityClass:record.confidentialityClass,version:record.version,status:record.status,capturedAt:record.capturedAt?.toDate?.().toISOString?.()||null,retainUntil:record.retainUntil?.toDate?.().toISOString?.()||null,retentionYears:record.retentionYears,legalHold:record.legalHold,storageDestination:record.storageDestination,approvalReference:record.approvalReference||null}};
});
exports.updateMeetingRecordProtection=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const recordId=text(req.data?.recordId),operation=text(req.data?.operation).toUpperCase();
 const ref=db.collection("meetingRecords").doc(recordId),snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Meeting record not found.");
 const record=snap.data(),ctx=await context(req,record.meetingId);
 if(!ctx.canManage)throw new HttpsError("permission-denied","Only the meeting administrator, chairperson or secretary may change record protection.");
 if(record.status!=="Active")throw new HttpsError("failed-precondition","Only active records can change protection.");
 if(operation==="LEGAL_HOLD"){
  const held=req.data?.enabled===true;
  await ref.update({legalHold:held,legalHoldReason:held?text(req.data?.reason)||"Legal or governance preservation hold":null,legalHoldByUid:ctx.uid,legalHoldAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  await audit(held?"MEETING_RECORD_LEGAL_HOLD_APPLIED":"MEETING_RECORD_LEGAL_HOLD_RELEASED",ctx,recordId,{reason:text(req.data?.reason)||null});
  return {ok:true,legalHold:held};
 }
 if(operation==="EXTEND_RETENTION"){
  const years=Number(req.data?.retentionYears);
  if(!Number.isInteger(years)||years<1||years>30)throw new HttpsError("invalid-argument","Retention extension must be an integer from 1 to 30 years.");
  const until=addYears(new Date(),years);
  await ref.update({retentionYears:years,retainUntil:until,retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0-EXTENDED",retentionExtendedByUid:ctx.uid,retentionExtendedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  await audit("MEETING_RECORD_RETENTION_EXTENDED",ctx,recordId,{retentionYears:years,retainUntil:until.toISOString()});
  return {ok:true,retentionYears:years,retainUntil:until.toISOString()};
 }
 throw new HttpsError("invalid-argument","Unsupported record protection operation.");
});
exports.disposeMeetingRecord=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const recordId=text(req.data?.recordId),operation=text(req.data?.operation).toUpperCase();
 const ref=db.collection("meetingRecords").doc(recordId),snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Meeting record not found.");
 const record=snap.data(),ctx=await context(req,record.meetingId);
 if(!ctx.canManage)throw new HttpsError("permission-denied","Only the meeting administrator, chairperson or secretary may request record disposition.");
 if(operation==="REQUEST_DELETE"){
  await ref.update({deletionStatus:"PENDING_REVIEW",deletionRequestedByUid:ctx.uid,deletionRequestedAt:FieldValue.serverTimestamp(),deletionReason:text(req.data?.reason)||"Retention/disposition review",updatedAt:FieldValue.serverTimestamp()});
  await audit("MEETING_RECORD_DELETE_REQUESTED",ctx,recordId,{reason:text(req.data?.reason)||null});
  return {ok:true,deletionStatus:"PENDING_REVIEW",message:"Record is preserved. Deletion requires an authorised primary administrator disposition after retention and legal-hold checks."};
 }
 if(operation==="PURGE"){
  if(!admin(req))throw new HttpsError("permission-denied","Only the primary administrator may execute a final purge.");
  if(record.legalHold===true)throw new HttpsError("failed-precondition","A legal hold prevents deletion.");
  const retainUntil=record.retainUntil?.toDate?.()||new Date(8640000000000000);
  if(retainUntil>new Date())throw new HttpsError("failed-precondition","The retention period has not expired.");
  if(record.deletionStatus!=="PENDING_REVIEW")throw new HttpsError("failed-precondition","A deletion request and review are required before purge.");
  const auditRef=db.collection("audit").doc();
  await db.runTransaction(async tx=>{
   const latest=await tx.get(ref);
   if(!latest.exists)throw new HttpsError("not-found","Record already purged.");
   const current=latest.data();
   if(current.legalHold===true||current.deletionStatus!=="PENDING_REVIEW"||(current.retainUntil?.toDate?.()||new Date(8640000000000000))>new Date())throw new HttpsError("failed-precondition","Record protection changed; purge was blocked.");
   tx.set(auditRef,{action:"MEETING_RECORD_PURGED",collection:"meetingRecords",recordId,details:{meetingId:record.meetingId,recordType:record.recordType,contentHash:record.contentHash,retentionYears:record.retentionYears,retentionPolicyVersion:record.retentionPolicyVersion},actorUid:ctx.uid,actorEmail:ctx.email||null,createdAt:FieldValue.serverTimestamp()});
   tx.delete(ref);
  });
  return {ok:true,deletionStatus:"PURGED",auditId:auditRef.id};
 }
 throw new HttpsError("invalid-argument","Unsupported disposition operation.");
});
