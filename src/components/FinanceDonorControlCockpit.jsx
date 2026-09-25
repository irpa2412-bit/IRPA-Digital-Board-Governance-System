import React,{useEffect,useMemo,useState}from"react";
import{COLLECTIONS,getRecords}from"../firebase/data";

function money(value){
 const n=Number(value||0);
 return Number.isFinite(n)?n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
}

function evidenceState(request){
 const required=Number(request?.quotationRequiredCount||3);
 const quotes=Number(request?.quotationCount||request?.quotations?.length||0);
 const delivery=Boolean(request?.deliveryNote||request?.deliveryNoteFileId||request?.deliveryNoteUidLink);
 const invoice=Boolean(request?.invoice||request?.invoiceFileId||request?.invoiceUidLink);
 const quoteOk=quotes>=required;
 const complete=quoteOk&&delivery&&invoice;
 return{required,quotes,delivery,invoice,complete};
}

export default function FinanceDonorControlCockpit(){
 const[data,setData]=useState({budgets:[],transactions:[],funding:[],grants:[],bank:[],reports:[],procurement:[],traces:[]});
 const[busy,setBusy]=useState(true),[error,setError]=useState("");
 async function load(){
  setBusy(true);setError("");
  try{
   const pairs=[
    ["budgets",COLLECTIONS.financeBudgets],["transactions",COLLECTIONS.financeTransactions],
    ["funding",COLLECTIONS.financeFunding],["grants",COLLECTIONS.financeGrants],
    ["bank",COLLECTIONS.financeReconciliations],["reports",COLLECTIONS.financeReports],
    ["procurement",COLLECTIONS.procurementRequests],["traces",COLLECTIONS.financePaymentTrace]
   ];
   const values=await Promise.all(pairs.map(([,collection])=>getRecords(collection).catch(()=>[])));
   setData(Object.fromEntries(pairs.map(([key],i)=>[key,values[i]||[]])));
  }catch(e){setError(e.message||"Unable to load the financial control snapshot.");}
  finally{setBusy(false);}
 }
 useEffect(()=>{load()},[]);
 const summary=useMemo(()=>{
  const budgets=data.budgets.reduce((s,r)=>s+Number(r.amount??r.budgetAmount??0),0);
  const transactions=data.transactions.reduce((s,r)=>s+Number(r.amount||0),0);
  const grantsActive=data.grants.filter(r=>["Awarded","Active","Reporting"].includes(r.status)).length;
  const boardApprovedBudgets=data.budgets.filter(r=>r.status==="Board Approved"||r.status==="Active").length;
  const reconciled=data.bank.filter(r=>r.status==="Reconciled").length;
  const reconciliationExceptions=data.bank.filter(r=>r.status==="Exception"||Math.abs(Number(r.reconciliationDifference||0))>0).length;
  const procurementPipeline=data.procurement.filter(r=>["PR Registration","Procurement Team Review","Accounting Officer Authorization","PO Generation","Delivery Note Required","Invoice Required","Finance Handoff"].includes(r.status)).reduce((s,r)=>s+Number(r.estimatedAmount||0),0);
  const procurementReady=data.procurement.filter(r=>evidenceState(r).complete).length;
  const procurementIncomplete=data.procurement.filter(r=>!evidenceState(r).complete&&["Finance Handoff","Invoice Required","Delivery Note Required"].includes(r.status)).length;
  const traceComplete=data.traces.filter(r=>["Posted","Reconciled","Completed"].includes(r.paymentStatus)).length;
  const traceOpen=data.traces.filter(r=>!["Posted","Reconciled","Completed"].includes(r.paymentStatus)).length;
  const reportsIssued=data.reports.filter(r=>r.status==="Issued"||r.status==="Archived").length;
  return{budgets,transactions,grantsActive,boardApprovedBudgets,reconciled,reconciliationExceptions,procurementPipeline,procurementReady,procurementIncomplete,traceComplete,traceOpen,reportsIssued};
 },[data]);
 const alerts=useMemo(()=>[
  ...data.bank.filter(r=>r.status==="Exception"||Math.abs(Number(r.reconciliationDifference||0))>0).map(r=>({key:"bank-"+r.id,title:"Bank reconciliation exception",detail:r.reference||r.title||r.id})),
  ...data.procurement.filter(r=>["Finance Handoff","Invoice Required","Delivery Note Required"].includes(r.status)&&!evidenceState(r).complete).map(r=>({key:"proc-"+r.id,title:"Procurement evidence incomplete",detail:(r.requestNumber||r.title||r.id)+" — complete the PO/delivery/invoice evidence chain"})),
  ...data.traces.filter(r=>!["Posted","Reconciled","Completed"].includes(r.paymentStatus)&&r.authorizationStatus==="Authorized").map(r=>({key:"trace-"+r.id,title:"Authorized payment remains open",detail:r.traceReference||r.sourceReference||r.id}))
 ].slice(0,12),[data]);
 function printSnapshot(){
  const w=window.open("","_blank","noopener,noreferrer");if(!w)return;
  w.document.write("<html><head><title>IRPA Financial Control Snapshot</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}h1{margin-bottom:4px}h2{margin-top:28px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #999;padding:7px;text-align:left}.muted{color:#555}</style></head><body>");
  w.document.write("<h1>IMPROVEMENT OF RANGELAND IN PASTORAL AREAS</h1><p class='muted'>Finance & Administration — Donor Control Snapshot</p><p>Generated: "+new Date().toLocaleString()+"</p>");
  w.document.write("<h2>Control Summary</h2><table><tr><th>Control</th><th>Value</th></tr><tr><td>Registered budget value</td><td>"+money(summary.budgets)+"</td></tr><tr><td>Recorded transaction value</td><td>"+money(summary.transactions)+"</td></tr><tr><td>Active/Awarded/Reporting grants</td><td>"+summary.grantsActive+"</td></tr><tr><td>Bank reconciliation exceptions</td><td>"+summary.reconciliationExceptions+"</td></tr><tr><td>Open authorized payment traces</td><td>"+summary.traceOpen+"</td></tr><tr><td>Procurement evidence-ready records</td><td>"+summary.procurementReady+"</td></tr><tr><td>Procurement evidence gaps</td><td>"+summary.procurementIncomplete+"</td></tr></table>");
  w.document.write("<h2>Control Alerts</h2>"+(alerts.length?"<ul>"+alerts.map(a=>"<li><b>"+a.title+"</b>: "+a.detail+"</li>").join("")+"</ul>":"<p>No current alerts were detected in the loaded registers.</p>"));
  w.document.write("<p class='muted'>This snapshot is a management control view, not a substitute for statutory accounts or an external audit.</p></body></html>");
  w.document.close();w.focus();w.print();
 }
 return <section className="panel" id="finance-donor-control-cockpit">
  <div className="panel-header">
   <div><span className="eyebrow">DONOR & AUDIT CONTROL COCKPIT</span><h2>Financial Control Snapshot</h2><p className="panel-description">A read-only management layer over the existing Finance and Procurement registers. It exposes budget control, procurement evidence, reconciliation exceptions, payment traceability and grant reporting without changing the underlying workflows.</p></div>
   <div className="form-actions"><button type="button" className="secondary-button" onClick={load} disabled={busy}>{busy?"Refreshing…":"Refresh Snapshot"}</button><button type="button" onClick={printSnapshot} disabled={busy}>Print Donor Snapshot</button></div>
  </div>
  {error&&<div className="error-message action-feedback">{error}</div>}
  <section className="panel" aria-label="Unified finance controls">
   <div className="panel-header"><div><span className="eyebrow">UNIFIED CONTROL NAVIGATION</span><h3>Operational Finance Registers</h3><p className="panel-description">The new control layer is now the management entry point; the existing operational registers remain the authoritative transaction layer. Navigation below moves directly to those existing controls without copying or replacing their data.</p></div></div>
   <div className="member-actions unified-control-tabs" role="tablist" aria-label="Operational Finance Registers">
    <a className="unified-control-tab" href="#finance-operational-registers" role="tab">Financial Registers</a>
    <a className="unified-control-tab" href="#procurement-finance-handoff" role="tab">Procurement → Finance</a>
    <a className="unified-control-tab" href="#finance-traceability" role="tab">Payment Trace</a>
    <a className="unified-control-tab" href="#finance-payment-post" role="tab">Payment Post Portal</a>
    <a className="unified-control-tab" href="#finance-operational-registers" role="tab">Staff Payments & Payroll</a>
    <a className="unified-control-tab" href="#finance-entry" role="tab">Controlled Entry</a>
   </div>
  </section>
  <div className="dashboard-grid">
   <div className="stat-card"><span>Budget Portfolio</span><strong>{money(summary.budgets)}</strong><small>{summary.boardApprovedBudgets} approved/active budget records</small></div>
   <div className="stat-card"><span>Transaction Value</span><strong>{money(summary.transactions)}</strong><small>Recorded Finance transactions</small></div>
   <div className="stat-card"><span>Procurement Pipeline</span><strong>{money(summary.procurementPipeline)}</strong><small>Controlled procurement value in progress</small></div>
   <div className="stat-card"><span>Active Grant Records</span><strong>{summary.grantsActive}</strong><small>Awarded, active or reporting</small></div>
   <div className="stat-card"><span>Reconciliation Exceptions</span><strong>{summary.reconciliationExceptions}</strong><small>{summary.reconciled} reconciled records</small></div>
   <div className="stat-card"><span>Payment Trace</span><strong>{summary.traceComplete}/{summary.traceComplete+summary.traceOpen}</strong><small>Completed vs open trace records</small></div>
  </div>
  <div className="dashboard-grid">
   <div className="stat-card workflow-stage"><span>Procurement Evidence</span><strong>{summary.procurementReady}</strong><small>Requests with quotation + delivery + invoice evidence</small></div>
   <div className="stat-card workflow-stage"><span>Evidence Gaps</span><strong>{summary.procurementIncomplete}</strong><small>Open procurement records needing evidence completion</small></div>
   <div className="stat-card workflow-stage"><span>Reports Issued</span><strong>{summary.reportsIssued}</strong><small>Issued or archived Finance reports</small></div>
  </div>
  <div className="panel">
   <div className="panel-header"><div><span className="eyebrow">THREE-WAY CONTROL VIEW</span><h3>Procurement → Finance Evidence Chain</h3><p className="panel-description">The cockpit does not approve or alter transactions. It verifies whether the existing procurement record contains the expected quotation, delivery and invoice evidence before Finance processing.</p></div></div>
   <div className="table-wrapper"><table><thead><tr><th>Procurement</th><th>PR / PO</th><th>Quotation</th><th>Delivery</th><th>Invoice</th><th>Finance Handoff</th><th>Control State</th></tr></thead><tbody>
    {data.procurement.length?data.procurement.slice(0,100).map(r=>{const e=evidenceState(r);return <tr key={r.id}><td><strong>{r.requestNumber||r.title||r.id}</strong><div className="table-subtext">{r.vendorName||"—"}</div></td><td>{r.prNumber||"—"} / {r.poNumber||"—"}</td><td>{e.quotes}/{e.required}</td><td>{e.delivery?"Present":"Missing"}</td><td>{e.invoice?"Present":"Missing"}</td><td>{r.status==="Finance Handoff"||r.financeTransactionId?"Sent":"Not yet"}</td><td><span className="status-badge">{e.complete?"Evidence complete":"Evidence incomplete"}</span></td></tr>}) : <tr><td colSpan="7">No procurement records are currently available to the Finance control cockpit.</td></tr>}
   </tbody></table></div>
  </div>
  <div className="panel">
   <div className="panel-header"><div><span className="eyebrow">CONTROL ALERTS</span><h3>Exceptions Requiring Attention</h3><p className="panel-description">These are flags derived from existing registers. They do not automatically reject or authorize a transaction.</p></div></div>
   <div className="table-wrapper"><table><thead><tr><th>Alert</th><th>Reference</th><th>Action principle</th></tr></thead><tbody>{alerts.length?alerts.map(a=><tr key={a.key}><td><span className="status-badge">{a.title}</span></td><td>{a.detail}</td><td>Review the source workflow and record the resolution in its authoritative register.</td></tr>):<tr><td colSpan="3">No current control alerts detected in the loaded registers.</td></tr>}</tbody></table></div>
  </div>
  <div className="action-feedback"><strong>Control boundary:</strong> this cockpit is deliberately read-only. It does not bypass Procurement authorization, Finance approval, institutional signing authority, Board decisions, resolutions, voting or existing audit controls.</div>
 </section>;
}
