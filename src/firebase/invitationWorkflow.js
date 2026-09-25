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
  "Director Livestock",
  "Director Environment",
  "Director Outreach",
  "Director Community Development",
  "Director Field Operations",
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
  "IT Specialist",
  "Information Technology Officer",
  "Driver",
  "Field Assistant",
  "Administrative Assistant",
  "Communications Officer",
  "Monitoring & Evaluation Officer",
  "Project Officer",
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

    // A person may legitimately hold both a Board role and an Employee role.
    // The Board Member register remains canonical for the governance record, but
    // the same Firebase UID is also attached to the matching Employee record so
    // the authorization layer can resolve both role families after activation.
    const employeeSnap = await getDocs(query(collection(db, COLLECTIONS.employees), where("email", "==", email)));
    for (const d of employeeSnap.docs) {
      await updateRecord(COLLECTIONS.employees, d.id, {
        uid, invitationId, accountActivated:true, registrationStatus:"Activated", registrationEmailStatus:"Completed", activatedAt:new Date().toISOString()
      }, {touchUpdatedAt:false, audit:false});
    }

    // Keep the institutional Board Member document as the canonical member record;
    // do not create a duplicate members/{uid} document.
    await updateRecord(COLLECTIONS.invitations, invitation.id, {
      status:"Activated",acceptedUid:uid,acceptedAt:new Date().toISOString(),accountActivated:true,activationCompleted:true
    }, {touchUpdatedAt:false, audit:false});
    return { employee: boardMember, invitationId: invitation.id, uid };
  } else if (invitation.employeeId || invitation.institutionalRecordType === "Employee" || EMPLOYEE_ROLES.includes(role)) {
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

    // A person may legitimately hold both an Employee role and a Board role.
    // If a Board Member institutional record exists for the same verified email,
    // attach the same Firebase UID to it as well. This does not create a duplicate
    // governance record; it simply links the two authoritative registers to one
    // authenticated person.
    const boardSnap = await getDocs(query(collection(db, COLLECTIONS.members), where("email", "==", email)));
    for (const d of boardSnap.docs) {
      const data = d.data() || {};
      if (data.boardMember === true || data.boardPosition || data.department === "Board of Directors" || String(data.role || "").toLowerCase().includes("board")) {
        await updateRecord(COLLECTIONS.members, d.id, {
          uid,
          invitationId,
          accountActivated: true,
          registrationStatus: "Activated",
          activatedAt: new Date().toISOString(),
        }, { touchUpdatedAt:false, audit:false });
      }
    }

    // The Employees Register remains authoritative for the employee record.
    // No duplicate members/{uid} document is created.
  } else {
    // Non-board/non-employee invitation roles (for example Technical Advisor or
    // Observer) still receive a minimal authorization profile without invoking the
    // legacy member-number generator or unrestricted collection scans.
    const memberRef = doc(db, COLLECTIONS.members, uid);
    const existingMember = await getRecord(COLLECTIONS.members, uid);
    if (!existingMember) {
      await setDoc(memberRef, {
        uid,
        invitationId,
        email,
        name: invitation.name || "",
        role,
        memberType,
        status: "Active",
        accountActivated: true,
        registrationStatus: "Activated",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        activatedAt: new Date().toISOString(),
      });
    }
  }

  await updateRecord(COLLECTIONS.invitations, invitation.id, {
    status: "Activated",
    acceptedUid: uid,
    acceptedAt: new Date().toISOString(),
    accountActivated: true,
    activationCompleted: true,
  }, { touchUpdatedAt: false, audit: false });

  return { employee, invitationId: invitation.id, uid };
}
