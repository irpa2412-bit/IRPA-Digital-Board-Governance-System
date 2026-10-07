import React,{useEffect,useState}from"react";
import {createRecord,deleteRecord,getRecords,COLLECTIONS,updateRecord}from"../firebase/data";

const AUDITOR_PERMISSIONS=["Read","Download","Print"];
const SPECIAL_PERMISSIONS=["Read","Download","Print","Edit","Upload","Sign","Request","Create","Delete"];
const EMPTY={name:"",email:"",organization:"",title:"",category:"Auditor",assignment:"",permissions:AUDITOR_PERMISSIONS,active:true};

export default function AuditorsSpecialInvitees(){
 const[records,setRecords]=useState([]),[form,setForm]=useState(EMPTY),[editId,setEditId]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 async function load(){try{setRecords(await getRecords(COLLECTIONS.auditorProfiles));setError("")}catch(e){setError(e?.message||"Unable to load the Auditors & Special Invitees Register.")}}
 useEffect(()=>{load()},[]);
 function togglePermission(permission){setForm(f=>({...f,permissions:f.permissions.includes(permission)?f.permissions.filter(x=>x!==permission):[...f.permissions,permission]}))}
 function selectCategory(category){setForm(f=>({...f,category,permissions:category==="Auditor"?AUDITOR_PERMISSIONS:["Read","Download","Print"]}))}
 async function save(e){e.preventDefault();setBusy(true);setError("");setMessage("");try{
   const permissions=form.category==="Auditor"?AUDITOR_PERMISSIONS:[...new Set(form.permissions)];
   if(form.category==="Special Invitee"&&!permissions.length)throw new Error("Assign at least one authority to the Special Invitee.");
   const data={name:form.name.trim(),email:form.email.trim().toLowerCase(),organization:form.organization.trim(),title:form.title.trim(),category:form.category,assignment:form.category==="Special Invitee"?form.assignment.trim():"",permissions,active:true,registrationType:"Auditors & Special Invitees Register"};
   if(editId)await updateRecord(COLLECTIONS.auditorProfiles,editId,data);else await createRecord(COLLECTIONS.auditorProfiles,data);
   setForm(EMPTY);setEditId(null);await load();setMessage(editId?"Register entry updated.":"Register entry created.");
 }catch(e){setError(e?.message||"Unable to save the register entry.")}finally{setBusy(false)}}
 function edit(r){setEditId(r.id);setForm({...EMPTY,...r,permissions:Array.isArray(r.permissions)?r.permissions:[],category:r.category||"Auditor"});setMessage("");setError("");window.scrollTo({top:0,behavior:"smooth"})}
 async function remove(r){if(!window.confirm("Remove this register entry?"))return;setBusy(true);try{await deleteRecord(COLLECTIONS.auditorProfiles,r.id);await load();setMessage("Register entry removed.")}catch(e){setError(e?.message||"Unable to remove the register entry.")}finally{setBusy(false)}}
 return <div className="page"><div className="page-header"><div><h1>Auditors &amp; Special Invitees Register</h1><p>The third invitation register. Every entry uses the same invitation-token activation protocol.</p></div></div>
 {message&&<div className="success-message">{message}</div>}{error&&<div className="error-message">{error}</div>}
 <section className="panel"><h2>{editId?"Edit Register Entry":"Register Auditor or Special Invitee"}</h2><p className="panel-description">Auditors receive system-wide read, download and print authority. Special Invitees receive only the authority individually assigned by the Administrator according to the specific assignment given to the person.</p>
 <form onSubmit={save}><div className="form-grid">
 <div className="form-field"><label>Category</label><select value={form.category}onChange={e=>selectCategory(e.target.value)}><option>Auditor</option><option>Special Invitee</option></select></div>
 <div className="form-field"><label>Full Name</label><input required value={form.name}onChange={e=>setForm({...form,name:e.target.value})}/></div>
 <div className="form-field"><label>Email Address</label><input required type="email"value={form.email}onChange={e=>setForm({...form,email:e.target.value})}/></div>
 <div className="form-field"><label>Organization / Institution</label><input value={form.organization}onChange={e=>setForm({...form,organization:e.target.value})}/></div>
 <div className="form-field"><label>Title / Position</label><input value={form.title}onChange={e=>setForm({...form,title:e.target.value})}/></div>
 {form.category==="Special Invitee"&&<div className="form-field form-field-wide"><label>Specific Assignment</label><input required value={form.assignment}onChange={e=>setForm({...form,assignment:e.target.value})}placeholder="Describe the assignment for which access is being granted"/></div>}
 <div className="form-field form-field-wide"><label>Authority</label><div style={{display:"flex",gap:10,flexWrap:"wrap"}}>{(form.category==="Auditor"?AUDITOR_PERMISSIONS:SPECIAL_PERMISSIONS).map(p=><label key={p}style={{display:"flex",gap:6,alignItems:"center"}}><input type="checkbox"checked={form.permissions.includes(p)}disabled={form.category==="Auditor"}onChange={()=>togglePermission(p)}/>{p}</label>)}</div></div>
 </div><div className="form-actions"><button disabled={busy}type="submit">{busy?"Saving…":editId?"Save Register Entry":"Register Person"}</button>{editId&&<button type="button"className="secondary-button"onClick={()=>{setEditId(null);setForm(EMPTY)}}>Cancel</button>}</div></form></section>
 <section className="panel"><div className="panel-header"><div><h2>Register</h2><span>{records.length} record(s)</span></div></div><div className="table-wrapper"><table><thead><tr><th>Name</th><th>Email</th><th>Category</th><th>Assignment</th><th>Authority</th><th>Active</th><th>Action</th></tr></thead><tbody>{records.length===0?<tr><td colSpan="7">No Auditors or Special Invitees registered.</td></tr>:records.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.email}</td><td>{r.category||"Auditor"}</td><td>{r.assignment||"—"}</td><td>{(Array.isArray(r.permissions)?r.permissions:AUDITOR_PERMISSIONS).join(", ")}</td><td>{r.active===false?"No":"Yes"}</td><td><button type="button"onClick={()=>edit(r)}>Edit</button><button type="button"className="danger-button"onClick={()=>remove(r)}disabled={busy}>Remove</button></td></tr>)}</tbody></table></div></section></div>
}