import {getFunctions,httpsCallable} from "firebase/functions";
import {auth} from "./config";
const liveKitRecordingWorker=String(import.meta.env.VITE_LIVEKIT_RECORDING_WORKER_URL||"").trim().replace(/\/+$/,"");
async function callLiveKitRecordingWorker(path,payload){
 if(!liveKitRecordingWorker)return null;
 if(!auth.currentUser)throw new Error("Sign in to IRPA before controlling meeting recording.");
 const token=await auth.currentUser.getIdToken();
 const response=await fetch(liveKitRecordingWorker+path,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok!==true)throw new Error(data.message||data.error||"The LiveKit recording operation failed.");
 return data;
}
const call=name=>httpsCallable(getFunctions(undefined,"us-central1"),name);
export async function captureMeetingRecord(payload){const r=await call("captureMeetingRecord")(payload);return r.data;}
export async function saveMeetingAssistantDraft(payload){const r=await call("saveMeetingAssistantDraft")(payload);return r.data;}
export async function listMeetingRecords(meetingId){const r=await call("listMeetingRecords")({meetingId});return r.data?.records||[];}
export async function retrieveMeetingRecord(recordId){const r=await call("retrieveMeetingRecord")({recordId});return r.data?.record||null;}
export async function updateMeetingRecordProtection(payload){const r=await call("updateMeetingRecordProtection")(payload);return r.data;}
export async function disposeMeetingRecord(payload){const r=await call("disposeMeetingRecord")(payload);return r.data;}
export async function startMeetingRecording(payload){const worker=await callLiveKitRecordingWorker("/recording/start",payload);if(worker)return worker;const r=await call("startMeetingRecording")(payload);return r.data;}
export async function stopMeetingRecording(payload){const worker=await callLiveKitRecordingWorker("/recording/stop",payload);if(worker)return worker;const r=await call("stopMeetingRecording")(payload);return r.data;}
export async function getMeetingRecordingStatus(meetingId){const worker=await callLiveKitRecordingWorker("/recording/status",{meetingId});if(worker)return worker;const r=await call("getMeetingRecordingStatus")({meetingId});return r.data;}

export async function compileAndEmailMeetingReport(payload){const r=await call("compileAndEmailMeetingReport")(payload);return r.data;}

export async function saveLiveMeetingProceedings(payload){const r=await call("saveLiveMeetingProceedings")(payload);return r.data;}


export async function registerMeetingWorkingDocument(payload){const r=await call("registerMeetingWorkingDocument")(payload);return r.data;}
export async function listMeetingWorkingDocuments(meetingId){const r=await call("listMeetingWorkingDocuments")({meetingId});return r.data?.documents||[];}
export async function submitMeetingDocumentReview(payload){const r=await call("submitMeetingDocumentReview")(payload);return r.data;}
