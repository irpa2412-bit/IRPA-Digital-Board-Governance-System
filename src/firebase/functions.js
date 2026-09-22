import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./config";

export async function createAdministrator({ name, email, onProgress }){
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const actor = auth.currentUser;

  if(!actor) throw new Error("Administrator authentication is required. Please sign in again.");
  if(!cleanName) throw new Error("The new administrator's name is required.");
  if(!cleanEmail || !cleanEmail.includes("@")) throw new Error("A valid administrator email address is required.");
  if(cleanEmail === String(actor.email || "").trim().toLowerCase()) {
    throw new Error("The current administrator is already an administrator.");
  }

  try {
    onProgress?.("Creating the Administrator invitation securely…");

    const invitation = await addDoc(collection(db, "adminInvitations"), {
      email: cleanEmail,
      name: cleanName,
      role: "Administrator",
      status: "Pending",
      createdByUid: actor.uid,
      createdByEmail: actor.email || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    onProgress?.("Administrator invitation created. Sending the secure activation link…");

    // Firebase Authentication sends the activation link directly. No
    // Cloud Function is required, so the Administrator pathway remains
    // available on projects using Firebase's no-cost hosting/Firestore tier.
    const { sendAdminMagicLink } = await import("./auth");
    await sendAdminMagicLink(cleanEmail, invitation.id);

    onProgress?.("Administrator activation link sent.");
    return {
      ok: true,
      uid: null,
      email: cleanEmail,
      name: cleanName,
      accountCreated: false,
      emailRequested: true,
      invitationId: invitation.id
    };
  } catch(error){
    const code = String(error?.code || "").replace(/^firestore\//, "").replace(/^auth\//, "");
    const messages = {
      "permission-denied": "Firebase denied creation of the Administrator invitation. Confirm that the current account is an active Administrator.",
      "unauthenticated": "Administrator authentication is required. Please sign in again.",
      "invalid-argument": "Please enter a valid administrator name and email address.",
      "unavailable": "Firebase is temporarily unavailable. Please retry the Administrator invitation.",
      "auth/unauthorized-continue-uri": "Firebase Authentication rejected the activation-link destination. The IRPA web application domain must be listed under Firebase Authentication → Settings → Authorized domains.",
      "auth/invalid-continue-uri": "Firebase Authentication rejected the activation-link destination. Check the Firebase Authentication authorized domains."
    };
    throw new Error(messages[code] || error?.message || "Unable to add the Administrator.");
  }
}
