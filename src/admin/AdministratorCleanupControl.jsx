import React, { useMemo, useState } from "react";
import { getIdToken } from "firebase/auth";
import { auth } from "../firebase/config";
import { getGoogleDriveGatewayUrl } from "../firebase/gatewayUrl";

export default function AdministratorCleanupControl() {
  const [inventory, setInventory] = useState(null);
  const [plan, setPlan] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [execution, setExecution] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const rows = inventory?.records || [];
  const visibleRows = useMemo(() => rows.filter(row => {
    const text = [row.name, row.email, row.role, row.collection, row.status].join(" ").toLowerCase();
    const matchesQuery = text.includes(query.trim().toLowerCase());
    const status = String(row.status || "").toLowerCase();
    const matchesFilter = filter === "ALL" ||
      (filter === "TRIAL" && (row.trialData || /trial|test/i.test(row.recordOrigin) || /trial|test/i.test(status))) ||
      (filter === "INVITED" && /invited|pending invitation/i.test(status)) ||
      (filter === "ACTIVE" && /active|activated/i.test(status));
    return matchesQuery && matchesFilter;
  }), [rows, query, filter]);

  async function request(path, method = "GET", body) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in as the primary administrator first.");
    const token = await getIdToken(user, true);
    const gateway = String(getGoogleDriveGatewayUrl() || "").replace(/\/+$/, "");
    if (!gateway) throw new Error("The governance gateway URL is not configured.");
    const response = await fetch(gateway + path, {
      method,
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || ("Cleanup request failed (HTTP " + response.status + ")."));
    return payload;
  }

  async function takeInventory() {
    setBusy(true); setError(""); setNotice(""); setPlan(null);
    try {
      const data = await request("/api/admin/cleanup/inventory");
      setInventory(data);
      setDecisions(Object.fromEntries((data.records || []).map(row => [row.key, "STAYS"])));
      setNotice("Inventory captured. Every record is set to STAYS until you explicitly select GOES.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function preparePlan() {
    if (!inventory?.inventoryId) { setError("Take a fresh inventory before preparing a cleanup plan."); return; }
    setBusy(true); setError(""); setNotice(""); setExecution(null); setConfirmation("");
    try {
      const selections = rows.map(row => ({ key: row.key, decision: decisions[row.key] || "STAYS" }));
      const data = await request("/api/admin/cleanup/plan", "POST", { inventoryId: inventory.inventoryId, selections });
      setPlan(data);
      setNotice("Review the exact GOES list and protection reasons. No records have been deleted.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function executeCleanup() {
    if (!plan?.planId || confirmation !== "DELETE") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request("/api/admin/cleanup/execute", "POST", { planId: plan.planId, confirmation });
      setExecution(data);
      setPlan(old => old ? { ...old, status: data.status } : old);
      setNotice(data.status === "COMPLETE" ? "Cleanup completed. The durable backup is available in Google Drive." : "Cleanup batch completed. Continue to process the remaining reviewed operations.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const goes = rows.filter(row => (decisions[row.key] || "STAYS") === "GOES" && !row.protected).length;
  const stays = rows.length - goes;

  return <section className="panel" aria-labelledby="admin-cleanup-heading">
    <div className="panel-header"><div>
      <span className="eyebrow">PRIMARY ADMINISTRATOR CONTROL</span>
      <h2 id="admin-cleanup-heading">Administrator-Controlled Data Cleanup</h2>
      <p className="panel-description">A fresh inventory is mandatory before any reset. All records start as STAYS. Nothing is deleted by taking inventory or preparing a plan.</p>
    </div></div>
    <div className="form-actions">
      <button type="button" onClick={takeInventory} disabled={busy}>{busy ? "Working…" : "Take Fresh Inventory"}</button>
      {inventory && <button type="button" className="secondary" onClick={() => { setDecisions(Object.fromEntries(rows.map(row => [row.key, "STAYS"]))); setPlan(null); }} disabled={busy}>Mark All STAYS</button>}
    </div>
    {inventory && <>
      <div className="detail-grid" style={{marginTop:16}}>
        <div><span>Inventory records</span><strong>{rows.length}</strong></div>
        <div><span>STAYS</span><strong>{stays}</strong></div>
        <div><span>GOES selected</span><strong>{goes}</strong></div>
        <div><span>Protected</span><strong>{rows.filter(row=>row.protected).length}</strong></div>
      </div>
      <div className="form-grid" style={{marginTop:18}}>
        <label className="field"><span>Search inventory</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, email, role or record type"/></label>
        <label className="field"><span>Filter</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">All records</option><option value="TRIAL">Trial / test</option><option value="INVITED">Invited</option><option value="ACTIVE">Active</option></select></label>
      </div>
      <div className="table-wrapper" style={{marginTop:16}}>
        <table><thead><tr><th>Record / Full name</th><th>Email</th><th>Role / Type</th><th>Created</th><th>Status</th><th>Linked records</th><th>Protection</th><th>Decision</th></tr></thead>
          <tbody>{visibleRows.map(row=><tr key={row.key}>
            <td><strong>{row.name || row.id}</strong><small style={{display:"block"}}>{row.collection} · {row.id}</small></td>
            <td>{row.email || "—"}</td><td>{row.role || row.registerType || row.collection}</td><td>{row.createdAt ? (typeof row.createdAt === "string" ? new Date(row.createdAt).toLocaleDateString() : row.createdAt.seconds ? new Date(row.createdAt.seconds * 1000).toLocaleDateString() : "Recorded") : "—"}</td><td>{row.status || "—"}</td>
            <td>{row.dependencyCount || 0}{row.linkedRecordKeys?.length ? <small style={{display:"block"}}>{row.linkedRecordKeys.slice(0,5).join(", ")}{row.linkedRecordKeys.length>5 ? " …" : ""}</small> : null}</td><td>{row.protected ? (row.protectionReason || "Protected") : "—"}</td>
            <td><select aria-label={"Decision for " + (row.name || row.id)} value={decisions[row.key] || "STAYS"} disabled={row.protected} onChange={e=>{setDecisions(old=>({...old,[row.key]:e.target.value}));setPlan(null);}}><option value="STAYS">STAYS</option><option value="GOES">GOES</option></select></td>
          </tr>)}</tbody>
        </table>
        {visibleRows.length===0 && <p>No matching inventory records.</p>}
      </div>
      <div className="form-actions" style={{marginTop:18}}><button type="button" onClick={preparePlan} disabled={busy}>Prepare Review Plan</button></div>
    </>}
    {plan && <div className="stat-card" style={{marginTop:18}}>
      <strong>Review plan: {plan.status || "AWAITING_REVIEW"}</strong>
      <p>Plan ID: {plan.planId}</p>
      <p>{plan.summary?.stays || 0} STAYS · {plan.summary?.goes || 0} GOES · {plan.summary?.blocked || 0} protected · {plan.summary?.operations || 0} operations</p>
      <p>Review all GOES records and the approved related-record actions before confirming.</p>
      <div className="table-wrapper">
        <table><thead><tr><th>Planned operation</th><th>Record</th><th>Reason</th></tr></thead><tbody>
          {(plan.executionOperations || []).map(operation => <tr key={operation.operationId}>
            <td>{operation.type}</td><td>{operation.key || operation.uid || operation.fileId}</td><td>{operation.reason}</td>
          </tr>)}
        </tbody></table>
      </div>
      {plan.status !== "COMPLETE" && <>
        <label className="field" style={{marginTop:16}}><span>Type DELETE to authorize the reviewed plan</span>
          <input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="DELETE" autoComplete="off"/>
        </label>
        <div className="form-actions" style={{marginTop:12}}>
          <button type="button" onClick={executeCleanup} disabled={busy || confirmation !== "DELETE"}>
            {busy ? "Executing…" : execution?.status === "IN_PROGRESS" || execution?.status === "PAUSED" ? "Continue / Retry Cleanup" : "Execute Reviewed Cleanup"}
          </button>
        </div>
      </>}
      {execution && <p role="status">{execution.status}: {execution.completedOperations ?? execution.operationOutcomes?.length ?? 0} operation results recorded.</p>}
      {(execution?.backupUrl || plan.backupUrl) && <p><a href={execution?.backupUrl || plan.backupUrl} target="_blank" rel="noreferrer">Open durable cleanup backup</a></p>}
      <p>Execution rechecks the inventory, protects restricted records, creates a Drive backup first and processes deletions in resumable batches.</p>
    </div>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    {error && <p className="auth-message" role="alert">{error}</p>}
  </section>;
}
