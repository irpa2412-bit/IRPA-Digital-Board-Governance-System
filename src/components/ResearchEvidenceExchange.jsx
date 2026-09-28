import React,{useCallback,useEffect,useMemo,useState}from"react";
import{COLLECTIONS,getRecords}from"../firebase/data";

const RESEARCH_SOURCES=[
  {key:"researchOutputs",label:"Research Outputs",collection:COLLECTIONS.researchOutputs},
  {key:"researchKnowledge",label:"Knowledge Repository",collection:COLLECTIONS.researchKnowledge},
  {key:"researchAnalyses",label:"Statistical Analyses",collection:COLLECTIONS.researchAnalyses},
  {key:"researchStudies",label:"Approved / Published Studies",collection:COLLECTIONS.researchStudies},
  {key:"researchDatasets",label:"Research Datasets",collection:COLLECTIONS.researchDatasets}
];

const INSTITUTIONAL_SOURCES=[
  {key:"meetings",label:"Meetings",collection:COLLECTIONS.meetings},
  {key:"resolutions",label:"Resolutions",collection:COLLECTIONS.resolutions},
  {key:"decisions",label:"Decisions",collection:COLLECTIONS.decisions},
  {key:"actions",label:"Actions",collection:COLLECTIONS.actions},
  {key:"reports",label:"Reports",collection:COLLECTIONS.reports},
  {key:"risks",label:"Risk Register",collection:COLLECTIONS.risks},
  {key:"authorizations",label:"Authorisation & Approvals",collection:COLLECTIONS.authorizationRequests},
  {key:"documents",label:"Controlled Documents",collection:COLLECTIONS.documents},
  {key:"financeReports",label:"Finance Reports",collection:COLLECTIONS.financeReports},
  {key:"financeTransactions",label:"Finance Transactions",collection:COLLECTIONS.financeTransactions},
  {key:"procurementRequests",label:"Procurement Requests",collection:COLLECTIONS.procurementRequests},
  {key:"procurementVendors",label:"Procurement Vendors",collection:COLLECTIONS.procurementVendors},
  {key:"employeePayments",label:"Employee Payments",collection:COLLECTIONS.staffPaymentRequests}
];

const clean=v=>String(v??"").trim();
const statusOf=r=>clean(r?.status||r?.publicationStatus||r?.approvalStatus||r?.workflowStage||r?.consumptionStatus).toLowerCase();
const isConsumable=r=>r?.consumptionReady===true||["approved","published","completed","final","finalised","finalized"].includes(statusOf(r));
const timestamp=r=>r?.updatedAt?.seconds?Number(r.updatedAt.seconds)*1000:r?.createdAt?.seconds?Number(r.createdAt.seconds)*1000:Date.parse(r?.updatedAt||r?.createdAt||r?.generatedAt||r?.date||"")||0;
const titleOf=r=>clean(r?.title||r?.name||r?.subject||r?.reportTitle||r?.reference||r?.documentReference||r?.id)||"Untitled record";
const referenceOf=r=>clean(r?.reference||r?.studyReference||r?.researchReference||r?.documentReference||r?.meetingReference||r?.reportReference||r?.procurementReference||r?.id);
const summaryOf=r=>clean(r?.abstract||r?.description||r?.researchQuestion||r?.methodology||r?.purpose||r?.decision||r?.notes||r?.remarks);

export default function ResearchEvidenceExchange({active,onNavigate}){
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[research,setResearch]=useState({}),[institutional,setInstitutional]=useState({});
 const loadResearch=useCallback(async()=>{
   const results=await Promise.all(RESEARCH_SOURCES.map(async source=>[source.key,await getRecords(source.collection).catch(()=>[])]));
   return Object.fromEntries(results);
 },[]);
 const loadInstitutional=useCallback(async()=>{
   const results=await Promise.all(INSTITUTIONAL_SOURCES.map(async source=>[source.key,await getRecords(source.collection).catch(()=>[])]));
   return Object.fromEntries(results);
 },[]);
 const refresh=useCallback(async()=>{
   setBusy(true);setMessage("");
   try{
     const r=await loadResearch();setResearch(r);
     if(active==="Research, Statistics and Knowledge")setInstitutional(await loadInstitutional());
     setMessage("Institutional evidence exchange refreshed.");
   }catch(e){setMessage(e?.message||"Evidence exchange could not be refreshed.")}
   finally{setBusy(false)}
 },[active,loadResearch,loadInstitutional]);
 useEffect(()=>{if(open)refresh()},[open,refresh]);

 const consumable=useMemo(()=>RESEARCH_SOURCES.flatMap(source=>(research[source.key]||[]).filter(isConsumable).map(record=>({...record,_source:source.label}))).sort((a,b)=>timestamp(b)-timestamp(a)),[research]);
 const institutionalRows=useMemo(()=>INSTITUTIONAL_SOURCES.flatMap(source=>(institutional[source.key]||[]).filter(record=>{if(source.key==="documents"){const classification=clean(record?.classification||"Public").toLowerCase();if(["confidential","restricted"].includes(classification))return false;}return true}).map(record=>({...record,_source:source.label}))).sort((a,b)=>timestamp(b)-timestamp(a)),[institutional]);

 const openResearch=()=>{setOpen(true);if(onNavigate&&active!=="Research, Statistics and Knowledge"){}};
 return <section className="panel research-evidence-exchange" style={{margin:"12px 0",boxShadow:"none",border:"1px solid rgba(31,90,65,.18)"}}>
   <div className="panel-header">
     <div><span className="eyebrow">INSTITUTIONAL EVIDENCE EXCHANGE</span><h2>Research &amp; Institutional Information</h2><p className="panel-description">Approved and published research information is consumable from every IRPA portal. The Research, Statistics and Knowledge Portal can also consume relevant information exposed by the other institutional portals through the authenticated data layer.</p></div>
     <div className="form-actions">
       <button type="button" onClick={openResearch}>{open?"Refresh Exchange":"Open Evidence Exchange"}</button>
       {active!=="Research, Statistics and Knowledge"&&<button type="button" className="secondary-button" onClick={()=>onNavigate?.("Research, Statistics and Knowledge")}>Open Research Portal</button>}
     </div>
   </div>
   {open&&<div style={{display:"grid",gap:16}}>
     <div className="dashboard-grid">
       <div className="stat-card"><span>Consumable Research Items</span><strong>{consumable.length}</strong><small>Approved, published, completed or explicitly consumption-ready</small></div>
       <div className="stat-card"><span>Research Sources</span><strong>{RESEARCH_SOURCES.length}</strong><small>Studies, datasets, analyses, knowledge and outputs</small></div>
       {active==="Research, Statistics and Knowledge"&&<div className="stat-card"><span>Institutional Sources Read</span><strong>{institutionalRows.length}</strong><small>Records available to this authenticated research session</small></div>}
     </div>
     <div className="panel" style={{margin:0,boxShadow:"none"}}>
       <div className="panel-header"><div><span className="eyebrow">READY FOR CONSUMPTION</span><h3>Research Information Available to All Portals</h3></div><button type="button" className="secondary-button" onClick={refresh} disabled={busy}>{busy?"Refreshing…":"Refresh"}</button></div>
       {!consumable.length?<p className="panel-description">No research record is currently marked approved, published, completed or consumption-ready.</p>:<div className="table-wrapper"><table><thead><tr><th>Source</th><th>Information</th><th>Status</th><th>Reference</th></tr></thead><tbody>{consumable.slice(0,50).map(r=><tr key={r._source+"-"+r.id}><td>{r._source}</td><td><strong>{titleOf(r)}</strong><div className="table-subtext">{summaryOf(r).slice(0,220)}</div></td><td><span className="status-badge">{r.consumptionReady===true?"Consumption Ready":(r.status||r.publicationStatus||r.approvalStatus||r.workflowStage||"Ready")}</span></td><td>{referenceOf(r)||"—"}</td></tr>)}</tbody></table></div>}
     </div>
     {active==="Research, Statistics and Knowledge"&&<div className="panel" style={{margin:0,boxShadow:"none"}}>
       <div className="panel-header"><div><span className="eyebrow">RESEARCH INTAKE</span><h3>Relevant Information from Other IRPA Portals</h3><p className="panel-description">This is a federated read view. Each source is requested through the user's existing Firestore authorization; unavailable collections are skipped rather than bypassing portal permissions.</p></div></div>
       {!institutionalRows.length?<p className="panel-description">No accessible institutional records were returned for this research session.</p>:<div className="table-wrapper"><table><thead><tr><th>Portal Source</th><th>Record</th><th>Status</th><th>Reference</th></tr></thead><tbody>{institutionalRows.slice(0,100).map(r=><tr key={r._source+"-"+r.id}><td>{r._source}</td><td><strong>{titleOf(r)}</strong><div className="table-subtext">{summaryOf(r).slice(0,220)}</div></td><td>{r.status||r.workflowStage||r.approvalStatus||"—"}</td><td>{referenceOf(r)||"—"}</td></tr>)}</tbody></table></div>}
     </div>}
     {message&&<div className="action-feedback" role="status" aria-live="polite">{message}</div>}
   </div>}
 </section>
}
