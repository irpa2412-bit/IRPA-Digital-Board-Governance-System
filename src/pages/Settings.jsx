import React, { useEffect, useState } from "react";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import { resetDocumentTrialData, resetEmployeeTrialData, resetMemberTrialData } from "../firebase/data";

import { startGoogleDriveAuthorization } from "../firebase/signatureStorage";

export default function Settings({ admin = false }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [documentResetBusy, setDocumentResetBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");

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
    async function resetDocumentTrial() {
    const phrase = "RESET IRPA DOCUMENT TRIAL DATA";
    if (confirmation !== phrase) {
      setMessage(`Enter the exact confirmation phrase: ${phrase}`);
      return;
    }
    if (!window.confirm("This will permanently delete only Controlled Document trial records. Employee, Member and Board Member records will not be affected. Continue?")) return;
    setDocumentResetBusy(true);
    setMessage("");
    setResult(null);
    try {
      const data = await resetDocumentTrialData();
      setConfirmation("");
      setResult({ ...data, type: "documents" });
      setMessage(`Document trial reset completed. ${data.recordsDeleted || 0} Controlled Document records deleted. Other registration platforms were not changed.`);
    } catch (error) {
      setMessage(error?.message || "The document trial-data reset failed.");
    } finally {
      setDocumentResetBusy(false);
    }
  }

  async function resetRegistrationTrial(type) {
    const phrase = type === "employees" ? "RESET IRPA EMPLOYEE TRIAL DATA" : "RESET IRPA MEMBER TRIAL DATA";
    if (confirmation !== phrase) {
      setMessage(`Enter the exact confirmation phrase: ${phrase}`);
      return;
    }
    const warning = type === "employees"
      ? "This will permanently delete only trial Employee records and reset only the Employee Number counter. Member and Board Member records will not be affected. Continue?"
      : "This will permanently delete only trial Member records and reset only the Member Number counter. Employee and Board Member records will not be affected. Continue?";
    if (!window.confirm(warning)) return;
    setResetBusy(type);
    setMessage("");
    setResult(null);
    try {
      const data = type === "employees" ? await resetEmployeeTrialData() : await resetMemberTrialData();
      setConfirmation("");
      setResult({ ...data, type });
      setMessage(type === "employees"
        ? `Employee trial reset completed. ${data.recordsDeleted || 0} Employee records deleted. Only the Employee Number counter was reset.`
        : `Member trial reset completed. ${data.recordsDeleted || 0} Member records deleted. Only the Member Number counter was reset.`);
    } catch (error) {
      setMessage(error?.message || "The trial-data reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

  return () => unsubscribe();
  }, []);

  async function enableNotifications() {
    setBusy(true);
    setMessage("");
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
      {admin && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">DOCUMENT STORAGE</span>
              <h2>Google Drive Authorization</h2>
              <p className="panel-description">Authorize the IRPA Google Drive account used for controlled governance documents. The authorization is restricted to the configured IRPA Drive account.</p>
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
          <button onClick={enableNotifications} disabled={busy || !supported}>
            {busy ? "Enabling..." : "Enable Push Notifications"}
          </button>
        </div>
        {message && <div className="auth-message" style={{ marginTop: 16 }}>{message}</div>}
      </section>


      {admin && <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header"><div>
          <span className="eyebrow">ADMINISTRATOR CONTROL</span>
          <h2>Document Trial Data Control</h2>
          <p className="panel-description">Reset the Controlled Documents platform independently. This does not reset Employee, Member or Board Member registration data.</p>
        </div></div>
        <div className="stat-card" style={{ marginBottom: 18 }}>
          <span>DOCUMENTS</span><strong>Controlled Documents</strong><small>Independent document platform reset</small>
        </div>
        <label>Type the exact reset confirmation phrase</label>
        <input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="RESET IRPA DOCUMENT TRIAL DATA" autoComplete="off" disabled={!!resetBusy || documentResetBusy}/>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button type="button" className="danger-button" onClick={resetDocumentTrial} disabled={documentResetBusy || !!resetBusy || confirmation !== "RESET IRPA DOCUMENT TRIAL DATA"}>{documentResetBusy ? "Deleting Document Trials..." : "Delete Document Trial Data"}</button>
        </div>
        {result?.type === "documents" && <div className="auth-message" style={{ marginTop: 16 }}>Audit recorded successfully. Deleted: {result.recordsDeleted || 0} Controlled Document record(s).</div>}
      </section>}

      {admin && <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header"><div>
          <span className="eyebrow">ADMINISTRATOR CONTROL</span>
          <h2>Trial Registration Data Controls</h2>
          <p className="panel-description">Employees and Members remain separate platforms with independent automatic registration-number counters. Each reset affects only the selected platform and is recorded in the audit trail.</p>
        </div></div>
        <div className="dashboard-grid" style={{ marginBottom: 18 }}>
          <div className="stat-card"><span>MEMBERS</span><strong>IRPA-MEM</strong><small>Independent automatic Member Number sequence</small></div>
          <div className="stat-card"><span>EMPLOYEES</span><strong>IRPA-EMP</strong><small>Independent automatic Employee Number sequence</small></div>
        </div>
        <label>Type the exact reset confirmation phrase</label>
        <input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="RESET IRPA EMPLOYEE TRIAL DATA or RESET IRPA MEMBER TRIAL DATA" autoComplete="off" disabled={!!resetBusy || documentResetBusy}/>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button type="button" className="danger-button" onClick={()=>resetRegistrationTrial("employees")} disabled={!!resetBusy || documentResetBusy || confirmation !== "RESET IRPA EMPLOYEE TRIAL DATA"}>{resetBusy === "employees" ? "Deleting Employee Trials..." : "Delete Employee Trial Data"}</button>
          <button type="button" className="secondary-button" onClick={()=>resetRegistrationTrial("members")} disabled={!!resetBusy || documentResetBusy || confirmation !== "RESET IRPA MEMBER TRIAL DATA"}>{resetBusy === "members" ? "Deleting Member Trials..." : "Delete Member Trial Data"}</button>
        </div>
        {result && result.type !== "documents" && <div className="auth-message" style={{ marginTop: 16 }}>Audit recorded successfully. Deleted: {result.recordsDeleted || 0} {result.type === "employees" ? "Employee" : "Member"} record(s). Only the corresponding registration counter was reset.</div>}
      </section>}

    </div>
  );
}
