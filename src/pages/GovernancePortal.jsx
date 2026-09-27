import React,{useEffect,useState}from"react";
import{createRecord,getRecords,COLLECTIONS}from"../firebase/data";
const BOARD_ROLES=["Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member"];
const box={background:"rgba(255,255,255,.045)",border:"1px solid rgba(255,255,255,.12)",borderRadius:16,padding:18};
const fmt=v=>v?.seconds?new Date(v.seconds*1000).toLocaleString("en-GB"):String(v||"—");
export default function GovernancePortal({profile,employee,selectedAuthority,onNavigate,admin=false}){
 const role=String(selectedAuthority||profile?.role||"").trim(),ok=admin||BOARD_ROLES.includes(role);
 const[rows,setRows]=useState({meetings:[],reports:[],risks:[],actions:[],resolutions:[],documents:[],assessments:[]}),[loading,setLoading]=useState(true),[msg,setMsg]=useState("");
 const[form,setForm]=useState({area:"Strategic Plan",type:"Observation",title:"",evidence:"",recommendation:"",priority:"Medium"});
 useEffect(()=>{let live=true;(async()=>{const keys=[COLLECTIONS.meetings,COLLECTIONS.reports,COLLECTIONS.risks,COLLECTIONS.actions,COLLECTIONS.resolutions,COLLECTIONS.documents,"governanceAssessments"];const r=await Promise.all(keys.map(k=>getRecords(k).catch(()=>[])));if(live){setRows({meetings:r[0],reports:r[1],risks:r[2],actions:r[3],resolutions:r[4],documents:r[5],assessments:r[6]});setLoading(false)}})();return()=>{live=false}},[]);
 if(!ok)return <div className="page"><section className="panel"><h1>Governance Portal</h1><p>Access is restricted to authorized Board governance capacities.</p></section></div>;
 const openActions=rows.actions.filter(x=>!["Completed","Cancelled","Implemented","Closed"].includes(String(x.status||""))).length;
 const openRisks=rows.risks.filter(x=>!["Closed","Mitigated"].includes(String(x.status||""))).length;
 async function submit(e){e.preventDefault();try{await createRecord("governanceAssessments",{...form,title:form.title.trim(),evidence:form.evidence.trim(),recommendation:form.recommendation.trim(),submittedByUid:profile?.uid||employee?.uid||null,submittedByRole:role,status:"Submitted",recordOrigin:"PRODUCTION"});setRows(r=>({...r,assessments:[...r.assessments,{...form,submittedByRole:role,status:"Submitted"}]}));setForm({area:"Strategic Plan",type:"Observation",title:"",evidence:"",recommendation:"",priority:"Medium"});setMsg("Assessment submitted and audit-recorded.");}catch(x){setMsg(x.message||"Assessment could not be submitted.");}}
 return <div className="page" style={{maxWidth:1500,margin:"0 auto"}}>
  <section className="welcome-panel"><div><span className="eyebrow">BOARD GOVERNANCE WORKSPACE</span><h1>Governance Portal</h1><p>Oversight, evidence review, real-time assessment, decisions and follow-up.</p></div><div className="identity-card"><span>ACTIVE AUTHORITY</span><strong>{admin?"Administrator":role}</strong></div></section>
  <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginTop:14}}>{[["Meetings",rows.meetings.length],["Open Actions",openActions],["Open Risks",openRisks],["Reports",rows.reports.length],["Assessments",rows.assessments.length]].map(x=><div key={x[0]} style={box}><strong style={{fontSize:24,display:"block"}}>{loading?"—":x[1]}</strong><small>{x[0]}</small></div>)}</section>
  <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14,marginTop:14}}>
   <section style={box}><b>BOARD WORKSPACE</b><div style={{display:"grid",gap:8,marginTop:12}}>{["Meetings","Documents","Voting","Resolutions","Reports","Risk Register","Actions"].map(t=><button key={t} className="secondary-button" onClick={()=>onNavigate?.(t)}>{t} ›</button>)}</div></section>
   <section style={box}><b>RECENT GOVERNANCE REPORTS</b><div style={{marginTop:12,display:"grid",gap:8}}>{rows.reports.slice(-6).reverse().map((x,i)=><div key={x.id||i}><strong>{x.title||x.reportTitle||"Report"}</strong><small style={{display:"block",opacity:.65}}>{x.status||"Recorded"} · {fmt(x.updatedAt||x.createdAt)}</small></div>)}{!rows.reports.length&&<p className="muted">No reports available.</p>}</div></section>
  </section>
  <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",gap:14,marginTop:14}}>
   <section style={box}><b>REAL-TIME BOARD ASSESSMENT</b><form onSubmit={submit} style={{display:"grid",gap:10,marginTop:12}}>
    <select value={form.area} onChange={e=>setForm(f=>({...f,area:e.target.value}))}><option>Strategic Plan</option><option>Financial Oversight</option><option>Programme Performance</option><option>Governance & Compliance</option><option>Risk</option><option>Community Impact</option><option>Organizational Capacity</option></select>
    <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}><option>Observation</option><option>Concern</option><option>Recommendation</option><option>Positive Evidence</option></select>
    <input required placeholder="Assessment title" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
    <textarea required rows="4" placeholder="Evidence / observation" value={form.evidence} onChange={e=>setForm(f=>({...f,evidence:e.target.value}))}/>
    <textarea rows="3" placeholder="Recommendation / follow-up" value={form.recommendation} onChange={e=>setForm(f=>({...f,recommendation:e.target.value}))}/>
    <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select>
    <button type="submit">Submit Board Assessment</button>{msg&&<div className="auth-message">{msg}</div>}</form></section>
   <section style={box}><b>RECENT ASSESSMENTS</b><div style={{display:"grid",gap:9,marginTop:12,maxHeight:420,overflowY:"auto"}}>{rows.assessments.slice(-10).reverse().map((x,i)=><article key={x.id||i} style={{padding:10,border:"1px solid rgba(255,255,255,.08)",borderRadius:10}}><strong>{x.title||"Assessment"}</strong><small style={{display:"block",opacity:.65}}>{x.area} · {x.type} · {x.priority}</small><p style={{fontSize:13}}>{x.evidence}</p></article>)}{!rows.assessments.length&&<p className="muted">No Board assessments entered yet.</p>}</div></section>
  </section>
 </div>;
}