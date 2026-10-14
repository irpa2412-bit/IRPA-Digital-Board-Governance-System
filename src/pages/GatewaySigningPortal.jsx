import React,{useEffect,useState}from"react";
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
  const[opened,setOpened]=useState(null),[profile,setProfile]=useState(null),[authorityIdentity,setAuthorityIdentity]=useState(null),[manualAuthority,setManualAuthority]=useState(""),[signaturePng,setSignaturePng]=useState(""),[initialsPng,setInitialsPng]=useState("");
  const[values,setValues]=useState({}),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[pdfUrl,setPdfUrl]=useState(""),[status,setStatus]=useState(null),[evidence,setEvidence]=useState(null);
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
    const [sig,initials]=await Promise.all([
      savedProfile?.status==="Active"&&savedProfile.signatureUrl?pngDataUrl(savedProfile.signatureUrl):Promise.resolve(""),
      savedProfile?.status==="Active"&&savedProfile.initialsUrl?pngDataUrl(savedProfile.initialsUrl).catch(()=> ""):Promise.resolve("")
    ]);
    if(signingRequired&&!sig)throw new Error("The saved Signature Profile specimen could not be prepared for signing.");
    const gatewayStatus=await fetchGatewaySigningResource("/api/sign/status",token);
    let initialEvidence=null;
    if(gatewayStatus.status==="Completed")initialEvidence=await fetchGatewaySigningResource("/api/sign/evidence",token);
    const nextValues={};
    for(const field of result.fields||[]){
      if(field.type==="Signature")nextValues[field.fieldId]=sig;
      else if(field.type==="Initials"&&initials)nextValues[field.fieldId]=initials;
      else if(field.type==="Name")nextValues[field.fieldId]=savedProfile.displayName||result.signer?.name||"";
      else if(field.type==="Date")nextValues[field.fieldId]=new Date().toISOString().slice(0,10);
      else if(field.type==="Checkbox")nextValues[field.fieldId]="";
      else nextValues[field.fieldId]="";
    }
    const pdfBytes=await fetchGatewaySigningResource("/api/sign/pdf",token,{pdf:true});
    if(gatewayStatus.status==="Completed"){const verification=await verifyGatewaySignedPdf({token,bytes:pdfBytes});if(verification.documentHash!==gatewayStatus.completion?.finalHash)throw new Error("Completed PDF hash does not match the Gateway completion record.");}
    objectUrl=URL.createObjectURL(new Blob([pdfBytes],{type:"application/pdf"}));
    if(!cancelled){setOpened(result);setProfile(savedProfile);setAuthorityIdentity(identity);setSignaturePng(sig);setInitialsPng(initials);setValues(nextValues);setPdfUrl(objectUrl);setStatus(gatewayStatus);setEvidence(initialEvidence);if(gatewayStatus.externalReference&&gatewayStatus.auditChainValid===true){try{await syncGatewaySigningMirror(gatewayStatus.externalReference,gatewayStatus)}catch(syncError){console.warn("Gateway status loaded; Signature Portal mirror reconciliation is pending.",syncError)}}}
  }catch(error){if(!cancelled)setMessage(error?.message||"Unable to load the Gateway signing transaction.");}finally{if(!cancelled)setLoading(false)}})();return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[token]);
  async function refreshStatus(){
    const next=await fetchGatewaySigningResource("/api/sign/status",token);
    setStatus(next);
    if(next.status==="Completed"){
      const completedBytes=await fetchGatewaySigningResource("/api/sign/pdf",token,{pdf:true});
      const verification=await verifyGatewaySignedPdf({token,bytes:completedBytes});
      if(verification.documentHash!==next.completion?.finalHash)throw new Error("Completed PDF hash does not match the Gateway completion record.");
      const found=await fetchGatewaySigningResource("/api/sign/evidence",token);
      if(found.auditChainValid!==true||found.documentHash!==next.completion?.finalHash||!Array.isArray(found.evidence)||found.evidence.length===0)throw new Error("Persisted cryptographic evidence does not match the completed PDF and audit chain.");
      setEvidence(found);
      setMessage("Signing completed. The Gateway returned persisted cryptographic evidence and verified the audit chain.");
    }
    if(next.externalReference&&next.auditChainValid===true){
      try{await syncGatewaySigningMirror(next.externalReference,next)}catch(error){console.warn("Gateway signing status is valid but Signature Portal mirror sync needs reconciliation.",error);}
    }
    return next;
  }
  async function signNow(){
    if(busy)return;setBusy(true);setMessage("");
    try{
      if(!opened?.canSign)throw new Error("This envelope is not currently assigned to you for signing.");
      if(!profile||profile.status!=="Active"||!signaturePng)throw new Error("An active Signature Profile is required.");
      for(const field of opened.fields||[]){
        const value=values[field.fieldId];
        if(field.required&&(value==null||String(value).trim()===""))throw new Error("Complete the required "+String(field.type||"").toLowerCase()+" field.");
        if(field.type==="Initials"&&field.required&&!initialsPng)throw new Error("This document requires initials, but no initials specimen is saved in your Signature Profile.");
      }
      const verifiedAuthority=await verifyManualSigningAuthority(manualAuthority);
      if(!verifiedAuthority?.verified)throw new Error("The signing authority could not be verified.");
      const result=await submitGatewaySignature({token,signature:{type:"drawn",value:signaturePng},fieldValues:values,manualAuthorityIdentification:manualAuthority,consent});
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
      {pdfUrl&&<><iframe title="Gateway controlled signing PDF" src={pdfUrl} style={{width:"100%",height:"min(70vh,760px)",border:"1px solid var(--border)",borderRadius:8}}/><p><a href={pdfUrl} target="_blank" rel="noreferrer">Open PDF in a separate tab</a></p></>}
    </section>
    <section className="panel" style={{marginTop:16}}>
      <h2>Your assigned fields</h2>
      {fields.length===0?<p className="muted">No additional fields are assigned. Your saved Signature Profile will be recorded in the signed PDF and evidence.</p>:fields.map(field=><label key={field.fieldId} style={{display:"block",marginTop:12}}>
        <strong>{field.type}{field.required?" *":""}</strong>
        {field.type==="Signature"?<div className="stat-card" style={{marginTop:6}}>Saved Signature Profile will be applied to this field.</div>:
         field.type==="Initials"?<div className="stat-card" style={{marginTop:6}}>{initialsPng?"Saved initials specimen will be applied to this field.":"No initials specimen is saved."}</div>:
         field.type==="Checkbox"?<span style={{display:"flex",gap:8,alignItems:"center",marginTop:6}}><input type="checkbox" checked={values[field.fieldId]==="true"} onChange={e=>setValues(previous=>({...previous,[field.fieldId]:e.target.checked?"true":"false"}))}/><span>{field.placeholder||"Confirm this item"}</span></span>:
         <input style={{display:"block",width:"100%",marginTop:6}} value={values[field.fieldId]||""} type={field.type==="Number"?"number":"text"} placeholder={field.placeholder||("Enter "+String(field.type||"value").toLowerCase())} onChange={e=>setValues(previous=>({...previous,[field.fieldId]:e.target.value}))}/>
        }
      </label>)}
      <label style={{display:"block",marginTop:18}}><strong>Registered signing authority *</strong><input style={{display:"block",width:"100%",marginTop:6}} value={manualAuthority} onChange={e=>setManualAuthority(e.target.value)} placeholder="Enter the role/designation in your active IRPA Member or Employee Register"/><small className="muted">Current identity authority: {authorityIdentity?.authorityRole||"Not verified"}. The Gateway independently checks this declaration against the active Member/Employee Register.</small></label>
      <div style={{display:"flex",gap:10,alignItems:"flex-start",marginTop:18}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} id="gateway-signing-consent"/><label htmlFor="gateway-signing-consent">I consent to sign this controlled document electronically using my authenticated IRPA account and saved Signature Profile.</label></div>
      <button type="button" disabled={busy||!consent||!manualAuthority.trim()||!opened.canSign||status?.status==="Completed"} onClick={signNow} style={{marginTop:16}}>{busy?"Submitting authenticated signature…":status?.status==="Completed"?"Signing Completed":"Sign and Submit"}</button>
      {!opened.canSign&&status?.status!=="Completed"&&<p className="muted">This signing task is pending another authorized signer.</p>}
    </section>
    {status?.status==="Completed"&&<section className="panel" style={{marginTop:16}}><h2>Cryptographic evidence</h2><p>Completed PDF SHA-256: <code>{status.completion?.finalHash||"Unavailable"}</code></p><p>Audit chain: {status.auditChainValid===true?"Verified":"Not verified"}</p>{evidence?.evidence?.map(item=><article className="stat-card" key={item.evidenceId} style={{marginTop:8}}><strong>{item.evidenceId}</strong><p>Envelope: {item.envelopeId}</p><p>Signer UID: {item.signerUid}</p><p>Algorithm: {item.algorithm}</p><p>Document hash: <code>{item.documentHash}</code></p><p>Evidence status: {item.status}</p></article>)}</section>}
  </main>;
}
