export function classifyRegisteredIdentityRecord({ email, existingUid, authUsers = [] }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const uid = String(existingUid || "").trim();
  if (uid) {
    const byUid = authUsers.find(user => String(user?.uid || "") === uid);
    if (!byUid) return { status: "conflicting", reason: "Existing UID was not found in Firebase Authentication; UID preserved." };
    const authEmail = String(byUid.email || "").trim().toLowerCase();
    if (!normalizedEmail || authEmail !== normalizedEmail) {
      return { status: "conflicting", reason: "Existing UID email does not exactly match the register email; UID preserved." };
    }
    return { status: "already-assigned", uid, reason: "Existing UID matches the exact normalized email; no change made." };
  }
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { status: "unresolved", reason: "Missing or invalid register email; no UID assigned." };
  }
  const matches = authUsers.filter(user => String(user?.email || "").trim().toLowerCase() === normalizedEmail);
  if (matches.length !== 1) {
    return { status: matches.length > 1 ? "conflicting" : "unresolved", reason: matches.length > 1 ? "Multiple Firebase Authentication accounts match this email; no UID assigned." : "No existing Firebase Authentication account matches this exact email; no UID assigned." };
  }
  return { status: "assigned", uid: String(matches[0].uid), reason: "Assigned the unique existing Firebase Authentication UID for the exact normalized email." };
}

export function summarizeIdentityReconciliation(results = []) {
  return results.reduce((summary, item) => {
    summary.total++;
    if (item.status === "assigned") summary.assigned++;
    else if (item.status === "already-assigned") summary.alreadyAssigned++;
    else if (item.status === "unresolved") summary.unresolved++;
    else if (item.status === "conflicting") summary.conflicting++;
    else summary.errors++;
    return summary;
  }, { total: 0, assigned: 0, alreadyAssigned: 0, unresolved: 0, conflicting: 0, errors: 0 });
}
