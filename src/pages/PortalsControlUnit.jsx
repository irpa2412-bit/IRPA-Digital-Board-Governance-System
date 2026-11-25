import React,{useEffect,useState} from "react";
import {collection,doc,getDocs,getDoc,setDoc,addDoc,serverTimestamp} from "firebase/firestore";
import {db} from "../firebase/config";
import seed from "../../config/pcu/irpa-organisation.seed.json";
import {validateOrganisation,createDutyDefinition,createDutyAssignment} from "../governance/pcuEngine";
const tenant="irpa",base="pcuTenants/"+tenant;
export default function PortalsControlUnit({user,isAdmin=false}){
 const [org,setOrg]=useState(null),[duties,setDuties]=useState([]),[assignments,setAssignments]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [name,setName]=useState(""),[type,setType]=useState("department"),[parent,setParent]=useState(""),[title,setTitle]=useState(""),[description,setDescription]=useState(""),[cadence,setCadence]=useState("AD_HOC"),[dutyId,setDutyId]=useState(""),[assigneeType,setAssigneeType]=useState("ORG_NODE"),[assigneeId,setAssigneeId]=useState("");
 const audit=(action,entityType,entityId,details)=>addDoc(collection(db,base,"auditEvents"),{tenantId:tenant,actorUid:user.uid,action,entityType,entityId,details:details||{},occurredAt:serverTimestamp(),recordOrigin:"ACTUAL"});
 const load=async()=>{setBusy(true);setError("");try{
  const [t,n,e,d,a]=await Promise.all([getDoc(doc(db,base)),getDocs(collection(db,base,"nodes")),getDocs(collection(db,base,"reportingEdges")),getDocs(collection(db,base,"duties")),getDocs(collection(db,base,"dutyAssignments"))]);
  if(t.exists()){const cfg={...t.data(),nodes:n.docs.map(x=>({id:x.id,...x.data()})),reportingEdges:e.docs.map(x=>({id:x.id,...x.data()}))};validateOrganisation(cfg);setOrg(cfg);}else setOrg(null);
  setDuties(d.docs.map(x=>({id:x.id,...x.data()})));setAssignments(a.docs.map(x=>({id:x.id,...x.data()})));
 }catch(x){setError(x.message||"PCU records could not be loaded.");}finally{setBusy(false);}};
 useEffect(()=>{if(isAdmin&&user?.uid)load();},[isAdmin,user?.uid]);
 const seedOrg=async()=>{setBusy(true);setError("");try{
  const existing=await getDocs(collection(db,base,"nodes"));if(!existing.empty)throw Error("Existing PCU nodes detected; seed will not overwrite them.");
  const {nodes,...config}=seed;await setDoc(doc(db,base),{...config,recordType:"PCU Tenant Configuration",tenantId:tenant,updatedByUid:user.uid,updatedAt:serverTimestamp(),recordOrigin:"ACTUAL"});
  for(const n of nodes)await setDoc(doc(db,base,"nodes",n.id),{...n,createdByUid:user.uid,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"});
  await audit("IRPA_SEED_INITIALIZED","TENANT",tenant,{directorateCount:7});setMessage("Seven-directorate IRPA seed initialized.");await load();
 }catch(x){setError(x.message||"Seed initialization failed.");}finally{setBusy(false);}};
 const addNode=async()=>{setBusy(true);setError("");try{
  const id=crypto.randomUUID(),item={id,tenantId:tenant,typeId:type,name:name.trim(),parentIds:parent?[parent]:[]};validateOrganisation({...org,nodes:[...org.nodes,item]});
  await setDoc(doc(db,base,"nodes",id),{...item,createdByUid:user.uid,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"});await audit("ORG_NODE_CREATED","ORG_NODE",id,{name:item.name,typeId:type,parentIds:item.parentIds});setName("");setParent("");await load();
 }catch(x){setError(x.message||"Node creation failed.");}finally{setBusy(false);}};
 const addDuty=async()=>{setBusy(true);setError("");try{
  const id=crypto.randomUUID(),item=createDutyDefinition({id,tenantId:tenant,title,description,cadence,createdBy:user.uid});await setDoc(doc(db,base,"duties",id),{...item,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"});await audit("DUTY_DEFINED","DUTY",id,{title,cadence});setTitle("");setDescription("");await load();
 }catch(x){setError(x.message||"Duty creation failed.");}finally{setBusy(false);}};
 const assign=async()=>{setBusy(true);setError("");try{
  if(!duties.some(x=>x.id===dutyId))throw Error("Select an existing duty.");
  if(assigneeType==="ORG_NODE"&&!org.nodes.some(x=>x.id===assigneeId))throw Error("Select an existing node.");
  const id=crypto.randomUUID(),item=createDutyAssignment({id,tenantId:tenant,assigneeType,assigneeId,dutyId,createdBy:user.uid,effectiveFrom:new Date().toISOString()});
  await setDoc(doc(db,base,"dutyAssignments",id),{...item,createdAt:serverTimestamp(),recordOrigin:"ACTUAL"});await audit("DUTY_ASSIGNED","DUTY_ASSIGNMENT",id,{dutyId,assigneeType,assigneeId,permissionsActivated:false});setMessage("Duty assigned. No application permissions or authority are granted.");await load();
 }catch(x){setError(x.message||"Duty assignment failed.");}finally{setBusy(false);}};
 if(!isAdmin)return <section className="panel"><h2>Portals Control Unit</h2><p>Administrator authorization required.</p></section>;
 return <main className="panel"><header><p className="role-description-kicker">ADMINISTRATOR PORTAL · GOVERNANCE CONFIGURATION</p><h1>Portals Control Unit (PCU)</h1><p>Tenant-configurable structure, duties and reporting. Assignments never grant Firebase claims, portal permissions, financial authority or signature authority.</p></header>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{busy&&<p role="status">Processing PCU records…</p>}
 {!org?<section><h2>IRPA organisation seed</h2><p>Initial seed: exactly seven directorates; no assumed personnel, vacancies or reporting edges.</p><button disabled={busy} onClick={seedOrg}>Initialize seven-directorate seed</button></section>:<>
 <section><h2>Organisation structure</h2><p>{org.nodes.length} nodes · {org.nodeTypes.length} node types</p><ul>{org.nodes.map(n=><li key={n.id}><strong>{n.name}</strong> — {org.nodeTypes.find(t=>t.id===n.typeId)?.label||n.typeId}</li>)}</ul>
 <h3>Add node</h3><label>Name <input value={name} onChange={e=>setName(e.target.value)} maxLength={180}/></label><label>Type <select value={type} onChange={e=>setType(e.target.value)}>{org.nodeTypes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label><label>Parent <select value={parent} onChange={e=>setParent(e.target.value)}><option value="">None</option>{org.nodes.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label><button disabled={busy||!name.trim()} onClick={addNode}>Add node</button></section>
 <section><h2>Duty catalogue</h2><ul>{duties.map(d=><li key={d.id}>{d.title} · {d.cadence} · v{d.version}</li>)}</ul><label>Title <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={180}/></label><label>Description <textarea value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Cadence <select value={cadence} onChange={e=>setCadence(e.target.value)}>{["AD_HOC","DAILY","WEEKLY","MONTHLY","QUARTERLY","ANNUALLY"].map(x=><option key={x}>{x}</option>)}</select></label><button disabled={busy||!title.trim()} onClick={addDuty}>Create duty</button></section>
 <section><h2>Duty assignments</h2><label>Duty <select value={dutyId} onChange={e=>setDutyId(e.target.value)}><option value="">Select</option>{duties.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></label><label>Assignee type <select value={assigneeType} onChange={e=>setAssigneeType(e.target.value)}><option value="ORG_NODE">Organisation node</option><option value="IDENTITY">Named staff UID</option></select></label><label>Assignee UID or node ID <input value={assigneeId} onChange={e=>setAssigneeId(e.target.value)}/></label><button disabled={busy||!dutyId||!assigneeId.trim()} onClick={assign}>Assign duty</button><ul>{assignments.map(a=><li key={a.id}>{a.dutyId} → {a.assigneeType} {a.assigneeId} · {a.status} · permissions: No</li>)}</ul></section>
 </>}</main>;
}