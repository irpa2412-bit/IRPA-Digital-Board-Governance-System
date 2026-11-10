/**
 * Idempotent production deployment migrations.
 *
 * These routines are intended for the protected Firebase production deployment
 * job only. They compare current state before writing and emit aggregate counts.
 * They never print member identifiers, emails, UIDs, or profile contents.
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PRIMARY_ADMIN_EMAIL = "irpa2412@gmail.com";
const ORGANISATION = "Improvement of Rangeland in Pastoral Areas";

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameFields(current, expected) {
  return Object.entries(expected).every(([key, value]) => current?.[key] === value);
}
function report(name, counts) {
  console.log(name + ": " + JSON.stringify(counts));
}

async function bootstrapPrimaryAdministrator(db, auth) {
  const counts = { profilesCreated: 0, profilesUpdated: 0, profilesUnchanged: 0, claimsUpdated: 0, claimsUnchanged: 0 };
  const user = await auth.getUserByEmail(PRIMARY_ADMIN_EMAIL);
  const ref = db.collection("adminProfiles").doc(user.uid);
  const expected = {
    uid: user.uid, email: PRIMARY_ADMIN_EMAIL, name: "IRPA Primary Administrator",
    role: "Administrator", active: true,
    createdByUid: PRIMARY_ADMIN_EMAIL, createdByEmail: PRIMARY_ADMIN_EMAIL
  };
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({ ...expected, updatedAt: FieldValue.serverTimestamp() });
    counts.profilesCreated += 1;
  } else if (!sameFields(existing.data(), expected)) {
    await ref.set({ ...expected, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    counts.profilesUpdated += 1;
  } else {
    counts.profilesUnchanged += 1;
  }
  const claims = user.customClaims || {};
  if (claims.admin !== true) {
    await auth.setCustomUserClaims(user.uid, { ...claims, admin: true });
    counts.claimsUpdated += 1;
  } else {
    counts.claimsUnchanged += 1;
  }
  report("PRIMARY_ADMIN_BOOTSTRAP", counts);
}

function addRoles(rolesByUid, uid, data) {
  if (!uid) return;
  const values = [
    data?.role,
    ...(Array.isArray(data?.roles) ? data.roles : []),
    ...(Array.isArray(data?.assignedRoles) ? data.assignedRoles : []),
    ...(Array.isArray(data?.selectedRoles) ? data.selectedRoles : []),
    ...(Array.isArray(data?.roleAssignments) ? data.roleAssignments : [])
  ].flatMap(value => String(value || "").split(",").map(role => role.trim()).filter(Boolean));
  const current = rolesByUid.get(uid) || new Set();
  values.forEach(role => current.add(role));
  rolesByUid.set(uid, current);
}

async function synchronizeClaims(db, auth) {
  const counts = {
    membersRead: 0, employeesRead: 0, uidLinksWritten: 0, uidLinksUnchanged: 0,
    missingEmail: 0, authUserNotFound: 0, rolesCollected: 0,
    claimsWritten: 0, claimsUnchanged: 0, adminClaimsWritten: 0, errors: 0
  };
  const rolesByUid = new Map();
  for (const collectionName of ["members", "employees"]) {
    const snapshot = await db.collection(collectionName).get();
    counts[collectionName + "Read"] = snapshot.size;
    for (const document of snapshot.docs) {
      const data = document.data() || {};
      let uid = String(data.uid || document.id || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      if (!email) {
        counts.missingEmail += 1;
      } else {
        try {
          const authUser = await auth.getUserByEmail(email);
          uid = authUser.uid;
          if (String(data.uid || "").trim() !== uid) {
            await document.ref.set({
              uid,
              firebaseAuthEmail: email,
              uidAssignmentStatus: "UID Linked — Deployment Claim Synchronization"
            }, { merge: true });
            counts.uidLinksWritten += 1;
          } else {
            counts.uidLinksUnchanged += 1;
          }
        } catch (error) {
          if (error?.code === "auth/user-not-found") counts.authUserNotFound += 1;
          else throw error;
        }
      }
      const status = String(data.status || data.employmentStatus || data.registrationStatus || "").toLowerCase();
      if (uid && status !== "inactive" && status !== "disabled") addRoles(rolesByUid, uid, data);
    }
  }
  const adminSnapshot = await db.collection("adminProfiles").get();
  const adminUids = new Set(adminSnapshot.docs.filter(document => document.data()?.active === true).map(document => document.id));
  for (const [uid, roleSet] of rolesByUid.entries()) {
    try {
      const user = await auth.getUser(uid);
      const previous = user.customClaims || {};
      const roles = [...roleSet].slice(0, 60);
      const claims = { ...previous, irpaRoles: roles };
      const shouldKeepAdmin = adminUids.has(uid) || String(user.email || "").toLowerCase() === PRIMARY_ADMIN_EMAIL || previous.admin === true;
      if (shouldKeepAdmin) claims.admin = true;
      const sameRoles = sameArray(previous.irpaRoles, roles);
      const sameAdmin = !shouldKeepAdmin || previous.admin === true;
      if (!sameRoles || !sameAdmin) {
        await auth.setCustomUserClaims(uid, claims);
        counts.claimsWritten += 1;
      } else {
        counts.claimsUnchanged += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.warn("Role claim synchronization failed; details redacted.");
    }
  }
  for (const uid of adminUids) {
    if (rolesByUid.has(uid)) continue;
    try {
      const user = await auth.getUser(uid);
      const previous = user.customClaims || {};
      if (previous.admin !== true) {
        await auth.setCustomUserClaims(uid, { ...previous, admin: true });
        counts.adminClaimsWritten += 1;
      } else {
        counts.claimsUnchanged += 1;
      }
    } catch {
      counts.errors += 1;
      console.warn("Administrator claim synchronization failed; details redacted.");
    }
  }
  counts.rolesCollected = rolesByUid.size;
  report("MEMBER_EMPLOYEE_AND_ROLE_CLAIM_SYNC", counts);
}

async function backfillSignerAuthorization(db) {
  const snapshot = await db.collection("signatureEnvelopes").get();
  const writer = db.bulkWriter();
  const counts = { scanned: snapshot.size, writesQueued: 0, unchanged: 0 };
  for (const document of snapshot.docs) {
    const data = document.data() || {};
    const actionUids = [...new Set((Array.isArray(data.fields) ? data.fields : [])
      .map(field => String(field?.signerUid || "").trim()).filter(Boolean))];
    const existing = Array.isArray(data.actionUids) ? data.actionUids : [];
    if (!sameArray(existing, actionUids)) {
      writer.update(document.ref, { actionUids, updatedAt: FieldValue.serverTimestamp() });
      counts.writesQueued += 1;
    } else {
      counts.unchanged += 1;
    }
  }
  await writer.close();
  counts.writesCommitted = counts.writesQueued;
  report("SIGNATURE_ENVELOPE_AUTHORIZATION_BACKFILL", counts);
}

async function migrateSignerProfiles(db) {
  const profiles = await db.collection("signatureProfiles").get();
  const writer = db.bulkWriter();
  const counts = { scanned: profiles.size, created: 0, updated: 0, unchanged: 0, skippedMissingUid: 0 };
  for (const profileDocument of profiles.docs) {
    const profile = profileDocument.data() || {};
    const uid = String(profile.uid || profileDocument.id).trim();
    if (!uid) {
      counts.skippedMissingUid += 1;
      continue;
    }
    const expected = {
      uid,
      signerProfileId: uid,
      signerName: String(profile.displayName || profile.email || "Signer"),
      email: String(profile.email || ""),
      organisationName: ORGANISATION,
      signatureStatus: String(profile.status || "Profile Setup Required"),
      revocationStatus: profile.status === "Revoked" ? "Revoked" : "Active",
      revocationReason: String(profile.revocationReason || ""),
      currentSignatureHash: profile.signatureSha256 || null,
      migratedFromSignatureProfile: true
    };
    const target = await db.collection("signerIdentities").doc(uid).get();
    if (!target.exists) {
      writer.set(target.ref, { ...expected, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      counts.created += 1;
    } else if (!sameFields(target.data(), expected)) {
      writer.set(target.ref, { ...expected, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      counts.updated += 1;
    } else {
      counts.unchanged += 1;
    }
  }
  await writer.close();
  report("SIGNER_PROFILE_MIGRATION", counts);
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is required.");
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== "irpa-digital-board-governance") {
    throw new Error("Refusing to run deployment migrations against an unexpected Firebase project.");
  }
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const auth = getAuth();
  await bootstrapPrimaryAdministrator(db, auth);
  await synchronizeClaims(db, auth);
  await backfillSignerAuthorization(db);
  await migrateSignerProfiles(db);
}

main().catch(error => {
  console.error("Deployment migration failed:", error.message);
  process.exitCode = 1;
});
