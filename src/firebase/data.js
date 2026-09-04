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
  updateDoc
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
  systemSettings: "systemSettings"
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
  const ref = await addDoc(
    collection(db, collectionName),
    {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }
  );

  await writeAudit(
    "CREATE",
    collectionName,
    ref.id,
    data
  );

  return ref.id;
}

export async function getRecord(collectionName, id) {
  const snapshot = await getDoc(
    doc(db, collectionName, id)
  );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

export async function getRecords(collectionName) {
  const q = query(
    collection(db, collectionName),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));
}

export async function updateRecord(collectionName, id, data) {
  await updateDoc(
    doc(db, collectionName, id),
    {
      ...data,
      updatedAt: serverTimestamp()
    }
  );

  await writeAudit(
    "UPDATE",
    collectionName,
    id,
    data
  );
}

export async function deleteRecord(collectionName, id) {
  await deleteDoc(
    doc(db, collectionName, id)
  );

  await writeAudit(
    "DELETE",
    collectionName,
    id
  );
}

export async function getAdminProfile(uid) {
  const snapshot = await getDoc(
    doc(db, COLLECTIONS.adminProfiles, uid)
  );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}
