import React,{useEffect,useState}from"react";
import {addDoc,collection,doc,getDocs,orderBy,query,runTransaction,serverTimestamp,updateDoc}from"firebase/firestore";
import {auth,db}from"../firebase/config";

const empty={name:"",email:"",phone:"",gender:"",dateOfBirth:"",nationality:"Tanzanian",address:"",boardPosition:"Board Member",appointmentDate:"",termStart:"",termEnd:"",status:"Active",biography:""};
const positions=["Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member"];

async function nextBoardMemberNumber(){
 const ref=doc(db,"boardMemberCounters","members");
 return runTransaction(db,async tx=>{const snap=await tx.get(ref);const next=snap.exists()?Number(snap.data().nextNumber||1):1;tx.set(ref,{nextNumber:next+1,updatedAt:serverTimestamp()},{merge:true});return`IRPA-BM-${String(next).padStart(4,"0")}`;});
}

export default function BoardMembers(){
 const[records,setRecords]=useState([]),[form,setForm]=useState(empty),[editing,setEditing]=useState(null),[viewing,setViewing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[search,setSearch]=useState("");
 async function load(){try{const s=await getDocs(query(collection(db,"boardMemberRegistrations"),orderBy("createdAt","desc")));setRecords(s.docs.map(x=>({id:x.id,...x.data()})));}catch(e){setError(e.message||"Unable to load Board Member register.")}}
 useEffect(()=>{load()},[]);
 const change=e=>setForm({...form,[e.target.name]:e.target.value});
 function startEdit(r){setEditing(r);setViewing(null);setMessage("");setError("");setForm({...empty,...Object.fromEntries(Object.keys(empty).map(k=>[k,r[k]??empty[k]]))});window.scrollTo({top:0,behavior:"smooth"})}
 function reset(){setEditing(null);setForm(empty);}
 async function submit(e){e.preventDefault();setBusy(true);setError("");setMessage("");try{if(editing){await updateDoc(doc(db,"boardMemberRegistrations",editing.id),{...form,updatedAt:serverTimestamp(),updatedByUid:auth.currentUser?.uid||null});setMessage(`✓ ${editing.boardMemberNumber} updated successfully.`)}else{const boardMemberNumber=await nextBoardMemberNumber();await addDoc(collection(db,"boardMemberRegistrations"),{...form,boardMemberNumber,registrationStatus:"Registered — Account Pending",uid:null,memberType:"Governance Member",registeredByUid:auth.currentUser?.uid||null,registeredByEmail:auth.currentUser?.email||null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});setMessage(`✓ Board Member ${boardMemberNumber} registered successfully. You may now use Invitations to activate the member's system account.`)}reset();await load()}catch(x){setError(x.message||"Unable to save Board Member registration.")}finally{setBusy(false)}}
 async function deactivate(r){if(!window.confirm(`Deactivate ${r.name||r.boardMemberNumber}?`))return;setBusy(true);try{await updateDoc(doc(db,"boardMemberRegistrations",r.id),{status:"Inactive",updatedAt:serverTimestamp()});await load();setMessage(`✓ ${r.boardMemberNumber} is now inactive.`)}catch(e){setError(e.message||"Unable to deactivate Board Member.")}finally{setBusy(false)}}
 const filtered=records.filter(r=>!search.trim()||[r.boardMemberNumber,r.name,r.email,r.boardPosition,r.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
 return <div className="page">
  <div className="page-header"><div><span className="eyebrow">GOVERNANCE MEMBERSHIP REGISTER</span><h1>Board Members Registration</h1><p>Authoritative pre-account register for IRPA Board Members. Registration is separate from account invitation and activation.</p></div><button onClick={()=>{reset();setError("");setMessage("");window.scrollTo({top:0,behavior:"smooth"})}}>+ Register Board Member</button></div>
  {message&&<div className="success-message action-feedback"role="status">{message}</div>}{error&&<div className="error-message action-feedback"role="alert">{error}</div>}
  <section className="panel"><div className="panel-header"><div><h2>{editing?`Edit ${editing.boardMemberNumber}`:"Register Board Member"}</h2><span>Required institutional record before account activation</span></div></div>
   <form onSubmit={submit}><div className="form-grid">
    <div className="form-field"><label>Full Name</label><input name="name"value={form.name}onChange={change}required/></div>
    <div className="form-field"><label>Official Email</label><input type="email"name="email"value={form.email}onChange={change}required/></div>
    <div className="form-field"><label>Board Position</label><select name="boardPosition"value={form.boardPosition}onChange={change}>{positions.map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="form-field"><label>Phone</label><input name="phone"value={form.phone}onChange={change}/></div>
    <div className="form-field"><label>Gender</label><select name="gender"value={form.gender}onChange={change}><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></div>
    <div className="form-field"><label>Date of Birth</label><input type="date"name="dateOfBirth"value={form.dateOfBirth}onChange={change}/></div>
    <div className="form-field"><label>Nationality</label><input name="nationality"value={form.nationality}onChange={change}/></div>
    <div className="form-field"><label>Address</label><input name="address"value={form.address}onChange={change}/></div>
    <div className="form-field"><label>Appointment Date</label><input type="date"name="appointmentDate"value={form.appointmentDate}onChange={change}required/></div>
    <div className="form-field"><label>Term Start</label><input type="date"name="termStart"value={form.termStart}onChange={change}required/></div>
    <div className="form-field"><label>Term End</label><input type="date"name="termEnd"value={form.termEnd}onChange={change}/></div>
    <div className="form-field"><label>Governance Status</label><select name="status"value={form.status}onChange={change}><option>Active</option><option>Inactive</option><option>Suspended</option><option>Term Ended</option></select></div>
    <div className="form-field form-field-wide"><label>Professional Biography / Board Profile</label><textarea name="biography"value={form.biography}onChange={change}rows="4"placeholder="Qualifications, professional background and relevant Board profile information"/></div>
   </div><div className="form-actions"><button disabled={busy}>{busy?(editing?"Saving...":"Registering..."):(editing?"Save Board Member":"Register Board Member")}</button>{editing&&<button type="button"className="secondary-button"onClick={reset}disabled={busy}>Cancel</button>}</div></form>
  </section>
  <section className="panel"><div className="panel-header"><div><h2>Board Member Register</h2><span>{filtered.length} of {records.length} registered Board Member(s)</span></div><input className="table-search"placeholder="Search Board Members..."value={search}onChange={e=>setSearch(e.target.value)}/></div>
   <div className="table-wrapper"><table><thead><tr><th>Board Member No.</th><th>Name</th><th>Position</th><th>Email</th><th>Term</th><th>Status</th><th>Account</th><th>Actions</th></tr></thead><tbody>{filtered.length===0?<tr><td colSpan="8">No Board Members registered.</td></tr>:filtered.map(r=><tr key={r.id}><td><strong>{r.boardMemberNumber}</strong></td><td>{r.name||"—"}</td><td>{r.boardPosition||"—"}</td><td>{r.email||"—"}</td><td>{r.termStart||"—"}{r.termEnd?` → ${r.termEnd}`:""}</td><td><span className="status-badge">{r.status||"—"}</span></td><td><span className="status-badge">{r.registrationStatus||"Registered"}</span></td><td><div className="member-actions"><button type="button"onClick={()=>setViewing(r)}disabled={busy}>View</button><button type="button"onClick={()=>startEdit(r)}disabled={busy}>Edit</button>{r.status==="Active"&&<button type="button"onClick={()=>deactivate(r)}disabled={busy}>Deactivate</button>}</div></td></tr>)}</tbody></table></div>
  </section>
  {viewing&&<section className="panel"><div className="panel-header"><div><h2>Board Member Profile</h2><span>{viewing.boardMemberNumber}</span></div><button className="secondary-button"onClick={()=>setViewing(null)}>Close</button></div><div className="detail-grid">{[["Board Member Number",viewing.boardMemberNumber],["Full Name",viewing.name],["Official Email",viewing.email],["Board Position",viewing.boardPosition],["Phone",viewing.phone],["Gender",viewing.gender],["Date of Birth",viewing.dateOfBirth],["Nationality",viewing.nationality],["Address",viewing.address],["Appointment Date",viewing.appointmentDate],["Term Start",viewing.termStart],["Term End",viewing.termEnd],["Governance Status",viewing.status],["Registration Status",viewing.registrationStatus],["Account UID",viewing.uid||"Not activated"],["Biography",viewing.biography],["Registered By",viewing.registeredByEmail]].map(([a,b])=><div key={a}><span>{a}</span><strong>{b||"—"}</strong></div>)}</div></section>}
 </div>;
}
