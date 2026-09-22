import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged
} from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { auth, firebaseConfig, googleProvider } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";

export async function registerWithEmail(email, password, options = {}) {
  const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  if (options.verify !== false) await sendEmailVerification(result.user);
  return result.user;
}

export async function loginWithEmail(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) throw new Error("Email address and password are required.");
  try {
    const result = await signInWithEmailAndPassword(auth, cleanEmail, password);
    return result.user;
  } catch (error) {
    throw new Error(firebaseErrorMessage(error));
  }
}

export async function loginWithGoogle(expectedEmail = "", options = {}) {
  const expected = String(expectedEmail || "").trim().toLowerCase();

  // Administrator Gateway uses Firebase redirect authentication. This is
  // deterministic on Android/mobile browsers and avoids popup/tab blockers.
  if (options.admin === true) {
    // Strip the gateway query BEFORE starting the OAuth redirect. Firebase
    // returns the browser to the URL from which redirect auth was initiated;
    // keeping ?adminGateway=1 here can send a mobile browser back into the
    // gateway before the application has consumed the Firebase redirect result.
    window.sessionStorage.setItem("irpaExpectedGoogleAdminEmail", expected);
    window.sessionStorage.setItem("irpaAdminRedirectPending", "1");
    window.localStorage.setItem("irpaExpectedGoogleAdminEmail", expected);
    window.localStorage.setItem("irpaAdminRedirectPending", "1");
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    await signInWithRedirect(auth, googleProvider);
    return null;
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

export async function sendPasswordReset(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) throw new Error("Enter your email address first.");
  try {
    await sendPasswordResetEmail(auth, cleanEmail);
  } catch (error) {
    throw new Error(firebaseErrorMessage(error));
  }
}

export async function logout() { await signOut(auth); }

export async function sendAdminMagicLink(email) {
  const actionCodeSettings = { url: window.location.origin + "/?adminGateway=1&adminModule=Add%20Administrator", handleCodeInApp: true };
  await sendSignInLinkToEmail(auth, email.trim().toLowerCase(), actionCodeSettings);
  window.localStorage.setItem("irpaEmailForSignIn", email.trim().toLowerCase());
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
    "auth/expired-action-code": "This sign-in link has expired. Request a fresh IRPA invitation/sign-in link."
  };
  return known[code] ? `${known[code]} (${code})` : `${message}${code ? ` (${code})` : ""}`;
}

async function sendAuthResetEmailWithSecondaryApp(email, actionCodeSettings, appPrefix) {
  const cleanEmail = email.trim().toLowerCase();
  const secondaryName = `${appPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  let accountCreated = false;
  try {
    try {
      await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, generateTemporaryPassword());
      accountCreated = true;
    } catch (error) {
      if (error?.code !== "auth/email-already-in-use") throw new Error(firebaseErrorMessage(error));
    }
    await sendPasswordResetEmail(secondaryAuth, cleanEmail, actionCodeSettings);
    return { email: cleanEmail, accountCreated, emailRequested: true, provider: "Firebase Authentication", deliveryStatus: "Accepted by Firebase Authentication" };
  } catch (error) {
    throw new Error(firebaseErrorMessage(error));
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function sendEmployeeRegistrationEmail(email, employeeNumber) {
  if (!email || !employeeNumber) throw new Error("Employee email and Employee Number are required.");
  const cleanEmail = email.trim().toLowerCase();
  const actionCodeSettings = { url: window.location.origin + "/?employeeNumber=" + encodeURIComponent(employeeNumber) + "&email=" + encodeURIComponent(cleanEmail), handleCodeInApp: false };
  return sendAuthResetEmailWithSecondaryApp(cleanEmail, actionCodeSettings, "employee-registration");
}

export async function sendMemberInvitationEmail(email, invitationId) {
  if (!email || !invitationId) throw new Error("Member email and invitation ID are required.");
  const cleanEmail = email.trim().toLowerCase();
  const gateway = String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL || "https://irpa-google-drive-gateway.irpa-governance.workers.dev").replace(/\/$/,"");
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Administrator authentication is required.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(gateway + "/api/invitations/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId, email: cleanEmail }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("IRPA Mail Server did not respond within 30 seconds. The invitation was not confirmed as sent; use Resend after checking the mail server.");
    }
    throw new Error(error?.message || "IRPA Mail Server could not be reached.");
  } finally {
    window.clearTimeout(timeout);
  }
  const result = await response.json().catch(()=>({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `IRPA Mail Server rejected the invitation request (HTTP ${response.status}).`);
  }
  return {
    email: cleanEmail,
    emailRequested: true,
    provider: "IRPA Mail Server",
    deliveryStatus: result.deliveryStatus || "Submitted to mail.irpa.or.tz",
    messageId: result.messageId || null
  };
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function isMagicLink(url = window.location.href) {
  return isSignInWithEmailLink(auth, url);
}

export async function completeMagicLink(email, url = window.location.href) {
  const result = await signInWithEmailLink(auth, email.trim().toLowerCase(), url);
  const invitationId = new URLSearchParams(new URL(url, window.location.origin).search).get("memberInvite");

  if (invitationId) {
    const { provisionCurrentMemberFromInvitationV2 } = await import("./invitationWorkflow");
    await provisionCurrentMemberFromInvitationV2(invitationId);
    window.localStorage.removeItem("irpaMemberEmailForSignIn");
    window.localStorage.removeItem("irpaEmailForSignIn");
  } else {
    window.localStorage.removeItem("irpaEmailForSignIn");
  }

  return result.user;
}
