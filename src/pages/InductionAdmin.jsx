import React,{useEffect,useState}from"react";
import{getInductionRegistrationRequests,linkInductionRegistration,rejectInductionRegistration,processInductionRegistrationAdmin}from"../firebase/data";

export default function InductionAdmin(){
 const[rows,setRows]=useState([]),[busy,setBusy]=useState(true),[action,setAction]=useState(""),[message,setMessage]=useState("");
 async function load(){setBusy(true);setMessage("");try{const r=await getInductionRegistrationRequests();setRows(r)}catch(e){setMessage(e.message||"Unable to load induction applications.")}finally{setBusy(false)}}
 useEffect(()=>{load();const timer=setInterval(()=>load(),5000);return()=>clearInterval(timer)},[]);
 async function link(row){setAction(row.id);setMessage("");try{const result=await linkInductionRegistration(row.id);setMessage("APPROVED and LINKED. "+(row.fullName||row.email)+" has received the administrator decision through the system email route.");await load()}catch(e){setMessage(e.message||"The application could not be approved.")}finally{setAction("")}}
 async function processPending(row){setAction(row.id);setMessage("");try{const result=await processInductionRegistrationAdmin(row.id);setMessage(`PROCESSED. ${row.fullName||row.email||"The application"} scored ${result.accuracyPercentage}% and was routed to the appropriate administrator queue.`);await load()}catch(e){setMessage(e.message||"The pending application could not be processed.")}finally{setAction("")}}
 async function reject(row){const reason=window.prompt("Enter the administrator decision reason that must be sent to the applicant by email:","The application requires further verification before approval.");if(!reason||!reason.trim())return;setAction(row.id);setMessage("");try{await rejectInductionRegistration(row.id,reason.trim());setMessage("REJECTED. The applicant has been sent the administrator decision and reason through the system email route.");await load()}catch(e){setMessage(e.message||"The application could not be rejected.")}finally{setAction("")}}

 const advanced=rows.filter(x=>x.routingStatus==="Advanced to Administrator"&&x.status!=="Linked"&&x.roleAssignmentStatus!=="Linked");
 const pending=rows.filter(x=>!x.routingStatus && x.status!=="Linked" && x.roleAssignmentStatus!=="Linked");
 const filtered=rows.filter(x=>x.routingStatus==="Filtered — Below 75% Accuracy");
 const decided=rows.filter(x=>String(x.status||"").startsWith("Rejected")||String(x.routingStatus||"").startsWith("Administrator Decision"));
 const card=(row,canDecide=true)=><article key={row.id} className="stat-card">
   <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
    <div><span>APPLICANT</span><strong>{row.fullName||"Unnamed applicant"}</strong><small>{row.email||"No email"} · {row.registrationNumber||"Registration number issued after LINK"}</small></div>
    <div><span>ACCURACY</span><strong>{row.accuracyPercentage??"—"}%</strong><small>{row.accuracyCorrect??"—"}/{row.accuracyTotal??"—"} scored · threshold {row.accuracyThreshold??75}%</small></div>
   </div>
   <div className="dashboard-grid" style={{marginTop:14}}>
    <div><span>ROUTING</span><strong>{row.routingStatus||row.status||"Pending"}</strong></div>
    <div><span>ROLE</span><strong>{row.systemRole||row.requestedRole||"—"}</strong></div>
    <div><span>DEPARTMENT</span><strong>{row.systemDepartment||row.requestedDepartment||"—"}</strong></div>
    <div><span>UNIT</span><strong>{row.systemUnit||row.requestedUnit||"—"}</strong></div>
   </div>
   <section className="panel" style={{marginTop:14}}>
    <div className="panel-header"><div><span className="eyebrow">APPLICATION RECEPTION REPORT</span><h3>Induction & Orientation Submission Report</h3><p className="panel-description">This report is part of the submitted application record. It is not an administrator email. The application ID is the audit-trace reference.</p></div></div>
    <div className="detail-grid" style={{marginBottom:12}}>
      <div><span>REPORT STATUS</span><strong>{row.administratorReportStatus||"Available in Application Reception"}</strong></div>
      <div><span>AUDIT STATUS</span><strong>{row.auditStatus||"Recorded"}</strong></div>
      <div><span>APPLICATION ID / AUDIT REFERENCE</span><strong>{row.id}</strong></div>
      <div><span>REPORT VERSION</span><strong>{row.inductionOrientationReport?.reportVersion||"1.0"}</strong></div>
    </div>
    <div className="panel-header"><div><span className="eyebrow">SYSTEM-GENERATED SUMMARY</span><h3>Administrator Decision Brief</h3></div></div>
    <p className="panel-description">{row.systemSummary||"No summary has been generated."}</p>
    {Array.isArray(row.accuracyIssues)&&row.accuracyIssues.length>0&&<div className="field-help"><strong>Items requiring attention:</strong> {row.accuracyIssues.join(", ")}</div>}
    {row.systemCapturedProfile&&<div className="field-help" style={{marginTop:10}}><strong>Captured system information:</strong> Position {row.systemCapturedProfile.position||"—"} · Roles {(row.systemCapturedProfile.assignedRoles||[]).join(", ")||"—"} · Department {row.systemCapturedProfile.department||"—"} · Unit {row.systemCapturedProfile.unit||"—"}</div>}
    <div className="detail-grid" style={{marginTop:12}}>
      <div><span>CAPACITY</span><strong>{row.answers?.accountType||row.accountType||"—"}</strong></div>
      <div><span>ROLE / POSITION</span><strong>{row.answers?.primaryRole||row.requestedRole||"—"}</strong></div>
      <div><span>EMAIL</span><strong>{row.answers?.verifiedEmail||row.email||"—"}</strong></div>
      <div><span>FULL NAME</span><strong>{row.answers?.verifiedFullName||row.fullName||"—"}</strong></div>
      <div><span>Q1</span><strong>{row.answers?.q1||"—"}</strong></div>
      <div><span>Q2</span><strong>{row.answers?.q2||"—"}</strong></div>
      <div><span>Q3</span><strong>{row.answers?.q3||"—"}</strong></div>
      <div><span>Q4</span><strong>{row.answers?.q4||"—"}</strong></div>
      <div><span>Q5</span><strong>{row.answers?.q5||"—"}</strong></div>
      <div><span>Q6</span><strong>{row.answers?.q6||"—"}</strong></div>
      <div><span>COMMENTS</span><strong>{row.answers?.comments||"—"}</strong></div>
      <div><span>FEEDBACK</span><strong>{row.feedbackStatus||"—"}</strong></div>
    </div>
   </section>
   {canDecide&&<div className="form-actions" style={{marginTop:16}}>
     <button type="button" onClick={()=>link(row)} disabled={action===row.id}>{action===row.id?"PROCESSING…":"APPROVE & LINK"}</button>
     <button type="button" className="secondary-button" onClick={()=>reject(row)} disabled={action===row.id}>{action===row.id?"PROCESSING…":"REJECT & FEEDBACK"}</button>
   </div>}
  </article>;

 return <div className="page">
  <section className="welcome-panel"><div><span className="eyebrow">ADMINISTRATOR INDUCTION CONTROL</span><h1>Induction and Orientation — Administrator Applications</h1><p>This register is the direct application reception point for Induction & Orientation submissions. The system-generated submission report is stored with the application itself, not sent to administrators by email. Each report is traceable through the audit record using the application ID.</p></div><div className="identity-card"><span>ADVANCED FOR DECISION</span><strong>{advanced.length}</strong><small>Applications at or above the 75% threshold</small></div></section>
  {message&&<div className="auth-message" role="status" aria-live="polite" style={{marginBottom:18}}>{message}</div>}
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">APPLICANT WORKFLOW</span><h2>Induction submission and automated routing</h2><p className="panel-description">The applicant submits the form with the email address supplied during filling. The system scores accuracy, stores the full submission report with the application reception record, records the audit trail, sends applicant feedback where required, and advances only applications scoring 75% or higher to this administrator decision queue.</p></div><button type="button" className="secondary-button" onClick={load} disabled={busy}>{busy?"Refreshing…":"Refresh Applications"}</button></div></section>
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">PENDING SUBMISSIONS</span><h2>Submitted but Awaiting Automated Routing</h2><p className="panel-description">This recovery queue ensures a submission remains visible to administrators even if the applicant-session routing call was interrupted. Processing scores the saved application and places it in the normal 75% decision workflow.</p></div></div>
   {pending.length===0?<p className="muted">No pending submissions.</p>:<div style={{display:"grid",gap:14,marginTop:18}}>{pending.map(x=><article key={x.id} className="stat-card"><div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><span>APPLICANT</span><strong>{x.fullName||"Unnamed applicant"}</strong><small>{x.email||"No email"}</small></div><div><span>STATUS</span><strong>{x.status||"Submitted"}</strong><small>Awaiting scoring/routing</small></div></div><div className="form-actions" style={{marginTop:16}}><button type="button" onClick={()=>processPending(x)} disabled={action===x.id}>{action===x.id?"PROCESSING…":"PROCESS & SCORE"}</button></div></article>)}</div>}
  </section>
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">DECISION QUEUE</span><h2>Applications Advanced to Administrator</h2><p className="panel-description">These applications reached at least 75% accuracy and are available for administrator decision.</p></div></div>
   {busy?<p className="muted">Loading applications…</p>:advanced.length===0?<p className="muted">No applications currently meet the administrator advancement threshold.</p>:<div style={{display:"grid",gap:14,marginTop:18}}>{advanced.map(x=>card(x,true))}</div>}
  </section>
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">FILTERED APPLICATIONS</span><h2>Below 75% — Applicant Feedback Sent</h2><p className="panel-description">These applications are not presented as approval candidates. The system has sent feedback to the applicant email identifying the items requiring correction.</p></div></div>
   {filtered.length===0?<p className="muted">No filtered applications.</p>:<div style={{display:"grid",gap:14,marginTop:18}}>{filtered.map(x=>card(x,false))}</div>}
  </section>
  {decided.length>0&&<section className="panel"><div className="panel-header"><div><span className="eyebrow">DECISION HISTORY</span><h2>Administrator Decisions</h2></div></div><div style={{display:"grid",gap:14}}>{decided.map(x=>card(x,false))}</div></section>}
 </div>
}
