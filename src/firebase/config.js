import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFirebaseEnvironment } from "./gatewayEnvironment";

const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

function required(name, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing required Firebase build configuration: ${name}.`);
  return normalized;
}

const firebaseConfig = useFirebaseEmulators
  ? {
      apiKey: "demo-api-key",
      authDomain: "localhost",
      projectId: "demo-irpa-dgbs",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:emulator",
      measurementId: "G-EMULATOR"
    }
  : (() => {
      const environment = getFirebaseEnvironment(import.meta.env);
      const config = {
        apiKey: required("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY),
        authDomain: required("VITE_FIREBASE_AUTH_DOMAIN", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
        projectId: required("VITE_FIREBASE_PROJECT_ID", import.meta.env.VITE_FIREBASE_PROJECT_ID),
        messagingSenderId: required("VITE_FIREBASE_MESSAGING_SENDER_ID", import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
        appId: required("VITE_FIREBASE_APP_ID", import.meta.env.VITE_FIREBASE_APP_ID),
        measurementId: required("VITE_FIREBASE_MEASUREMENT_ID", import.meta.env.VITE_FIREBASE_MEASUREMENT_ID)
      };
      if (config.projectId !== environment.projectId) {
        throw new Error(`VITE_FIREBASE_PROJECT_ID "${config.projectId}" does not match VITE_IRPA_ENV "${environment.name}". Firebase initialization is blocked.`);
      }
      if (config.authDomain !== environment.authDomain) {
        throw new Error(`VITE_FIREBASE_AUTH_DOMAIN does not match VITE_IRPA_ENV "${environment.name}". Firebase initialization is blocked.`);
      }
      const bucket = String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "").trim();
      return { ...config, ...(bucket ? { storageBucket: bucket } : {}) };
    })();

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

export { firebaseConfig };
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
