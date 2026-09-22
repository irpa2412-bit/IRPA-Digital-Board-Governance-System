import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  authDomain: "irpa-digital-board-governance.firebaseapp.com",
  projectId: "irpa-digital-board-governance",
  messagingSenderId: "217055978789",
  appId: "1:217055978789:web:937d1f2f781202cc1e26cc",
  measurementId: "G-XDJEBRBEVC"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
  login_hint: "irpa2412@gmail.com"
});

export default app;
