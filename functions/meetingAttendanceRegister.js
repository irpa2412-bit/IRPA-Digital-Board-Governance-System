const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const crypto=require("crypto");
const db=getFirestore();
const text=v=>String(v??"").trim();
const normalized=v=>text(v).normalize("NFKC").replace(/\s+/g," ").toLocaleLowerCase();
const isAdmin=req=>req.auth?.token?.admin===true||text(req.auth?.token?.email).toLowerCase()==="irpa2412@gmail.com";
const terminal=new Set(["completed","closed","cancelled","canceled","archived"]);
const registeredName=p=>text(p.name||p.participantName||p.fullName||p.displayName);
const registeredEmail=p=>text(p.email||p.participantEmail||p.invitedEmail||p.subscriberEmail).toLowerCase();
const registeredUid=p=>[p.uid,p.userId,p.participantUid,p.memberUid,p.invitedUid].map(text).filter(Boolean);
const signatureId=(meetingId,participantId)=>crypto.createHash("sha256").update(meetingId+"\0"+participantId).digest("hex");
function canManage(req,m){
 const uid=req.auth.uid,email=text(req.auth.token.email).toLowerCase();
 return isAdmin(req)||[m.initiatorUid,m.chairpersonUid,m.secretaryUid,m.createdByUid].map(text).includes(uid)||
   !!email&&[m.initiatorEmail,m.chairpersonEmail,m.secretaryEmail].map(v=>text(v).toLowerCase()).includes(email);
}
async function getMeeting(req,meetingId){
 if(!req.auth?.uid)throw new HttpsError("unauthenticated","Sign in before accessing the attendance register.");
 if(!meetingId)throw new HttpsError("invalid-argument","Meeting ID is required.");
 const snap=await db.collection("meetings").doc(meetingId).get();
 if(!snap.exists)throw new HttpsError("not-found","Meeting not found.");
 return {id:snap.id,...snap.data()};
}
async function getParticipant(meetingId,participantId){
 if(!participantId)throw new HttpsError("invalid-argument","Your registered participant record is required.");
 const snap=await db.collection("participants").doc(participantId).get();
 if(!snap.exists||text(snap.data()?.meetingId)!==meetingId)throw new HttpsError("permission-denied","The participant record does not belong to this meeting.");
 const p={id:snap.id,...snap.data()};
 if(["cancelled","canceled","revoked","removed","inactive","closed"].includes(text(p.status||p.registrationStatus).toLowerCase()))throw new HttpsError("failed-precondition","This participant registration is inactive.");
 return p;
}
function matchesIdentity(req,p){
 const uid=req.auth.uid,email=text(req.auth.token.email).toLowerCase();
 return registeredUid(p).includes(uid)||!!email&&[p.email,p.participantEmail,p.invitedEmail,p.subscriberEmail].some(v=>text(v).toLowerCase()===email);
}
async function audit(req,meeting,p,signatureRef){
 await db.collection("audit").add({
  action:"MEETING_ATTENDANCE_SIGNED",collection:"meetingAttendanceSignatures",recordId:signatureRef.id,
  details:{meetingId:meeting.id,participantId:p.id,meetingReference:text(meeting.meetingReference||meeting.reference||meeting.title),signatureVersion:"1.0",signatureMethod:"AUTHENTICATED_TYPED_NAME_ATTESTATION"},
  actorUid:req.auth.uid,actorEmail:text(req.auth.token.email)||null,createdAt:FieldValue.serverTimestamp()
 });
}
exports.signMeetingAttendance=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const meetingId=text(req.data?.meetingId),participantId=text(req.data?.participantId),typedName=text(req.data?.typedName);
 if(req.data?.confirmed!==true)throw new HttpsError("failed-precondition","Confirm the attendance declaration before signing.");
 if(!typedName||typedName.length>200)throw new HttpsError("invalid-argument","Enter your registered full name (maximum 200 characters).");
 const meeting=await getMeeting(req,meetingId);
 if(terminal.has(text(meeting.status).toLowerCase()))throw new HttpsError("failed-precondition","Attendance signing is closed for this meeting.");
 const p=await getParticipant(meetingId,participantId);
 if(!matchesIdentity(req,p))throw new HttpsError("permission-denied","You may sign only your own registered participant record.");
 const expected=registeredName(p);
 if(!expected||normalized(typedName)!==normalized(expected))throw new HttpsError("failed-precondition","The typed signature must match the name in your meeting registration. Ask the meeting secretary to correct the registration if it is wrong.");
 const ref=db.collection("meetingAttendanceSignatures").doc(signatureId(meetingId,participantId));
 const existing=await ref.get();
 if(existing.exists)return {signed:true,alreadySigned:true,signatureId:ref.id,participantId,signedAt:existing.data()?.signedAt?.toDate?.()?.toISOString()||null};
 const signature={
  meetingId,participantId,meetingReference:text(meeting.meetingReference||meeting.reference||meeting.title)||null,
  participantName:expected,participantRole:text(p.role||p.participantRole||p.participantType)||null,
  signerUid:req.auth.uid,signerEmail:text(req.auth.token.email).toLowerCase()||null,
  typedName:expected,signatureMethod:"AUTHENTICATED_TYPED_NAME_ATTESTATION",
  declaration:"I confirm that I am the registered participant and that this signature records my attendance at this meeting.",
  signatureVersion:"1.0",signedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp()
 };
 await ref.create(signature);
 await audit(req,meeting,p,ref);
 return {signed:true,alreadySigned:false,signatureId:ref.id,participantId,signedAt:new Date().toISOString()};
});
exports.getMeetingAttendanceRegister=onCall({region:"us-central1",timeoutSeconds:30},async req=>{
 const meetingId=text(req.data?.meetingId);
 const meeting=await getMeeting(req,meetingId);
 const manager=canManage(req,meeting);
 const [participantSnap,signatureSnap]=await Promise.all([
  db.collection("participants").where("meetingId","==",meetingId).get(),
  db.collection("meetingAttendanceSignatures").where("meetingId","==",meetingId).get()
 ]);
 const signatures=new Map(signatureSnap.docs.map(d=>[text(d.data()?.participantId),{id:d.id,...d.data(),signedAt:d.data()?.signedAt?.toDate?.()?.toISOString()||null}]));
 const ownEmail=text(req.auth.token.email).toLowerCase();
 const records=participantSnap.docs.map(d=>({id:d.id,...d.data()}))
  .filter(p=>manager||matchesIdentity(req,p))
  .map(p=>{
   const sig=signatures.get(p.id);
   return {participantId:p.id,name:registeredName(p),role:text(p.role||p.participantRole||p.participantType),email:registeredEmail(p),attendanceStatus:text(p.attendanceStatus||p.status)||"Unmarked",signed:!!sig,signatureMethod:sig?.signatureMethod||null,typedName:sig?.typedName||null,signedAt:sig?.signedAt||null,signatureId:sig?.id||null};
  }).filter(p=>manager||p.email===ownEmail||participantSnap.docs.some(d=>d.id===p.participantId&&matchesIdentity(req,{id:d.id,...d.data()})));
 return {meetingId,meetingReference:text(meeting.meetingReference||meeting.reference||meeting.title),meetingTitle:text(meeting.title),meetingDate:text(meeting.date),retrievedAt:new Date().toISOString(),canManage:manager,records};
});
