import React,{useState}from"react";
import {createAdministrator}from"../firebase/functions";

export default function AddAdministratorPortal(){
 const[name,setName]=useState(""),[email,setEmail]=useState(""),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
 async function submit(e){
  e.preventDefault(); const cleanName=name.trim(),cleanEmail=email.trim().toLowerCase();
  if(!cleanName||!cleanEmail){setResult({ok:false,message:"Enter the new administrator's full name and email address."});return;}
  setBusy(true);setResult({ok:true,working:true,message:"Creating the Administrator account securely..."});
  try{
   const data=await createAdministrator({name:cleanName,email:cleanEmail,onProgress:message=>setResult({ok:true,working:true,message})});
   setResult({ok:true,working:false,message:"Administrator invitation created for "+(data?.email||cleanEmail)+". The secure activation link has been sent."});
   setName("");setEmail("");
  }catch(error){setResult({ok:false,working:false,message:error?.message||"Unable to add the Administrator. No confirmation was received."})}
  finally{setBusy(false)}
 }
 return <div className="page"><section className="panel">
  <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR GATEWAY</span><h2>Add Administrator</h2><p className="panel-description">Register another IRPA Administrator. Only an authenticated active Administrator can use this portal.</p></div></div>
  <div className="stat-card" style={{marginBottom:18}}><span>Administrator authorization</span><strong>Active Administrator Required</strong><small>The authenticated account must be present in the IRPA Administrator Registry and marked active.</small></div>
  <form onSubmit={submit}>
   <label className="field" style={{display:"block"}}><span>New Administrator Name</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" required autoComplete="name"/></label>
   <label className="field" style={{display:"block",marginTop:14}}><span>New Administrator Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="administrator@example.com" required autoComplete="email"/></label>
   <div className="form-actions" style={{marginTop:18}}><button type="submit" disabled={busy}>{busy?"Adding Administrator…":"Add Administrator"}</button></div>
  </form>
  {result&&<div className={result.ok?"success-message":"auth-message"} style={{marginTop:16}} role="status" aria-live="polite" aria-busy={result.working?"true":"false"}>{result.message}</div>}
 </section></div>
}
