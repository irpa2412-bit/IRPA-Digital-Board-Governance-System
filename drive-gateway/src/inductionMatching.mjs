function plainValue(value) {
  if (value == null) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(plainValue);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k, plainValue(v)]));
  return null;
}
function plainDocument(document) {
  if (!document?.fields) return null;
  return { id: String(document.name || "").split("/").pop(), ...Object.fromEntries(Object.entries(document.fields).map(([k,v]) => [k, plainValue(v)])) };
}
function publicInvitation(invitation) {
  if (!invitation) return null;
  const allowed = ["id", "name", "email", "status", "role", "department", "expiresAt", "createdAt"];
  return Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(invitation, key)).map(key => [key, invitation[key]]));
}
async function queryByEmail(env, projectId, collectionName, email, token) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collectionName }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } }, limit: 25 } })
  });
  if (!response.ok) throw new Error(`Unable to read the ${collectionName} register for induction matching.`);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).filter(row => row.document).map(row => plainDocument(row.document));
}
export function createInductionMatchingRouter({ authenticateFirebaseRequest, getFirebaseProjectId, getFirestoreAdminAccessToken, getFirestoreDocument, json, corsHeaders }) {
  return async function routeInductionMatching(request, env, pathname) {
    if (pathname !== "/api/induction/matching-records") return null;
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, corsHeaders(request));
    let claims;
    try { claims = await authenticateFirebaseRequest(request, env, { skipActivation: true }); }
    catch { return json({ ok: false, error: "Authentication is required." }, 401, corsHeaders(request)); }
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "A valid JSON request is required." }, 400, corsHeaders(request)); }
    const invitationId = String(body?.invitationId || "").trim();
    const suppliedEmail = String(body?.email || "").trim().toLowerCase();
    if (!invitationId && !suppliedEmail) return json({ ok: false, error: "An invitation ID or registered email is required." }, 400, corsHeaders(request));
    const emailFromToken = String(claims.email || "").trim().toLowerCase();
    const projectId = getFirebaseProjectId(env);
    const privilegedToken = await getFirestoreAdminAccessToken(env);
    const adminDoc = await getFirestoreDocument(env, "adminProfiles/" + String(claims.user_id || ""), privilegedToken);
    const isActiveAdmin = adminDoc?.fields?.active?.booleanValue === true;
    let invitation = null;
    if (invitationId) {
      const raw = await getFirestoreDocument(env, "invitations/" + encodeURIComponent(invitationId), privilegedToken);
      invitation = plainDocument(raw);
      if (!invitation) return json({ ok: false, error: "The invitation record was not found." }, 404, corsHeaders(request));
      if (!emailFromToken && !isActiveAdmin) {
        const expiry = invitation.expiresAt == null || invitation.expiresAt === "" ? null : Date.parse(invitation.expiresAt);
        if (invitation.status !== "Pending" || (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now()))) {
          return json({ ok: false, error: "This invitation can no longer be used for verification." }, 403, corsHeaders(request));
        }
      }
    }
    const targetEmail = String(invitation?.email || suppliedEmail || "").trim().toLowerCase();
    if (!targetEmail || (!isActiveAdmin && (emailFromToken ? targetEmail !== emailFromToken : !invitationId))) {
      return json({ ok: false, error: "You may only verify induction records linked to your authenticated email address." }, 403, corsHeaders(request));
    }
    if (invitation && suppliedEmail && suppliedEmail !== targetEmail) return json({ ok: false, error: "The supplied email does not match the invitation record." }, 400, corsHeaders(request));
    const [employees, members] = await Promise.all([
      queryByEmail(env, projectId, "employees", targetEmail, privilegedToken),
      queryByEmail(env, projectId, "members", targetEmail, privilegedToken)
    ]);
    const name = String(invitation?.name || "").trim().toLowerCase();
    return json({
      ok: true,
      invitation: publicInvitation(invitation),
      employees: employees.map(x => ({ id: x.id, uid: x.uid || null, name: x.name || "", email: x.email || targetEmail, employeeNumber: x.employeeNumber || "", role: x.role || "", roles: Array.isArray(x.roles) ? x.roles : [], department: x.department || "", unit: x.unit || "", employmentType: x.employmentType || "", status: x.status || "", registrationStatus: x.registrationStatus || "" })),
      members: members.map(x => ({ id: x.id, uid: x.uid || null, name: x.name || "", email: x.email || targetEmail, memberNumber: x.memberNumber || "", memberType: x.memberType || "", role: x.role || "", roles: Array.isArray(x.roles) ? x.roles : [], department: x.department || "", unit: x.unit || "", boardMember: Boolean(x.boardMember), status: x.status || "", registrationStatus: x.registrationStatus || "" })),
      exactNameMatch: [...employees, ...members].some(x => String(x.name || "").trim().toLowerCase() === name)
    }, 200, corsHeaders(request));
  };
}
