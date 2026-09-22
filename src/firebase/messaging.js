import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, firebaseConfig } from "./config";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

async function tokenId(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function browserSupportsPush() {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export async function requestPushPermission() {
  if (!(await browserSupportsPush())) {
    throw new Error("This browser does not support Firebase push notifications.");
  }
  if (!VAPID_KEY) {
    throw new Error("Firebase Web Push VAPID key is not configured. Add VITE_FIREBASE_VAPID_KEY to the deployment environment.");
  }
  if (!auth.currentUser) throw new Error("You must be signed in before enabling notifications.");

  const currentPermission = Notification.permission;
  if (currentPermission === "denied") {
    throw new Error("IRPA notifications are blocked by this browser. On Android Chrome, open the site controls for irpa-digital-board-governance.web.app → Permissions → Notifications → Allow, then return to IRPA and press Enable Push Notifications again.");
  }

  const permission = currentPermission === "granted"
    ? "granted"
    : await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Notification permission was not granted. Choose Allow in the browser permission prompt, then press Enable Push Notifications again.");
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  const readyRegistration = await navigator.serviceWorker.ready;
  const messaging = getMessaging();
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: readyRegistration,
  });

  if (!token) throw new Error("Firebase did not return a browser notification token.");

  const id = await tokenId(token);
  await setDoc(doc(db, "notificationTokens", auth.currentUser.uid, "tokens", id), {
    token,
    uid: auth.currentUser.uid,
    email: auth.currentUser.email || null,
    platform: "web",
    permission: "granted",
    userAgent: navigator.userAgent,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });

  return token;
}

export async function listenForForegroundMessages(callback) {
  if (!(await browserSupportsPush())) return () => {};
  const messaging = getMessaging();
  return onMessage(messaging, (payload) => callback?.(payload));
}

export function notificationPermissionState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export { firebaseConfig };
