const clean = value => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "object") return { mapValue: { fields: firestoreFields(value) } };
  return { stringValue: String(value) };
}

function firestoreFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)]));
}

function errorResponse(deps, request, status, error) {
  return deps.json({ ok: false, error }, status, deps.corsHeaders(request));
}

function isAuthorizationOfficer(profile) {
  const status = clean(profile?.status || profile?.employmentStatus || profile?.registrationStatus).toLowerCase();
  if (["inactive", "suspended", "disabled", "rejected"].includes(status)) return false;
  const roles = [
    profile?.role,
    profile?.authorityRole,
    ...(Array.isArray(profile?.roles) ? profile.roles : []),
    ...(Array.isArray(profile?.assignedRoles) ? profile.assignedRoles : []),
    ...(Array.isArray(profile?.selectedRoles) ? profile.selectedRoles : [])
  ].map(value => clean(value).toLowerCase());
  return roles.includes("authorization officer");
}

export function createDocumentApprovalRouter(deps) {
  return async function routeDocumentApproval(request, env, pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/") {
    if (pathname !== "/api/document-lifecycle/approval/decide") return null;
    if (request.method !== "POST") return errorResponse(deps, request, 405, "POST is required.");

    let claims;
    try {
      claims = await deps.authenticateFirebaseRequest(request, env);
    } catch (error) {
      const message = clean(error?.message);
      const status = Number(error?.status) || (message.includes("authentication") || message.includes("token") ? 401 : 403);
      return errorResponse(deps, request, status, message || "Authentication is required.");
    }
    if (!claims?.user_id) return errorResponse(deps, request, 401, "Authentication is required.");

    const [adminRaw, memberRaw, employeeRaw] = await Promise.all([
      deps.getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token),
      deps.getFirestoreDocument(env, "members/" + claims.user_id, claims.token),
      deps.getFirestoreDocument(env, "employees/" + claims.user_id, claims.token)
    ]);
    const profiles = [adminRaw, memberRaw, employeeRaw].map(record => record ? deps.firestoreDocumentToPlain(record) : null).filter(Boolean);
    if (!profiles.some(isAuthorizationOfficer)) return errorResponse(deps, request, 403, "Authorization Officer role is required.");

    let body;
    try { body = await request.json(); }
    catch { return errorResponse(deps, request, 400, "A valid JSON request body is required."); }
    const documentId = clean(body?.documentId).replace(/[^A-Za-z0-9_-]/g, "");
    const decision = clean(body?.decision).toLowerCase();
    const reason = clean(body?.reason);
    if (!documentId || !["approve", "reject"].includes(decision)) {
      return errorResponse(deps, request, 400, "Document ID and a decision of approve or reject are required.");
    }
    if (decision === "reject" && !reason) return errorResponse(deps, request, 400, "A reason is required when rejecting a document.");

    const documentRaw = await deps.getFirestoreDocument(env, "documents/" + documentId, claims.token);
    const document = documentRaw ? deps.firestoreDocumentToPlain(documentRaw) : null;
    if (!document) return errorResponse(deps, request, 409, "The document does not exist.");
    if (document.approval || document.approvalStatus || document.authorizationDecision) {
      return errorResponse(deps, request, 409, "A decision has already been recorded for this document.");
    }

    const envelopeId = clean(document.signatureEnvelopeId || document.envelopeId);
    if (!envelopeId) return errorResponse(deps, request, 409, "The document has no linked signature envelope.");
    const envelopeRaw = await deps.getFirestoreDocument(env, "signatureEnvelopes/" + envelopeId, claims.token);
    const envelope = envelopeRaw ? deps.firestoreDocumentToPlain(envelopeRaw) : null;
    if (!envelope || clean(envelope.documentId) !== documentId || clean(envelope.status) !== "Completed") {
      return errorResponse(deps, request, 409, "The signature envelope must be Completed and belong to this document.");
    }

    const signerUid = clean(document.signedByUid || envelope.lastSignedByUid || envelope.completedByUid || envelope.signerUid);
    if (signerUid && signerUid === clean(claims.user_id)) {
      return errorResponse(deps, request, 403, "The signer cannot approve or reject the same document.");
    }

    const decidedAt = nowIso();
    const approval = {
      documentId,
      envelopeId,
      officerUid: clean(claims.user_id),
      decision,
      reason: reason || null,
      timestamp: decidedAt
    };
    const audit = {
      action: "DOCUMENT_APPROVAL_" + decision.toUpperCase(),
      collection: "documents",
      recordId: documentId,
      actorUid: clean(claims.user_id),
      actorEmail: claims.email || null,
      createdAt: decidedAt,
      details: { documentId, envelopeId, decision, reason: reason || null }
    };
    if (typeof deps.commitDocumentAndAudit !== "function") {
      throw new Error("Atomic approval and audit commit is not configured.");
    }
    try {
      await deps.commitDocumentAndAudit(
        env,
        documentId,
        claims.token,
        firestoreFields({ approval, approvalStatus: decision === "approve" ? "APPROVED" : "REJECTED", approvalDecisionAt: decidedAt }),
        ["approval", "approvalStatus", "approvalDecisionAt"],
        firestoreFields(audit)
      );
    } catch (error) {
      const message = clean(error?.message);
      if (/already exists|conflict|aborted|precondition/i.test(message)) {
        return errorResponse(deps, request, 409, "A decision has already been recorded for this document.");
      }
      throw error;
    }
    return deps.json({ ok: true, approval }, 200, deps.corsHeaders(request));
  };
}
