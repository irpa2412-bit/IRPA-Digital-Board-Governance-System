import { auth } from "./config";
import { getGoogleDriveGatewayUrl } from "./gatewayUrl";

const gateway = () => getGoogleDriveGatewayUrl();

export async function callMeetingService(path, payload = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before using meeting services.");
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${gateway()}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error("The IRPA meeting gateway could not be reached. Check your connection and retry.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Meeting gateway request failed (${response.status}).`);
  }
  return data;
}

export const createMeetingAccessInvitation = payload => callMeetingService("/api/meeting-access/issue", payload);
export const revokeMeetingAccessInvitation = payload => callMeetingService("/api/meeting-access/revoke", payload);
export const authorizeMeetingEntry = payload => callMeetingService("/api/meeting-access/authorize", payload);
export const dispatchMeetingInvitation = payload => callMeetingService("/api/meeting-invitations/dispatch", payload);
export const issueLiveMeetingToken = payload => callMeetingService("/api/meeting-media/token", payload);

export const getMeetingRoomActivity = meetingId => callMeetingService("/api/meeting-room/activity", { meetingId });
export const getMyMeetingSubscriptions = async () => (await callMeetingService("/api/meeting-subscriptions/mine")).subscriptions || [];
export const getAccessibleMeetingRecords = async () => (await callMeetingService("/api/meeting-register/list")).meetings || [];

export const assessMeetingQuorum = payload => callMeetingService("/api/meeting-quorum/assess", payload);

export const listMeetingBoardMembers = async () => (await callMeetingService("/api/meeting-board-register/list")).boardMembers || [];

export const listMeetingInviteeDirectory = async () => callMeetingService("/api/meeting-invitee-directory/list");
export const listMeetingPeople = async () => {
  const directory = await listMeetingInviteeDirectory();
  const rows = [...(Array.isArray(directory.members) ? directory.members : []), ...(Array.isArray(directory.employees) ? directory.employees : [])];
  const seen = new Set();
  return rows.filter(row => {
    const uid = String(row.uid || "").trim();
    if (!uid || seen.has(uid)) return false;
    seen.add(uid);
    return true;
  }).map(row => ({ ...row, uid: String(row.uid).trim(), name: String(row.name || row.email || row.uid), email: String(row.email || "").toLowerCase() }));
};
