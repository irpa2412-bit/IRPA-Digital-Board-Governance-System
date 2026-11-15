import React,{useEffect,useMemo,useState}from"react";
import{collection,doc,getDocs,query,where,setDoc,updateDoc,serverTimestamp}from"firebase/firestore";
import{auth,db}from"../firebase/config";
import authority from"../../config/org-structure-authority.json";
import "./JobDescriptionWorkflowPortal.css";

const RESERVED_ROLE_IDS=new Set(["administrator","board-chairperson","board-vice-chairperson","board-secretary","board-treasurer","board-member","executive-director"]);
const activeRecord=d=>["active","activated"].includes(String(d.status||d.employmentStatus||d.registrationStatus||"").toLowerCase());
const displayName=d=>String(d.name||d.fullName||d.displayName||[d.firstName,d.middleName,d.lastName].filter(Boolean).join(" ")||d.email||"Unnamed account").trim();
const asText=v=>String(v??"").trim();
function Status({children}){return <span className="jdwf-status">{children}</span>}
function RoleSummary({role}){return <div className="jdwf-role-summary"><div><strong>{role.title}</strong><p>{role.directorate} · {role.department}</p></div><Status>{role.appointmentStatus||"UNCONFIRMED"}</Status></div>}
export default function JobDescriptionWorkflowPortal({selectedAuthority,isAdmin=false,user,profile,employee}){
 const uid=auth.currentUser?.uid||user?.uid||"";
 const isExecutiveDirector=String(selectedAuthority||"").toUpperCase()==="EXECUTIVE DIRECTOR";
 const canManage=isAdmin||isExecutiveDirector;
 const [workflows,setWorkflows]=useState([]);
 const [identities,setIdentities]=useState([]);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [message,setMessage]=useState("");
 const [edDecisions,setEdDecisions]=useState({});
 const [evidence,setEvidence]=useState({});
 const [acknowledgements,setAcknowledgements]=useState({});
 const roles=authority.roles||[];
 const load=async()=>{
  setLoading(true);setMessage("");
  try{
   const ref=collection(db,"jobDescriptionWorkflows");
   const snap=canManage?await getDocs(ref):await getDocs(query(ref,where("designatedRecipientUid","==",uid)));
   setWorkflows(snap.docs.map(d=>({id:d.id,...d.data()})));
   if(isAdmin||isExecutiveDirector){
    const [members,employees]=await Promise.all([getDocs(collection(db,"members")),getDocs(collection(db,"employees"))]);
    const rows=[...members.docs.map(d=>({uid:d.id,source:"Member",...d.data()})),...employees.docs.map(d=>({uid:d.id,source:"Employee",...d.data()}))];
    const unique=new Map();
    for(const row of rows){if(row.uid&&activeRecord(row)&&!unique.has(row.uid))unique.set(row.uid,row);}
    setIdentities([...unique.values()].sort((a,b)=>displayName(a).localeCompare(displayName(b))));
   }
  }catch(e){setMessage(e?.message||"The intranet workflow could not be loaded. No changes were made.");}
  finally{setLoading(false);}
 };
 useEffect(()=>{if(uid)load();else{setLoading(false);setMessage("Sign-in is required.");}},[uid,canManage,isAdmin]);
 const workflowByRole=useMemo(()=>new Map(workflows.map(w=>[w.roleId,w])),[workflows]);
 const releaseableRoles=roles.filter(r=>!RESERVED_ROLE_IDS.has(r.id));
 const releaseRole=async role=>{
  if(!isExecutiveDirector||!uid)return;
  const form=edDecisions[role.id]||{};
  const target=identities.find(x=>x.uid===form.uid);
  if(!target){setMessage("The Executive Director must identify the intended position-holder.");return;}
  if(!asText(form.appointmentReference)||!asText(form.delegationReference)||!asText(form.effectiveFrom)||!asText(form.reviewBy)){setMessage("The Executive Director must record appointment/engagement, delegation/resolution and effective/review dates.");return;}
  setBusy(true);setMessage("");
  try{
   const current=workflowByRole.get(role.id);
   if(current)throw new Error("A workflow already exists for this position. Use its current record; do not overwrite its history.");
   const version=1;
   await setDoc(doc(db,"jobDescriptionWorkflows",role.id),{
    roleId:role.id,roleTitle:role.title,roleSnapshot:role,version,
    status:"ED_APPROVED_PENDING_ADMIN_DISTRIBUTION",
    approvedByUid:uid,approvedByCapacity:"Executive Director",
    designatedRecipientUid:target.uid,designatedRecipientName:displayName(target),designatedRecipientEmail:asText(target.email),
    appointmentReference:asText(form.appointmentReference),delegationReference:asText(form.delegationReference),
    effectiveFrom:asText(form.effectiveFrom),reviewBy:asText(form.reviewBy),
    releasedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
    assignedUid:target.uid,permissionsActivated:false,recordOrigin:"PRODUCTION"
   });
   setMessage("Approved "+role.title+" for "+displayName(target)+". The Administrator may now distribute the approved document only; no authority or access is activated.");
   await load();
  }catch(e){setMessage(e?.message||"Release failed. No permission was activated.");}
  finally{setBusy(false);}
 };
 const distributeRole=async workflow=>{
  if(!isAdmin||!uid)return;
  if(!workflow.designatedRecipientUid){setMessage("No Executive Director-designated recipient exists. Distribution blocked.");return;}
  setBusy(true);setMessage("");
  try{
   await updateDoc(doc(db,"jobDescriptionWorkflows",workflow.roleId),{
    status:"RELEASED_TO_DELEGATE",distributedByUid:uid,distributedAt:serverTimestamp(),
    updatedByUid:uid,updatedAt:serverTimestamp(),permissionsActivated:false
   });
   setMessage("Approved job description distributed to "+workflow.designatedRecipientName+". The Administrator has not changed the assignment or its terms.");
   await load();
  }catch(e){setMessage(e?.message||"Distribution rejected by intranet controls.");}
  finally{setBusy(false);}
 };
 const acknowledge=async workflow=>{
  if(workflow.designatedRecipientUid!==uid)return;
  setBusy(true);setMessage("");
  try{
   await updateDoc(doc(db,"jobDescriptionWorkflows",workflow.roleId),{
    status:"ACKNOWLEDGED_PENDING_ED_VERIFICATION",
    acknowledgementNote:asText(acknowledgements[workflow.roleId])||"I acknowledge receipt of this job description and understand that it does not itself grant system permissions.",
    acknowledgedByUid:uid,acknowledgedAt:serverTimestamp(),updatedByUid:uid,updatedAt:serverTimestamp(),
    permissionsActivated:false
   });
   setMessage("Acknowledgement recorded. The Executive Director must verify the appointment and delegation evidence.");
   await load();
  }catch(e){setMessage(e?.message||"Acknowledgement could not be recorded.");}
  finally{setBusy(false);}
 };
 const verify=async workflow=>{
  if(!isExecutiveDirector||!uid)return;
  if(!asText(evidence[workflow.roleId])){setMessage("Enter the governing appointment/engagement evidence reference reviewed by the Executive Director.");return;}
  setBusy(true);setMessage("");
  try{
   await updateDoc(doc(db,"jobDescriptionWorkflows",workflow.roleId),{
    status:"VERIFIED_PENDING_SERVER_AUTHORIZATION",
    authorityEvidenceReference:asText(evidence[workflow.roleId]),
    authorityVerifiedByUid:uid,authorityVerifiedAt:serverTimestamp(),
    updatedByUid:uid,updatedAt:serverTimestamp(),permissionsActivated:false
   });
   setMessage("Evidence verification recorded. Runtime permissions remain DENIED until a separately tested server-side authorization release.");
   await load();
  }catch(e){setMessage(e?.message||"Evidence verification was rejected.");}
  finally{setBusy(false);}
 };
 const statusFor=role=>workflowByRole.get(role.id)?.status||"NOT YET APPROVED";
 return <main className="jdwf-shell">
  <header className="jdwf-hero"><p className="jdwf-eyebrow">IRPA INTERNAL GOVERNANCE WORKFLOW</p><h1>Job Description Release & Assignment</h1><p>Version-controlled job descriptions, internal routing, assignment evidence, acknowledgement and authorisation review. All actions are recorded inside DBGS.</p><div className="jdwf-guardrail"><strong>Authority safeguard:</strong> Job description release, assignment or acknowledgement does not grant application access, financial authority, signing authority or bank-signatory status.</div></header>
  {message&&<div className="jdwf-message" role="status">{message}</div>}
  {loading?<p role="status">Loading secure intranet records…</p>:<>
   {isExecutiveDirector&&<section className="jdwf-panel"><div className="jdwf-panel-heading"><div><h2>Executive Director — Review and release</h2><p>Review the complete catalogue, determine the intended position-holder, approve the responsibilities and evidence, then authorise controlled distribution.</p></div><Status>ED CONTROL</Status></div><div className="jdwf-role-list">{releaseableRoles.map(role=><article className="jdwf-item" key={role.id}><RoleSummary role={role}/><p>{statusFor(role)}</p>{workflowByRole.has(role.id)?<p className="jdwf-muted">Version {workflowByRole.get(role.id).version} is already in the controlled workflow.</p>:<><label>Executive Director-designated position-holder<select value={edDecisions[role.id]?.uid||""} onChange={e=>setEdDecisions(v=>({...v,[role.id]:{...v[role.id],uid:e.target.value}}))}><option value="">Select verified active person</option>{identities.map(x=><option key={x.uid} value={x.uid}>{displayName(x)} · {x.source}</option>)}</select></label><div className="jdwf-fields"><label>Appointment / engagement reference<input value={edDecisions[role.id]?.appointmentReference||""} onChange={e=>setEdDecisions(v=>({...v,[role.id]:{...v[role.id],appointmentReference:e.target.value}}))}/></label><label>Written delegation / resolution reference<input value={edDecisions[role.id]?.delegationReference||""} onChange={e=>setEdDecisions(v=>({...v[role.id],delegationReference:e.target.value}))}/></label><label>Effective from<input type="date" value={edDecisions[role.id]?.effectiveFrom||""} onChange={e=>setEdDecisions(v=>({...v,[role.id]:{...v[role.id],effectiveFrom:e.target.value}}))}/></label><label>Review / expiry date<input type="date" value={edDecisions[role.id]?.reviewBy||""} onChange={e=>setEdDecisions(v=>({...v,[role.id]:{...v[role.id],reviewBy:e.target.value}}))}/></label></div><button disabled={busy} onClick={()=>releaseRole(role)}>Approve assignment and instruct Administrator to distribute</button></>}</article>)}</div></section>}
   {isAdmin&&<section className="jdwf-panel"><div className="jdwf-panel-heading"><div><h2>Administrator — Distribution queue</h2><p>Distribute the exact Executive Director-approved job description to the named recipient. You cannot select or substitute the recipient, edit responsibilities or alter authority limits.</p></div><Status>DISTRIBUTION ONLY</Status></div>{workflows.filter(w=>w.status==="ED_APPROVED_PENDING_ADMIN_DISTRIBUTION").length===0&&<p className="jdwf-muted">No Executive Director instructions are awaiting distribution.</p>}{workflows.filter(w=>w.status==="ED_APPROVED_PENDING_ADMIN_DISTRIBUTION").map(w=><article className="jdwf-item" key={w.roleId}><h3>{w.roleTitle}</h3><p>Designated recipient: <strong>{w.designatedRecipientName}</strong></p><p>Appointment/engagement: {w.appointmentReference}</p><p>Delegation/resolution: {w.delegationReference}</p><p>Effective: {w.effectiveFrom} · Review: {w.reviewBy}</p><p>Approved by Executive Director · Version {w.version}</p><button disabled={busy} onClick={()=>distributeRole(w)}>Distribute approved JD to named delegate</button></article>)}</section>}
   {isExecutiveDirector&&<section className="jdwf-panel"><div className="jdwf-panel-heading"><div><h2>Executive Director — Authority verification</h2><p>Review the delegate's acknowledgement and the referenced appointment and delegation evidence.</p></div></div>{workflows.filter(w=>w.status==="ACKNOWLEDGED_PENDING_ED_VERIFICATION").map(w=><article className="jdwf-item" key={w.roleId}><h3>{w.roleTitle}</h3><p>Delegate: {w.designatedRecipientName} · Acknowledged</p><p>Appointment/engagement: {w.appointmentReference}</p><p>Delegation: {w.delegationReference}</p><label>Governing evidence reference reviewed<input value={evidence[w.roleId]||""} onChange={e=>setEvidence(v=>({...v,[w.roleId]:e.target.value}))}/></label><button disabled={busy} onClick={()=>verify(w)}>Record ED evidence verification</button></article>)}</section>}
   {!canManage&&<section className="jdwf-panel"><h2>My assigned job descriptions</h2>{workflows.length===0?<p>No job description has been released to your authenticated account.</p>:workflows.map(w=><article className="jdwf-item" key={w.roleId}><h3>{w.roleTitle}</h3><p>Workflow status: <strong>{w.status}</strong></p><p>Effective: {w.effectiveFrom||"Not recorded"} · Review: {w.reviewBy||"Not recorded"}</p><p>Appointment/engagement reference: {w.appointmentReference||"Pending"}</p><p>Written delegation reference: {w.delegationReference||"Pending"}</p><p>{w.roleSnapshot?.purpose}</p><h4>Key duties</h4><ul>{(w.roleSnapshot?.keyDuties||[]).map((x,i)=><li key={i}>{x}</li>)}</ul><h4>Limits and prohibited actions</h4><p>{w.roleSnapshot?.limits?.documentValue||"As specified in the approved job description"}</p><ul>{(w.roleSnapshot?.prohibitedActions||[]).map((x,i)=><li key={i}>{x}</li>)}</ul>{w.status==="RELEASED_TO_DELEGATE"&&<><label>Acknowledgement note (optional)<textarea value={acknowledgements[w.roleId]||""} onChange={e=>setAcknowledgements(v=>({...v,[w.roleId]:e.target.value}))}/></label><button disabled={busy} onClick={()=>acknowledge(w)}>Acknowledge receipt</button></>}</article>)}</section>}
   {canManage&&<section className="jdwf-panel"><h2>Workflow register</h2>{workflows.length===0?<p>No released descriptions have entered the workflow.</p>:workflows.map(w=><article className="jdwf-register-row" key={w.roleId}><strong>{w.roleTitle}</strong><span>v{w.version}</span><Status>{w.status}</Status><span>{w.designatedRecipientName||"Awaiting Executive Director designation"}</span></article>)}</section>}
  </>}
 </main>;
}
