import {getFunctions,httpsCallable} from "firebase/functions";
import {collection,doc,getDocs,query,serverTimestamp,where,writeBatch} from "firebase/firestore";
import {auth,db} from "./config";
const call=name=>httpsCallable(getFunctions(undefined,"us-central1"),name);
export async function captureMeetingRecord(payload){const r=await call("captureMeetingRecord")(payload);return r.data;}
export async function saveMeetingAssistantDraft(payload){const r=await call("saveMeetingAssistantDraft")(payload);return r.data;}
export async function listMeetingRecords(meetingId){const r=await call("listMeetingRecords")({meetingId});return r.data?.records||[];}
export async function retrieveMeetingRecord(recordId){const r=await call("retrieveMeetingRecord")({recordId});return r.data?.record||null;}
export async function updateMeetingRecordProtection(payload){const r=await call("updateMeetingRecordProtection")(payload);return r.data;}
export async function disposeMeetingRecord(payload){const r=await call("disposeMeetingRecord")(payload);return r.data;}
export async function startMeetingRecording(payload){const r=await call("startMeetingRecording")(payload);return r.data;}
export async function stopMeetingRecording(payload){const r=await call("stopMeetingRecording")(payload);return r.data;}
export async function getMeetingRecordingStatus(meetingId){const r=await call("getMeetingRecordingStatus")({meetingId});return r.data;}

export async function compileAndEmailMeetingReport(payload){const r=await call("compileAndEmailMeetingReport")(payload);return r.data;}

export async function saveLiveMeetingProceedings(payload){const r=await call("saveLiveMeetingProceedings")(payload);return r.data;}


export async function registerMeetingWorkingDocument(payload){const r=await call("registerMeetingWorkingDocument")(payload);return r.data;}
export async function listMeetingWorkingDocuments(meetingId){const r=await call("listMeetingWorkingDocuments")({meetingId});return r.data?.documents||[];}
export async function submitMeetingDocumentReview(payload){const r=await call("submitMeetingDocumentReview")(payload);return r.data;}

const attendanceSignatureName=p=>String(p?.name||p?.participantName||p?.fullName||p?.displayName||"").trim();
const attendanceSignatureIdentity=(p,user)=>{const uid=String(user?.uid||""),email=String(user?.email||"").trim().toLowerCase();return [p?.uid,p?.userId,p?.participantUid,p?.memberUid,p?.invitedUid].some(v=>String(v||"")===uid)||(!!email&&[p?.email,p?.participantEmail,p?.invitedEmail,p?.subscriberEmail].some(v=>String(v||"").trim().toLowerCase()===email));};
export async function signMeetingAttendance({meetingId,participantId,typedName,confirmed}){
 const user=auth.currentUser;if(!user)throw new Error("Sign in before signing the attendance register.");
 if(confirmed!==true)throw new Error("Confirm the attendance declaration before signing.");
 const participantRef=doc(db,"participants",String(participantId||""));
 const {getDoc}=await import("firebase/firestore");
 const participantSnap=await getDoc(participantRef);
 if(!participantSnap.exists()||String(participantSnap.data()?.meetingId||"")!==String(meetingId||""))throw new Error("Your registered participant record is unavailable for this meeting.");
 const p={id:participantSnap.id,...participantSnap.data()};
 if(!attendanceSignatureIdentity(p,user))throw new Error("You may sign only your own registered participant record.");
 const expected=attendanceSignatureName(p),entered=String(typedName||"").trim().replace(/\s+/g," ").toLocaleLowerCase();
 if(!expected||entered!==expected.replace(/\s+/g," ").toLocaleLowerCase())throw new Error("The typed signature must match the name in your meeting registration.");
 const {getDoc:readDoc}=await import("firebase/firestore");
 const {getDoc:readMeeting}=await import("firebase/firestore");
 const meetingSnap=await readMeeting(doc(db,"meetings",meetingId));
 if(!meetingSnap.exists())throw new Error("Meeting not found.");
 if(["completed","closed","cancelled","canceled","archived"].includes(String(meetingSnap.data()?.status||"").toLowerCase()))throw new Error("Attendance signing is closed for this meeting.");
 const signatureId=String(meetingId)+"__"+String(participantId);
 const signatureRef=doc(db,"meetingAttendanceSignatures",signatureId);
 const batch=writeBatch(db);
 batch.update(participantRef,{attendanceStatus:"Present",attendanceRecordedAt:serverTimestamp(),attendanceRecordedByUid:user.uid,updatedAt:serverTimestamp()});
 batch.set(signatureRef,{meetingId,participantId,meetingReference:String(meetingSnap.data()?.meetingReference||meetingSnap.data()?.reference||meetingSnap.data()?.title||""),participantName:expected,participantRole:String(p.role||p.participantRole||p.participantType||""),signerUid:user.uid,signerEmail:String(user.email||"").trim().toLowerCase(),typedName:expected,signatureMethod:"AUTHENTICATED_TYPED_NAME_ATTESTATION",declaration:"I confirm that I am the registered participant and that this signature records my attendance at this meeting.",signatureVersion:"1.0",signedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedByUid:user.uid,updatedByEmail:String(user.email||"").trim().toLowerCase()});
 try{await batch.commit();return{signed:true,alreadySigned:false,signatureId,participantId};}
 catch(error){
  try{const existing=await readDoc(signatureRef);if(existing.exists()&&String(existing.data()?.signerUid||"")===user.uid)return{signed:true,alreadySigned:true,signatureId,participantId,signedAt:existing.data()?.signedAt?.toDate?.()?.toISOString()||null};}catch{}
  throw error;
 }
}
export async function getMeetingAttendanceRegister(meetingId,{canManage=false}={}){
 const user=auth.currentUser;if(!user)throw new Error("Sign in to retrieve the attendance register.");
 const participantsSnap=await getDocs(query(collection(db,"participants"),where("meetingId","==",meetingId)));
 const signatureConstraints=[where("meetingId","==",meetingId)];
 if(!canManage)signatureConstraints.push(where("signerUid","==",user.uid));
 const signaturesSnap=await getDocs(query(collection(db,"meetingAttendanceSignatures"),...signatureConstraints));
 const signatures=new Map(signaturesSnap.docs.map(s=>[String(s.data()?.participantId||""),{id:s.id,...s.data(),signedAt:s.data()?.signedAt?.toDate?.()?.toISOString()||null}]));
 const records=participantsSnap.docs.map(d=>{const p={id:d.id,...d.data()},sig=signatures.get(d.id);return{participantId:d.id,name:attendanceSignatureName(p),role:String(p.role||p.participantRole||p.participantType||""),email:String(p.email||p.participantEmail||p.invitedEmail||p.subscriberEmail||""),attendanceStatus:String(p.attendanceStatus||p.status||"Unmarked"),signed:!!sig,signatureMethod:sig?.signatureMethod||null,typedName:sig?.typedName||null,signedAt:sig?.signedAt||null,signatureId:sig?.id||null};});
 return{meetingId,records};
}
