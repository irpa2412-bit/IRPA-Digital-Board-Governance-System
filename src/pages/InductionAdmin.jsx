import React,{useEffect,useState}from"react";
import{getInductionRegistrationRequests,linkInductionRegistration}from"../firebase/data";
export default function InductionAdmin(){
 const[rows,setRows]=useState([]),[busy,setBusy]=useState(true),[action,setAction]=useState(""),[message,setMessage]=useState("");
 async function load(){setBusy(true);setMessage("");try{setRows(await getInductionRegistrationRequests())}catch(e){setMessage(e.message||"Unable to load induction applications.")}finally{setBusy(false)}}
 useEffect(()=>{load()},[]);
 async function link(row){setAction(row.id);setMessage("");try{const result=await linkInductionRegistration(row.id);setMessage("LINK completed. "+(row.fullName||row.email)+" is now approved and linked to "+(result.boardMember?"Board Member":(result.department||"the registered department"))+(result.unit?" — "+result.unit:"")+" .");await load()}catch(e){setMessage(e.message||"The application could not be linked.")}finally{setAction("")}}
 const pending=rows.filter(x=>x.status!=="Linked"&&x.roleAssignmentStatus!=="Linked");
 return <div className="page">
  <section className="welcome-panel"><div><span className="eyebrow">ADMINISTRATOR INDUCTION CONTROL</span><h1>Induction & Tutorial Applications</h1><p>Review completed induction applications against information already registered in the IRPA system. Only authenticated applicants with retrievable registration records can reach the submission stage.</p></div><div className="identity-card"><span>Pending LINK</span><strong>{pending.length}</strong><small>Applications awaiting administrator approval</small></div></section>
  {message&&<div className="auth-message" role="status" aria-live="polite" style={{marginBottom:18}}>{message}</div>}
  <section className="panel"><div className="panel-header"><div><span className="eyebrow">APPLICATION REGISTER</span><h2>Completed Induction Applications</h2><p className="panel-description">Use <strong>LINK</strong> to approve the induction and immediately bind the applicant to the department/unit or Board Member identity already held in the system.</p></div><button type="button" className="secondary-button" onClick={load} disabled={busy}>{busy?"Refreshing…":"Refresh Applications"}</button></div>
   {busy?<p className="muted">Loading applications…</p>:rows.length===0?<p className="muted">No induction applications have been submitted.</p>:
   <div style={{display:"grid",gap:14,marginTop:18}}>{rows.map(row=><article key={row.id} className="stat-card">
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><span>APPLICANT</span><strong>{row.fullName||"Unnamed applicant"}</strong><small>{row.email||"No email"} · {row.memberEmployeeNumber||"No registration number"}</small></div><div><span>STATUS</span><strong>{row.status||"Pending"}</strong><small>{row.roleAssignmentStatus||"Pending Assignment"}</small></div></div>
    <div className="dashboard-grid" style={{marginTop:14}}><div><span>ROLE</span><strong>{row.systemRole||row.requestedRole||"—"}</strong></div><div><span>DEPARTMENT</span><strong>{row.systemDepartment||row.routingDepartment||"—"}</strong></div><div><span>UNIT</span><strong>{row.systemUnit||row.routingUnit||"—"}</strong></div><div><span>BOARD MEMBER</span><strong>{row.boardMember?"Yes":"No"}</strong></div></div>
    <div className="form-actions" style={{marginTop:16}}><button type="button" onClick={()=>link(row)} disabled={action===row.id||row.status==="Linked"||row.roleAssignmentStatus==="Linked"}>{action===row.id?"LINKING…":row.status==="Linked"||row.roleAssignmentStatus==="Linked"?"LINKED":"LINK"}</button></div>
   </article>)}</div>}
  </section>
 </div>
}
