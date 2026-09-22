import { getFirestore, doc, getDoc, setDoc, addDoc, collection, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import app, { firebaseConfig, auth, db } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";

export const functions = getFunctions(app, "us-central1");

export async function ensurePrimaryAdministrator(){
  const callable = httpsCallable(functions, "ensurePrimaryAdministrator");
  const result = await callable({});
  return result.data;
}

function firebaseProvisioningError(error, fallback="Firebase administrator provisioning failed."){
  const code=error?.code||"";
  const messages={
    "auth/operation-not-allowed":"Email/password authentication is not enabled in Firebase Authentication.",
    "auth/invalid-api-key":"The Firebase API key is invalid for this deployment.",
    "auth/network-request-failed":"Firebase Authentication could not reach the network. Check the connection and try again.",
    "auth/too-many-requests":"Firebase has temporarily blocked authentication requests from this device. Wait a moment and try again.",
    "auth/quota-exceeded":"Firebase Authentication quota has been exceeded.",
    "auth/invalid-email":"The administrator email address is invalid.",
    "auth/weak-password":"Firebase rejected the generated administrator password. Please try again.",
    "auth/internal-error":"Firebase Authentication returned an internal error while provisioning the administrator account. No silent success is reported. Try again once; if it repeats, the Firebase Authentication service/configuration needs attention."
  };
  return messages[code] ? messages[code]+" ("+code+")" : (error?.message||fallback);
}
function temporaryPassword(){
  const values = typeof crypto !== "undefined" && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint32Array(8))).map(v => v.toString(36)).join("")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `IRPA-${values}-9!aQ`;
}

async function firebaseAuthRest(path, body){
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(firebaseConfig.apiKey)}`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if(!response.ok){
    const code = payload?.error?.message || "UNKNOWN_ERROR";
    const error = new Error(code);
    error.code = `auth/${String(code).toLowerCase()}`;
    error.firebaseAuthCode = code;
    throw error;
  }
  return payload;
}

function firebaseRestError(error, fallback){
  const code = String(error?.firebaseAuthCode || error?.code || "").toUpperCase();
  const messages = {
    "OPERATION_NOT_ALLOWED":"Email/password authentication is not enabled in Firebase Authentication.",
    "EMAIL_EXISTS":"A Firebase account already exists for this email.",
    "INVALID_EMAIL":"The administrator email address is invalid.",
    "WEAK_PASSWORD":"Firebase rejected the generated administrator password.",
    "TOO_MANY_ATTEMPTS_TRY_LATER":"Firebase has temporarily limited authentication requests. Wait and try again.",
    "QUOTA_EXCEEDED":"Firebase Authentication quota has been exceeded.",
    "API_KEY_INVALID":"The Firebase API key is invalid for this deployment."
  };
  return messages[code] || (error?.message && error.message !== "internal" ? error.message : `${fallback} Firebase returned: ${code || "UNKNOWN_ERROR"}.`);
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

export async function createAdministrator({ name, email, onProgress }){
  const progress = (message) => { try { onProgress?.(message); } catch (_) {} };
  progress("Checking Administrator authorization…");
  const actor = await requireAdministrator();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();
  if(!cleanName) throw new Error("The new administrator's name is required.");
  if(!cleanEmail || !cleanEmail.includes("@")) throw new Error("A valid administrator email address is required.");
  if(cleanEmail === String(actor.email || "").toLowerCase()) throw new Error("The current administrator is already an administrator.");

  progress("Validating the new Administrator details…");
  let targetUid = null;
  let accountCreated = false;
  let targetDisplayName = cleanName;

  try{
    progress("Creating the Firebase account…");
    const credential = await firebaseAuthRest("accounts:signUp",{
      email: cleanEmail,
      password: temporaryPassword(),
      returnSecureToken: true
    });
    targetUid = credential?.localId || null;
    if(!targetUid) throw new Error("Firebase created the account but did not return its UID.");
    accountCreated = true;
  }catch(error){
    const restCode = String(error?.firebaseAuthCode || "").toUpperCase();
    if(restCode !== "EMAIL_EXISTS"){
      throw new Error(firebaseRestError(error,"Unable to create the administrator account."));
    }

    progress("The email already has a Firebase account. Matching it to an IRPA profile…");
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

  progress("Saving the Administrator authorization profile…");
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

  progress("Writing the security audit record…");
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
    progress("Requesting the Administrator activation email…");
    await firebaseAuthRest("accounts:sendOobCode",{
      requestType:"PASSWORD_RESET",
      email:cleanEmail
    });
  }catch(error){
    throw new Error("Administrator was created, but Firebase could not accept the activation email request: "+firebaseRestError(error,"Firebase could not accept the activation email request."));
  }

  progress("Administrator setup completed.");
  return {
    ok: true,
    uid: targetUid,
    email: cleanEmail,
    name: targetDisplayName,
    accountCreated,
    emailRequested: true
  };
}
