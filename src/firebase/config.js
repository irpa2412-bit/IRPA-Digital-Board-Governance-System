import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaS5B5O2s3T8fTVsgD4s3I_4PbnQ_Mua0-C_E",
  authDomain: "irpa-digital-governance-system.firebaseapp.com",
  projectId: "irpa-digital-governance-system",
  storageBucket: "irpa-digital-governance-system.firebasestorage.app",
  messagingSenderId: "467032575367",
  appId: "1:467032575367:web:3b6d65b79d2a490bde5722",
  measurementId: "G-LBVG6ES5CJ"
};

export const GOOGLE_OAUTH_CLIENT_ID =
  "467032575367-2m4qmsdnvo3tqbh652d4irraq1543ip8.apps.googleusercontent.com";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

export default app;
