import { auth } from "./config";

export const LINK_DEFINITIONS = [
  ["meetingId", "meetingReference", "Meetings"],
  ["participantId", "participantReference", "Participants"],
  ["resolutionId", "resolutionReference", "Resolutions"],
  ["votingIssueId", "votingReference", "Voting"],
  ["decisionId", "decisionReference", "Decisions"],
  ["actionId", "actionReference", "Actions"],
  ["documentId", "documentReference", "Documents"],
  ["signatureEnvelopeId", "signatureReference", "Signature Platform"],
  ["authorizationRequestId", "authorizationReference", "Authorization & Approvals"],
  ["employeeUid", "employeeNumber", "Employee Payments"],
  ["procurementId", "procurementReference", "Procurement"],
  ["reportId", "reportReference", "Reports"]
];

export const LINK_FIELDS = LINK_DEFINITIONS.flatMap(([id, reference]) => [id, reference]);

export function workflowLinks(input = {}) {
  const links = {};
  for (const [idField, referenceField] of LINK_DEFINITIONS) {
    const id = input[idField];
    const reference = input[referenceField];
    if ((id !== undefined && id !== null && String(id).trim() !== "") || (reference !== undefined && reference !== null && String(reference).trim() !== "")) {
      if (id !== undefined && id !== null && String(id).trim() !== "") links[idField] = id;
      if (reference !== undefined && reference !== null && String(reference).trim() !== "") links[referenceField] = reference;
    }
  }
  return links;
}

export function workflowLinkEntries(input = {}) {
  const links = workflowLinks(input);
  return LINK_DEFINITIONS
    .filter(([idField, referenceField]) => links[idField] || links[referenceField])
    .map(([idField, referenceField, module]) => ({
      module,
      id: links[idField] || null,
      reference: links[referenceField] || links[idField] || ""
    }));
}

export function withWorkflowLinks(data = {}, links = {}) {
  const merged = { ...data, ...workflowLinks(links) };
  const normalized = workflowLinks(merged);
  return {
    ...merged,
    workflowLinks: normalized,
    linkedWorkflowModules: workflowLinkEntries(normalized).map(x => x.module)
  };
}

export function actorLink() {
  return { actorUid: auth.currentUser?.uid || null, actorEmail: auth.currentUser?.email || null };
}

export function navigateWorkflow(module, context = {}) {
  const safeContext = workflowLinks(context);
  try {
    if (Object.keys(safeContext).length) {
      sessionStorage.setItem("irpaWorkflowContext", JSON.stringify({ module, ...safeContext, updatedAt: new Date().toISOString() }));
    } else {
      sessionStorage.removeItem("irpaWorkflowContext");
    }
  } catch { /* session storage may be unavailable; navigation still works */ }
  window.dispatchEvent(new CustomEvent("irpa:navigate", { detail: { module, context: safeContext } }));
}

export function readWorkflowContext() {
  try {
    const raw = sessionStorage.getItem("irpaWorkflowContext");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearWorkflowContext() {
  try { sessionStorage.removeItem("irpaWorkflowContext"); } catch { /* no-op */ }
}
