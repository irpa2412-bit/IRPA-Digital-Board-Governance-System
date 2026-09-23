import { auth, db } from "./config";
import { doc, getDocs, query, collection, serverTimestamp, setDoc, where } from "firebase/firestore";
import {
  COLLECTIONS,
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

  // Prefer the institutional personnel record explicitly attached to the invitation.
  const isBoardMember = ["Board Member","Board Chairperson","Board Secretary","Board Treasurer","Board Vice Chairperson"].includes(role);

  if (invitation.boardMemberId || invitation.institutionalRecordType === "Board Member" || isBoardMember) {
    const boardMemberId = invitation.boardMemberId || invitation.institutionalRecordId;
    let boardMember = boardMemberId ? await getRecord(COLLECTIONS.members, boardMemberId) : null;

    // Older invitations may not contain the Board Member document ID. Resolve the
    // institutional record by the authenticated invitation email using a constrained
    // query; never scan the members collection because recipient reads are restricted.
    if (!boardMember) {
      const { getDocs, query, collection, where } = await import("firebase/firestore");
      const { db } = await import("./config");
      const snap = await getDocs(query(collection(db, COLLECTIONS.members), where("email", "==", email)));
      const matches = snap.docs.map(x => ({id:x.id,...x.data()}));
      boardMember = matches.find(x =>
        x.boardMember === true ||
        ["Board Member","Board Chairperson","Board Secretary","Board Treasurer","Board Vice Chairperson"].includes(x.role)
      ) || null;
    }

    if (!boardMember) throw new Error("The Board Member institutional record for this invitation could not be resolved. Ask an administrator to relink the invitation to the Board Member register.");
    if (boardMember.email?.trim().toLowerCase() !== email) throw new Error("The invitation email does not match the Board Member institutional record.");

    await updateRecord(COLLECTIONS.members, boardMember.id, {
      uid, invitationId, accountActivated:true, registrationStatus:"Activated", activatedAt:new Date().toISOString()
    }, {touchUpdatedAt:false, audit:false});

    // Keep the institutional Board Member document as the canonical member record;
    // do not create a duplicate members/{uid} document.
    await updateRecord(COLLECTIONS.invitations, invitation.id, {
      status:"Accepted",acceptedUid:uid,acceptedAt:new Date().toISOString(),accountActivated:true,activationCompleted:true
    }, {touchUpdatedAt:false, audit:false});
    return { employee: boardMember, invitationId: invitation.id, uid };
  } else if (EMPLOYEE_ROLES.includes(role)) {
    // Employees follow the same controlled activation pattern as Board Members:
    // resolve the authoritative employee record by its invitation link or official
    // email, then update only the fields permitted by the recipient security rule.
    const employeeId = invitation.employeeId || invitation.institutionalRecordId;
    employee = employeeId && invitation.institutionalRecordType !== "Board Member"
      ? await getRecord(COLLECTIONS.employees, employeeId)
      : null;

    // Older invitations may not carry employeeId. Resolve them with a constrained
    // email query rather than scanning the employees collection. Firestore evaluates
    // queries against their potential result set, so the email constraint is required
    // by the employee read rule.
    if (!employee) {
      const snap = await getDocs(query(collection(db, COLLECTIONS.employees), where("email", "==", email)));
      const matches = snap.docs.map(x => ({ id: x.id, ...x.data() }));
      employee = matches.find(x =>
        String(x.email || "").trim().toLowerCase() === email &&
        (!x.role || x.role === role)
      ) || matches[0] || null;
    }

    if (!employee) {
      throw new Error("The Employee institutional record for this invitation could not be resolved. Ask an administrator to relink the invitation to the Employees Register.");
    }
    if (employee.email?.trim().toLowerCase() !== email) {
      throw new Error("The invitation email does not match the Employee institutional record.");
    }

    await updateRecord(COLLECTIONS.employees, employee.id, {
      uid,
      invitationId,
      accountActivated: true,
      registrationStatus: "Activated",
      registrationEmailStatus: "Completed",
      activatedAt: new Date().toISOString(),
    }, { touchUpdatedAt: false, audit: false });

    // The employees collection remains the authoritative personnel register.
    // A lightweight members/{uid} document is created only as the application's
    // authorization profile. Avoid the legacy member-number generator and audit write.
    const memberRef = doc(db, COLLECTIONS.members, uid);
    const existingMember = await getRecord(COLLECTIONS.members, uid);
    if (!existingMember) {
      await setDoc(memberRef, {
        uid,
        invitationId,
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber || null,
        email,
        name: invitation.name || employee.name || "",
        role,
        memberType,
        status: "Active",
        accountActivated: true,
        registrationStatus: "Activated",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        activatedAt: new Date().toISOString(),
      });
    } else if (existingMember.status !== "Active" || existingMember.invitationId !== invitationId) {
      await updateRecord(COLLECTIONS.members, existingMember.id, {
        uid,
        invitationId,
        accountActivated: true,
        registrationStatus: "Activated",
        activatedAt: new Date().toISOString(),
      }, { touchUpdatedAt: false, audit: false });
    }
  } else {
    throw new Error("This invitation does not contain a recognized IRPA employee or Board Member role.");
  }

  await updateRecord(COLLECTIONS.invitations, invitation.id, {
    status: "Accepted",
    acceptedUid: uid,
    acceptedAt: new Date().toISOString(),
    accountActivated: true,
    activationCompleted: true,
  }, { touchUpdatedAt: false, audit: false });

  return { employee, invitationId: invitation.id, uid };
}
