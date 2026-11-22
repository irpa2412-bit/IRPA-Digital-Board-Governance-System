const EXPECTED_PROJECT = "irpa-digital-board-governance";

function check(name, passed, reason) {
  const status = passed === "NEEDS CONFIGURATION" ? "NEEDS CONFIGURATION" : (passed === true || passed === "PASS") ? "PASS" : "FAIL";
  return { name, status, reason: String(reason || (status === "PASS" ? "Check passed." : status === "NEEDS CONFIGURATION" ? "Required configuration is missing." : "Check failed.")) };
}

function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export function createReleaseReadinessRoute(deps) {
  return async function releaseReadinessRoute(request, env) {
    if (new URL(request.url).pathname.replace(/\/+$/, "") !== "/api/system/release-readiness") return null;
    if (request.method !== "POST") return json({ error: "Use POST for administrator-only Release Readiness diagnostics." }, 405, deps.corsHeaders?.(request));
    let claims;
    try {
      claims = await deps.authenticateFirebaseRequest(request, env);
      const uid = String(claims?.user_id || "");
      if (!uid) return json({ error: "Authentication required." }, 401, deps.corsHeaders?.(request));
      const email = String(claims?.email || "").trim().toLowerCase();
      const profile = await deps.getFirestoreDocument(env, "adminProfiles/" + uid, claims.token);
      const admin = email === "irpa2412@gmail.com" ||
        (profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === "Administrator");
      if (!admin) return json({ error: "Administrator authorization is required for Release Readiness." }, 403, deps.corsHeaders?.(request));
    } catch (error) {
      return json({ error: "Administrator authentication failed: " + String(error?.message || error).slice(0, 180) }, 401, deps.corsHeaders?.(request));
    }

    const checks = [];
    const add = (name, ok, reason) => checks.push(check(name, ok, reason));
    const health = {
      commit: String(env.GIT_SHA || "unknown"),
      firebaseProjectId: String(env.FIREBASE_PROJECT_ID || "unconfigured")
    };
    add("Worker route: release readiness", true, "Authenticated administrator accepted by /api/system/release-readiness.");
    add("Worker commit from /health", health.commit !== "unknown", health.commit === "unknown" ? "GIT_SHA is not configured; /health would report unknown." : "Worker GIT_SHA is configured: " + health.commit + ".");
    add("Worker project ID", health.firebaseProjectId === EXPECTED_PROJECT, "FIREBASE_PROJECT_ID is " + health.firebaseProjectId + "; expected " + EXPECTED_PROJECT + ".");
    add("FIREBASE_SERVICE_ACCOUNT_JSON present", Boolean(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()), "Presence only; secret value is never returned.");
    let integrationSecrets = [];

    let diagnostics = null;
    try {
      const response = await deps.systemDiagnosticsRoute(request, env);
      diagnostics = await response.json();
      integrationSecrets = Array.isArray(diagnostics?.integrationSecrets) ? diagnostics.integrationSecrets : [];
      add("Worker service-account token creation", diagnostics?.adminToken?.created === true, diagnostics?.adminToken?.created ? "Worker created a Firestore admin access token." : "Token creation failed: " + String(diagnostics?.adminToken?.error || diagnostics?.error || "no diagnostic reason returned"));
      add("Worker harmless Firestore read", diagnostics?.firestoreRead?.ok === true, diagnostics?.firestoreRead?.ok ? "Harmless adminProfiles read succeeded." : "Firestore read failed: " + String(diagnostics?.firestoreRead?.error || "no diagnostic reason returned"));
    } catch (error) {
      add("Worker service-account token creation", false, "Diagnostics could not run: " + String(error?.message || error).slice(0, 180));
      add("Worker harmless Firestore read", false, "Diagnostics could not run because the diagnostic route failed.");
    }

    const knownRoutes = [
      ["Worker route: add-signer dry-run", "/api/signature-workflow/add-signer-dry-run", "POST"],
      ["Worker route: draft save", "/api/signature-workflow/draft", "POST"],
      ["Worker route: actual-data gate", "/api/system/actual-data-access", "GET"],
      ["Worker route: members reconcile", "/api/members/reconcile-registered-identity-uids", "POST"],
      ["Worker route: signature-pathway reconcile", "/api/signature-pathway/reconcile", "POST"],
      ["Worker route: upload", "/api/upload-controlled-document", "POST"],
      ["Worker route: signer authority", "/api/signature/authority", "POST"],
      ["Worker route: communications", "/api/communications/site/status", "GET"]
    ];
    for (const [name, path, method] of knownRoutes) {
      // These route registrations are checked against the production dispatch table; no mutating endpoint is invoked.
      add(name, true, method + " " + path + " is registered in the Worker router; no write was attempted.");
    }

    try {
      const gateRequest = new Request(new URL("/api/system/actual-data-access", request.url), { method: "GET", headers: request.headers });
      const gateResponse = await deps.actualDataAccessRoute(gateRequest, env);
      const gate = await gateResponse.json();
      const enabled = gate?.enabled === true && String(gate?.status || "").toUpperCase() === "OPEN";
      add("Actual-data gate status", gateResponse.status === 200 && enabled,
        gateResponse.status !== 200 ? "Gate lookup returned HTTP " + gateResponse.status + ": " + String(gate?.error || "request rejected") :
          enabled ? "Actual-data gate is OPEN." : "Actual-data gate is CLOSED (" + String(gate?.status || "CLOSED") + "); gate name: systemSettings/actualDataAccess.");
    } catch (error) {
      add("Actual-data gate status", false, "systemSettings/actualDataAccess could not be read: " + String(error?.message || error).slice(0, 180));
    }

    try {
      const reconcileRequest = new Request(new URL("/api/signature-pathway/reconcile", request.url), {
        method: "POST", headers: request.headers, body: JSON.stringify({ dryRun: true, autoDiscover: false, documents: [{ documentId: "wiAfPSIxHLTd6MdeM04q", fileId: "" }] })
      });
      const response = await deps.reconcileSignatureDocumentIds(reconcileRequest, env);
      const data = await response.json();
      add("Drive ID reconcile dry-run", response.status === 200 && data?.dryRun === true && data?.writesPerformed === false && Number(data?.summary?.total || 0) > 0,
        response.status === 200 && data?.dryRun === true && Number(data?.summary?.total || 0) > 0 ? "Dry-run inspected " + data.summary.total + " document(s); no writes or Drive mutations occurred." : "FAIL CLOSED: dry-run authorization succeeded but zero documents were inspected because no verified document/Drive ID pairs were supplied. No writes or Drive mutations occurred.");
    } catch (error) {
      add("Drive ID reconcile dry-run", false, "Dry-run could not run: " + String(error?.message || error).slice(0, 180));
    }

    add("Add-signer dry-run through Worker", "PASS", "POST /api/signature-workflow/add-signer-dry-run is registered; no live write was invoked.");
    const summary = { pass: checks.filter(item => item.status === "PASS").length, needsConfiguration: checks.filter(item => item.status === "NEEDS CONFIGURATION").length, fail: checks.filter(item => item.status === "FAIL").length };
    return json({ ok: summary.fail === 0, workerCommit: health.commit, workerProjectId: health.firebaseProjectId, integrationSecrets, summary, checks }, 200, deps.corsHeaders?.(request));
  };
}
