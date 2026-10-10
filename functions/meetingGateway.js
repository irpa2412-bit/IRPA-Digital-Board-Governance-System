const {onCall,HttpsError}=require("firebase-functions/v2/https");
const logger=require("firebase-functions/logger");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("crypto");
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
 try{
 if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 if(!meetingId||!participantId)throw new HttpsError("invalid-argument","Meeting and participant are required.");
 const meetingSnap=await db.collection("meetings").doc(meetingId).get();
 const participantSnap=await db.collection("participants").doc(participantId).get();
 if(!meetingSnap.exists||!participantSnap.exists)throw new HttpsError("not-found","Meeting or participant was not found.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()},participant={id:participantSnap.id,...participantSnap.data()};
 if(participant.meetingId!==meetingId)throw new HttpsError("failed-precondition","Participant is not linked to the selected meeting.");
 const chair=String(meeting.chairpersonEmail||"").toLowerCase()===String(request.auth.token.email||"").toLowerCase();
 const secretary=String(meeting.secretaryEmail||"").toLowerCase()===String(request.auth.token.email||"").toLowerCase();
 const isAdmin=await activeAdmin(request);
 // A meeting initiator is already recorded on the authoritative meeting register only after
 // the meeting-registration rules accept the authorised registrar. Allow that same initiator
 // to dispatch invitations for their own meeting; do not force all dispatch work through admin.
 const initiator=text(meeting.initiatorUid)===uid;
 if(!isAdmin&&!chair&&!secretary&&!initiator)throw new HttpsError("permission-denied","Only the authorised meeting initiator, administrator, chairperson or secretary may issue meeting access.");
 const raw=crypto.randomBytes(32).toString("base64url");
 const meetingPassword=gatePassword();
 const tokenHash=hash(raw),passwordHash=hash(meetingPassword);
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
 await db.runTransaction(async tx=>{const latest=await tx.get(meetingSnap.ref);if(!latest.exists)throw new HttpsError("not-found","The meeting record no longer exists.");const current=latest.data()||{};const ids=Array.isArray(current.invitedParticipantIds)?current.invitedParticipantIds.map(String):[];const nextIds=[...new Set([...ids,participantId])];const invitedEmails=new Set(Array.isArray(current.invitedEmails)?current.invitedEmails.map(v=>text(v).toLowerCase()).filter(Boolean):[]);const participantEmails=new Set(Array.isArray(current.participantEmails)?current.participantEmails.map(v=>text(v).toLowerCase()).filter(Boolean):[]);const participantEmail=text(participant.participantEmail||participant.email).toLowerCase();if(participantEmail){invitedEmails.add(participantEmail);participantEmails.add(participantEmail);}const patch={invitedParticipantIds:nextIds,invitedParticipantCount:nextIds.length,invitedEmails:[...invitedEmails],participantEmails:[...participantEmails],updatedAt:FieldValue.serverTimestamp()};const participantUid=text(participant.participantUid||participant.uid||participant.userId);if(participantUid){patch.invitedUids=FieldValue.arrayUnion(participantUid);patch.participantUids=FieldValue.arrayUnion(participantUid);}tx.set(meetingSnap.ref,patch,{merge:true});});
 return {ok:true,accessId:ref.id,accessToken:raw,meetingId,meetingPassword,participantId,participantName:text(participant.participantName||participant.name)||text(participant.email),meetingReference:text(meeting.reference||meeting.title),meetingCategory:text(meeting.meetingCategory||meeting.category||meeting.meetingType||"General Meeting"),reusable:true,reusePolicy:"Reusable for 30 days, or until revoked or the meeting is closed.",expiresAt:expiresAt.toISOString()};
 }catch(error){
  logger.error("MEETING_INVITATION_ACCESS_ISSUE_FAILED",{actorUid:uid||null,meetingId:meetingId||null,participantId:participantId||null,errorCode:String(error?.code||""),errorMessage:String(error?.message||error).slice(0,300),stack:String(error?.stack||"").slice(0,1600)});
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
 if(grant.status!=="Active"||grant.expiresAt?.toDate?.()<new Date())throw new HttpsError("permission-denied","This meeting access link has expired or been revoked.");
 if(grant.passwordHash&&hash(suppliedPassword)!==grant.passwordHash)throw new HttpsError("permission-denied","The meeting ID and gate password do not match the issued gate pass.");
 const participantSnap=await db.collection("participants").doc(grant.participantId).get();
 const participant=participantSnap.exists?participantSnap.data():{};
 const boundEmail=text(grant.participantEmail).toLowerCase(),boundUid=text(grant.participantUid);
 if((boundUid&&boundUid!==uid)||(!boundUid&&boundEmail&&boundEmail!==email))throw new HttpsError("permission-denied","This meeting link is assigned to a different participant identity.");
 const meetingSnap=await db.collection("meetings").doc(grant.meetingId).get();
 if(!meetingSnap.exists)throw new HttpsError("not-found","The meeting record no longer exists.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()};
 if(!active(meeting.status))throw new HttpsError("failed-precondition","This meeting is closed and cannot be entered.");
 await db.collection("audit").add({action:"MEETING_ENTRY_AUTHORIZED",collection:"meetingAccessTokens",recordId:doc.id,details:{meetingId:grant.meetingId,participantId:grant.participantId,gateway:"IRPA Meeting Entry Gateway"},actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()});
 return {ok:true,meetingId:grant.meetingId,participantId:grant.participantId,meetingReference:grant.meetingReference||meeting.reference||meeting.title,meetingCategory:text(meeting.meetingCategory||meeting.category||meeting.meetingType||"General Meeting"),meetingStatus:meeting.status||"Scheduled",participantName:text(participant.participantName||participant.name)||email};
});