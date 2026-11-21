import React,{useEffect,useRef,useState} from "react";
import {getGoogleDriveGatewayUrl} from "../firebase/gatewayUrl";
import {trimSignatureCanvas} from "../utils/signatureImageCanvas.mjs";
import {signatureFieldCss} from "../utils/signatureFieldCoordinates.mjs";
import SignatureFieldConfirmationPad from "../components/SignatureFieldConfirmationPad.jsx";
import {getMySignatureProfile} from "../firebase/signaturePlatform.js";
import {auth} from "../firebase/config.js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

const NEUTRAL="This signing link is unavailable. Contact the document owner for a new invitation.";
const inputStyle={width:"100%",boxSizing:"border-box",padding:10,border:"1px solid #9ca3af",borderRadius:7,fontSize:15};
const buttonStyle={padding:"10px 14px",border:0,borderRadius:7,background:"#174a78",color:"#fff",fontWeight:600,cursor:"pointer"};
const fieldColors={Signature:"#6d5dfc",Initials:"#7c3aed",Date:"#0891b2",Name:"#2563eb",Title:"#1d4ed8",Text:"#0f766e",Number:"#db2777",Comment:"#0284c7",Remarks:"#ea580c",Checkbox:"#b45309"};

export default function EmailSigningReadOnlyPage({token}){
 const [record,setRecord]=useState(null),[signingToken,setSigningToken]=useState(""),[sessionActive,setSessionActive]=useState(false),[sessionOpening,setSessionOpening]=useState(false),[activeRoleAssignmentIndex,setActiveRoleAssignmentIndex]=useState(0);
 const [pdfDocument,setPdfDocument]=useState(null),[pageCount,setPageCount]=useState(0),[pageNum,setPageNum]=useState(1);
 const [pageSize,setPageSize]=useState({width:760,height:980}),[viewerWidth,setViewerWidth]=useState(760),[pageRendered,setPageRendered]=useState(false);
 const [error,setError]=useState(""),[pageError,setPageError]=useState(""),[loading,setLoading]=useState(true);
 const [submitting,setSubmitting]=useState(false),[revoking,setRevoking]=useState(false),[success,setSuccess]=useState("");
 const [declarations,setDeclarations]=useState({name:"",occupation:"",capacity:""}),[fieldValues,setFieldValues]=useState({});
 const [selectedFieldId,setSelectedFieldId]=useState(""),[fieldApplications,setFieldApplications]=useState([]),[signatureMarks,setSignatureMarks]=useState({}),[savedProfile,setSavedProfile]=useState(null),[signaturePadField,setSignaturePadField]=useState(null);
 const [showSigningPane,setShowSigningPane]=useState(false);
 const [typedSignature,setTypedSignature]=useState(""),[consent,setConsent]=useState(false),[reviewMode,setReviewMode]=useState(false);
 const [signingClosed,setSigningClosed]=useState(false),[revoked,setRevoked]=useState(false),[finalizationFailed,setFinalizationFailed]=useState(false),[completedDocument,setCompletedDocument]=useState(false),[leftSession,setLeftSession]=useState(false),[copySent,setCopySent]=useState(false);
 const pageCanvasRef=useRef(null),pageHostRef=useRef(null),signatureCanvasRef=useRef(null),drawingRef=useRef(false);

 useEffect(()=>{
  let cancelled=false,loadedPdf=null;
  if(!token){setError(NEUTRAL);setLoading(false);return;}
  const activeToken=token;
  (async()=>{
   try{
    const gateway=getGoogleDriveGatewayUrl();if(!gateway)throw new Error(NEUTRAL);
    const opened=await fetch(gateway+"/api/sign/email/open",{headers:{"x-signing-token":activeToken,Accept:"application/json"},cache:"no-store",credentials:"omit"});
    const metadata=await opened.json().catch(()=>({}));
    if(!opened.ok||metadata.ok!==true)throw new Error(NEUTRAL);
    if(cancelled)return;
    const invitedEmail=String(metadata.signer?.email||"").trim().toLowerCase();
    await auth.authStateReady?.();
    const currentUser=auth.currentUser;
    let matchedProfile=null;
    if(currentUser?.uid&&invitedEmail&&String(currentUser.email||"").trim().toLowerCase()===invitedEmail){
     const candidate=await getMySignatureProfile().catch(()=>null);
     if(candidate?.uid===currentUser.uid&&String(candidate.email||"").trim().toLowerCase()===invitedEmail&&candidate.status==="Active")matchedProfile=candidate;
    }
    setSigningToken("");setSessionActive(false);
    const fields=Array.isArray(metadata.fields)?metadata.fields:[];
    setSavedProfile(matchedProfile);setRecord({title:metadata.title||"Controlled document",ownerName:metadata.ownerName||"Document owner",expiresAt:metadata.linkExpiresAt||"",fields,canSign:metadata.canSign===true,ownerDeclaredParticulars:metadata.ownerDeclaredParticulars||{},signer:metadata.signer||{}});
    setDeclarations({name:metadata.ownerDeclaredParticulars?.name||metadata.signer?.name||"",occupation:"",capacity:""});
    const initialFieldValues={};for(const field of fields){if(field.type==="Name")initialFieldValues[field.fieldId]=metadata.ownerDeclaredParticulars?.name||metadata.signer?.name||"";else if(field.type==="Title")initialFieldValues[field.fieldId]=metadata.ownerDeclaredParticulars?.title||metadata.signer?.title||"";}setFieldValues(initialFieldValues);
    const firstAssignedField=fields.find(field=>["Signature","Initials"].includes(field.type))||fields.find(field=>Number(field.roleAssignmentIndex||0)===0)||fields[0];setActiveRoleAssignmentIndex(Number(firstAssignedField?.roleAssignmentIndex||0));setSelectedFieldId(firstAssignedField?.fieldId||"");
    const response=await fetch(gateway+"/api/sign/email/pdf",{headers:{"x-signing-token":activeToken},cache:"no-store",credentials:"omit"});
    if(!response.ok)throw new Error("The controlled PDF could not be retrieved. Do not sign a document you cannot inspect.");
    if(!String(response.headers.get("content-type")||"").toLowerCase().includes("application/pdf"))throw new Error("The signing service did not return a PDF. Signing has been stopped.");
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(cancelled)return;
    if(bytes.length<5||String.fromCharCode(...bytes.subarray(0,5))!=="%PDF-")throw new Error("The controlled document response is not a valid PDF.");
    loadedPdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
    if(cancelled){await loadedPdf.destroy();return;}
    setPdfDocument(loadedPdf);setPageCount(loadedPdf.numPages);setPageNum(Number(firstAssignedField?.page||1));
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
  if(!pageRendered||!selectedFieldId)return;
  const target=pageHostRef.current?.querySelector(`[data-signing-field-id="${CSS.escape(selectedFieldId)}"]`);
  target?.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});
 },[selectedFieldId,pageRendered,pageNum]);

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
 const roleAssignments=Array.isArray(record?.signer?.roleAssignments)&&record.signer.roleAssignments.length?record.signer.roleAssignments:[{role:"Signing responsibility",capacity:"",occupation:""}];
 const assignmentFields=fields.filter(field=>Number(field.roleAssignmentIndex||0)===activeRoleAssignmentIndex);
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
 const incomplete=fields.filter(field=>!complete(field));
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
   setFieldApplications(current=>[...current.filter(item=>item.fieldId!==selectedField.fieldId),{fieldId:selectedField.fieldId,page:selectedField.page,x:selectedField.x,y:selectedField.y,width:selectedField.width,height:selectedField.height,coordinateSpace:selectedField.coordinateSpace,confirmed:true,value}]);
  }else if(fieldValues[selectedField.fieldId]===undefined||String(fieldValues[selectedField.fieldId]).trim()===""){setError("Complete this assigned field before confirming it.");return;}
  setError("");
  const nextInAssignment=assignmentFields.find(field=>field.fieldId!==selectedField.fieldId&&!complete(field));
  if(nextInAssignment){setSelectedFieldId(nextInAssignment.fieldId);const targetPage=Number(nextInAssignment.page||1);if(targetPage!==pageNum){setPageRendered(false);setPageNum(targetPage);}return;}
  const nextAssignmentIndex=roleAssignments.findIndex((assignment,index)=>index>activeRoleAssignmentIndex&&fields.some(field=>Number(field.roleAssignmentIndex||0)===index&&!complete(field)));
  if(nextAssignmentIndex>=0){const nextAssignmentField=fields.find(field=>Number(field.roleAssignmentIndex||0)===nextAssignmentIndex&&!complete(field));setActiveRoleAssignmentIndex(nextAssignmentIndex);setSelectedFieldId(nextAssignmentField.fieldId);const targetPage=Number(nextAssignmentField.page||1);if(targetPage!==pageNum){setPageRendered(false);setPageNum(targetPage);}setSuccess("Responsibility completed. Moving to the next signature assignment: "+[roleAssignments[nextAssignmentIndex].role,roleAssignments[nextAssignmentIndex].capacity].filter(Boolean).join(" — ")+".");return;}
  setSelectedFieldId("");setSuccess("All assigned responsibilities are complete. Review the document and submit the complete set of signatures.");
 }
 function clearPad(){const canvas=signatureCanvasRef.current;if(canvas)canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);setSignatureMarks(current=>{const next={...current};delete next[selectedFieldId];return next;});setFieldApplications(current=>current.filter(item=>item.fieldId!==selectedFieldId));}
 function enterReview(){
  if(!record){setError("The signing assignment is unavailable.");return;}
  if(!pageRendered){setError("Wait for the current document page to finish rendering.");return;}
  setError("");setReviewMode(true);if(pageNum!==1){setPageRendered(false);setPageNum(1);}
 }
 async function openDocumentToSign(){
  if(!record||sessionActive||sessionOpening)return;
  setSessionOpening(true);setError("");setSuccess("");
  try{
   const gateway=getGoogleDriveGatewayUrl();
   const response=await fetch(gateway+"/api/sign/email/session",{method:"POST",headers:{"x-signing-token":token,Accept:"application/json"},credentials:"omit",cache:"no-store"});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.ok!==true||!result.sessionToken)throw Object.assign(new Error(result.error||"Signing session could not be opened. (SESSION_CREATE)"),{code:result.code||"SESSION_CREATE"});
   setSigningToken(result.sessionToken);setSessionActive(true);
   setShowSigningPane(true);setSuccess("Signing session opened. Complete the assigned fields and review before submitting.");
  }catch(error){setError(error?.message||"Signing session could not be opened. (SESSION_CREATE)");}
  finally{setSessionOpening(false);}
 }
 async function submit(){
  if(!sessionActive||!signingToken){setError("Open the document to sign before submitting. (SESSION_REQUIRED)");return;}
  if(!reviewMode){setError("Review the complete document and signature placement before submitting.");return;}
  if(!pageRendered){setError("Wait for the current document page to finish rendering.");return;}
  if(!record?.canSign){setError("This assignment is not yet available for signing.");return;}
  if(!declarations.name.trim()){setError("Enter your name for this document.");return;}
  if(!consent){setError("Confirm your consent only after reviewing the document and signature placement.");return;}
  if(incomplete.length){setError("Complete all required assigned fields before submitting: "+incomplete.map(field=>field.placeholder||field.type+" · Page "+field.page).join(", ")+".");return;}
  if(!signatureFields.length&&typedSignature.trim().length<2){setError("Enter your typed signature before submitting.");return;}
  setSubmitting(true);setError("");setSuccess("");
  const gateway=getGoogleDriveGatewayUrl(),activeToken=signingToken||token;
  const signature=fieldApplications.length?{type:"field-applications",value:"confirmed"}:signatureValue?{type:"drawn",value:signatureValue}:{type:"typed",value:typedSignature.trim()||declarations.name.trim()};
  try{
   const response=await fetch(gateway+"/api/sign/submit",{method:"POST",headers:{"content-type":"application/json","x-signing-token":activeToken},credentials:"omit",cache:"no-store",body:JSON.stringify({token:activeToken,signature,fieldValues,fieldApplications,signatureConfirmed:true,declarations,consent:true})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.ok===false)throw new Error(result.error||"The signing action could not be completed.");
   setSigningClosed(true);
   if(result.status==="CompletionFailed"){setFinalizationFailed(true);setSuccess("Your signature was recorded, but final PDF completion failed. The envelope is marked CompletionFailed. Do not submit again; contact the document owner for controlled recovery.");return;}
   if(result.completed===true){
    setCopySent(result.distribution?.complete===true);
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
 function leaveSigningSession(){
  const parts=String(token||"").split(".");
  try{if(parts.length===3)window.sessionStorage.removeItem("irpaEmailSigningSession:"+parts[0]+"."+parts[1]);for(const key of Object.keys(window.sessionStorage)){if(/emailSigningSession|emailSignToken|gatewaySigningToken|signature.*(token|application|field)|signing.*token/i.test(key))window.sessionStorage.removeItem(key);}}catch{}
  try{const url=new URL(window.location.href);url.searchParams.delete("emailSignToken");url.searchParams.delete("signingToken");url.searchParams.set("signingComplete","1");window.history.replaceState({}, "", url.pathname+url.search);}catch{}
  setSigningToken("");setFieldApplications([]);setFieldValues({});setSignatureMarks({});setDeclarations({name:"",occupation:"",capacity:""});setSignaturePadField(null);setSelectedFieldId("");setSavedProfile(null);setTypedSignature("");setConsent(false);setRecord(null);setPdfDocument(current=>{if(current){const pending=current.destroy?.();pending?.catch?.(()=>{});}return null;});setPageCount(0);setPageRendered(false);
  if(auth.currentUser?.uid){window.location.replace("/");return;}
  setLeftSession(true);
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

 if(leftSession)return <main style={{minHeight:"100vh",background:"#f3f4f6",color:"#111827",padding:"20px 12px",boxSizing:"border-box"}}><section style={{maxWidth:620,margin:"8vh auto",background:"#fff",border:"1px solid #d1d5db",borderRadius:12,padding:24,textAlign:"center"}}><h1>IRPA — Signing session closed</h1><p role="status">This signing session has ended. The signing form, temporary signature marks and invitation token have been cleared from this page.</p><p>{copySent?"The completed signed copy has been sent to the document owner and signing participants.":"Your signing action was recorded. The document owner will receive the final signed copy after all required signing actions are complete."}</p><a href="https://irpa.or.tz" rel="noreferrer" style={{...buttonStyle,display:"inline-block",textDecoration:"none",marginTop:12}}>Close</a></section></main>;
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
        return <div key={field.fieldId} data-signing-field-id={field.fieldId} role="button" tabIndex={signingClosed?-1:0} aria-label={field.type+" field assigned to you, page "+pageNum} onClick={()=>{if(!signingClosed){setActiveRoleAssignmentIndex(Number(field.roleAssignmentIndex||0));setSelectedFieldId(field.fieldId);if(["Signature","Initials"].includes(field.type))setSignaturePadField(field);}}} onKeyDown={event=>{if(!signingClosed&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setActiveRoleAssignmentIndex(Number(field.roleAssignmentIndex||0));setSelectedFieldId(field.fieldId);}}} style={{position:"absolute",...signatureFieldCss(field),boxSizing:"border-box",border:"2px "+(application||complete(field)?"solid":"dashed")+" "+color,background:application?"rgba(22,163,74,.16)":"rgba(255,251,235,.88)",borderRadius:4,zIndex:5,display:"flex",alignItems:"center",justifyContent:"center",padding:3,overflow:"hidden",cursor:signingClosed?"default":"pointer",outline:selectedFieldId===field.fieldId?"3px solid #f59e0b":"none",boxShadow:selectedFieldId===field.fieldId?"0 0 0 4px rgba(245,158,11,.28)":"none"}}>
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
     <p style={{fontSize:13,background:"#f3f4f6",padding:10,borderRadius:7}}><strong>Your assigned responsibilities:</strong> {(record.signer?.roleAssignments||[]).map(item=>[item.role,item.capacity].filter(Boolean).join(" — ")).filter(Boolean).join("; ")||"Signing responsibility"} </p><p style={{fontSize:13,background:"#f3f4f6",padding:10,borderRadius:7}}><strong>Owner-recorded particulars for this assignment:</strong> {record.ownerDeclaredParticulars?.name||"Not supplied"} · {record.ownerDeclaredParticulars?.occupation||record.ownerDeclaredParticulars?.capacity||"Occupation/capacity not supplied"}</p>
     <label style={{display:"block",margin:"10px 0"}}>Full name<input style={inputStyle} value={declarations.name} disabled={signingClosed} onChange={e=>setDeclaration("name",e.target.value)} autoComplete="name"/></label>
     <label style={{display:"block",margin:"10px 0"}}>Title (optional)<input style={inputStyle} value={declarations.occupation} disabled={signingClosed} onChange={e=>setDeclaration("occupation",e.target.value)} placeholder="Enter your title (optional)"/></label>
     <label style={{display:"block",margin:"10px 0"}}>Additional details (optional)<input style={inputStyle} value={declarations.capacity} disabled={signingClosed} onChange={e=>setDeclaration("capacity",e.target.value)} placeholder="Additional official particulars"/></label>
    </section>
    {!sessionActive&&<div style={{marginTop:18,textAlign:"center"}}><p>Previewing this invitation does not consume it or create a signing session.</p><button type="button" disabled={signingClosed||sessionOpening||loading||!pdfDocument} onClick={openDocumentToSign} style={buttonStyle}>{sessionOpening?"Opening signing session…":"Open document to sign"}</button></div>}
    {sessionActive&&!savedProfile&&!showSigningPane&&<div style={{marginTop:18,textAlign:"center"}}><button type="button" disabled={signingClosed} onClick={()=>setShowSigningPane(true)} style={buttonStyle}>Continue to signature fields</button></div>}
    {sessionActive&&!!fields.length&&(savedProfile||showSigningPane)&&<section style={{marginTop:18,borderTop:"1px solid #d1d5db",paddingTop:14}}>
     <h2 style={{fontSize:18}}>Fields for this responsibility</h2><p style={{fontSize:13,color:"#4b5563"}}>When you tap your assigned Signature or Initials field, IRPA checks for an active Signature Profile belonging to the same signed-in email address as this invitation. If found, your saved specimen is selected for your review; confirm it to place the stamp. If no matching profile is available, draw your signature in the drawing pane. Your signature is never applied without your confirmation and final submission.</p>
     <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{assignmentFields.map(field=><button key={field.fieldId} type="button" disabled={signingClosed} onClick={()=>{setSelectedFieldId(field.fieldId);const targetPage=Number(field.page||1);if(targetPage!==pageNum){setPageRendered(false);setPageNum(targetPage);}setError("");}} style={{...buttonStyle,background:selectedFieldId===field.fieldId?"#174a78":"#4b5563",opacity:signingClosed?0.7:1}}>{field.type} · Page {field.page}{complete(field)?" ✓":""}</button>)}</div>
     {selectedField&&<div style={{marginTop:14,padding:12,border:"1px solid #9ca3af",borderRadius:8}}>
      <h3 style={{fontSize:16,marginTop:0}}>Complete: {selectedField.placeholder||selectedField.type} · Page {selectedField.page}</h3>
      {["Signature","Initials"].includes(selectedField.type)?<SignatureFieldConfirmationPad key={(signaturePadField||selectedField).fieldId} field={signaturePadField||selectedField} savedSignatureUrl={savedProfile?.signatureUrl||""} savedInitialsUrl={savedProfile?.initialsUrl||""} allowTyped={false} onCancel={()=>{setSignaturePadField(null);setSelectedFieldId("");}} onConfirm={async value=>{const field=signaturePadField||selectedField;if(!field?.fieldId)throw new Error("The assigned signature field is no longer available.");const application={fieldId:field.fieldId,page:Number(field.page||1),x:Number(field.x??0),y:Number(field.y??0),width:Number(field.width??24),height:Number(field.height??9),confirmed:true,value};setSignatureMarks(current=>({...current,[field.fieldId]:value}));setFieldApplications(current=>[...current.filter(item=>item.fieldId!==field.fieldId),application]);setSignaturePadField(null);setSelectedFieldId("");setError("");setSuccess(savedProfile?.signatureUrl||savedProfile?.initialsUrl?"Your own saved Signature Profile specimen has been confirmed for this assigned field. It will be stamped only after you review and submit.":"Your hand-drawn specimen has been confirmed for this assigned field. It will be stamped only after you review and submit.");}}/>:<><label style={{display:"block",margin:"8px 0"}}>{selectedField.type}{selectedField.required?" (required)":""}{selectedField.type==="Checkbox"?<input type="checkbox" disabled={signingClosed} checked={fieldValues[selectedField.fieldId]==="true"} onChange={e=>setFieldValues(v=>({...v,[selectedField.fieldId]:e.target.checked?"true":"false"}))}/>:<input style={inputStyle} disabled={signingClosed} type={selectedField.type==="Date"?"date":"text"} value={fieldValues[selectedField.fieldId]||""} onChange={e=>setFieldValues(v=>({...v,[selectedField.fieldId]:e.target.value}))} placeholder={selectedField.placeholder||"Enter your response"}/>}</label><button type="button" disabled={signingClosed} onClick={confirmField} style={buttonStyle}>Confirm field value</button></>}
     </div>}
    </section>}
    {!signatureFields.length&&(savedProfile||showSigningPane)&&<label style={{display:"block",margin:"14px 0"}}>Typed signature<input style={inputStyle} disabled={signingClosed} value={typedSignature} onChange={e=>setTypedSignature(e.target.value)} placeholder="Type your full name as your signature"/></label>}
    <label style={{display:"flex",gap:9,alignItems:"flex-start",margin:"18px 0"}}><input type="checkbox" checked={consent} disabled={signingClosed} onChange={e=>setConsent(e.target.checked)}/><span>I have reviewed the complete document, understand its contents and the marked signature location(s), and consent to apply my electronic signature.</span></label>
    {!record.canSign&&<p role="status">Your assignment is waiting for the preceding action. You may review the document, but cannot submit yet.</p>}
    {!reviewMode&&!signingClosed&&<button type="button" disabled={!canReview||!pdfDocument||Boolean(pageError)} onClick={enterReview} style={{...buttonStyle,opacity:(!canReview||!pdfDocument||Boolean(pageError)||incomplete.length>0)?0.5:1}}>Review complete document and signature placement</button>}
    {reviewMode&&!signingClosed&&<section style={{marginTop:16,padding:12,border:"2px solid #174a78",borderRadius:8}}>
     <h2 style={{fontSize:18,marginTop:0}}>Final review — signature not yet submitted</h2>
     <p style={{fontSize:13}}>Navigate through every page above. Confirm that the complete document is correct and that each stamp appears at the intended location. Changes to assigned fields update this preview. Your signature has not been submitted yet.</p>
     {incomplete.length>0&&<p role="status" style={{fontSize:13,color:"#92400e"}}>{incomplete.length} required field(s) remain incomplete: {incomplete.map(field=>field.placeholder||field.type+" · Page "+field.page).join(", ")}. Submit will be rejected until all are completed. You may still revoke this request.</p>}
     <button type="button" disabled={submitting||!record.canSign||!pageRendered||incomplete.length>0||(!signatureFields.length&&typedSignature.trim().length<2)||!declarations.name.trim()||!consent||Boolean(pageError)} onClick={submit} style={{...buttonStyle,background:"#166534",opacity:(submitting||!record.canSign||!pageRendered||incomplete.length>0||(!signatureFields.length&&typedSignature.trim().length<2)||!declarations.name.trim()||!consent||Boolean(pageError))?0.5:1}}>{submitting?"Submitting…":"Submit"}</button>
     <button type="button" disabled={revoking||submitting||record.signer?.status!=="Pending"} onClick={revoke} style={{...buttonStyle,background:"#991b1b",marginLeft:8,opacity:(revoking||submitting)?0.5:1}}>{revoking?"Revoking…":"Revoke"}</button>
    </section>}
    {signingClosed&&!revoked&&<div role="status" style={{marginTop:14,padding:12,background:"#dcfce7",borderRadius:8}}><p>This signing action is closed. No further submission is available through this invitation.</p><p>{copySent?"The completed signed copy has been sent to the document owner and signing participants.":"Your signature was recorded. The final signed copy will be distributed after all required signing actions are complete."}</p><button type="button" onClick={leaveSigningSession} style={buttonStyle}>Leave</button></div>}
    {revoked&&<p role="status" style={{marginTop:14}}>The invitation is revoked and cannot be used again.</p>}
   </>}
  </section>
 </main>;
}
