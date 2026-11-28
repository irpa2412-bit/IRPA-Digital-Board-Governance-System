import React,{useEffect,useState} from "react";
import {collection,doc,getDoc,getDocs,setDoc,addDoc,serverTimestamp} from "firebase/firestore";
import {db} from "../firebase/config";
import model from "../../config/pcu/irpa-operating-model.seed.json";

const tenant="irpa",base="pcuTenants/"+tenant;
const uid=()=>crypto.randomUUID();
const rhythmKeys=["DAILY","WEEKLY","MONTHLY","QUARTERLY","ANNUALLY"];
const blankRhythm=()=>Object.fromEntries(rhythmKeys.map(k=>[k,[]]));
const textValue=v=>String(v??"").trim();

export default function PcuMandateJobDescriptionManager({user,isAdmin=false}){
 const [mandates,setMandates]=useState([]),[descriptions,setDescriptions]=useState([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [entryType,setEntryType]=useState("MANDATE"),[level,setLevel]=useState("UNIT"),[name,setName]=useState(""),[parent,setParent]=useState(""),[mandate,setMandate]=useState(""),[purpose,setPurpose]=useState(""),[duties,setDuties]=useState(""),[reportsTo,setReportsTo]=useState("");
 const load=async()=>{setBusy(true);setError("");try{const [m,j]=await Promise.all([getDocs(collection(db,base,"mandates")),getDocs(collection(db,base,"jobDescriptions"))]);setMandates(m.docs.map(x=>({id:x.id,...x.data()})));setDescriptions(j.docs.map(x=>({id:x.id,...x.data()})));}catch(e){setError(e.message||"Mandate and job-description records could not be loaded.");}finally{setBusy(false);}};
 useEffect(()=>{if(isAdmin&&user?.uid)load();},[isAdmin,user?.uid]);
 const audit=async(action,details)=>addDoc(collection(db,base,"auditEvents"),{tenantId:tenant,actorUid:user.uid,action,entityType:"PCU_OPERATING_MODEL",entityId:tenant,details,occurredAt:serverTimestamp(),recordOrigin:"ACTUAL"});
 const importMissing=async()=>{
  setBusy(true);setError("");setMessage("");
  try{
   let addedMandates=0,existingMandates=0,addedDescriptions=0,existingDescriptions=0;
   for(const item of model.mandates){
    const ref=doc(db,base,"mandates",item.id),snap=await getDoc(ref);
    if(snap.exists()){existingMandates++;continue;}
    await setDoc(ref,{...item,tenantId:tenant,recordType:"MANDATE",permissionsActivated:false,createdByUid:user.uid,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"});addedMandates++;
   }
   for(const item of model.jobDescriptions){
    const ref=doc(db,base,"jobDescriptions",item.id),snap=await getDoc(ref);
    if(snap.exists()){existingDescriptions++;continue;}
    await setDoc(ref,{...item,tenantId:tenant,recordType:"JOB_DESCRIPTION",permissionsActivated:false,createdByUid:user.uid,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"});addedDescriptions++;
   }
   await audit("PCU_OPERATING_MODEL_BASELINE_IMPORTED",{addedMandates,existingMandates,addedDescriptions,existingDescriptions,seedVersion:model.schemaVersion});
   setMessage(`Baseline import complete: ${addedMandates} mandates and ${addedDescriptions} job descriptions added; existing records preserved (${existingMandates} mandates, ${existingDescriptions} job descriptions).`);
   await load();
  }catch(e){setError(e.message||"Baseline import stopped. Existing records were not overwritten.");}
  finally{setBusy(false);}
 };
 const addEntry=async()=>{
  setBusy(true);setError("");setMessage("");
  try{
   const title=textValue(name),id=(entryType==="MANDATE"?"custom-mandate-":"custom-jd-")+uid();
   if(!title)throw Error("Enter a title or position name.");
   let record;
   if(entryType==="MANDATE"){
    if(!textValue(mandate))throw Error("Enter the mandate statement.");
    const operatingRhythm=blankRhythm();
    operatingRhythm.DAILY=["Review assigned priorities, record work completed and escalate urgent issues."];
    operatingRhythm.WEEKLY=["Review progress against the work plan and submit a concise supervisor update."];
    operatingRhythm.MONTHLY=["Report outputs, indicators, resource use and risks."];
    operatingRhythm.QUARTERLY=["Review targets, risks and corrective actions."];
    operatingRhythm.ANNUALLY=["Contribute to annual planning, budgeting and performance review."];
    record={id,tenantId:tenant,recordType:"MANDATE",level,name:title,parentId:textValue(parent)||null,mandate:textValue(mandate),responsibilities:textValue(duties).split("\n").map(textValue).filter(Boolean),operatingRhythm,reportingLine:textValue(reportsTo),version:1,status:"DRAFT",additionalEntriesEnabled:true,permissionsActivated:false,createdByUid:user.uid,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"};
    await setDoc(doc(db,base,"mandates",id),record);
   }else{
    if(!textValue(purpose))throw Error("Enter the job purpose.");
    record={id,tenantId:tenant,recordType:"JOB_DESCRIPTION",positionId:id.replace("custom-jd-",""),title,department:textValue(parent)||"To be assigned",unit:"To be assigned",reportingLine:textValue(reportsTo),purpose:textValue(purpose),keyDuties:textValue(duties).split("\n").map(textValue).filter(Boolean),dailyActions:["Complete assigned tasks and maintain work/evidence logs.","Escalate urgent issues to the reporting supervisor."],weeklyActions:["Review work plan and report progress, blockers and dependencies."],monthlyActions:["Update KPIs and submit monthly activity/output report."],quarterlyActions:["Review targets, risks and corrective actions."],annualActions:["Contribute to annual planning and complete performance/development review."],authorityBoundary:"Draft description only; not an appointment, delegation, permission grant, signature authority or bank mandate.",status:"DRAFT_FOR_EXECUTIVE_DIRECTOR_REVIEW",version:1,additionalEntriesEnabled:true,permissionsActivated:false,createdByUid:user.uid,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"};
    await setDoc(doc(db,base,"jobDescriptions",id),record);
   }
   await audit(entryType==="MANDATE"?"PCU_CUSTOM_MANDATE_CREATED":"PCU_CUSTOM_JOB_DESCRIPTION_CREATED",{recordId:id,title});
   setMessage("Additional "+entryType.toLowerCase().replace("_"," ")+" entry created. It remains a draft pending the approved review and release workflow.");
   setName("");setParent("");setMandate("");setPurpose("");setDuties("");setReportsTo("");await load();
  }catch(e){setError(e.message||"Additional entry could not be saved.");}
  finally{setBusy(false);}
 };
 if(!isAdmin)return null;
 const byLevel=mandates.reduce((out,x)=>(out[x.level]=(out[x.level]||0)+1,out),{});
 return <section className="jdwf-panel" aria-labelledby="pcu-mandates-heading">
  <div className="jdwf-panel-heading"><div><p className="jdwf-eyebrow">IRPA INSTITUTIONAL OPERATING MODEL</p><h2 id="pcu-mandates-heading">Mandates, job descriptions and operating rhythm</h2><p>Versioned directorate, department and unit mandates; position descriptions; daily-to-annual operating cycles. Existing records are never overwritten by baseline import.</p></div><button type="button" disabled={busy} onClick={load}>Refresh</button></div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{busy&&<p role="status">Processing operating-model records…</p>}
  <div className="jdwf-fields">
   <article className="jdwf-message"><strong>{mandates.length}</strong><p>Mandates recorded</p></article>
   <article className="jdwf-message"><strong>{descriptions.length}</strong><p>Job descriptions recorded</p></article>
   <article className="jdwf-message"><strong>{byLevel.DIRECTORATE||0}</strong><p>Directorates</p></article>
   <article className="jdwf-message"><strong>{byLevel.DEPARTMENT||0}</strong><p>Departments</p></article>
   <article className="jdwf-message"><strong>{byLevel.UNIT||0}</strong><p>Units</p></article>
  </div>
  <p><strong>Baseline catalogue:</strong> {model.mandates.length} mandate entries across 13 directorates, 25 departments, 55 units and the Executive Office; {model.jobDescriptions.length} position descriptions. The canonical organisational authority catalogue remains the structure source; the Executive Office remains a central office, not a directorate.</p>
  <button type="button" disabled={busy} onClick={importMissing}>Import missing IRPA baseline records</button>
  <p className="muted">Import is additive and idempotent: records with existing IDs are skipped, never replaced. Job descriptions remain drafts for Executive Director review. No appointments, delegations, portal permissions, Firebase claims, bank authority or signature rights are created.</p>
  <section aria-label="Add organisational entry">
   <h3>Add an additional entry</h3>
   <div className="jdwf-fields">
    <label>Entry type<select value={entryType} onChange={e=>setEntryType(e.target.value)}><option value="MANDATE">Mandate</option><option value="JOB_DESCRIPTION">Job description / position</option></select></label>
    {entryType==="MANDATE"&&<label>Organisational level<select value={level} onChange={e=>setLevel(e.target.value)}>{["DIRECTORATE","DEPARTMENT","UNIT","CENTRAL_OFFICE","SECTION","TEAM"].map(x=><option key={x}>{x}</option>)}</select></label>}
    <label>Title / position name<input value={name} onChange={e=>setName(e.target.value)} maxLength={180}/></label>
    <label>Parent / department<input value={parent} onChange={e=>setParent(e.target.value)} maxLength={180}/></label>
    <label>Reports to<input value={reportsTo} onChange={e=>setReportsTo(e.target.value)} maxLength={180}/></label>
    {entryType==="MANDATE"?<label>Mandate statement<textarea value={mandate} onChange={e=>setMandate(e.target.value)} rows={3}/></label>:<label>Job purpose<textarea value={purpose} onChange={e=>setPurpose(e.target.value)} rows={3}/></label>}
    <label>Responsibilities / key duties (one per line)<textarea value={duties} onChange={e=>setDuties(e.target.value)} rows={4}/></label>
   </div>
   <button type="button" disabled={busy||!textValue(name)||(entryType==="MANDATE"?!textValue(mandate):!textValue(purpose))} onClick={addEntry}>Add draft entry</button>
  </section>
  <section><h3>Mandate register</h3><ul>{mandates.slice(0,30).map(x=><li key={x.id}><strong>{x.name}</strong> · {x.level} · v{x.version||1} · {x.status||"ACTIVE"}</li>)}</ul>{mandates.length>30&&<p>Showing 30 of {mandates.length} records. Use Refresh after changes.</p>}</section>
  <section><h3>Job-description register</h3><ul>{descriptions.slice(0,30).map(x=><li key={x.id}><strong>{x.title}</strong> · {x.directorate||"Additional position"} · v{x.version||1} · {x.status||"DRAFT"}</li>)}</ul>{descriptions.length>30&&<p>Showing 30 of {descriptions.length} records.</p>}</section>
 </section>;
}
