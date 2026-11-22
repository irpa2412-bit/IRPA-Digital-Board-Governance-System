/* Firebase Cloud Messaging service worker for the IRPA Digital Board Governance System. */
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE",
  authDomain: "irpa-digital-board-governance.firebaseapp.com",
  projectId: "irpa-digital-board-governance",
  storageBucket: "irpa-digital-board-governance.firebasestorage.app",
  messagingSenderId: "217055978789",
  appId: "1:217055978789:web:937d1f2f781202cc1e26cc",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const title = notification.title || "IRPA Digital Governance";
  const data = payload.data || {};
  self.registration.showNotification(title, {
    body: notification.body || "You have a new IRPA governance notification.",
    icon: "/logo.svg",
    badge: "/logo.svg",
    data,
    tag: data.notificationId || "irpa-governance-notification",
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.route || event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("navigate" in client) client.navigate(target);
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
