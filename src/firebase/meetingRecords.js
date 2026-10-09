import {getFunctions,httpsCallable} from "firebase/functions";
const call=name=>httpsCallable(getFunctions(undefined,"us-central1"),name);
export async function captureMeetingRecord(payload){const r=await call("captureMeetingRecord")(payload);return r.data;}
export async function listMeetingRecords(meetingId){const r=await call("listMeetingRecords")({meetingId});return r.data?.records||[];}
export async function retrieveMeetingRecord(recordId){const r=await call("retrieveMeetingRecord")({recordId});return r.data?.record||null;}
export async function updateMeetingRecordProtection(payload){const r=await call("updateMeetingRecordProtection")(payload);return r.data;}
export async function disposeMeetingRecord(payload){const r=await call("disposeMeetingRecord")(payload);return r.data;}
