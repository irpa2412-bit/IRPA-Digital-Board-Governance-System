import React,{useEffect,useMemo,useState}from"react";
import{getIdToken}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";

const TARGET_DOCUMENT_ID="IRPA-ENV-2026-11501354";
const TARGET_TITLE="Muhtasari wa Kikao cha Familia";
async function recoveryRequest(path,{pdf=false}={}){
  if(!auth.currentUser)throw new Error("Sign in with the authorised IRPA owner account to access recovery.");
  const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
  if(!gateway)throw new Error("The IRPA Gateway URL is not configured in this environment.");
  const token=await getIdToken(auth.currentUser);
  const response=await fetch(gateway+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:pdf?"application/pdf":"application/json"},cache:"no-store"});
  if(!response.ok){
    const result=pdf?{}:await response.json().catch(()=>({}));
    const error=new Error(result.error||("Recovery request failed (HTTP "+response.status+")."));
    error.status=response.status;throw error;
  }
  return pdf?response.blob():response.json();
}
function statusLabel(value){return({VERIFIED_EXISTING:"Verified existing stamp",MISSING:"Missing",INVALID:"Invalid",UNVERIFIABLE:"Unverifiable"})[value]||String(value||"Not assessed");}
export default function SignatureRecoveryOwnerPanel(){
  const[queue,setQueue]=useState([]),[selected,setSelected]=useState(null),[evidence,setEvidence]=useState(null),[previewUrl,setPreviewUrl]=useState(""),[loading,setLoading]=useState(false),[previewLoading,setPreviewLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const target=useMemo(()=>queue.find(item=>item.documentId===TARGET_DOCUMENT_ID)||null,[queue]);
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
  async function loadAssessment(){
    setLoading(true);setError("");setNotice("");setEvidence(null);setSelected(null);
    if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl("")}
    try{
      const result=await recoveryRequest("/api/recovery/envelopes?limit=50&offset=0");
      const items=Array.isArray(result.items)?result.items:[];
      setQueue(items);
      const match=items.find(item=>item.documentId===TARGET_DOCUMENT_ID);
      if(!match){setNotice("The target document is not present in the authenticated owner's failed-completion queue. No document changes were made.");return}
      setSelected(match);
      const assessed=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(match.envelopeId)+"/evidence");
      setEvidence(assessed);
      setNotice("Read-only signature assessment retrieved. Existing signer records and signature values were not changed. Access was recorded in the recovery audit chain.");
    }catch(err){setError(err?.message||"Unable to retrieve the recovery assessment.");}
    finally{setLoading(false)}
  }
  async function loadPreview(){
    if(!selected)return;setPreviewLoading(true);setError("");
    try{
      const blob=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(selected.envelopeId)+"/preview.pdf",{pdf:true});
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    }catch(err){setError(err?.message||"Unable to generate the watermarked preview.");}
    finally{setPreviewLoading(false)}
  }
  return <section className="panel signature-recovery-owner-panel" aria-labelledby="signature-recovery-heading" style={{margin:"20px 0",padding:18,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:12}}>
    <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
      <div><p style={{margin:"0 0 5px",fontSize:12,fontWeight:700,letterSpacing:".08em"}}>RESTRICTED · OWNER RECOVERY</p><h2 id="signature-recovery-heading" style={{margin:"0 0 6px"}}>Signature Recovery Assessment</h2><p style={{margin:0}}>Inspect failed-completion evidence without changing existing signatures.</p></div>
      <button type="button" onClick={loadAssessment} disabled={loading}>{loading?"Assessing…":"Assess affected document"}</button>
    </div>
    <div style={{marginTop:14,padding:12,borderRadius:8,background:"var(--surface-muted,#f1f5f9)"}}>
      <strong>{TARGET_TITLE}</strong><div style={{fontSize:13,overflowWrap:"anywhere"}}>Document ID: {TARGET_DOCUMENT_ID}</div>
      <div style={{fontSize:12,marginTop:5}}>Assessment is read-only with respect to signatures. No reassignment, retry, completion or signature overwrite is available on this screen.</div>
    </div>
    {loading&&<p role="status">Checking owner access, failed-envelope queue, source-document hash, audit chain and individual stamp evidence…</p>}
    {error&&<p role="alert" style={{color:"var(--danger,#b91c1c)"}}>{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    {selected&&evidence&&<div style={{marginTop:14}}>
      <h3 style={{margin:"0 0 8px"}}>Assessment result</h3>
      <p><strong>Audit chain:</strong> {evidence.auditChainValid===true?"Valid":"Not verified"}<br/><strong>Original source hash:</strong> {evidence.sourceHash||"Not retrieved"}</p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"10px 0"}}>
        {Object.entries(evidence.summary||{}).map(([key,value])=><span key={key} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:"6px 9px",fontSize:13}}>{key}: <strong>{value}</strong></span>)}
      </div>
      <div style={{display:"grid",gap:8}}>
        {(evidence.stampSlots||[]).map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>Stamp field {row.fieldId}</strong><strong>{statusLabel(row.status)}</strong></div>
          <div style={{fontSize:13,marginTop:4}}>{row.reason}</div>
        </div>)}
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
        <button type="button" onClick={loadPreview} disabled={previewLoading||evidence.auditChainValid!==true}>{previewLoading?"Generating preview…":"Generate watermarked preview"}</button>
        {previewUrl&&<a href={previewUrl} target="_blank" rel="noreferrer" style={{fontWeight:700}}>Open / save non-authoritative preview PDF</a>}
      </div>
      {previewUrl&&<p style={{fontSize:12}}>Preview is marked “RECOVERY PREVIEW — NOT COMPLETED” and is not an authoritative signed or archived document.</p>}
    </div>}
    {!loading&&queue.length>0&&!target&&<p>The owner queue contains {queue.length} failed-completion record(s), but not the specified document.</p>}
  </section>;
}
