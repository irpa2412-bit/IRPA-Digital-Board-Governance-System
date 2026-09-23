import React,{useEffect,useState}from"react";
import{getInductionRegistrationRequests,linkInductionRegistration,rejectInductionRegistration}from"../firebase/data";

export default function InductionAdmin(){
 const[rows,setRows]=useState([]),[busy,setBusy]=useState(true),[action,setAction]=useState(""),[message,setMessage]=useState("");
 async function load(){setBusy(true);setMessage("");try{const r=await getInductionRegistrationRequests();setRows(r)}catch(e){setMessage(e.message||"Unable to load induction applications.")}finally{setBusy(false)}}
 useEffect(()=>{load()},[]);
 async function link(row){setAction(row.id);setMessage("");try{const result=await linkInductionRegistration(row.id);setMessage("APPROVED and LINKED. "+(row.fullName||row.email)+" has received the administrator decision through the system email route.");await load()}catch(e){setMessage(e.message||"The application could not be approved.")}finally{setAction("")}}
 async function reject(row){const reason=window.prompt("Enter the administrator decision reason that must be sent to the applicant by email:","The application requires further verification before approval.");if(!reason||!reason.trim())return;setAction(row.id);setMessage("");try{await rejectInductionRegistration(row.id,reason.trim());setMessage("REJECTED. The applicant has been sent the administrator decision and reason through the system email route.");await load()}catch(e){setMessage(e.message||"The application could not be rejected.")}finally{setAction("")}}

 const advanced=rows.filter(x=>x.routingStatus==="Advanced to Administrator"&&x.status!=="Linked"&&x.roleAssignmentStatus!=="Linked");
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
    <div className="panel-header"><div><span className="eyebrow">SYSTEM-GENERATED SUMMARY</span><h3>Administrator Decision Brief</h3></div></div>
    <p className="panel-description">{row.systemSummary||"No summary has been generated."}</p>
    {Array.isArray(row.accuracyIssues)&&row.accuracyIssues.length>0&&<div className="field-help"><strong>Items requiring attention:</strong> {row.accuracyIssues.join(", ")}</div>}
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
  <section className="welcome-panel"><div><span className="eyebrow">ADMINISTRATOR INDUCTION CONTROL</span><h1>Induction and Orientation — Administrator Applications</h1><p>This register receives applications only after the automated accuracy gateway reaches the 75% threshold. Each application receives system feedback. Advanced applications include a short system-generated decision brief; filtered applications remain outside the decision queue until corrected and resubmitted.</p></div><div className="identity-card"><span>ADVANCED FOR DECISION</span><strong>{advanced.length}</strong><small>Applications at or above the 75% threshold</small></div></section>
  {message&&<div className="auth-message" role="status" aria-live="polite" style={{marginBottom:18}}>{message}</div>}
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">APPLICANT WORKFLOW</span><h2>Induction submission and automated routing</h2><p className="panel-description">The applicant submits the form with the email address supplied during filling. The system scores accuracy, records the reasons, sends applicant feedback and advances only applications scoring 75% or higher to this administrator decision queue.</p></div><button type="button" className="secondary-button" onClick={load} disabled={busy}>{busy?"Refreshing…":"Refresh Applications"}</button></div></section>
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">DECISION QUEUE</span><h2>Applications Advanced to Administrator</h2><p className="panel-description">These applications reached at least 75% accuracy and are available for administrator decision.</p></div></div>
   {busy?<p className="muted">Loading applications…</p>:advanced.length===0?<p className="muted">No applications currently meet the administrator advancement threshold.</p>:<div style={{display:"grid",gap:14,marginTop:18}}>{advanced.map(x=>card(x,true))}</div>}
  </section>
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">FILTERED APPLICATIONS</span><h2>Below 75% — Applicant Feedback Sent</h2><p className="panel-description">These applications are not presented as approval candidates. The system has sent feedback to the applicant email identifying the items requiring correction.</p></div></div>
   {filtered.length===0?<p className="muted">No filtered applications.</p>:<div style={{display:"grid",gap:14,marginTop:18}}>{filtered.map(x=>card(x,false))}</div>}
  </section>
  {decided.length>0&&<section className="panel"><div className="panel-header"><div><span className="eyebrow">DECISION HISTORY</span><h2>Administrator Decisions</h2></div></div><div style={{display:"grid",gap:14}}>{decided.map(x=>card(x,false))}</div></section>}
 </div>
}
