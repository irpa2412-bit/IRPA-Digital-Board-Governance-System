import React,{useEffect,useState}from"react";
import{getIdToken}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";

async function assess(envelopeId){
  if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account. (AUTH_REQUIRED)");
  const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
  if(!gateway)throw new Error("The recovery service is not configured. (RECOVERY_SERVICE_URL_MISSING)");
  const token=await getIdToken(auth.currentUser);
  const response=await fetch(gateway+"/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/evidence",{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body?.ok!==true)throw new Error(body?.error||"Evidence assessment failed (HTTP "+response.status+").");
  return body;
}
function reportText(item,evidence){
  const lines=["IRPA SIGNATURE RECOVERY ASSESSMENT","Document: "+(item.title||evidence.title||"Untitled document"),"Reference: "+(item.documentId||"Not recorded"),"Envelope ID: "+item.envelopeId,"Status: "+(evidence.status||item.status||"Unknown"),"Audit chain: "+(evidence.auditChain?.status||"NOT_RETRIEVED")+" ("+(evidence.auditChain?.code||"AUDIT_CHAIN_NOT_RETRIEVED")+")","Source hash: "+(evidence.sourceHashStatus||"NOT_RETRIEVED")+" ("+(evidence.sourceHashCode||"SOURCE_HASH_NOT_RETRIEVED")+")","Source hash finding: "+(evidence.sourceHashReason||"Not recorded"),"Finalisation stage: "+(evidence.finalisationStage||"NOT_RECORDED")+" ("+(evidence.finalisationStageCode||"FINALISATION_STAGE_NOT_RECORDED")+")","Signature stamps:"];
  for(const row of evidence.stampSlots||[])lines.push("- Page "+(row.page||"unknown")+", field "+(row.fieldId||"unknown")+": "+(row.resultStatus||row.status||"UNVERIFIABLE")+" ("+(row.code||"NOT_CODED")+") — "+(row.reason||"No reason recorded."));
  if(!(evidence.stampSlots||[]).length)lines.push("- No signature or initials fields were returned.");
  lines.push("This is a read-only assessment. No envelope, signer, field, signature, hash, certificate, archive or source file was modified.");
  return lines.join("\n");
}
export default function SignatureRecoveryOwnerPanel({envelopeId,item}){
  const[evidence,setEvidence]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[copied,setCopied]=useState(false);
  useEffect(()=>{let active=true;setLoading(true);setEvidence(null);setError("");assess(envelopeId).then(value=>{if(active)setEvidence(value)}).catch(err=>{if(active)setError(err?.message||"Unable to assess this document.")}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[envelopeId]);
  const report=evidence?reportText(item,evidence):"";
  async function copyReport(){try{await navigator.clipboard.writeText(report);setCopied(true)}catch{setError("Copy is unavailable. Select and copy the report text manually.")}}
  return <section className="panel signature-recovery-owner-panel" aria-label="Read-only signature recovery evidence" style={{marginTop:14,padding:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:10}}>
    <h3>Evidence assessment / Tathmini ya ushahidi</h3>
    {loading&&<p role="status">Checking evidence… / Inakagua ushahidi…</p>}
    {error&&<p role="alert">{error}</p>}
    {evidence&&<><p><strong>Audit chain:</strong> {evidence.auditChain?.status||"NOT_RETRIEVED"} ({evidence.auditChain?.code||"NOT_RETRIEVED"})</p><p><strong>Source hash:</strong> {evidence.sourceHashStatus||"NOT_RETRIEVED"} ({evidence.sourceHashCode||"NOT_RETRIEVED"}) — {evidence.sourceHashReason||"Not recorded"}</p><p><strong>Finalisation stage:</strong> {evidence.finalisationStage||"NOT_RECORDED"} ({evidence.finalisationStageCode||"NOT_RECORDED"})</p>
      <h4>Signature stamps / Mihuri ya saini</h4>
      {(evidence.stampSlots||[]).length===0?<p>No signature or initials fields were returned.</p>:<div style={{display:"grid",gap:8}}>{evidence.stampSlots.map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}><strong>{row.resultStatus||row.status||"UNVERIFIABLE"}</strong> — Page {row.page||"unknown"}, field {row.fieldId||"unknown"}<div style={{fontSize:13}}>{row.reason} ({row.code})</div></div>)}</div>}
      <h4>Full report / Ripoti kamili</h4><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontFamily:"inherit",fontSize:13,padding:12,borderRadius:8,background:"var(--surface-muted,#f1f5f9)"}}>{report}</pre><button type="button" onClick={copyReport}>{copied?"Copied / Imenakiliwa":"Copy report / Nakili ripoti"}</button></>}
    <p style={{fontSize:12,marginTop:10}}>Read-only assessment. No retry, reassignment, repair or completion action is available. / Tathmini ya kusoma pekee; hakuna kujaribu tena, kubadilisha msaini, kurekebisha au kukamilisha.</p>
  </section>;
}
