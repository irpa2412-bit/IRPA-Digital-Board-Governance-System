const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

exports.dispatchGovernanceNotification = onDocumentCreated("notifications/{notificationId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const notification = snapshot.data();
  const recipientUid = notification.recipientUid;
  if (!recipientUid) {
    await snapshot.ref.update({ deliveryStatus: "invalid", deliveryError: "Missing recipientUid", deliveryUpdatedAt: FieldValue.serverTimestamp() });
    return;
  }

  const tokenSnapshot = await db.collection("notificationTokens").doc(recipientUid).collection("tokens").get();
  const tokens = tokenSnapshot.docs.map((d) => ({ id: d.id, token: d.get("token") })).filter((x) => x.token);
  if (!tokens.length) {
    await snapshot.ref.update({ deliveryStatus: "no_tokens", deliveryUpdatedAt: FieldValue.serverTimestamp() });
    return;
  }

  const message = {
    tokens: tokens.map((x) => x.token),
    notification: { title: String(notification.title || "IRPA Governance"), body: String(notification.body || "") },
    data: {
      notificationId: String(event.params.notificationId),
      type: String(notification.type || "GOVERNANCE_EVENT"),
      module: String(notification.module || ""),
      recordId: String(notification.recordId || ""),
      route: String(notification.route || "/"),
      priority: String(notification.priority || "normal")
    },
    webpush: { fcmOptions: { link: notification.route || "/" } }
  };

  try {
    const result = await getMessaging().sendEachForMulticast(message);
    const invalidCodes = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
    const removals = [];
    result.responses.forEach((response, index) => {
      if (!response.success && response.error && invalidCodes.has(response.error.code)) {
        removals.push(tokenSnapshot.docs[index].ref.delete());
      }
    });
    await Promise.all(removals);
    await snapshot.ref.update({
      deliveryStatus: result.successCount > 0 ? "sent" : "failed",
      sentCount: result.successCount,
      failureCount: result.failureCount,
      deliveryUpdatedAt: FieldValue.serverTimestamp(),
      deliveryError: result.failureCount ? "One or more FCM deliveries failed." : null
    });
  } catch (error) {
    await snapshot.ref.update({ deliveryStatus: "failed", deliveryError: error.message || String(error), deliveryUpdatedAt: FieldValue.serverTimestamp() });
  }
});
