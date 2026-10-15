const STAGING_FIREBASE_CONFIG = {"apiKey":"AIzaSyA6UmHtP-mRr99rBw57_-qrD4_mFSBnZ38","authDomain":"irpa-dbg-staging-a73ec.firebaseapp.com","projectId":"irpa-dbg-staging-a73ec","storageBucket":"irpa-dbg-staging-a73ec.firebasestorage.app","messagingSenderId":"1018976634858","appId":"1:1018976634858:web:e73e9e09f55a76ade25493"};

export function renderStagingAdminResetPage(testUid) {
  const uid = String(testUid || "");
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) throw new Error("Invalid staging test UID.");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Cache-Control" content="no-store,no-cache,must-revalidate,max-age=0">
<title>IRPA Staging Administrator Recovery Test</title>
<style>
:root{font-family:system-ui,sans-serif;color:#18251d;background:#f1f5f2}*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center}.card{width:min(620px,100%);background:white;border:1px solid #d5e0d8;border-radius:16px;padding:24px;box-shadow:0 10px 35px #18251d12}h1{font-size:24px;margin:8px 0}.tag{font-size:12px;font-weight:800;letter-spacing:.12em;color:#28613d}.warn{padding:12px;background:#fff7df;border:1px solid #ead79c;border-radius:10px;line-height:1.45}label{display:block;font-weight:700;margin:16px 0 6px}input,textarea{font:inherit;width:100%;padding:11px;border:1px solid #aebdb2;border-radius:8px}textarea{min-height:88px}button{font:inherit;font-weight:700;padding:12px 16px;border:0;border-radius:8px;background:#28613d;color:white;margin-top:16px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.secondary{background:#e8f0ea;color:#1f4d2f}.status{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:16px;padding:12px;border-radius:8px;background:#f0f4f1;min-height:24px}.muted{font-size:13px;color:#5b675f;line-height:1.5}.hidden{display:none}
</style>
</head>
<body>
<main class="card">
<div class="tag">IRPA · ISOLATED STAGING</div>
<h1>Administrator registration recovery test</h1>
<p class="muted">This controlled test targets only the dedicated staging test profile shown below. It never sends the recovery secret to this browser.</p>
<div class="warn"><strong>Destructive test action:</strong> the first confirmed request sets this staging profile's <code>active</code> field to false. It does not delete the Firebase Authentication account or other profile fields. Do not use this page for a production account.</div>
<p><strong>Fixed staging target UID:</strong><br><code id="targetUid">__TEST_UID__</code></p>
<section id="loginPanel">
<label for="email">Designated recovery operator</label>
<input id="email" type="email" value="irpa2412@gmail.com" readonly autocomplete="username">
<label for="password">Operator password</label>
<input id="password" type="password" autocomplete="current-password" required>
<button id="signIn">Authenticate freshly</button>
<p class="muted">Credentials are sent directly to Firebase Authentication over HTTPS. The password is not stored, logged, or sent to this recovery endpoint.</p>
</section>
<section id="actionPanel" class="hidden">
<p id="operatorState" class="muted"></p>
<label for="reason">Reason for this staging verification (20–500 characters)</label>
<textarea id="reason" maxlength="500">Controlled staging verification of administrator registration recovery, audit integrity, and idempotency.</textarea>
<label for="confirmation">Type exactly: RESET ADMIN REGISTRATION ONLY</label>
<input id="confirmation" autocomplete="off">
<label><input id="confirmCheck" type="checkbox" style="width:auto"> I understand this will deactivate only the staging test profile.</label>
<button id="runReset">Execute staging recovery test</button>
<button id="replay" class="secondary hidden">Repeat same operation to verify idempotency</button>
</section>
<div id="status" class="status" role="status" aria-live="polite">Not authenticated. No recovery request has been made.</div>
</main>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
const config = __STAGING_FIREBASE_CONFIG__;
const app = initializeApp(config);
const auth = getAuth(app);
await setPersistence(auth, inMemoryPersistence);
const operatorEmail = "irpa2412@gmail.com";
const targetUid = "__TEST_UID__";
const statusNode = document.getElementById("status");
const signInButton = document.getElementById("signIn");
const runButton = document.getElementById("runReset");
const replayButton = document.getElementById("replay");
let operator = null;
let lastPayload = null;
let operationCompleted = false;
function showStatus(value) { statusNode.textContent = value; }
function setBusy(value) { signInButton.disabled = value; runButton.disabled = value; replayButton.disabled = value; }
async function invoke(payload) {
  if (!operator || (operator.email || "").toLowerCase() !== operatorEmail) throw new Error("Designated operator authentication is required.");
  const token = await operator.getIdToken(true);
  const response = await fetch("/api/admin-registration/reset-staging-test", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "omit",
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error("Recovery request rejected (HTTP " + response.status + "): " + String(result.error || "unexpected response"));
  return result;
}
signInButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    await signOut(auth).catch(() => {});
    const password = document.getElementById("password");
    const credential = await signInWithEmailAndPassword(auth, operatorEmail, password.value);
    password.value = "";
    if ((credential.user.email || "").toLowerCase() !== operatorEmail) {
      await signOut(auth);
      throw new Error("Authenticated account is not the designated recovery operator.");
    }
    operator = credential.user;
    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("actionPanel").classList.remove("hidden");
    document.getElementById("operatorState").textContent = "Fresh Firebase sign-in completed for " + operatorEmail + ". The recovery secret remains on the server.";
    showStatus("Operator authenticated. Review the target, reason, and explicit confirmation before executing.");
  } catch (error) {
    document.getElementById("password").value = "";
    showStatus("Authentication failed. " + String(error && error.message || "Check the sign-in and try again."));
  } finally { setBusy(false); }
});
runButton.addEventListener("click", async () => {
  const reason = document.getElementById("reason").value.trim();
  if (!document.getElementById("confirmCheck").checked) { showStatus("Check the staging-only confirmation box first."); return; }
  if (document.getElementById("confirmation").value !== "RESET ADMIN REGISTRATION ONLY") { showStatus("The explicit confirmation text does not match."); return; }
  if (reason.length < 20 || reason.length > 500) { showStatus("Provide a reason between 20 and 500 characters."); return; }
  lastPayload = { targetUid, operationId: crypto.randomUUID(), confirmation: "RESET ADMIN REGISTRATION ONLY", reason };
  setBusy(true);
  try {
    const result = await invoke(lastPayload);
    showStatus(JSON.stringify(result, null, 2) + " | Operation ID for audit verification: " + lastPayload.operationId);
    operationCompleted = true;
    replayButton.classList.remove("hidden");
    runButton.disabled = true;
  } catch (error) {
    showStatus(String(error && error.message || "Recovery request failed."));
  } finally { setBusy(false); if (operationCompleted) runButton.disabled = true; }
});
replayButton.addEventListener("click", async () => {
  if (!lastPayload) { showStatus("No completed operation is available to replay."); return; }
  setBusy(true);
  try {
    const result = await invoke(lastPayload);
    showStatus("Idempotency replay result (same operation ID and payload): " + JSON.stringify(result, null, 2));
  } catch (error) {
    showStatus(String(error && error.message || "Replay verification failed."));
  } finally { setBusy(false); }
});
</script>
</body>
</html>`.replaceAll("__TEST_UID__", uid).replace("__STAGING_FIREBASE_CONFIG__", JSON.stringify(STAGING_FIREBASE_CONFIG));
}

export const STAGING_ADMIN_RESET_TEST_UID = "qv5soS4LGra78iNqJpAVq0RpMUv1";
