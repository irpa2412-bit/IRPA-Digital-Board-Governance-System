import React,{useEffect,useMemo,useState}from"react";
import{addDoc,collection,getDocs,orderBy,query,serverTimestamp,where}from"firebase/firestore";
import{auth,db}from"../firebase/config";

const BRANCHES=[
 {id:"service-operations",name:"IT Service & Operations Branch",description:"Front-line support, infrastructure, networks, cloud services and IT assets.",units:["Service Desk & User Support","Infrastructure, Network & Cloud","IT Asset & Vendor Management"]},
 {id:"security",name:"Cybersecurity & Access Branch",description:"Identity, access control, security monitoring, incidents and protection of DBGS services.",units:["Cybersecurity & Access Management"]},
 {id:"digital-systems",name:"Digital Systems & Applications Branch",description:"DBGS applications, integrations, testing, releases and technical application support.",units:["Applications & Digital Systems"]},
 {id:"website-digital",name:"Website & Digital Communications Branch",description:"IRPA website updates, repairs, maintenance, content publishing and DBGS-to-website connectivity.",units:["Website, Communications & Digital Content"]},
 {id:"data-continuity",name:"Data, Continuity & Recovery Branch",description:"Data quality, backup, restoration, disaster recovery and operational continuity.",units:["Data, Backup & Recovery"]},
 {id:"governance-qa",name:"IT Governance, QA & Change Branch",description:"IT policy, standards, change control, quality assurance, release evidence and audit readiness.",units:["IT Governance, QA & Change Control"]}
];

const UNITS=[
 ["Service Desk & User Support","User accounts, support requests, devices and user training"],
 ["Infrastructure, Network & Cloud","Hosting, DNS, networks, cloud services and availability"],
 ["Cybersecurity & Access Management","Identity, permissions, security incidents and access reviews"],
 ["Applications & Digital Systems","DBGS applications, integrations, testing and release support"],
 ["Website, Communications & Digital Content","IRPA website updates, repairs, maintenance and public notices"],
 ["Data, Backup & Recovery","Data quality, backups, restoration and continuity controls"],
 ["IT Asset & Vendor Management","IT inventory, warranties, subscriptions and vendors"],
 ["IT Governance, QA & Change Control","Policies, documentation, testing, change approvals and audit evidence"]
];

const WORK_TYPES=["Service Request","Incident","Maintenance","Security Event","Website Update","Website Repair","Website Content","Change Request"];
const PRIORITIES=["Low","Normal","High","Critical"];
const STATUSES=["Open","In Progress","Pending Approval","Scheduled","Resolved","Closed"];

function actor(){return{uid:auth.currentUser?.uid||null,email:auth.currentUser?.email||null};}
function badge(status){return status==="Closed"||status==="Resolved"?"success":status==="Critical"||status==="Security Event"?"danger":"neutral";}

export default function ITDepartmentPortal({user,profile,employee,selectedAuthority,onNavigate}){
 const a=actor();
 const name=employee?.name||profile?.name||user?.displayName||user?.email||"IRPA IT User";
 const role=selectedAuthority||employee?.role||profile?.role||"IT Specialist";
 const department=employee?.department||profile?.department||"Information Technology";
 const assignedUnit=employee?.unit||employee?.unitName||profile?.unit||"";
 const assignedBranch=employee?.branch||employee?.branchName||profile?.branch||BRANCHES.find(b=>b.units.includes(assignedUnit))?.name||BRANCHES[0].name;
 const [branch,setBranch]=useState(assignedBranch);
 const [unit,setUnit]=useState(assignedUnit||BRANCHES.find(b=>b.name===assignedBranch)?.units?.[0]||UNITS[0][0]);
 const [tab,setTab]=useState("overview");
 const [records,setRecords]=useState([]);
 const [loading,setLoading]=useState(false);
 const [notice,setNotice]=useState("");
 const [form,setForm]=useState({type:"Service Request",title:"",description:"",priority:"Normal",branch:assignedBranch,unit:assignedUnit||BRANCHES.find(b=>b.name===assignedBranch)?.units?.[0]||UNITS[0][0],status:"Open",publicNotice:false,scheduledAt:""});
 const [noticeForm,setNoticeForm]=useState({title:"",message:"",severity:"Information",status:"Draft",publishFrom:"",publishUntil:""});
 const canEdit=true;
 const unitDescription=useMemo(()=>UNITS.find(x=>x[0]===unit)?.[1]||"",[unit]);

 const load=async()=>{
  setLoading(true);setNotice("");
  try{
   const q=query(collection(db,"itOperations"),where("department","==","Information Technology"),orderBy("createdAt","desc"));
   const snap=await getDocs(q);setRecords(snap.docs.map(d=>({id:d.id,...d.data()})));
  }catch(e){setNotice(e?.message||"Unable to load IT records.");}
  finally{setLoading(false);}
 };
 useEffect(()=>{load()},[]);

 const submit=async e=>{
  e.preventDefault();if(!form.title.trim()||!form.description.trim())return setNotice("Title and description are required.");
  try{
   const x=actor();await addDoc(collection(db,"itOperations"),{...form,title:form.title.trim(),description:form.description.trim(),department:"Information Technology",branch,unit,createdByUid:x.uid,createdByEmail:x.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditStatus:"Recorded"});
   setForm({...form,title:"",description:"",publicNotice:false,scheduledAt:""});setNotice("IT work item recorded successfully.");await load();
  }catch(e){setNotice(e?.message||"Unable to save the IT work item.");}
 };

 const publishNotice=async e=>{
  e.preventDefault();if(!noticeForm.title.trim()||!noticeForm.message.trim())return setNotice("Website notice title and message are required.");
  try{
   const x=actor();await addDoc(collection(db,"websiteCommunications"),{...noticeForm,title:noticeForm.title.trim(),message:noticeForm.message.trim(),source:"IRPA-DBGS IT Department",publishedByUid:x.uid,publishedByEmail:x.email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   setNoticeForm({title:"",message:"",severity:"Information",status:"Draft",publishFrom:"",publishUntil:""});setNotice("Website communication record created.");await load();
  }catch(e){setNotice(e?.message||"Unable to create the website communication.");}
 };

 const counts={open:records.filter(r=>["Open","In Progress","Pending Approval","Scheduled"].includes(r.status)).length,critical:records.filter(r=>r.priority==="Critical").length,website:records.filter(r=>["Website Update","Website Repair","Website Content","Maintenance"].includes(r.type)).length,security:records.filter(r=>r.type==="Security Event").length};

 return <div className="page">
  <section className="welcome-panel">
   <div><span className="eyebrow">INFORMATION TECHNOLOGY DEPARTMENT</span><h1>IT Department & Units Portal</h1><p>Central operational workspace for IRPA information systems, infrastructure, cybersecurity, digital applications and website communications.</p></div>
   <div className="identity-card"><span>Authenticated IT capacity</span><strong>{role}</strong><small>{name} · {department}</small></div>
  </section>

  {notice&&<div className="auth-message" style={{marginTop:16}}>{notice}</div>}

  <section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">DEPARTMENT ARCHITECTURE</span><h2>IT Branches & Units</h2><p className="muted">Branches are the primary departmental operating junctions. Each branch connects to its responsible IT units and to the shared DBGS platforms.</p></div></div>
   <div className="dashboard-grid it-branch-grid" style={{marginTop:16}}>
    {BRANCHES.map(b=><button key={b.id} type="button" className="stat-card it-branch-card" onClick={()=>{setBranch(b.name);const next=b.units.includes(unit)?unit:b.units[0];setUnit(next);setForm(f=>({...f,branch:b.name,unit:next}));setTab("overview")}} style={{textAlign:"left",cursor:"pointer",outline:branch===b.name?"2px solid currentColor":"none"}}>
      <span>IT BRANCH</span><strong>{b.name}</strong><small>{b.description}</small><small style={{marginTop:8}}><b>{b.units.length}</b> connected unit{b.units.length===1?"":"s"}</small>
    </button>)}
   </div>
   <div className="it-architecture-note" style={{marginTop:16}}>
    <strong>Connectivity architecture</strong><br/>
    IT Department → Branch → Unit → Work Item → Approval / Change Control → Deployment → Audit Evidence → Connected DBGS Platform.
    Shared junctions include Documents, Reports, Audit Trail, Settings, authentication/access control, website communications, data/backup controls and release verification.
   </div>
  </section>

  <section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">IT DEPARTMENT UNITS</span><h2>Departments / Operational Units</h2><p className="muted">These are the eight visible operational units of the Information Technology Department. Select any unit to open its connected workspace.</p></div></div>
   <div className="dashboard-grid it-unit-grid" style={{marginTop:16}}>
    {UNITS.map(([u,d],i)=>{const b=BRANCHES.find(x=>x.units.includes(u));return <button key={u} type="button" className="stat-card it-unit-card" onClick={()=>{if(b){setBranch(b.name);setUnit(u);setForm(f=>({...f,branch:b.name,unit:u}));}setTab("overview")}} style={{textAlign:"left",cursor:"pointer",outline:unit===u?"2px solid currentColor":"none"}}><span>IT UNIT {String(i+1).padStart(2,"0")}</span><strong>{u}</strong><small>{d}</small><small style={{marginTop:8}}>Branch: <b>{b?.name||"IT Department"}</b></small></button>})}
   </div>
  </section>

  <section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">BRANCH WORKSPACE</span><h2>{branch}</h2><p className="muted">{BRANCHES.find(b=>b.name===branch)?.description}</p></div></div>
   <div className="dashboard-grid" style={{marginTop:14}}>
    {(BRANCHES.find(b=>b.name===branch)?.units||[]).map(u=>{const d=UNITS.find(x=>x[0]===u)?.[1]||"";return <button key={u} type="button" className="stat-card" onClick={()=>{setUnit(u);setForm(f=>({...f,branch,unit:u}));setTab("overview")}} style={{textAlign:"left",cursor:"pointer",outline:unit===u?"2px solid currentColor":"none"}}><span>CONNECTED UNIT</span><strong>{u}</strong><small>{d}</small></button>})}
   </div>
  </section>

  <section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">CURRENT BRANCH / UNIT</span><h2>{unit}</h2><p className="muted">{unitDescription}</p></div></div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
    {["overview","work","website","governance"].map(x=><button key={x} type="button" className={tab===x?"":"secondary-button"} onClick={()=>setTab(x)}>{x==="overview"?"Overview":x==="work"?"IT Work Queue":x==="website"?"Website Bridge":"Governance & QA"}</button>)}
   </div>
  </section>

  {tab==="overview"&&<section className="dashboard-grid" style={{marginTop:18}}>
    <div className="stat-card"><span>OPEN WORK</span><strong>{counts.open}</strong><small>Open, active, pending or scheduled IT items.</small></div>
    <div className="stat-card"><span>CRITICAL</span><strong>{counts.critical}</strong><small>Critical-priority items requiring controlled response.</small></div>
    <div className="stat-card"><span>WEBSITE</span><strong>{counts.website}</strong><small>Website update, repair and maintenance records.</small></div>
    <div className="stat-card"><span>SECURITY</span><strong>{counts.security}</strong><small>Security-event records requiring IT handling.</small></div>
    <button type="button" className="stat-card" onClick={()=>setTab("work")} style={{textAlign:"left",cursor:"pointer"}}><span>CREATE</span><strong>IT Work Item</strong><small>Log a service request, incident, maintenance activity, security event or change.</small></button>
    <button type="button" className="stat-card" onClick={()=>setTab("website")} style={{textAlign:"left",cursor:"pointer"}}><span>WEBSITE</span><strong>Website Bridge</strong><small>Prepare controlled website updates, repair notices and maintenance communications.</small></button>
  </section>}

  {tab==="work"&&<section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">IT SERVICE MANAGEMENT</span><h2>Create IT Work Item</h2></div></div>
   <form onSubmit={submit} className="form-grid" style={{marginTop:16}}>
    <label className="field"><span>Work Type</span><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{WORK_TYPES.map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="field"><span>Branch</span><select value={form.branch} onChange={e=>{const b=BRANCHES.find(x=>x.name===e.target.value);const next=b?.units?.[0]||form.unit;setBranch(e.target.value);setUnit(next);setForm({...form,branch:e.target.value,unit:next})}}>{BRANCHES.map(x=><option key={x.name}>{x.name}</option>)}</select></label>
    <label className="field"><span>Unit</span><select value={form.unit} onChange={e=>{setUnit(e.target.value);setForm({...form,unit:e.target.value})}}>{(BRANCHES.find(b=>b.name===form.branch)?.units||UNITS.map(x=>x[0])).map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="field"><span>Priority</span><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="field"><span>Status</span><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="field" style={{gridColumn:"1/-1"}}><span>Title</span><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Describe the IT work item"/></label>
    <label className="field" style={{gridColumn:"1/-1"}}><span>Description / Technical Details</span><textarea rows="5" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Record the problem, requested action, technical scope or change details"/></label>
    <label className="field"><span>Scheduled Maintenance</span><input type="datetime-local" value={form.scheduledAt} onChange={e=>setForm({...form,scheduledAt:e.target.value})}/></label>
    <label className="field" style={{display:"flex",alignItems:"center",gap:10}}><input type="checkbox" checked={form.publicNotice} onChange={e=>setForm({...form,publicNotice:e.target.checked})}/><span>Prepare for website communication</span></label>
    <button type="submit" disabled={!canEdit}>Record IT Work Item</button>
   </form>
   <div style={{marginTop:24}}><h3>Recent IT Work</h3>{loading?<p className="muted">Loading…</p>:records.length===0?<p className="muted">No IT work records yet.</p>:<div className="table-wrap"><table><thead><tr><th>Type</th><th>Title</th><th>Branch</th><th>Unit</th><th>Priority</th><th>Status</th></tr></thead><tbody>{records.slice(0,30).map(r=><tr key={r.id}><td><span className={"status-badge "+badge(r.status)}>{r.type}</span></td><td>{r.title}</td><td>{r.branch||"—"}</td><td>{r.unit}</td><td>{r.priority}</td><td>{r.status}</td></tr>)}</tbody></table></div>}</div>
  </section>}

  {tab==="website"&&<section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">IRPA WEBSITE COMMUNICATION BRIDGE</span><h2>Updates, Repairs & Maintenance</h2><p className="muted">The DBGS becomes the controlled source for website maintenance notices and approved public updates. Website administrators can consume the published feed without receiving DBGS administrative privileges.</p></div></div>
   <form onSubmit={publishNotice} className="form-grid" style={{marginTop:16}}>
    <label className="field"><span>Notice Type</span><select value={noticeForm.severity} onChange={e=>setNoticeForm({...noticeForm,severity:e.target.value})}><option>Information</option><option>Maintenance</option><option>Service Interruption</option><option>Security Notice</option></select></label>
    <label className="field"><span>Publication Status</span><select value={noticeForm.status} onChange={e=>setNoticeForm({...noticeForm,status:e.target.value})}><option>Draft</option><option>Published</option><option>Archived</option></select></label>
    <label className="field" style={{gridColumn:"1/-1"}}><span>Website Notice Title</span><input value={noticeForm.title} onChange={e=>setNoticeForm({...noticeForm,title:e.target.value})} placeholder="e.g. Scheduled IRPA website maintenance"/></label>
    <label className="field" style={{gridColumn:"1/-1"}}><span>Public Message</span><textarea rows="5" value={noticeForm.message} onChange={e=>setNoticeForm({...noticeForm,message:e.target.value})} placeholder="Write the approved public communication"/></label>
    <label className="field"><span>Publish From</span><input type="datetime-local" value={noticeForm.publishFrom} onChange={e=>setNoticeForm({...noticeForm,publishFrom:e.target.value})}/></label>
    <label className="field"><span>Publish Until</span><input type="datetime-local" value={noticeForm.publishUntil} onChange={e=>setNoticeForm({...noticeForm,publishUntil:e.target.value})}/></label>
    <button type="submit">Save Website Communication</button>
   </form>
   <div className="auth-message" style={{marginTop:18}}><strong>Website integration boundary</strong><br/>DBGS records the approved communication, publication window and audit identity. A public website connector should consume only records explicitly marked <strong>Published</strong>; it must never expose private IT tickets, credentials, audit details or internal work notes.</div>
  </section>}

  {tab==="governance"&&<section className="dashboard-grid" style={{marginTop:18}}>
   {[
    ["Change Control","Every production change should carry a request, test evidence, approval, deployment record and live verification."],
    ["Cybersecurity","Access changes, incidents and security-sensitive work require traceable ownership and audit evidence."],
    ["Backup & Recovery","Maintain backup schedules, restoration tests, recovery objectives and evidence of successful recovery."],
    ["Website Control","Separate internal repair work from public communication; only explicitly published notices cross the website boundary."],
    ["Release Management","Track version, environment, deployment status, rollback plan and operational verification."],
    ["IT Asset Register","Track devices, software, subscriptions, warranties, ownership and lifecycle state."]
   ].map(([t,d])=><div className="stat-card" key={t}><span>CONTROL</span><strong>{t}</strong><small>{d}</small></div>)}
  </section>}

  <section className="panel" style={{marginTop:18}}>
   <div className="panel-heading"><div><span className="eyebrow">SYSTEM NAVIGATION</span><h2>Related DBGS Platforms</h2></div></div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
    {["Documents","Reports","Audit Trail","Settings"].filter(Boolean).map(x=><button key={x} type="button" className="secondary-button" onClick={()=>onNavigate?.(x)}>{x}</button>)}
   </div>
  </section>
 </div>;
}
