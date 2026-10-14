import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  // Keep Firebase's provisioned Auth domain. The Google OAuth client is
  // registered for this Firebase handler; changing this to web.app without
  // adding the matching OAuth redirect URI causes Google Error 400.
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "irpa-digital-board-governance.firebaseapp.com",
  ...(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
  projectId: useFirebaseEmulators ? "demo-irpa-dgbs" : (import.meta.env.VITE_FIREBASE_PROJECT_ID || "irpa-digital-board-governance"),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "217055978789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:217055978789:web:937d1f2f781202cc1e26cc",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-XDJEBRBEVC"
};

const app = initializeApp(firebaseConfig);

// Applicant enrollment uses a separate Firebase Auth/Firestore client so
// invitation-based assistance can never replace or poison the primary login session.
export const applicantApp = initializeApp(firebaseConfig, "irpa-applicant-enrollment");
export const applicantAuth = getAuth(applicantApp);
export const applicantDb = getFirestore(applicantApp);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
  login_hint: "irpa2412@gmail.com"
});

export default app;


// Test-only emulator wiring. Production builds do not set this flag; if it is
// accidentally enabled on a non-local origin, fail closed instead of connecting.
if (useFirebaseEmulators) {
  const localHosts = new Set(["localhost", "127.0.0.1"]);
  if (typeof window === "undefined" || !localHosts.has(window.location.hostname)) {
    throw new Error("Firebase emulator mode is restricted to localhost test fixtures.");
  }
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectAuthEmulator(applicantAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFirestoreEmulator(applicantDb, "127.0.0.1", 8080);
}
