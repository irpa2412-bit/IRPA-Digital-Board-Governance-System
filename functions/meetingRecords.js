const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("crypto");
const {defineSecret}=require("firebase-functions/params");
const {queueInductionEmail}=require("./queueInductionEmail");
const INVITE_SERVICE_KEY=defineSecret("INVITE_SERVICE_KEY");
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
 const listed=[...(meeting.participantUids||[]),...(meeting.attendeeUids||[]),...(meeting.memberUids||[]),...(meeting.invitedUids||[]),...(meeting.subscriberUids||[])].includes(uid);
 const subResults=await Promise.all([
  db.collection("meetingSubscriptions").where("meetingId","==",meetingId).where("uid","==",uid).limit(1).get().catch(()=>({empty:true})),
  db.collection("meetingSubscriptions").where("meetingId","==",meetingId).where("subscriberUid","==",uid).limit(1).get().catch(()=>({empty:true})),
  db.collection("meetingSubscriptions").where("meetingId","==",meetingId).where("userId","==",uid).limit(1).get().catch(()=>({empty:true})),
  email?db.collection("meetingSubscriptions").where("meetingId","==",meetingId).where("email","==",email).limit(1).get().catch(()=>({empty:true})):Promise.resolve({empty:true})
 ]);
 const [participantSnap]=await Promise.all([db.collection("participants").where("meetingId","==",meetingId).get().catch(()=>({docs:[]}))]);
 const participantRecord=participantSnap.docs.some(d=>{
  const p=d.data()||{},status=text(p.status||p.registrationStatus).toLowerCase();
  if(["cancelled","canceled","revoked","removed","inactive","closed"].includes(status))return false;
  return [p.uid,p.userId,p.participantUid,p.memberUid,p.invitedUid].map(v=>text(v)).includes(uid)||!!email&&[p.email,p.participantEmail,p.invitedEmail].some(v=>text(v).toLowerCase()===email);
 });
 const subscribed=subResults.some(s=>!s.empty);
 const participant=listed||subscribed||participantRecord;
 if(!identityActive&&!participant)throw new HttpsError("permission-denied","An active IRPA identity or authorised meeting participant is required.");
 const canManage=admin(req)||chair||secretary||text(meeting.chairpersonUid)===uid||text(meeting.secretaryUid)===uid||text(meeting.createdByUid)===uid||text(meeting.initiatorUid)===uid;
 return {uid,email,meeting,category:cat,participant,subscribed,canManage,canRead:canManage||participant,confidentiality:text(meeting.confidentialityClass)||(cat==="GOVERNANCE"?"BOARD_RESTRICTED":"INTERNAL")};
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

exports.saveLiveMeetingProceedings=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const meetingId=text(req.data?.meetingId),content=text(req.data?.content);
 const ctx=await context(req,meetingId);
 if(!ctx.canRead)throw new HttpsError("permission-denied","Only an authorised meeting participant or subscriber may save live proceedings.");
 if(text(ctx.meeting.status).toLowerCase()!=="in progress")throw new HttpsError("failed-precondition","Live proceedings auto-save is only available while the registered meeting status is In Progress.");
 if(TERMINAL.has(text(ctx.meeting.status).toLowerCase()))throw new HttpsError("failed-precondition","Proceedings cannot be appended to a closed or cancelled meeting.");
 if(!content)throw new HttpsError("invalid-argument","Live proceedings transcript is empty.");
 if(content.length>900000)throw new HttpsError("invalid-argument","Transcript exceeds the 900,000 character limit.");
 const recordId="live-transcript-"+hash(meetingId+":"+ctx.uid).slice(0,32);
 const ref=db.collection("meetingRecords").doc(recordId),prior=await ref.get(),now=new Date();
 const retentionYears=RETENTION_YEARS[ctx.category]||3,digest=hash(content);
 const data={meetingId,meetingReference:text(ctx.meeting.meetingReference||ctx.meeting.reference||ctx.meeting.title),meetingTitle:text(ctx.meeting.title),meetingCategory:ctx.category,meetingPolicyId:ctx.category,recordType:"SUBSCRIBER_TRANSCRIPT_DRAFT",recordLabel:"Live Proceedings Transcript Draft",title:"Live Proceedings — "+text(ctx.meeting.title||"IRPA Meeting"),content,contentHash:digest,integrityAlgorithm:"SHA-256",integrityStatus:"VERIFIED_AT_CAPTURE",version:Number(prior.data()?.version||0)+1,status:"Active",confidentialityClass:ctx.confidentiality,storageDestination:"FIRESTORE_MEETING_RECORDS",draftOnly:true,approved:false,approvalStatus:"NOT_SUBMITTED",requiresHumanReview:true,createdFrom:"IRPA_LIVE_PROCEEDINGS_AUTO_CAPTURE",liveCapture:true,legalHold:false,retentionYears,retainUntil:addYears(now,retentionYears),retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:ctx.uid,capturedByEmail:ctx.email||null,capturedAt:FieldValue.serverTimestamp(),createdAt:prior.exists?(prior.data()?.createdAt||FieldValue.serverTimestamp()):FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),deletedAt:null,deletionStatus:"NOT_ELIGIBLE"};
 await ref.set(data,{merge:true});
 await audit("LIVE_MEETING_PROCEEDINGS_AUTOSAVED",ctx,recordId,{contentHash:digest,version:data.version,characters:content.length,requiresHumanReview:true});
 return{ok:true,recordId,contentHash:digest,version:data.version,updated:true,draftOnly:true,requiresHumanReview:true};
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
  confidentialityClass:ctx.confidentiality,storageDestination:req.data?.driveArchive?.provider==="Google Drive"?"GOOGLE_DRIVE_AND_FIRESTORE_METADATA":"FIRESTORE_MEETING_RECORDS",
  storagePath:text(req.data?.driveArchive?.storagePath)||null,driveArchive:req.data?.driveArchive&&typeof req.data.driveArchive==="object"?{provider:"Google Drive",meetingCategory:ctx.category,folderId:text(req.data.driveArchive.folderId),folderUrl:text(req.data.driveArchive.folderUrl),fileId:text(req.data.driveArchive.fileId),webViewLink:text(req.data.driveArchive.webViewLink),fileName:text(req.data.driveArchive.fileName),storagePath:text(req.data.driveArchive.storagePath),contentType:text(req.data.driveArchive.contentType),fileSize:Number(req.data.driveArchive.fileSize||0)}:null,documentPortalRequiredForBinary:true,draftOnly:true,approved:false,
  approvalStatus:"NOT_SUBMITTED",requiresHumanReview:true,
  createdFrom:"IRPA_AI_MEETING_ASSISTANT",legalHold:false,retentionYears,retainUntil,
  retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:ctx.uid,capturedByEmail:ctx.email||null,
  capturedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
  deletedAt:null,deletionStatus:"NOT_ELIGIBLE"
 };
 await ref.set(data);
 await audit("MEETING_ASSISTANT_DRAFT_SAVED",ctx,ref.id,{recordType:type,contentHash:digest,sourceTranscriptHash:data.sourceTranscriptHash,requiresHumanReview:true});
 return {ok:true,recordId:ref.id,recordType:type,contentHash:digest,integrityStatus:data.integrityStatus,draftOnly:true,approvalStatus:data.approvalStatus,requiresHumanReview:true,driveArchive:data.driveArchive};
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


function escapeReportHtml(value){
 return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/\n/g,"<br>");
}
function reportLines(rows,fields){
 return rows.length?rows.map((row,index)=>(index+1)+". "+(fields.map(field=>text(row[field])).filter(Boolean).join(" — ")||text(row.title||row.name||row.description)||"Recorded item")).join("\n"):"No entries recorded in the register at compilation time.";
}
exports.compileAndEmailMeetingReport=onCall({
 region:"us-central1",timeoutSeconds:120,secrets:[INVITE_SERVICE_KEY]
},async request=>{
 const uid=request.auth?.uid,email=text(request.auth?.token?.email).toLowerCase();
 if(!uid)throw new HttpsError("unauthenticated","Sign in to compile and distribute a meeting report.");
 const meetingId=text(request.data?.meetingId),minutesText=text(request.data?.minutesText);
 if(!meetingId)throw new HttpsError("invalid-argument","Meeting ID is required.");
 if(minutesText.length>150000)throw new HttpsError("invalid-argument","Compiled minutes exceed the 150,000 character limit.");
 const meetingSnap=await db.collection("meetings").doc(meetingId).get();
 if(!meetingSnap.exists)throw new HttpsError("not-found","The registered meeting could not be found.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()};
 const isAdmin=admin(request);
 const isInitiator=text(meeting.initiatorUid)===uid;
 const isChair=text(meeting.chairpersonUid)===uid||text(meeting.chairpersonEmail).toLowerCase()===email;
 const isSecretary=text(meeting.secretaryUid)===uid||text(meeting.secretaryEmail).toLowerCase()===email;
 let activeAdmin=isAdmin;
 if(!activeAdmin){const adminSnap=await db.collection("adminProfiles").doc(uid).get();activeAdmin=adminSnap.exists&&adminSnap.data()?.active===true;}
 if(!activeAdmin&&!isInitiator&&!isChair&&!isSecretary)throw new HttpsError("permission-denied","Only the authorised meeting initiator, chairperson, secretary or administrator may compile and distribute the meeting report.");
 if(!text(meeting.registerStatus))throw new HttpsError("failed-precondition","The meeting is not registered and cannot be reported.");
 const [resolutionSnap,decisionSnap,voteSnap,subscriptionSnap,participantSnap,recordSnap]=await Promise.all([
  db.collection("resolutions").where("meetingId","==",meetingId).get().catch(()=>({docs:[]})),
  db.collection("decisions").where("meetingId","==",meetingId).get().catch(()=>({docs:[]})),
  db.collection("votes").where("meetingId","==",meetingId).get().catch(()=>({docs:[]})),
  db.collection("meetingSubscriptions").where("meetingId","==",meetingId).get().catch(()=>({docs:[]})),
  db.collection("participants").where("meetingId","==",meetingId).get().catch(()=>({docs:[]})),
  db.collection("meetingRecords").where("meetingId","==",meetingId).get().catch(()=>({docs:[]}))
 ]);
 const resolutions=resolutionSnap.docs.map(d=>({id:d.id,...d.data()}));
 const decisions=decisionSnap.docs.map(d=>({id:d.id,...d.data()}));
 const votes=voteSnap.docs.map(d=>d.data()||{});
 const attendanceRecord=recordSnap.docs.map(d=>({id:d.id,...d.data()})).find(r=>String(r.recordType||"").toUpperCase()==="ATTENDANCE_REGISTER"&&r.status==="Active");
 const participantEmails=new Map();
 const addRecipient=(raw,name="",status="")=>{const address=text(raw).toLowerCase();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)&&!["cancelled","canceled","revoked","removed","inactive","closed"].includes(text(status).toLowerCase()))participantEmails.set(address,participantEmails.get(address)||text(name)||address);};
 participantSnap.docs.forEach(d=>{const p=d.data()||{};addRecipient(p.participantEmail||p.email||p.invitedEmail,p.participantName||p.name,p.status);});
 subscriptionSnap.docs.forEach(d=>{const p=d.data()||{};addRecipient(p.email||p.subscriberEmail||p.participantEmail,p.subscriberName||p.participantName||p.name,p.status);});
 for(const key of ["invitedEmails","participantEmails","attendeeEmails","subscriberEmails"])if(Array.isArray(meeting[key]))meeting[key].forEach(address=>addRecipient(address));
 for(const key of ["participants","attendees"])if(Array.isArray(meeting[key]))meeting[key].forEach(p=>{if(p&&typeof p==="object")addRecipient(p.email||p.participantEmail||p.subscriberEmail,p.name||p.participantName,p.status);});
 const recipients=[...participantEmails.entries()].map(([recipientEmail,recipientName])=>({recipientEmail,recipientName}));
 if(!recipients.length)throw new HttpsError("failed-precondition","No valid participant email addresses were found in the meeting invitation portal records. No email was sent.");
 const countOutcome=outcome=>votes.filter(v=>text(v.outcome||v.vote||v.choice).toLowerCase()===outcome.toLowerCase()).length;
 const voteCounts={For:countOutcome("For"),Against:countOutcome("Against"),Abstain:countOutcome("Abstain")};
 const tallyTotal=voteCounts.For+voteCounts.Against+voteCounts.Abstain;
 const meetingReference=text(meeting.meetingReference||meeting.reference||meeting.meetingIdentity||meetingId);
 const reportStatus=["Final","Approved","Reviewed"].includes(text(meeting.proceedingsStatus))||text(meeting.reportStatus).toLowerCase()==="approved"?"Compiled report — approval status recorded":"Compiled report — draft / approval status not verified";
 const decisionsText=reportLines(decisions,["reference","title","decision","description","status","responsiblePerson","deadline"]);
 const resolutionsText=reportLines(resolutions,["reference","title","resolution","description","status"]);
 const actionText=text(meeting.actionItems)||reportLines(decisions.filter(d=>d.action||d.actionItems||d.responsiblePerson),["action","actionItems","responsiblePerson","deadline","status"]);
 const attendanceText=attendanceRecord?attendanceRecord.content:text(meeting.attendanceSummary||meeting.attendanceRegisterSummary)||"Attendance register not found in the linked meeting records.";
 const quorumText=meeting.quorumVerified===true?"Verified":meeting.quorumVerified===false?"Not verified / not met":text(meeting.quorumStatus||meeting.quorumResult)||"Not recorded";
 const report=[
  "IMPROVEMENT OF RANGELAND IN PASTORAL AREAS (IRPA)",
  "STANDARD MEETING REPORT",
  "============================================================",
  "Report status: "+reportStatus,
  "Meeting title: "+(text(meeting.title)||"Not recorded"),
  "Meeting reference: "+meetingReference,
  "Meeting category: "+categoryOf(meeting),
  "Meeting type: "+(text(meeting.meetingType)||"Not recorded"),
  "Date: "+(text(meeting.date)||"Not recorded"),
  "Time: "+(text(meeting.startTime)||"Not recorded")+(text(meeting.endTime)?" – "+text(meeting.endTime):""),
  "Venue / platform: "+(text(meeting.venue||meeting.meetingPlatform)||"Not recorded"),
  "Chairperson: "+(text(meeting.chairperson)||"Not recorded"),
  "",
  "1. PURPOSE AND AGENDA",
  text(meeting.agenda)||"No agenda recorded.",
  "",
  "2. MEETING STATUS, ATTENDANCE AND QUORUM",
  "Meeting status: "+(text(meeting.status)||"Not recorded"),
  "Quorum verification: "+quorumText,
  attendanceText,
  "",
  "3. SUMMARY / COMPILED MINUTES",
  minutesText||text(meeting.minutes)||text(meeting.summary)||"No minutes or summary were supplied at compilation.",
  "",
  "4. DECISIONS REGISTER",
  decisionsText,
  "",
  "5. RESOLUTIONS REGISTER",
  resolutionsText,
  "",
  "6. VOTING STATISTICS (AGGREGATED; NO INDIVIDUAL VOTES DISCLOSED)",
  "Votes for: "+voteCounts.For,
  "Votes against: "+voteCounts.Against,
  "Abstentions: "+voteCounts.Abstain,
  "Recorded votes counted: "+tallyTotal,
  "Voting status: "+(text(meeting.votingStatus)||"Not recorded"),
  "Voting result: "+(text(meeting.votingResult)||"Not recorded"),
  "",
  "7. ACTION ITEMS AND FOLLOW-UP",
  actionText,
  "",
  "8. RECORD STATUS AND CONTROL",
  "This report was compiled from the registered meeting record and linked IRPA governance registers at the time of generation. Missing source information is identified as not recorded; no absent attendance, quorum, decision or voting data has been inferred.",
  "Compiled by authorised account: "+(email||uid),
  "Report generated (UTC): "+new Date().toISOString(),
  "IRPA Digital Board Governance System"
 ].join("\n");
 const reportHash=hash(report.replace(/Report generated \(UTC\): .+\n/,""));
 const dispatchId=hash(meetingId+":"+reportHash).slice(0,40);
 const dispatchRef=db.collection("meetingReportDispatches").doc(dispatchId);
 const secret=String(INVITE_SERVICE_KEY.value()||"");
 const gateway=String(process.env.GATEWAY_URL||process.env.INVITATION_GATEWAY_URL||"").replace(/\/$/,"");
 if(!secret||!gateway)throw new HttpsError("failed-precondition","The invitation email gateway is not fully configured on the server. The report was compiled but email delivery could not start.");
 const prior=await dispatchRef.get();
 if(prior.exists&&prior.data()?.status==="Sent")return{ok:true,alreadySent:true,reportHash,recipientCount:Number(prior.data()?.recipientCount||0),sentCount:Number(prior.data()?.sentCount||0),failedCount:0,dispatchId};
 if(prior.exists&&prior.data()?.status==="In Progress")throw new HttpsError("aborted","This report is already being distributed. Check the report dispatch register before retrying.");
 const priorStatuses=prior.exists&&Array.isArray(prior.data()?.recipients)?prior.data().recipients:[];
 const statusByEmail=new Map(priorStatuses.map(r=>[text(r.email).toLowerCase(),r]));
 await dispatchRef.set({meetingId,meetingReference,reportHash,reportContent:report,reportStatus,recipientCount:recipients.length,status:"In Progress",initiatedByUid:uid,initiatedByEmail:email||null,updatedAt:FieldValue.serverTimestamp(),createdAt:prior.exists?(prior.data()?.createdAt||FieldValue.serverTimestamp()):FieldValue.serverTimestamp()},{merge:true});
 const subject="IRPA Meeting Report | "+meetingReference+" | "+(text(meeting.title)||"Meeting");
 const html='<div style="font-family:Arial,sans-serif;max-width:800px;margin:auto;color:#202124"><div style="border-bottom:3px solid #426b45;padding:16px 0"><h2 style="margin:0">Improvement of Rangeland in Pastoral Areas (IRPA)</h2><h3 style="margin:8px 0 0">Standard Meeting Report</h3></div><p><strong>'+escapeReportHtml(reportStatus)+'</strong></p><div style="white-space:normal;line-height:1.55">'+escapeReportHtml(report)+'</div><hr><p style="font-size:12px;color:#555">Automatically distributed through the IRPA-DBGS meeting invitation email service. Aggregated voting statistics only; individual votes are not disclosed.</p></div>';
 const results=[];
 for(const recipient of recipients){
  const old=statusByEmail.get(recipient.recipientEmail);
  if(old?.status==="Sent"){results.push(old);continue;}
  try{
   const delivery=await queueInductionEmail({recipientEmail:recipient.recipientEmail,recipientName:recipient.recipientName,subject,text:report,html,invitedByUid:uid},{db,env:{...process.env,GATEWAY_URL:gateway,INVITE_SERVICE_KEY:secret}});
   const row={email:recipient.recipientEmail,name:recipient.recipientName,status:delivery.status||"Failed",messageId:delivery.messageId||null,error:delivery.error||null};
   results.push(row);
   await dispatchRef.set({recipients:results,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  }catch(error){
   const row={email:recipient.recipientEmail,name:recipient.recipientName,status:"Failed",error:String(error?.message||error).slice(0,240)};
   results.push(row);
   await dispatchRef.set({recipients:results,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  }
 }
 const sentCount=results.filter(r=>r.status==="Sent").length,failedCount=results.filter(r=>r.status!=="Sent").length;
 await dispatchRef.set({status:failedCount?"Partially Failed":"Sent",sentCount,failedCount,recipientCount:recipients.length,recipients:results,completedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
 const recordRef=db.collection("meetingRecords").doc();
 await recordRef.set({meetingId,meetingReference,meetingTitle:text(meeting.title),meetingCategory:categoryOf(meeting),meetingPolicyId:categoryOf(meeting),recordType:"MEETING_REPORT",recordLabel:"Compiled Meeting Report",title:"Standard Meeting Report — "+(text(meeting.title)||meetingReference),content:report,contentHash:hash(report),integrityAlgorithm:"SHA-256",integrityStatus:"VERIFIED_AT_CAPTURE",version:1,status:"Active",confidentialityClass:text(meeting.confidentialityClass)||(categoryOf(meeting)==="GOVERNANCE"?"BOARD_RESTRICTED":"INTERNAL"),storageDestination:"FIRESTORE_MEETING_RECORDS",approvalStatus:reportStatus,draftOnly:!reportStatus.startsWith("Compiled report — approval status recorded"),requiresHumanReview:true,retentionYears:RETENTION_YEARS[categoryOf(meeting)]||3,retainUntil:addYears(new Date(),RETENTION_YEARS[categoryOf(meeting)]||3),retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:uid,capturedByEmail:email||null,capturedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),deletedAt:null,deletionStatus:"NOT_ELIGIBLE"});
 await audit("MEETING_REPORT_COMPILED_AND_DISTRIBUTED",{uid,email,meeting,category:categoryOf(meeting),confidentiality:text(meeting.confidentialityClass)||"INTERNAL"},recordRef.id,{reportHash,dispatchId,recipientCount:recipients.length,sentCount,failedCount,aggregatedVoteCounts:voteCounts});
 return{ok:failedCount===0,reportRecordId:recordRef.id,dispatchId,reportHash,recipientCount:recipients.length,sentCount,failedCount,status:failedCount?"Partially Failed":"Sent"};
});
