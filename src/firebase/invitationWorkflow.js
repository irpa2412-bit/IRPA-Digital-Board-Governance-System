import { auth } from "./config";
import {
  COLLECTIONS,
  createEmployeeProfile,
  createMemberProfile,
  getRecord,
  updateRecord,
} from "./data";

const EMPLOYEE_ROLES = [
  "Executive Director",
  "Director Human Resources",
  "HR Manager",
  "Director Finance & Administration",
  "Finance Personnel",
  "Finance Manager",
  "Accountant",
  "Finance Officer",
  "Director Internal Oversight",
  "Internal Oversight Officer",
  "Secretariat",
  "Procurement Officer",
  "Programme/Technical Officer",
  "Management",
  "Operations Manager",
  "Rangeland Officer",
  "Livestock Officer",
  "Outreach Officer",
  "Community Development Officer",
  "Environment Officer",
  "HR Officer",
  "Employee",
];

export async function provisionCurrentMemberFromInvitationV2(invitationId) {
  const uid = auth.currentUser?.uid;
  const email = auth.currentUser?.email?.trim().toLowerCase();
  if (!uid || !email || !invitationId) return null;

  const invitation = await getRecord(COLLECTIONS.invitations, invitationId);
  if (!invitation) throw new Error("The member invitation could not be found.");
  if (invitation.email?.trim().toLowerCase() !== email) {
    throw new Error("This invitation is not assigned to the authenticated email address.");
  }
  if (invitation.status === "Cancelled") {
    throw new Error("This member invitation has been cancelled.");
  }

  const role = invitation.role || "Board Member";
  const memberType = invitation.memberType || "Governance Member";
  let employee = null;

  // Link the authenticated account to the existing institutional personnel record.
  if (invitation.employeeId) {
    employee = await getRecord(COLLECTIONS.employees, invitation.employeeId);
    if (!employee) throw new Error("The institutional personnel record linked to this invitation could not be found.");
    if (employee.email?.trim().toLowerCase() !== email) {
      throw new Error("The invitation email does not match the institutional personnel record.");
    }

    await updateRecord(COLLECTIONS.employees, employee.id, {
      uid,
      invitationId,
      accountActivated: true,
      registrationStatus: "Activated",
      registrationEmailStatus: "Completed",
      status: employee.status || "Active",
      activatedAt: new Date().toISOString(),
    });
  } else if (EMPLOYEE_ROLES.includes(role)) {
    employee = await createEmployeeProfile({
      uid,
      email,
      name: invitation.name || "",
      role,
      department: invitation.department || "",
      employmentType: invitation.employmentType || "Employee",
      status: "Active",
      registrationStatus: "Activated",
      invitationId,
    });
  }

  await createMemberProfile(uid, {
    invitationId,
    employeeId: employee?.id || null,
    email,
    name: invitation.name || employee?.name || "",
    role,
    memberType,
    status: "Active",
    activatedAt: new Date().toISOString(),
  });

  await updateRecord(COLLECTIONS.invitations, invitation.id, {
    status: "Accepted",
    acceptedUid: uid,
    acceptedAt: new Date().toISOString(),
    accountActivated: true,
    activationCompleted: true,
  });

  return { employee, invitationId: invitation.id, uid };
}
