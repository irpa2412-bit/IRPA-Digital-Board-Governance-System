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

export const INVITATION_STATE = Object.freeze({
  PENDING: "PENDING",
  PASSWORD_SETUP_PENDING: "PASSWORD_SETUP_PENDING",
  PROVISIONING_PENDING: "PROVISIONING_PENDING",
  ACTIVATED: "ACTIVATED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED"
});

export const INVITATION_STATUS = Object.freeze({
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  PASSWORD_SETUP_PENDING: "Password Setup Pending",
  PROVISIONING_PENDING: "Provisioning Pending",
  ACTIVATED: "Activated",
  CANCELLED: "Cancelled",
  REVOKED: "Revoked"
});

export const INVITATION_ROLE = Object.freeze({
  ADMINISTRATOR: "Administrator",
  BOARD_MEMBER: "Board Member",
  BOARD_CHAIRPERSON: "Board Chairperson",
  BOARD_SECRETARY: "Board Secretary",
  BOARD_TREASURER: "Board Treasurer",
  BOARD_VICE_CHAIRPERSON: "Board Vice Chairperson",
  EXECUTIVE_DIRECTOR: "Executive Director",
  DIRECTOR_HUMAN_RESOURCES: "Director Human Resources",
  DIRECTOR_LIVESTOCK: "Director Livestock",
  DIRECTOR_ENVIRONMENT: "Director Environment",
  DIRECTOR_OUTREACH: "Director Outreach",
  DIRECTOR_COMMUNITY_DEVELOPMENT: "Director Community Development",
  DIRECTOR_FIELD_OPERATIONS: "Director Field Operations",
  HR_MANAGER: "HR Manager",
  DIRECTOR_FINANCE_ADMINISTRATION: "Director Finance & Administration",
  FINANCE_PERSONNEL: "Finance Personnel",
  FINANCE_MANAGER: "Finance Manager",
  ACCOUNTANT: "Accountant",
  FINANCE_OFFICER: "Finance Officer",
  DIRECTOR_INTERNAL_OVERSIGHT: "Director Internal Oversight",
  INTERNAL_OVERSIGHT_OFFICER: "Internal Oversight Officer",
  SECRETARIAT: "Secretariat",
  PROCUREMENT_OFFICER: "Procurement Officer",
  PROGRAMME_TECHNICAL_OFFICER: "Programme/Technical Officer",
  MANAGEMENT: "Management",
  OPERATIONS_MANAGER: "Operations Manager",
  IT_SPECIALIST: "IT Specialist",
  INFORMATION_TECHNOLOGY_OFFICER: "Information Technology Officer",
  DRIVER: "Driver",
  FIELD_ASSISTANT: "Field Assistant",
  ADMINISTRATIVE_ASSISTANT: "Administrative Assistant",
  COMMUNICATIONS_OFFICER: "Communications Officer",
  MONITORING_EVALUATION_OFFICER: "Monitoring & Evaluation Officer",
  PROJECT_OFFICER: "Project Officer",
  RANGELAND_OFFICER: "Rangeland Officer",
  LIVESTOCK_OFFICER: "Livestock Officer",
  OUTREACH_OFFICER: "Outreach Officer",
  COMMUNITY_DEVELOPMENT_OFFICER: "Community Development Officer",
  ENVIRONMENT_OFFICER: "Environment Officer",
  HR_OFFICER: "HR Officer",
  EMPLOYEE: "Employee",
  AUDITOR: "Auditor",
  SPECIAL_INVITEE: "Special Invitee"
});

export const INVITATION_EMPLOYEE_ROLES = Object.freeze([
  INVITATION_ROLE.EXECUTIVE_DIRECTOR,
  INVITATION_ROLE.DIRECTOR_HUMAN_RESOURCES,
  INVITATION_ROLE.DIRECTOR_LIVESTOCK,
  INVITATION_ROLE.DIRECTOR_ENVIRONMENT,
  INVITATION_ROLE.DIRECTOR_OUTREACH,
  INVITATION_ROLE.DIRECTOR_COMMUNITY_DEVELOPMENT,
  INVITATION_ROLE.DIRECTOR_FIELD_OPERATIONS,
  INVITATION_ROLE.HR_MANAGER,
  INVITATION_ROLE.DIRECTOR_FINANCE_ADMINISTRATION,
  INVITATION_ROLE.FINANCE_PERSONNEL,
  INVITATION_ROLE.FINANCE_MANAGER,
  INVITATION_ROLE.ACCOUNTANT,
  INVITATION_ROLE.FINANCE_OFFICER,
  INVITATION_ROLE.DIRECTOR_INTERNAL_OVERSIGHT,
  INVITATION_ROLE.INTERNAL_OVERSIGHT_OFFICER,
  INVITATION_ROLE.SECRETARIAT,
  INVITATION_ROLE.PROCUREMENT_OFFICER,
  INVITATION_ROLE.PROGRAMME_TECHNICAL_OFFICER,
  INVITATION_ROLE.MANAGEMENT,
  INVITATION_ROLE.OPERATIONS_MANAGER,
  INVITATION_ROLE.IT_SPECIALIST,
  INVITATION_ROLE.INFORMATION_TECHNOLOGY_OFFICER,
  INVITATION_ROLE.DRIVER,
  INVITATION_ROLE.FIELD_ASSISTANT,
  INVITATION_ROLE.ADMINISTRATIVE_ASSISTANT,
  INVITATION_ROLE.COMMUNICATIONS_OFFICER,
  INVITATION_ROLE.MONITORING_EVALUATION_OFFICER,
  INVITATION_ROLE.PROJECT_OFFICER,
  INVITATION_ROLE.RANGELAND_OFFICER,
  INVITATION_ROLE.LIVESTOCK_OFFICER,
  INVITATION_ROLE.OUTREACH_OFFICER,
  INVITATION_ROLE.COMMUNITY_DEVELOPMENT_OFFICER,
  INVITATION_ROLE.ENVIRONMENT_OFFICER,
  INVITATION_ROLE.HR_OFFICER,
  INVITATION_ROLE.EMPLOYEE
]);
