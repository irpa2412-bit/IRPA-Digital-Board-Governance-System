import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink
} from "firebase/auth";

import { auth, googleProvider } from "./config";

export async function registerWithEmail(email, password) {
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  await sendEmailVerification(credential.user);

  return credential.user;
}

export async function loginWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  return credential.user;
}

export async function loginWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function sendPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function logout() {
  return signOut(auth);
}

export async function sendAdminMagicLink(email) {
  const actionCodeSettings = {
    url: `${window.location.origin}/`,
    handleCodeInApp: true
  };

  return sendSignInLinkToEmail(
    auth,
    email,
    actionCodeSettings
  );
}

export function isMagicLink(url = window.location.href) {
  return isSignInWithEmailLink(auth, url);
}

export async function completeMagicLink(email, url = window.location.href) {
  return signInWithEmailLink(auth, email, url);
}

export function observeAuthState(callback) {
  return auth.onAuthStateChanged(callback);
}
