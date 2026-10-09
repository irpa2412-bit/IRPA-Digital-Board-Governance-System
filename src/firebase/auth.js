import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInAnonymously,
  signInWithPopup,
  signInWithCredential,
  signInWithCustomToken,
  updatePassword,
  linkWithCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { auth, db, firebaseConfig, googleProvider, applicantAuth } from "./config";
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

// The administrator gateway uses a dedicated OAuth Auth instance pinned to
// Firebase's provisioned auth domain. This isolates the administrator sign-in
// from the Hosting domain and leaves all member/governance authentication
// flows on the existing primary Auth instance unchanged.
const ADMIN_OAUTH_APP_NAME = "irpa-admin-google-oauth";
const adminOAuthApp = initializeApp(
  { ...firebaseConfig, authDomain: "irpa-digital-board-governance.firebaseapp.com" },
  ADMIN_OAUTH_APP_NAME
);
const adminOAuthAuth = getAuth(adminOAuthApp);
const adminGoogleProvider = new GoogleAuthProvider();
const recoveryPhoneApp = initializeApp({ ...firebaseConfig }, "irpa-password-recovery-phone");
const recoveryPhoneAuth = getAuth(recoveryPhoneApp);

adminGoogleProvider.setCustomParameters({
  prompt: "select_account",
  login_hint: "select_account"
});

export async function ensureInvitationApplicantSession() {
  if (applicantAuth.currentUser) return applicantAuth.currentUser;
  const result = await signInAnonymously(applicantAuth);
  return result.user;
}

export async function registerWithEmail(email, password, options = {}) {
  const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  if (options.verify !== false) await sendEmailVerification(result.user);
  return result.user;
}

export async function loginWithEmail(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) throw new Error("Email address and password are required.");
  const functions = getFunctions(undefined, "us-central1");
  const check = httpsCallable(functions, "checkPasswordAttemptState");
  const recordFailure = httpsCallable(functions, "recordPasswordFailure");
  const clearFailures = httpsCallable(functions, "clearPasswordAttemptState");

  // Password-attempt controls are an additive security layer. Firebase
  // Authentication remains the authoritative credential check and must not be
  // made unavailable to registered members merely because the optional
  // password-security Functions endpoint is temporarily unavailable (for
  // example, while Cloud Functions deployment is blocked by billing).
  let passwordSecurityAvailable = true;
  try {
    const state = await check({ email: cleanEmail });
    if (state.data?.allowed === false) {
      const error = new Error(
        state.data?.status === "SUSPENDED"
          ? "Password access is suspended after six unsuccessful password entries. Use Forgot password? to complete mobile verification and request the registered email reset link."
          : "Password entry is temporarily locked for 5 minutes after three unsuccessful trials. Please wait before trying again."
      );
      error.code = state.data?.status === "SUSPENDED" ? "auth/password-suspended" : "auth/password-locked";
      error.retryAfterSeconds = state.data?.retryAfterSeconds || 300;
      throw error;
    }
  } catch (error) {
    if (error?.code === "auth/password-locked" || error?.code === "auth/password-suspended") throw error;
    passwordSecurityAvailable = false;
    console.warn("IRPA password-attempt security endpoint unavailable; continuing with Firebase Authentication.", error);
  }

  try {
    const result = await signInWithEmailAndPassword(auth, cleanEmail, password);
    if (passwordSecurityAvailable) {
      try {
        await clearFailures({ email: cleanEmail });
      } catch (securityError) {
        console.warn("IRPA password-attempt clear endpoint unavailable after successful Firebase Authentication.", securityError);
      }
    }
    return result.user;
  } catch (error) {
    let failureState = null;
    if (passwordSecurityAvailable) {
      try {
        const failureResult = await recordFailure({ email: cleanEmail });
        failureState = failureResult?.data || null;
      } catch (securityError) {
        console.warn("IRPA password-attempt recording endpoint unavailable after failed Firebase Authentication.", securityError);
      }
    }
    const wrapped = new Error(firebaseErrorMessage(error));
    wrapped.code = error?.code || "";
    if (failureState) {
      wrapped.passwordAttemptStatus = failureState.status || "";
      wrapped.passwordRemainingAttempts = Number(failureState.remainingAttempts ?? 0);
      wrapped.passwordResetRequired = failureState.resetRequired === true;
      wrapped.passwordRetryAfterSeconds = Number(failureState.retryAfterSeconds || 0);
    }
    throw wrapped;
  }
}

export async function loginWithGoogle(expectedEmail = "", options = {}) {
  const expected = String(expectedEmail || "").trim().toLowerCase();

  // Administrator Gateway: use a direct popup while the action still has
  // the user's browser gesture. If the browser explicitly blocks Firebase's
  // popup, fall back to redirect authentication. The successful popup path
  // returns the Firebase user immediately and therefore does not depend on
  // redirect-result recovery on Android.
  if (options.admin === true) {
    // Never enter the redirect flow for the Administrator Gateway. The
    // dedicated Auth instance above launches Google with the registered
    // firebaseapp.com OAuth callback, then the resulting Google credential is
    // exchanged into the primary Auth instance used by the rest of the app.
    window.sessionStorage.removeItem("irpaAdminRedirectPending");
    window.localStorage.removeItem("irpaAdminRedirectPending");
    window.sessionStorage.setItem("irpaExpectedGoogleAdminEmail", expected);
    window.localStorage.setItem("irpaExpectedGoogleAdminEmail", expected);

    try {
      const result = await signInWithPopup(adminOAuthAuth, adminGoogleProvider);
      const actual = String(result.user?.email || "").trim().toLowerCase();
      if (expected && actual !== expected) {
        await signOut(adminOAuthAuth);
        throw new Error(`Use the designated IRPA administrator Google account: ${expected}.`);
      }

      // Exchange the Google OAuth credential into the application's primary
      // Auth instance. This keeps every existing governance portal attached
      // to the same Firebase session and authorization listeners.
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential) throw new Error("Google authentication did not return a usable credential.");
      const primaryResult = await signInWithCredential(auth, credential);

      await signOut(adminOAuthAuth);
      window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");
      window.sessionStorage.removeItem("irpaAdminRedirectPending");
      window.localStorage.removeItem("irpaExpectedGoogleAdminEmail");
      window.localStorage.removeItem("irpaAdminRedirectPending");
      return primaryResult.user;
    } catch (error) {
      try { await signOut(adminOAuthAuth); } catch (_) {}
      throw error;
    }
  }

  if (options.redirect === true) {
    window.sessionStorage.setItem("irpaExpectedGoogleAdminEmail", expected);
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  const result = await signInWithPopup(auth, googleProvider);
  const actual = String(result.user?.email || "").trim().toLowerCase();
  if (expected && actual !== expected) {
    await signOut(auth);
    throw new Error(`Use the designated IRPA administrator Google account: ${expected}.`);
  }
  return result.user;
}

export async function completeGoogleRedirect(expectedEmail = "") {
  const result = await getRedirectResult(auth);
  if (!result?.user) return null;
  const expected = String(expectedEmail || window.localStorage.getItem("irpaExpectedGoogleAdminEmail") || "").trim().toLowerCase();
  const actual = String(result.user?.email || "").trim().toLowerCase();
  if (expected && actual !== expected) {
    await signOut(auth);
    throw new Error(`Use the designated IRPA administrator Google account: ${expected}.`);
  }
  window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");
  window.sessionStorage.removeItem("irpaAdminRedirectPending");
  window.localStorage.removeItem("irpaExpectedGoogleAdminEmail");
  window.localStorage.removeItem("irpaAdminRedirectPending");
  return result.user;
}

export async function bootstrapPrimaryAdministrator() {
  const user = auth.currentUser;
  if(!user) throw new Error("Google authentication is required.");
  const email = String(user.email || "").trim().toLowerCase();
  if(email !== "irpa2412@gmail.com") throw new Error("This Google account is not the designated IRPA primary administrator.");
  const functions = getFunctions(undefined, "us-central1");
  const call = httpsCallable(functions, "bootstrapPrimaryAdministrator");
  const result = await call({});
  return result.data;
}

export async function clearPasswordAttemptState(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return;
  const clear = httpsCallable(getFunctions(undefined, "us-central1"), "clearPasswordAttemptState");
  await clear({ email: cleanEmail });
}

export async function sendPasswordReset(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) throw new Error("Enter your email address first.");
  try {
    await sendPasswordResetEmail(auth, cleanEmail);
  } catch (error) {
    throw new Error(firebaseErrorMessage(error));
  }
}

let passwordRecoveryRecaptcha = null;

export async function beginPasswordResetMobileVerification(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) throw new Error("Enter your registered IRPA email address first.");
  const prepare = httpsCallable(getFunctions(undefined, "us-central1"), "preparePasswordResetPhone");
  const result = await prepare({ email: cleanEmail });
  if (passwordRecoveryRecaptcha) {
    try { passwordRecoveryRecaptcha.clear(); } catch (_) {}
    passwordRecoveryRecaptcha = null;
  }
  passwordRecoveryRecaptcha = new RecaptchaVerifier(recoveryPhoneAuth, "password-reset-recaptcha", { size: "invisible" });
  const confirmation = await signInWithPhoneNumber(recoveryPhoneAuth, result.data.phoneNumber, passwordRecoveryRecaptcha);
  return { confirmation, maskedPhone: result.data.maskedPhone, email: cleanEmail };
}

export async function verifyPasswordResetMobileOtp(confirmation, code) {
  const cleanCode = String(code || "").trim();
  if (!confirmation || !/^\d{6}$/.test(cleanCode)) throw new Error("Enter the six-digit mobile verification code.");
  await confirmation.confirm(cleanCode);
  try { await signOut(recoveryPhoneAuth); } catch (_) {}
  if (passwordRecoveryRecaptcha) {
    try { passwordRecoveryRecaptcha.clear(); } catch (_) {}
    passwordRecoveryRecaptcha = null;
  }
  return true;
}

export async function logout(options = {}) {
  if (!options.preserveRecovery) {
    try { window.localStorage.removeItem("irpaSessionRecovery"); } catch (_) {}
  }
  // Access authority is valid only for the current authenticated login session.
  // Never carry a previously declared operating role into the next sign-in.
  try {
    window.sessionStorage.removeItem("irpaActiveAccessAuthority");
    window.sessionStorage.removeItem("irpaAccessAuthoritySelectionState");
  } catch (_) {}
  await signOut(auth);
}

export async function sendAdminMagicLink(email, invitationId = "") {
  const cleanEmail = email.trim().toLowerCase();
  if(!cleanEmail) throw new Error("Administrator email is required.");
  const actionCodeSettings = {
    url: window.location.origin + "/?adminGateway=1&adminModule=Add%20Administrator" + (invitationId ? "&adminInvite=" + encodeURIComponent(invitationId) : ""),
    handleCodeInApp: true
  };
  await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);
  window.localStorage.setItem("irpaEmailForSignIn", cleanEmail);
}

function generateTemporaryPassword() {
  const random = typeof crypto !== "undefined" && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint32Array(8))).map(value => value.toString(36)).join("")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `IRPA-${random}-9!aQ`;
}

function firebaseErrorMessage(error) {
  const code = error?.code || "";
  const message = error?.message || "Firebase Authentication request failed.";
  const known = {
    "auth/operation-not-allowed": "Email/password authentication is not enabled for this Firebase project.",
    "auth/invalid-api-key": "The Firebase API key is invalid.",
    "auth/network-request-failed": "Firebase Authentication could not reach the network. Check the browser connection and try again.",
    "auth/too-many-requests": "Firebase has temporarily blocked requests from this device because of too many attempts. Please wait and try again.",
    "auth/quota-exceeded": "Firebase Authentication quota has been exceeded.",
    "auth/invalid-continue-uri": "The registration link destination is not authorized in Firebase Authentication.",
    "auth/unauthorized-continue-uri": "The registration link destination is not authorized in Firebase Authentication. Add the application domain under Authorized domains.",
    "auth/missing-continue-uri": "The registration link destination is missing.",
    "auth/user-not-found": "No IRPA account was found for this email address. Check the email or create an account.",
    "auth/invalid-email": "The email address is invalid.",
    "auth/wrong-password": "Incorrect password. Please check your password or use Forgot password? to reset it.",
    "auth/invalid-credential": "The email or password is incorrect. Check your credentials or use Forgot password? to reset the password.",
    "auth/user-disabled": "This Firebase account has been disabled. Contact the IRPA administrator.",
    "auth/weak-password": "The password must contain at least 6 characters.",
    "auth/email-already-in-use": "An account already exists for this email address. Use Forgot password? if you need to reset the password.",
    "auth/invalid-action-code": "This sign-in link is invalid or has expired. Request a fresh IRPA invitation/sign-in link and use the newest email only.",
    "auth/expired-action-code": "This sign-in link has expired. Request a fresh IRPA invitation/sign-in link.",
    "auth/internal-error": "IRPA could not establish your invitation session. Your invitation has not been consumed. Please try the invitation again.",
    "auth/invalid-custom-token": "IRPA could not validate the invitation session. Your invitation has not been consumed. Please try the invitation again.",
    "auth/custom-token-mismatch": "IRPA could not connect the invitation to the IRPA Firebase project. Please request a fresh invitation link."
  };
  return known[code] ? `${known[code]} (${code})` : `${message}${code ? ` (${code})` : ""}`;
}

export async function inviteRegisteredPerson({record,recordType,role,memberType}) {
  if (!record?.id) throw new Error("A registered institutional record is required.");
  const email=String(record.email||"").trim().toLowerCase();
  const name=String(record.name||"").trim();
  if (!name || !email) throw new Error("The registered record must contain a name and official email.");
  const invitationRef=doc(collection(db,"invitations"));
  const invitationId=invitationRef.id;
  const invitationData={
    email,name,role:String(role||record.role||recordType||"IRPA Member").trim(),
    memberType:String(memberType||recordType||"IRPA Member").trim(),
    roles:Array.isArray(record.roles)&&record.roles.length?record.roles:[String(role||record.role||recordType||"IRPA Member").trim()],
    status:"Pending",deliveryStatus:"Preparing",employeeId:recordType==="Employee"?record.id:null,
    boardMemberId:recordType==="Board Member"?record.id:null,institutionalRecordId:record.id,
    institutionalRecordType:String(recordType||"").trim(),source:"Institutional Register",
    deliveryProvider:"IRPA Mail Server",createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  };
  await setDoc(invitationRef,invitationData);
  try {
    const result=await sendMemberInvitationEmail(email,invitationId,invitationData.role,invitationData.memberType);
    await updateDoc(invitationRef,{status:"Invitation Requested",deliveryStatus:result.deliveryStatus||"Accepted",sentAt:new Date().toISOString(),deliveryError:"",updatedAt:serverTimestamp()});
    return {invitationId,...result};
  } catch(error) {
    await updateDoc(invitationRef,{deliveryStatus:"Failed",deliveryError:error?.message||"Invitation request failed.",updatedAt:serverTimestamp()});
    throw error;
  }
}

export async function sendMemberInvitationEmail(_email, invitationId, _role, _memberType, meetingAccess = null) {
  const cleanId = String(invitationId || "").trim();
  if (!cleanId) throw new Error("The invitation ID is required.");
  if (!auth.currentUser) throw new Error("Administrator authentication is required.");
  const gateway = String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "https://irpa-google-drive-gateway.irpa-governance.workers.dev").replace(/\/$/,"");
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${gateway}/api/invitations/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId: cleanId, ...(meetingAccess ? { meetingAccess } : {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "The IRPA mail server could not send the invitation.");
    return data;
  } catch (error) {
    console.error("IRPA member invitation sender error", { firebaseErrorCode: error?.code || "" });
    throw new Error(error?.message || "The IRPA invitation email could not be sent. Please try again.");
  }
}

export async function sendEmployeeRegistrationEmail(email, employeeNumber) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanEmployeeNumber = String(employeeNumber || "").trim();
  if (!cleanEmail || !cleanEmployeeNumber) throw new Error("Employee email and employee number are required.");

  const employeeQuery = await getDocs(query(
    collection(db, "employees"),
    where("employeeNumber", "==", cleanEmployeeNumber),
    where("email", "==", cleanEmail)
  ));
  if (employeeQuery.empty) throw new Error("The Employee Register record could not be verified for this invitation.");

  const employeeDoc = employeeQuery.docs[0];
  const employee = employeeDoc.data() || {};
  let invitationId = String(employee.invitationId || "").trim();

  if (!invitationId) {
    const invitationRef = await addDoc(collection(db, "invitations"), {
      email: cleanEmail,
      name: String(employee.name || "").trim(),
      role: String(employee.role || "Employee").trim(),
      memberType: String(employee.memberType || "Management").trim(),
      department: employee.department || null,
      unit: employee.unit || null,
      employeeId: employeeDoc.id,
      institutionalRecordType: "Employee",
      institutionalRecordId: employeeDoc.id,
      source: "Employees' Register",
      status: "Pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    invitationId = invitationRef.id;
    await updateDoc(employeeDoc.ref, { invitationId, invitationDeliveryMode: "Dedicated Invitation Token", updatedAt: serverTimestamp() });
  }

  const result = await sendMemberInvitationEmail(
    cleanEmail,
    invitationId,
    String(employee.role || "Employee").trim(),
    String(employee.memberType || "Management").trim()
  );
  return { ...(result || {}), invitationId, accountCreated: false };
}

// Invitation delivery is handled by the server-side dedicated invitation-token workflow.
// Password-reset email remains available only through sendPasswordReset() for self-service recovery.
export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function isMagicLink(url = window.location.href) {
  return isSignInWithEmailLink(auth, url);
}

export async function configureInvitationPassword(password) {
  const cleanPassword = String(password || "");
  const user = auth.currentUser;
  const invitationId = String(window.sessionStorage.getItem("irpaInvitationId") || "").trim();
  if (!user) throw new Error("The invitation account session is not active. Open the invitation email again.");
  if (!invitationId) throw new Error("The invitation activation context is missing. Open the invitation email again.");
  if (cleanPassword.length < 8) throw new Error("Use a password with at least 8 characters.");
  const idToken = await user.getIdToken(true);
  const gatewayOrigin = String(import.meta.env.VITE_GATEWAY_ORIGIN || "").trim().replace(/\/$/,"");
  if (!gatewayOrigin) throw new Error("IRPA gateway origin is not configured for this build.");
  let response;
  try {
    response = await fetch(`${gatewayOrigin}/api/invitations/password-set`, {
      method:"POST",
      headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId,password:cleanPassword})
    });
  } catch (error) {
    throw new Error("IRPA could not reach the invitation activation service. Your invitation remains available. Please try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(data.error || "The server could not verify the new password.");
  window.sessionStorage.removeItem("irpaInvitationPasswordSetup");
  window.sessionStorage.removeItem("irpaInvitationProvisioningPending");
  if (data.state === "ACTIVATED") {
    window.sessionStorage.removeItem("irpaInvitationId");
    try {
      await signOut(auth);
      await signInWithEmailAndPassword(auth, String(user.email || "").trim().toLowerCase(), cleanPassword);
    } catch (error) {
      throw new Error("Your password was set, but IRPA could not reopen the account session automatically. Please sign in with the new password.");
    }
  }
  return data;
}

export async function completeInvitationToken(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("The IRPA invitation token is missing.");
  const gatewayOrigin = String(import.meta.env.VITE_GATEWAY_ORIGIN || "").trim().replace(/\/$/,"");
  if (!gatewayOrigin) throw new Error("IRPA gateway origin is not configured for this build.");
  const endpoint = `${gatewayOrigin}/api/invitations/redeem`;
  try {
    const response = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-IRPA-Invitation-Version":"2"},body:JSON.stringify({token:cleanToken})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "The IRPA invitation could not be redeemed.");
    if ((!data.customToken && !data.invitationPassword) || !data.invitationId) throw new Error("The invitation redemption response was incomplete.");
    let signedIn;
    if (data.customToken) signedIn = await signInWithCustomToken(auth,data.customToken);
    else signedIn = await loginWithEmail(data.email || "",data.invitationPassword);
    window.sessionStorage.setItem("irpaInvitationId",data.invitationId);
    window.sessionStorage.setItem("irpaInvitationPasswordSetup","1");
    window.localStorage.removeItem("irpaEmailForSignIn");
    window.localStorage.removeItem("irpaMemberEmailForSignIn");
    return signedIn.user;
  } catch (error) { throw new Error(firebaseErrorMessage(error)); }
}
export async function getInvitationSessionState() {
  const user = auth.currentUser;
  if (!user) return {state:null, invitationId:null};
  const gatewayOrigin = String(import.meta.env.VITE_GATEWAY_ORIGIN || "").trim().replace(/\/$/,"");
  if (!gatewayOrigin) throw new Error("IRPA gateway origin is not configured for this build.");
  const idToken = await user.getIdToken();
  const response = await fetch(`${gatewayOrigin}/api/invitations/session-state`, {
    method:"POST",
    headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},
    body:"{}"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "Unable to resolve the invitation session state.");
  return {state:data.state || null, invitationId:data.invitationId || null};
}

export async function completeMagicLink(email, url = window.location.href) {
  const cleanEmail = email.trim().toLowerCase();
  const params = new URL(url, window.location.origin).searchParams;
  const adminInvitationId = params.get("adminInvite");
  const memberInvitationId = params.get("memberInvite");
  const result = await signInWithEmailLink(auth, cleanEmail, url);

  if (adminInvitationId) {
    // Legacy Firestore-backed invitation links remain supported for links
    // issued before the daily-limit-free administrator pathway was deployed.
    const invitationRef = doc(db, "adminInvitations", adminInvitationId);
    const invitationSnap = await getDoc(invitationRef);
    if(!invitationSnap.exists()) throw new Error("This Administrator invitation is invalid or no longer available.");
    const invitation = invitationSnap.data();
    if(String(invitation.email || "").trim().toLowerCase() !== cleanEmail) {
      await signOut(auth);
      throw new Error("This Administrator activation link was issued for a different email address.");
    }
    if(invitation.status !== "Pending") throw new Error("This Administrator invitation has already been activated or is no longer pending.");
    await setDoc(doc(db, "adminProfiles", result.user.uid), {
      uid:result.user.uid,email:cleanEmail,name:invitation.name||result.user.displayName||cleanEmail.split("@")[0],
      role:"Administrator",active:true,invitationId:adminInvitationId,
      createdByUid:invitation.createdByUid||null,createdByEmail:invitation.createdByEmail||null,
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    },{merge:true});
    await setDoc(invitationRef,{status:"Activated",activatedUid:result.user.uid,activatedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    window.localStorage.removeItem("irpaEmailForSignIn");
    return result.user;
  }

  if (memberInvitationId) {
    const { provisionCurrentMemberFromInvitationV2 } = await import("./invitationWorkflow");
    await provisionCurrentMemberFromInvitationV2(memberInvitationId);
    window.localStorage.removeItem("irpaMemberEmailForSignIn");
    window.localStorage.removeItem("irpaEmailForSignIn");
  } else {
    const adminSnap = await getDoc(doc(db, "adminProfiles", result.user.uid));
    if (!adminSnap.exists() || adminSnap.data()?.active !== true) {
      await signOut(auth);
      throw new Error("This email is not an active IRPA Administrator account. Ask an existing Administrator to add the account first.");
    }
    window.localStorage.removeItem("irpaEmailForSignIn");
  }
  return result.user;
}
