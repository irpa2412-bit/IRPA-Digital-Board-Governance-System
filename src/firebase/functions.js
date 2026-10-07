
import { auth, db } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";

export async function createAdministrator({ name, email, onProgress }){
  const cleanName=String(name||"").trim();
  const cleanEmail=String(email||"").trim().toLowerCase();
  const actor=auth.currentUser;
  if(!actor) throw new Error("Administrator authentication is required. Please sign in again.");
  if(!cleanName) throw new Error("The new administrator's name is required.");
  if(!cleanEmail || !cleanEmail.includes("@")) throw new Error("A valid administrator email address is required.");
  if(cleanEmail===String(actor.email||"").trim().toLowerCase()) throw new Error("The current administrator is already an administrator.");

  try{
    // This is the inverse of Administrator removal: create a controlled
    // invitation record first, then let the recipient's secure email-link
    // activation create/reactivate the adminProfiles record. No Cloud Function
    // is required for the browser command.
    onProgress?.("Checking the Administrator register…");
    const activeSnap=await getDocs(query(collection(db,"adminProfiles"),where("email","==",cleanEmail),where("active","==",true)));
    if(!activeSnap.empty) throw new Error("That email address is already an active Administrator.");

    const invitationRef=doc(collection(db,"adminInvitations"));
    const invitationId=invitationRef.id;
    onProgress?.("Registering the Administrator invitation…");
    await setDoc(invitationRef,{
      email:cleanEmail,
      name:cleanName,
      role:"Administrator",
      status:"Pending",
      createdByUid:actor.uid,
      createdByEmail:String(actor.email||"").trim().toLowerCase(),
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });

    const auditRef=doc(collection(db,"audit"));
    await setDoc(auditRef,{
      action:"ADMINISTRATOR_INVITED",
      collection:"adminInvitations",
      recordId:invitationId,
      details:{email:cleanEmail,name:cleanName,invitationId},
      actorUid:actor.uid,
      actorEmail:String(actor.email||"").trim().toLowerCase(),
      createdAt:serverTimestamp()
    });

    onProgress?.("Sending the secure Administrator activation link…");
    const {sendAdminMagicLink}=await import("./auth");
    await sendAdminMagicLink(cleanEmail,invitationId);
    onProgress?.("Administrator activation link sent.");
    return {ok:true,email:cleanEmail,name:cleanName,invitationId,emailRequested:true};
  }catch(error){
    const message=String(error?.message||"Unable to add the Administrator.");
    if(message.includes("already an active Administrator")) throw error;
    const code=String(error?.code||"");
    if(code.includes("permission-denied")) throw new Error("Firebase denied the Administrator invitation. Confirm that the current account is an active Administrator.");
    if(code.includes("unauthorized-continue-uri")||message.includes("unauthorized-continue-uri")) throw new Error("Firebase Authentication rejected the activation-link destination. Add the IRPA web application domain under Firebase Authentication → Authorized domains.");
    throw new Error(message);
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

export async function reconcileRegisteredIdentityUids(){
  const actor=auth.currentUser;
  if(!actor) throw new Error("Administrator authentication is required.");
  const functions=getFunctions(undefined,"us-central1");
  const call=httpsCallable(functions,"reconcileRegisteredIdentityUids");
  try{
    const result=await call({});
    return result.data||{};
  }catch(error){
    const code=String(error?.code||"");
    if(code.includes("permission-denied")) throw new Error("Firebase denied UID reconciliation. Confirm that the current account is an active Administrator.");
    throw new Error(error?.message||"UID reconciliation failed. No success confirmation was received.");
  }
}
