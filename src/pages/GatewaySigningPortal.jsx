import React,{useEffect,useRef,useState}from"react";
import*as pdfjsLib from"pdfjs-dist";
import pdfWorker from"pdfjs-dist/build/pdf.worker.min.mjs?url";
import SignatureFieldConfirmationPad from"../components/SignatureFieldConfirmationPad";
pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;
import{getMySignatureProfile,verifyManualSigningAuthority,syncGatewaySigningMirror}from"../firebase/signaturePlatform";
import{getMySignerIdentity}from"../firebase/signerIdentity";
import{fetchGatewaySigningResource,submitGatewaySignature,verifyGatewaySignedPdf}from"../firebase/signatureStorage";

async function pngDataUrl(source){
  const value=String(source||"");
  if(!value.startsWith("data:image/"))throw new Error("An active Signature Profile image is required to sign this Gateway transaction.");
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("The saved Signature Profile image could not be loaded."));image.src=value});
  const scale=Math.min(1,700/(img.naturalWidth||img.width||700),300/(img.naturalHeight||img.height||300));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));canvas.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
  const context=canvas.getContext("2d");if(!context)throw new Error("Signature image processing is unavailable.");
  context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
  const result=canvas.toDataURL("image/png");
  if(result.length>140000)throw new Error("The signature specimen is too large for a safe signing request. Re-upload a smaller signature image in Signature Profile.");
  return result;
}

export default function GatewaySigningPortal({token}){
  const[opened,setOpened]=useState(null),[profile,setProfile]=useState(null),[authorityIdentity,setAuthorityIdentity]=useState(null),[manualAuthority,setManualAuthority]=useState("");
  const[values,setValues]=useState({}),[applications,setApplications]=useState({}),[signaturePad,setSignaturePad]=useState(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[pdfUrl,setPdfUrl]=useState(""),[status,setStatus]=useState(null),[evidence,setEvidence]=useState(null);
  const canvasRef=useRef(null),[pdfDocument,setPdfDocument]=useState(null),[pageNum,setPageNum]=useState(1),[pageSize,setPageSize]=useState({width:760,height:980});
  useEffect(()=>{let cancelled=false;let task=null;(async()=>{if(!pdfUrl){setPdfDocument(null);return}try{const response=await fetch(pdfUrl);const bytes=new Uint8Array(await response.arrayBuffer());task=pdfjsLib.getDocument({data:bytes});const doc=await task.promise;if(!cancelled){setPdfDocument(doc);setPageNum(1)}}catch(error){if(!cancelled)setMessage(error?.message||"Unable to render the signing PDF.")}})();return()=>{cancelled=true;task?.destroy?.()}},[pdfUrl]);
  useEffect(()=>{let cancelled=false;(async()=>{if(!pdfDocument||!canvasRef.current)return;try{const page=await pdfDocument.getPage(pageNum);const base=page.getViewport({scale:1});const scale=Math.max(.55,760/base.width);const viewport=page.getViewport({scale});const canvas=canvasRef.current;const dpr=window.devicePixelRatio||1;canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);canvas.style.width=viewport.width+"px";canvas.style.height=viewport.height+"px";setPageSize({width:viewport.width,height:viewport.height});const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);await page.render({canvasContext:ctx,viewport}).promise}catch(error){if(!cancelled)setMessage(error?.message||"Unable to render PDF page.")}})();return()=>{cancelled=true}},[pdfDocument,pageNum]);
  useEffect(()=>{let cancelled=false;let objectUrl="";(async()=>{setLoading(true);setMessage("");try{
    if(!token)throw new Error("The Gateway signing token is missing.");
    const [result,savedProfile,identity]=await Promise.all([
      fetchGatewaySigningResource("/api/sign/open",token),
      getMySignatureProfile().catch(()=>null),
      getMySignerIdentity().catch(()=>null)
    ]);
    if(!result.signer?.authenticated)throw new Error("Sign in with the invited IRPA account before continuing.");
    const signingRequired=Boolean(result.canSign&&result.status!=="Completed");
    if(signingRequired&&(!savedProfile||savedProfile.status!=="Active"||!savedProfile.signatureUrl))throw new Error("An active Signature Profile is required before signing this Gateway envelope.");
    if(signingRequired&&(!identity?.authorityRole||identity.authorityRole==="Not yet assigned"))throw new Error("Your current signing authority has not been registered. Update your Signer Identity capacity before signing.");
    if(signingRequired&&identity.authorityStatus!=="Current")throw new Error("Your signing authority is "+String(identity?.authorityStatus||"not verified")+". A Current authority is required to sign.");
    const gatewayStatus=await fetchGatewaySigningResource("/api/sign/status",token);
    let initialEvidence=null;
    if(gatewayStatus.status==="Completed"){
      initialEvidence=await fetchGatewaySigningResource("/api/sign/evidence",token);
      if(initialEvidence.auditChainValid!==true||initialEvidence.documentHash!==gatewayStatus.completion?.finalHash||!Array.isArray(initialEvidence.evidence)||initialEvidence.evidence.length===0)throw new Error("Persisted cryptographic evidence does not match the completed PDF and audit chain.");
    }
    const nextValues={};
    for(const field of result.fields||[]){
      if(field.type==="Name")nextValues[field.fieldId]=savedProfile?.displayName||result.signer?.name||"";
      else if(field.type==="Date")nextValues[field.fieldId]=new Date().toISOString().slice(0,10);
      else nextValues[field.fieldId]="";
    }
    const pdfBytes=await fetchGatewaySigningResource("/api/sign/pdf",token,{pdf:true});
    if(gatewayStatus.status==="Completed"){const verification=await verifyGatewaySignedPdf({token,bytes:pdfBytes});if(verification.documentHash!==gatewayStatus.completion?.finalHash)throw new Error("Completed PDF hash does not match the Gateway completion record.");}
    objectUrl=URL.createObjectURL(new Blob([pdfBytes],{type:"application/pdf"}));
    if(!cancelled){setOpened(result);setProfile(savedProfile);setAuthorityIdentity(identity);setValues(nextValues);setApplications({});setPageNum(1);setPdfUrl(objectUrl);setStatus(gatewayStatus);setEvidence(initialEvidence);if(gatewayStatus.externalReference&&gatewayStatus.auditChainValid===true){try{await syncGatewaySigningMirror(gatewayStatus.externalReference,gatewayStatus)}catch(syncError){console.warn("Gateway status loaded; Signature Portal mirror reconciliation is pending.",syncError)}}}
  }catch(error){if(!cancelled)setMessage(error?.message||"Unable to load the Gateway signing transaction.");}finally{if(!cancelled)setLoading(false)}})();return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[token]);
  async function refreshStatus(){
    const next=await fetchGatewaySigningResource("/api/sign/status",token);
    if(next.status==="Completed"){
      const completedBytes=await fetchGatewaySigningResource("/api/sign/pdf",token,{pdf:true});
      const verification=await verifyGatewaySignedPdf({token,bytes:completedBytes});
      if(verification.documentHash!==next.completion?.finalHash)throw new Error("Completed PDF hash does not match the Gateway completion record.");
      const found=await fetchGatewaySigningResource("/api/sign/evidence",token);
      if(found.auditChainValid!==true||found.documentHash!==next.completion?.finalHash||!Array.isArray(found.evidence)||found.evidence.length===0)throw new Error("Persisted cryptographic evidence does not match the completed PDF and audit chain.");
      setEvidence(found);
      setMessage("Signing completed. The Gateway returned persisted cryptographic evidence and verified the audit chain.");
    }
    setStatus(next);
    if(next.externalReference&&next.auditChainValid===true){
      try{await syncGatewaySigningMirror(next.externalReference,next)}catch(error){console.warn("Gateway signing status is valid but Signature Portal mirror sync needs reconciliation.",error);}
    }
    return next;
  }
  async function signNow(){
    if(busy)return;setBusy(true);setMessage("");
    try{
      if(!opened?.canSign)throw new Error("This envelope is not currently assigned to you for signing.");
      if(!profile||profile.status!=="Active")throw new Error("An active Signature Profile is required.");
      const signingFields=(opened.fields||[]).filter(field=>field.type==="Signature"||field.type==="Initials");
      for(const field of opened.fields||[]){
        const value=values[field.fieldId];
        if(field.required&&(field.type==="Signature"||field.type==="Initials")&&!applications[field.fieldId])throw new Error("Tap your assigned "+String(field.type).toLowerCase()+" field and confirm it before signing.");
        if(field.required&&!["Signature","Initials"].includes(field.type)&&(value==null||String(value).trim()===""))throw new Error("Complete the required "+String(field.type||"").toLowerCase()+" field.");
      }
      const confirmed=signingFields.map(field=>applications[field.fieldId]).filter(Boolean);
      if(signingFields.some(field=>field.required)&&!confirmed.length)throw new Error("No signature field has been explicitly confirmed.");
      const signatureValue=confirmed.find(application=>signingFields.find(field=>field.fieldId===application.fieldId)?.type==="Signature")?.value||confirmed[0]?.value;
      if(!signatureValue)throw new Error("Tap your assigned signature field and confirm a signature before submitting.");
      const verifiedAuthority=await verifyManualSigningAuthority(manualAuthority);
      if(!verifiedAuthority?.verified)throw new Error("The signing authority could not be verified.");
      const result=await submitGatewaySignature({token,signature:{type:"drawn",value:signatureValue},fieldValues:values,fieldApplications:confirmed,signatureConfirmed:true,manualAuthorityIdentification:manualAuthority,consent});
      const next=await refreshStatus();
      const pdfBytes=await fetchGatewaySigningResource("/api/sign/pdf",token,{pdf:true});
      const url=URL.createObjectURL(new Blob([pdfBytes],{type:"application/pdf"}));
      setPdfUrl(previous=>{if(previous)URL.revokeObjectURL(previous);return url});
      if(next.status!=="Completed")setMessage(result.status==="InProgress"?"Your signing action was accepted. The next authorized signer may now proceed.":"Your signing action was accepted and the Gateway status was refreshed.");
    }catch(error){setMessage(error?.message||"The Gateway did not complete the signing action.");}
    finally{setBusy(false)}
  }
  if(loading)return <main className="content-area" style={{padding:24}}><h1>IRPA Gateway Signing</h1><p>Verifying signer identity, envelope authorization and controlled PDF…</p></main>;
  if(!opened)return <main className="content-area" style={{padding:24,maxWidth:900,margin:"0 auto"}}><h1>Gateway Signing Unavailable</h1><p role="alert">{message||"The signing invitation could not be opened."}</p><p>Return to the IRPA Digital Governance workspace and confirm you are signed in with the invited account.</p></main>;
  const fields=opened.fields||[];
  return <main className="content-area" style={{padding:20,maxWidth:1240,margin:"0 auto",width:"100%"}}>
    <section className="welcome-panel"><div><span className="eyebrow">IRPA CRYPTOGRAPHIC SIGNING</span><h1>{opened.title||"Signing Invitation"}</h1><p>Authenticated Drive Gateway · Envelope {opened.envelopeId}</p></div><div className="identity-card"><span>Gateway status</span><strong>{status?.status||opened.status}</strong><small>{opened.signer?.name||profile?.displayName||"Authenticated signer"}</small></div></section>
    {message&&<div className="auth-message" role="status" style={{margin:"14px 0"}}>{message}</div>}
    <section className="panel" style={{marginTop:16}}>
      <h2>Controlled PDF</h2>
      <p className="muted">The Gateway validates the source PDF hash before signing and binds the completed PDF hash to persisted cryptographic evidence.</p>
      {pdfUrl&&<><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}><div>Page {pageNum} / {pdfDocument?.numPages||0}</div><div style={{display:"flex",gap:6}}><button type="button" className="secondary-button" disabled={!pdfDocument||pageNum<=1} onClick={()=>setPageNum(n=>n-1)}>Previous page</button><button type="button" className="secondary-button" disabled={!pdfDocument||pageNum>=(pdfDocument?.numPages||1)} onClick={()=>setPageNum(n=>n+1)}>Next page</button></div></div><div style={{position:"relative",width:pageSize.width,maxWidth:"100%",margin:"0 auto",overflow:"hidden",background:"#fff",boxShadow:"0 2px 16px rgba(0,0,0,.3)"}}><canvas ref={canvasRef} style={{display:"block",width:"100%"}}/>{fields.filter(field=>Number(field.page||1)===pageNum).map(field=>{const applied=applications[field.fieldId]?.value;const isSignature=field.type==="Signature"||field.type==="Initials";return <button key={field.fieldId} type="button" onClick={()=>isSignature?setSignaturePad(field):null} disabled={!isSignature} aria-label={isSignature?"Open "+field.type+" confirmation pad":"Assigned "+field.type+" field"} style={{position:"absolute",left:Number(field.x||0)+"%",top:Number(field.y||0)+"%",width:Number(field.width||20)+"%",height:Number(field.height||8)+"%",boxSizing:"border-box",border:"2px solid #16a34a",borderRadius:4,background:applied?"rgba(22,163,74,.12)":"rgba(255,255,255,.94)",color:"#14532d",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",cursor:isSignature?"pointer":"default"}}>{applied?<img src={applied} alt={"Confirmed "+field.type} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}>:<span>{field.type} · {field.required?"Required":"Optional"}<small style={{display:"block"}}>{isSignature?"Tap to sign":field.placeholder||"Assigned field"}</small></span>}</button>})}</div><p><a href={pdfUrl} target="_blank" rel="noreferrer">Open PDF in a separate tab</a></p></>}
    </section>
    <section className="panel" style={{marginTop:16}}>
      <h2>Your assigned fields</h2>
      {fields.length===0?<p className="muted">No additional fields are assigned. Your saved Signature Profile will be recorded in the signed PDF and evidence.</p>:fields.map(field=><label key={field.fieldId} style={{display:"block",marginTop:12}}>
        <strong>{field.type}{field.required?" *":""}</strong>
        {field.type==="Signature"||field.type==="Initials"?<button type="button" className="secondary-button" style={{display:"block",marginTop:6}} onClick={()=>setSignaturePad(field)}>{applications[field.fieldId]?"Confirmed — tap to change": "Tap to open "+field.type+" pad"} · Page {field.page||1}</button>:
         field.type==="Checkbox"?<span style={{display:"flex",gap:8,alignItems:"center",marginTop:6}}><input type="checkbox" checked={values[field.fieldId]==="true"} onChange={e=>setValues(previous=>({...previous,[field.fieldId]:e.target.checked?"true":"false"}))}/><span>{field.placeholder||"Confirm this item"}</span></span>:
         <input style={{display:"block",width:"100%",marginTop:6}} value={values[field.fieldId]||""} type={field.type==="Number"?"number":"text"} placeholder={field.placeholder||("Enter "+String(field.type||"value").toLowerCase())} onChange={e=>setValues(previous=>({...previous,[field.fieldId]:e.target.value}))}/>
        }
      </label>)}
      <label style={{display:"block",marginTop:18}}><strong>Registered signing authority *</strong><input style={{display:"block",width:"100%",marginTop:6}} value={manualAuthority} onChange={e=>setManualAuthority(e.target.value)} placeholder="Enter the role/designation in your active IRPA Member or Employee Register"/><small className="muted">Current identity authority: {authorityIdentity?.authorityRole||"Not verified"}. The Gateway independently checks this declaration against the active Member/Employee Register.</small></label>
      <div style={{display:"flex",gap:10,alignItems:"flex-start",marginTop:18}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} id="gateway-signing-consent"/><label htmlFor="gateway-signing-consent">I consent to sign this controlled document electronically. Each signature field must be confirmed separately before it is applied.</label></div>
      <button type="button" disabled={busy||!consent||!manualAuthority.trim()||!opened.canSign||status?.status==="Completed"} onClick={signNow} style={{marginTop:16}}>{busy?"Submitting authenticated signature…":status?.status==="Completed"?"Signing Completed":"Sign and Submit"}</button>
      {!opened.canSign&&status?.status!=="Completed"&&<p className="muted">This signing task is pending another authorized signer.</p>}
    </section>
    {status?.status==="Completed"&&<section className="panel" style={{marginTop:16}}><h2>Cryptographic evidence</h2><p>Completed PDF SHA-256: <code>{status.completion?.finalHash||"Unavailable"}</code></p><p>Audit chain: {status.auditChainValid===true?"Verified":"Not verified"}</p>{evidence?.evidence?.map(item=><article className="stat-card" key={item.evidenceId} style={{marginTop:8}}><strong>{item.evidenceId}</strong><p>Envelope: {item.envelopeId}</p><p>Signer UID: {item.signerUid}</p><p>Algorithm: {item.algorithm}</p><p>Document hash: <code>{item.documentHash}</code></p><p>Evidence status: {item.status}</p></article>)}</section>}
    {signaturePad&&<SignatureFieldConfirmationPad field={signaturePad} savedSignatureUrl={profile?.signatureUrl||""} savedInitialsUrl={profile?.initialsUrl||""} onCancel={()=>setSignaturePad(null)} onConfirm={async value=>{const field=signaturePad;const application={fieldId:field.fieldId,confirmed:true,page:Number(field.page||1),x:Number(field.x??0),y:Number(field.y??0),width:Number(field.width??24),height:Number(field.height??9),value};setApplications(previous=>({...previous,[field.fieldId]:application}));setValues(previous=>({...previous,[field.fieldId]:value}));setSignaturePad(null);setMessage(field.type+" confirmed for page "+application.page+". It will be applied only when you submit this signing action.");}}/>}
  </main>;
}
