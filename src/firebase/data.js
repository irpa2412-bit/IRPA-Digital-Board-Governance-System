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
  decisions: "decisions",
  risks: "risks",
  audit: "audit",
  reports: "reports",
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
  signatures: "signatures",
  invitations: "invitations",
  adminProfiles: "adminProfiles",
  systemSettings: "systemSettings",
  authorizationRequests: "authorizationRequests",
  workflowActions: "workflowActions"
};

function currentActor() {
  return {
    uid: auth.currentUser?.uid || null,
    email: auth.currentUser?.email || null
  };
}

async function writeAudit(action, collectionName, recordId, details = {}) {
  const actor = currentActor();
  await addDoc(collection(db, COLLECTIONS.audit), {
    action,
    collection: collectionName,
    recordId,
    details,
    actorUid: actor.uid,
    actorEmail: actor.email,
    createdAt: serverTimestamp()
  });
}

export async function createRecord(collectionName, data) {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await writeAudit("CREATE", collectionName, ref.id, data);
  return ref.id;
}

export async function createMemberProfile(uid, data) {
  if (!uid) throw new Error("A Firebase Authentication UID is required.");
  const memberRef = doc(db, COLLECTIONS.members, uid);
  await setDoc(memberRef, {
    ...data,
    uid,
    memberType: data.memberType || "Governance Member",
    createdAt: data.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
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
  if (invitation.email?.trim().toLowerCase() !== email) {
    throw new Error("This invitation is not assigned to the authenticated email address.");
  }
  if (invitation.status === "Cancelled") {
    throw new Error("This member invitation has been cancelled.");
  }

  return await createMemberProfile(uid, {
    invitationId,
    email,
    name: invitation.name || "",
    role: invitation.role || "Board Member",
    memberType: invitation.memberType || "Governance Member",
    status: "Active"
  });
}

export async function getRecord(collectionName, id) {
  const snapshot = await getDoc(doc(db, collectionName, id));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getRecords(collectionName) {
  const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function updateRecord(collectionName, id, data) {
  await updateDoc(doc(db, collectionName, id), {
    ...data,
    updatedAt: serverTimestamp()
  });
  await writeAudit("UPDATE", collectionName, id, data);
}

export async function deleteRecord(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
  await writeAudit("DELETE", collectionName, id);
}

export async function getAdminProfile(uid) {
  if (!uid) return null;
  const snapshot = await getDoc(doc(db, COLLECTIONS.adminProfiles, uid));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getCurrentMemberProfile() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  return await getRecord(COLLECTIONS.members, uid);
}
