const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizePhone(value) {
  let phone = String(value || "").trim().replace(/[\s().-]/g, "");
  if (!phone) return "";
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (phone.startsWith("0")) phone = "+255" + phone.slice(1);
  if (/^255\d{9}$/.test(phone)) phone = "+" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "";
}
function maskPhone(value) {
  const phone = normalizePhone(value);
  return !phone ? "" : phone.length <= 6 ? "••••••" : phone.slice(0, 4) + "••••" + phone.slice(-3);
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function durableObjectCall(env, key, operation, extra = {}) {
  if (!env?.ESIGN_DO) throw new Error("Cloudflare authentication state storage is unavailable.");
  const stub = env.ESIGN_DO.get(env.ESIGN_DO.idFromName(key));
  const response = await stub.fetch("https://irpa-auth.internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, key, ...extra })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || "Password recovery rate-limit storage failed.");
  return body;
}
async function consumeWindowLimit(env, key, limit, now) {
  const result = await durableObjectCall(env, key, "auth-window-consume", {
    limit, windowMs: EMAIL_WINDOW_MS, now
  });
  return { allowed: result.allowed === true, retryAfterSeconds: Number(result.retryAfterSeconds || 0) };
}
async function consumeRecoveryRateLimit(env, email, ip, now = Date.now()) {
  const emailKey = "auth-recovery-email:" + await sha256Hex(email);
  const ipKey = "auth-recovery-ip:" + await sha256Hex(ip || "unknown");
  const emailLimit = await consumeWindowLimit(env, emailKey, EMAIL_LIMIT, now);
  if (!emailLimit.allowed) return emailLimit;
  const ipLimit = await consumeWindowLimit(env, ipKey, IP_LIMIT, now);
  if (!ipLimit.allowed) return ipLimit;
  return { allowed: true, retryAfterSeconds: 0, emailKey };
}
async function clearRecoveryRateLimit(env, email) {
  const key = "auth-recovery-email:" + await sha256Hex(email);
  await durableObjectCall(env, key, "auth-clear");
  return { ok: true };
}
async function identityToolkitRequest(fetchFn, projectId, token, action, body) {
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
function registeredPhoneFromDocuments(documents, toPlain) {
  const candidates = documents.map(document => toPlain(document) || {});
  const phones = [...new Set(candidates.map(record => normalizePhone(record.phone || record.mobile || record.mobileNumber || record.phoneNumber)).filter(Boolean))];
  if (!phones.length) {
    const error = new Error("No valid registered mobile number is available for this IRPA account. Ask an Administrator to update the registered particulars before password recovery.");
    error.status = 412; throw error;
  }
  if (phones.length > 1) {
    const error = new Error("More than one registered mobile number is associated with this account. Ask an Administrator to reconcile the registered particulars before password recovery.");
    error.status = 412; throw error;
  }
  return phones[0];
}

export function createPasswordRecoveryRouter(dependencies) {
  const {
    authenticateFirebaseRequest, getFirebaseAuthAdminAccessToken, getFirestoreAdminAccessToken,
    getFirestoreDocumentsByField, getFirebaseProjectId, firestoreDocumentToPlain,
    json, corsHeaders, fetchFn = fetch, rateLimit = consumeRecoveryRateLimit,
    clearRateLimit = clearRecoveryRateLimit
  } = dependencies;

  return async function passwordRecoveryRouter(request, env, pathname) {
    if (pathname !== "/api/auth/password-reset/prepare" && pathname !== "/api/auth/password-reset/clear") return null;
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, corsHeaders(request));
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) return json({ ok: false, error: "Enter the registered IRPA email address." }, 400, corsHeaders(request));

    if (pathname.endsWith("/prepare")) {
      try {
        const ip = String(request.headers.get("cf-connecting-ip") || "unknown");
        const limit = await rateLimit(env, email, ip);
        if (!limit.allowed) {
          return json({ ok: false, error: "Too many password-recovery attempts. Wait before trying again.", retryAfterSeconds: limit.retryAfterSeconds }, 429, corsHeaders(request));
        }

        const authToken = await getFirebaseAuthAdminAccessToken(env);
        const projectId = getFirebaseProjectId(env);
        const lookup = await identityToolkitRequest(fetchFn, projectId, authToken, "lookup", { email: [email] });
        if (!lookup.response.ok) {
          const errorMessage = String(lookup.result?.error?.message || "");
          if (/USER_NOT_FOUND|EMAIL_NOT_FOUND/i.test(errorMessage)) {
            return json({ ok: false, error: "No registered IRPA account was found for that email address." }, 404, corsHeaders(request));
          }
          throw new Error("Firebase Authentication account lookup failed.");
        }
        const user = Array.isArray(lookup.result.users) ? lookup.result.users.find(item => normalizeEmail(item.email) === email) : null;
        if (!user?.localId) return json({ ok: false, error: "No registered IRPA account was found for that email address." }, 404, corsHeaders(request));

        const firestoreToken = await getFirestoreAdminAccessToken(env);
        const [memberDocuments, employeeDocuments] = await Promise.all([
          getFirestoreDocumentsByField(env, "members", "email", email, firestoreToken, 5),
          getFirestoreDocumentsByField(env, "employees", "email", email, firestoreToken, 5)
        ]);
        const registeredPhone = registeredPhoneFromDocuments([...memberDocuments, ...employeeDocuments], firestoreDocumentToPlain);
        const authPhone = normalizePhone(user.phoneNumber);
        if (authPhone && authPhone !== registeredPhone) {
          return json({ ok: false, error: "The Firebase Authentication mobile number does not match the system-registered mobile number. Administrator reconciliation is required before password recovery." }, 412, corsHeaders(request));
        }
        if (!authPhone) {
          const update = await identityToolkitRequest(fetchFn, projectId, authToken, "update", {
            localId: user.localId, phoneNumber: registeredPhone
          });
          if (!update.response.ok) {
            return json({ ok: false, error: "The registered mobile number could not be attached to the Firebase Authentication identity. Ask an Administrator to reconcile the account." }, 412, corsHeaders(request));
          }
        }
        return json({
          ok: true, phoneNumber: registeredPhone, maskedPhone: maskPhone(registeredPhone),
          uid: user.localId, otpProvider: "Firebase Authentication SMS"
        }, 200, corsHeaders(request));
      } catch (error) {
        return json({ ok: false, error: String(error?.message || "Password recovery preparation failed.") }, Number(error?.status || 0) || 500, corsHeaders(request));
      }
    }

    try {
      let claims;
      try { claims = await authenticateFirebaseRequest(request, env, { skipActivation: true }); }
      catch { return json({ ok: false, error: "Verified mobile authentication is required." }, 401, corsHeaders(request)); }
      const verifiedPhone = normalizePhone(claims?.firebaseClaims?.phoneNumber);
      if (!verifiedPhone) return json({ ok: false, error: "Verified mobile authentication is required." }, 401, corsHeaders(request));
      const firestoreToken = await getFirestoreAdminAccessToken(env);
      const [memberDocuments, employeeDocuments] = await Promise.all([
        getFirestoreDocumentsByField(env, "members", "email", email, firestoreToken, 5),
        getFirestoreDocumentsByField(env, "employees", "email", email, firestoreToken, 5)
      ]);
      const registeredPhone = registeredPhoneFromDocuments([...memberDocuments, ...employeeDocuments], firestoreDocumentToPlain);
      if (verifiedPhone !== registeredPhone) return json({ ok: false, error: "The verified mobile number does not match the registered IRPA mobile number." }, 403, corsHeaders(request));
      await clearRateLimit(env, email);
      return json({ ok: true }, 200, corsHeaders(request));
    } catch (error) {
      return json({ ok: false, error: String(error?.message || "Password recovery verification could not be confirmed.") }, Number(error?.status || 0) || 500, corsHeaders(request));
    }
  };
}
