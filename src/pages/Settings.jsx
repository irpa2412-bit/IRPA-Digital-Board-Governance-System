import React, { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import { functions } from "../firebase/functions";
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

  async function resetTrialData() {
    if (confirmation !== "RESET IRPA TRIAL DATA") {
      setMessage("Enter the exact confirmation phrase: RESET IRPA TRIAL DATA");
      return;
    }
    if (!window.confirm("This will permanently delete all member and employee trial records and reset both counters. Continue?")) return;
    setResetBusy(true);
    setMessage("");
    setResult(null);
    try {
      const call = httpsCallable(functions, "resetTrialData");
      const response = await call({ confirmation });
      const data = response.data || {};
      setResult(data);
      setConfirmation("");
      setMessage(`Trial data reset completed. ${data.membersDeleted || 0} member records and ${data.employeesDeleted || 0} employee records deleted. Counters reset to zero.`);
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
            <h2>Reset Trial Data</h2>
            <p className="panel-description">Controlled permanent deletion of trial member and employee records. This operation is available only to an active IRPA administrator and creates an audit record before deletion.</p>
          </div>
        </div>
        <div className="stat-card" style={{ marginBottom: 18 }}>
          <span>Scope</span>
          <strong>Members + Employees</strong>
          <small>Employee counter → 0 · Member counter → 0 · Governance records remain intact</small>
        </div>
        <label>Type confirmation phrase</label>
        <input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="RESET IRPA TRIAL DATA"
          autoComplete="off"
          disabled={resetBusy}
        />
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="secondary-button" onClick={resetTrialData} disabled={resetBusy || confirmation !== "RESET IRPA TRIAL DATA"}>
            {resetBusy ? "Resetting Trial Data..." : "Reset Trial Data"}
          </button>
        </div>
        {result && <div className="auth-message" style={{ marginTop: 16 }}>Audit recorded successfully. Deleted: {result.membersDeleted || 0} members; {result.employeesDeleted || 0} employees.</div>}
      </section>
    </div>
  );
}
