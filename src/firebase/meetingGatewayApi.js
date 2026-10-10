import { auth } from "./config";

const gateway = () => String(
  import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL ||
  "https://irpa-google-drive-gateway.irpa-governance.workers.dev"
).replace(/\/$/, "");

async function callMeetingGateway(path, payload = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before managing meeting access.");
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

export const createMeetingAccessInvitation = payload => callMeetingGateway("/api/meeting-access/issue", payload);
export const revokeMeetingAccessInvitation = payload => callMeetingGateway("/api/meeting-access/revoke", payload);
export const authorizeMeetingEntry = payload => callMeetingGateway("/api/meeting-access/authorize", payload);
