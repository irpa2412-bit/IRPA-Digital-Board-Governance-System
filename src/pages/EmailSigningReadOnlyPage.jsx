import React,{useEffect,useRef,useState} from "react";
import {getGoogleDriveGatewayUrl} from "../firebase/gatewayUrl";

const NEUTRAL="This signing link is unavailable. Contact the document owner for a new invitation.";
const inputStyle={width:"100%",boxSizing:"border-box",padding:"10px",border:"1px solid #9ca3af",borderRadius:7,fontSize:15};
const buttonStyle={padding:"10px 14px",border:0,borderRadius:7,background:"#174a78",color:"#fff",fontWeight:600,cursor:"pointer"};

export default function EmailSigningReadOnlyPage({token}) {
  const [record,setRecord]=useState(null);
  const [pdfUrl,setPdfUrl]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const [success,setSuccess]=useState("");
  const [declarations,setDeclarations]=useState({name:"",occupation:"",capacity:""});
  const [fieldValues,setFieldValues]=useState({});
  const [selectedFieldId,setSelectedFieldId]=useState("");
  const [fieldApplications,setFieldApplications]=useState([]);
  const [signatureValue,setSignatureValue]=useState("");
  const [typedSignature,setTypedSignature]=useState("");
  const [consent,setConsent]=useState(false);
  const canvasRef=useRef(null);
  const drawingRef=useRef(false);

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
        const fields=Array.isArray(metadata.fields)?metadata.fields:[];
        setRecord({title:metadata.title||"Controlled document",ownerName:metadata.ownerName||"Document owner",expiresAt:metadata.linkExpiresAt||"",fields,canSign:metadata.canSign===true,ownerDeclaredParticulars:metadata.ownerDeclaredParticulars||{},signer:metadata.signer||{}});
        setDeclarations({name:metadata.ownerDeclaredParticulars?.name||metadata.signer?.name||"",occupation:"",capacity:""});
        setSelectedFieldId(fields[0]?.fieldId||"");
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

  const selectedField=(record?.fields||[]).find(field=>field.fieldId===selectedFieldId)||null;
  const signatureFields=(record?.fields||[]).filter(field=>["Signature","Initials"].includes(field.type));
  const setDeclaration=(key,value)=>setDeclarations(current=>({...current,[key]:value}));
  const selectedApplication=fieldApplications.find(item=>item.fieldId===selectedFieldId);

  function point(event){
    const canvas=canvasRef.current;
    const rect=canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*(canvas.width/rect.width),y:(event.clientY-rect.top)*(canvas.height/rect.height)};
  }
  function startDrawing(event){
    const canvas=canvasRef.current;if(!canvas)return;
    drawingRef.current=true;canvas.setPointerCapture?.(event.pointerId);
    const p=point(event),ctx=canvas.getContext("2d");ctx.beginPath();ctx.moveTo(p.x,p.y);
  }
  function draw(event){
    if(!drawingRef.current)return;
    const p=point(event),ctx=canvasRef.current?.getContext("2d");if(!ctx)return;
    ctx.lineWidth=2.4;ctx.lineCap="round";ctx.strokeStyle="#111827";ctx.lineTo(p.x,p.y);ctx.stroke();
  }
  function stopDrawing(){drawingRef.current=false;}
  function clearPad(){const c=canvasRef.current;if(c)c.getContext("2d").clearRect(0,0,c.width,c.height);setSignatureValue("");}
  function confirmField(){
    if(!selectedField)return;
    if(["Signature","Initials"].includes(selectedField.type)){
      const value=canvasRef.current?.toDataURL("image/png")||"";
      if(!value||value.length<100){setError("Draw your mark in the signing area before confirming this field.");return;}
      setSignatureValue(value);
      setFieldApplications(current=>[...current.filter(item=>item.fieldId!==selectedField.fieldId),{fieldId:selectedField.fieldId,page:selectedField.page,x:selectedField.x,y:selectedField.y,width:selectedField.width,height:selectedField.height,confirmed:true,value}]);
    }else{
      const value=fieldValues[selectedField.fieldId];
      if(value===undefined||String(value).trim()===""){setError("Complete this assigned field before confirming it.");return;}
      setFieldValues(current=>({...current,[selectedField.fieldId]:value}));
    }
    setError("");
    const next=(record?.fields||[]).find(field=>field.fieldId!==selectedField.fieldId&&!fieldApplications.some(item=>item.fieldId===field.fieldId));
    if(next)setSelectedFieldId(next.fieldId);
  }
  async function submit(){
    if(!record?.canSign){setError("This assignment is not yet available for signing.");return;}
    if(!declarations.name.trim()||!declarations.occupation.trim()){setError("Enter your name and occupation/capacity for this document.");return;}
    if(!consent){setError("Confirm your consent to sign electronically.");return;}
    const unconfirmed=signatureFields.filter(field=>field.required&&!fieldApplications.some(item=>item.fieldId===field.fieldId));
    if(unconfirmed.length){setSelectedFieldId(unconfirmed[0].fieldId);setError("Select and confirm each required signature field before submitting.");return;}
    setSubmitting(true);setError("");setSuccess("");
    try{
      const gateway=getGoogleDriveGatewayUrl();
      const signature=signatureValue?{type:"drawn",value:signatureValue}:{type:"typed",value:typedSignature.trim()||declarations.name.trim()};
      const response=await fetch(gateway+"/api/sign/submit",{method:"POST",headers:{"content-type":"application/json","x-signing-token":token},credentials:"omit",cache:"no-store",body:JSON.stringify({token,signature,fieldValues,fieldApplications,signatureConfirmed:true,declarations,consent:true})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.ok===false)throw new Error(result.error||"The signing action could not be completed.");
      if(result.completed===true){
        const pdf=await fetch(gateway+"/api/sign/pdf",{headers:{"x-signing-token":token},credentials:"omit",cache:"no-store"});
        if(!pdf.ok)throw new Error("Your signature was recorded, but the completed PDF is not yet available.");
        const blob=await pdf.blob();const url=URL.createObjectURL(blob);setPdfUrl(current=>{if(current)URL.revokeObjectURL(current);return url;});
        setSuccess("Signing completed. The completed PDF is available below.");
      }else setSuccess("Your assigned action has been recorded. The workflow will continue according to its signing order.");
    }catch(e){setError(e?.message||"The signing action could not be completed.");}
    finally{setSubmitting(false);}
  }

  return <main style={{minHeight:"100vh",background:"#f3f4f6",color:"#111827",padding:"20px 12px",boxSizing:"border-box"}}>
    <section style={{maxWidth:1000,margin:"0 auto",background:"#fff",border:"1px solid #d1d5db",borderRadius:12,padding:16}}>
      <h1 style={{fontSize:20,margin:"0 0 10px"}}>IRPA — Secure document signing</h1>
      {loading&&<p role="status">Verifying secure link and loading the document…</p>}
      {error&&<p role="alert" style={{color:"#991b1b",background:"#fee2e2",padding:10,borderRadius:7}}>{error}</p>}
      {success&&<p role="status" style={{color:"#14532d",background:"#dcfce7",padding:10,borderRadius:7}}>{success}</p>}
      {record&&!error&&<><h2 style={{fontSize:17,margin:"8px 0"}}>{record.title}</h2><p style={{fontSize:13,margin:"4px 0"}}>Invited by: {record.ownerName}</p><p style={{fontSize:13,margin:"4px 0 14px"}}>Link expiry: {record.expiresAt?new Date(record.expiresAt).toLocaleString():"As stated in your invitation"}</p>
        {pdfUrl&&<iframe title="Controlled document preview" src={pdfUrl} sandbox="allow-same-origin" style={{display:"block",width:"100%",height:"55vh",border:"1px solid #9ca3af",background:"#fff"}}/>}
        <section style={{marginTop:18,borderTop:"1px solid #d1d5db",paddingTop:14}}>
          <h2 style={{fontSize:18}}>Your declaration for this document</h2>
          <p style={{fontSize:13,color:"#4b5563"}}>These are your transaction-specific declarations. They are recorded with the signing evidence; they are not checked against an IRPA authority register.</p>
          <label style={{display:"block",margin:"10px 0"}}>Full name<input style={inputStyle} value={declarations.name} onChange={e=>setDeclaration("name",e.target.value)} autoComplete="name"/></label>
          <label style={{display:"block",margin:"10px 0"}}>Occupation / capacity<input style={inputStyle} value={declarations.occupation} onChange={e=>setDeclaration("occupation",e.target.value)} placeholder="Enter your occupation or capacity"/></label>
          <label style={{display:"block",margin:"10px 0"}}>Additional capacity (optional)<input style={inputStyle} value={declarations.capacity} onChange={e=>setDeclaration("capacity",e.target.value)} placeholder="Additional official particulars"/></label>
        </section>
        {!!record.fields.length&&<section style={{marginTop:18,borderTop:"1px solid #d1d5db",paddingTop:14}}>
          <h2 style={{fontSize:18}}>Your assigned document fields</h2>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{record.fields.map(field=><button key={field.fieldId} type="button" onClick={()=>{setSelectedFieldId(field.fieldId);setError("");}} style={{...buttonStyle,background:selectedFieldId===field.fieldId?"#174a78":"#4b5563"}}>{field.type}: {field.placeholder||field.fieldId}{fieldApplications.some(item=>item.fieldId===field.fieldId)?" ✓":""}</button>)}</div>
          {selectedField&&<div style={{marginTop:14,padding:12,border:"1px solid #9ca3af",borderRadius:8}}>
            <h3 style={{fontSize:16,marginTop:0}}>Complete: {selectedField.placeholder||selectedField.type}</h3>
            {["Signature","Initials"].includes(selectedField.type)?<><p style={{fontSize:13}}>Draw your {selectedField.type.toLowerCase()} below, then confirm this assigned field.</p><canvas ref={canvasRef} width={520} height={180} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} style={{width:"100%",height:150,border:"1px solid #6b7280",borderRadius:6,touchAction:"none",background:"#fff"}}/><div style={{display:"flex",gap:8,marginTop:8}}><button type="button" onClick={clearPad} style={{...buttonStyle,background:"#6b7280"}}>Clear</button><button type="button" onClick={confirmField} style={buttonStyle}>Confirm assigned field</button></div></>:<><label style={{display:"block",margin:"8px 0"}}>{selectedField.type}{selectedField.required?" (required)":""}{selectedField.type==="Checkbox"?<input type="checkbox" checked={fieldValues[selectedField.fieldId]==="true"} onChange={e=>setFieldValues(current=>({...current,[selectedField.fieldId]:e.target.checked?"true":"false"}))}/>:<input style={inputStyle} type={selectedField.type==="Date"?"date":"text"} value={fieldValues[selectedField.fieldId]||""} onChange={e=>setFieldValues(current=>({...current,[selectedField.fieldId]:e.target.value}))} placeholder={selectedField.placeholder||"Enter your response"}/>}</label><button type="button" onClick={confirmField} style={buttonStyle}>Confirm assigned field</button></>}
          </div>}
        </section>}
        {!signatureFields.length&&<label style={{display:"block",margin:"14px 0"}}>Typed signature<input style={inputStyle} value={typedSignature} onChange={e=>setTypedSignature(e.target.value)} placeholder="Type your full name as your signature"/></label>}
        <label style={{display:"flex",gap:9,alignItems:"flex-start",margin:"18px 0"}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I have reviewed this document and consent to apply my electronic signature to my assigned action.</span></label>
        {!record.canSign&&<p role="status">Your assignment is waiting for the preceding action in the signing sequence.</p>}
        <button type="button" disabled={submitting||!record.canSign} onClick={submit} style={{...buttonStyle,opacity:submitting||!record.canSign?.55:1}}>{submitting?"Submitting…":"Confirm and submit my assigned action"}</button>
      </>}
    </section>
  </main>;
}
