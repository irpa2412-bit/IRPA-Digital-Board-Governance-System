import React,{useEffect,useState}from"react";
import{getIdToken}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";
import{normalizeFinalisationDiagnostic}from"../utils/finalisationDiagnosticResponse.mjs";
import{formatRecoveryRouteError}from"../utils/recoveryRouteError.mjs";

async function recoveryRequest(path,{pdf=false,method="GET",button="Recovery action"}={}){
 if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account. (AUTH_REQUIRED)");
 const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
 if(!gateway)throw new Error("The recovery service is not configured. (RECOVERY_SERVICE_URL_MISSING)");
 const token=await getIdToken(auth.currentUser);
 const response=await fetch(gateway+path,{method,headers:{Authorization:"Bearer "+token,Accept:pdf?"application/pdf":"application/json",...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:"{}"}:{}),cache:"no-store"});
 if(!response.ok){
  const result=pdf?{}:await response.json().catch(()=>({}));
  const route=path.split("?")[0];
  const error=new Error(formatRecoveryRouteError({status:response.status,body:result,button,route}));
  error.status=response.status;error.code=result.code||"RECOVERY_REQUEST_FAILED";throw error;
 }
 return pdf?response.blob():response.json();
}
function reportText(item,evidence){
 const lines=["IRPA SIGNATURE RECOVERY ASSESSMENT","Document: "+(item?.title||evidence?.title||"Untitled document"),"Reference: "+(item?.documentId||"Not recorded"),"Envelope ID: "+(item?.envelopeId||evidence?.envelopeId||"Not recorded"),"Envelope status: "+(item?.status||evidence?.status||"Unknown"),"Finalisation stage: "+(evidence?.finalisationStage||"NOT_RECORDED")+" ("+(evidence?.finalisationStageCode||"FINALISATION_STAGE_NOT_RECORDED")+")","Audit chain: "+(evidence?.auditChain?.status||"NOT_RETRIEVED")+" ("+(evidence?.auditChain?.code||"AUDIT_CHAIN_NOT_RETRIEVED")+")","Source hash: "+(evidence?.sourceHashStatus||"NOT_RETRIEVED")+" ("+(evidence?.sourceHashCode||"SOURCE_HASH_NOT_RETRIEVED")+") — "+(evidence?.sourceHashReason||"Not recorded"),"Signature stamps:"];
 for(const row of evidence?.stampSlots||[])lines.push("- Page "+(row.page||"unknown")+", field "+(row.fieldId||"unknown")+": "+(row.resultStatus||row.status||"UNVERIFIABLE")+" ("+(row.code||"NOT_CODED")+") — "+(row.reason||"No reason recorded."));
 if(!(evidence?.stampSlots||[]).length)lines.push("- No signature or initials fields were returned.");
 lines.push("This report is an assessment only. The original PDF, signatures, signer identities, signing events, hashes, certificates and archive records were not changed.");
 return lines.join("\n");
}
function diagnosticText(diagnostic){
 if(!diagnostic||!Array.isArray(diagnostic.steps))return"Diagnostic report unavailable.";
 const lines=["IRPA FINALISATION DRY-RUN REPORT","Envelope: "+(diagnostic.envelopeId||"Unavailable"),"Status: "+(diagnostic.status||"Unknown"),"Generated: "+(diagnostic.generatedAt||"Not recorded"),"Timezone: "+(diagnostic.timezone||"Not recorded"),"Read-only: "+(diagnostic.readOnly===true?"YES":"NOT CONFIRMED")];
 for(const step of diagnostic.steps){lines.push(step.stageCode+": "+step.status+" · "+(step.errorCode||"NO_ERROR")+" · "+(step.message||""));for(const field of Array.isArray(step.fields)?step.fields:[])lines.push("  Page "+field.page+" field "+field.fieldId+" rotation "+field.rotation);}
 for(const field of Array.isArray(diagnostic.fieldChecks)?diagnostic.fieldChecks:[])lines.push("FIELD "+field.status+" · page "+field.page+" · "+field.fieldId+" · rotation "+field.rotation);
 lines.push("Summary: "+(diagnostic.summary?.passed??0)+" PASS, "+(diagnostic.summary?.failed??0)+" FAILED; first failure "+(diagnostic.summary?.firstFailedStage||"none"));
 lines.push("No envelope, signer, field, signature, hash, certificate, archive, Drive or email writes were performed.");
 return lines.join("\n");
}
function SignatureRecoveryOwnerPanelInner({envelopeId,item}){
 const[evidence,setEvidence]=useState(null),[diagnostic,setDiagnostic]=useState(null),[loading,setLoading]=useState(false),[diagnosticLoading,setDiagnosticLoading]=useState(false),[previewLoading,setPreviewLoading]=useState(false),[copyLoading,setCopyLoading]=useState(false),[copyHash,setCopyHash]=useState(""),[copyMatch,setCopyMatch]=useState(""),[copyLabel,setCopyLabel]=useState(""),[copySource,setCopySource]=useState(""),[copyWarning,setCopyWarning]=useState(""),[copyChecks,setCopyChecks]=useState(null),[copyError,setCopyError]=useState(""),[error,setError]=useState(""),[previewReason,setPreviewReason]=useState(""),[notice,setNotice]=useState(""),[previewUrl,setPreviewUrl]=useState("");
 useEffect(()=>{let active=true;setLoading(true);setEvidence(null);setDiagnostic(null);setError("");setPreviewReason("");setNotice("");if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl("");}
  recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/evidence",{button:"Check this document"}).then(value=>{if(active)setEvidence(value)}).catch(err=>{if(active)setError(err?.message||"Evidence could not be retrieved.")}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[envelopeId]);
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
 async function diagnose(){
  setDiagnosticLoading(true);setDiagnostic(null);setError("");
  try{const raw=await recoveryRequest("/api/envelopes/"+encodeURIComponent(envelopeId)+"/diagnose-finalisation",{method:"POST",button:"Diagnose finalisation (read-only)"});const normalized=normalizeFinalisationDiagnostic(raw);if(!normalized||normalized.readOnly!==true)throw new Error("The diagnostic response was invalid or did not confirm read-only mode. (DIAGNOSTIC_RESPONSE_INVALID)");setDiagnostic(normalized);setNotice("Finalisation dry-run completed. No records or files were written.");}
  catch(err){setError(err?.message||"Finalisation diagnostic could not be retrieved.");}
  finally{setDiagnosticLoading(false);}
 }
 async function downloadRecoveryPdf(path,{method="GET",button,hashHeader}={}){
  setCopyLoading(true);setCopyError("");setCopyHash("");setCopyMatch("");setCopyLabel("");setCopySource("");setCopyWarning("");setCopyChecks(null);
  try{
   if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account. (AUTH_REQUIRED)");
   let gateway=String(getGoogleDriveGatewayUrl()||"");while(gateway.endsWith("/"))gateway=gateway.slice(0,-1);if(!gateway)throw new Error("Recovery service unavailable. (RECOVERY_SERVICE_URL_MISSING)");
   const token=await getIdToken(auth.currentUser);
   const response=await fetch(gateway+path,{method,headers:{Authorization:"Bearer "+token,Accept:"application/pdf",...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:"{}"}:{}),cache:"no-store"});
   if(!response.ok){const body=await response.json().catch(()=>({}));const detail=String(body.code||"").startsWith("EMERGENCY_RETRIEVAL_FAILED:")?[body.code,body.errorClass,body.messageEn,body.messageSw].filter(Boolean).join(" — "):formatRecoveryRouteError({status:response.status,body,button,route:path});throw new Error(detail);}
   if(!String(response.headers.get("content-type")||"").toLowerCase().includes("application/pdf"))throw new Error("Recovery PDF unavailable. (COPY_RESPONSE_NOT_PDF)");
   const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw new Error("Recovery PDF unavailable. (COPY_RESPONSE_EMPTY)");
   const actualHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
   const headerHash=String(response.headers.get(hashHeader)||"").toLowerCase();
   if(!/^[a-f0-9]{64}$/.test(headerHash)||actualHash!==headerHash)throw new Error("Downloaded PDF integrity check failed. (HASH_MISMATCH)");
   setCopyHash(actualHash);setCopyMatch("MATCH");const source=response.headers.get("x-irpa-copy-source")||"EMERGENCY_BUILD";
   const warning=response.headers.get("x-irpa-copy-warning")||"";setCopySource(source==="PRESERVED_COPY"?"Preserved copy":"Emergency in-memory build");setCopyWarning(warning);setCopyLabel(warning||response.headers.get("x-irpa-copy-label")||"Unarchived copy; the envelope is not yet Completed");setCopyChecks(JSON.parse(response.headers.get("x-irpa-copy-checks")||"null"));
   const blob=new Blob([bytes],{type:"application/pdf"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=source==="PRESERVED_COPY"?"unarchived-completed-copy.pdf":(warning?"UNARCHIVED-COPY-CERTIFICATE-NOT-VERIFIED.pdf":"emergency-retrieval-copy.pdf");link.click();URL.revokeObjectURL(url);
  }catch(err){setCopyError(err?.message||"Recovery download unavailable. (COPY_DOWNLOAD_FAILED)");}finally{setCopyLoading(false);}
 }
 async function downloadUnarchivedCopy(){return downloadRecoveryPdf("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/completed-copy.pdf",{button:"Download completed copy",hashHeader:"x-irpa-document-sha256"});}
 async function downloadEmergencyCopy(){return downloadRecoveryPdf("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/emergency-retrieval",{method:"POST",button:"Download emergency copy",hashHeader:"x-irpa-output-sha256"});}
 async function downloadEvidenceReportPdf(){
  try{
   if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account. (AUTH_REQUIRED)");
   let gateway=String(getGoogleDriveGatewayUrl()||"");while(gateway.endsWith("/"))gateway=gateway.slice(0,-1);if(!gateway)throw new Error("Recovery service unavailable. (RECOVERY_SERVICE_URL_MISSING)");
   const token=await getIdToken(auth.currentUser),path="/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/emergency-evidence-report.pdf";
   const response=await fetch(gateway+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/pdf"},cache:"no-store"});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||"Evidence report could not be generated. (EVIDENCE_REPORT_FAILED)");}
   if(!String(response.headers.get("content-type")||"").toLowerCase().includes("application/pdf"))throw new Error("Evidence report response was not a PDF. (EVIDENCE_REPORT_NOT_PDF)");
   const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
   if(hash!==String(response.headers.get("x-irpa-report-sha256")||"").toLowerCase())throw new Error("Evidence report hash verification failed. (EVIDENCE_REPORT_HASH_MISMATCH)");
   const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"})),link=document.createElement("a");link.href=url;link.download="emergency-retrieval-evidence-report.pdf";link.click();URL.revokeObjectURL(url);
  }catch(err){setError(err?.message||"Evidence report could not be downloaded. (EVIDENCE_REPORT_FAILED)");}
 }
 async function loadPreview(){
  setPreviewLoading(true);setPreviewReason("");
  try{const blob=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/preview.pdf",{pdf:true,button:"Generate watermarked preview"});setPreviewUrl(current=>{if(current)URL.revokeObjectURL(current);return URL.createObjectURL(blob)});}
  catch(err){setPreviewReason(err?.message||"Preview is not available. (PREVIEW_UNAVAILABLE)");}
  finally{setPreviewLoading(false);}
 }
 async function copy(text,label){try{await navigator.clipboard.writeText(text);setNotice(label+" copied. (REPORT_COPIED)");}catch{setNotice("Copy is unavailable in this browser. Select and copy the report text manually. (COPY_UNAVAILABLE)");}}
 function download(text,name){const blob=new Blob([text],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 const report=evidence?reportText(item,evidence):"",dryRun=diagnosticText(diagnostic);
 const canDiagnose=["CompletionFailed","Completing","Completed"].includes(item?.status||evidence?.status);
 const canPreview=(item?.status||evidence?.status)==="CompletionFailed"&&evidence?.auditChain?.status==="VERIFIED"&&evidence?.sourceHashStatus==="VERIFIED";
 return <section className="panel signature-recovery-owner-panel" aria-label="Read-only signature recovery evidence" style={{marginTop:14,padding:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:10}}>
  <h3>Evidence assessment / Tathmini ya ushahidi</h3>
  {loading&&<p role="status">Checking evidence… / Inakagua ushahidi…</p>}{error&&<p role="alert">{error}</p>}
  {evidence&&<><p><strong>Environment on envelope:</strong> {evidence.environmentDiagnostics?.envelope||"NOT_RETRIEVED"}</p><p><strong>Environment on preserved copy:</strong> {evidence.environmentDiagnostics?.preservedCopy||"NOT_RETRIEVED"}</p><p><strong>Worker environment:</strong> {evidence.environmentDiagnostics?.gatewayExpected||"NOT_RETRIEVED"}</p><p><strong>Audit chain:</strong> {evidence.auditChain?.status||"NOT_RETRIEVED"} ({evidence.auditChain?.code||"NOT_RETRIEVED"})</p><p><strong>Source hash:</strong> {evidence.sourceHashStatus||"NOT_RETRIEVED"} ({evidence.sourceHashCode||"NOT_RETRIEVED"}) — {evidence.sourceHashReason||"Not recorded"}</p><p><strong>Finalisation stage:</strong> {evidence.finalisationStage||"NOT_RECORDED"} ({evidence.finalisationStageCode||"NOT_RECORDED"})</p>
   <h4>Signature stamps / Mihuri ya saini</h4>{(evidence.stampSlots||[]).length===0?<p>No signature or initials fields were returned. (STAMP_FIELDS_NONE)</p>:<div style={{display:"grid",gap:8}}>{evidence.stampSlots.map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}><strong>{row.resultStatus||row.status||"UNVERIFIABLE"}</strong> — Page {row.page||"unknown"}, field {row.fieldId||"unknown"}<div style={{fontSize:13}}>{row.reason} ({row.code})</div></div>)}</div>}
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>{canDiagnose?<button type="button" onClick={diagnose} disabled={diagnosticLoading}>{diagnosticLoading?"Diagnosing…":"Diagnose finalisation (read-only)"}</button>:<span className="muted">Dry-run diagnosis is not supported for this envelope status.</span>}<button type="button" onClick={()=>copy(report,"Assessment report")}>Copy assessment</button><button type="button" onClick={()=>download(report,"signature-recovery-assessment.txt")}>Download assessment text</button><button type="button" onClick={downloadEvidenceReportPdf}>Download evidence report (PDF)</button>{(item?.status||evidence?.status)==="CompletionFailed"&&<><button type="button" onClick={downloadUnarchivedCopy} disabled={copyLoading}>{copyLoading?"Preparing copy…":"Download completed copy"}</button><button type="button" onClick={downloadEmergencyCopy} disabled={copyLoading}>{copyLoading?"Preparing copy…":"Download emergency copy"}</button></>}<button type="button" onClick={loadPreview} disabled={!canPreview||previewLoading}>{previewLoading?"Preparing preview…":"Generate watermarked preview"}</button></div>
   {copyError&&<p role="alert">Recovery download unavailable. {copyError}</p>}{copyChecks&&<div aria-label="Emergency copy verification results"><strong>Emergency copy checks</strong>{Object.entries(copyChecks).map(([name,status])=><p key={name}>{name}: {status}</p>)}</div>}{copyLabel&&<p role="status">{copyLabel}</p>}{copySource&&<p><strong>Served by:</strong> {copySource}</p>}{copyHash&&<p><strong>SHA-256:</strong> <code>{copyHash}</code> · <strong>{copyMatch}</strong> <button type="button" onClick={()=>copy(copyHash,"SHA-256 hash")}>Copy hash</button></p>}{!canPreview&&<p className="muted">Preview is withheld unless the envelope is CompletionFailed and both the signing audit chain and original source hash are verified.</p>}
   {diagnostic&&<div style={{marginTop:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:12}}><h4>Finalisation dry-run results</h4><p>{diagnostic.summary?.passed??0} PASS · {diagnostic.summary?.failed??0} FAILED · First failure: {diagnostic.summary?.firstFailedStage||"None"}</p>{diagnostic.steps.map((step,index)=><div key={step.stageCode||index} style={{padding:"8px 0",borderBottom:"1px solid var(--border-color,#cbd5e1)"}}><strong>{step.stageCode||"UNKNOWN"} — {step.status||"UNVERIFIABLE"}</strong><div style={{fontSize:12}}>{step.errorCode||"NO_ERROR"} · {step.message||"No error reported"}</div>{(step.fields||[]).map(field=><small key={field.fieldId}>Page {field.page} · {field.fieldId} · rotation {field.rotation} · x {field.position?.x}, y {field.position?.y}</small>)}</div>)}<button type="button" onClick={()=>copy(dryRun,"Diagnostic report")}>Copy diagnostic report</button><button type="button" onClick={()=>download(dryRun,"signature-finalisation-dry-run.txt")}>Download diagnostic report</button></div>}
   {previewReason&&<p role="status">Preview not available: {previewReason}</p>}{previewUrl&&<><p>Preview is a non-authoritative copy marked “RECOVERY PREVIEW — NOT COMPLETED”. It is not a court-ready completed document.</p><a href={previewUrl} target="_blank" rel="noreferrer">Open / save watermarked preview PDF</a></>}
  </>}
  {notice&&<p role="status">{notice}</p>}
  <p style={{fontSize:12,marginTop:10}}>Assessment and dry-run are read-only. No retry, reassignment, repair, finalisation, or change to the original document, signers, signatures, signing events, hashes, certificates or archive records is performed. / Tathmini haisaini tena, haibadilishi msaini, hairekebishi wala kubadilisha hati ya awali au ushahidi wake.</p>
 </section>;
}

class SignatureRecoveryPanelErrorBoundary extends React.Component {
 constructor(props){super(props);this.state={failed:false};}
 static getDerivedStateFromError(){return{failed:true};}
 componentDidCatch(){/* keep recovery UI failures local and non-sensitive */}
 render(){return this.state.failed?<section role="alert" className="panel">The recovery panel could not be displayed. Refresh the page and retry. (RECOVERY_PANEL_RENDER_FAILED)</section>:this.props.children;}
}
export default function SignatureRecoveryOwnerPanel(props){
 return <SignatureRecoveryPanelErrorBoundary><SignatureRecoveryOwnerPanelInner {...props}/></SignatureRecoveryPanelErrorBoundary>;
}
