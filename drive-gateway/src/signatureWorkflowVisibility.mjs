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
const isApplied = field => Boolean(field?.applied === true || field?.isApplied === true || field?.signed === true || field?.valueApplied === true || field?.appliedAt || field?.signedAt || field?.completedAt || field?.signatureApplied === true || field?.signatureData || field?.signatureImage || field?.signatureUrl || field?.signatureImageUrl || field?.signatureDataUrl || field?.initialsData || field?.initialsImage || field?.initialsUrl || field?.signedValue);
const hideUnappliedValue = field => {
  const placeholder = { ...field };
  for (const key of ["value", "fieldValue", "signature", "signatureData", "signatureImage", "signatureUrl", "signatureImageUrl", "signatureDataUrl", "initials", "initialsData", "initialsImage", "initialsUrl", "signedValue", "appliedAt", "signedAt", "completedAt", "signatureApplied", "isApplied", "applied", "valueApplied"]) delete placeholder[key];
  return placeholder;
};
/** Server-side least-privilege envelope view. */
export function filterSignatureEnvelopeForCaller(envelope, { authenticatedUid, authenticatedEmails = [], isAdmin = false } = {}) {
  const actor = uidOf(authenticatedUid);
  const emails = new Set((Array.isArray(authenticatedEmails)?authenticatedEmails:[]).map(x=>String(x||"").trim().toLowerCase()).filter(Boolean));
  if ((!actor && !emails.size) || !envelope || typeof envelope !== "object") return { allowed: false, reason: "missing_identity_or_envelope" };
  const owner = uidOf(envelope.ownerUid), sender = uidOf(envelope.senderUid);
  const emailOf = value => String(value||"").trim().toLowerCase();
  const ownerEmails = [envelope.ownerEmail,envelope.senderEmail,envelope.createdByEmail,envelope.email].map(emailOf).filter(Boolean);
  const recipients = Array.isArray(envelope.recipients) ? envelope.recipients : [];
  const signers = Array.isArray(envelope.signers) ? envelope.signers : [];
  const participants = new Set([...(Array.isArray(envelope.participantUids) ? envelope.participantUids : []), ...(Array.isArray(envelope.actionUids) ? envelope.actionUids : []), ...recipients.map(r => r?.uid)].map(uidOf).filter(Boolean));
  const participantEmails = new Set([...recipients.map(r=>emailOf(r?.email)),...signers.map(r=>emailOf(r?.email)),...(Array.isArray(envelope.participantEmails)?envelope.participantEmails:[]).map(emailOf)].filter(Boolean));
  if (isAdmin === true || (actor && (actor === owner || actor === sender)) || ownerEmails.some(email=>emails.has(email))) return { allowed: true, view: { ...envelope }, scope: "full" };
  const matchingRecipient = recipients.find(r=>emails.has(emailOf(r?.email)));
  if (!(actor && participants.has(actor)) && !matchingRecipient && ![...participantEmails].some(email=>emails.has(email))) return { allowed: false, reason: "not_a_participant" };
  const order = recipients.map(r => uidOf(r?.uid)).filter(Boolean);
  const actorIndex = actor ? order.indexOf(actor) : Math.max(0,recipients.findIndex(r=>emails.has(emailOf(r?.email))));
  const signed = signedUidSet(envelope), earlierSigned = new Set();
  for (let i = 0; i < (actorIndex < 0 ? 0 : actorIndex); i++) if (signed.has(order[i])) earlierSigned.add(order[i]);
  const fields = Array.isArray(envelope.fields) ? envelope.fields : [];
  const ownFields = fields.filter(field => uidOf(field?.signerUid) === actor || emails.has(emailOf(field?.signerEmail))).map(hideUnappliedValue);
  const priorAppliedFields = fields.filter(field => earlierSigned.has(uidOf(field?.signerUid)) && isApplied(field));
  const visibleUids = new Set([actor, ...earlierSigned].filter(Boolean));
  const view = { ...envelope, recipients: recipients.filter(r => visibleUids.has(uidOf(r?.uid)) || emails.has(emailOf(r?.email))).map(r => ({ ...r })), participantUids: [...visibleUids], actionUids: actor?[actor]:[], fields: [...ownFields, ...priorAppliedFields], workflowHistory: (Array.isArray(envelope.workflowHistory) ? envelope.workflowHistory : []).filter(entry => visibleUids.has(uidOf(entry?.uid || entry?.signerUid)) || emails.has(emailOf(entry?.email))), visibilityScope: "signer" };
  // Older draft schemas may duplicate the hierarchy under additional top-level
  // keys. Strip those aliases too, otherwise a filtered recipients/fields array
  // could coexist with an unfiltered copy of the future workflow.
  for (const key of ["signers", "signerAssignments", "signerHierarchy", "workflowLadder", "assignments", "participantEmails", "signerEmails", "futureSigners", "pendingSigners", "workflowAssignments", "actionAssignments"]) delete view[key];
  view.fields = [...new Map(view.fields.map(field => [uidOf(field?.fieldId) || JSON.stringify(field), field])).values()];
  return { allowed: true, view, scope: "signer" };
}
