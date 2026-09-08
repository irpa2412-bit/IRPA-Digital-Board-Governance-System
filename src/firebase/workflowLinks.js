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

export function navigateWorkflow(module) {
  window.dispatchEvent(new CustomEvent("irpa:navigate", { detail: module }));
}
