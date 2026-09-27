import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence
} from "firebase/auth";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  // Keep Firebase's provisioned Auth domain. The Google OAuth client is
  // registered for this Firebase handler; changing this to web.app without
  // adding the matching OAuth redirect URI causes Google Error 400.
  authDomain: "irpa-digital-board-governance.firebaseapp.com",
  projectId: "irpa-digital-board-governance",
  messagingSenderId: "217055978789",
  appId: "1:217055978789:web:937d1f2f781202cc1e26cc",
  measurementId: "G-XDJEBRBEVC"
};

const app = initializeApp(firebaseConfig);

// Applicant enrollment uses a separate Firebase Auth/Firestore client so
// invitation-based assistance can never replace or poison the primary login session.
export const applicantApp = initializeApp(firebaseConfig, "irpa-applicant-enrollment");
export const applicantAuth = getAuth(applicantApp);

const createPersistentFirestore = (firebaseApp) => {
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (error) {
    // Persistence can be unavailable in restricted/private browser contexts.
    // Fall back to the normal Firestore client rather than blocking the portal.
    console.warn("IRPA-DBGS persistent Firestore cache unavailable; using standard Firestore:", error);
    return getFirestore(firebaseApp);
  }
};

export const applicantDb = createPersistentFirestore(applicantApp);
export const auth = getAuth(app);
export const db = createPersistentFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
  login_hint: "irpa2412@gmail.com"
});

// Explicit durable browser authentication persistence. IndexedDB is preferred
// for mobile/desktop PWAs and WebViews, with browser-local persistence as a
// fallback. This is initialized once before any portal authentication action.
export const authPersistenceReady = setPersistence(auth, indexedDBLocalPersistence).catch((error) => {
  console.warn("IRPA indexedDB Auth persistence unavailable; falling back to browser-local persistence.", error);
  return setPersistence(auth, browserLocalPersistence);
});

export const applicantAuthPersistenceReady = setPersistence(
  applicantAuth,
  indexedDBLocalPersistence
).catch((error) => {
  console.warn("IRPA applicant Auth indexedDB persistence unavailable; using browser-local persistence.", error);
  return setPersistence(applicantAuth, browserLocalPersistence);
});

export default app;
