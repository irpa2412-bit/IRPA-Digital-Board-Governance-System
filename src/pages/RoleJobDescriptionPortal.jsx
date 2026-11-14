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
function OrganisationalStructure({isAdmin}){
  return <section className="role-description-card" aria-labelledby="irpa-structure-handoff">
    <p className="role-description-kicker">EXECUTIVE DIRECTOR'S ORGANISATIONAL COPY</p>
    <h2 id="irpa-structure-handoff">Directorate, department and unit framework</h2>
    <p>The complete approved-structure draft is made visible to the Executive Director for organisational planning and preparation of written role and duty assignment instructions. The Administrator uses these instructions for controlled administrative recording.</p>
    {authority.directorates.map(directorate=><section key={directorate.name} style={{marginTop:18}}>
      <h3>{directorate.name}</h3>
      {directorate.departments.map(department=><div key={department.name} style={{margin:"10px 0 10px 16px"}}>
        <h4>{department.name}</h4>
        <p><strong>Department purpose:</strong> Coordinate and supervise the approved work programme for {department.name}, translating directorate priorities into unit plans, technical guidance, performance monitoring and accountable reporting.</p>
        <p><strong>Department duties:</strong> Prepare annual and periodic work-plan inputs; coordinate and support the listed units; maintain technical standards and operational records; monitor delivery, risks and resource needs; submit consolidated progress reports to the directorate lead; comply with safeguarding, finance, procurement and information-governance controls.</p>
        <ul>{department.units.map(unit=><li key={unit}><strong>{unit}</strong><p><strong>Unit purpose:</strong> Plan and deliver approved activities within the functional scope of {unit}, in accordance with the department work plan and directorate priorities.</p><p><strong>Core duties:</strong> Prepare activity plans and implementation schedules; coordinate assigned technical and field activities; maintain accurate unit records and supporting evidence; track outputs, issues and risks; provide timely reports to the department head; apply approved policies and safeguarding requirements. Any technical standards, targets and professional qualifications are to be confirmed by the Executive Director.</p></li>)}</ul>
      </div>)}
    </section>)}
    <section style={{marginTop:18}}><h3>{authority.centralOffice.name} · Central Office</h3>{authority.centralOffice.departments.map(d=><div key={d.name}><h4>{d.name}</h4><p>Coordinate Executive Office administration, Board-directed organisational priorities, executive planning and cross-directorate follow-up.</p><ul>{d.units.map(unit=><li key={unit}><strong>{unit}</strong><p>Maintain executive coordination or organisational administration records, track assigned actions and deadlines, and provide accurate follow-up reports to the Executive Director.</p></li>)}</ul></div>)}</section>
    <p className="role-description-note">This is the structural placement framework, not a completed position-by-position job evaluation. Departmental and unit-specific duties, qualifications, reporting arrangements and performance indicators require Executive Director review before adoption.</p>
  </section>;
}
function AssignmentMandate({isAdmin}){
  if(!isAdmin)return null;
  const mandate=authority.assignmentGovernance?.administrator;
  const ed=authority.assignmentGovernance?.executiveDirector;
  return <section className="role-description-card" aria-labelledby="admin-assignment-mandate">
    <p className="role-description-kicker">ADMINISTRATOR · DELEGATED EXECUTION MANDATE</p>
    <h2 id="admin-assignment-mandate">Role and duty assignment instructions</h2>
    <p><strong>Mandate:</strong> {mandate?.mandate}</p>
    <h3>Mandatory prerequisites before execution</h3><ol>{bullets(mandate?.prerequisites)}</ol>
    <h3>Prohibited actions</h3><ul>{bullets(mandate?.prohibited)}</ul>
    <h3>Executive Director instruction requirements</h3><ul>{bullets(ed?.requiredInstructionFields)}</ul>
    <p className="role-description-note">{mandate?.accessEffect}</p>
  </section>;
}
export default function RoleJobDescriptionPortal({selectedAuthority,roles=[],isAdmin=false}){
  const isExecutiveDirector=String(selectedAuthority||"").trim()==="Executive Director"||(Array.isArray(roles)&&roles.includes("Executive Director"));
  const visible=useMemo(()=>{
    if(isAdmin||isExecutiveDirector)return authority.roles;
    const names=new Set([selectedAuthority,...(Array.isArray(roles)?roles:[])].map(x=>String(x||"").trim()).filter(Boolean));
    return authority.roles.filter(role=>names.has(role.title));
  },[selectedAuthority,roles,isAdmin,isExecutiveDirector]);
  return <main className="role-description-portal"><div className="role-description-intro"><p className="role-description-kicker">ORGANISATIONAL AUTHORITY REGISTER</p><h1>Job Descriptions and Access</h1><p>Read-only draft descriptions. A job description does not grant access by itself; the matching Firestore rule and workflow enforcement must also exist.</p><p><strong>Protected rule:</strong> restricted research data remains denied by default. No position is appointed by this register.</p></div>
    {(isExecutiveDirector||isAdmin)&&<OrganisationalStructure isAdmin={isAdmin}/>}
    <AssignmentMandate isAdmin={isAdmin}/>
    {visible.length?visible.map(role=><RoleCard key={role.id} role={role}/>):<section className="role-description-card"><h2>No matched job description</h2><p>Your current role does not yet map to a canonical description. Access remains unchanged and no new permissions are granted.</p></section>}
  </main>;
}
