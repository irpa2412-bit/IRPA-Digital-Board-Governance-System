import { auth } from "./config";

export const LINK_FIELDS = [
  "meetingId", "meetingReference",
  "participantId", "participantReference",
  "resolutionId", "resolutionReference",
  "votingIssueId", "votingReference",
  "decisionId", "decisionReference",
  "actionId", "actionReference",
  "documentId", "documentReference",
  "signatureEnvelopeId", "signatureReference",
  "authorizationRequestId", "authorizationReference",
  "employeeUid", "employeeNumber",
  "procurementId", "procurementReference",
  "reportId", "reportReference"
];

export function workflowLinks(input = {}) {
  const links = {};
  for (const key of LINK_FIELDS) {
    if (input[key] !== undefined && input[key] !== null && String(input[key]).trim() !== "") links[key] = input[key];
  }
  return links;
}

export function withWorkflowLinks(data = {}, links = {}) {
  return { ...data, ...workflowLinks(links) };
}

export function actorLink() {
  return { actorUid: auth.currentUser?.uid || null, actorEmail: auth.currentUser?.email || null };
}

export function navigateWorkflow(module, context = {}) {
  const safeContext = workflowLinks(context);
  try {
    if (Object.keys(safeContext).length) sessionStorage.setItem("irpaWorkflowContext", JSON.stringify({ module, ...safeContext, updatedAt: new Date().toISOString() }));
    else sessionStorage.removeItem("irpaWorkflowContext");
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
