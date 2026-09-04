import {
  initializeApp
} from "firebase/app";

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
  apiKey: "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  authDomain: "irpa-digital-board-governance.firebaseapp.com",
  projectId: "irpa-digital-board-governance",
  storageBucket: "irpa-digital-board-governance.firebasestorage.app",
  messagingSenderId: "217055978789",
  appId: "1:217055978789:web:937d1f2f781202cc1e26cc",
  measurementId: "G-XDJEBRBEVC"
};

export const GOOGLE_OAUTH_CLIENT_ID =
  "217055978789-2tuhm77gfv4kcdjmgua5cnnajhd28e0b.apps.googleusercontent.com";

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
