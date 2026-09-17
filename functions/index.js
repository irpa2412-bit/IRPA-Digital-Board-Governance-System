const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();
async function stableId(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
async function notify({ recipientUids, type, title, body, module, recordId, route = "/", priority = "normal", eventKey }) {
  for (const recipientUid of [...new Set((recipientUids || []).filter(Boolean).map(String))]) {
    const id = await stableId(`${eventKey}|${recipientUid}`);
    await db.collection("notifications").doc(id).set({ recipientUid, type, title, body, module, recordId: recordId || null, route, priority, read: false, createdByUid: "system", createdAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}
async function meetingRecipients(meetingId, meeting = {}) {
  if (!meetingId) return [];
  const ids = new Set([...(meeting.participantUids || []), ...(meeting.attendeeUids || []), ...(meeting.memberUids || [])].filter(Boolean));
  const snap = await db.collection("meetingSubscriptions").where("meetingId", "==", meetingId).get();
  snap.forEach(d => { const x = d.data(); [x.uid, x.userId, x.memberUid].filter(Boolean).forEach(v => ids.add(v)); });
  return [...ids];
}
exports.dispatchGovernanceNotification = onDocumentCreated("notifications/{notificationId}", async event => {
  const snapshot = event.data; if (!snapshot) return;
  const n = snapshot.data(); if (!n.recipientUid) return;
  const tokenSnapshot = await db.collection("notificationTokens").doc(n.recipientUid).collection("tokens").get();
  const tokens = tokenSnapshot.docs.map(d => d.get("token")).filter(Boolean);
  if (!tokens.length) { await snapshot.ref.update({ deliveryStatus: "no_tokens", deliveryUpdatedAt: FieldValue.serverTimestamp() }); return; }
  try {
    const result = await getMessaging().sendEachForMulticast({ tokens, notification: { title: String(n.title || "IRPA Governance"), body: String(n.body || "") }, data: { notificationId: event.params.notificationId, type: String(n.type || "GOVERNANCE_EVENT"), module: String(n.module || ""), recordId: String(n.recordId || ""), route: String(n.route || "/"), priority: String(n.priority || "normal") }, webpush: { fcmOptions: { link: n.route || "/" } } });
    const invalid = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
    await Promise.all(result.responses.map((r,i) => !r.success && r.error && invalid.has(r.error.code) ? tokenSnapshot.docs[i].ref.delete() : null));
    await snapshot.ref.update({ deliveryStatus: result.successCount ? "sent" : "failed", sentCount: result.successCount, failureCount: result.failureCount, deliveryUpdatedAt: FieldValue.serverTimestamp() });
  } catch (error) { await snapshot.ref.update({ deliveryStatus: "failed", deliveryError: error.message || String(error), deliveryUpdatedAt: FieldValue.serverTimestamp() }); }
});
exports.authorizationWorkflowNotifications = onDocumentUpdated("workflowActions/{workflowId}", async event => {
  const before = event.data.before.data(), after = event.data.after.data();
  if (after.workflowType !== "Authorization" || after.module !== "Authorization & Approvals" || before.status === after.status) return;
  const recipients = { Submitted: [after.reviewerUid, after.approverUid], "Under Review": [after.approverUid], Returned: [after.requestedByUid], Approved: [after.implementerUid, after.requestedByUid], Rejected: [after.requestedByUid], Completed: [after.requestedByUid, after.approverUid] }[after.status] || [];
  await notify({ recipientUids: recipients, type: `AUTHORIZATION_${after.status.replace(/\s+/g,"_").toUpperCase()}`, title: `Authorization ${after.status}`, body: `${after.reference || after.title || "Authorization request"} moved from ${before.status} to ${after.status}.`, module: "Authorization & Approvals", recordId: event.params.workflowId, route: "/authorization-approvals", priority: ["Rejected","Returned"].includes(after.status) ? "high" : "normal", eventKey: `${event.params.workflowId}|${after.status}|${after.workflowVersion || 1}` });
});
exports.meetingWorkflowNotifications = onDocumentUpdated("meetings/{meetingId}", async event => {
  const before = event.data.before.data(), after = event.data.after.data();
  const changed = ["status","date","startTime","endTime","venue","proceedingsStatus","votingStatus"].some(k => String(before[k] || "") !== String(after[k] || ""));
  if (!changed) return;
  const recipients = await meetingRecipients(event.params.meetingId, after); if (!recipients.length) return;
  const status = after.status || "Updated";
  await notify({ recipientUids: recipients, type: `MEETING_${String(status).replace(/\s+/g,"_").toUpperCase()}`, title: `Meeting ${status}`, body: `${after.title || "IRPA meeting"} has been updated.`, module: "Meetings", recordId: event.params.meetingId, route: "/meetings", eventKey: `${event.params.meetingId}|MEETING_UPDATE|${after.updatedAt?.seconds || Date.now()}|${status}` });
});
exports.signatureWorkflowNotifications = onDocumentUpdated("signatureEnvelopes/{envelopeId}", async event => {
  const before = event.data.before.data(), after = event.data.after.data();
  if (before.status === after.status && before.currentSignerUid === after.currentSignerUid && before.lastSignedByUid === after.lastSignedByUid) return;
  const all = after.participantUids || (after.recipients || []).map(r => r.uid).filter(Boolean);
  const recipients = after.status === "Completed" ? all.filter(x => x !== after.lastSignedByUid) : after.currentSignerUid ? [after.currentSignerUid] : all.filter(x => x !== after.lastSignedByUid);
  const type = after.status === "Completed" ? "SIGNATURE_COMPLETED" : after.lastSignedByUid ? "SIGNATURE_COMPLETED_BY_SIGNER" : "SIGNATURE_REQUESTED";
  await notify({ recipientUids: recipients, type, title: after.status === "Completed" ? "Signature process completed" : "Signature action required", body: `${after.title || "Controlled document"} is ${after.status || "in progress"}.`, module: "Signature Platform", recordId: event.params.envelopeId, route: "/signature-platform", priority: type === "SIGNATURE_REQUESTED" ? "high" : "normal", eventKey: `${event.params.envelopeId}|${type}|${after.lastSignedAt?.seconds || after.updatedAt?.seconds || Date.now()}` });
});
exports.votingWorkflowNotifications = onDocumentUpdated("votingIssues/{issueId}", async event => {
  const before = event.data.before.data(), after = event.data.after.data();
  if (before.status === after.status && before.result === after.result) return;
  const meeting = after.meetingId ? ((await db.collection("meetings").doc(after.meetingId).get()).data() || {}) : {};
  const recipients = await meetingRecipients(after.meetingId, meeting); if (!recipients.length) return;
  const closed = after.status === "Closed";
  await notify({ recipientUids: recipients, type: closed ? "VOTING_CLOSED" : "VOTING_OPENED", title: closed ? "Voting closed" : "Anonymous voting opened", body: closed ? `The voting process for ${after.votingReference || after.meetingReference || "the meeting matter"} has closed. Result: ${after.result || "Pending"}.` : `Anonymous voting is open for ${after.votingReference || after.meetingReference || "the meeting matter"}.`, module: "Voting", recordId: event.params.issueId, route: "/voting", priority: "high", eventKey: `${event.params.issueId}|${closed ? "CLOSED" : "OPENED"}|${after.result || after.status}` });
});
