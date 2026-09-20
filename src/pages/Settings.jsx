import React, { useEffect, useState } from "react";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import { resetEmployeeTrialData, resetMemberTrialData } from "../firebase/data";
import { startGoogleDriveAuthorization } from "../firebase/signatureStorage";

export default function Settings({ admin = false }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState(null);

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

  async function resetRegistrationTrial(type) {
    const phrase = type === "employees" ? "RESET IRPA EMPLOYEE TRIAL DATA" : "RESET IRPA MEMBER TRIAL DATA";
    if (confirmation !== phrase) {
      setMessage(`Enter the exact confirmation phrase: ${phrase}`);
      return;
    }
    const warning = type === "employees"
      ? "This will permanently delete all trial Employee records and reset only the Employee Number counter. Member records will not be affected. Continue?"
      : "This will permanently delete all trial Member records and reset only the Member Number counter. Employee records will not be affected. Continue?";
    if (!window.confirm(warning)) return;
    setResetBusy(type);
    setMessage("");
    setResult(null);
    try {
      const data = type === "employees" ? await resetEmployeeTrialData() : await resetMemberTrialData();
      setResult({ ...data, type });
      setConfirmation("");
      setMessage(type === "employees"
        ? `Employee trial reset completed. ${data.recordsDeleted || 0} Employee records deleted. Employee Number counter reset to zero.`
        : `Member trial reset completed. ${data.recordsDeleted || 0} Member records deleted. Member Number counter reset to zero.`);
    } catch (error) {
      setMessage(error?.message || "The trial-data reset failed.");
    } finally {
      setResetBusy(false);
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

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <div>
            <span className="eyebrow">ADMINISTRATOR CONTROL</span>
            <h2>Trial Registration Data Controls</h2>
            <p className="panel-description">Members and Employees are separate registration platforms with independent registration-number counters. Each reset affects only the selected platform and is recorded in the audit trail.</p>
          </div>
        </div>
        <div className="dashboard-grid" style={{ marginBottom: 18 }}>
          <div className="stat-card"><span>MEMBERS</span><strong>IRPA-MEM-00001</strong><small>Independent Member Number sequence</small></div>
          <div className="stat-card"><span>EMPLOYEES</span><strong>IRPA-EMP-00001</strong><small>Independent Employee Number sequence</small></div>
        </div>
        <label>Type the exact reset confirmation phrase</label>
        <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="RESET IRPA EMPLOYEE TRIAL DATA or RESET IRPA MEMBER TRIAL DATA" autoComplete="off" disabled={!!resetBusy}/>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="danger-button" onClick={() => resetRegistrationTrial("employees")} disabled={!!resetBusy || confirmation !== "RESET IRPA EMPLOYEE TRIAL DATA"}>{resetBusy === "employees" ? "Deleting Employee Trials..." : "Delete Employee Trial Data"}</button>
          <button className="secondary-button" onClick={() => resetRegistrationTrial("members")} disabled={!!resetBusy || confirmation !== "RESET IRPA MEMBER TRIAL DATA"}>{resetBusy === "members" ? "Deleting Member Trials..." : "Delete Member Trial Data"}</button>
        </div>
        {message && <div className="auth-message" style={{ marginTop: 16 }}>{message}</div>}
        {result && <div className="auth-message" style={{ marginTop: 16 }}>Audit recorded successfully. Deleted: {result.recordsDeleted || 0} {result.type === "employees" ? "Employee" : "Member"} record(s). Only the corresponding registration counter was reset.</div>}
      </section
    </div>
  );
}
