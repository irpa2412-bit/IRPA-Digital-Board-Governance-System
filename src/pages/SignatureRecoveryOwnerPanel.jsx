import React,{useEffect,useState}from"react";
import{getIdToken}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";
import{normalizeFinalisationDiagnostic}from"../utils/finalisationDiagnosticResponse.mjs";

async function recoveryRequest(path,{pdf=false,method="GET",body=null}={}){
 if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account. (AUTH_REQUIRED)");
 const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
 if(!gateway)throw new Error("The recovery service is not configured. (RECOVERY_SERVICE_URL_MISSING)");
 const token=await getIdToken(auth.currentUser);
 const response=await fetch(gateway+path,{method,headers:{Authorization:"Bearer "+token,Accept:pdf?"application/pdf":"application/json",...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:JSON.stringify(body||{})}:{}),cache:"no-store"});
 if(!response.ok){
  const result=pdf?{}:await response.json().catch(()=>({}));
  const error=new Error(result.error||"Recovery request failed (HTTP "+response.status+").");
  error.status=response.status;error.code=result.code||"RECOVERY_REQUEST_FAILED";throw error;
 }
 return pdf?response.blob():response.json();
}
function reportText(item,evidence){
 const stamps=Array.isArray(evidence?.stampSlots)?evidence.stampSlots:[];
 const allVerified=evidence?.auditChain?.status==="VERIFIED"&&evidence?.sourceHashStatus==="VERIFIED"&&stamps.length>0&&stamps.every(row=>row.resultStatus==="PASS"||row.status==="VERIFIED_EXISTING");
 const lines=[
  "IRPA SIGNATURE RECOVERY EVIDENCE REPORT",
  "Document title: "+(item?.title||evidence?.title||"Untitled document"),
  "Document reference: "+(evidence?.documentId||item?.documentId||"Not recorded"),
  "Envelope ID: "+(item?.envelopeId||evidence?.envelopeId||"Not recorded"),
  "Envelope status: "+(item?.status||evidence?.status||"Unknown"),
  "Audit-chain result: "+(evidence?.auditChain?.status||"NOT_RETRIEVED")+" ("+(evidence?.auditChain?.code||"AUDIT_CHAIN_NOT_RETRIEVED")+")",
  "Source SHA-256: "+(evidence?.sourceHash||"NOT_RETRIEVED"),
  "Source-hash result: "+(evidence?.sourceHashStatus||"NOT_RETRIEVED")+" ("+(evidence?.sourceHashCode||"SOURCE_HASH_NOT_RETRIEVED")+")",
  "Finalisation stage: "+(evidence?.finalisationStageCode||evidence?.finalisationStage||"NOT_RECORDED"),
  "Retry status: "+(evidence?.retry?.status||"NOT_USED"),
  "Signer records:"
 ];
 for(const signer of evidence?.signers||[])lines.push("- "+(signer.name||"Signer")+" | "+(signer.maskedAddress||"Address not recorded")+" | "+(signer.signedAtEAT||"Signing time not recorded")+" | "+(signer.status||"Unknown"));
 lines.push("Signature stamps:");
 for(const row of stamps)lines.push("- "+((row.resultStatus==="PASS"||row.status==="VERIFIED_EXISTING")?"PASS":row.resultStatus||row.status||"UNVERIFIABLE")+" | Page "+(row.page||"unknown")+" | Field "+(row.fieldId||"unknown")+" | "+(row.code||"NOT_CODED"));
 if(!stamps.length)lines.push("- No signature or initials fields were returned.");
 lines.push(allVerified?(evidence?.status==="Completed"?"signatures verified; completed PDF generated":"signatures verified; completed PDF not yet generated"):"signatures not fully verified; completed PDF not yet generated");
 lines.push("This report contains no signature images, signing tokens or full email addresses.");
 lines.push("The report is an evidence assessment, not a completed signed PDF.");
 return lines.join("\n");
}
function diagnosticText(diagnostic){
 if(!diagnostic||!Array.isArray(diagnostic.steps))return"Diagnostic report unavailable.";
 const lines=["IRPA FINALISATION DRY-RUN REPORT","Envelope: "+(diagnostic.envelopeId||"Unavailable"),"Status: "+(diagnostic.status||"Unknown"),"Generated: "+(diagnostic.generatedAt||"Not recorded"),"Timezone: "+(diagnostic.timezone||"Not recorded"),"Read-only: "+(diagnostic.readOnly===true?"YES":"NOT CONFIRMED")];
 for(const step of diagnostic.steps){lines.push(step.stageCode+": "+step.status+" · "+(step.errorCode||"NO_ERROR")+" · "+(step.message||""));for(const field of Array.isArray(step.fields)?step.fields:[])lines.push("  Page "+field.page+" field "+field.fieldId+" rotation "+field.rotation);}
 for(const field of Array.isArray(diagnostic.fieldChecks)?diagnostic.fieldChecks:[])lines.push("FIELD "+field.status+" · page "+field.page+" · "+field.fieldId+" · rotation "+field.rotation);
 lines.push("Summary: "+(diagnostic.summary?.passed??0)+" PASS, "+(diagnostic.summary?.failed??0)+" FAILED; first failure "+(diagnostic.summary?.firstFailedStage||"none"));
 lines.push("No envelope, signer, field, signature, hash, certificate, archive, Drive or email writes were performed.");
 lines.push("This diagnostic does not retry, reassign, repair or finalise the envelope.");
 return lines.join("\n");
}
export default function SignatureRecoveryOwnerPanel({envelopeId,item}){
 const[evidence,setEvidence]=useState(null),[diagnostic,setDiagnostic]=useState(null),[loading,setLoading]=useState(false),[diagnosticLoading,setDiagnosticLoading]=useState(false),[previewLoading,setPreviewLoading]=useState(false),[retryLoading,setRetryLoading]=useState(false),[undoLoading,setUndoLoading]=useState(false),[retryApproved,setRetryApproved]=useState(false),[error,setError]=useState(""),[previewReason,setPreviewReason]=useState(""),[notice,setNotice]=useState(""),[previewUrl,setPreviewUrl]=useState("");
 useEffect(()=>{let active=true;setLoading(true);setEvidence(null);setDiagnostic(null);setError("");setPreviewReason("");setNotice("");setRetryApproved(false);if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl("");}
  recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/evidence").then(value=>{if(active)setEvidence(value)}).catch(err=>{if(active)setError(err?.message||"Evidence could not be retrieved.")}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[envelopeId]);
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
 async function diagnose(){
  setDiagnosticLoading(true);setDiagnostic(null);setError("");
  try{const raw=await recoveryRequest("/api/envelopes/"+encodeURIComponent(envelopeId)+"/diagnose-finalisation",{method:"POST"});const normalized=normalizeFinalisationDiagnostic(raw);if(!normalized||normalized.readOnly!==true)throw new Error("The diagnostic response was invalid or did not confirm read-only mode. (DIAGNOSTIC_RESPONSE_INVALID)");setDiagnostic(normalized);setNotice("Finalisation dry-run completed. No records or files were written.");}
  catch(err){setError(err?.message||"Finalisation diagnostic could not be retrieved.");}
  finally{setDiagnosticLoading(false);}
 }
 async function retryFinalisation(){
  if(!retryApproved||!canRetry)return;
  setRetryLoading(true);setError("");setNotice("");
  try{
   const result=await recoveryRequest("/api/envelopes/"+encodeURIComponent(envelopeId)+"/retry-finalisation",{method:"POST",body:{confirmOneRetry:true}});
   setEvidence(current=>current?{...current,status:result.completed?"Completed":"CompletionFailed",retry:result.retry||current.retry,completionFailure:result.failure?{stage:result.failure.stage,stageCode:result.failure.stageCode,failedAt:result.failure.failedAt}:current.completionFailure}:current);
   setNotice(result.completed?"The single normal finalisation completed. Email delivery remains independent.":"Retry failed at stage "+(result.failure?.stageCode||result.failure?.stage||"NOT_REPORTED")+". Existing signer evidence was retained.");
   setRetryApproved(false);
  }catch(err){setError(err?.message||"The controlled retry could not be completed.");}
  finally{setRetryLoading(false);}
 }
 async function undoRetry(){
  if(!window.confirm("Undo the failed finalisation retry? The original signing evidence will be preserved."))return;
  setUndoLoading(true);setError("");setNotice("");
  try{
   const result=await recoveryRequest("/api/envelopes/"+encodeURIComponent(envelopeId)+"/undo-finalisation-retry",{method:"POST"});
   setEvidence(current=>current?{...current,retry:{...(current.retry||{}),status:result.status||"UNDONE",undoneAt:result.undoAt||null,stageCode:result.stageCode||current.retry?.stageCode}}:current);
   setNotice("The failed retry was undone within its seven-day window. The recorded failing stage remains available.");
  }catch(err){setError(err?.message||"The failed retry could not be undone.");}
  finally{setUndoLoading(false);}
 }
 async function loadPreview(){
  setPreviewLoading(true);setPreviewReason("");
  try{const blob=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/preview.pdf",{pdf:true});setPreviewUrl(current=>{if(current)URL.revokeObjectURL(current);return URL.createObjectURL(blob)});}
  catch(err){setPreviewReason(err?.message||"Preview is not available. (PREVIEW_UNAVAILABLE)");}
  finally{setPreviewLoading(false);}
 }
 async function copy(text,label){try{await navigator.clipboard.writeText(text);setNotice(label+" copied. (REPORT_COPIED)");}catch{setNotice("Copy is unavailable in this browser. Select and copy the report text manually. (COPY_UNAVAILABLE)");}}
 function download(text,name){const blob=new Blob([text],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 const report=evidence?reportText(item,evidence):"",dryRun=diagnosticText(diagnostic);
 const canDiagnose=["CompletionFailed","Completing","Completed"].includes(item?.status||evidence?.status);
 const canPreview=(item?.status||evidence?.status)==="CompletionFailed"&&evidence?.auditChain?.status==="VERIFIED"&&evidence?.sourceHashStatus==="VERIFIED";
 const canRetry=evidence?.status==="CompletionFailed"&&evidence?.auditChain?.status==="VERIFIED"&&evidence?.sourceHashStatus==="VERIFIED"&&(evidence?.stampSlots||[]).length>0&&(evidence?.stampSlots||[]).every(row=>row.resultStatus==="PASS"||row.status==="VERIFIED_EXISTING")&&diagnostic?.readOnly===true&&!evidence?.retry;
 const canUndo=evidence?.retry?.status==="FAILED"&&evidence?.status==="CompletionFailed"&&Boolean(evidence?.retry?.undoUntil)&&Date.parse(evidence.retry.undoUntil)>Date.now();
 return <section className="panel signature-recovery-owner-panel" aria-label="Read-only signature recovery evidence" style={{marginTop:14,padding:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:10}}>
  <h3>Evidence assessment / Tathmini ya ushahidi</h3>
  {loading&&<p role="status">Checking evidence… / Inakagua ushahidi…</p>}{error&&<p role="alert">{error}</p>}
  {evidence&&<><p><strong>Audit chain:</strong> {evidence.auditChain?.status||"NOT_RETRIEVED"} ({evidence.auditChain?.code||"NOT_RETRIEVED"})</p><p><strong>Source hash:</strong> {evidence.sourceHashStatus||"NOT_RETRIEVED"} ({evidence.sourceHashCode||"NOT_RETRIEVED"}) — {evidence.sourceHashReason||"Not recorded"}</p><p><strong>Finalisation stage:</strong> {evidence.finalisationStage||"NOT_RECORDED"} ({evidence.finalisationStageCode||"NOT_RECORDED"})</p>
   <h4>Signature stamps / Mihuri ya saini</h4>{(evidence.stampSlots||[]).length===0?<p>No signature or initials fields were returned. (STAMP_FIELDS_NONE)</p>:<div style={{display:"grid",gap:8}}>{evidence.stampSlots.map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}><strong>{row.resultStatus||row.status||"UNVERIFIABLE"}</strong> — Page {row.page||"unknown"}, field {row.fieldId||"unknown"}<div style={{fontSize:13}}>{row.reason} ({row.code})</div></div>)}</div>}
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>{canDiagnose?<button type="button" onClick={diagnose} disabled={diagnosticLoading}>{diagnosticLoading?"Diagnosing…":"Diagnose finalisation (read-only)"}</button>:<span className="muted">Dry-run diagnosis is not supported for this envelope status.</span>}<button type="button" onClick={()=>copy(report,"Assessment report")}>Copy assessment</button><button type="button" onClick={()=>download(report,"signature-recovery-evidence-report.txt")}>Download evidence report</button><button type="button" onClick={loadPreview} disabled={!canPreview||previewLoading}>{previewLoading?"Preparing preview…":"Generate watermarked preview"}</button></div>
   {!canPreview&&<p className="muted">Preview is withheld unless the envelope is CompletionFailed and both the signing audit chain and original source hash are verified.</p>}
   {canRetry&&<div style={{marginTop:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:12}}>
    <h4>Controlled finalisation retry</h4>
    <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={retryApproved} onChange={event=>setRetryApproved(event.target.checked)}/><span>I approve exactly one normal finalisation attempt for this envelope.</span></label>
    <button type="button" onClick={retryFinalisation} disabled={!retryApproved||retryLoading}>{retryLoading?"Running one attempt…":"Retry finalisation"}</button>
    <p className="muted">The server creates a restricted backup first, enforces one retry per envelope and three per hour, and records the actor, time, result and failing stage. It never sets Completed directly.</p>
   </div>}
   {canUndo&&<div style={{marginTop:10}}><button type="button" onClick={undoRetry} disabled={undoLoading}>{undoLoading?"Undoing…":"Undo failed retry (7-day window)"}</button></div>}
   {evidence?.retry?.status&&<p><strong>Retry record:</strong> {evidence.retry.status}{evidence.retry.stageCode?" · stage "+evidence.retry.stageCode:""}{evidence.retry.undoUntil?" · undo until "+evidence.retry.undoUntil:""}</p>}

   {diagnostic&&<div style={{marginTop:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:12}}><h4>Finalisation dry-run results</h4><p>{diagnostic.summary?.passed??0} PASS · {diagnostic.summary?.failed??0} FAILED · First failure: {diagnostic.summary?.firstFailedStage||"None"}</p>{diagnostic.steps.map((step,index)=><div key={step.stageCode||index} style={{padding:"8px 0",borderBottom:"1px solid var(--border-color,#cbd5e1)"}}><strong>{step.stageCode||"UNKNOWN"} — {step.status||"UNVERIFIABLE"}</strong><div style={{fontSize:12}}>{step.errorCode||"NO_ERROR"} · {step.message||"No error reported"}</div>{(step.fields||[]).map(field=><small key={field.fieldId}>Page {field.page} · {field.fieldId} · rotation {field.rotation} · x {field.position?.x}, y {field.position?.y}</small>)}</div>)}<button type="button" onClick={()=>copy(dryRun,"Diagnostic report")}>Copy diagnostic report</button><button type="button" onClick={()=>download(dryRun,"signature-finalisation-dry-run.txt")}>Download diagnostic report</button></div>}
   {previewReason&&<p role="status">Preview not available: {previewReason}</p>}{previewUrl&&<><p>Preview is a non-authoritative copy marked “RECOVERY PREVIEW — NOT COMPLETED”. It is not a court-ready completed document.</p><a href={previewUrl} target="_blank" rel="noreferrer">Open / save watermarked preview PDF</a></>}
  </>}
  {notice&&<p role="status">{notice}</p>}
  <p style={{fontSize:12,marginTop:10}}>Assessment and dry-run are read-only. A separate, explicitly confirmed retry is owner/admin-only, backup-first and limited to one normal finalisation run. Completed documents remain immutable; email delivery never determines Completed. / Tathmini haisaini tena, haibadilishi msaini, hairekebishi wala kubadilisha hati ya awali au ushahidi wake.</p>
 </section>;
}
