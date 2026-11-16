import React,{useEffect,useState} from "react";
import {getGoogleDriveGatewayUrl} from "../firebase/signaturePlatform";

const NEUTRAL="This signing link is unavailable. Contact the document owner for a new invitation.";

export default function EmailSigningReadOnlyPage({token}) {
  const [record,setRecord]=useState(null);
  const [pdfUrl,setPdfUrl]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let cancelled=false,objectUrl="";
    if(!token){setError(NEUTRAL);setLoading(false);return;}
    try{window.history.replaceState({},document.title,window.location.pathname+window.location.hash);}catch{}
    (async()=>{
      try{
        const gateway=getGoogleDriveGatewayUrl();
        if(!gateway)throw new Error(NEUTRAL);
        const headers={"x-signing-token":token,Accept:"application/json"};
        const opened=await fetch(gateway+"/api/sign/email/open",{method:"GET",headers,cache:"no-store",credentials:"omit"});
        const metadata=await opened.json().catch(()=>({}));
        if(!opened.ok||metadata.ok!==true)throw new Error(NEUTRAL);
        if(cancelled)return;
        setRecord({title:metadata.title||"Controlled document",ownerName:metadata.ownerName||"IRPA Document Owner",expiresAt:metadata.linkExpiresAt||""});
        const pdf=await fetch(gateway+"/api/sign/email/pdf",{method:"GET",headers:{"x-signing-token":token},cache:"no-store",credentials:"omit"});
        if(!pdf.ok)throw new Error(NEUTRAL);
        const blob=await pdf.blob();
        if(blob.type!=="application/pdf"||cancelled)throw new Error(NEUTRAL);
        objectUrl=URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      }catch{if(!cancelled)setError(NEUTRAL);}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[token]);
  return <main style={{minHeight:"100vh",background:"#f3f4f6",color:"#111827",padding:"20px 12px",boxSizing:"border-box"}}>
    <section style={{maxWidth:1000,margin:"0 auto",background:"#fff",border:"1px solid #d1d5db",borderRadius:12,padding:16}}>
      <h1 style={{fontSize:20,margin:"0 0 10px"}}>IRPA — Secure document preview</h1>
      {loading&&<p role="status">Verifying secure link and loading the document…</p>}
      {error&&<p role="alert">{error}</p>}
      {record&&!error&&<><h2 style={{fontSize:17,margin:"8px 0"}}>{record.title}</h2><p style={{fontSize:13,margin:"4px 0"}}>Invited by: {record.ownerName}</p><p style={{fontSize:13,margin:"4px 0 14px"}}>Link expiry: {record.expiresAt?new Date(record.expiresAt).toLocaleString():"7 days after issue"}</p>{pdfUrl&&<iframe title="Read-only controlled document" src={pdfUrl} sandbox="allow-same-origin" style={{display:"block",width:"100%",height:"78vh",border:"1px solid #9ca3af",background:"#fff"}}/>}</>}
    </section>
  </main>;
}
