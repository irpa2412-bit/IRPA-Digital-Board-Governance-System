const uidOf = value => String(value || "").trim();
const signedUidSet = envelope => {
  const signed = new Set();
  for (const recipient of Array.isArray(envelope?.recipients) ? envelope.recipients : []) {
    const uid = uidOf(recipient?.uid);
    if (uid && (String(recipient?.status || "").toLowerCase() === "signed" || recipient?.signedAt || recipient?.completedAt)) signed.add(uid);
  }
  for (const entry of Array.isArray(envelope?.workflowHistory) ? envelope.workflowHistory : []) {
    const uid = uidOf(entry?.uid || entry?.signerUid);
    if (uid && (entry?.signedAt || entry?.completedAt || /signed|completed/i.test(String(entry?.status || entry?.action || "")))) signed.add(uid);
  }
  return signed;
};
const isApplied = field => Boolean(field?.applied === true || field?.isApplied === true || field?.signed === true || field?.valueApplied === true || field?.appliedAt || field?.signedAt || field?.completedAt || field?.signatureApplied === true);
/** Server-side least-privilege envelope view. */
export function filterSignatureEnvelopeForCaller(envelope, { authenticatedUid, isAdmin = false } = {}) {
  const actor = uidOf(authenticatedUid);
  if (!actor || !envelope || typeof envelope !== "object") return { allowed: false, reason: "missing_identity_or_envelope" };
  const owner = uidOf(envelope.ownerUid), sender = uidOf(envelope.senderUid);
  const recipients = Array.isArray(envelope.recipients) ? envelope.recipients : [];
  const participants = new Set([...(Array.isArray(envelope.participantUids) ? envelope.participantUids : []), ...(Array.isArray(envelope.actionUids) ? envelope.actionUids : []), ...recipients.map(r => r?.uid)].map(uidOf).filter(Boolean));
  if (isAdmin === true || actor === owner || actor === sender) return { allowed: true, view: { ...envelope }, scope: "full" };
  if (!participants.has(actor)) return { allowed: false, reason: "not_a_participant" };
  const order = recipients.map(r => uidOf(r?.uid)).filter(Boolean);
  const actorIndex = order.indexOf(actor);
  const signed = signedUidSet(envelope), earlierSigned = new Set();
  for (let i = 0; i < (actorIndex < 0 ? 0 : actorIndex); i++) if (signed.has(order[i])) earlierSigned.add(order[i]);
  const fields = Array.isArray(envelope.fields) ? envelope.fields : [];
  const ownFields = fields.filter(field => uidOf(field?.signerUid) === actor);
  const priorAppliedFields = fields.filter(field => earlierSigned.has(uidOf(field?.signerUid)) && isApplied(field));
  const visibleUids = new Set([actor, ...earlierSigned]);
  const view = { ...envelope, recipients: recipients.filter(r => visibleUids.has(uidOf(r?.uid))).map(r => ({ ...r })), participantUids: [actor, ...earlierSigned], actionUids: [actor], fields: [...ownFields, ...priorAppliedFields], workflowHistory: (Array.isArray(envelope.workflowHistory) ? envelope.workflowHistory : []).filter(entry => visibleUids.has(uidOf(entry?.uid || entry?.signerUid))), visibilityScope: "signer" };
  // Older draft schemas may duplicate the hierarchy under additional top-level
  // keys. Strip those aliases too, otherwise a filtered recipients/fields array
  // could coexist with an unfiltered copy of the future workflow.
  for (const key of ["signers", "signerAssignments", "signerHierarchy", "workflowLadder", "assignments", "participantEmails", "signerEmails", "futureSigners", "pendingSigners", "workflowAssignments", "actionAssignments"]) delete view[key];
  view.fields = [...new Map(view.fields.map(field => [uidOf(field?.fieldId) || JSON.stringify(field), field])).values()];
  return { allowed: true, view, scope: "signer" };
}
