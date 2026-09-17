import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./config";

const COLLECTION = "notifications";

function actor() {
  return {
    uid: auth.currentUser?.uid || null,
    email: auth.currentUser?.email || null
  };
}

function cleanRecipients(recipientUids = []) {
  return [...new Set((Array.isArray(recipientUids) ? recipientUids : [recipientUids]).filter(Boolean).map(String))];
}

async function stableId(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createGovernanceNotifications({
  recipientUids,
  type,
  title,
  body,
  module,
  recordId = null,
  route = null,
  priority = "normal",
  eventKey = null
}) {
  const recipients = cleanRecipients(recipientUids);
  if (!recipients.length || !title || !body || !type) return [];
  const a = actor();
  const ids = [];
  for (const recipientUid of recipients) {
    const key = eventKey || `${type}|${module || ""}|${recordId || ""}|${recipientUid}`;
    const id = await stableId(key);
    await setDoc(doc(db, COLLECTION, id), {
      recipientUid,
      type,
      title: String(title),
      body: String(body),
      module: module || null,
      recordId,
      route,
      priority,
      read: false,
      createdByUid: a.uid,
      createdByEmail: a.email,
      createdAt: serverTimestamp()
    }, { merge: true });
    ids.push(id);
  }
  return ids;
}

export async function createGovernanceNotification(input) {
  return createGovernanceNotifications(input);
}

export async function notifyAuthorizationTransition({ workflow, from, to }) {
  const recipients = {
    "Submitted": [workflow.reviewerUid, workflow.approverUid],
    "Under Review": [workflow.approverUid],
    "Returned": [workflow.requestedByUid],
    "Approved": [workflow.implementerUid, workflow.requestedByUid],
    "Rejected": [workflow.requestedByUid],
    "Completed": [workflow.requestedByUid, workflow.approverUid]
  }[to] || [];
  return createGovernanceNotifications({
    recipientUids: recipients,
    type: `AUTHORIZATION_${to.replace(/\s+/g, "_").toUpperCase()}`,
    title: `Authorization ${to}`,
    body: `${workflow.reference || workflow.title || "Authorization request"} has moved from ${from || "Draft"} to ${to}.`,
    module: "Authorization & Approvals",
    recordId: workflow.id,
    route: "/authorization-approvals",
    priority: ["Rejected", "Returned"].includes(to) ? "high" : "normal",
    eventKey: `${workflow.id}|AUTHORIZATION_${to}|${workflow.workflowVersion || 1}`
  });
}

export async function notifyMeetingEvent({ recipientUids, type, title, body, recordId, route = "/meetings", priority = "normal", eventKey }) {
  return createGovernanceNotifications({ recipientUids, type, title, body, module: "Meetings", recordId, route, priority, eventKey });
}

export async function notifySignatureEvent({ recipientUids, type, title, body, recordId, route = "/signature-platform", priority = "normal", eventKey }) {
  return createGovernanceNotifications({ recipientUids, type, title, body, module: "Signature Platform", recordId, route, priority, eventKey });
}

export async function notifyVotingEvent({ recipientUids, type, title, body, recordId, route = "/voting", priority = "normal", eventKey }) {
  return createGovernanceNotifications({ recipientUids, type, title, body, module: "Voting", recordId, route, priority, eventKey });
}

export async function markNotificationRead(notificationId) {
  if (!notificationId || !auth.currentUser) throw new Error("Authentication is required.");
  await setDoc(doc(db, COLLECTION, notificationId), { read: true, readAt: serverTimestamp() }, { merge: true });
}

export async function createNotificationForSelf(input) {
  if (!auth.currentUser) throw new Error("Authentication is required.");
  return createGovernanceNotification({ ...input, recipientUids: [auth.currentUser.uid] });
}
