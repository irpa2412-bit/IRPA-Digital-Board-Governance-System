import React,{useMemo}from"react";
import authority from "../../config/org-structure-authority.json";
import "./RoleJobDescriptionPortal.css";

function bullets(values,empty="None assigned in this draft"){
  return Array.isArray(values)&&values.length?values.map((value,index)=><li key={index}>{value}</li>):<li>{empty}</li>;
}
function RoleCard({role}){
  return <article className="role-description-card">
    <header><div><p className="role-description-kicker">DRAFT JOB DESCRIPTION · READ ONLY</p><h2>{role.title}</h2><p>{role.directorate} · {role.department} · {role.unit}</p></div><span className="role-description-status">{role.appointmentStatus||"INTERIM"}</span></header>
    <p><strong>Reports to:</strong> {role.reportingLine}</p><p><strong>Purpose:</strong> {role.purpose}</p>
    <h3>Key duties</h3><ul>{bullets(role.keyDuties)}</ul>
    <p><strong>Positions required:</strong> {role.positionsRequired}</p><p><strong>Qualifications:</strong> {role.qualifications}</p>
    <h3>Workflow authority</h3><div className="role-description-grid">{Object.entries({Initiate:role.workflows?.mayInitiate,Review:role.workflows?.mayReview,Approve:role.workflows?.mayApprove,Sign:role.workflows?.maySign,Release:role.workflows?.mayRelease}).map(([label,values])=><section key={label}><strong>{label}</strong><ul>{bullets(values)}</ul></section>)}</div>
    <h3>Records</h3><p><strong>Read:</strong> {(role.records?.mayRead||[]).join(", ")||"None assigned in this draft"}</p><p><strong>Write:</strong> {(role.records?.mayWrite||[]).join(", ")||"None assigned in this draft"}</p>
    <p><strong>Limits:</strong> {role.limits?.documentValue} {role.limits?.classificationMax}</p>
    <h3>Prohibited actions</h3><ul>{bullets(role.prohibitedActions)}</ul><h3>Separation of duties</h3><ul>{bullets(role.separationOfDutiesConflicts)}</ul>
    {role.sealingConditions&&<><h3>Conditions for sealing</h3><ul>{bullets(role.sealingConditions)}</ul></>}
    <p className="role-description-note">This is a draft description, not an appointment or a grant of access. Access is denied until the corresponding server-side rule and workflow enforcement are verified.</p>
  </article>;
}
export default function RoleJobDescriptionPortal({selectedAuthority,roles=[],isAdmin=false}){
  const visible=useMemo(()=>{
    if(isAdmin)return authority.roles;
    const names=new Set([selectedAuthority,...(Array.isArray(roles)?roles:[])].map(x=>String(x||"").trim()).filter(Boolean));
    return authority.roles.filter(role=>names.has(role.title));
  },[selectedAuthority,roles,isAdmin]);
  return <main className="role-description-portal"><div className="role-description-intro"><p className="role-description-kicker">ORGANISATIONAL AUTHORITY REGISTER</p><h1>Job Descriptions and Access</h1><p>Read-only draft descriptions. A job description does not grant access by itself; the matching Firestore rule and workflow enforcement must also exist.</p><p><strong>Protected rule:</strong> restricted research data remains denied by default. No position is appointed by this register.</p></div>
    {visible.length?visible.map(role=><RoleCard key={role.id} role={role}/>):<section className="role-description-card"><h2>No matched job description</h2><p>Your current role does not yet map to a canonical description. Access remains unchanged and no new permissions are granted.</p></section>}
  </main>;
}
