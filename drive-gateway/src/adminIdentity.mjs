const PRIMARY_ADMIN_EMAIL = "irpa2412@gmail.com";

function firestoreString(value) { return { stringValue: String(value ?? "") }; }

function parseCustomAttributes(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid custom attributes.");
    return parsed;
  } catch {
    throw new Error("The Firebase Authentication custom-claims record could not be safely parsed.");
  }
}

async function postIdentityToolkit(fetchFn, projectId, token, action, body) {
  const response = await fetchFn(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:${action}`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

export function createBootstrapPrimaryAdministratorRoute(dependencies) {
  const {
    authenticateFirebaseRequest, getFirebaseAuthAdminAccessToken, getFirestoreAdminAccessToken,
    getFirebaseProjectId, json, corsHeaders, fetchFn = fetch
  } = dependencies;

  return async function bootstrapPrimaryAdministratorRoute(request, env) {
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, corsHeaders(request));
    let claims;
    try {
      claims = await authenticateFirebaseRequest(request, env, { skipActivation: true });
    } catch (error) {
      const message = String(error?.message || error);
      const invalid = message === "Firebase authentication is required." || message.startsWith("Invalid Firebase") ||
        message === "Firebase token is expired." || message === "Firebase token signing key not found.";
      if (invalid) return json({ ok: false, error: "Google authentication is required." }, 401, corsHeaders(request));
      throw error;
    }

    const uid = String(claims?.user_id || "").trim();
    const email = String(claims?.email || "").trim().toLowerCase();
    if (!uid) return json({ ok: false, error: "Google authentication is required." }, 401, corsHeaders(request));
    if (email !== PRIMARY_ADMIN_EMAIL) {
      return json({ ok: false, error: "This Google account is not the designated IRPA primary administrator." }, 403, corsHeaders(request));
    }

    const projectId = getFirebaseProjectId(env);
    const authToken = await getFirebaseAuthAdminAccessToken(env);
    const lookup = await postIdentityToolkit(fetchFn, projectId, authToken, "lookup", { localId: [uid] });
    if (!lookup.response.ok) {
      return json({ ok: false, error: "Firebase Authentication could not verify the primary administrator account." }, 502, corsHeaders(request));
    }
    const user = Array.isArray(lookup.result.users) ? lookup.result.users.find(item => String(item.localId || "") === uid) : null;
    if (!user) return json({ ok: false, error: "The designated primary administrator account was not found." }, 404, corsHeaders(request));

    const previousClaims = parseCustomAttributes(user.customAttributes);
    const nextClaims = { ...previousClaims, admin: true };
    const updatedAuth = await postIdentityToolkit(fetchFn, projectId, authToken, "update", {
      localId: uid,
      customAttributes: JSON.stringify(nextClaims)
    });
    if (!updatedAuth.response.ok) {
      return json({ ok: false, error: "The primary administrator authorization claim could not be updated." }, 502, corsHeaders(request));
    }

    try {
      const firestoreToken = await getFirestoreAdminAccessToken(env);
      const base = `projects/${projectId}/databases/(default)/documents`;
      const profile = {
        uid: firestoreString(uid),
        email: firestoreString(email),
        name: firestoreString(user.displayName || "IRPA Primary Administrator"),
        role: firestoreString("Administrator"),
        active: { booleanValue: true },
        createdByUid: firestoreString(uid),
        createdByEmail: firestoreString(email),
        updatedAt: { timestampValue: new Date().toISOString() }
      };
      const auditId = "primary-admin-bootstrap-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8);
      const audit = {
        action: firestoreString("PRIMARY_ADMINISTRATOR_BOOTSTRAPPED"),
        category: firestoreString("SYSTEM_SECURITY"),
        description: firestoreString("The designated primary IRPA administrator bootstrap was completed through the Cloudflare Gateway."),
        actorUid: firestoreString(uid),
        actorEmail: firestoreString(email),
        recordId: firestoreString(uid),
        createdAt: { timestampValue: new Date().toISOString() }
      };
      const response = await fetchFn(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: "POST",
        headers: { Authorization: "Bearer " + firestoreToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          writes: [
            { update: { name: base + "/adminProfiles/" + uid, fields: profile }, updateMask: { fieldPaths: Object.keys(profile) } },
            { update: { name: base + "/audit/" + auditId, fields: audit }, currentDocument: { exists: false } }
          ]
        })
      });
      if (!response.ok) throw new Error("The administrator profile and audit records could not be committed.");
      return json({ ok: true, uid, email }, 200, corsHeaders(request));
    } catch (error) {
      const rollback = await postIdentityToolkit(fetchFn, projectId, authToken, "update", {
        localId: uid,
        customAttributes: JSON.stringify(previousClaims)
      }).catch(() => null);
      if (!rollback?.response?.ok) {
        console.error("Primary administrator bootstrap rollback failed", { uid, message: String(error?.message || error) });
      }
      return json({ ok: false, error: "The administrator profile could not be safely committed. The authorization change was rolled back where possible." }, 500, corsHeaders(request));
    }
  };
}
