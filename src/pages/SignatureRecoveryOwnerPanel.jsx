import React,{useEffect,useState}from"react";
import {PDFDocument,StandardFonts} from "pdf-lib";
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
 const[evidence,setEvidence]=useState(null),[diagnostic,setDiagnostic]=useState(null),[loading,setLoading]=useState(false),[diagnosticLoading,setDiagnosticLoading]=useState(false),[previewLoading,setPreviewLoading]=useState(false),[copyLoading,setCopyLoading]=useState(false),[copyHash,setCopyHash]=useState(""),[copyMatch,setCopyMatch]=useState(""),[copyLabel,setCopyLabel]=useState(""),[copySource,setCopySource]=useState(""),[copyStages,setCopyStages]=useState([]),[copyError,setCopyError]=useState(""),[error,setError]=useState(""),[previewReason,setPreviewReason]=useState(""),[notice,setNotice]=useState(""),[previewUrl,setPreviewUrl]=useState("");
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
 async function downloadRecoveryPdf(path,{method="GET",button,sourceFallback}={}){
  setCopyLoading(true);setCopyError("");setCopyHash("");setCopyMatch("");setCopyLabel("");setCopySource("");setCopyStages([]);
  try{
   if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account. (AUTH_REQUIRED)");
   const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
   if(!gateway)throw new Error("The recovery service is not configured. (RECOVERY_SERVICE_URL_MISSING)");
   const token=await getIdToken(auth.currentUser);
   const response=await fetch(gateway+path,{method,headers:{Authorization:"Bearer "+token,Accept:"application/pdf",...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:"{}"}:{}),cache:"no-store"});
   if(!response.ok){const body=await response.json().catch(()=>({}));if(Array.isArray(body.stages))setCopyStages(body.stages);const code=String(body.code||"RECOVERY_REQUEST_FAILED");throw new Error(String(body.error||"The copy could not be verified.")+" ("+code+")");}
   const type=String(response.headers.get("content-type")||"").toLowerCase();
   if(!type.includes("application/pdf"))throw new Error("The recovery service returned an invalid file type. (COPY_RESPONSE_NOT_PDF)");
   const bytes=await response.arrayBuffer();
   if(!bytes.byteLength)throw new Error("The recovery service returned an empty PDF. (COPY_RESPONSE_EMPTY)");
   const digest=await crypto.subtle.digest("SHA-256",bytes);
   const actualHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
   const headerHash=String(response.headers.get("x-irpa-document-sha256")||response.headers.get("x-irpa-output-sha256")||"").toLowerCase();
   if(!/^[a-f0-9]{64}$/.test(headerHash)||actualHash!==headerHash)throw new Error("The downloaded PDF failed SHA-256 verification. (HASH_MISMATCH)");
   setCopyHash(actualHash);setCopyMatch("MATCH");
   const stageHeader=response.headers.get("x-irpa-stage-log");if(stageHeader){try{setCopyStages(JSON.parse(stageHeader));}catch{setCopyStages([{stageCode:"STAGE_LOG",status:"FAILED",failureCode:"UNKNOWN"}]);}}
   const source=String(response.headers.get("x-irpa-copy-source")||sourceFallback||"unknown");
   setCopySource(source==="emergency-build"?"Emergency build":source==="preserved-copy"?"Preserved copy":"Unknown source");
   setCopyLabel(String(response.headers.get("x-irpa-copy-label")||"Unarchived copy; the envelope is not yet Completed"));
   const blob=new Blob([bytes],{type:"application/pdf"}),url=URL.createObjectURL(blob),a=document.createElement("a");
   a.href=url;a.download=source==="emergency-build"&&String(response.headers.get("x-irpa-copy-label")||"").startsWith("UNARCHIVED COPY.")?"UNARCHIVED-COPY-CERTIFICATE-NOT-VERIFIED.pdf":source==="emergency-build"?"EMERGENCY-RETRIEVAL-COPY-NOT-ARCHIVED.pdf":"unarchived-completed-copy.pdf";a.click();URL.revokeObjectURL(url);
  }catch(err){setCopyError(err?.message||"The copy could not be downloaded. (COPY_DOWNLOAD_FAILED)");}
  finally{setCopyLoading(false);}
 }
 async function downloadUnarchivedCopy(){
  return downloadRecoveryPdf("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/completed-copy.pdf",{button:"Download completed copy",sourceFallback:"preserved-copy"});
 }
 async function downloadEmergencyCopy(){
  return downloadRecoveryPdf("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/emergency-retrieval",{method:"POST",button:"Download emergency copy",sourceFallback:"emergency-build"});
 }
 async function loadPreview(){
  setPreviewLoading(true);setPreviewReason("");
  try{const blob=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/preview.pdf",{pdf:true,button:"Generate watermarked preview"});setPreviewUrl(current=>{if(current)URL.revokeObjectURL(current);return URL.createObjectURL(blob)});}
  catch(err){setPreviewReason(err?.message||"Preview is not available. (PREVIEW_UNAVAILABLE)");}
  finally{setPreviewLoading(false);}
 }
 async function downloadEvidenceReportPdf(){
  const pdf=await PDFDocument.create();
  pdf.setTitle("IRPA Signature Recovery Evidence Report");
  pdf.setSubject("Read-only recovery evidence assessment; not a completion certificate.");
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const lines=[];
  if(copyLabel.startsWith("UNARCHIVED COPY."))lines.push(copyLabel);
  lines.push("IRPA SIGNATURE RECOVERY EVIDENCE REPORT");
  lines.push("Document: "+(item?.title||evidence?.title||"Untitled document"));
  lines.push("Reference: "+(item?.documentId||evidence?.envelopeId||"Not recorded"));
  lines.push("Envelope: "+(envelopeId||"Not recorded"));
  lines.push("Envelope status: "+(evidence?.status||item?.status||"Unknown")+" — NOT Completed");
  lines.push("Audit-chain result: "+(evidence?.auditChain?.status||"NOT RETRIEVED"));
  lines.push("Source hash result: "+(evidence?.sourceHashStatus||"NOT RETRIEVED"));
  lines.push("Source SHA-256: "+(evidence?.sourceHash||"Not returned"));
  lines.push("Copy SHA-256: "+(copyHash||"Not downloaded in this session"));
  lines.push("Stamp verification:");
  for(const stamp of evidence?.stampSlots||[])lines.push("Page "+(stamp.page||"unknown")+" · Field "+(stamp.fieldId||"unknown")+" · "+(stamp.resultStatus==="PASS"||stamp.status==="VERIFIED_EXISTING"?"PASS":"FAILED"));
  lines.push("Signer evidence (masked addresses; timestamps EAT):");
  for(const signer of evidence?.signerSummary||[])lines.push((signer.name||"Signer")+" · "+(signer.maskedAddress||"Not recorded")+" · "+(signer.signedAt||"Not recorded"));
  lines.push("Environment recorded on envelope: "+(evidence?.environmentDiagnostics?.envelope||"NOT RETRIEVED"));
  lines.push("Environment recorded on preserved copy: "+(evidence?.environmentDiagnostics?.preservedCopy||"NOT RETRIEVED"));
  lines.push("Worker environment: "+(evidence?.environmentDiagnostics?.gatewayExpected||"NOT RETRIEVED"));
  lines.push("Copy verification steps:");
  for(const step of copyStages)lines.push((step.stageCode||"UNKNOWN")+" · "+(step.status||"UNKNOWN")+" · "+(step.failureCode||""));
  lines.push("No envelope, signer, signature, audit-chain, certificate, archive or other record was modified.");
  let page=pdf.addPage([612,792]),y=752;
  for(const line of lines){
   const chunks=String(line).match(/.{1,92}(?:\s|$)/g)||[String(line)];
   for(const chunk of chunks){if(y<42){page=pdf.addPage([612,792]);y=752;}page.drawText(chunk.trim(),{x:42,y,size:line===lines[0]&&copyLabel.startsWith("UNARCHIVED COPY.")?9:8,font:line===lines[0]||line==="IRPA SIGNATURE RECOVERY EVIDENCE REPORT"?bold:regular});y-=12;}
  }
  const bytes=await pdf.save({useObjectStreams:false}),blob=new Blob([bytes],{type:"application/pdf"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="IRPA-Signature-Recovery-Evidence-Report.pdf";a.click();URL.revokeObjectURL(url);
 }
 async function copy(text,label){try{await navigator.clipboard.writeText(text);setNotice(label+" copied. (REPORT_COPIED)");}catch{setNotice("Copy is unavailable in this browser. Select and copy the report text manually. (COPY_UNAVAILABLE)");}}
 function download(text,name){const blob=new Blob([text],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 const report=evidence?reportText(item,evidence):"",dryRun=diagnosticText(diagnostic);
 const canDiagnose=["CompletionFailed","Completing","Completed"].includes(item?.status||evidence?.status);
 const canPreview=(item?.status||evidence?.status)==="CompletionFailed"&&evidence?.auditChain?.status==="VERIFIED"&&evidence?.sourceHashStatus==="VERIFIED";
 return <section className="panel signature-recovery-owner-panel" aria-label="Read-only signature recovery evidence" style={{marginTop:14,padding:14,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:10}}>
  <h3>Evidence assessment / Tathmini ya ushahidi</h3>
  {loading&&<p role="status">Checking evidence… / Inakagua ushahidi…</p>}{error&&<p role="alert">{error}</p>}
  {evidence&&<><p><strong>Audit chain:</strong> {evidence.auditChain?.status||"NOT_RETRIEVED"} ({evidence.auditChain?.code||"NOT_RETRIEVED"})</p><p><strong>Source hash:</strong> {evidence.sourceHashStatus||"NOT_RETRIEVED"} ({evidence.sourceHashCode||"NOT_RETRIEVED"}) — {evidence.sourceHashReason||"Not recorded"}</p><p><strong>Finalisation stage:</strong> {evidence.finalisationStage||"NOT_RECORDED"} ({evidence.finalisationStageCode||"NOT_RECORDED"})</p>
   <h4>Signature stamps / Mihuri ya saini</h4>{(evidence.stampSlots||[]).length===0?<p>No signature or initials fields were returned. (STAMP_FIELDS_NONE)</p>:<div style={{display:"grid",gap:8}}>{evidence.stampSlots.map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}><strong>{row.resultStatus||row.status||"UNVERIFIABLE"}</strong> — Page {row.page||"unknown"}, field {row.fieldId||"unknown"}<div style={{fontSize:13}}>{row.reason} ({row.code})</div></div>)}</div>}
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>{canDiagnose?<button type="button" onClick={diagnose} disabled={diagnosticLoading}>{diagnosticLoading?"Diagnosing…":"Diagnose finalisation (read-only)"}</button>:<span className="muted">Dry-run diagnosis is not supported for this envelope status.</span>}<button type="button" onClick={()=>copy(report,"Assessment report")}>Copy assessment</button><button type="button" onClick={downloadEvidenceReportPdf}>Download evidence report (PDF)</button><button type="button" onClick={downloadUnarchivedCopy} disabled={copyLoading}>{copyLoading?"Preparing copy…":"Download completed copy"}</button>{(item?.status||evidence?.status)==="CompletionFailed"&&<button type="button" onClick={downloadEmergencyCopy} disabled={copyLoading}>{copyLoading?"Preparing copy…":"Download emergency copy"}</button>}<button type="button" onClick={loadPreview} disabled={!canPreview||previewLoading}>{previewLoading?"Preparing preview…":"Generate watermarked preview"}</button></div>
   {copyError&&<p role="alert">Copy unavailable. {copyError}</p>}{copyLabel&&<p role="status">{copyLabel}</p>}{copySource&&<p><strong>Served by:</strong> {copySource}</p>}{copyHash&&<p><strong>SHA-256:</strong> <code>{copyHash}</code> · <strong>{copyMatch}</strong> <button type="button" onClick={()=>copy(copyHash,"SHA-256 hash")}>Copy hash</button></p>}{copyStages.length>0&&<div aria-label="Emergency copy verification results"><strong>Copy verification / Uthibitishaji wa nakala</strong>{copyStages.map((step,index)=><p key={step.stageCode+index}>{step.stageCode}: {step.status}{step.failureCode?" ("+step.failureCode+")":""}</p>)}</div>}{evidence?.environmentDiagnostics&&<div><p>Environment recorded on envelope: {evidence.environmentDiagnostics.envelope}</p><p>Environment recorded on preserved copy: {evidence.environmentDiagnostics.preservedCopy}</p><p>Worker environment: {evidence.environmentDiagnostics.gatewayExpected}</p></div>}{!canPreview&&<p className="muted">Preview is withheld unless the envelope is CompletionFailed and both the signing audit chain and original source hash are verified.</p>}
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
