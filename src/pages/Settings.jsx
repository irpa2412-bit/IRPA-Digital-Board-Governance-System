import React, { useEffect, useState } from "react";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import { resetEmployeeTrialData, resetMemberTrialData } from "../firebase/data";
import { startGoogleDriveAuthorization } from "../firebase/signatureStorage";

export default function Settings({ admin = false }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState("");
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

  async function resetRegistrationTrial(type) {\n    const phrase = type === "employees" ? "RESET IRPA EMPLOYEE TRIAL DATA" : "RESET IRPA MEMBER TRIAL DATA";\n    if (confirmation !== phrase) { setMessage(`Enter the exact confirmation phrase: ${phrase}`); return; }\n    if (!window.confirm(type === "employees" ? "This will permanently delete all trial Employee records and reset only the Employee Number counter. Member records will not be affected. Continue?" : "This will permanently delete all trial Member records and reset only the Member Number counter. Employee records will not be affected. Continue?")) return;\n    setResetBusy(type); setMessage(""); setResult(null);\n    try {\n      const data = type === "employees" ? await resetEmployeeTrialData() : await resetMemberTrialData();\n      setResult({ ...data, type }); setConfirmation("");\n      setMessage(type === "employees" ? `Employee trial reset completed. ${data.recordsDeleted || 0} Employee records deleted. Employee Number counter reset to zero.` : `Member trial reset completed. ${data.recordsDeleted || 0} Member records deleted. Member Number counter reset to zero.`);\n    } catch (error) { setMessage(error?.message || "The trial-data reset failed."); }\n    finally { setResetBusy(""); }\n  }      <section className="panel" style={{ marginTop: 20 }}>\n        <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR CONTROL</span><h2>Trial Registration Data Controls</h2><p className="panel-description">Members and Employees are separate registration platforms with independent registration-number counters. Each reset affects only the selected platform and is recorded in the audit trail.</p></div></div>\n        <div className="dashboard-grid" style={{marginBottom:18}}>\n          <div className="stat-card"><span>MEMBERS</span><strong>IRPA-MEM-00001</strong><small>Independent Member Number sequence</small></div>\n          <div className="stat-card"><span>EMPLOYEES</span><strong>IRPA-EMP-00001</strong><small>Independent Employee Number sequence</small></div>\n        </div>\n        <label>Type the exact reset confirmation phrase</label>\n        <input value={confirmation} onChange={(e)=>setConfirmation(e.target.value)} placeholder="RESET IRPA EMPLOYEE TRIAL DATA or RESET IRPA MEMBER TRIAL DATA" autoComplete="off" disabled={!!resetBusy}/>\n        <div className="form-actions" style={{marginTop:14}}>\n          <button className="danger-button" onClick={()=>resetRegistrationTrial("employees")} disabled={!!resetBusy || confirmation!=="RESET IRPA EMPLOYEE TRIAL DATA"}>{resetBusy==="employees"?"Resetting Employee Trials...":"Delete Employee Trial Data"}</button>\n          <button className="secondary-button" onClick={()=>resetRegistrationTrial("members")} disabled={!!resetBusy || confirmation!=="RESET IRPA MEMBER TRIAL DATA"}>{resetBusy==="members"?"Resetting Member Trials...":"Delete Member Trial Data"}</button>\n        </div>\n        {message&&<div className="auth-message" style={{marginTop:16}}>{message}</div>}\n        {result&&<div className="auth-message" style={{marginTop:16}}>Audit recorded successfully. Deleted: {result.recordsDeleted || 0} {result.type === "employees" ? "Employee" : "Member"} record(s). Only the corresponding registration counter was reset.</div>}\n      </section>import React, { useEffect, useState } from "react";
import { browserSupportsPush, listenForForegroundMessages, notificationPermissionState, requestPushPermission } from "../firebase/messaging";
import { resetEmployeeTrialData, resetMemberTrialData } from "../firebase/data";
import { startGoogleDriveAuthorization } from "../firebase/signatureStorage";

export default function Settings({ admin = false }) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState("");
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

  async function resetRegistrationTrial(type) {\n    const phrase = type === "employees" ? "RESET IRPA EMPLOYEE TRIAL DATA" : "RESET IRPA MEMBER TRIAL DATA";\n    if (confirmation !== phrase) { setMessage(`Enter the exact confirmation phrase: ${phrase}`); return; }\n    if (!window.confirm(type === "employees" ? "This will permanently delete all trial Employee records and reset only the Employee Number counter. Member records will not be affected. Continue?" : "This will permanently delete all trial Member records and reset only the Member Number counter. Employee records will not be affected. Continue?")) return;\n    setResetBusy(type); setMessage(""); setResult(null);\n    try {\n      const data = type === "employees" ? await resetEmployeeTrialData() : await resetMemberTrialData();\n      setResult({ ...data, type }); setConfirmation("");\n      setMessage(type === "employees" ? `Employee trial reset completed. ${data.recordsDeleted || 0} Employee records deleted. Employee Number counter reset to zero.` : `Member trial reset completed. ${data.recordsDeleted || 0} Member records deleted. Member Number counter reset to zero.`);\n    } catch (error) { setMessage(error?.message || "The trial-data reset failed."); }\n    finally { setResetBusy(""); }\n  }
