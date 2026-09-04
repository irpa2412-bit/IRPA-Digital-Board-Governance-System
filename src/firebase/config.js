import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider
} from "firebase/auth";
import {
  getFirestore
} from "firebase/firestore";
import {
  getStorage
} from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaS2C2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  authDomain:
    "irpa-digital-board-governance.firebaseapp.com",
  projectId:
    "irpa-digital-board-governance",
  storageBucket:
    "irpa-digital-board-governance.firebasestorage.app",
  messagingSenderId:
    "217055978789",
  appId:
    "1:217055978789:web:937d1f2f781202cc1e26cc",
  measurementId:
    "G-XDJEBRBEVC"
};

export const GOOGLE_OAUTH_CLIENT_ID =
  "467032575367-2m4qmsdnvo3tqbh652d4irraq1543ip8.apps.googleusercontent.com";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);

export const storage = getStorage(app);

export const googleProvider =
  new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

export default app;
