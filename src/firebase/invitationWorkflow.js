import { auth } from "./config";
import {
  COLLECTIONS,
  createEmployeeProfile,
  createMemberProfile,
  getRecord,
  getRecords,
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

  // Prefer the institutional personnel record explicitly attached to the invitation.
  const isBoardMember = ["Board Member","Board Chairperson","Board Secretary","Board Treasurer","Board Vice Chairperson"].includes(role);

  if (invitation.boardMemberId || invitation.institutionalRecordType === "Board Member") {
    const boardMemberId = invitation.boardMemberId || invitation.institutionalRecordId;
    const boardMember = boardMemberId ? await getRecord(COLLECTIONS.members, boardMemberId) : null;
    if (!boardMember) throw new Error("The Board Member record linked to this invitation could not be found.");
    if (boardMember.email?.trim().toLowerCase() !== email) throw new Error("The invitation email does not match the Board Member institutional record.");
    await updateRecord(COLLECTIONS.members, boardMember.id, {uid, invitationId, accountActivated:true, registrationStatus:"Activated", activatedAt:new Date().toISOString()});
    // Keep the institutional Board Member document as the canonical member record; do not create a duplicate members/{uid} document.
    await updateRecord(COLLECTIONS.invitations, invitation.id, {status:"Accepted",acceptedUid:uid,acceptedAt:new Date().toISOString(),accountActivated:true,activationCompleted:true});
    return { employee: boardMember, invitationId: invitation.id, uid };
  } else if (invitation.employeeId && !isBoardMember) {
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
    // Link an existing employee/board-member record by official email before creating anything new.
    const employees = await getRecords(COLLECTIONS.employees);
    employee = employees.find(x => String(x.email || "").trim().toLowerCase() === email) || null;
    if (employee) {
      await updateRecord(COLLECTIONS.employees, employee.id, {
        uid,
        invitationId,
        accountActivated: true,
        registrationStatus: "Activated",
        registrationEmailStatus: "Completed",
        status: employee.status || "Active",
        activatedAt: new Date().toISOString(),
      });
    } else {
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
