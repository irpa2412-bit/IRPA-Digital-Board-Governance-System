import {
  createUserWithEmailAndPassword,
  deleteUser,
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

import { auth, firebaseConfig, googleProvider } from "./config";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth } from "firebase/auth";

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

function generateTemporaryPassword() {
  const random =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint32Array(8)))
          .map((value) => value.toString(36))
          .join("")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return `IRPA-${random}-9!aQ`;
}

export async function sendMemberInvitationEmail(email, invitationId) {
  if (!email || !invitationId) {
    throw new Error("Member email and invitation ID are required.");
  }

  const cleanEmail = email.trim().toLowerCase();
  const secondaryName = `member-invitation-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  let temporaryUser = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      cleanEmail,
      generateTemporaryPassword()
    );

    temporaryUser = credential.user;

    const actionCodeSettings = {
      url:
        window.location.origin +
        "/?memberInvite=" +
        encodeURIComponent(invitationId) +
        "&email=" +
        encodeURIComponent(cleanEmail),
      handleCodeInApp: false
    };

    await sendPasswordResetEmail(
      secondaryAuth,
      cleanEmail,
      actionCodeSettings
    );
  } catch (error) {
    if (error?.code === "auth/email-already-in-use") {
      throw new Error(
        "This email address already has a Firebase account. Use the member's existing account or a different email address."
      );
    }

    if (temporaryUser) {
      try {
        await deleteUser(temporaryUser);
      } catch {
        // The original delivery error is more useful to the administrator.
      }
    }

    throw error;
  } finally {
    await deleteApp(secondaryApp);
  }
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
