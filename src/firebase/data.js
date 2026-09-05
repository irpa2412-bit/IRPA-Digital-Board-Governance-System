import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  setDoc
} from "firebase/firestore";

import { auth, db } from "./config";

export const COLLECTIONS = {
  members: "members",
  employees: "employees",
  participants: "participants",
  meetings: "meetings",
  meetingSubscriptions: "meetingSubscriptions",
  meetingRoomEvents: "meetingRoomEvents",
  transcriptions: "transcriptions",
  resolutions: "resolutions",
  votes: "votes",
  voteLocks: "voteLocks",
  actions: "actions",
  documents: "documents",
  signatures: "signatures",
  decisions: "decisions",
  risks: "risks",
  audit: "audit",
  reports: "reports",
  authorizationRequests: "authorizationRequests",
  workflowActions: "workflowActions",
  staffPaymentRequests: "staffPaymentRequests",
  financeBudgets: "financeBudgets",
  financeTransactions: "financeTransactions",
  financeFunding: "financeFunding",
  financeApprovals: "financeApprovals",
  financeCommitments: "financeCommitments",
  financeGrants: "financeGrants",
  financeBankAccounts: "financeBankAccounts",
  financeReconciliations: "financeReconciliations",
  financeAssets: "financeAssets",
  financeRisks: "financeRisks",
  financeReports: "financeReports",
  invitations: "invitations",
  adminProfiles: "adminProfiles",
  systemSettings: "systemSettings"
};

function currentActor() {
  return { uid: auth.currentUser?.uid || null, email: auth.currentUser?.email || null };
}

async function writeAudit(action, collectionName, recordId, details = {}) {
  const actor = currentActor();
  await addDoc(collection(db, COLLECTIONS.audit), {
    action, collection: collectionName, recordId, details,
    actorUid: actor.uid, actorEmail: actor.email, createdAt: serverTimestamp()
  });
}

export async function createRecord(collectionName, data) {
  const ref = await addDoc(collection(db, collectionName), {
    ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  await writeAudit("CREATE", collectionName, ref.id, data);
  return ref.id;
}

export async function createMemberProfile(uid, data) {
  if (!uid) throw new Error("A Firebase Authentication UID is required.");
  await setDoc(doc(db, COLLECTIONS.members, uid), {
    ...data, uid, memberType: data.memberType || "Governance Member",
    createdAt: data.createdAt || serverTimestamp(), updatedAt: serverTimestamp()
  }, { merge: true });
  await writeAudit("CREATE_OR_UPDATE_MEMBER_PROFILE", COLLECTIONS.members, uid, { ...data, uid });
  return uid;
}

export async function provisionCurrentMemberFromInvitation(invitationId) {
  const uid = auth.currentUser?.uid;
  const email = auth.currentUser?.email?.trim().toLowerCase();
  if (!uid || !email || !invitationId) return null;
  const invitation = await getRecord(COLLECTIONS.invitations, invitationId);
  if (!invitation) throw new Error("The member invitation could not be found.");
  if (invitation.email?.trim().toLowerCase() !== email) throw new Error("This invitation is not assigned to the authenticated email address.");
  if (invitation.status === "Cancelled") throw new Error("This member invitation has been cancelled.");
  return createMemberProfile(uid, {
    invitationId, email, name: invitation.name || "",
    role: invitation.role || "Board Member", memberType: invitation.memberType || "Governance Member", status: "Active"
  });
}

export async function getRecord(collectionName, id) {
  const snapshot = await getDoc(doc(db, collectionName, id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getRecords(collectionName) {
  const snapshot = await getDocs(query(collection(db, collectionName), orderBy("createdAt", "desc")));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function updateRecord(collectionName, id, data) {
  await updateDoc(doc(db, collectionName, id), { ...data, updatedAt: serverTimestamp() });
  await writeAudit("UPDATE", collectionName, id, data);
}

export async function deleteRecord(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
  await writeAudit("DELETE", collectionName, id);
}

export async function getAdminProfile(uid) {
  if (!uid) return null;
  return getRecord(COLLECTIONS.adminProfiles, uid);
}

export async function getCurrentMemberProfile() {
  const uid = auth.currentUser?.uid;
  return uid ? getRecord(COLLECTIONS.members, uid) : null;
}
