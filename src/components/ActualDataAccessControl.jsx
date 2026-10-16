import React,{useCallback,useEffect,useState}from"react";
import{getActualDataAccessStatus,setActualDataAccess}from"../firebase/systemControl";

const FINAL_TEST_ATTESTATION="I CONFIRM FINAL SYSTEM TESTS PASSED";

export default function ActualDataAccessControl(){
 const[status,setStatus]=useState(null);
 const[confirmation,setConfirmation]=useState("");
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState("");
 const[error,setError]=useState("");
 const refresh=useCallback(async()=>{
  try{const next=await getActualDataAccessStatus();setStatus(next);setError("");}
  catch(e){setError(e?.message||"Unable to verify actual-data access status.");}
 },[]);
 useEffect(()=>{refresh();},[refresh]);
 async function changeAccess(enabled){
  setBusy(true);setMessage("");setError("");
  try{
   if(enabled&&confirmation!==FINAL_TEST_ATTESTATION)throw new Error("Enter the exact attestation after final system tests have passed.");
   if(!enabled&&!window.confirm("Close actual-data entry for all operational users now? Trial workflows remain subject to their existing controls."))return;
   const result=await setActualDataAccess({enabled,...(enabled?{confirmation}: {})});
   setStatus({...result,finalTestsAttested:enabled});
   setConfirmation("");
   setMessage(enabled?"Actual-data entry is OPEN. Members and employees may enter actual operational data under their existing role permissions.":"Actual-data entry is CLOSED. Operational actual-data writes are blocked; registered identity and security configuration remain available.");
   await refresh();
  }catch(e){setError(e?.message||"Unable to change actual-data access.");}
  finally{setBusy(false);}
 }
 return <section className="panel" style={{marginTop:20}}>
  <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR DATA CONTROL</span><h2>Actual-Data Entry Gate</h2><p className="panel-description">Actual operational data entry remains closed until final system testing is complete. Only an authenticated administrator can open or close this gate.</p></div></div>
  <div className="stat-card" style={{marginBottom:16}}>
   <span>Current actual-data entry status</span>
   <strong>{status?.enabled===true?"OPEN":"CLOSED"}</strong>
   <small>{status?.enabled===true?"Actual-data entry is enabled; members and employees remain limited by their existing roles and permissions.":"Closed by default. Trial testing remains separate; identity and security profiles are not reset by this control."}</small>
   {status?.changedAt&&<small>Last changed: {status.changedAt}{status.changedByEmail?" · "+status.changedByEmail:""}</small>}
  </div>
  {status?.enabled!==true&&<div style={{marginBottom:16}}>
   <label className="field" style={{display:"block"}}><span>Final-test attestation</span><input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="I CONFIRM FINAL SYSTEM TESTS PASSED" autoComplete="off" disabled={busy}/></label>
   <p className="table-subtext">Do not open actual-data entry until all required final system tests have passed. The server records this attestation in the audit trail.</p>
   <div className="form-actions"><button type="button" disabled={busy||confirmation!==FINAL_TEST_ATTESTATION} onClick={()=>changeAccess(true)}>{busy?"Updating…":"Open Actual-Data Entry"}</button></div>
  </div>}
  {status?.enabled===true&&<div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>changeAccess(false)}>{busy?"Closing…":"Close Actual-Data Entry"}</button></div>}
  {message&&<div className="success-message" role="status" aria-live="polite" style={{marginTop:14}}>{message}</div>}
  {error&&<div className="error-message" role="alert" style={{marginTop:14}}>{error}</div>}
 </section>
}
