import React, { useEffect, useState } from "react";
import { getIdToken } from "firebase/auth";
import { auth, firebaseConfig } from "../firebase/config";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import SystemResetControl from "../components/SystemResetControl";
import DepartmentArchiveRegistry from "../components/DepartmentArchiveRegistry";
import ActualDataAccessControl from "../components/ActualDataAccessControl";
import { startGoogleDriveAuthorization } from "../firebase/signatureStorage";
import { resetDocumentTrialData, resetEmployeeTrialData, resetMemberTrialData, resetSignatureEnvelopeTrialData, createExternalAuditorProfile, getRecords, COLLECTIONS, linkAdministratorToEmployee } from "../firebase/data";
import { createAdministrator, reconcileRegisteredIdentityUids } from "../firebase/functions";

export default function Settings({ admin = false, section = "settings" }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [selectedReset, setSelectedReset] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminResult, setAdminResult] = useState(null);
  const [auditorName, setAuditorName] = useState("");
  const [identityEmployees, setIdentityEmployees] = useState([]);
  const [identityEmployeeId, setIdentityEmployeeId] = useState("");
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityResult, setIdentityResult] = useState(null);
  const [auditorEmail, setAuditorEmail] = useState("");
  const [auditorBusy, setAuditorBusy] = useState(false);
  const [auditorResult, setAuditorResult] = useState(null);
  const [liveCheckBusy, setLiveCheckBusy] = useState(false);
  const [liveCheckText, setLiveCheckText] = useState("");

  useEffect(() => {
    if (!admin || section !== "settings") return;
    (async () => {
      try {
        const rows = await getRecords(COLLECTIONS.employees);
        setIdentityEmployees(Array.isArray(rows) ? rows.filter(x => String(x.status || x.employmentStatus || x.registrationStatus || "Active").toLowerCase() !== "inactive") : []);
      } catch (error) {
        setIdentityResult({ ok: false, message: error?.message || "Unable to load Employee Register for identity linking." });
      }
    })();
  }, [admin, section]);

  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      setSupported(await browserSupportsPush());
      setPermission(notificationPermissionState());
      unsubscribe = await listenForForegroundMessages((payload) => {
        const title = payload?.notification?.title || "IRPA Digital Governance";
        const body = payload?.notification?.body || "You have a new governance notification.";
        setMessage(`${title}: ${body}`);
      });
    })();
    return () => unsubscribe();
  }, []);

  async function runLiveSystemCheck() {
    setLiveCheckBusy(true);
    const lines = [];
    const user = auth.currentUser;
    const gateway = String(getGoogleDriveGatewayUrl() || "").replace(/\/+$/, "");
    const add = value => lines.push(value);
    const requestCheck = async (label, path, method = "GET", body = null, token = null) => {
      const url = gateway + path;
      add("\n=== " + label + " ===");
      add("URL: " + url);
      try {
        const response = await fetch(url, {
          method,
          headers: {
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...(body ? { "Content-Type": "application/json" } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        const text = await response.text();
        add("HTTP status: " + response.status);
        add("Response body: " + (text || "(empty response)"));
        return { status: response.status, body: text, url };
      } catch (error) {
        const message = String(error?.message || error);
        add("HTTP status: unavailable");
        add("Error text: " + message);
        return { status: 0, body: message, url };
      }
    };
    try {
      add("LIVE SYSTEM CHECK — " + new Date().toISOString());
      add("Signed-in Firebase user: " + (user ? (user.email || "(email unavailable)") + " | UID " + user.uid : "NOT SIGNED IN"));
      add("Web Firebase project: " + String(firebaseConfig.projectId || "unavailable"));
      add("Worker URL configured by this web build: " + (gateway || "MISSING"));
      if (!user) {
        add("Administrator role check: NOT RUN — sign in to the IRPA web app first.");
        setLiveCheckText(lines.join("\n"));
        return;
      }
      if (!gateway) {
        add("Worker diagnostics stopped: gateway URL is missing.");
        setLiveCheckText(lines.join("\n"));
        return;
      }
      const token = await getIdToken(user, true);
      const health = await requestCheck("Worker health / commit / verified Firebase project", "/health");
      let healthData = {};
      try { healthData = JSON.parse(health.body); } catch {}
      add("Worker commit reported by /health: " + String(healthData.commit || healthData.version || "unavailable"));
      add("Worker Firebase project: " + String(healthData.firebaseProjectId || "not reported"));
      add("Firebase project match: " + (healthData.firebaseProjectId ? (healthData.firebaseProjectId === firebaseConfig.projectId ? "MATCH" : "MISMATCH") : "CANNOT DETERMINE"));
      const gate = await requestCheck("Actual-data gate GET (also verifies Worker administrator role)", "/api/system/actual-data-access", "GET", null, token);
      add("Worker administrator recognition: " + (gate.status === 200 ? "RECOGNISED (gate returned HTTP 200)" : gate.status === 403 ? "NOT RECOGNISED / role denied (HTTP 403)" : gate.status === 401 ? "AUTHENTICATION REJECTED (HTTP 401)" : "INDETERMINATE — inspect response above"));
      await requestCheck("Members UID reconciliation — dry run, no writes", "/api/members/reconcile-registered-identity-uids", "POST", { dryRun: true }, token);
      await requestCheck("Signature-pathway reconciliation — dry run, no document IDs supplied", "/api/signature-pathway/reconcile", "POST", { dryRun: true, documents: [] }, token);
      await requestCheck("Controlled-document upload policy — harmless policy-only check, no upload", "/api/upload-controlled-document/policy-check", "POST", { contentType: "application/pdf", fileSize: 1024, archiveCategory: "Administrative Documents", classification: "Public" }, token);
    } catch (error) {
      add("\nDIAGNOSTICS ERROR: " + String(error?.message || error));
    } finally {
      setLiveCheckText(lines.join("\n"));
      setLiveCheckBusy(false);
    }
  }

  async function enableNotifications() {
    setMessage("");
    if (notificationPermissionState() === "denied") {
      setMessage("Notifications are blocked by Chrome for this site. Open Chrome site controls → Permissions → Notifications → Allow, then return to this page and press Enable Push Notifications again.");
      return;
    }
    setBusy(true);
    try {
      await requestPushPermission();
      setPermission(notificationPermissionState());
      setMessage("Push notifications are enabled for this browser and account.");
    } catch (error) {
      setMessage(error?.message || "Unable to enable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  function prepareTrialReset(type) {
    setSelectedReset(type);
    setMessage("");
    setResult(null);
    const phrases = { documents: "RESET IRPA DOCUMENT TRIAL DATA", employees: "RESET IRPA EMPLOYEE TRIAL DATA", members: "RESET IRPA MEMBER TRIAL DATA", envelopes: "RESET IRPA TRIAL ENVELOPE DATA" };
    setMessage(`Trial reset selected. Enter the exact confirmation phrase below: ${phrases[type]}`);
    setTimeout(() => document.getElementById("trial-reset-confirmation")?.focus(), 0);
  }

  async function runTrialReset(type) {
    const phrases = {
      documents: "RESET IRPA DOCUMENT TRIAL DATA",
      employees: "RESET IRPA EMPLOYEE TRIAL DATA",
      members: "RESET IRPA MEMBER TRIAL DATA",
      envelopes: "RESET IRPA TRIAL ENVELOPE DATA"
    };
    const phrase = phrases[type];
    if (confirmation !== phrase) {
      setMessage(`Enter the exact confirmation phrase: ${phrase}`);
      return;
    }
    const warning = type === "documents"
      ? "This permanently deletes all Controlled Document trial records. Employee, Member and Board Member records are not affected. Continue?"
      : type === "employees"
        ? "This permanently deletes all Employee records and resets the Employee Number counter. Member and Board Member records are not affected. Continue?"
        : type === "members"
          ? "This permanently deletes all general Member records and resets the Member Number counter. Board Member records are preserved. Continue?"
          : "This permanently deletes trial Signature Envelope records, their linked signature transaction records and envelope events. Only records explicitly marked as trial are removed. Continue?";
    if (!window.confirm(warning)) return;
    setResetBusy(type);
    setMessage("");
    setResult(null);
    try {
      const data = type === "documents"
        ? await resetDocumentTrialData()
        : type === "employees"
          ? await resetEmployeeTrialData()
          : type === "members"
            ? await resetMemberTrialData()
            : await resetSignatureEnvelopeTrialData();
      setConfirmation("");
      setResult({ ...data, type });
      setMessage(`${type === "documents" ? "Document" : type === "employees" ? "Employee" : type === "members" ? "Member" : "Signature Envelope"} trial reset completed successfully.`);
    } catch (error) {
      setMessage(error?.message || "The trial-data reset failed.");
    } finally {
      setResetBusy("");
    }
  }

  async function authorizeGoogleDrive() {
    setDriveBusy(true);
    setMessage("");
    try {
      await startGoogleDriveAuthorization();
    } catch (error) {
      setMessage(error?.message || "Unable to start Google Drive authorization.");
      setDriveBusy(false);
    }
  }

  return (
    <div className="page">
      {admin && section === "settings" && <DepartmentArchiveRegistry/>}
      {admin && section === "administrators" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">ADMINISTRATOR GATEWAY</span>
              <h2>Add Administrator</h2>
              <p className="panel-description">Create or activate another IRPA Administrator. This control is available only to an authenticated Administrator. Executive Director and ordinary member accounts cannot access it.</p>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 18 }}>
            <span>Authorised administrator account</span>
            <strong>irpa2412@gmail.com</strong>
            <small>Only an active Administrator can use this gateway.</small>
          </div>
          <form onSubmit={async e => {
            e.preventDefault();
            const name = adminName.trim();
            const email = adminEmail.trim().toLowerCase();
            if (!name || !email) {
              setAdminResult({ ok: false, message: "Enter the new administrator's full name and email address." });
              return;
            }
            setAdminBusy(true);
            setAdminResult({ ok: true, working: true, message: "Starting Administrator setup…" });
            try {
              const data = await createAdministrator({
                name,
                email,
                onProgress: message => setAdminResult({ ok: true, working: true, message })
              });
              setAdminResult({
                ok: true,
                working: false,
                message: data?.emailRequested
                  ? `Administrator invitation created for ${email}. Firebase Authentication accepted the secure activation link request. The new Administrator must open the email link to activate the Administrator account.`
                  : `Administrator invitation created for ${email}. The activation link could not be confirmed as sent.`
              });
              setAdminName("");
              setAdminEmail("");
            } catch (error) {
              setAdminResult({
                ok: false,
                working: false,
                message: error?.message || "Unable to add the Administrator. No confirmation was received."
              });
            } finally {
              setAdminBusy(false);
            }
          }}>
            <label className="field" style={{ display: "block" }}>
              <span>New Administrator Name</span>
              <input value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Full name" required autoComplete="name" />
            </label>
            <label className="field" style={{ display: "block", marginTop: 14 }}>
              <span>New Administrator Email</span>
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="administrator@example.com" required autoComplete="email" />
            </label>
            <div className="form-actions" style={{ marginTop: 18 }}>
              <button type="submit" disabled={adminBusy}>{adminBusy ? "Adding Administrator…" : "Add Administrator"}</button>
            </div>
          </form>
          {adminResult && (
            <div
              className={adminResult.ok ? "success-message" : "auth-message"}
              style={{ marginTop: 16 }}
              role="status"
              aria-live="polite"
              aria-busy={adminResult.working ? "true" : "false"}
            >
              {adminResult.message}
            </div>
          )}
        </section>
      )}

      {admin && section === "settings" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">IDENTITY CONTROL</span>
              <h2>Member & Employee UID Reconciliation</h2>
              <p className="panel-description">Safely reconcile registered Member and Employee records with existing Firebase Authentication accounts. Matching is performed only by exact normalized email address.</p>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 18 }}>
            <span>Safety controls</span>
            <strong>Existing UIDs are never overwritten</strong>
            <small>No Firebase accounts are created. Records without an exact Authentication email match remain unresolved for manual review.</small>
          </div>
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Run the UID reconciliation for all registered Members and Employees? Existing UIDs will not be changed, and no new Firebase Authentication accounts will be created.")) return;
                setBusy(true);
                setMessage("");
                setResult(null);
                try {
                  const data = await reconcileRegisteredIdentityUids();
                  setResult({ type: "uid-reconciliation", ...data });
                  const summary = data?.summary || {};
                  setMessage(`UID reconciliation completed: ${summary.assigned||0} assigned, ${summary.alreadyAssigned||0} already linked, ${summary.unresolved||0} unresolved, ${summary.conflicting||0} conflicting, ${summary.errors||0} errors. Existing UIDs were preserved and no accounts were created.`);
                } catch (error) {
                  setMessage(error?.message || "UID reconciliation failed. No success confirmation was received.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Reconciling UIDs…" : "Reconcile Member & Employee UIDs"}
            </button>
          </div>
          {result?.type === "uid-reconciliation" && (
            <>
              <div className="detail-grid" style={{ marginTop: 18 }}>
                <div><span>Records processed</span><strong>{result.summary?.total||0}</strong></div>
                <div><span>UIDs assigned</span><strong>{result.summary?.assigned||0}</strong></div>
                <div><span>Already linked</span><strong>{result.summary?.alreadyAssigned||0}</strong></div>
                <div><span>Unresolved</span><strong>{result.summary?.unresolved||0}</strong></div>
                <div><span>Conflicting</span><strong>{result.summary?.conflicting||0}</strong></div>
                <div><span>Errors</span><strong>{result.summary?.errors||0}</strong></div>
                <div><span>Existing Auth accounts scanned</span><strong>{result.authUsers||0}</strong></div>
              </div>
              <div className="table-wrapper" style={{ marginTop: 18 }} aria-live="polite">
                <table><thead><tr><th>Register</th><th>Record</th><th>Email</th><th>Result</th><th>UID</th><th>Details</th></tr></thead>
                  <tbody>{(result.results||[]).map((item,index)=><tr key={item.collection+"-"+item.recordId+"-"+index}><td>{item.collection}</td><td>{item.name||item.recordId}</td><td>{item.email||"—"}</td><td>{item.status}</td><td>{item.uid||item.existingUid||"—"}</td><td>{item.reason}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {admin && section === "settings" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">INSTITUTIONAL IDENTITY LINK</span>
              <h2>Administrator ↔ Employee Capacity</h2>
              <p className="panel-description">Explicitly link this authenticated Administrator identity to the correct Employee Register record when the same person holds both Administrator and an operational employee capacity. This removes reliance on name matching and does not grant additional privileges.</p>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 18 }}>
            <span>Purpose</span>
            <strong>Stable identity linkage</strong>
            <small>The selected Employee record will carry this Administrator UID as its institutional identity link. The next fresh login can then resolve both registered capacities.</small>
          </div>
          <label className="field" style={{ display: "block" }}>
            <span>Employee Register record</span>
            <select value={identityEmployeeId} onChange={e => setIdentityEmployeeId(e.target.value)} disabled={identityBusy} style={{ width: "100%" }}>
              <option value="">Select the employee capacity held by this Administrator</option>
              {identityEmployees.map(employee => (
                <option key={employee.id} value={employee.id}>
                  {employee.name || "Unnamed employee"} · {employee.employeeNumber || employee.email || employee.id} · {employee.role || (Array.isArray(employee.roles) ? employee.roles.join(", ") : "Employee")}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions" style={{ marginTop: 14 }}>
            <button type="button" disabled={identityBusy || !identityEmployeeId} onClick={async () => {
              setIdentityBusy(true); setIdentityResult(null);
              try {
                const linked = await linkAdministratorToEmployee(identityEmployeeId);
                setIdentityResult({ ok: true, message: `Identity linked to ${linked.employeeNumber || "the selected Employee Register record"} (${linked.role || "Employee"}). Sign out and sign in again so the role gateway rebuilds the authenticated role set.` });
              } catch (error) {
                setIdentityResult({ ok: false, message: error?.message || "The Administrator ↔ Employee identity link could not be created." });
              } finally { setIdentityBusy(false); }
            }}>{identityBusy ? "Linking identity…" : "Link Administrator to Employee Capacity"}</button>
          </div>
          {identityResult && <div className={identityResult.ok ? "success-message" : "auth-message"} style={{ marginTop: 16 }} role="status">{identityResult.message}</div>}
        </section>
      )}

      {admin && section === "settings" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">DOCUMENT STORAGE</span><h2>Google Drive Authorization</h2><p className="panel-description">Authorize the IRPA Google Drive account used for controlled governance documents. The authorization is restricted to the configured IRPA Drive account.</p>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 18 }}>
            <span>Storage provider</span>
            <strong>Google Drive</strong>
            <small>Authorized account: irpa2412@gmail.com</small>
          </div>
          <div className="form-actions">
            <button onClick={authorizeGoogleDrive} disabled={driveBusy}>
              {driveBusy ? "Opening Google authorization…" : "Authorize Google Drive"}
            </button>
          </div>
        </section>
      )}

      {section === "settings" && (
      <section className="panel" style={{ marginTop: admin ? 20 : 0 }}>
        <div className="panel-header">
          <div>
            <span className="eyebrow">SYSTEM SETTINGS</span>
            <h2>Notifications</h2>
            <p className="panel-description">Control browser push notifications for meetings, authorizations, signatures, voting and other IRPA governance events.</p>
          </div>
        </div>
        <div className="stat-card" style={{ marginBottom: 18 }}>
          <span>Browser support</span>
          <strong>{supported ? "Supported" : "Not supported"}</strong>
          <small>Firebase Cloud Messaging</small>
        </div>
        <div className="stat-card" style={{ marginBottom: 18 }}>
          <span>Permission</span>
          <strong>{permission}</strong>
          <small>Current browser notification permission</small>
        </div>
        <div className="form-actions">
          <button type="button" onClick={enableNotifications} disabled={busy || !supported} aria-busy={busy ? "true" : "false"}>
            {busy ? "Enabling..." : permission === "denied" ? "Check Browser Notification Permission" : "Enable Push Notifications"}
          </button>
        </div>
        {permission === "denied" && (
          <div className="auth-message" style={{ marginTop: 16 }}>
            <strong>Browser permission is blocked.</strong><br />
            On Android Chrome, open the site controls for this IRPA web app, choose
            <strong> Permissions → Notifications → Allow</strong>, then return here and press
            <strong> Enable Push Notifications</strong>.
          </div>
        )}
        {message && <div className="auth-message" style={{ marginTop: 16 }}>{message}</div>}
      </section>
      )}

      {admin && section === "settings" && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <div>
              <span className="eyebrow">PRODUCTION DIAGNOSTICS</span>
              <h2>Live System Check</h2>
              <p className="panel-description">Runs authenticated, read-only diagnostics against the configured Worker. Reconciliation requests use dry-run mode; the upload test checks policy only and does not upload a file.</p>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" onClick={runLiveSystemCheck} disabled={liveCheckBusy}>
              {liveCheckBusy ? "Checking live system…" : "Run Live System Check"}
            </button>
            <button type="button" className="secondary-button" onClick={() => navigator.clipboard?.writeText(liveCheckText)} disabled={!liveCheckText}>
              Copy diagnostic text
            </button>
          </div>
          {liveCheckText && <pre aria-live="polite" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.45, padding: 12, marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", maxHeight: "60vh", overflow: "auto" }}>{liveCheckText}</pre>}
        </section>
      )}
      {admin && section === "settings" && <ActualDataAccessControl/>}
      {admin && section === "settings" && <SystemResetControl/>}

      {admin && section === "settings" && (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <div>
              <span className="eyebrow">ADMINISTRATOR CONTROL</span>
              <h2>Trial Data Resets</h2>
              <p className="panel-description">Controlled, administrator-only removal of trial records. Each reset requires an exact confirmation phrase and creates an audit entry.</p>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 14 }}>
            <span>Documents</span>
            <strong>Controlled Document Trial Data</strong>
            <small>Permanently removes records explicitly marked as trial documents only. Production controlled documents and all Signature Profiles are preserved.</small>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => selectedReset === "documents" ? runTrialReset("documents") : prepareTrialReset("documents")} disabled={!!resetBusy} aria-busy={resetBusy==="documents"?"true":"false"} aria-pressed={selectedReset === "documents"}>{resetBusy==="documents" ? "Executing Document Reset…" : selectedReset === "documents" ? "Confirm & Execute Document Reset" : "Reset Documents"}</button>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 14 }}>
            <span>Employees</span>
            <strong>Employee Trial Data</strong>
            <small>Removes Employee records and resets the Employee Number counter.</small>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => selectedReset === "employees" ? runTrialReset("employees") : prepareTrialReset("employees")} disabled={!!resetBusy} aria-busy={resetBusy==="employees"?"true":"false"} aria-pressed={selectedReset === "employees"}>{resetBusy==="employees" ? "Executing Employee Reset…" : selectedReset === "employees" ? "Confirm & Execute Employee Reset" : "Reset Employees"}</button>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 14 }}>
            <span>Members</span>
            <strong>General Member Trial Data</strong>
            <small>Removes general Members and resets the Member Number counter. Board Members are preserved.</small>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => selectedReset === "members" ? runTrialReset("members") : prepareTrialReset("members")} disabled={!!resetBusy} aria-busy={resetBusy==="members"?"true":"false"} aria-pressed={selectedReset === "members"}>{resetBusy==="members" ? "Executing Member Reset…" : selectedReset === "members" ? "Confirm & Execute Member Reset" : "Reset Members"}</button>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 14 }}>
            <span>Signature Envelopes</span>
            <strong>IRPA Trial Envelope Data</strong>
            <small>Removes Signature Envelopes explicitly marked as trial, together with their linked signature transaction records and envelope events. Production envelopes are preserved.</small>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => selectedReset === "envelopes" ? runTrialReset("envelopes") : prepareTrialReset("envelopes")} disabled={!!resetBusy} aria-busy={resetBusy==="envelopes"?"true":"false"} aria-pressed={selectedReset === "envelopes"}>{resetBusy==="envelopes" ? "Executing Envelope Reset…" : selectedReset === "envelopes" ? "Confirm & Execute Envelope Reset" : "Reset Trial Envelopes"}</button>
            </div>
          </div>
          <div className="success-message" style={{ marginTop: 8 }}>Enter the exact phrase for the reset you want to perform. Document reset only removes records marked as trial data; it does not remove Signature Profiles.</div><label className="field" style={{ display: "block" }}>
            <span>Confirmation phrase</span>
            <input id="trial-reset-confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="Enter the exact phrase shown after selecting a reset" aria-label="Trial reset confirmation phrase" />
          </label>
          {selectedReset && <div className="auth-message" style={{ marginTop: 16 }}><strong>Reset armed:</strong> {selectedReset === "documents" ? "Documents" : selectedReset === "employees" ? "Employees" : "Members"}. Enter the exact confirmation phrase above, then tap the same reset button again. The same button now performs the reset action.</div>}
          {selectedReset && <div className="form-actions" style={{ marginTop: 12 }}><button type="button" className="secondary-button" onClick={() => { setSelectedReset(""); setConfirmation(""); setMessage(""); }} disabled={!!resetBusy}>Cancel Reset</button></div>}
          {result && <div className="auth-message" style={{ marginTop: 16 }}>Reset completed. {result.type === "envelopes" ? <>Envelopes deleted: {result.envelopesDeleted ?? 0} · Pending signing cleared · Controlled documents deleted: {result.documentsDeleted ?? 0} · Signature transactions deleted: {result.signaturesDeleted ?? 0} · Events deleted: {result.eventsDeleted ?? 0}.</> : <>Records deleted: {result.recordsDeleted ?? 0}{result.boardMembersPreserved ? " · Board Members preserved." : ""}</>}</div>}
        </section>
      )}

      {section === "settings" && (
        <footer className="panel" aria-label="Application build information" style={{ marginTop: 20, padding: "12px 16px", fontSize: 12, opacity: 0.85 }}>
          <strong>Application build</strong>
          <div>Commit: {String(import.meta.env.VITE_BUILD_COMMIT || "unavailable").slice(0, 7)}</div>
          <div>Built (UTC): {import.meta.env.VITE_BUILD_TIME || "timestamp unavailable"}</div>
        </footer>
      )}
    </div>
  );
}
