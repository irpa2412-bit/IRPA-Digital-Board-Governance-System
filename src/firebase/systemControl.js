import { auth } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getIdToken } from "firebase/auth";
import { getGoogleDriveGatewayUrl } from "./gatewayUrl";

const functions = getFunctions(undefined, "us-central1");
export const requestDataReset = async data => (await httpsCallable(functions, "requestDataReset")(data)).data;
export const cancelDataReset = async data => (await httpsCallable(functions, "cancelDataReset")(data)).data;
export const executeDataReset = async data => (await httpsCallable(functions, "executeDataReset")(data)).data;
export const getDataResetStatus = async data => (await httpsCallable(functions, "getDataResetStatus")(data)).data;

async function actualDataGateway(method, data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Step Firebase authentication failed: sign in again.");
  const gateway = getGoogleDriveGatewayUrl();
  if (!gateway) throw new Error("Step gateway configuration failed: VITE_GOOGLE_DRIVE_GATEWAY_URL is missing.");
  let response;
  try {
    response = await fetch(gateway + "/api/system/actual-data-access", {
      method,
      headers: { Authorization: "Bearer " + await getIdToken(user), "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(data) } : {})
    });
  } catch (error) {
    throw new Error("Step Worker request failed: " + String(error?.message || error));
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error("Step " + (result.step || "Worker response") + " failed: " + (result.error || ("HTTP " + response.status)));
  }
  return result;
}

export const getActualDataAccessStatus = async () => actualDataGateway("GET");
export const setActualDataAccess = async data => actualDataGateway("POST", data);
