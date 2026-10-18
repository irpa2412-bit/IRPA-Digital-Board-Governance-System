import { callMeetingService } from "./meetingGatewayApi";

export async function captureMeetingRecord(payload){return callMeetingService("/api/meeting-records/capture",payload);}
export async function saveMeetingAssistantDraft(payload){return callMeetingService("/api/meeting-records/draft",payload);}
export async function listMeetingRecords(meetingId){const r=await callMeetingService("/api/meeting-records/list",{meetingId});return r.records||[];}
export async function retrieveMeetingRecord(recordId){const r=await callMeetingService("/api/meeting-records/retrieve",{recordId});return r.record||null;}
export async function updateMeetingRecordProtection(payload){return callMeetingService("/api/meeting-records/protection",payload);}
export async function disposeMeetingRecord(payload){return callMeetingService("/api/meeting-records/dispose",payload);}
export async function startMeetingRecording(payload){return callMeetingService("/api/meeting-media/recording/start",payload);}
export async function stopMeetingRecording(payload){return callMeetingService("/api/meeting-media/recording/stop",payload);}
export async function getMeetingRecordingStatus(meetingId){return callMeetingService("/api/meeting-media/recording/status",{meetingId});}
export async function compileAndEmailMeetingReport(payload){return callMeetingService("/api/meeting-reports/compile-email",payload);}
export async function saveLiveMeetingProceedings(payload){return callMeetingService("/api/meeting-proceedings/save",payload);}
export async function translateMeetingTranscript(payload){return callMeetingService("/api/meeting-transcripts/translate",payload);}


export async function registerMeetingWorkingDocument(payload){const r=await call("registerMeetingWorkingDocument")(payload);return r.data;}
export async function listMeetingWorkingDocuments(meetingId){const r=await call("listMeetingWorkingDocuments")({meetingId});return r.data?.documents||[];}
export async function submitMeetingDocumentReview(payload){const r=await call("submitMeetingDocumentReview")(payload);return r.data;}

export async function signMeetingAttendance(payload){return callMeetingService("/api/meeting-attendance/sign",payload);}
export async function getMeetingAttendanceRegister(meetingId){return callMeetingService("/api/meeting-attendance/register",{meetingId});}
