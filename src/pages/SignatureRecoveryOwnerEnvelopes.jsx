import React,{useCallback,useEffect,useState}from"react";
import{getIdToken,onAuthStateChanged}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";
import SignatureRecoveryOwnerPanel from"./SignatureRecoveryOwnerPanel";
import{formatRecoveryRouteError}from"../utils/recoveryRouteError.mjs";
async function loadRecoveryPage(offset,button="Load recovery queue"){
 if(!auth.currentUser)throw new Error("Sign in to view your recovery assessment queue. (AUTH_REQUIRED)");
 const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
 if(!gateway)throw new Error("The recovery service is not configured. (RECOVERY_SERVICE_URL_MISSING)");
 const token=await getIdToken(auth.currentUser);
 const response=await fetch(gateway+"/api/recovery/envelopes?limit=50&offset="+offset,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store"});
 const body=await response.json().catch(()=>({}));
 if(!response.ok||body?.ok!==true)throw new Error(formatRecoveryRouteError({status:response.status,body,button,route:"/api/recovery/envelopes"}));
 return body;
}
export default function SignatureRecoveryOwnerEnvelopes(){
 const[rows,setRows]=useState([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const load=useCallback(async(reset=true)=>{
  if(!auth.currentUser){setRows([]);setTotal(0);setSelected(null);return}
  setBusy(true);setError("");
  try{const nextOffset=reset?0:offset;const page=await loadRecoveryPage(nextOffset,reset?"Refresh recovery queue":"Load more recovery queue");const items=Array.isArray(page.items)?page.items:[];setRows(current=>reset?items:[...current,...items]);setTotal(Number(page.total)||0);setOffset(nextOffset+items.length);if(reset)setSelected(null)}
  catch(err){setError(err?.message||"Unable to load recovery assessments.")}
  finally{setBusy(false)}
 },[offset]);
 useEffect(()=>{const unsubscribe=onAuthStateChanged(auth,()=>{void load(true)});return()=>unsubscribe()},[]);
 return <section className="panel signature-owner-envelopes" aria-labelledby="owner-envelopes-heading" style={{margin:"14px 0",padding:18,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:12}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><span className="eyebrow">RESTRICTED · OWNER / ADMIN RECOVERY</span><h2 id="owner-envelopes-heading">Signature Recovery Assessment / Tathmini ya Urejeshaji wa Saini</h2><p className="muted">Every non-completed envelope you own is listed here. Administrators can assess across owners. The Gateway verifies access for every request.</p></div><button type="button" className="secondary-button" onClick={()=>load(true)} disabled={busy}>Refresh</button></div>
  {busy&&<p role="status">Loading authorised envelopes… / Inapakia bahasha zilizoidhinishwa…</p>}{error&&<p role="alert">{error}</p>}
  {!busy&&!error&&rows.length===0&&<p className="muted">No non-completed envelopes are available for this account. / Hakuna bahasha ambazo hazijakamilika zinazopatikana kwa akaunti hii.</p>}
  <div style={{display:"grid",gap:10}}>{rows.map(item=><article key={item.envelopeId} className="stat-card" style={{padding:12}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><strong>{item.title||"Untitled document"}</strong><div style={{fontSize:12}}>Reference: {item.documentId||"Not recorded"} · Status: {item.status}</div><div style={{fontSize:12}}>Recorded stage: {item.stage||"NOT_RECORDED"}</div></div><button type="button" className="secondary-button" onClick={()=>setSelected(current=>current?.envelopeId===item.envelopeId?null:item)}>Check this document</button></div>
   {selected?.envelopeId===item.envelopeId&&<SignatureRecoveryOwnerPanel key={item.envelopeId} envelopeId={item.envelopeId} item={item}/>}
  </article>)}</div>
  {!busy&&offset<total&&<button type="button" className="secondary-button" onClick={()=>load(false)} disabled={busy}>Load more ({rows.length} of {total})</button>}
  <p className="muted" style={{fontSize:12,marginTop:10}}>Assessment is read-only. It does not retry signing, reassign signers, repair, finalise or modify the original document or its evidence. / Tathmini haisaini tena, haibadilishi wasaini, hairekebishi, haikamilishi wala kubadilisha hati au ushahidi wake.</p>
 </section>;
}
