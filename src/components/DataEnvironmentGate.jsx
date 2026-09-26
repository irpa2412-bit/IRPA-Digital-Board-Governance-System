import React,{useEffect,useState}from"react";

export default function DataEnvironmentGate({target,onContinue}){
 const [choice,setChoice]=useState("");
 const [confirmed,setConfirmed]=useState(false);
 const label=target==="Dashboard"?"Dashboard":String(target||"Portal");
 useEffect(()=>{setChoice("");setConfirmed(false)},[target]);
 function continueGate(){
   if(!choice)return;
   if(choice==="ACTUAL"&&!confirmed)return;
   try{
     window.sessionStorage.setItem("irpaDataEnvironment",choice);
     window.sessionStorage.setItem("irpaDataEnvironmentTarget",label);
     window.sessionStorage.setItem("irpaDataEnvironmentSelectedAt",new Date().toISOString());
   }catch{}
   onContinue?.(choice);
 }
 return <div role="dialog" aria-modal="true" aria-labelledby="data-environment-gate-title" className="auth-screen" style={{position:"fixed",inset:0,zIndex:20000,overflowY:"auto"}}>
   <section className="auth-card" style={{maxWidth:620}}>
     <div className="auth-brand"><div className="brand-kicker">IRPA-DGBS DATA CONTROL</div><h1 id="data-environment-gate-title">Data Environment Gate</h1><p>Before entering <strong>{label}</strong>, identify whether this session will work with trial/test records or actual institutional records.</p></div>
     <div className="auth-divider"><span>GATE ENTRY REQUIRED</span></div>
     <div className="form-grid">
       <button type="button" className={choice==="TRIAL"?"":"secondary-button"} onClick={()=>{setChoice("TRIAL");setConfirmed(false)}} style={{minHeight:110,textAlign:"left"}}><strong>TRIAL DATA</strong><small style={{display:"block",marginTop:7}}>Testing, demonstrations, training and controlled trial records.</small></button>
       <button type="button" className={choice==="ACTUAL"?"":"secondary-button"} onClick={()=>setChoice("ACTUAL")} style={{minHeight:110,textAlign:"left"}}><strong>ACTUAL DATA</strong><small style={{display:"block",marginTop:7}}>Live institutional records. Changes are subject to IRPA governance controls.</small></button>
     </div>
     {choice==="ACTUAL"&&<label className="field" style={{display:"flex",gap:10,alignItems:"flex-start",marginTop:16}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I understand that this gate opens the actual-data environment and that entries, approvals, signatures, financial records and other changes may affect IRPA's live institutional records.</span></label>}
     {choice==="TRIAL"&&<div className="auth-message" style={{marginTop:16}}><strong>TRIAL ENVIRONMENT SELECTED.</strong><br/>Use only designated test/trial records. Do not enter confidential live information into a trial record.</div>}
     {choice==="ACTUAL"&&confirmed&&<div className="auth-message" style={{marginTop:16}}><strong>ACTUAL DATA ENVIRONMENT SELECTED.</strong><br/>The system will continue to apply the user's existing role, authority and server-side controls.</div>}
     <button type="button" disabled={!choice||(choice==="ACTUAL"&&!confirmed)} onClick={continueGate} style={{marginTop:18}}>Enter {choice==="ACTUAL"?"Actual Data":"Trial Data"} Gate</button>
   </section>
 </div>
}
