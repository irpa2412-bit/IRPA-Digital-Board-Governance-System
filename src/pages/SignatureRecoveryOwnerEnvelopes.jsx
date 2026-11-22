import React,{useCallback,useEffect,useState}from"react";
import{auth}from"../firebase/config";
import{getSignatureEnvelopes}from"../firebase/signaturePlatform";
import SignatureRecoveryOwnerPanel from"./SignatureRecoveryOwnerPanel";

export default function SignatureRecoveryOwnerEnvelopes(){
  const[rows,setRows]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[isAdmin,setIsAdmin]=useState(false);
  const load=useCallback(async()=>{
    if(!auth.currentUser){setRows([]);setSelected(null);return}
    setBusy(true);setError("");
    try{
      const claims=await auth.currentUser.getIdTokenResult();
      const admin=auth.currentUser.email?.toLowerCase()==="irpa2412@gmail.com"||claims?.claims?.admin===true;
      setIsAdmin(admin);
      const envelopes=await getSignatureEnvelopes();
      const uid=auth.currentUser.uid;
      const owned=envelopes.filter(envelope=>admin||envelope.ownerUid===uid||envelope.createdByUid===uid||envelope.createdBy===uid);
      setRows(owned);
    }catch(err){setError(err?.message||"Unable to load owner envelopes.")}
    finally{setBusy(false)}
  },[]);
  useEffect(()=>{load();const unsubscribe=auth.onAuthStateChanged?.(()=>load());return()=>unsubscribe?.()},[load]);
  return <section className="panel signature-owner-envelopes" aria-labelledby="owner-envelopes-heading" style={{margin:"14px 0",padding:18,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:12}}>
    <div className="panel-heading"><div><span className="eyebrow">OWNER SELF-SERVICE</span><h2 id="owner-envelopes-heading">My Created Envelopes / Bahasha Nilizounda</h2><p className="muted">Check any envelope you created before it reaches Completed. Administrators may assess any envelope. The Gateway enforces access on every request.</p></div><button type="button" className="secondary-button" onClick={load} disabled={busy}>Refresh</button></div>
    {busy&&<p role="status">Loading envelopes… / Inapakia bahasha…</p>}
    {error&&<p role="alert">{error}</p>}
    {!busy&&!error&&rows.length===0&&<p className="muted">No created envelopes are available for this account. / Hakuna bahasha ulizounda zinazopatikana kwenye akaunti hii.</p>}
    <div style={{display:"grid",gap:10}}>
      {rows.map(envelope=>{
        const id=envelope.envelopeId||envelope.id;
        const title=envelope.title||envelope.documentTitle||"Untitled document";
        const status=String(envelope.status||"Unknown");
        return <article key={id} className="stat-card" style={{padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            <div><strong>{title}</strong><div><small>{status}</small></div></div>
            {status!=="Completed"&&<button type="button" className="secondary-button" onClick={()=>setSelected(current=>current?.id===id?null:{id,title,documentId:envelope.documentId})}>Check this document</button>}
          </div>
          {selected?.id===id&&<SignatureRecoveryOwnerPanel envelopeId={id} documentId={selected.documentId} title={selected.title} onClose={()=>setSelected(null)}/>}
        </article>;
      })}
    </div>
    <p className="muted" style={{fontSize:12,marginTop:10}}>Assessment is read-only. No signing, reassignment, retry, repair or completion action is available. / Tathmini haisababishi mabadiliko; hakuna hatua ya kusaini, kubadilisha msaini, kujaribu tena, kurekebisha au kukamilisha.</p>
  </section>;
}
