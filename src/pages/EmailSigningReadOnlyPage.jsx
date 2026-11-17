import React,{useEffect,useRef,useState} from "react";
import {getGoogleDriveGatewayUrl} from "../firebase/gatewayUrl";
import {trimSignatureCanvas} from "../utils/signatureImageCanvas.mjs";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

const NEUTRAL="This signing link is unavailable. Contact the document owner for a new invitation.";
const inputStyle={width:"100%",boxSizing:"border-box",padding:10,border:"1px solid #9ca3af",borderRadius:7,fontSize:15};
const buttonStyle={padding:"10px 14px",border:0,borderRadius:7,background:"#174a78",color:"#fff",fontWeight:600,cursor:"pointer"};
const fieldColors={Signature:"#6d5dfc",Initials:"#7c3aed",Date:"#0891b2",Name:"#2563eb",Text:"#0f766e",Number:"#db2777",Comment:"#0284c7",Remarks:"#ea580c",Checkbox:"#b45309"};

export default function EmailSigningReadOnlyPage({token}){
 const [record,setRecord]=useState(null),[signingToken,setSigningToken]=useState("");
 const [pdfDocument,setPdfDocument]=useState(null),[pageCount,setPageCount]=useState(0),[pageNum,setPageNum]=useState(1);
 const [pageSize,setPageSize]=useState({width:760,height:980}),[viewerWidth,setViewerWidth]=useState(760),[pageRendered,setPageRendered]=useState(false);
 const [error,setError]=useState(""),[pageError,setPageError]=useState(""),[loading,setLoading]=useState(true);
 const [submitting,setSubmitting]=useState(false),[revoking,setRevoking]=useState(false),[success,setSuccess]=useState("");
 const [declarations,setDeclarations]=useState({name:"",occupation:"",capacity:""}),[fieldValues,setFieldValues]=useState({});
 const [selectedFieldId,setSelectedFieldId]=useState(""),[fieldApplications,setFieldApplications]=useState([]),[signatureMarks,setSignatureMarks]=useState({});
 const [typedSignature,setTypedSignature]=useState(""),[consent,setConsent]=useState(false),[reviewMode,setReviewMode]=useState(false);
 const [signingClosed,setSigningClosed]=useState(false),[revoked,setRevoked]=useState(false),[finalizationFailed,setFinalizationFailed]=useState(false),[completedDocument,setCompletedDocument]=useState(false);
 const pageCanvasRef=useRef(null),pageHostRef=useRef(null),signatureCanvasRef=useRef(null),drawingRef=useRef(false);

 useEffect(()=>{
  let cancelled=false,loadedPdf=null;
  if(!token){setError(NEUTRAL);setLoading(false);return;}
  const parts=String(token).split("."),sessionKey=parts.length===3?"irpaEmailSigningSession:"+parts[0]+"."+parts[1]:"";
  let activeToken=token;
  try{const saved=sessionKey?window.sessionStorage.getItem(sessionKey):"";if(saved)activeToken=saved;}catch{}
  (async()=>{
   try{
    const gateway=getGoogleDriveGatewayUrl();if(!gateway)throw new Error(NEUTRAL);
    const opened=await fetch(gateway+"/api/sign/email/open",{headers:{"x-signing-token":activeToken,Accept:"application/json"},cache:"no-store",credentials:"omit"});
    const metadata=await opened.json().catch(()=>({}));
    if(!opened.ok||metadata.ok!==true)throw new Error(NEUTRAL);
    if(cancelled)return;
    const session=String(metadata.sessionToken||activeToken);setSigningToken(session);
    try{if(sessionKey)window.sessionStorage.setItem(sessionKey,session);}catch{}
    const fields=Array.isArray(metadata.fields)?metadata.fields:[];
    setRecord({title:metadata.title||"Controlled document",ownerName:metadata.ownerName||"Document owner",expiresAt:metadata.linkExpiresAt||"",fields,canSign:metadata.canSign===true,ownerDeclaredParticulars:metadata.ownerDeclaredParticulars||{},signer:metadata.signer||{}});
    setDeclarations({name:metadata.ownerDeclaredParticulars?.name||metadata.signer?.name||"",occupation:"",capacity:""});
    setSelectedFieldId(fields[0]?.fieldId||"");
    const response=await fetch(gateway+"/api/sign/email/pdf",{headers:{"x-signing-token":session},cache:"no-store",credentials:"omit"});
    if(!response.ok)throw new Error("The controlled PDF could not be retrieved. Do not sign a document you cannot inspect.");
    if(!String(response.headers.get("content-type")||"").toLowerCase().includes("application/pdf"))throw new Error("The signing service did not return a PDF. Signing has been stopped.");
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(cancelled)return;
    if(bytes.length<5||String.fromCharCode(...bytes.subarray(0,5))!=="%PDF-")throw new Error("The controlled document response is not a valid PDF.");
    loadedPdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
    if(cancelled){await loadedPdf.destroy();return;}
    setPdfDocument(loadedPdf);setPageCount(loadedPdf.numPages);setPageNum(1);
   }catch(e){if(!cancelled)setError(e?.message||NEUTRAL);}
   finally{if(!cancelled)setLoading(false);}
  })();
  return()=>{cancelled=true;if(loadedPdf)loadedPdf.destroy().catch(()=>{});};
 },[token]);

 useEffect(()=>{
  if(!pdfDocument)return;
  const resize=()=>setViewerWidth(Math.max(280,Math.floor(pageHostRef.current?.clientWidth||760)-16));
  resize();window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);
 },[pdfDocument]);

 useEffect(()=>{
  let cancelled=false,task=null;setPageRendered(false);setPageError("");
  (async()=>{
   if(!pdfDocument||!pageCanvasRef.current)return;
   try{
    const page=await pdfDocument.getPage(pageNum),base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(1.5,Math.max(.4,viewerWidth/base.width))});
    const dpr=Math.max(1,Math.min(2,Number(window.devicePixelRatio)||1));
    const outputScale=Math.min(dpr,Math.sqrt(4000000/Math.max(1,viewport.width*viewport.height)));
    const canvas=pageCanvasRef.current,context=canvas.getContext("2d",{alpha:false});
    if(!context)throw new Error("This browser could not prepare the document preview canvas.");
    canvas.width=Math.max(1,Math.floor(viewport.width*outputScale));canvas.height=Math.max(1,Math.floor(viewport.height*outputScale));
    setPageSize({width:viewport.width,height:viewport.height});
    context.setTransform(1,0,0,1,0,0);context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
    task=page.render({canvasContext:context,viewport,transform:[outputScale,0,0,outputScale,0,0]});
    await task.promise;if(!cancelled)setPageRendered(true);
   }catch(e){if(!cancelled&&e?.name!=="RenderingCancelledException")setPageError(e?.message||"The PDF page could not be rendered.");}
  })();
  return()=>{cancelled=true;try{task?.cancel();}catch{}};
 },[pdfDocument,pageNum,viewerWidth]);

 useEffect(()=>{
  const canvas=signatureCanvasRef.current;if(!canvas)return;
  const ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  canvas.width=Math.round(520*ratio);canvas.height=Math.round(180*ratio);
  const context=canvas.getContext("2d");context.clearRect(0,0,canvas.width,canvas.height);
  const mark=signatureMarks[selectedFieldId];if(!mark)return;
  const image=new Image();image.onload=()=>{const scale=Math.min(canvas.width/image.width,canvas.height/image.height),w=image.width*scale,h=image.height*scale;context.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);};image.src=mark;
 },[selectedFieldId,signatureMarks,record]);

 const fields=record?.fields||[];
 const selectedField=fields.find(field=>field.fieldId===selectedFieldId)||null;
 const signatureFields=fields.filter(field=>["Signature","Initials"].includes(field.type));
 const signatureValue=signatureFields.map(field=>fieldApplications.find(item=>item.fieldId===field.fieldId)?.value).find(Boolean)||"";
 const pageFields=fields.filter(field=>Number(field.page||1)===pageNum);
 const applicationFor=id=>fieldApplications.find(item=>item.fieldId===id);
 const complete=field=>{
  if(["Signature","Initials"].includes(field.type))return Boolean(applicationFor(field.fieldId));
  const value=fieldValues[field.fieldId];
  if(field.type==="Checkbox")return field.required?value==="true":value!==undefined;
  return value!==undefined&&String(value).trim()!=="";
 };
 const incomplete=fields.filter(field=>field.required&&!complete(field));
 const canReview=Boolean(record)&&pageRendered;
 const setDeclaration=(key,value)=>setDeclarations(current=>({...current,[key]:value}));

 function canvasPoint(event){const canvas=signatureCanvasRef.current,rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*(canvas.width/rect.width),y:(event.clientY-rect.top)*(canvas.height/rect.height)};}
 function startDrawing(event){const canvas=signatureCanvasRef.current;if(!canvas||signingClosed)return;drawingRef.current=true;canvas.setPointerCapture?.(event.pointerId);const p=canvasPoint(event);const context=canvas.getContext("2d");context.beginPath();context.moveTo(p.x,p.y);}
 function draw(event){if(!drawingRef.current)return;const p=canvasPoint(event),context=signatureCanvasRef.current?.getContext("2d");if(!context)return;context.lineWidth=2.4*Math.max(1,Math.min(2,window.devicePixelRatio||1));context.lineCap="round";context.strokeStyle="#111827";context.lineTo(p.x,p.y);context.stroke();}
 function confirmField(){
  if(!selectedField||signingClosed)return;
  if(["Signature","Initials"].includes(selectedField.type)){
   let value="";try{value=trimSignatureCanvas(signatureCanvasRef.current,{padding:4}).dataUrl;}catch(e){setError(e?.message||"Draw your mark before applying it.");return;}
   if(!value||value.length<100){setError("Draw your mark before applying it.");return;}
   setSignatureMarks(current=>({...current,[selectedField.fieldId]:value}));
   setFieldApplications(current=>[...current.filter(item=>item.fieldId!==selectedField.fieldId),{fieldId:selectedField.fieldId,page:selectedField.page,x:selectedField.x,y:selectedField.y,width:selectedField.width,height:selectedField.height,confirmed:true,value}]);
  }else if(fieldValues[selectedField.fieldId]===undefined||String(fieldValues[selectedField.fieldId]).trim()===""){setError("Complete this assigned field before confirming it.");return;}
  setError("");
  const next=fields.find(field=>field.fieldId!==selectedField.fieldId&&!complete(field));
  if(next){setSelectedFieldId(next.fieldId);const targetPage=Number(next.page||1);if(targetPage!==pageNum){setPageRendered(false);setPageNum(targetPage);}}
 }
 function clearPad(){const canvas=signatureCanvasRef.current;if(canvas)canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);setSignatureMarks(current=>{const next={...current};delete next[selectedFieldId];return next;});setFieldApplications(current=>current.filter(item=>item.fieldId!==selectedFieldId));}
 function enterReview(){
  if(!record){setError("The signing assignment is unavailable.");return;}
  if(!pageRendered){setError("Wait for the current document page to finish rendering.");return;}
  setError("");setReviewMode(true);if(pageNum!==1){setPageRendered(false);setPageNum(1);}
 }
 async function submit(){
  if(!reviewMode){setError("Review the complete document and signature placement before submitting.");return;}
  if(!pageRendered){setError("Wait for the current document page to finish rendering.");return;}
  if(!record?.canSign){setError("This assignment is not yet available for signing.");return;}
  if(!declarations.name.trim()||!declarations.occupation.trim()){setError("Enter your name and occupation/capacity for this document.");return;}
  if(!consent){setError("Confirm your consent only after reviewing the document and signature placement.");return;}
  if(incomplete.length){setError("A required assigned field is incomplete.");return;}
  if(!signatureFields.length&&typedSignature.trim().length<2){setError("Enter your typed signature before submitting.");return;}
  setSubmitting(true);setError("");setSuccess("");
  const gateway=getGoogleDriveGatewayUrl(),activeToken=signingToken||token;
  const signature=signatureValue?{type:"drawn",value:signatureValue}:{type:"typed",value:typedSignature.trim()||declarations.name.trim()};
  try{
   const response=await fetch(gateway+"/api/sign/submit",{method:"POST",headers:{"content-type":"application/json","x-signing-token":activeToken},credentials:"omit",cache:"no-store",body:JSON.stringify({token:activeToken,signature,fieldValues,fieldApplications,signatureConfirmed:true,declarations,consent:true})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.ok===false)throw new Error(result.error||"The signing action could not be completed.");
   setSigningClosed(true);
   if(result.status==="CompletionFailed"){setFinalizationFailed(true);setSuccess("Your signature was recorded, but final PDF completion failed. The envelope is marked CompletionFailed. Do not submit again; contact the document owner for controlled recovery.");return;}
   if(result.completed===true){
    try{
     const finalResponse=await fetch(gateway+"/api/sign/pdf",{headers:{"x-signing-token":activeToken},credentials:"omit",cache:"no-store"});
     if(!finalResponse.ok)throw new Error("Completed PDF unavailable.");
     const finalBytes=new Uint8Array(await finalResponse.arrayBuffer());
     const finalDocument=await pdfjsLib.getDocument({data:finalBytes.slice()}).promise;
     setPdfDocument(current=>{if(current)current.destroy().catch(()=>{});return finalDocument;});
     setPageCount(finalDocument.numPages);setPageNum(1);setCompletedDocument(true);
     setSuccess("Submission completed. The final signed PDF is displayed below.");
    }catch{setSuccess("Your signature was recorded and the envelope was completed. Contact the document owner for the completed PDF.");}
   }else setSuccess("Your assigned action was submitted and recorded. The signing workflow will continue in its configured order.");
  }catch(e){setError(e?.message||"The signing action could not be completed.");}
  finally{setSubmitting(false);}
 }
 async function revoke(){
  if(!reviewMode||!record||record.signer?.status!=="Pending"||signingClosed)return;
  if(!window.confirm("Revoke this signing request? Your signature will not be submitted, and the envelope will be marked declined."))return;
  setRevoking(true);setError("");setSuccess("");
  try{
   const gateway=getGoogleDriveGatewayUrl(),activeToken=signingToken||token;
   const response=await fetch(gateway+"/api/sign/decline",{method:"POST",headers:{"content-type":"application/json","x-signing-token":activeToken},credentials:"omit",cache:"no-store",body:JSON.stringify({token:activeToken,reason:"Signer revoked the email-link signing request before submission."})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.ok===false)throw new Error(result.error||"The signing request could not be revoked.");
   setRevoked(true);setSigningClosed(true);setSuccess("Signing request revoked. No signature was submitted; this invitation can no longer be used.");
  }catch(e){setError(e?.message||"The signing request could not be revoked.");}
  finally{setRevoking(false);}
 }

 return <main style={{minHeight:"100vh",background:"#f3f4f6",color:"#111827",padding:"20px 12px",boxSizing:"border-box"}}>
  <section style={{maxWidth:1100,margin:"0 auto",background:"#fff",border:"1px solid #d1d5db",borderRadius:12,padding:16}}>
   <h1 style={{fontSize:20,margin:"0 0 10px"}}>IRPA — Secure document signing</h1>
   {loading&&<p role="status">Verifying the secure invitation and loading the complete controlled document…</p>}
   {error&&<p role="alert" style={{color:"#991b1b",background:"#fee2e2",padding:10,borderRadius:7}}>{error}</p>}
   {success&&<p role="status" style={{color:revoked||finalizationFailed?"#7f1d1d":"#14532d",background:revoked||finalizationFailed?"#fee2e2":"#dcfce7",padding:10,borderRadius:7}}>{success}</p>}
   {record&&!error&&<>
    <h2 style={{fontSize:17,margin:"8px 0"}}>{record.title}</h2><p style={{fontSize:13,margin:"4px 0"}}>Invited by: {record.ownerName}</p>
    <p style={{fontSize:13,margin:"4px 0 14px"}}>Link expiry: {record.expiresAt?new Date(record.expiresAt).toLocaleString():"As stated in your invitation"}</p>
    <section style={{border:"1px solid #9ca3af",borderRadius:8,padding:12,marginTop:12}}>
     <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}><div><h2 style={{fontSize:18,margin:"0 0 4px"}}>Complete document review</h2><p style={{fontSize:13,color:"#4b5563",margin:0}}>Read every page before deciding. Assigned signature and initials locations are marked directly on the document.</p></div><strong>Page {pageNum} of {pageCount||"…"}</strong></div>
     <div style={{display:"flex",gap:8,justifyContent:"center",margin:"12px 0",flexWrap:"wrap"}}>
      <button type="button" disabled={!pdfDocument||pageNum<=1} onClick={()=>{setPageRendered(false);setPageNum(n=>n-1);}} style={{...buttonStyle,opacity:(!pdfDocument||pageNum<=1)?0.45:1}}>Previous page</button>
      <span style={{fontSize:13,padding:10}}>Page {pageNum} / {pageCount}</span>
      <button type="button" disabled={!pdfDocument||pageNum>=pageCount} onClick={()=>{setPageRendered(false);setPageNum(n=>n+1);}} style={{...buttonStyle,opacity:(!pdfDocument||pageNum>=pageCount)?0.45:1}}>Next page</button>
     </div>
     <div ref={pageHostRef} style={{width:"100%",overflowX:"auto",padding:"4px 0"}}>
      <div style={{position:"relative",width:pageSize.width,maxWidth:"100%",aspectRatio:String(pageSize.width)+"/"+String(pageSize.height),margin:"0 auto",background:"#fff",boxShadow:"0 4px 20px rgba(0,0,0,.2)"}}>
       <canvas ref={pageCanvasRef} aria-label={"Document page "+pageNum} style={{display:"block",width:"100%",height:"auto"}}/>
       {!completedDocument&&pageFields.map(field=>{
        const application=applicationFor(field.fieldId),value=fieldValues[field.fieldId],color=fieldColors[field.type]||"#475569";
        const label=["Signature","Initials"].includes(field.type)?(application?"STAMP APPLIED":field.type.toUpperCase()+" — SIGN HERE"):field.type==="Checkbox"?(value==="true"?"✓ CHECKED":"☐ CHECKBOX"):(value?String(value):field.placeholder||field.type.toUpperCase()+" — COMPLETE");
        return <div key={field.fieldId} role="button" tabIndex={signingClosed?-1:0} aria-label={field.type+" field assigned to you, page "+pageNum} onClick={()=>{if(!signingClosed)setSelectedFieldId(field.fieldId);}} onKeyDown={event=>{if(!signingClosed&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setSelectedFieldId(field.fieldId);}}} style={{position:"absolute",left:String(field.x)+"%",top:String(field.y)+"%",width:String(field.width)+"%",height:String(field.height)+"%",boxSizing:"border-box",border:"2px "+(application||complete(field)?"solid":"dashed")+" "+color,background:application?"rgba(22,163,74,.16)":"rgba(255,251,235,.88)",borderRadius:4,zIndex:5,display:"flex",alignItems:"center",justifyContent:"center",padding:3,overflow:"hidden",cursor:signingClosed?"default":"pointer",outline:selectedFieldId===field.fieldId?"3px solid #111827":"none"}}>
         {application?<img src={application.value} alt={field.type+" stamp preview"} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>:<span style={{fontSize:"clamp(7px,1.5vw,12px)",fontWeight:800,color:"#111827",textAlign:"center",lineHeight:1.15,overflowWrap:"anywhere"}}>{label}</span>}
        </div>;
       })}
      </div>
     </div>
     {pageError&&<p role="alert" style={{color:"#991b1b",background:"#fee2e2",padding:10,borderRadius:6}}>This page could not be rendered: {pageError}. Do not submit until it is visible.</p>}
     {!pdfDocument&&!loading&&<p role="alert">The complete document is not available for review. Signing is disabled.</p>}
     <p style={{fontSize:12,color:"#4b5563",margin:"10px 0 0"}}>The PDF is delivered through the invited signer’s controlled Gateway session and is not published as a public file. The final signed PDF appends an IRPA signature-evidence certificate after the source document.</p>
    </section>
    <section style={{marginTop:18,borderTop:"1px solid #d1d5db",paddingTop:14}}>
     <h2 style={{fontSize:18}}>Your declaration for this document</h2>
     <p style={{fontSize:13,color:"#4b5563"}}>Opening this link confirms control of the invited email address; it does not independently verify your legal identity or authority to bind an organisation. Your transaction-specific declaration is recorded with the signing evidence, but is not checked against an IRPA authority register. Institutional authority must be established through the relevant organisation’s delegation or approval process.</p>
     <p style={{fontSize:13,background:"#f3f4f6",padding:10,borderRadius:7}}><strong>Owner-recorded particulars for this assignment:</strong> {record.ownerDeclaredParticulars?.name||"Not supplied"} · {record.ownerDeclaredParticulars?.occupation||record.ownerDeclaredParticulars?.capacity||"Occupation/capacity not supplied"}</p>
     <label style={{display:"block",margin:"10px 0"}}>Full name<input style={inputStyle} value={declarations.name} disabled={signingClosed} onChange={e=>setDeclaration("name",e.target.value)} autoComplete="name"/></label>
     <label style={{display:"block",margin:"10px 0"}}>Occupation / capacity<input style={inputStyle} value={declarations.occupation} disabled={signingClosed} onChange={e=>setDeclaration("occupation",e.target.value)} placeholder="Enter your occupation or capacity"/></label>
     <label style={{display:"block",margin:"10px 0"}}>Additional capacity (optional)<input style={inputStyle} value={declarations.capacity} disabled={signingClosed} onChange={e=>setDeclaration("capacity",e.target.value)} placeholder="Additional official particulars"/></label>
    </section>
    {!!fields.length&&<section style={{marginTop:18,borderTop:"1px solid #d1d5db",paddingTop:14}}>
     <h2 style={{fontSize:18}}>Your assigned fields</h2>
     <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{fields.map(field=><button key={field.fieldId} type="button" disabled={signingClosed} onClick={()=>{setSelectedFieldId(field.fieldId);const targetPage=Number(field.page||1);if(targetPage!==pageNum){setPageRendered(false);setPageNum(targetPage);}setError("");}} style={{...buttonStyle,background:selectedFieldId===field.fieldId?"#174a78":"#4b5563",opacity:signingClosed?0.7:1}}>{field.type} · Page {field.page}{complete(field)?" ✓":""}</button>)}</div>
     {selectedField&&<div style={{marginTop:14,padding:12,border:"1px solid #9ca3af",borderRadius:8}}>
      <h3 style={{fontSize:16,marginTop:0}}>Complete: {selectedField.placeholder||selectedField.type} · Page {selectedField.page}</h3>
      {["Signature","Initials"].includes(selectedField.type)?<><p style={{fontSize:13}}>Draw your {selectedField.type.toLowerCase()} below. Applying it places the stamp in the highlighted document location.</p><canvas ref={signatureCanvasRef} width={520} height={180} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={()=>{drawingRef.current=false;}} onPointerCancel={()=>{drawingRef.current=false;}} style={{width:"100%",height:150,border:"1px solid #6b7280",borderRadius:6,touchAction:"none",background:"#fff"}}/><div style={{display:"flex",gap:8,marginTop:8}}><button type="button" disabled={signingClosed} onClick={clearPad} style={{...buttonStyle,background:"#6b7280"}}>Clear mark</button><button type="button" disabled={signingClosed} onClick={confirmField} style={buttonStyle}>Apply stamp to document</button></div></>:<><label style={{display:"block",margin:"8px 0"}}>{selectedField.type}{selectedField.required?" (required)":""}{selectedField.type==="Checkbox"?<input type="checkbox" disabled={signingClosed} checked={fieldValues[selectedField.fieldId]==="true"} onChange={e=>setFieldValues(v=>({...v,[selectedField.fieldId]:e.target.checked?"true":"false"}))}/>:<input style={inputStyle} disabled={signingClosed} type={selectedField.type==="Date"?"date":"text"} value={fieldValues[selectedField.fieldId]||""} onChange={e=>setFieldValues(v=>({...v,[selectedField.fieldId]:e.target.value}))} placeholder={selectedField.placeholder||"Enter your response"}/>}</label><button type="button" disabled={signingClosed} onClick={confirmField} style={buttonStyle}>Confirm field value</button></>}
     </div>}
    </section>}
    {!signatureFields.length&&<label style={{display:"block",margin:"14px 0"}}>Typed signature<input style={inputStyle} disabled={signingClosed} value={typedSignature} onChange={e=>setTypedSignature(e.target.value)} placeholder="Type your full name as your signature"/></label>}
    <label style={{display:"flex",gap:9,alignItems:"flex-start",margin:"18px 0"}}><input type="checkbox" checked={consent} disabled={signingClosed} onChange={e=>setConsent(e.target.checked)}/><span>I have reviewed the complete document, understand its contents and the marked signature location(s), and consent to apply my electronic signature.</span></label>
    {!record.canSign&&<p role="status">Your assignment is waiting for the preceding action. You may review the document, but cannot submit yet.</p>}
    {!reviewMode&&!signingClosed&&<button type="button" disabled={!canReview||!pdfDocument||Boolean(pageError)} onClick={enterReview} style={{...buttonStyle,opacity:(!canReview||!pdfDocument||Boolean(pageError))?0.5:1}}>Review complete document and signature placement</button>}
    {reviewMode&&!signingClosed&&<section style={{marginTop:16,padding:12,border:"2px solid #174a78",borderRadius:8}}>
     <h2 style={{fontSize:18,marginTop:0}}>Final review — signature not yet submitted</h2>
     <p style={{fontSize:13}}>Navigate through every page above. Confirm that the complete document is correct and that each stamp appears at the intended location. Changes to assigned fields update this preview. Your signature has not been submitted yet.</p>
     {incomplete.length>0&&<p role="status" style={{fontSize:13,color:"#92400e"}}>{incomplete.length} required field(s) remain incomplete. Use the assigned-field controls above to complete them; the preview updates as you make changes. You may still revoke this request.</p>}
     <button type="button" disabled={submitting||!record.canSign||!pageRendered||incomplete.length>0||(!signatureFields.length&&typedSignature.trim().length<2)||!declarations.name.trim()||!declarations.occupation.trim()||!consent||Boolean(pageError)} onClick={submit} style={{...buttonStyle,background:"#166534",opacity:(submitting||!record.canSign||!pageRendered||incomplete.length>0||(!signatureFields.length&&typedSignature.trim().length<2)||!declarations.name.trim()||!declarations.occupation.trim()||!consent||Boolean(pageError))?0.5:1}}>{submitting?"Submitting…":"Submit"}</button>
     <button type="button" disabled={revoking||submitting||record.signer?.status!=="Pending"} onClick={revoke} style={{...buttonStyle,background:"#991b1b",marginLeft:8,opacity:(revoking||submitting)?0.5:1}}>{revoking?"Revoking…":"Revoke"}</button>
    </section>}
    {signingClosed&&!revoked&&<p role="status" style={{marginTop:14}}>This signing action is closed. No further submission is available through this invitation.</p>}
    {revoked&&<p role="status" style={{marginTop:14}}>The invitation is revoked and cannot be used again.</p>}
   </>}
  </section>
 </main>;
}
