import { getFunctions, httpsCallable } from "firebase/functions";
import app from "./config";

const functions = getFunctions(app, "us-central1");

export async function createAdministrator({ name, email, onProgress }){
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if(!cleanName) throw new Error("The new administrator's name is required.");
  if(!cleanEmail || !cleanEmail.includes("@")) throw new Error("A valid administrator email address is required.");

  try{
    onProgress?.("Submitting the Administrator request securely…");
    const callable = httpsCallable(functions, "createAdministrator");
    const result = await callable({ name: cleanName, email: cleanEmail });
    const data = result?.data || {};
    onProgress?.("Administrator setup completed.");
    return {
      ok: true,
      uid: data.uid,
      email: data.email || cleanEmail,
      name: data.name || cleanName,
      accountCreated: data.accountCreated === true,
      emailRequested: data.emailRequested !== false
    };
  }catch(error){
    const code = String(error?.code || "").replace(/^functions\//, "");
    const messages = {
      unauthenticated: "Administrator authentication is required. Please sign in again.",
      "permission-denied": "Administrator authorization is required to add another Administrator.",
      "invalid-argument": "Please enter a valid administrator name and email address.",
      "failed-precondition": "The current administrator cannot add this account in its current state.",
      internal: "Firebase could not complete the Administrator setup. No silent success was recorded."
    };
    throw new Error(messages[code] || error?.message || "Unable to add the Administrator.");
  }
}
