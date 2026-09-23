
import { auth } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";

export async function createAdministrator({ name, email, onProgress }){
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const actor = auth.currentUser;

  if(!actor) throw new Error("Administrator authentication is required. Please sign in again.");
  if(!cleanName) throw new Error("The new administrator's name is required.");
  if(!cleanEmail || !cleanEmail.includes("@")) throw new Error("A valid administrator email address is required.");
  if(cleanEmail === String(actor.email || "").trim().toLowerCase()) throw new Error("The current administrator is already an administrator.");

  try {
    onProgress?.("Creating the Administrator account securely…");
    const functions = getFunctions(undefined, "us-central1");
    const call = httpsCallable(functions, "createAdministrator");
    const result = await call({ name: cleanName, email: cleanEmail });

    onProgress?.("Administrator account prepared. Sending the secure activation link…");
    const { sendAdminMagicLink } = await import("./auth");
    try {
      await sendAdminMagicLink(cleanEmail);
      onProgress?.("Administrator activation link sent.");
      return { ...(result.data || {}), ok: true, email: cleanEmail, name: cleanName, emailRequested: true, activationStatus: "sent" };
    } catch(emailError) {
      // Account creation is already committed server-side. Do not report this
      // as a failed Administrator creation, otherwise the operator may retry
      // and receive an "already exists" error for a perfectly valid account.
      const emailCode = String(emailError?.code || "").replace(/^functions\//, "").replace(/^auth\//, "");
      const emailMessage = emailError?.message || "Firebase Authentication could not request the activation email.";
      onProgress?.("Administrator account created, but the activation email could not be sent. Use Resend activation link.");
      return {
        ...(result.data || {}),
        ok: true,
        email: cleanEmail,
        name: cleanName,
        emailRequested: false,
        activationStatus: "send_failed",
        activationErrorCode: emailCode || null,
        activationError: emailMessage
      };
    }
  } catch(error){
    const code = String(error?.code || "").replace(/^functions\//, "").replace(/^auth\//, "");
    const messages = {
      "permission-denied": "Firebase denied creation of the Administrator account. Confirm that the current account is an active Administrator.",
      "unauthenticated": "Administrator authentication is required. Please sign in again.",
      "invalid-argument": "Please enter a valid administrator name and email address.",
      "already-exists": "That email address is already registered. Use the existing account or choose another administrator email address.",
      "unavailable": "Firebase is temporarily unavailable. Please retry the Administrator setup.",
      "unauthorized-continue-uri": "Firebase Authentication rejected the activation-link destination. Add the IRPA web application domain under Firebase Authentication → Authorized domains.",
      "invalid-continue-uri": "Firebase Authentication rejected the activation-link destination. Check the Firebase Authentication authorized domains."
    };
    throw new Error(messages[code] || error?.message || "Unable to add the Administrator.");
  }
}
export async function submitCredentialInterview(data){
  const functions=getFunctions(undefined,"us-central1");
  const call=httpsCallable(functions,"submitCredentialInterview");
  const result=await call(data||{});
  return result.data||{};
}
export async function getCredentialInterviewRequests(){
  const actor=auth.currentUser;
  if(!actor) throw new Error("Administrator authentication is required.");
  const functions=getFunctions(undefined,"us-central1");
  const call=httpsCallable(functions,"getCredentialInterviewRequests");
  const result=await call({});
  return result.data?.requests||[];
}
export async function approveCredentialInterview(requestId){
  const actor=auth.currentUser;
  if(!actor) throw new Error("Administrator authentication is required.");
  const functions=getFunctions(undefined,"us-central1");
  const call=httpsCallable(functions,"approveCredentialInterview");
  const result=await call({requestId});
  return result.data||{};
}
