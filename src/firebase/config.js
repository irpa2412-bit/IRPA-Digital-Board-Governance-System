import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
const applicantApp = initializeApp(firebaseConfig, "irpa-applicant-enrollment");
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
