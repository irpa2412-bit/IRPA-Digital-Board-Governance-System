import React,{useEffect,useState}from"react";
import{getIdToken}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";
import{normalizeFinalisationDiagnostic}from"../utils/finalisationDiagnosticResponse.mjs";

const TARGET_DOCUMENT_ID="IRPA-ENV-2026-11501354";
const TARGET_TITLE="Muhtasari wa Kikao cha Familia";
async function recoveryRequest(path,{pdf=false,method="GET"}={}){
  if(!auth.currentUser){const e=new Error("You are not signed in. (AUTH_REQUIRED)");e.code="AUTH_REQUIRED";e.status=401;throw e;}
  const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
  if(!gateway){const e=new Error("The recovery service is unavailable (route missing). (RECOVERY_SERVICE_URL_MISSING)");e.code="RECOVERY_SERVICE_URL_MISSING";e.status=503;throw e;}
  const token=await getIdToken(auth.currentUser);
  const response=await fetch(gateway+path,{method,headers:{Authorization:"Bearer "+token,Accept:pdf?"application/pdf":"application/json",...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:"{}"}:{}),cache:"no-store"});
  if(!response.ok){
    const result=pdf?{}:await response.json().catch(()=>({}));
    const missingRoute=response.status===404&&String(result.error||"").trim()==="Not found.";
    const code=result.code||(response.status===401?"AUTH_REQUIRED":response.status===403?"OWNER_FORBIDDEN":missingRoute?"EVIDENCE_ROUTE_MISSING":"RECOVERY_REQUEST_FAILED");
    const message=response.status===401?"You are not signed in. (AUTH_REQUIRED)":response.status===403?"This envelope belongs to another account. (OWNER_FORBIDDEN)":missingRoute?"The recovery service is unavailable (route missing). (EVIDENCE_ROUTE_MISSING)":(result.error||("Recovery request failed (HTTP "+response.status+")."));
    const error=new Error(message);error.status=response.status;error.code=code;throw error;
  }
  return pdf?response.blob():response.json();
}
function reportText(item,evidence){
  const lines=["IRPA SIGNATURE RECOVERY ASSESSMENT","Document: "+(item?.title||evidence?.title||TARGET_TITLE),"Reference: "+(item?.documentId||TARGET_DOCUMENT_ID),"Envelope status: "+(item?.status||evidence?.status||"Unknown"),"Finalisation stage: "+(evidence?.finalisationStage||"NOT_RECORDED")+" ("+(evidence?.finalisationStageCode||"FINALISATION_STAGE_NOT_RECORDED")+")","Audit chain: "+(evidence?.auditChain?.status==="VERIFIED"?"verified":evidence?.auditChain?.status==="FAILED"?"failed":"no events found")+" ("+(evidence?.auditChain?.code||"AUDIT_CHAIN_NOT_RETRIEVED")+")","Source hash: "+(evidence?.sourceHashStatus==="VERIFIED"?"verified":evidence?.sourceHashStatus==="MISMATCH"?"mismatch":evidence?.sourceHashStatus==="NO_STORED_HASH"?"no stored hash":evidence?.sourceHashStatus||"not retrieved")+" — "+(evidence?.sourceHashReason||"")+" ("+(evidence?.sourceHashCode||"SOURCE_HASH_NOT_RETRIEVED")+")","Stamps:"];
  for(const row of evidence?.stampSlots||[])lines.push("- Page "+(row.page||"unknown")+", field "+row.fieldId+": "+(row.resultStatus||row.status)+" ("+row.code+") — "+row.reason);
  if(!(evidence?.stampSlots||[]).length)lines.push("- No signature or initials fields were returned.");
  lines.push("Preview: not included in this report; the preview is non-authoritative.");
  lines.push("This is a read-only assessment. No envelope or signing record was changed.");
  return lines.join("\n");
}
function stampLabel(status){return({PASS:"PASS",FAILED:"FAILED",MISSING:"MISSING",UNVERIFIABLE:"UNVERIFIABLE"})[status]||status||"UNVERIFIABLE";}
export default function SignatureRecoveryOwnerPanel(){
  const[queue,setQueue]=useState([]),[selected,setSelected]=useState(null),[evidence,setEvidence]=useState(null),[diagnostic,setDiagnostic]=useState(null),[diagnosticLoading,setDiagnosticLoading]=useState(false),[previewUrl,setPreviewUrl]=useState(""),[loading,setLoading]=useState(false),[previewLoading,setPreviewLoading]=useState(false),[error,setError]=useState(""),[evidenceError,setEvidenceError]=useState(""),[previewReason,setPreviewReason]=useState(""),[notice,setNotice]=useState("");
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
  async function loadQueue(){
    setLoading(true);setError("");setEvidenceError("");setEvidence(null);setSelected(null);
    if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl("");}
    try{
      const items=[];let offset=0,total=0;
      do{const result=await recoveryRequest("/api/recovery/envelopes?limit=50&offset="+offset);const page=Array.isArray(result.items)?result.items:[];items.push(...page);total=Number(result.total||0);offset+=page.length;if(!page.length||offset>=total||offset>=10000)break;}while(true);
      setQueue(items);
      const match=items.find(item=>item.documentId===TARGET_DOCUMENT_ID);
      if(match)await assessItem(match);else setNotice("The target document is not present in the signed-in owner queue. (OWNER_QUEUE_NO_MATCH)");
    }catch(err){setError(err?.message||"Unable to retrieve the owner queue.");}
    finally{setLoading(false);}
  }
  async function assessItem(item){
    setSelected(item);setEvidence(null);setDiagnostic(null);setEvidenceError("");setNotice("");setPreviewReason("");
    if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl("");}
    try{const result=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(item.envelopeId)+"/evidence");setEvidence(result);setNotice("Evidence assessment retrieved. (ASSESSMENT_READ_ONLY)");}
    catch(err){setEvidenceError(err?.message||"Evidence could not be retrieved.");}
  }
  async function diagnose(){
    if(!selected?.envelopeId)return;setDiagnosticLoading(true);setDiagnostic(null);setEvidenceError("");
    try{const raw=await recoveryRequest("/api/envelopes/"+encodeURIComponent(selected.envelopeId)+"/diagnose-finalisation",{method:"POST"});const normalized=normalizeFinalisationDiagnostic(raw);if(!normalized)throw new Error("The diagnostic service returned an invalid report. (DIAGNOSTIC_RESPONSE_INVALID)");setDiagnostic(normalized);setNotice("Finalisation diagnostic completed. No records or files were written.");}catch(err){setEvidenceError(err?.message||"Finalisation diagnostic could not be retrieved.");}finally{setDiagnosticLoading(false);}\n  }
  function diagnosticText(){if(!diagnostic||!Array.isArray(diagnostic.steps))return "Diagnostic report unavailable.";const lines=["IRPA FINALISATION DRY-RUN REPORT","Envelope: "+(diagnostic.envelopeId||"Unavailable"),"Status: "+(diagnostic.status||"Unknown"),"Generated: "+(diagnostic.generatedAt||"Not recorded"),"Timezone: "+(diagnostic.timezone||"Not recorded"),"Read-only: "+(diagnostic.readOnly===true?"YES":"NOT CONFIRMED")];for(const step of diagnostic.steps){lines.push(step.stageCode+": "+step.status+" · "+(step.errorCode||"NO_ERROR")+" · "+(step.message||""));for(const field of Array.isArray(step.fields)?step.fields:[])lines.push("  Page "+field.page+" field "+field.fieldId+" rotation "+field.rotation);}for(const field of Array.isArray(diagnostic.fieldChecks)?diagnostic.fieldChecks:[])lines.push("FIELD "+field.status+" · page "+field.page+" · "+field.fieldId+" · rotation "+field.rotation);lines.push("Summary: "+(diagnostic.summary?.passed??0)+" PASS, "+(diagnostic.summary?.failed??0)+" FAILED; first failure "+(diagnostic.summary?.firstFailedStage||"none"));lines.push("No envelope, audit, archive, Drive, or email writes were performed.");return lines.join("\n");}
  async function copyDiagnostic(){try{await navigator.clipboard.writeText(diagnosticText());setNotice("Diagnostic report copied. (REPORT_COPIED)");}catch{setNotice("Copy is unavailable in this browser. (COPY_UNAVAILABLE)");}}
  useEffect(()=>{void loadQueue()},[]);
  async function loadPreview(){
    if(!selected)return;setPreviewLoading(true);setPreviewReason("");
    try{const blob=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(selected.envelopeId)+"/preview.pdf",{pdf:true});if(previewUrl)URL.revokeObjectURL(previewUrl);setPreviewUrl(URL.createObjectURL(blob));}
    catch(err){setPreviewReason(err?.message||"Preview is not available. (PREVIEW_UNAVAILABLE)");}
    finally{setPreviewLoading(false);}
  }
  const report=evidence?reportText(selected,evidence):"";
  async function copyReport(){try{await navigator.clipboard.writeText(report);setNotice("Assessment report copied. (REPORT_COPIED)");}catch{setNotice("Copy is unavailable in this browser. Use Download report instead. (COPY_UNAVAILABLE)");}}
  function downloadReport(){const blob=new Blob([report],{type:"text/plain;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="signature-recovery-assessment.txt";a.click();URL.revokeObjectURL(url);}
  return <section className="panel signature-recovery-owner-panel" aria-labelledby="signature-recovery-heading" style={{margin:"20px 0",padding:18,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:12}}>
    <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}><div><p style={{margin:"0 0 5px",fontSize:12,fontWeight:700,letterSpacing:".08em"}}>RESTRICTED · OWNER RECOVERY</p><h2 id="signature-recovery-heading" style={{margin:"0 0 6px"}}>Signature Recovery Assessment</h2><p style={{margin:0}}>Inspect available completion evidence without changing signatures or envelope records.</p></div><button type="button" onClick={loadQueue} disabled={loading}>{loading?"Loading…":"Refresh my envelopes"}</button></div>
    <h3 style={{margin:"16px 0 8px"}}>My envelopes needing attention</h3>
    {queue.length===0&&!loading&&<p>No failed-completion envelopes were returned for this account. (OWNER_QUEUE_EMPTY)</p>}
    <div style={{display:"grid",gap:8}}>{queue.map(item=><div key={item.envelopeId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}><div><strong>{item.title||"Untitled document"}</strong><div style={{fontSize:12}}>Reference: {item.documentId} · Status: {item.status}</div><div style={{fontSize:12}}>Recorded stage: {item.stage||"NOT_RECORDED"}</div></div><button type="button" onClick={()=>assessItem(item)} disabled={loading}>Assess</button></div>)}</div>
    {error&&<p role="alert" style={{color:"var(--danger,#b91c1c)"}}>{error}</p>}
    {selected&&<div style={{marginTop:16,padding:12,borderRadius:8,background:"var(--surface-muted,#f1f5f9)"}}><strong>{selected.title||TARGET_TITLE}</strong><div style={{fontSize:13}}>Reference: {selected.documentId||TARGET_DOCUMENT_ID}</div><div style={{fontSize:12,marginTop:4}}>Envelope ID: {selected.envelopeId}</div></div>}
    {evidenceError&&<p role="alert" style={{color:"var(--danger,#b91c1c)"}}>{evidenceError}</p>}
    {evidence&&<div style={{marginTop:14}}>
      <h3>Evidence assessment</h3>
      <p><strong>Audit chain:</strong> {evidence.auditChain?.status==="VERIFIED"?"verified":evidence.auditChain?.status==="FAILED"?"failed":"no events found"} <span>({evidence.auditChain?.code||"AUDIT_CHAIN_NOT_RETRIEVED"})</span></p>
      <p><strong>Source hash:</strong> {evidence.sourceHashStatus==="VERIFIED"?"verified":evidence.sourceHashStatus==="MISMATCH"?"mismatch":evidence.sourceHashStatus==="NO_STORED_HASH"?"no stored hash":evidence.sourceHashReason||evidence.sourceHashStatus} <span>({evidence.sourceHashCode||"SOURCE_HASH_NOT_RETRIEVED"})</span></p>
      <p><strong>Finalisation step:</strong> {evidence.finalisationStage||"NOT_RECORDED"} <span>({evidence.finalisationStageCode||"FINALISATION_STAGE_NOT_RECORDED"})</span></p>
      <p><strong>Why it remains incomplete:</strong> Signer rows may be Signed, but the recorded finalisation step has not completed the envelope. The stage above is taken from the envelope completion-failure record.</p>
      <h4>Signature stamps</h4>
      {(evidence.stampSlots||[]).length===0?<p>No stamp fields were recorded. (STAMP_FIELDS_NONE)</p>:<div style={{display:"grid",gap:8}}>{evidence.stampSlots.map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}><strong>{stampLabel(row.resultStatus||row.status)}</strong> — Page {row.page||"unknown"}, field {row.fieldId}<div style={{fontSize:13}}>{row.reason} ({row.code})</div></div>)}</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}><button type="button" onClick={diagnose} disabled={diagnosticLoading}>{diagnosticLoading?"Diagnosing…":"Diagnose finalisation"}</button><button type="button" onClick={copyReport}>Copy report</button><button type="button" onClick={downloadReport}>Download plain-text report</button><button type="button" onClick={loadPreview} disabled={previewLoading||evidence.auditChain?.status!=="VERIFIED"||evidence.sourceHashStatus!=="VERIFIED"}>{previewLoading?"Preparing preview…":"Generate watermarked preview"}</button></div>
      {diagnostic&&<div style={{marginTop:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:12}}><h4>Finalisation dry-run results</h4><p>{diagnostic.summary?.passed??0} PASS · {diagnostic.summary?.failed??0} FAILED · First failure: {diagnostic.summary?.firstFailedStage||"None"}</p>{(Array.isArray(diagnostic.steps)?diagnostic.steps:[]).map((step,index)=><div key={step.stageCode||index} style={{padding:"8px 0",borderBottom:"1px solid var(--border-color,#cbd5e1)"}}><strong>{step.stageCode||"UNKNOWN"} — {step.status||"UNVERIFIABLE"}</strong><div style={{fontSize:12}}>{step.errorCode||"NO_ERROR"} · {step.message||"No error reported"}</div>{(Array.isArray(step.fields)?step.fields:[]).map(field=><small key={field.fieldId}>Page {field.page} · {field.fieldId} · rotation {field.rotation} · x {field.position?.x}, y {field.position?.y}</small>)}</div>)}<button type="button" onClick={copyDiagnostic} style={{marginTop:10}}>Copy report</button></div>}\n      {previewReason&&<p role="status">Preview: not available because {previewReason}</p>}
      {previewUrl&&<><p>Preview is non-authoritative and marked “RECOVERY PREVIEW — NOT COMPLETED”.</p><a href={previewUrl} target="_blank" rel="noreferrer">Open / save preview PDF</a></>}
    </div>}
    {notice&&<p role="status">{notice}</p>}
    <p style={{fontSize:12,marginTop:14}}>Assessment uses GET; finalisation diagnosis uses an authenticated owner/admin POST in a no-write sandbox. No envelope, signer, field, signature, hash, certificate, archive, Drive file or email record is changed by diagnosis.</p>
  </section>;
}
