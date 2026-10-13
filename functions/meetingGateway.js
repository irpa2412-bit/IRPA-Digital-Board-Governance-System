const {onCall,HttpsError}=require("firebase-functions/v2/https");
const logger=require("firebase-functions/logger");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("crypto");
const {normalizeMeetingEntryMode,resolveMeetingEntryState}=require("./meetingEntryPolicy");
const db=getFirestore();

function text(v){return String(v??"").trim();}
function hash(v){return crypto.createHash("sha256").update(String(v)).digest("hex");}
function gatePassword(){return crypto.randomBytes(9).toString("base64url").replace(/[-_]/g,"").slice(0,12).toUpperCase();}
function active(status){return !["cancelled","canceled","completed","archived","closed"].includes(text(status||"Scheduled").toLowerCase());}
function admin(request){return request.auth?.token?.admin===true||text(request.auth?.token?.email).toLowerCase()==="irpa@gmail.com"||text(request.auth?.token?.email).toLowerCase()==="irpa2412@gmail.com";}
async function activeAdmin(request){if(admin(request))return true;const uid=request.auth?.uid;if(!uid)return false;const snap=await db.collection("adminProfiles").doc(uid).get();return snap.exists&&snap.data()?.active===true;}

exports.createMeetingAccessInvitation=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid;
 const meetingId=text(request.data?.meetingId),participantId=text(request.data?.participantId);
 let stage="AUTHENTICATE";
 try{
 if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 stage="VALIDATE_INPUT";
 const logStage=(status,extra={})=>console.info("MEETING_ACCESS_INVITATION_STAGE",{stage,status,meetingId:meetingId||null,participantId:participantId||null,actorUid:uid,...extra});
 logStage("START");
 if(!meetingId||!participantId)throw new HttpsError("invalid-argument","Meeting and participant are required.");
 stage="LOAD_MEETING_AND_PARTICIPANT";
 const meetingSnap=await db.collection("meetings").doc(meetingId).get();
 const participantSnap=await db.collection("participants").doc(participantId).get();
 if(!meetingSnap.exists||!participantSnap.exists)throw new HttpsError("not-found","Meeting or participant was not found.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()},participant={id:participantSnap.id,...participantSnap.data()};
 if(!active(meeting.status))throw new HttpsError("failed-precondition","Closed meetings cannot issue new invitation passes.");
 logStage("RECORDS_LOADED",{meetingFound:true,participantFound:true,participantMeetingMatches:participant.meetingId===meetingId});
 if(participant.meetingId!==meetingId)throw new HttpsError("failed-precondition","Participant is not linked to the selected meeting.");
 const chair=String(meeting.chairpersonEmail||"").toLowerCase()===String(request.auth.token.email||"").toLowerCase();
 const secretary=String(meeting.secretaryEmail||"").toLowerCase()===String(request.auth.token.email||"").toLowerCase();
 const isAdmin=await activeAdmin(request);
 // A meeting initiator is already recorded on the authoritative meeting register only after
 // the meeting-registration rules accept the authorised registrar. Allow that same initiator
 // to dispatch invitations for their own meeting; do not force all dispatch work through admin.
 const initiator=text(meeting.initiatorUid)===uid;
 stage="AUTHORIZE_ISSUER";
 logStage("AUTHORIZATION_EVALUATED",{isAdmin,chair,secretary,initiator});
 if(!isAdmin&&!chair&&!secretary&&!initiator)throw new HttpsError("permission-denied","Only the authorised meeting initiator, administrator, chairperson or secretary may issue meeting access.");
 const raw=crypto.randomBytes(32).toString("base64url");
 const meetingPassword=gatePassword();
 const tokenHash=hash(raw),passwordHash=hash(meetingPassword);
 stage="CREATE_ACCESS_PASS";
 const ref=db.collection("meetingAccessTokens").doc();
 const expiresAt=new Date(Date.now()+1000*60*60*24*30);
 await ref.set({
  meetingId,meetingReference:text(meeting.reference||meeting.title),participantId,
  participantEmail:text(participant.participantEmail||participant.email).toLowerCase()||null,
  participantUid:text(participant.participantUid)||null,
  tokenHash,passwordHash,tokenVersion:"1",status:"Active",reusable:true,reusableUntilMeetingClosure:true,expiresAt,
  createdByUid:uid,createdAt:FieldValue.serverTimestamp(),
  gateway:"IRPA Meeting Entry Gateway",singlePurpose:"Live meeting entry"
 });
 logStage("ACCESS_PASS_CREATED",{accessId:ref.id});
 stage="UPDATE_MEETING_INVITEE_TALLY";
 try { await db.runTransaction(async tx=>{const latest=await tx.get(meetingSnap.ref);if(!latest.exists)throw new HttpsError("not-found","The meeting record no longer exists.");const current=latest.data()||{};const ids=Array.isArray(current.invitedParticipantIds)?current.invitedParticipantIds.map(String):[];const nextIds=[...new Set([...ids,participantId])];const invitedEmails=new Set(Array.isArray(current.invitedEmails)?current.invitedEmails.map(v=>text(v).toLowerCase()).filter(Boolean):[]);const participantEmails=new Set(Array.isArray(current.participantEmails)?current.participantEmails.map(v=>text(v).toLowerCase()).filter(Boolean):[]);const participantEmail=text(participant.participantEmail||participant.email).toLowerCase();if(participantEmail){invitedEmails.add(participantEmail);participantEmails.add(participantEmail);}const patch={invitedParticipantIds:nextIds,invitedParticipantCount:nextIds.length,invitedEmails:[...invitedEmails],participantEmails:[...participantEmails],updatedAt:FieldValue.serverTimestamp()};const participantUid=text(participant.participantUid||participant.uid||participant.userId);if(participantUid){patch.invitedUids=FieldValue.arrayUnion(participantUid);patch.participantUids=FieldValue.arrayUnion(participantUid);}tx.set(meetingSnap.ref,patch,{merge:true});}); } catch(error) { console.error("MEETING_ACCESS_INVITATION_TALLY_FAILED",{stage,meetingId,participantId,accessId:ref.id,code:error?.code||null,message:String(error?.message||error).slice(0,240)}); try { await ref.update({status:"Revoked",revokedAt:FieldValue.serverTimestamp(),revocationReason:"INVITEE_TALLY_UPDATE_FAILED"}); } catch(revokeError) { console.error("MEETING_ACCESS_INVITATION_ORPHAN_PASS_REVOCATION_FAILED",{meetingId,participantId,accessId:ref.id,code:revokeError?.code||null,message:String(revokeError?.message||revokeError).slice(0,200)}); } throw new HttpsError("internal","Meeting invitation could not update the meeting invitee register. Retry after checking the meeting register permissions."); }
 logStage("SUCCESS",{accessId:ref.id});
 return {ok:true,accessId:ref.id,accessToken:raw,meetingId,meetingPassword,participantId,participantName:text(participant.participantName||participant.name)||text(participant.email),meetingReference:text(meeting.reference||meeting.title),meetingCategory:text(meeting.meetingCategory||meeting.category||meeting.meetingType||"General Meeting"),reusable:true,reusePolicy:"Reusable for 30 days, or until revoked or the meeting is closed.",expiresAt:expiresAt.toISOString()};
 }catch(error){
  logger.error("MEETING_INVITATION_ACCESS_ISSUE_FAILED",{stage,actorUid:uid||null,meetingId:meetingId||null,participantId:participantId||null,errorCode:String(error?.code||"").slice(0,100),errorMessage:String(error?.message||error).slice(0,300),stack:String(error?.stack||"").slice(0,1600)});
  if(error instanceof HttpsError)throw error;
  throw new HttpsError("internal","Meeting access could not be issued. The server recorded a diagnostic event; contact IRPA support if the error persists.");
 }
});

exports.revokeMeetingAccessInvitation=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid;
 if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 const accessId=text(request.data?.accessId);
 if(!accessId)throw new HttpsError("invalid-argument","Meeting access ID is required.");
 const ref=db.collection("meetingAccessTokens").doc(accessId);
 const snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Meeting access pass was not found.");
 const grant=snap.data()||{};
 const meetingSnap=await db.collection("meetings").doc(text(grant.meetingId)).get();
 const meeting=meetingSnap.exists?meetingSnap.data()||{}:{};
 const email=text(request.auth?.token?.email).toLowerCase();
 const chair=text(meeting.chairpersonEmail).toLowerCase()===email;
 const secretary=text(meeting.secretaryEmail).toLowerCase()===email;
 const isAdmin=await activeAdmin(request);
 if(!isAdmin&&grant.createdByUid!==uid&&!chair&&!secretary)throw new HttpsError("permission-denied","Only the issuer or an authorised meeting administrator may revoke this pass.");
 if(grant.status!=="Revoked"){
  await ref.update({status:"Revoked",revokedByUid:uid,revokedAt:FieldValue.serverTimestamp()});
  await db.collection("audit").add({action:"MEETING_ACCESS_INVITATION_REVOKED",collection:"meetingAccessTokens",recordId:accessId,details:{meetingId:grant.meetingId,participantId:grant.participantId},actorUid:uid,actorEmail:email||null,createdAt:FieldValue.serverTimestamp()});
 }
 return {ok:true,accessId,status:"Revoked"};
});

exports.authorizeMeetingEntry=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid,email=text(request.auth?.token?.email).toLowerCase();
 if(!uid||!email)throw new HttpsError("unauthenticated","Sign in before entering the meeting.");
 const token=text(request.data?.accessToken),suppliedMeetingId=text(request.data?.meetingId),suppliedPassword=text(request.data?.meetingPassword);
 if(!token)throw new HttpsError("invalid-argument","Meeting access token is required.");
 const snap=await db.collection("meetingAccessTokens").where("tokenHash","==",hash(token)).limit(1).get();
 if(snap.empty)throw new HttpsError("permission-denied","This meeting access link is invalid.");
 const doc=snap.docs[0],grant={id:doc.id,...doc.data()};
 if(suppliedMeetingId&&suppliedMeetingId!==grant.meetingId)throw new HttpsError("permission-denied","The supplied meeting ID does not match this gate pass.");
 const expiry=grant.expiresAt?.toDate?.()||new Date(grant.expiresAt||0);if(grant.status!=="Active"||Number.isNaN(expiry.getTime())||expiry.getTime()<=Date.now())throw new HttpsError("permission-denied","This meeting access link has expired or been revoked.");
 if(grant.passwordHash&&hash(suppliedPassword)!==grant.passwordHash)throw new HttpsError("permission-denied","The meeting ID and gate password do not match the issued gate pass.");
 const participantSnap=await db.collection("participants").doc(grant.participantId).get();
 const participant=participantSnap.exists?participantSnap.data():{};
 const boundEmail=text(grant.participantEmail).toLowerCase(),boundUid=text(grant.participantUid);
 if((boundUid&&boundUid!==uid)||(!boundUid&&boundEmail&&boundEmail!==email))throw new HttpsError("permission-denied","This meeting link is assigned to a different participant identity.");
 const meetingSnap=await db.collection("meetings").doc(grant.meetingId).get();
 if(!meetingSnap.exists)throw new HttpsError("not-found","The meeting record no longer exists.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()};
 if(!active(meeting.status))throw new HttpsError("failed-precondition","This meeting is closed and cannot be entered.");
 const entryMode=normalizeMeetingEntryMode(meeting);
 const entryRequestRef=db.collection("meetingEntryRequests").doc(hash("meeting-entry:"+doc.id+":"+uid));
 const entryRequestSnap=await entryRequestRef.get();
 let entryRequest=entryRequestSnap.exists?{id:entryRequestSnap.id,...entryRequestSnap.data()}:null;
 const entryState=resolveMeetingEntryState(entryMode,entryRequest?.status);
 if(entryState==="AUTHORIZED"){
  if(entryRequest&&entryRequest.status!=="ADMITTED")await db.collection("meetingEntryRequests").doc(entryRequest.id).update({status:"ADMITTED",resolvedAt:FieldValue.serverTimestamp(),resolvedBy:"DIRECT_ENTRY_POLICY"});
  await db.collection("audit").add({action:"MEETING_ENTRY_AUTHORIZED",collection:"meetingAccessTokens",recordId:doc.id,details:{meetingId:grant.meetingId,participantId:grant.participantId,entryMode,gateway:"IRPA Meeting Entry Gateway"},actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()});
  return {ok:true,entryState:"AUTHORIZED",entryMode,meetingId:grant.meetingId,participantId:grant.participantId,meetingReference:grant.meetingReference||meeting.reference||meeting.title,meetingCategory:text(meeting.meetingCategory||meeting.category||meeting.meetingType||"General Meeting"),meetingStatus:meeting.status||"Scheduled",participantName:text(participant.participantName||participant.name)||email};
 }
 if(entryState==="DENIED")throw new HttpsError("permission-denied","The meeting host declined this entry request. Contact the meeting initiator for assistance.");
 if(!entryRequest){
  const requestData={meetingId:grant.meetingId,meetingReference:grant.meetingReference||meeting.reference||meeting.title||"",participantId:grant.participantId,participantName:text(participant.participantName||participant.name)||email,participantUid:uid,participantEmail:email,accessId:doc.id,status:"PENDING",entryMode,requestedAt:FieldValue.serverTimestamp(),expiresAt:grant.expiresAt||null};
  try{await entryRequestRef.create(requestData);entryRequest={id:entryRequestRef.id,...requestData};}
  catch(error){if(!["already-exists","6"].includes(String(error?.code||"")))throw error;const latest=await entryRequestRef.get();if(!latest.exists)throw error;entryRequest={id:latest.id,...latest.data()};if(entryRequest.status==="DENIED")throw new HttpsError("permission-denied","The meeting host declined this entry request. Contact the meeting initiator for assistance.");}
  await db.collection("audit").add({action:"MEETING_ENTRY_REQUESTED",collection:"meetingEntryRequests",recordId:entryRequestRef.id,details:{meetingId:grant.meetingId,participantId:grant.participantId,entryMode},actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()});
 }
 return {ok:true,entryState:"WAITING_FOR_HOST",entryMode,entryRequestId:entryRequest.id,meetingId:grant.meetingId,participantId:grant.participantId,meetingReference:grant.meetingReference||meeting.reference||meeting.title,meetingCategory:text(meeting.meetingCategory||meeting.category||meeting.meetingType||"General Meeting"),meetingStatus:meeting.status||"Scheduled",participantName:text(participant.participantName||participant.name)||email};
});

exports.listMeetingEntryRequests=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid;if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 const meetingId=text(request.data?.meetingId);if(!meetingId)throw new HttpsError("invalid-argument","Meeting ID is required.");
 const meetingSnap=await db.collection("meetings").doc(meetingId).get();if(!meetingSnap.exists)throw new HttpsError("not-found","Meeting was not found.");
 const meeting=meetingSnap.data()||{},email=text(request.auth?.token?.email).toLowerCase();
 if(!active(meeting.status))throw new HttpsError("failed-precondition","Closed meetings cannot load invitation candidates.");
 const authorised=await activeAdmin(request)||text(meeting.initiatorUid)===uid||text(meeting.chairpersonEmail).toLowerCase()===email||text(meeting.secretaryEmail).toLowerCase()===email;
 if(!authorised)throw new HttpsError("permission-denied","Only the meeting initiator, chairperson, secretary or active administrator may view entry requests.");
 const snap=await db.collection("meetingEntryRequests").where("meetingId","==",meetingId).limit(200).get();
 return {requests:snap.docs.filter(d=>{const row=d.data()||{},expiry=row.expiresAt?.toDate?.()||new Date(row.expiresAt||0);return row.status==="PENDING"&&!Number.isNaN(expiry.getTime())&&expiry.getTime()>Date.now();}).map(d=>({id:d.id,participantId:text(d.data().participantId),participantName:text(d.data().participantName||d.data().participantEmail),participantEmail:text(d.data().participantEmail),requestedAt:d.data().requestedAt?.toDate?.()?.toISOString()||null}))};
});

exports.listMeetingInviteCandidates=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid;if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 const meetingId=text(request.data?.meetingId);if(!meetingId)throw new HttpsError("invalid-argument","Meeting ID is required.");
 const meetingSnap=await db.collection("meetings").doc(meetingId).get();if(!meetingSnap.exists)throw new HttpsError("not-found","Meeting was not found.");
 const meeting=meetingSnap.data()||{},email=text(request.auth?.token?.email).toLowerCase();
 const authorised=await activeAdmin(request)||text(meeting.initiatorUid)===uid||text(meeting.chairpersonUid)===uid||text(meeting.secretaryUid)===uid||text(meeting.chairpersonEmail).toLowerCase()===email||text(meeting.secretaryEmail).toLowerCase()===email;
 if(!authorised)throw new HttpsError("permission-denied","Only the meeting initiator, authorised chairperson/secretary or active administrator may access invitation candidates.");
 const [memberSnap,employeeSnap]=await Promise.all([db.collection("members").get(),db.collection("employees").get()]);
 const activeRecord=row=>{const statuses=[row.status,row.employmentStatus,row.registrationStatus].map(v=>text(v).toLowerCase()).filter(Boolean);if(statuses.some(v=>["inactive","terminated","suspended","deleted","cancelled","canceled","archived"].includes(v)))return false;return statuses.some(v=>["active","activated"].includes(v));};
 const clean=(doc,type)=>{
  const row=doc.data()||{},candidateEmail=text(row.email||row.emailAddress||row.contactEmail).toLowerCase();
  if(!activeRecord(row)||!candidateEmail)return null;
  return {id:doc.id,name:text(row.name||row.fullName||row.memberName||row.employeeName||row.displayName)||candidateEmail,email:candidateEmail,role:text(row.role||type),memberType:text(row.memberType||row.employeeType||type),department:text(row.department),status:text(row.status||row.employmentStatus||row.registrationStatus),uid:text(row.uid||row.authUid||row.userUid),memberNumber:text(row.memberNumber||row.registrationNumber),employeeNumber:text(row.employeeNumber),boardMember:row.boardMember===true||Boolean(row.boardPosition)||text(row.department)==="Board of Directors"||text(row.role)==="Board Member",boardPosition:text(row.boardPosition)};
 };
 const members=memberSnap.docs.map(d=>clean(d,"Member")).filter(Boolean);
 const employees=employeeSnap.docs.map(d=>clean(d,"Employee")).filter(Boolean);
 await db.collection("audit").add({action:"MEETING_INVITATION_CANDIDATES_ACCESSED",collection:"meetings",recordId:meetingId,details:{memberCandidateCount:members.length,employeeCandidateCount:employees.length},actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()});
 return {members,employees,source:"AUTHORITATIVE_REGISTERS",meetingId};
});

exports.resolveMeetingEntryRequest=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid;if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 const requestId=text(request.data?.requestId),decision=text(request.data?.decision).toUpperCase();
 if(!requestId||!["ADMIT","DENY"].includes(decision))throw new HttpsError("invalid-argument","A request ID and ADMIT or DENY decision are required.");
 const ref=db.collection("meetingEntryRequests").doc(requestId);
 return db.runTransaction(async tx=>{
  const reqSnap=await tx.get(ref);if(!reqSnap.exists)throw new HttpsError("not-found","Entry request was not found.");
  const row=reqSnap.data()||{};
  const meetingRef=db.collection("meetings").doc(text(row.meetingId));
  const meetingSnap=await tx.get(meetingRef);if(!meetingSnap.exists)throw new HttpsError("not-found","Meeting was not found.");
  const meeting=meetingSnap.data()||{},email=text(request.auth?.token?.email).toLowerCase();
  const isAdmin=await activeAdmin(request);
  const authorised=isAdmin||text(meeting.initiatorUid)===uid||text(meeting.chairpersonEmail).toLowerCase()===email||text(meeting.secretaryEmail).toLowerCase()===email;
  if(!authorised)throw new HttpsError("permission-denied","Only the meeting initiator, chairperson, secretary or active administrator may resolve entry requests.");
  if(row.status!=="PENDING")throw new HttpsError("failed-precondition","This entry request has already been resolved.");
  const tokenRef=db.collection("meetingAccessTokens").doc(text(row.accessId));
  const tokenSnap=await tx.get(tokenRef);
  const tokenData=tokenSnap.exists?(tokenSnap.data()||{}):{};const tokenExpiry=tokenData.expiresAt?.toDate?.()||new Date(tokenData.expiresAt||0);if(!tokenSnap.exists||tokenData.status!=="Active"||Number.isNaN(tokenExpiry.getTime())||tokenExpiry.getTime()<=Date.now())throw new HttpsError("failed-precondition","The invitation pass is expired, revoked or no longer active.");
  const next=decision==="ADMIT"?"ADMITTED":"DENIED";
  tx.update(ref,{status:next,resolvedByUid:uid,resolvedByEmail:email,resolvedAt:FieldValue.serverTimestamp()});
  tx.set(db.collection("audit").doc(),{action:decision==="ADMIT"?"MEETING_ENTRY_ADMITTED":"MEETING_ENTRY_DENIED",collection:"meetingEntryRequests",recordId:requestId,details:{meetingId:row.meetingId,participantId:row.participantId},actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()});
  return {ok:true,status:next};
 }); 
});
/** Scoped server-side directory for authorised meeting registration and invitation workflows. */
exports.listMeetingInviteeDirectory=onCall({region:"us-central1",timeoutSeconds:20},async request=>{
 const uid=request.auth?.uid;if(!uid)throw new HttpsError("unauthenticated","Sign in to load the meeting invitee directory.");
 const email=text(request.auth?.token?.email).toLowerCase(),isAdmin=await activeAdmin(request);
 const allowed=new Set(["executive director","director internal oversight","director finance & administration","director human resources","hr director","operations manager","departmental director","departmental manager","director outreach","director community development","director livestock","director environment","director field department","board secretary","secretary to the board","meeting secretary"]);
 const [mu,eu,me,ee]=await Promise.all([db.collection("members").doc(uid).get(),db.collection("employees").doc(uid).get(),email?db.collection("members").where("email","==",email).limit(2).get():Promise.resolve({docs:[]}),email?db.collection("employees").where("email","==",email).limit(2).get():Promise.resolve({docs:[]})]);
 const candidates=[...(mu.exists?[mu.data()]:[]),...(eu.exists?[eu.data()]:[]),...me.docs.map(x=>x.data()),...ee.docs.map(x=>x.data())];
 const roles=d=>[d?.role,d?.title,d?.position,d?.departmentalRole,...(Array.isArray(d?.roles)?d.roles:[]),...(Array.isArray(d?.assignedRoles)?d.assignedRoles:[]),...(Array.isArray(d?.selectedRoles)?d.selectedRoles:[]),...(Array.isArray(d?.roleAssignments)?d.roleAssignments:[])].map(x=>text(x).toLowerCase());
 const active=d=>["active","activated"].includes(text(d?.status||d?.employmentStatus||d?.registrationStatus).toLowerCase());
 const registrar=candidates.some(d=>active(d)&&roles(d).some(r=>allowed.has(r))),claims=Array.isArray(request.auth?.token?.irpaRoles)?request.auth.token.irpaRoles.map(x=>text(x).toLowerCase()):[];
 if(!isAdmin&&!registrar&&!claims.some(r=>allowed.has(r)))throw new HttpsError("permission-denied","Only an authorised meeting registrar can load the meeting invitee directory.");
 const [members,employees]=await Promise.all([db.collection("members").get(),db.collection("employees").get()]);
 const project=(snap,kind)=>snap.docs.map(s=>{const d=s.data()||{},status=text(d.status||d.employmentStatus||d.registrationStatus);if(!["active","activated"].includes(status.toLowerCase()))return null;const board=d.boardMember===true||text(d.role).toLowerCase()==="board member"||Boolean(d.boardPosition)||text(d.department)==="Board of Directors";if(kind==="board"&&!board||kind==="member"&&board)return null;return {id:s.id,uid:text(d.uid||d.authUid||d.userUid),name:text(d.name||d.fullName||d.memberName||d.displayName),email:text(d.email||d.emailAddress||d.contactEmail).toLowerCase(),memberNumber:text(d.memberNumber||d.registrationNumber),employeeNumber:text(d.employeeNumber),role:text(d.role),roles:Array.isArray(d.roles)?d.roles:[],boardMember:d.boardMember===true,boardPosition:text(d.boardPosition),department:text(d.department),memberType:text(d.memberType),status,employmentStatus:text(d.employmentStatus),registrationStatus:text(d.registrationStatus),title:text(d.title),position:text(d.position),departmentalRole:text(d.departmentalRole)}}).filter(Boolean);
 return {boardMembers:project(members,"board"),members:project(members,"member"),employees:project(employees,"employee")};
});
