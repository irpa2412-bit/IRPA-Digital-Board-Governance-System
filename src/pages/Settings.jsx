import React, { useEffect, useState } from "react";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import { startGoogleDriveAuthorization } from "../firebase/signatureStorage";
import { resetDocumentTrialData, resetEmployeeTrialData, resetMemberTrialData } from "../firebase/data";

export default function Settings({ admin = false }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState("");
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

  async function runTrialReset(type) {
    const phrases = {
      documents: "RESET IRPA DOCUMENT TRIAL DATA",
      employees: "RESET IRPA EMPLOYEE TRIAL DATA",
      members: "RESET IRPA MEMBER TRIAL DATA"
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
        : "This permanently deletes all general Member records and resets the Member Number counter. Board Member records are preserved. Continue?";
    if (!window.confirm(warning)) return;
    setResetBusy(type);
    setMessage("");
    setResult(null);
    try {
      const data = type === "documents"
        ? await resetDocumentTrialData()
        : type === "employees"
          ? await resetEmployeeTrialData()
          : await resetMemberTrialData();
      setConfirmation("");
      setResult({ ...data, type });
      setMessage(`${type === "documents" ? "Document" : type === "employees" ? "Employee" : "Member"} trial reset completed successfully.`);
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

      {admin && (
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
              <button type="button" onClick={() => runTrialReset("documents")} disabled={!!resetBusy} aria-busy={resetBusy==="documents"?"true":"false"}>{resetBusy==="documents" ? "Resetting Documents…" : "Reset Documents"}</button>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 14 }}>
            <span>Employees</span>
            <strong>Employee Trial Data</strong>
            <small>Removes Employee records and resets the Employee Number counter.</small>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => runTrialReset("employees")} disabled={!!resetBusy} aria-busy={resetBusy==="employees"?"true":"false"}>{resetBusy==="employees" ? "Resetting Employees…" : "Reset Employees"}</button>
            </div>
          </div>
          <div className="stat-card" style={{ marginBottom: 14 }}>
            <span>Members</span>
            <strong>General Member Trial Data</strong>
            <small>Removes general Members and resets the Member Number counter. Board Members are preserved.</small>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => runTrialReset("members")} disabled={!!resetBusy} aria-busy={resetBusy==="members"?"true":"false"}>{resetBusy==="members" ? "Resetting Members…" : "Reset Members"}</button>
            </div>
          </div>
          <div className="success-message" style={{ marginTop: 8 }}>Enter the exact phrase for the reset you want to perform. Document reset only removes records marked as trial data; it does not remove Signature Profiles.</div><label className="field" style={{ display: "block" }}>
            <span>Confirmation phrase</span>
            <input value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="Enter the exact phrase shown after selecting a reset" />
          </label>
          {result && <div className="auth-message" style={{ marginTop: 16 }}>Reset completed. Records deleted: {result.recordsDeleted ?? 0}{result.boardMembersPreserved ? " · Board Members preserved." : ""}</div>}
        </section>
      )}

    </div>
  );
}
