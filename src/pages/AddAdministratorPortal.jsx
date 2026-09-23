import React,{useEffect,useState}from"react";
import {createAdministrator,listAdministrators,removeAdministrator}from"../firebase/functions";
import {sendAdminMagicLink}from"../firebase/auth";

export default function AddAdministratorPortal(){
 const[name,setName]=useState(""),[email,setEmail]=useState(""),[lastInvitationId,setLastInvitationId]=useState(""),[busy,setBusy]=useState(false),[resendBusy,setResendBusy]=useState(false),[removeBusy,setRemoveBusy]=useState(""),[result,setResult]=useState(null),[lastEmail,setLastEmail]=useState(""),[administrators,setAdministrators]=useState([]),[removalTarget,setRemovalTarget]=useState(null),[removalConfirm,setRemovalConfirm]=useState(""),[refreshBusy,setRefreshBusy]=useState(false),[lastRefresh,setLastRefresh]=useState("");
 const loadAdministrators=async(showFeedback=false)=>{
  if(showFeedback){setRefreshBusy(true);setResult({ok:true,working:true,message:"Refreshing the Administrator register…"});}
  try{
    const rows=await listAdministrators();
    setAdministrators(rows);
    const stamp=new Date().toLocaleTimeString();
    setLastRefresh(stamp);
    if(showFeedback) setResult({ok:true,working:false,message:"Administrator register refreshed successfully at "+stamp+"."});
    return rows;
  }catch(error){
    setResult({ok:false,working:false,message:error?.message||"Unable to load Administrator register."});
    throw error;
  }finally{
    if(showFeedback) setRefreshBusy(false);
  }
};
 useEffect(()=>{loadAdministrators()},[]);

 async function submit(e){
  e.preventDefault();
  const cleanName=name.trim(),cleanEmail=email.trim().toLowerCase();
  if(!cleanName||!cleanEmail){setResult({ok:false,message:"Enter the new administrator's full name and email address."});return;}
  setBusy(true);setResult({ok:true,working:true,message:"Creating the Administrator account securely..."});
  try{
   const data=await createAdministrator({name:cleanName,email:cleanEmail,onProgress:message=>setResult({ok:true,working:true,message})});
   setLastEmail(data?.email||cleanEmail);setLastInvitationId(data?.invitationId||"");
   setResult(data?.emailRequested===false
    ? {ok:true,working:false,message:"Administrator account created for "+(data?.email||cleanEmail)+", but the activation link was not sent. Use “Resend activation link” after correcting the email-delivery/authorized-domain issue. The account was not lost."}
    : {ok:true,working:false,message:"Administrator account created for "+(data?.email||cleanEmail)+". The secure activation link has been sent."});
   setName("");setEmail("");await loadAdministrators();
  }catch(error){setResult({ok:false,working:false,message:error?.message||"Unable to add the Administrator. No success confirmation was received."})}
  finally{setBusy(false)}
 }
 async function resend(){
  const target=lastEmail.trim().toLowerCase();if(!target)return;
  setResendBusy(true);setResult({ok:true,working:true,message:"Resending the secure Administrator activation link..."});
  try{await sendAdminMagicLink(target,lastInvitationId);setResult({ok:true,working:false,message:"A new secure activation link has been sent to "+target+"."})}
  catch(error){setResult({ok:false,working:false,message:error?.message||"The activation link could not be resent."})}
  finally{setResendBusy(false)}
 }
 async function beginRemoval(admin){
  if(admin.primary){setResult({ok:false,message:"The primary IRPA Administrator cannot be removed."});return}
  setRemovalTarget(admin);
  setRemovalConfirm("");
  setResult({ok:true,message:"Removal protocol opened for "+(admin.name||admin.email)+". No access has been removed."});
 }
 async function executeRemoval(){
  const admin=removalTarget;
  if(!admin)return;
  if(admin.primary){setResult({ok:false,message:"The primary IRPA Administrator cannot be removed."});return}
  if(removalConfirm.trim().toUpperCase()!=="REMOVE"){
   setResult({ok:false,message:'Type REMOVE exactly in the confirmation field before the final removal command is enabled.'});
   return;
  }
  setRemoveBusy(admin.uid);setResult({ok:true,working:true,message:"Removal protocol executing for "+admin.email+"..."});
  try{
   await removeAdministrator(admin.uid);
   setResult({ok:true,working:false,message:"Administrator access removed for "+admin.email+"."});
   setRemovalTarget(null);setRemovalConfirm("");
   await loadAdministrators();
  }catch(error){setResult({ok:false,working:false,message:error?.message||"Administrator removal failed. No change was confirmed."})}
  finally{setRemoveBusy("")}
 }
 function cancelRemoval(){
  if(removeBusy)return;
  setRemovalTarget(null);setRemovalConfirm("");
  setResult({ok:true,message:"Administrator removal protocol cancelled. No access was changed."});
 }
 function cancelCommand(){
  if(busy||removeBusy||resendBusy){setResult({ok:false,message:"A command is currently running. Wait for it to finish before cancelling."});return}
  setName("");setEmail("");setLastEmail("");setLastInvitationId("");setResult({ok:true,message:"Administrator command cancelled. No account was created or removed."});
 }
 return <div className="page"><section className="panel">
  <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR GATEWAY</span><h2>Add Administrator</h2><p className="panel-description">Register another IRPA Administrator. Only an authenticated active Administrator can use this portal.</p></div></div>
  <form onSubmit={submit}>
   <label className="field" style={{display:"block"}}><span>New Administrator Name</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" required autoComplete="name"/></label>
   <label className="field" style={{display:"block",marginTop:14}}><span>New Administrator Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="administrator@example.com" required autoComplete="email"/></label>
   <div className="form-actions" style={{marginTop:18,display:"flex",gap:8,flexWrap:"wrap"}}><button type="submit" disabled={busy||resendBusy||!!removeBusy}>{busy?"Adding Administrator…":"Add Administrator"}</button><button type="button" className="secondary-button" onClick={cancelCommand} disabled={busy||resendBusy||!!removeBusy}>Cancel</button></div>
  </form>
  {result&&<div className={result.ok?"success-message":"auth-message"} style={{marginTop:16}} role="status" aria-live="polite" aria-busy={result.working?"true":"false"}>{result.message}</div>}
  {removalTarget&&<section className="panel administrator-removal-protocol" style={{marginTop:16,border:"2px solid #7a3b32",background:"linear-gradient(145deg,#281814,#1b100e)"}} role="alertdialog" aria-labelledby="administrator-removal-title">
   <div className="panel-header"><div><span className="eyebrow">REMOVAL PROTOCOL</span><h3 id="administrator-removal-title" style={{margin:"6px 0"}}>Confirm Administrator Removal</h3><p className="panel-description">This is a two-stage security action. Opening this protocol has NOT removed access.</p></div></div>
   <div style={{padding:"12px",border:"1px solid rgba(214,165,44,.35)",borderRadius:10,marginBottom:12}}>
    <strong>{removalTarget.name||"Administrator"}</strong><div className="muted">{removalTarget.email}</div>
   </div>
   <p className="panel-description">To authorize the final command, type <strong style={{color:"#f0c451"}}>REMOVE</strong> exactly below. Then press the final <strong>Remove Administrator Access</strong> button.</p>
   <input value={removalConfirm} onChange={e=>setRemovalConfirm(e.target.value)} placeholder="Type REMOVE" autoComplete="off" spellCheck={false} aria-label="Type REMOVE to confirm Administrator removal" style={{width:"100%",padding:"12px",marginTop:8,borderRadius:9,border:"1px solid #6d4038",background:"#120c0a",color:"#fff"}} disabled={!!removeBusy}/>
   <div className="form-actions" style={{marginTop:12}}>
    <button type="button" className="danger-button" onClick={executeRemoval} disabled={!!removeBusy||removalConfirm.trim().toUpperCase()!=="REMOVE"}>{removeBusy?"Removing…":"Remove Administrator Access"}</button>
    <button type="button" className="secondary-button" onClick={cancelRemoval} disabled={!!removeBusy}>Cancel Removal</button>
   </div>
  </section>}
  {lastEmail&&<div className="form-actions" style={{marginTop:12}}><button type="button" className="secondary-button" onClick={resend} disabled={busy||resendBusy||!!removeBusy}>{resendBusy?"Resending…":"Resend activation link"}</button></div>}

  <section className="panel" style={{marginTop:24}}>
   <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR REGISTER</span><h3>Active Administrators</h3><p className="panel-description">Remove access here when an Administrator should no longer hold Administrator privileges.</p></div><button type="button" className="secondary-button administrator-register-refresh" onClick={(event)=>{event.preventDefault();event.stopPropagation();if(!refreshBusy) loadAdministrators(true)}} onPointerUp={(event)=>{event.preventDefault();event.stopPropagation();if(!refreshBusy) loadAdministrators(true)}} disabled={refreshBusy} aria-label="Refresh Administrator register" style={{position:"relative",zIndex:9999,pointerEvents:refreshBusy?"none":"auto",touchAction:"manipulation",minHeight:46,cursor:refreshBusy?"wait":"pointer"}}>{refreshBusy?"Refreshing…":"Refresh"}</button></div>
   <div style={{display:"grid",gap:10,pointerEvents:"auto"}}>
    {administrators.length===0?<div className="muted">No active additional Administrators are currently registered.</div>:administrators.map(admin=><div key={admin.uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",padding:"12px",border:"1px solid rgba(127,127,127,.22)",borderRadius:10}}>
      <div><strong>{admin.name||"Administrator"}</strong><div className="muted">{admin.email}</div></div>
      {admin.primary?<span className="muted">Primary Administrator — protected</span>:<button type="button" className="secondary-button" onClick={()=>beginRemoval(admin)} disabled={busy||resendBusy||!!removeBusy||!!removalTarget}>{removeBusy===admin.uid?"Removing…":"Remove Administrator"}</button>}
    </div>)}
   </div>
  </section>
 </section></div>
}