/**
 * Canonical workflow vocabulary shared by browser clients and the Cloudflare gateway.
 * Keep persisted status and role values here; do not invent client-only variants.
 */
export const WORKFLOW_STATUS = Object.freeze({
  DRAFT: "Draft",
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  ACTIVE: "Active",
  INACTIVE: "Inactive"
});

export const WORKFLOW_ROLE = Object.freeze({
  ADMINISTRATOR: "Administrator",
  EXECUTIVE_DIRECTOR: "Executive Director",
  MEETING_SECRETARY: "Meeting Secretary",
  CHAIRPERSON: "Chairperson",
  MEETING_PARTICIPANT: "Meeting Participant",
  DOCUMENT_CONTROLLER: "Document Controller",
  SIGNATORY: "Signatory",
  AUTHORIZATION_OFFICER: "Authorization Officer"
});

export const MEETING_ROUTES = Object.freeze({
  registerWorkingDocument: "/api/meeting-working-documents/register",
  listWorkingDocuments: "/api/meeting-working-documents/list",
  reviewWorkingDocument: "/api/meeting-working-documents/review",
  signAttendance: "/api/meeting-attendance/sign",
  attendanceRegister: "/api/meeting-attendance/register"
});

export const DOCUMENT_ROUTES = Object.freeze({
  list: "/api/document-lifecycle/list",
  get: "/api/document-lifecycle/get",
  upload: "/api/document-lifecycle/upload",
  download: "/api/document-lifecycle/download"
});

export const SIGNATURE_ROUTES = Object.freeze({
  upload: "/api/upload"
});

export function normalizeWorkflowStatus(value) {
  const candidate = String(value ?? "").trim().toLowerCase();
  return Object.values(WORKFLOW_STATUS).find(status => status.toLowerCase() === candidate) ?? null;
}

export function isWorkflowRole(value) {
  const candidate = String(value ?? "").trim().toLowerCase();
  return Object.values(WORKFLOW_ROLE).some(role => role.toLowerCase() === candidate);
}
