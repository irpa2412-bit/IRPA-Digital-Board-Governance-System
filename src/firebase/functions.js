
import { auth, db } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";

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
    await sendAdminMagicLink(cleanEmail);

    onProgress?.("Administrator activation link sent.");
    return { ...(result.data || {}), ok: true, email: cleanEmail, name: cleanName, emailRequested: true };
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
export async function listAdministrators(){
  const actor=auth.currentUser;
  if(!actor) throw new Error("Administrator authentication is required.");
  try{
    // Administrator profiles are already protected by Firestore rules. Reading the
    // register directly keeps this portal independent of newly deployed Functions.
    const snap=await getDocs(query(collection(db,"adminProfiles"),where("active","==",true)));
    return snap.docs.map(d=>({
      uid:d.id,
      email:String(d.data()?.email||"").trim().toLowerCase(),
      name:String(d.data()?.name||"").trim(),
      role:d.data()?.role||"Administrator",
      active:d.data()?.active===true,
      primary:String(d.data()?.email||"").trim().toLowerCase()==="irpa2412@gmail.com"
    })).sort((a,b)=>Number(b.primary)-Number(a.primary)||a.name.localeCompare(b.name));
  }catch(error){
    const code=String(error?.code||"");
    if(code.includes("permission-denied")) throw new Error("Administrator authorization is required to view the Administrator register.");
    throw new Error(error?.message||"Unable to load the Administrator register.");
  }
}
export async function removeAdministrator(uid){
  const actor=auth.currentUser;
  if(!actor) throw new Error("Administrator authentication is required.");
  if(!uid) throw new Error("Select an Administrator to remove.");
  if(uid===actor.uid) throw new Error("You cannot remove your own Administrator access.");

  const targetRef=doc(db,"adminProfiles",uid);
  const targetSnap=await getDoc(targetRef);
  if(!targetSnap.exists()) throw new Error("The selected Administrator was not found.");
  const target=targetSnap.data()||{};
  const targetEmail=String(target.email||"").trim().toLowerCase();
  if(targetEmail==="irpa2412@gmail.com") throw new Error("The primary IRPA Administrator cannot be removed.");
  if(target.active!==true) return {ok:true,uid,email:targetEmail,alreadyRemoved:true};

  // Firestore rules make an active Administrator the authorizer and prevent
  // self-removal. The same transaction records the immutable audit event.
  const batch=writeBatch(db);
  batch.update(targetRef,{
    active:false,
    removedAt:serverTimestamp(),
    removedByUid:actor.uid,
    removedByEmail:String(actor.email||"").trim().toLowerCase()||null,
    updatedAt:serverTimestamp()
  });
  const auditRef=doc(collection(db,"audit"));
  batch.set(auditRef,{
    action:"ADMINISTRATOR_REMOVED",
    collection:"adminProfiles",
    recordId:uid,
    details:{targetEmail,targetUid:uid,removedByUid:actor.uid,removedByEmail:String(actor.email||"").trim().toLowerCase()||null},
    actorUid:actor.uid,
    actorEmail:String(actor.email||"").trim().toLowerCase()||null,
    createdAt:serverTimestamp()
  });
  try{
    await batch.commit();
    return {ok:true,uid,email:targetEmail,name:target.name||"",removed:true};
  }catch(error){
    const code=String(error?.code||"");
    if(code.includes("permission-denied")) throw new Error("Firebase denied Administrator removal. Confirm that the current account is an active Administrator.");
    throw new Error(error?.message||"Administrator removal failed. No change was confirmed.");
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
