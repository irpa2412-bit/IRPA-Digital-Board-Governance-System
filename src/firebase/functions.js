import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import app, { firebaseConfig, auth, db } from "./config";

export const functions = null;

function temporaryPassword(){
  const values = typeof crypto !== "undefined" && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint32Array(8))).map(v => v.toString(36)).join("")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `IRPA-${values}-9!aQ`;
}

async function requireAdministrator(){
  const uid = auth.currentUser?.uid;
  if(!uid) throw new Error("Administrator authentication is required.");
  const snap = await getDoc(doc(db,"adminProfiles",uid));
  if(!snap.exists() || snap.data()?.active !== true){
    throw new Error("Administrator authorization is required.");
  }
  return { uid, email: auth.currentUser?.email || snap.data()?.email || null };
}

export async function createAdministrator({ name, email }){
  const actor = await requireAdministrator();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();
  if(!cleanName) throw new Error("The new administrator's name is required.");
  if(!cleanEmail || !cleanEmail.includes("@")) throw new Error("A valid administrator email address is required.");
  if(cleanEmail === String(actor.email || "").toLowerCase()) throw new Error("The current administrator is already an administrator.");

  let targetUid = null;
  let accountCreated = false;
  let targetDisplayName = cleanName;

  const secondaryApp = initializeApp(firebaseConfig, `irpa-admin-provision-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const secondaryAuth = getAuth(secondaryApp);

  try{
    try{
      const credential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, temporaryPassword());
      targetUid = credential.user.uid;
      accountCreated = true;
    }catch(error){
      if(error?.code !== "auth/email-already-in-use") throw error;

      const adminMatch = await getDocs(query(collection(db,"adminProfiles"),where("email","==",cleanEmail)));
      if(!adminMatch.empty){
        targetUid = adminMatch.docs[0].id;
      }else{
        const memberMatch = await getDocs(query(collection(db,"members"),where("email","==",cleanEmail)));
        if(!memberMatch.empty){
          targetUid = memberMatch.docs[0].id;
        }else{
          throw new Error("An account already exists for this email, but its Firebase UID could not be safely matched to an IRPA profile. Use a new administrator email address.");
        }
      }
    }
  }catch(error){
    const code = error?.code || "";
    if(code === "auth/email-already-in-use") throw new Error("An account already exists for this email. Use the existing IRPA account or choose a new administrator email.");
    throw new Error(error?.message || "Unable to create the administrator account.");
  }finally{
    await deleteApp(secondaryApp);
  }

  const existing = await getDoc(doc(db,"adminProfiles",targetUid));
  const previous = existing.exists() ? existing.data() : {};
  targetDisplayName = cleanName || previous.name || cleanEmail.split("@")[0];

  await setDoc(doc(db,"adminProfiles",targetUid),{
    uid: targetUid,
    email: cleanEmail,
    name: targetDisplayName,
    role: "Administrator",
    active: true,
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    createdAt: previous.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  },{merge:true});

  await addDoc(collection(db,"audit"),{
    action: accountCreated ? "ADMINISTRATOR_CREATED" : "ADMINISTRATOR_ACTIVATED",
    collection: "adminProfiles",
    recordId: targetUid,
    details: { targetEmail: cleanEmail, targetUid, accountCreated },
    actorUid: actor.uid,
    actorEmail: actor.email,
    createdAt: serverTimestamp()
  });

  try{
    await sendPasswordResetEmail(auth, cleanEmail);
  }catch(error){
    throw new Error(`Administrator was created, but the activation email could not be requested: ${error?.message || "Firebase Authentication error"}`);
  }

  return {
    ok: true,
    uid: targetUid,
    email: cleanEmail,
    name: targetDisplayName,
    accountCreated,
    emailRequested: true
  };
}
