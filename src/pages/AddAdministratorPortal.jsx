import React,{useEffect,useState}from"react";
import {createAdministrator,listAdministrators,removeAdministrator}from"../firebase/functions";
import {sendAdminMagicLink}from"../firebase/auth";

export default function AddAdministratorPortal(){
 const[name,setName]=useState(""),[email,setEmail]=useState(""),[busy,setBusy]=useState(false),[resendBusy,setResendBusy]=useState(false),[removeBusy,setRemoveBusy]=useState(""),[result,setResult]=useState(null),[lastEmail,setLastEmail]=useState(""),[administrators,setAdministrators]=useState([]);
 const loadAdministrators=async()=>{try{setAdministrators(await listAdministrators())}catch(error){setResult({ok:false,message:error?.message||"Unable to load Administrator register."})}};
 useEffect(()=>{loadAdministrators()},[]);

 async function submit(e){
  e.preventDefault();
  const cleanName=name.trim(),cleanEmail=email.trim().toLowerCase();
  if(!cleanName||!cleanEmail){setResult({ok:false,message:"Enter the new administrator's full name and email address."});return;}
  setBusy(true);setResult({ok:true,working:true,message:"Creating the Administrator account securely..."});
  try{
   const data=await createAdministrator({name:cleanName,email:cleanEmail,onProgress:message=>setResult({ok:true,working:true,message})});
   setLastEmail(data?.email||cleanEmail);
   setResult({ok:true,working:false,message:"Administrator account created for "+(data?.email||cleanEmail)+". The secure activation link has been sent."});
   setName("");setEmail("");await loadAdministrators();
  }catch(error){setResult({ok:false,working:false,message:error?.message||"Unable to add the Administrator. No success confirmation was received."})}
  finally{setBusy(false)}
 }
 async function resend(){
  const target=lastEmail.trim().toLowerCase();if(!target)return;
  setResendBusy(true);setResult({ok:true,working:true,message:"Resending the secure Administrator activation link..."});
  try{await sendAdminMagicLink(target);setResult({ok:true,working:false,message:"A new secure activation link has been sent to "+target+"."})}
  catch(error){setResult({ok:false,working:false,message:error?.message||"The activation link could not be resent."})}
  finally{setResendBusy(false)}
 }
 async function remove(admin){
  if(admin.primary){setResult({ok:false,message:"The primary IRPA Administrator cannot be removed."});return}
  const confirmed=window.confirm("Remove Administrator access for "+(admin.name||admin.email)+"?\n\nThis revokes Administrator access and disables the Administrator authorization profile. The person's Firebase identity is retained.");
  if(!confirmed)return;
  setRemoveBusy(admin.uid);setResult({ok:true,working:true,message:"Removing Administrator access for "+admin.email+"..."});
  try{
   await removeAdministrator(admin.uid);
   setResult({ok:true,working:false,message:"Administrator access removed for "+admin.email+"."});
   await loadAdministrators();
  }catch(error){setResult({ok:false,working:false,message:error?.message||"Administrator removal failed. No change was confirmed."})}
  finally{setRemoveBusy("")}
 }
 function cancelCommand(){
  if(busy||removeBusy||resendBusy){setResult({ok:false,message:"A command is currently running. Wait for it to finish before cancelling."});return}
  setName("");setEmail("");setLastEmail("");setResult({ok:true,message:"Administrator command cancelled. No account was created or removed."});
 }
 return <div className="page"><section className="panel">
  <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR GATEWAY</span><h2>Add Administrator</h2><p className="panel-description">Register another IRPA Administrator. Only an authenticated active Administrator can use this portal.</p></div></div>
  <form onSubmit={submit}>
   <label className="field" style={{display:"block"}}><span>New Administrator Name</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" required autoComplete="name"/></label>
   <label className="field" style={{display:"block",marginTop:14}}><span>New Administrator Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="administrator@example.com" required autoComplete="email"/></label>
   <div className="form-actions" style={{marginTop:18,display:"flex",gap:8,flexWrap:"wrap"}}><button type="submit" disabled={busy||resendBusy||!!removeBusy}>{busy?"Adding Administrator…":"Add Administrator"}</button><button type="button" className="secondary-button" onClick={cancelCommand} disabled={busy||resendBusy||!!removeBusy}>Cancel</button></div>
  </form>
  {result&&<div className={result.ok?"success-message":"auth-message"} style={{marginTop:16}} role="status" aria-live="polite" aria-busy={result.working?"true":"false"}>{result.message}</div>}
  {lastEmail&&<div className="form-actions" style={{marginTop:12}}><button type="button" className="secondary-button" onClick={resend} disabled={busy||resendBusy||!!removeBusy}>{resendBusy?"Resending…":"Resend activation link"}</button></div>}

  <section className="panel" style={{marginTop:24}}>
   <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR REGISTER</span><h3>Active Administrators</h3><p className="panel-description">Remove access here when an Administrator should no longer hold Administrator privileges.</p></div><button type="button" className="secondary-button" onClick={loadAdministrators} disabled={busy||resendBusy||!!removeBusy}>Refresh</button></div>
   <div style={{display:"grid",gap:10}}>
    {administrators.length===0?<div className="muted">No active additional Administrators are currently registered.</div>:administrators.map(admin=><div key={admin.uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",padding:"12px",border:"1px solid rgba(127,127,127,.22)",borderRadius:10}}>
      <div><strong>{admin.name||"Administrator"}</strong><div className="muted">{admin.email}</div></div>
      {admin.primary?<span className="muted">Primary Administrator — protected</span>:<button type="button" className="secondary-button" onClick={()=>remove(admin)} disabled={busy||resendBusy||!!removeBusy}>{removeBusy===admin.uid?"Removing…":"Remove Administrator"}</button>}
    </div>)}
   </div>
  </section>
 </section></div>
}