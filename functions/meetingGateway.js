const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("crypto");
const db=getFirestore();

function text(v){return String(v??"").trim();}
function hash(v){return crypto.createHash("sha256").update(String(v)).digest("hex");}
function active(status){return !["cancelled","canceled","completed","archived","closed"].includes(text(status||"Scheduled").toLowerCase());}
function admin(request){return request.auth?.token?.admin===true||text(request.auth?.token?.email).toLowerCase()==="irpa@gmail.com"||text(request.auth?.token?.email).toLowerCase()==="irpa2412@gmail.com";}

exports.createMeetingAccessInvitation=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid;
 if(!uid)throw new HttpsError("unauthenticated","Authentication is required.");
 const meetingId=text(request.data?.meetingId),participantId=text(request.data?.participantId);
 if(!meetingId||!participantId)throw new HttpsError("invalid-argument","Meeting and participant are required.");
 const meetingSnap=await db.collection("meetings").doc(meetingId).get();
 const participantSnap=await db.collection("participants").doc(participantId).get();
 if(!meetingSnap.exists||!participantSnap.exists)throw new HttpsError("not-found","Meeting or participant was not found.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()},participant={id:participantSnap.id,...participantSnap.data()};
 if(participant.meetingId!==meetingId)throw new HttpsError("failed-precondition","Participant is not linked to the selected meeting.");
 const chair=String(meeting.chairpersonEmail||"").toLowerCase()===String(request.auth.token.email||"").toLowerCase();
 const secretary=String(meeting.secretaryEmail||"").toLowerCase()===String(request.auth.token.email||"").toLowerCase();
 if(!admin(request)&&!chair&&!secretary)throw new HttpsError("permission-denied","Only an authorised meeting administrator, chairperson or secretary may issue meeting access.");
 const raw=crypto.randomBytes(32).toString("base64url");
 const tokenHash=hash(raw);
 const ref=db.collection("meetingAccessTokens").doc();
 const reusableUntilMeetingClosure=true;
 await ref.set({
  meetingId,meetingReference:text(meeting.reference||meeting.title),participantId,
  participantEmail:text(participant.participantEmail||participant.email).toLowerCase()||null,
  participantUid:text(participant.participantUid)||null,
  tokenHash,tokenVersion:"1",status:"Active",reusable:true,reusableUntilMeetingClosure,
  createdByUid:uid,createdAt:FieldValue.serverTimestamp(),
  gateway:"IRPA Meeting Entry Gateway",singlePurpose:"Live meeting entry"
 });
 return {ok:true,accessToken:raw,reusable:true,reusePolicy:"Reusable until revoked or the meeting is closed.",meetingId,participantId,meetingReference:text(meeting.reference||meeting.title)};
});

exports.authorizeMeetingEntry=onCall({region:"us-central1",timeoutSeconds:30},async request=>{
 const uid=request.auth?.uid,email=text(request.auth?.token?.email).toLowerCase();
 if(!uid||!email)throw new HttpsError("unauthenticated","Sign in before entering the meeting.");
 const token=text(request.data?.accessToken);
 if(!token)throw new HttpsError("invalid-argument","Meeting access token is required.");
 const snap=await db.collection("meetingAccessTokens").where("tokenHash","==",hash(token)).limit(1).get();
 if(snap.empty)throw new HttpsError("permission-denied","This meeting access link is invalid.");
 const doc=snap.docs[0],grant={id:doc.id,...doc.data()};
 if(grant.status!=="Active")throw new HttpsError("permission-denied","This meeting access link has been revoked.");
 const participantSnap=await db.collection("participants").doc(grant.participantId).get();
 const participant=participantSnap.exists?participantSnap.data():{};
 const boundEmail=text(grant.participantEmail).toLowerCase();
 const boundUid=text(grant.participantUid);
 if((boundUid&&boundUid!==uid)||(!boundUid&&boundEmail&&boundEmail!==email))throw new HttpsError("permission-denied","This meeting link is assigned to a different participant identity.");
 const meetingSnap=await db.collection("meetings").doc(grant.meetingId).get();
 if(!meetingSnap.exists)throw new HttpsError("not-found","The meeting record no longer exists.");
 const meeting={id:meetingSnap.id,...meetingSnap.data()};
 if(!active(meeting.status))throw new HttpsError("failed-precondition","This meeting is closed and cannot be entered.");
 await db.collection("audit").add({action:"MEETING_ENTRY_AUTHORIZED",collection:"meetingAccessTokens",recordId:doc.id,details:{meetingId:grant.meetingId,participantId:grant.participantId,gateway:"IRPA Meeting Entry Gateway"},actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()});
 return {ok:true,meetingId:grant.meetingId,participantId:grant.participantId,meetingReference:grant.meetingReference||meeting.reference||meeting.title,meetingStatus:meeting.status||"Scheduled",participantName:text(participant.participantName||participant.name)||email};
});
