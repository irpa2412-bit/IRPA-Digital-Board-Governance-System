import { auth, db } from "./config";
import { getGoogleDriveGatewayUrl } from "./gatewayUrl";
import { addDoc, collection, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";

export async function sendMemberInvitationEmail(_email, invitationId, _role, _memberType, meetingAccess = null, options = {}) {
  const cleanId = String(invitationId || "").trim();
  if (!cleanId) throw new Error("The invitation ID is required.");
  if (!auth.currentUser) throw new Error("Administrator authentication is required.");
  const gateway = getGoogleDriveGatewayUrl();
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${gateway}/api/invitations/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId: cleanId, ...(meetingAccess ? { meetingAccess } : {}), ...(options.forceResend === true ? { forceResend: true } : {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "The IRPA mail server could not send the invitation.");
    return data;
  } catch (error) {
    console.error("IRPA member invitation sender error", { firebaseErrorCode: error?.code || "" });
    throw new Error(error?.message || "The IRPA invitation email could not be sent. Please try again.");
  }
}

export async function sendEmployeeRegistrationEmail(email, employeeNumber) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanEmployeeNumber = String(employeeNumber || "").trim();
  if (!cleanEmail || !cleanEmployeeNumber) throw new Error("Employee email and employee number are required.");

  const employeeQuery = await getDocs(query(
    collection(db, "employees"),
    where("employeeNumber", "==", cleanEmployeeNumber),
    where("email", "==", cleanEmail)
  ));
  if (employeeQuery.empty) throw new Error("The Employee Register record could not be verified for this invitation.");

  const employeeDoc = employeeQuery.docs[0];
  const employee = employeeDoc.data() || {};
  let invitationId = String(employee.invitationId || "").trim();

  if (!invitationId) {
    const invitationRef = await addDoc(collection(db, "invitations"), {
      email: cleanEmail,
      name: String(employee.name || "").trim(),
      role: String(employee.role || "Employee").trim(),
      memberType: String(employee.memberType || "Management").trim(),
      department: employee.department || null,
      unit: employee.unit || null,
      employeeId: employeeDoc.id,
      institutionalRecordType: "Employee",
      institutionalRecordId: employeeDoc.id,
      source: "Employees' Register",
      status: "Pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    invitationId = invitationRef.id;
    await updateDoc(employeeDoc.ref, { invitationId, invitationDeliveryMode: "Dedicated Invitation Token", updatedAt: serverTimestamp() });
  }

  const result = await sendMemberInvitationEmail(
    cleanEmail,
    invitationId,
    String(employee.role || "Employee").trim(),
    String(employee.memberType || "Management").trim()
  );
  return { ...(result || {}), invitationId, accountCreated: false };
}
