import React,{useEffect,useState}from"react";
import {createMemberRegistration,getRecords,updateRecord,deleteRecord,COLLECTIONS}from"../firebase/data";

const empty={name:"",email:"",phone:"",gender:"",nationality:"Tanzanian",address:"",memberType:"Governance Member",status:"Active",biography:""};
const types=["Governance Member","General Member","Institutional Member","Youth Member","Women Member"];

export default function Members(){
 const[records,setRecords]=useState([]),[form,setForm]=useState(empty),[editing,setEditing]=useState(null),[viewing,setViewing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[search,setSearch]=useState("");
 async function load(){try{const all=await getRecords(COLLECTIONS.members);setRecords(all.filter(x=>!x.boardMember&&x.role!=="Board Member"&&!x.boardPosition))}catch(e){setError(e.message||"Unable to load Member register.")}}
 useEffect(()=>{load()},[]);
 const change=e=>setForm({...form,[e.target.name]:e.target.value});
 function reset(){setEditing(null);setForm(empty)}
 function edit(r){setEditing(r);setViewing(null);setForm({...empty,...r})}
 async function submit(e){e.preventDefault();setBusy(true);setError("");setMessage("");try{if(editing){await updateRecord(COLLECTIONS.members,editing.id,{...form,role:"Member",boardMember:false,registrationStatus:"Registered"});setMessage(`✓ ${editing.memberNumber} Member record updated successfully.`)}else{const result=await createMemberRegistration({...form,role:"Member",boardMember:false,registrationStatus:"Registered"});setMessage(`✓ Member ${result.memberNumber} registered successfully.`)}reset();await load()}catch(x){setError(x.message||"Unable to save Member registration.")}finally{setBusy(false)}}
 async function remove(r){if(!window.confirm(`Permanently delete ${r.memberNumber} — ${r.name}? This cannot be undone.`))return;setBusy(true);try{await deleteRecord(COLLECTIONS.members,r.id);await load();setMessage(`✓ ${r.memberNumber} was deleted.`)}catch(e){setError(e.message||"Unable to delete Member.")}finally{setBusy(false)}}
 const filtered=records.filter(r=>!search.trim()||[r.memberNumber,r.name,r.email,r.memberType,r.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
 return <div className="page">
  <div className="page-header"><div><span className="eyebrow">MEMBERSHIP REGISTER</span><h1>Members Registration</h1><p>Independent IRPA Member register. Members receive IRPA-MEM registration numbers. Board Members are registered separately in the Board Members platform.</p></div><button onClick={()=>{reset();setError("");setMessage("")}}>+ Register Member</button></div>
  {message&&<div className="success-message action-feedback"role="status">{message}</div>}{error&&<div className="error-message action-feedback"role="alert">{error}</div>}
  <section className="panel"><div className="panel-header"><div><h2>{editing?`Edit ${editing.memberNumber}`:"Register Member"}</h2><span>Independent Member registration platform</span></div></div>
   <form onSubmit={submit}><div className="form-grid">
    {editing&&<div className="form-field"><label>Member Number</label><input value={form.memberNumber} readOnly/></div>}
    <div className="form-field"><label>Full Name</label><input name="name"value={form.name}onChange={change}required/></div>
    <div className="form-field"><label>Official Email</label><input type="email"name="email"value={form.email}onChange={change}required/></div>
    <div className="form-field"><label>Phone</label><input name="phone"value={form.phone}onChange={change}/></div>
    <div className="form-field"><label>Member Type</label><select name="memberType"value={form.memberType}onChange={change}>{types.map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="form-field"><label>Gender</label><select name="gender"value={form.gender}onChange={change}><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></div>
    <div className="form-field"><label>Nationality</label><input name="nationality"value={form.nationality}onChange={change}/></div>
    <div className="form-field"><label>Address</label><input name="address"value={form.address}onChange={change}/></div>
    <div className="form-field"><label>Status</label><select name="status"value={form.status}onChange={change}><option>Active</option><option>Inactive</option><option>Suspended</option></select></div>
    <div className="form-field form-field-wide"><label>Member Profile / Biography</label><textarea name="biography"value={form.biography}onChange={change}rows="4"/></div>
   </div><div className="form-actions"><button disabled={busy}>{busy?(editing?"Saving...":"Registering..."):(editing?"Save Changes":"Register Member")}</button>{editing&&<button type="button"className="secondary-button"onClick={reset}disabled={busy}>Cancel</button>}</div></form>
  </section>
  <section className="panel"><div className="panel-header"><div><h2>Official Member Register</h2><span>{filtered.length} of {records.length} registered Member(s)</span></div><input className="table-search"placeholder="Search Members..."value={search}onChange={e=>setSearch(e.target.value)}/></div>
   <div className="table-wrapper"><table><thead><tr><th>Member Number</th><th>Name</th><th>Member Type</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.length===0?<tr><td colSpan="6">No Members registered.</td></tr>:filtered.map(r=><tr key={r.id}><td><strong>{r.memberNumber}</strong></td><td>{r.name||"—"}</td><td>{r.memberType||"—"}</td><td>{r.email||"—"}</td><td><span className="status-badge">{r.status||"—"}</span></td><td><div className="member-actions"><button type="button"onClick={()=>setViewing(r)}>View</button><button type="button"onClick={()=>edit(r)}>Edit</button><button type="button"className="danger-button"onClick={()=>remove(r)}>Delete</button></div></td></tr>)}</tbody></table></div>
  </section>
  {viewing&&<section className="panel"><div className="panel-header"><div><h2>Member Profile</h2><span>{viewing.memberNumber}</span></div><button className="secondary-button"onClick={()=>setViewing(null)}>Close</button></div><div className="detail-grid">{[["Member Number",viewing.memberNumber],["Full Name",viewing.name],["Official Email",viewing.email],["Member Type",viewing.memberType],["Phone",viewing.phone],["Gender",viewing.gender],["Nationality",viewing.nationality],["Address",viewing.address],["Status",viewing.status],["Registration Status",viewing.registrationStatus],["Biography",viewing.biography]].map(([a,b])=><div key={a}><span>{a}</span><strong>{b||"—"}</strong></div>)}</div></section>}
 </div>;
}