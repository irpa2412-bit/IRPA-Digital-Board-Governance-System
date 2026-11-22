import React,{useEffect,useMemo,useState}from"react";
import{getIdToken}from"firebase/auth";
import{auth}from"../firebase/config";
import{getGoogleDriveGatewayUrl}from"../firebase/gatewayUrl";

async function recoveryRequest(path,{pdf=false}={}){
  if(!auth.currentUser)throw new Error("Sign in with your authorised IRPA account to assess this document.");
  const gateway=String(getGoogleDriveGatewayUrl()||"").replace(/\/$/,"");
  if(!gateway)throw new Error("The IRPA Gateway URL is not configured in this environment.");
  const token=await getIdToken(auth.currentUser);
  const response=await fetch(gateway+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:pdf?"application/pdf":"application/json"},cache:"no-store"});
  if(!response.ok){
    const result=pdf?{}:await response.json().catch(()=>({}));
    const error=new Error(result.error||("Assessment request failed (HTTP "+response.status+")."));
    error.status=response.status;throw error;
  }
  return pdf?response.blob():response.json();
}
const safeText=value=>typeof value==="string"?value:"";
function validateAssessment(value){
  if(!value||typeof value!=="object"||value.ok!==true||typeof value.envelopeId!=="string"||typeof value.auditChainValid!=="boolean"||!Array.isArray(value.stampSlots)||!value.summary||typeof value.summary!=="object")throw new Error("The Gateway returned an invalid assessment report. Refresh and contact the administrator if the problem continues.");
  const allowed=new Set(["PASS","FAILED","MISSING","UNVERIFIABLE"]);
  const stampSlots=value.stampSlots.map((row,index)=>{
    if(!row||typeof row!=="object"||!allowed.has(row.status))throw new Error("The Gateway returned an invalid stamp assessment. The report was not displayed.");
    return{fieldId:safeText(row.fieldId)||"Unknown",fieldNumber:Number.isInteger(Number(row.fieldNumber))?Number(row.fieldNumber):index+1,page:Number.isInteger(Number(row.page))?Number(row.page):1,status:row.status,reason:safeText(row.reason)||"No reason supplied."};
  });
  const sourceHashValid=typeof value.sourceHashValid==="boolean"?value.sourceHashValid:null;
  const completionFailure=value.completionFailure&&typeof value.completionFailure==="object"?value.completionFailure:{};
  return{envelopeId:value.envelopeId,envelopeStatus:safeText(value.envelopeStatus)||"Unknown",documentTitle:safeText(value.documentTitle),auditChainValid:value.auditChainValid,sourceHash:safeText(value.sourceHash),sourceHashValid,sourceHashReason:safeText(value.sourceHashReason),completionFailure:{stage:safeText(completionFailure.stage)||"NOT_RECORDED",errorCode:safeText(completionFailure.errorCode)||"NOT_RECORDED",failedAt:safeText(completionFailure.failedAt)},stampSlots,summary:value.summary};
}
function stampLabel(status){return status;}
function buildBilingualReport(evidence,title){
  const failed=evidence.stampSlots.filter(row=>row.status==="FAILED"||row.status==="MISSING"||row.status==="UNVERIFIABLE");
  const stage=evidence.completionFailure.stage,code=evidence.completionFailure.errorCode;
  const happenedEn=evidence.envelopeStatus==="CompletionFailed"?`Envelope completion failed at ${stage} (code ${code}).`:`Envelope status is ${evidence.envelopeStatus}. Signing or document processing may still be in progress.`;
  const happenedSw=evidence.envelopeStatus==="CompletionFailed"?`Ukamilishaji wa bahasha umeshindwa katika hatua ya ${stage} (msimbo ${code}).`:`Hali ya bahasha ni ${evidence.envelopeStatus}. Mchakato wa kusaini au kuchakata hati unaweza kuwa unaendelea.`;
  const fineEn=`Audit chain: ${evidence.auditChainValid?"PASS":"FAILED"}. Source document hash: ${evidence.sourceHashValid===true?"PASS":evidence.sourceHashValid===false?"FAILED":"UNVERIFIABLE"}. Verified stamps: ${evidence.stampSlots.filter(row=>row.status==="PASS").length}.`;
  const fineSw=`Mnyororo wa ukaguzi: ${evidence.auditChainValid?"UMEPITA":"UMESHINDWA"}. Hashi ya hati chanzo: ${evidence.sourceHashValid===true?"IMEPITA":evidence.sourceHashValid===false?"IMESHINDWA":"HAIJAWEZA KUTHIBITISHWA"}. Mihuri iliyothibitishwa: ${evidence.stampSlots.filter(row=>row.status==="PASS").length}.`;
  const needsEn=failed.length?failed.map(row=>`Page ${row.page}, field ${row.fieldNumber} (${row.fieldId}): ${row.status} — ${row.reason}`).join("\n"):"No failed, missing or unverifiable stamp slots were reported.";
  const needsSw=failed.length?failed.map(row=>`Ukurasa ${row.page}, sehemu ${row.fieldNumber} (${row.fieldId}): ${row.status} — ${row.reason}`).join("\n"):"Hakuna sehemu ya muhuri iliyoshindwa, kukosekana au kutothibitishika iliyobainishwa.";
  const nextEn="Do not retry signing or mark this envelope completed. Contact the IRPA administrator with this report for the next controlled step.";
  const nextSw="Usirudie kusaini wala kuweka bahasha kuwa imekamilika. Wasiliana na msimamizi wa IRPA ukiambatanisha ripoti hii ili kupata hatua inayofuata iliyoidhinishwa.";
  return[
    `IRPA SIGNATURE ASSESSMENT — ${title||evidence.documentTitle||"Untitled document"}`,
    `Envelope status: ${evidence.envelopeStatus}`,
    "",
    "WHAT HAPPENED / KILICHOTOKEA",
    happenedEn, happenedSw,
    "",
    "WHAT IS FINE / KILICHO SAWA",
    fineEn, fineSw,
    evidence.sourceHash?`Source SHA-256: ${evidence.sourceHash}`:"Source SHA-256: NOT RETRIEVED",
    "",
    "WHAT NEEDS FIXING / KINACHOHITAJI KUREKEBISHWA",
    needsEn, needsSw,
    "",
    "WHAT YOU CAN DO NOW / UNACHOWEZA KUFANYA SASA",
    nextEn, nextSw
  ].join("\n");
}
class RecoveryErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={failed:false}}
  static getDerivedStateFromError(){return{failed:true}}
  componentDidCatch(error){console.error("Signature recovery report boundary:",error?.name||"Error")}
  render(){return this.state.failed?<section role="alert" className="panel"><strong>Recovery report unavailable / Ripoti ya tathmini haipatikani.</strong><p>Refresh the page or contact the administrator. / Onyesha upya ukurasa au wasiliana na msimamizi.</p></section>:this.props.children}
}
function Assessment({envelopeId,title,onClose}){
  const[evidence,setEvidence]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[copied,setCopied]=useState(false);
  const report=useMemo(()=>evidence?buildBilingualReport(evidence,title):"",[evidence,title]);
  useEffect(()=>{let active=true;(async()=>{setLoading(true);setError("");try{const result=await recoveryRequest("/api/recovery/envelopes/"+encodeURIComponent(envelopeId)+"/evidence");const validated=validateAssessment(result);if(active)setEvidence(validated)}catch(err){if(active)setError(err?.message||"Unable to assess this document.")}finally{if(active)setLoading(false)}})();return()=>{active=false}},[envelopeId]);
  async function copyReport(){try{await navigator.clipboard.writeText(report);setCopied(true)}catch{setError("Copy is unavailable in this browser. Select and copy the report text manually.")}}
  return <section className="panel signature-recovery-owner-panel" aria-labelledby="signature-recovery-heading" style={{margin:"14px 0",padding:18,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:12}}>
    <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
      <div><p style={{margin:"0 0 5px",fontSize:12,fontWeight:700,letterSpacing:".08em"}}>READ-ONLY · OWNER / ADMIN ASSESSMENT</p><h3 id="signature-recovery-heading" style={{margin:"0 0 6px"}}>Signature Recovery Assessment / Tathmini ya Saini</h3><p style={{margin:0}}>{title||"Document"} · No signing or completion action is available here.</p></div>
      {onClose&&<button type="button" className="secondary-button" onClick={onClose}>Close</button>}
    </div>
    {loading&&<p role="status">Checking access and evidence… / Inakagua ruhusa na ushahidi…</p>}
    {error&&<p role="alert" style={{color:"var(--danger,#b91c1c)"}}>{error}</p>}
    {evidence&&<div style={{marginTop:14}}>
      <div style={{display:"grid",gap:8,gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"}}>
        <div><strong>Audit chain / Mnyororo wa ukaguzi</strong><div>{evidence.auditChainValid?"PASS":"FAILED"}</div></div>
        <div><strong>Source hash / Hashi ya hati chanzo</strong><div>{evidence.sourceHashValid===true?"PASS":evidence.sourceHashValid===false?"FAILED":"UNVERIFIABLE"}</div></div>
        <div><strong>Finalisation stage / Hatua ya ukamilishaji</strong><div>{evidence.completionFailure.stage} · {evidence.completionFailure.errorCode}</div></div>
      </div>
      <h4>Stamp evidence / Ushahidi wa mihuri</h4>
      {evidence.stampSlots.length===0?<p>No signature or initials fields were found. / Hakuna sehemu za saini au herufi za mwanzo zilizopatikana.</p>:<div style={{display:"grid",gap:8}}>
        {evidence.stampSlots.map(row=><div key={row.fieldId} style={{border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,padding:10}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>Page {row.page} · Field {row.fieldNumber}</strong><strong>{stampLabel(row.status)}</strong></div>
          <div style={{fontSize:13,marginTop:4}}>{row.reason}</div>
        </div>)}
      </div>}
      <h4>Complete report / Ripoti kamili</h4>
      <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontFamily:"inherit",fontSize:13,padding:12,borderRadius:8,background:"var(--surface-muted,#f1f5f9)"}}>{report}</pre>
      <button type="button" onClick={copyReport}>{copied?"Copied / Imenakiliwa":"Copy report / Nakili ripoti"}</button>
      <p style={{fontSize:12,marginTop:10}}>Assessment is read-only. No signature image, token, signing link or full address is displayed. / Tathmini hii haisababishi mabadiliko. Picha za saini, tokeni, viungo vya kusaini au anwani kamili hazionyeshwi.</p>
    </div>}
  </section>;
}
export default function SignatureRecoveryOwnerPanel(props){
  if(!props?.envelopeId)return null;
  return <RecoveryErrorBoundary><Assessment {...props}/></RecoveryErrorBoundary>;
}
