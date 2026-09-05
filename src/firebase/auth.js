import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged
} from "firebase/auth";

import { auth, googleProvider } from "./config";

export async function registerWithEmail(email, password) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(result.user);
  return result.user;
}

export async function loginWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

export async function sendAdminMagicLink(email) {
  const actionCodeSettings = {
    url: window.location.origin + "/",
    handleCodeInApp: true
  };

  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  window.localStorage.setItem("irpaEmailForSignIn", email);
}

export async function sendMemberInvitationLink(email, invitationId) {
  if (!email || !invitationId) {
    throw new Error("Member email and invitation ID are required.");
  }

  const actionCodeSettings = {
    url:
      window.location.origin +
      "/?memberInvite=" +
      encodeURIComponent(invitationId),
    handleCodeInApp: true
  };

  await sendSignInLinkToEmail(auth, email, actionCodeSettings);

  window.localStorage.setItem("irpaMemberInviteEmail", email);
}

export function isMagicLink(url = window.location.href) {
  return isSignInWithEmailLink(auth, url);
}

export async function completeMagicLink(email, url = window.location.href) {
  return await signInWithEmailLink(auth, email, url);
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}
