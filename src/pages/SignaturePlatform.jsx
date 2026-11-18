import React,{useEffect,useMemo,useRef,useState}from"react";
import"../styles/signature-portal.css";
import{getCurrentEmployeeProfile,getCurrentMemberProfile,getCurrentSigningAuthorityRegisterEntries,getControlledDocumentsForSigning,getRecords}from"../firebase/data";
import{createGatewaySignatureEnvelope,voidGatewaySignatureEnvelope,downloadControlledDocumentBytes,downloadSignatureBytes,resendFailedGatewaySignatureInvitations,getGatewaySignatureEnvelopeStatus,getGatewaySignatureEnvelopeDeliveryStatus,retryGatewaySignatureDistribution,resendGatewayEmailInvitation,revokeGatewayEmailInvitation}from"../firebase/signatureStorage";
import{auth}from"../firebase/config";
import{resolveExpectedIntegrity,hasIntegrityMismatch,sha256Hex as signatureSha256}from"../utils/documentIntegrity.mjs";
import{getMySignerIdentity}from"../firebase/signerIdentity";
import{createCompletionCertificate,createSignatureEnvelope,attachGatewayEmailLinkEnvelope,getMySignatureProfile,getSignatureEnvelope,getSignatureEnvelopes,getMySignedDocuments,downloadMySignedDocumentCopy,deleteMySignedDocumentCopy,saveMySignatureProfile,saveSignatureWorkflowDraft,finalizeSignatureWorkflowDraft,startSignatureWorkflow,revokeSignatureApplication,migrateExistingSignatureProfile}from"../firebase/signaturePlatform";
import{updateMySignerAuthority}from"../firebase/signerIdentity";
import ControlledDocumentUpload from"../components/ControlledDocumentUpload";
import SignatureFieldConfirmationPad from"../components/SignatureFieldConfirmationPad";
import{trimSignatureCanvas}from"../utils/signatureImageCanvas.mjs";
import SignatureImagePreview from"../components/SignatureImagePreview.jsx";
import SignaturePathwaySelfTest from"../components/SignaturePathwaySelfTest";
import{readWorkflowContext}from"../firebase/workflowLinks";
import{renderPdfPageToCanvas,describePdfPageError}from"../utils/pdfPageRendering.mjs";
import*as pdfjsLib from"pdfjs-dist";
import pdfWorker from"pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

const TYPES=["Signature","Initials","Date","Name","Title","Text","Number","Comment","Remarks","Checkbox"];const TYPE_LABELS={Signature:"Signature",Initials:"Initials",Date:"Date & Time",Name:"Name",Title:"Title / Position",Text:"Text",Number:"Number",Comment:"Comment",Remarks:"Remarks",Checkbox:"Checkbox"};
const COLORS={Signature:"#6d5dfc",Initials:"#7c3aed",Date:"#0891b2",Name:"#2563eb",Title:"#1d4ed8",Text:"#0f766e",Number:"#db2777",Comment:"#0284c7",Remarks:"#ea580c",Checkbox:"#b45309"};
const DEFAULTS={Signature:{width:28,height:10},Initials:{width:16,height:8},Date:{width:18,height:6},Name:{width:24,height:6},Title:{width:30,height:7},Text:{width:30,height:7},Number:{width:20,height:6},Comment:{width:34,height:10},Remarks:{width:34,height:10},Checkbox:{width:7,height:7}};

function makeField(type,i,uid,page=1){const d=DEFAULTS[type]||DEFAULTS.Text;return{fieldId:`FIELD-${Date.now()}-${i}`,type,page,x:8,y:12,width:d.width,height:d.height,required:type!=="Checkbox",signerUid:uid,responsibility:type==="Signature"?"Signature":type==="Initials"?"Initial":type==="Date"?"Date":type==="Title"?"Title / Position":type==="Comment"?"Comment":type==="Remarks"?"Remarks":type==="Number"?"Number Entry":type==="Checkbox"?"Approval":"Review",placeholder:type==="Comment"?"Enter comment":type==="Remarks"?"Enter remarks":type==="Number"?"Enter number":""};}

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function maskRegisterEmail(value){
 const email=String(value||"").trim();
 const at=email.lastIndexOf("@");
 if(at<1)return email?"***":"unavailable";
 return `${email.slice(0,1)}***@${email.slice(at+1)}`;
}
async function openOriginalPdf(url,documentId,envelopeId,signingStage=false){
 if(!url)return;
 if(!String(url).startsWith("drive://")){window.open(url,"_blank","noopener,noreferrer");return;}
 const popup=window.open("about:blank","_blank");
 const fileId=String(url).slice("drive://".length);
 try{
  const bytes=signingStage&&envelopeId?await downloadSignatureBytes(fileId,documentId,envelopeId):await downloadControlledDocumentBytes(fileId,documentId);
  const objectUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
  if(popup)popup.location.href=objectUrl;else{const link=document.createElement("a");link.href=objectUrl;link.download="IRPA-controlled-original.pdf";link.click();}
  window.setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
 }catch(error){popup?.close();throw error;}
}
function controlledPdfUrl(document={}){const link=String(document.webViewLink||document.archiveFileWebViewLink||document.governanceArchiveFileWebViewLink||"");const driveId=document.fileId||document.driveFileId||document.sourceFileId||document.archiveFileId||document.governanceArchiveFileId||document.primaryArchiveFileId||(link.includes("/d/")?(link.split("/d/")[1]||"").split(/[/?#]/)[0]:"")||((link.match(/[?&]id=([a-zA-Z0-9_-]+)/)||[])[1])||"";if(driveId)return `drive://${driveId}`;return document.fileUrl||document.documentUrl||document.storageUrl||document.pdfUrl||document.downloadUrl||document.downloadURL||"";}
function InkCapture({label="Sign directly on this device",onUse,onSave,replacementMode=false}){
  const canvasRef=useRef(null);
  const drawing=useRef(false);
  const [empty,setEmpty]=useState(true);
  const [feedback,setFeedback]=useState("");

  useEffect(()=>{
    const c=canvasRef.current;
    if(!c)return;
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const w=720,h=180;
    c.width=w*dpr;
    c.height=h*dpr;
    c.style.width="100%";
    c.style.height=h+"px";
    const ctx=c.getContext("2d");
    ctx.scale(dpr,dpr);
    ctx.fillStyle="#fff";
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#111827";
    ctx.lineWidth=3;
    ctx.lineCap="round";
    ctx.lineJoin="round";
  },[]);

  const point=e=>{
    const c=canvasRef.current;
    const r=c.getBoundingClientRect();
    return{x:(e.clientX-r.left)*720/r.width,y:(e.clientY-r.top)*180/r.height};
  };
  const start=e=>{
    e.preventDefault();
    const p=point(e);
    const ctx=canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);
    drawing.current=true;
    setEmpty(false);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };
  const move=e=>{
    if(!drawing.current)return;
    e.preventDefault();
    const p=point(e);
    const ctx=canvasRef.current.getContext("2d");
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
  };
  const end=()=>{drawing.current=false};
  const clear=()=>{
    const c=canvasRef.current;
    const ctx=c.getContext("2d");
    const dpr=Math.max(1,window.devicePixelRatio||1);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,720,180);
    ctx.fillStyle="#fff";
    ctx.fillRect(0,0,720,180);
    ctx.strokeStyle="#111827";
    ctx.lineWidth=3;
    ctx.lineCap="round";
    ctx.lineJoin="round";
    setEmpty(true);
    setFeedback("");
  };
  const save=async()=>{
    if(empty){
      setFeedback("ACTION REQUIRED: sign in the box first.");
      return;
    }
    setFeedback("Saving your handwritten signature…");
    try{
      const {dataUrl}=trimSignatureCanvas(canvasRef.current,{padding:4,devicePixelRatio:Math.max(1,window.devicePixelRatio||1)});
      const result=await(onSave?onSave(dataUrl):onUse(dataUrl));
      setFeedback("SUCCESS: this handwritten signature is now the CURRENT SIGNATURE and will be reused for future documents.");
      return result;
    }catch(e){
      setFeedback("SAVE FAILED: "+(e?.message||"The signature could not be stored."));
    }
  };

  return(
    <div data-signature-specimen="true">
      <div className="panel" style={{marginTop:16,border:"1px solid var(--border)"}}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DIGITAL SIGNING SPECIMEN</span>
            <h3 style={{margin:"6px 0"}}>{label}</h3>
            <p className="muted">Sign in the box below using your finger, stylus or mouse. This is your signing specimen and can be saved directly to your Signature Profile.</p>
          </div>
        </div>
        <div role="status" aria-live="polite" style={{marginBottom:10,padding:"12px 14px",borderRadius:8,background:replacementMode?"rgba(220,38,38,.16)":"rgba(22,163,74,.10)",border:replacementMode?"1px solid rgba(248,113,113,.55)":"1px solid rgba(74,222,128,.35)",color:"var(--text)",fontWeight:700}}>
          {replacementMode
            ?"REPLACEMENT MODE — your current served signature remains active until this new handwritten specimen is successfully saved."
            :"HANDWRITTEN SPECIMEN — save it once to make it the persistent signature for future documents."}
        </div>
        <div style={{background:"var(--surface)",border:"2px solid var(--border)",borderRadius:10,padding:6,overflow:"hidden",boxShadow:"inset 0 -28px 0 rgba(109,93,252,.06)"}}>
          <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} style={{display:"block",width:"100%",height:180,touchAction:"none",cursor:"crosshair"}}/>
        </div>
        <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
          <button type="button" className="specimen-clear-button" onClick={clear}>Clear Specimen</button>
          <button type="button" disabled={empty} onClick={save}>
            {replacementMode?"Save Signature":"Save Signature"}
          </button>
        </div>
        {feedback&&<div className="auth-message" role="status" aria-live="polite" style={{marginTop:10}}>{feedback}</div>}
      </div>
    </div>
  );
}

function FieldBox({field,selected,onSelect,onMove,onResize,onDelete,zoom,recipients,activeAssigneeUid,signatureSrc,initialsSrc,designerNow}){
 const ref=useRef(null);const drag=useRef(null);const resize=useRef(null);
 const startMove=e=>{e.preventDefault();e.stopPropagation();onSelect(field.fieldId);const r=ref.current?.parentElement?.getBoundingClientRect();if(!r)return;drag.current={sx:e.clientX,sy:e.clientY,fx:field.x,fy:field.y,w:r.width,h:r.height};window.addEventListener("pointermove",move);window.addEventListener("pointerup",end,{once:true});};
 const move=e=>{if(!drag.current)return;const d=drag.current;onMove(field.fieldId,clamp(d.fx+((e.clientX-d.sx)/d.w)*100,0,100-field.width),clamp(d.fy+((e.clientY-d.sy)/d.h)*100,0,100-field.height));};
 const end=()=>{drag.current=null;window.removeEventListener("pointermove",move);};
 const startResize=e=>{e.preventDefault();e.stopPropagation();onSelect(field.fieldId);const r=ref.current?.parentElement?.getBoundingClientRect();if(!r)return;resize.current={sx:e.clientX,sy:e.clientY,fw:field.width,fh:field.height,w:r.width,h:r.height};window.addEventListener("pointermove",resizeMove);window.addEventListener("pointerup",resizeEnd,{once:true});};
 const resizeMove=e=>{if(!resize.current)return;const d=resize.current;onResize(field.fieldId,clamp(d.fw+((e.clientX-d.sx)/d.w)*100,3,100-field.x),clamp(d.fh+((e.clientY-d.sy)/d.h)*100,3,100-field.y));};
 const resizeEnd=()=>{resize.current=null;window.removeEventListener("pointermove",resizeMove);};
 const c=COLORS[field.type]||COLORS.Text;const active=!!activeAssigneeUid&&field.signerUid===activeAssigneeUid;
 return <div ref={ref} onPointerDown={startMove} onClick={e=>{e.stopPropagation();onSelect(field.fieldId)}} style={{position:"absolute",left:`${field.x}%`,top:`${field.y}%`,width:`${field.width}%`,height:`${field.height}%`,boxSizing:"border-box",border:`3px ${active?"solid":selected?"solid":"dashed"} ${active?"#16a34a":c}`,background:active?"rgba(22,163,74,.16)":`${c}18`,borderRadius:5,cursor:"move",zIndex:selected?30:20,userSelect:"none",minWidth:22,minHeight:18}}>
   <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:Math.max(9,11*zoom),fontWeight:700,color:c,overflow:"hidden",whiteSpace:"nowrap",padding:"2px 18px 2px 5px",boxSizing:"border-box"}}><span>{TYPE_LABELS[field.type]||field.type}{field.required?" *":""}</span><small style={{fontSize:Math.max(7,8*zoom),opacity:.85,overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{recipients.find(r=>r.uid===field.signerUid)?.name||"Unassigned"} · {(recipients.find(r=>r.uid===field.signerUid)?.roleAssignments||[])[Number(field.roleAssignmentIndex||0)]?.role||recipients.find(r=>r.uid===field.signerUid)?.role||field.responsibility||"Review"}</small></div>
   {selected&&<><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(field.fieldId)}} style={{position:"absolute",right:2,top:2,width:18,height:18,border:0,borderRadius:4,background:"var(--surface)",color:"var(--text)",fontSize:11,cursor:"pointer"}}>×</button><span onPointerDown={startResize} style={{position:"absolute",right:-4,bottom:-4,width:10,height:10,borderRadius:2,background:c,cursor:"nwse-resize"}}/></>}
 </div>;
}

function PDFDesigner({url,documentId,envelopeId=null,signingStage=false,fields,setFields,recipients,members=[],ownerSigner=null,onRemoveSigner,onMoveSigner,onAddSigner,selectedSigner="",setSelectedSigner=()=>{},signerEmail="",setSignerEmail=()=>{},signerName="",setSignerName=()=>{},signerTitle="",setSignerTitle=()=>{},signerRole="Review",setSignerRole=()=>{},signerAuthorityRole="",setSignerAuthorityRole=()=>{},signerCapacity="",setSignerCapacity=()=>{},ownerSigningEnabled=false,onOwnerSigningChange,onSelectAssignee,selectedField,setSelectedField,activeAssigneeUid,signatureSrc,initialsSrc,onPageChange,busy=false}){
 const canvasRef=useRef(null),pageHostRef=useRef(null);const[paletteExpanded,setPaletteExpanded]=useState(true);const[selectedAssigneeUid,setSelectedAssigneeUid]=useState(activeAssigneeUid||recipients[0]?.uid||"");const[selectedRoleAssignmentIndex,setSelectedRoleAssignmentIndex]=useState(0);const lastParentAssigneeRef=useRef(activeAssigneeUid);const[pendingFieldType,setPendingFieldType]=useState("");const[canDrag,setCanDrag]=useState(false);const[pdf,setPdf]=useState(null);const[pageNum,setPageNum]=useState(1);const[pageSize,setPageSize]=useState({width:800,height:1035});const[zoom,setZoom]=useState(1);const[loading,setLoading]=useState(false);const[error,setError]=useState("");const[pageError,setPageError]=useState(null);const[renderRetry,setRenderRetry]=useState(0);const[grid,setGrid]=useState(true);const[history,setHistory]=useState([]);const[redoStack,setRedoStack]=useState([]);const[designerNow,setDesignerNow]=useState(()=>new Date());
 useEffect(()=>{const timer=window.setInterval(()=>setDesignerNow(new Date()),1000);return()=>window.clearInterval(timer)},[]);useEffect(()=>{const media=window.matchMedia("(pointer:fine)");const sync=()=>setCanDrag(media.matches);sync();media.addEventListener?.("change",sync);return()=>media.removeEventListener?.("change",sync)},[]);useEffect(()=>{const parentChanged=lastParentAssigneeRef.current!==activeAssigneeUid;lastParentAssigneeRef.current=activeAssigneeUid;const activeExists=!!activeAssigneeUid&&recipients.some(r=>r.uid===activeAssigneeUid);if(parentChanged&&activeExists){setSelectedAssigneeUid(activeAssigneeUid);setSelectedRoleAssignmentIndex(0);setPendingFieldType("");return;}if(!recipients.some(r=>r.uid===selectedAssigneeUid)){setSelectedAssigneeUid(activeExists?activeAssigneeUid:(recipients[0]?.uid||""));setSelectedRoleAssignmentIndex(0);setPendingFieldType("");}},[activeAssigneeUid,recipients,selectedAssigneeUid]);useEffect(()=>{onPageChange?.(pageNum)},[pageNum,onPageChange]);useEffect(()=>{let dead=false;(async()=>{setPdf(null);setPageNum(1);setError("");if(!url){setLoading(false);return}setLoading(true);try{const source=url.startsWith("drive://")?{data:signingStage&&envelopeId?await downloadSignatureBytes(url.slice("drive://".length),documentId,envelopeId):await downloadControlledDocumentBytes(url.slice("drive://".length),documentId)}:{url};const task=pdfjsLib.getDocument(source);const p=await task.promise;if(!dead){setPdf(p);setPageNum(1)}}catch(e){if(!dead){setPdf(null);setError("PDF could not be loaded. Check your access to this controlled document and try selecting it again. Details: "+(e?.message||"PDF retrieval or decoding failed."))}}finally{if(!dead)setLoading(false)}})();return()=>{dead=true};},[url,documentId,envelopeId,signingStage]);
 useEffect(()=>{let dead=false;const controller=new AbortController();(async()=>{if(!pdf||!canvasRef.current)return;setPageError(null);try{const metrics=await renderPdfPageToCanvas(pdf,pageNum,canvasRef.current,{maxWidth:760,zoom,maxPixels:4000000,signal:controller.signal});if(!dead)setPageSize({width:metrics.width,height:metrics.height});}catch(e){if(!dead){console.error("Signature Portal PDF designer page render failed",{page:pageNum,error:e});setPageError(describePdfPageError(e));}}})();return()=>{dead=true;controller.abort()}},[pdf,pageNum,zoom,renderRetry]);
 const pageFields=fields.filter(f=>Number(f.page)===pageNum);const signerRecipients=recipients.filter(r=>r.uid!==ownerSigner?.uid);
 const commit=next=>{setHistory(h=>[...h,fields].slice(-50));setRedoStack([]);setFields(next)};const undo=()=>{setHistory(h=>{if(!h.length)return h;const previous=h[h.length-1];setRedoStack(r=>[fields,...r].slice(0,50));setFields(previous);return h.slice(0,-1)})};const redo=()=>{setRedoStack(r=>{if(!r.length)return r;const next=r[r.length-1];setHistory(h=>[...h,fields].slice(-50));setFields(next);return r.slice(0,-1)})};const addAt=(type,x=50,y=20)=>{if(!pdf||pageError){setError("Wait until the controlled PDF page is loaded before placing fields.");return}if(!selectedAssigneeUid||!recipients.some(r=>r.uid===selectedAssigneeUid)){setError("Select a document owner or signer in the palette before placing fields.");return}const f=makeField(type,fields.length,selectedAssigneeUid,pageNum);f.roleAssignmentIndex=selectedRoleAssignmentIndex;f.x=clamp(x-f.width/2,0,100-f.width);f.y=clamp(y-f.height/2,0,100-f.height);commit([...fields,f]);setSelectedField(f.fieldId);setError("")};const selectAssignee=uid=>{setSelectedAssigneeUid(uid);setSelectedRoleAssignmentIndex(0);setPendingFieldType("");onSelectAssignee?.(uid)};const selectFieldType=type=>{if(!pdf||pageError){setError("Load the controlled PDF before selecting a field tool.");return}if(!selectedAssigneeUid||!recipients.some(r=>r.uid===selectedAssigneeUid)){setError("Select a document owner or signer in the palette first.");return}setPendingFieldType(type);setError("")};const placePendingField=e=>{if(!pendingFieldType){setSelectedField(null);return}const rect=pageHostRef.current?.getBoundingClientRect();if(!rect)return;addAt(pendingFieldType,((e.clientX-rect.left)/rect.width)*100,((e.clientY-rect.top)/rect.height)*100);setPendingFieldType("")};const addOwnerSignatureAt=()=>{if(!pdf||pageError){setError("Load the controlled PDF before placing an owner signature field.");return}if(!ownerSigner?.uid){setError("Enable Owner’s signature required before placing an owner signature field.");return}const existing=fields.find(f=>f.type==="Signature"&&f.signerUid===ownerSigner.uid);selectAssignee(ownerSigner.uid);if(existing){setPageNum(Number(existing.page)||1);setSelectedField(existing.fieldId);setPendingFieldType("");setError("The document owner already has a Signature field. The existing field is selected.");return}setPendingFieldType("Signature");setError("Tap the PDF page to place the required owner Signature field.");};
 const drop=e=>{e.preventDefault();const type=e.dataTransfer.getData("fieldType");if(!type)return;setPendingFieldType("");const r=pageHostRef.current.getBoundingClientRect();addAt(type,((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100);};
 const update=(id,patch)=>commit(fields.map(f=>f.fieldId===id?{...f,...patch}:f));const deleteSelected=()=>{if(!selectedField)return;commit(fields.filter(f=>f.fieldId!==selectedField));setSelectedField(null)};const duplicateSelected=()=>{const f=fields.find(x=>x.fieldId===selectedField);if(!f)return;const copy={...f,fieldId:"FIELD-"+Date.now()+"-"+fields.length,x:clamp(f.x+3,0,100-f.width),y:clamp(f.y+3,0,100-f.height)};commit([...fields,copy]);setSelectedField(copy.fieldId)};const centerX=()=>{const f=fields.find(x=>x.fieldId===selectedField);if(f)update(f.fieldId,{x:clamp((100-f.width)/2,0,100-f.width)})};const centerY=()=>{const f=fields.find(x=>x.fieldId===selectedField);if(f)update(f.fieldId,{y:clamp((100-f.height)/2,0,100-f.height)})};const clearPage=()=>{if(pageFields.length){commit(fields.filter(f=>Number(f.page)!==pageNum));setSelectedField(null)}};
 return <div className="signature-workflow-grid" style={{display:"grid",gridTemplateColumns:"240px minmax(560px,1fr) 320px",gap:14,marginTop:18,minHeight:700,alignItems:"start",width:"100%",maxWidth:"100%",boxSizing:"border-box"}}>
  <aside className="signature-field-palette" aria-label="Signature and assignment palette" style={{background:"#111827",color:"#f8fafc",border:"1px solid #475569",borderRadius:12,padding:14,overflow:"auto",maxHeight:"78vh",boxShadow:"0 10px 28px rgba(0,0,0,.22)",minWidth:0,boxSizing:"border-box"}}><button type="button" aria-expanded={paletteExpanded} aria-controls="signature-field-palette-content" onClick={()=>setPaletteExpanded(v=>!v)} style={{display:"flex",width:"100%",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:paletteExpanded?12:0,padding:"8px 0",border:0,background:"transparent",color:"#f8fafc",textAlign:"left",cursor:"pointer"}}><span><strong style={{display:"block",fontSize:14}}>FIELD PALETTE</strong><small style={{display:"block",marginTop:3,color:"#f8fafc",opacity:1}}>{paletteExpanded?"Add one person, select them, then place their fields directly on the PDF":"Show tools and signer assignment"}</small></span><span style={{fontSize:11,padding:"5px 8px",borderRadius:999,background:"#1e293b",border:"1px solid #64748b",color:"#f8fafc",fontWeight:800,whiteSpace:"nowrap"}}>{fields.length} field{fields.length===1?"":"s"} · {paletteExpanded?"Hide":"Show"}</span></button>{paletteExpanded&&<div id="signature-field-palette-content">{ownerSigner?.uid&&<button type="button" data-owner-signature-placement="true" onClick={()=>addOwnerSignatureAt()} title={`Select or place the owner signature field on PDF page ${pageNum}`} style={{display:"block",width:"100%",textAlign:"left",padding:"10px",marginBottom:10,borderRadius:9,border:"2px solid #16a34a",background:"rgba(22,163,74,.16)",color:"var(--text)",fontWeight:900,cursor:"pointer"}}>{fields.some(f=>f.type==="Signature"&&f.signerUid===ownerSigner.uid)?"Select Owner Signature Field":"Place Owner Signature"} — Page {pageNum}<small style={{display:"block",marginTop:4,fontWeight:500}}>Assigns this Signature field to {ownerSigner.name||ownerSigner.email} on the current PDF page</small></button>}<div style={{fontSize:11,color:"#cbd5e1",letterSpacing:".08em",fontWeight:900,marginBottom:8}}>SIGNING &amp; IDENTITY</div><div className="signature-field-tools">{TYPES.slice(0,6).map(t=><button key={t} className="signature-field-tool" type="button" draggable={canDrag} onDragStart={e=>{setPendingFieldType("");e.dataTransfer.setData("fieldType",t)}} onClick={()=>selectFieldType(t)} aria-pressed={pendingFieldType===t} title={"Select "+TYPE_LABELS[t]+" then tap the PDF"} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 10px",minHeight:56,marginBottom:0,borderRadius:9,border:`${pendingFieldType===t?2:1}px solid ${COLORS[t]}`,background:pendingFieldType===t?`${COLORS[t]}55`:`linear-gradient(180deg,${COLORS[t]}24,rgba(15,23,42,.82))`,color:"#f8fafc",cursor:pendingFieldType===t?"crosshair":"pointer",fontWeight:800,boxShadow:"inset 0 1px 0 rgba(255,255,255,.05)",overflow:"hidden"}}><span style={{display:"inline-block",width:8,height:8,borderRadius:3,background:COLORS[t],marginRight:8}}/>{t==="Signature"&&!signatureSrc?<span>Signature field — confirm when signing</span>:t==="Date"?<span style={{display:"block",fontSize:12,fontWeight:900,marginTop:2}}>{designerNow.toLocaleString()}</span>:TYPE_LABELS[t]}<small style={{display:"block",marginTop:4,color:"var(--text)",opacity:1,fontSize:10,fontWeight:500}}>{t==="Date" ? "Live date & time • click or drag" : "Select, then tap PDF"}</small></button> )}</div><div style={{fontSize:11,color:"#cbd5e1",letterSpacing:".08em",fontWeight:900,margin:"16px 0 8px"}}>EDITORIAL &amp; REVIEW</div><div className="signature-field-tools">{TYPES.slice(6).map(t=><button key={t} className="signature-field-tool" type="button" draggable={canDrag} onDragStart={e=>{setPendingFieldType("");e.dataTransfer.setData("fieldType",t)}} onClick={()=>selectFieldType(t)} aria-pressed={pendingFieldType===t} title={"Select "+TYPE_LABELS[t]+" then tap the PDF"} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 10px",marginBottom:0,borderRadius:8,border:`${pendingFieldType===t?2:1}px solid ${COLORS[t]}`,background:pendingFieldType===t?`${COLORS[t]}55`:`${COLORS[t]}20`,color:"#f8fafc",cursor:pendingFieldType===t?"crosshair":"pointer",fontWeight:700}}><span style={{display:"inline-block",width:8,height:8,borderRadius:3,background:COLORS[t],marginRight:8}}/>{TYPE_LABELS[t]}<small style={{display:"block",marginLeft:16,opacity:.55,fontWeight:400}}>Select, then tap PDF</small></button> )}</div>{pendingFieldType&&<div className="signature-palette-placement-status" role="status" aria-live="polite">Selected: <strong>{TYPE_LABELS[pendingFieldType]||pendingFieldType}</strong> for <strong>{recipients.find(r=>r.uid===selectedAssigneeUid)?.name||"selected signer"}</strong>. Tap the PDF page to place it. <button type="button" onClick={()=>setPendingFieldType("")}>Cancel</button></div>}<div style={{borderTop:"1px solid rgba(148,163,184,.24)",paddingTop:14,marginTop:12}}><strong style={{display:"block",fontSize:12,color:"var(--text)",letterSpacing:".04em",marginBottom:8}}>EDITORIAL TOOLS</strong><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}><button type="button" onClick={undo} disabled={!history.length} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:history.length?"#172033":"#111827",color:history.length?"#f8fafc":"#64748b",fontWeight:800,cursor:history.length?"pointer":"not-allowed"}}>↶ Undo</button><button type="button" onClick={redo} disabled={!redoStack.length} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:redoStack.length?"#172033":"#111827",color:redoStack.length?"#f8fafc":"#64748b",fontWeight:800,cursor:redoStack.length?"pointer":"not-allowed"}}>↷ Redo</button><button type="button" onClick={duplicateSelected} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:selectedField?"#172033":"#111827",color:selectedField?"#f8fafc":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Duplicate</button><button type="button" onClick={deleteSelected} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:selectedField?"rgba(127,29,29,.42)":"#111827",color:selectedField?"#fecaca":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Delete</button><button type="button" onClick={centerX} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:selectedField?"#172033":"#111827",color:selectedField?"#f8fafc":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Center X</button><button type="button" onClick={centerY} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:selectedField?"#172033":"#111827",color:selectedField?"#f8fafc":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Center Y</button><button type="button" onClick={()=>setGrid(v=>!v)} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:"#1e293b",color:"#f8fafc",fontWeight:800,cursor:"pointer"}}>{grid?"Hide Grid":"Show Grid"}</button><button type="button" onClick={()=>setZoom(1)} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",fontWeight:800,cursor:"pointer"}}>100%</button></div><button type="button" style={{width:"100%",marginTop:7,minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid var(--border)",background:pageFields.length?"rgba(127,29,29,.42)":"#111827",color:pageFields.length?"#fecaca":"#64748b",fontWeight:800,cursor:pageFields.length?"pointer":"not-allowed"}} onClick={clearPage} disabled={!pageFields.length}>Clear Current Page</button></div><div className="panel signature-palette-assignment" style={{marginTop:16,padding:12,background:"#1e293b",border:"1px solid #64748b",color:"#f8fafc"}}>
   <strong style={{display:"block",marginBottom:8,fontSize:12,color:"#f8fafc"}}>PEOPLE & FIELD ASSIGNMENT</strong>
   <label className="signature-owner-toggle"><input type="checkbox" checked={ownerSigningEnabled} onChange={e=>onOwnerSigningChange?.(e.target.checked)}/> <span>Require the document owner to sign</span></label>
   <div className="signature-palette-add-person">
    <strong style={{display:"block",fontSize:11,margin:"12px 0 7px"}}>ADD A PARTICIPANT</strong>
    <label>Registered IRPA officer<select value={selectedSigner} onChange={e=>{setSelectedSigner(e.target.value);const member=members.find(x=>x.uid===e.target.value);setSignerEmail(member?.email||"");setSignerTitle(member?.jobTitle||member?.boardPosition||member?.role||"");}}><option value="">Choose a registered officer</option>{members.filter(member=>String(member.email||"").trim()&&member.uid!==auth.currentUser?.uid&&!(auth.currentUser?.email&&String(member.email||"").trim().toLowerCase()===String(auth.currentUser.email||"").trim().toLowerCase())&&!recipients.some(r=>r.uid===member.uid||(member.email&&String(r.email||"").trim().toLowerCase()===String(member.email||"").trim().toLowerCase()))).map(member=><option key={member.uid} value={member.uid}>{member.name||member.email} · {member.boardPosition||member.role||member.jobTitle||"Registered officer"} · {member.email}</option>)}</select></label>
    <label>Signer name<input type="text" value={signerName} onChange={e=>{setSignerName(e.target.value);setSelectedSigner("");}} placeholder="Full name" autoComplete="name"/></label>
    <label>Signer title / position (optional)<input type="text" value={signerTitle} onChange={e=>setSignerTitle(e.target.value)} placeholder="e.g. Executive Director, Board Chairperson"/></label>
    <label>Signer email<input type="email" value={signerEmail} onChange={e=>{setSignerEmail(e.target.value);setSelectedSigner("");}} placeholder="name@example.org" autoComplete="email"/></label>
    {(signerName.trim()||signerEmail.trim())&&members.filter(member=>member.uid!==auth.currentUser?.uid&&String(member.email||"").trim()&&!(auth.currentUser?.email&&String(member.email||"").trim().toLowerCase()===String(auth.currentUser.email||"").trim().toLowerCase())&&((!!signerName.trim()&&String(member.name||"").toLowerCase().includes(signerName.trim().toLowerCase()))||(!!signerEmail.trim()&&String(member.email||"").toLowerCase().includes(signerEmail.trim().toLowerCase())))).slice(0,6).length>0&&<div role="listbox" aria-label="Matching existing IRPA records" className="signature-signer-match-list"><strong>Matching existing IRPA records</strong>{members.filter(member=>member.uid!==auth.currentUser?.uid&&String(member.email||"").trim()&&!(auth.currentUser?.email&&String(member.email||"").trim().toLowerCase()===String(auth.currentUser.email||"").trim().toLowerCase())&&((!!signerName.trim()&&String(member.name||"").toLowerCase().includes(signerName.trim().toLowerCase()))||(!!signerEmail.trim()&&String(member.email||"").toLowerCase().includes(signerEmail.trim().toLowerCase())))).slice(0,6).map(member=><button type="button" role="option" aria-selected={selectedSigner===member.uid} key={member.uid} onClick={()=>{setSelectedSigner(member.uid);setSignerName(member.name||"");setSignerEmail(member.email||"");setSignerTitle(member.jobTitle||member.boardPosition||member.role||"");}} >{member.name||"Unnamed officer"} · {member.email} <small>{member.boardPosition||member.role||member.jobTitle||"Registered IRPA officer"}</small></button>)}</div>}
    <label>Participant role / action<select value={signerRole} onChange={e=>setSignerRole(e.target.value)}><option>Review</option><option>Authorization</option><option>Approval</option><option>Verification</option><option>Recommendation</option><option>Comment</option><option>Signature</option><option>Final Authorization</option><option>Board Chairperson</option><option>Board Vice Chairperson</option><option>Board Secretary</option><option>Board Treasurer</option><option>Board Member</option><option>Other</option></select></label>
    <label>Occupation (optional)<input type="text" value={signerAuthorityRole} onChange={e=>setSignerAuthorityRole(e.target.value)} placeholder="e.g. Director or Consultant"/></label>
    <label>Additional capacity (optional)<input type="text" value={signerCapacity} onChange={e=>setSignerCapacity(e.target.value)} placeholder="e.g. Board Secretary or Technical Adviser"/></label>
    <button type="button" className="signature-palette-add-button" onClick={()=>onAddSigner?.()} disabled={busy||(!selectedSigner&&!String(signerEmail||"").trim())} aria-busy={busy?"true":"false"}>{busy?"Adding participant…":"Add participant to this document"}</button>
   </div>
   <div data-testid="palette-signer-management" className="signature-palette-people-list">
    <strong style={{display:"block",fontSize:11,margin:"12px 0 6px"}}>ASSIGNED PEOPLE — SELECT WHOSE FIELDS YOU ARE PLACING</strong>
    {recipients.length===0?<small>No participants added yet. Add a signer above, then select them before placing fields.</small>:recipients.map((r,i)=>{const isOwner=r.uid===ownerSigner?.uid;const signerIndex=signerRecipients.findIndex(item=>item.uid===r.uid);return <div key={r.uid} className="signature-palette-person">
      <div className="signature-palette-person-details"><strong>{i+1}. {r.name||r.email}</strong><small>{r.email} · {[...new Set([...(Array.isArray(r.roleAssignments)?r.roleAssignments.map(a=>a.role):[]),r.role||"Signer"])].filter(Boolean).join(" + ")}{isOwner?" · Document owner":""}</small></div>
      <button type="button" className="signature-palette-select-person" aria-pressed={selectedAssigneeUid===r.uid} onClick={()=>selectAssignee(r.uid)}>{selectedAssigneeUid===r.uid?"Selected for fields":"Assign fields to this person"}</button>{selectedAssigneeUid===r.uid&&<label style={{display:"block",marginTop:8}}>Responsibility for new fields<select aria-label={"Responsibility for new fields assigned to "+(r.name||r.email)} value={selectedRoleAssignmentIndex} onChange={e=>setSelectedRoleAssignmentIndex(Number(e.target.value))}>{(Array.isArray(r.roleAssignments)&&r.roleAssignments.length?r.roleAssignments:[{role:r.role||"Signer",capacity:r.capacity||"",occupation:r.occupation||""}]).map((assignment,assignmentIndex)=><option key={assignmentIndex} value={assignmentIndex}>{[assignment.title,assignment.role,assignment.capacity].filter(Boolean).join(" — ")||("Assignment "+(assignmentIndex+1))}</option>)}</select></label>}
      {!isOwner&&<div className="signature-palette-person-actions"><button type="button" onClick={()=>onMoveSigner?.(r.uid,-1)} disabled={signerIndex===0}>Move up</button><button type="button" onClick={()=>onMoveSigner?.(r.uid,1)} disabled={signerIndex===signerRecipients.length-1}>Move down</button><button type="button" data-testid={"palette-remove-signer-"+r.uid} onClick={()=>onRemoveSigner?.(r.uid)}>Remove</button></div>}
     </div>})}
   </div>
   <div className="signature-palette-field-list">
    <strong style={{display:"block",fontSize:11,margin:"14px 0 6px"}}>FIELDS ON THIS DOCUMENT</strong>
    {fields.length===0?<small>No fields placed yet.</small>:fields.map((field,index)=><label key={field.fieldId}>{index+1}. {TYPE_LABELS[field.type]||field.type} · Page {field.page}<select aria-label={"Assign "+field.type+" field "+(index+1)} value={field.signerUid||""} onChange={e=>update(field.fieldId,{signerUid:e.target.value,roleAssignmentIndex:0})}><option value="">Unassigned — choose a participant</option>{recipients.map(r=><option key={r.uid} value={r.uid}>{r.name||r.email} · {r.role||"Signer"}</option>)}</select></label>)}
   </div>
  </div><div style={{marginTop:14,fontSize:12,lineHeight:1.5,color:"var(--text)",opacity:1,padding:"9px 10px",borderRadius:7,background:"var(--surface)"}}>Drag, move and resize fields directly on the rendered PDF page.</div></div>}</aside>
  <main style={{background:"var(--surface)",borderRadius:12,padding:12,overflow:"auto",minHeight:680}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:12,position:"sticky",top:0,zIndex:50,background:"var(--surface)",paddingBottom:8}}><div style={{display:"flex",gap:6}}><button type="button" className="text-button" disabled={!pdf||pageNum<=1} onClick={()=>setPageNum(p=>p-1)}>‹</button><span style={{padding:"8px 10px",fontSize:13}}>Page {pageNum} / {pdf?.numPages||0}</span><button type="button" className="text-button" disabled={!pdf||pageNum>=pdf.numPages} onClick={()=>setPageNum(p=>p+1)}>›</button></div><div style={{display:"flex",gap:6,alignItems:"center"}}><button type="button" className="text-button" onClick={()=>setZoom(z=>clamp(Number((z-.1).toFixed(2)),.6,1.8))}>−</button><span style={{fontSize:12}}>{Math.round(zoom*100)}%</span><button type="button" className="text-button" onClick={()=>setZoom(z=>clamp(Number((z+.1).toFixed(2)),.6,1.8))}>+</button></div></div>{loading&&<div className="muted">Rendering PDF…</div>}{error&&<div className="auth-message" style={{marginBottom:10}}>{error}</div>} {!url?<div className="muted" style={{padding:40,textAlign:"center"}}>Select a controlled PDF to open the visual designer.</div>:<div style={{display:"flex",justifyContent:"center",padding:8}}><div ref={pageHostRef} className={pendingFieldType?"signature-pdf-placement-active":""} onDragOver={e=>e.preventDefault()} onDrop={drop} onClick={placePendingField} style={{position:"relative",width:pageSize.width,maxWidth:"100%",aspectRatio:pageSize.width+"/"+pageSize.height,background:"#ffffff",boxShadow:"0 8px 30px rgba(0,0,0,.35)",flex:"0 0 auto",backgroundImage:grid?"linear-gradient(rgba(15,23,42,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,.06) 1px,transparent 1px)":"none",backgroundSize:grid?"20px 20px":"auto",cursor:pendingFieldType?"crosshair":"default",touchAction:"manipulation"}}><canvas ref={canvasRef} style={{position:"absolute",inset:0,pointerEvents:"none",display:"block",width:"100%",height:"100%",background:"#ffffff"}}/>{pageError&&<div role="alert" style={{position:"absolute",inset:0,zIndex:30,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:10,padding:16,background:"rgba(255,255,255,.97)",color:"#7f1d1d",border:"2px solid #dc2626",overflowWrap:"anywhere"}}><strong>Page {pageNum} could not be displayed: {pageError.name}: {pageError.message}</strong><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" onClick={()=>setRenderRetry(value=>value+1)}>Retry</button><a href={url.startsWith("drive://")?"#":url} target="_blank" rel="noreferrer" onClick={event=>{if(url.startsWith("drive://")){event.preventDefault();openOriginalPdf(url,documentId,envelopeId,signingStage).catch(error=>{console.error("Open original controlled PDF failed",error);setPageError(describePdfPageError(error));});}}}>Open original file</a></div></div>}{pageFields.map(f=><FieldBox key={f.fieldId} field={f} selected={selectedField===f.fieldId} onSelect={setSelectedField} onMove={(id,x,y)=>update(id,{x,y})} onResize={(id,width,height)=>update(id,{width,height})} onDelete={id=>{commit(fields.filter(f=>f.fieldId!==id));setSelectedField(null)}} zoom={zoom} recipients={recipients} activeAssigneeUid={selectedAssigneeUid} signatureSrc={signatureSrc} initialsSrc={initialsSrc} designerNow={designerNow}/>)}</div></div>}</main>
  <aside style={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:12,padding:14,boxShadow:"0 10px 28px rgba(0,0,0,.22)"}}><div style={{fontSize:14,fontWeight:900,color:"var(--text)",paddingBottom:10,borderBottom:"1px solid rgba(148,163,184,.22)"}}>FIELD PROPERTIES</div>{!selectedField?<p style={{fontSize:13,lineHeight:1.5,color:"var(--text)",marginTop:16}}>Select a field on the PDF to edit its properties.</p>:(()=>{const f=fields.find(x=>x.fieldId===selectedField);if(!f)return null;return <div style={{marginTop:14,color:"var(--text)"}}><label style={{display:"block",color:"var(--text)",fontWeight:700}}>Type<select value={f.type} onChange={e=>update(f.fieldId,{type:e.target.value})}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label><label>Assigned addressee<select value={f.signerUid||""} onChange={e=>update(f.fieldId,{signerUid:e.target.value,roleAssignmentIndex:0})}><option value="">Assign addressee</option>{recipients.map(r=><option key={r.uid} value={r.uid}>{r.name||r.email} · {r.role||""}</option>)}</select></label><label>Signature responsibility assignment<select aria-label="Signature responsibility assignment" value={Number(f.roleAssignmentIndex||0)} onChange={e=>update(f.fieldId,{roleAssignmentIndex:Number(e.target.value)})}>{(()=>{const assignedRecipient=recipients.find(r=>r.uid===f.signerUid);const assignments=Array.isArray(assignedRecipient?.roleAssignments)&&assignedRecipient.roleAssignments.length?assignedRecipient.roleAssignments:[{role:assignedRecipient?.role||"Signer",capacity:assignedRecipient?.capacity||""}];return assignments.map((assignment,index)=><option key={index} value={index}>{[assignment.title,assignment.role,assignment.capacity].filter(Boolean).join(" — ")||("Assignment "+(index+1))}</option>);})()}</select></label><label>Responsibility<select value={f.responsibility||""} onChange={e=>update(f.fieldId,{responsibility:e.target.value})}><option value="">Select responsibility</option><option>Signature</option><option>Initial</option><option>Review</option><option>Comment</option><option>Number Entry</option><option>Remarks</option><option>Date</option><option>Verification</option><option>Recommendation</option><option>Authorization</option><option>Approval</option><option>Final Authorization</option></select></label><label>Page<input type="number" min="1" max={pdf?.numPages||1} value={f.page} onChange={e=>update(f.fieldId,{page:clamp(Number(e.target.value)||1,1,pdf?.numPages||1)})}/></label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><label>X %<input type="number" min="0" max="100" step=".1" value={Number(f.x).toFixed(1)} onChange={e=>update(f.fieldId,{x:clamp(Number(e.target.value)||0,0,100-f.width)})}/></label><label>Y %<input type="number" min="0" max="100" step=".1" value={Number(f.y).toFixed(1)} onChange={e=>update(f.fieldId,{y:clamp(Number(e.target.value)||0,0,100-f.height)})}/></label><label>Width %<input type="number" min="3" max="100" step=".1" value={Number(f.width).toFixed(1)} onChange={e=>update(f.fieldId,{width:clamp(Number(e.target.value)||3,3,100-f.x)})}/></label><label>Height %<input type="number" min="3" max="100" step=".1" value={Number(f.height).toFixed(1)} onChange={e=>update(f.fieldId,{height:clamp(Number(e.target.value)||3,3,100-f.y)})}/></label></div><label style={{display:"flex",gap:8,alignItems:"center",marginTop:12}}><input type="checkbox" checked={!!f.required} onChange={e=>update(f.fieldId,{required:e.target.checked})}/> Required field</label><button type="button" className="text-button" style={{marginTop:14}} onClick={deleteSelected}>Delete field</button></div>})()}</aside>
 </div>;
}


function SignatureIntegrityPanel({bytes,fileId,storedHash,storedSize,actualHash,actualSize}){const[open,setOpen]=useState(false);const[pages,setPages]=useState([]);const[pageCount,setPageCount]=useState(0);const[scanError,setScanError]=useState("");useEffect(()=>{let alive=true;(async()=>{if(!bytes)return;try{const pdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise;const results=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const text=await page.getTextContent();const viewport=page.getViewport({scale:.5});const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport}).promise;const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<data.length;i+=4)if(data[i]<245||data[i+1]<245||data[i+2]<245)ink++;results.push({page:n,characters:(text.items||[]).reduce((sum,item)=>sum+String(item.str||"").length,0),nonBlank:ink>Math.max(10,canvas.width*canvas.height*.001)});canvas.width=canvas.height=1;}if(alive){setPageCount(pdf.numPages);setPages(results);}}catch(error){if(alive)setScanError(error?.message||"PDF integrity scan failed.");}})();return()=>{alive=false}},[bytes]);const mismatch=(stored,actual)=>stored!==null&&stored!==undefined&&String(stored)!==String(actual);const bad=mismatch(storedHash,actualHash)||mismatch(storedSize,actualSize);return <section style={{marginTop:12,border:"1px solid var(--border)",borderRadius:8,padding:10}}><button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} style={{width:"100%",textAlign:"left",background:"transparent",border:0,color:"var(--text)",fontWeight:800,cursor:"pointer"}}>Document integrity {open?"−":"+"}</button>{open&&<div style={{fontSize:12,lineHeight:1.7,overflowWrap:"anywhere"}}><div>Drive file ID: <code>{fileId||"Unavailable"}</code></div><div>Endpoint: <code>/api/signature-file/download</code></div><div style={{color:bad?"#dc2626":"inherit"}}>Downloaded bytes: {actualSize??"—"} · SHA-256: <code>{actualHash||"—"}</code></div><div style={{color:bad?"#dc2626":"inherit"}}>Stored size: {storedSize??"Not recorded"} · Stored SHA-256: <code>{storedHash||"Not recorded"}</code></div><div>PDF page count: {pageCount||"Scanning…"}</div>{scanError&&<div style={{color:"#dc2626"}}>{scanError}</div>}{pages.map(p=><div key={p.page} style={{color:!p.nonBlank?"#dc2626":"inherit"}}>Page {p.page}: {p.characters} extractable text characters · {p.nonBlank?"renders non-blank":"BLANK RENDER"}</div>)}</div>}</section>}
function SigningDocumentViewer({url,documentId,envelopeId,fields,profile,fieldValues,setFieldValues,record,sourceDocument,isAdmin,setMessage}){
 const canvasRef=useRef(null);const hostRef=useRef(null);const inkCanvasRef=useRef(null);const[inkField,setInkField]=useState(null);const[drawing,setDrawing]=useState(false);const[pdf,setPdf]=useState(null);const[pageNum,setPageNum]=useState(1);const[pageSize,setPageSize]=useState({width:760,height:980});const[zoom,setZoom]=useState(1);const[error,setError]=useState("");const[loading,setLoading]=useState(false),[integrity,setIntegrity]=useState(null);const[pageError,setPageError]=useState(null);const[renderRetry,setRenderRetry]=useState(0);
 useEffect(()=>{let dead=false;(async()=>{if(!url){setPdf(null);return}setLoading(true);setError("");setIntegrity(null);try{let source;if(url.startsWith("drive://")){const fileId=url.slice("drive://".length);const bytes=await downloadSignatureBytes(fileId,documentId,envelopeId);const actualHash=await signatureSha256(bytes);const integrityEnvelope=record?.signedDocumentUrl&&url===record.signedDocumentUrl?{...record,sha256:record.signedDocumentHash||record.sha256,byteLength:record.signedDocumentSize??record.byteLength}:record||{};const expected=resolveExpectedIntegrity(integrityEnvelope,sourceDocument||record?.sourceDocument||record?.documentRecord||record?.sourceDocumentRecord||{});const storedHash=expected.hash||"";const storedSize=expected.size;if(!dead)setIntegrity({bytes,fileId,actualHash,actualSize:bytes.byteLength,storedHash,storedSize,legacy:!storedHash&&storedSize===null});if(hasIntegrityMismatch({expectedHash:storedHash||null,expectedSize:storedSize,actualHash,actualSize:bytes.byteLength}))throw new Error("DOCUMENT INTEGRITY ERROR: the downloaded PDF does not match the expected envelope or source document integrity metadata. The PDF has been blocked.");source={data:bytes.slice()};}else{source={url};}const task=pdfjsLib.getDocument(source);const p=await task.promise;if(!dead){setPdf(p);setPageNum(1)}}catch(e){if(!dead)setError(e.message||"Unable to open the signing document.")}finally{if(!dead)setLoading(false)}})();return()=>{dead=true}},[url,documentId,envelopeId,record,sourceDocument]);
 useEffect(()=>{let dead=false;const controller=new AbortController();(async()=>{if(!pdf||!canvasRef.current)return;setPageError(null);try{const metrics=await renderPdfPageToCanvas(pdf,pageNum,canvasRef.current,{maxWidth:760,zoom,maxPixels:4000000,signal:controller.signal});if(!dead)setPageSize({width:metrics.width,height:metrics.height});}catch(e){if(!dead){console.error("Signature Portal signer page render failed",{page:pageNum,error:e});setPageError(describePdfPageError(e));}}})();return()=>{dead=true;controller.abort()}},[pdf,pageNum,zoom,renderRetry]);
 const mine=(fields||[]).filter(f=>Number(f.page||1)===pageNum&&f.signerUid===auth.currentUser?.uid);
 const setValue=(f,v)=>setFieldValues(prev=>({...prev,[f.fieldId]:v}));
 const activate=(f)=>{if(!auth.currentUser?.uid||f?.signerUid!==auth.currentUser.uid){setMessage("This signing field is not assigned to your authenticated account.");return;}if(f.type==="Date"){setValue(f,"SERVER_TIMESTAMP_PENDING");setMessage("The final document will stamp the Gateway server date and time when you submit your signature.");return;}if(f.type==="Signature"||f.type==="Initials"){setMessage("");setInkField(f);return;}setMessage("This field cannot be opened for signing.");};
 useEffect(()=>{if(!inkField)return;const element=Array.from(hostRef.current?.querySelectorAll("[data-signature-field-id]")||[]).find(node=>node.getAttribute("data-signature-field-id")===String(inkField.fieldId));if(element)element.scrollIntoView({block:"center"});else setMessage("The selected signing field could not be brought into view.");},[inkField,setMessage]);
  const inkPoint=(e)=>{const c=inkCanvasRef.current;const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*(c.width/Math.max(1,r.width)),y:(e.clientY-r.top)*(c.height/Math.max(1,r.height))}};
 const prepareInk=(c)=>{const ctx=c.getContext("2d");if(c.__inkReady)return ctx;ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.lineWidth=4;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#111827";c.__inkReady=true;return ctx};
 const startInk=(e)=>{const c=inkCanvasRef.current;if(!c)return;e.preventDefault();const ctx=prepareInk(c);const p=inkPoint(e);c.__inkLast=p;c.__inkDirty=true;try{c.setPointerCapture?.(e.pointerId)}catch(_e){}ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fillStyle="#111827";ctx.fill();setDrawing(true)};
 const moveInk=(e)=>{const c=inkCanvasRef.current;if(!c||!drawing||!c.__inkLast)return;e.preventDefault();const ctx=prepareInk(c);const p=inkPoint(e);ctx.beginPath();ctx.moveTo(c.__inkLast.x,c.__inkLast.y);ctx.lineTo(p.x,p.y);ctx.stroke();c.__inkLast=p};
 const clearInk=()=>{const c=inkCanvasRef.current;if(!c)return;c.__inkReady=false;c.__inkDirty=false;c.__inkLast=null;prepareInk(c);setError("")};
 const saveInk=()=>{const c=inkCanvasRef.current;if(!c||!inkField)return;if(!c.__inkDirty){setError("Please write your "+String(inkField.type||"signature").toLowerCase()+" in the box before tapping Use Handwritten Ink.");return}try{const specimen=trimSignatureCanvas(c,{padding:4,devicePixelRatio:Math.max(1,window.devicePixelRatio||1)});setValue(inkField,specimen.dataUrl);setInkField(null);setDrawing(false);setError("")}catch(error){setError(error?.message||"The signature image could not be prepared.")}};
 return <div className="panel mobile-signing-panel" style={{marginBottom:18}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}><div><strong>Document you are signing</strong><div className="muted" style={{fontSize:12}}>Review the actual PDF below. Only fields assigned to you are active.</div></div><div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><button type="button" className="text-button" disabled={!pdf||pageNum<=1} onClick={()=>setPageNum(p=>p-1)}>‹</button><span style={{padding:"7px 8px",fontSize:12}}>Page {pageNum} / {pdf?.numPages||0}</span><button type="button" className="text-button" disabled={!pdf||pageNum>=pdf.numPages} onClick={()=>setPageNum(p=>p+1)}>›</button><button type="button" className="text-button" disabled={zoom<=.6} onClick={()=>setZoom(z=>Math.max(.6,Number((z-.1).toFixed(2))))} aria-label="Zoom out">−</button><span aria-label="PDF zoom level" style={{fontSize:12,minWidth:42,textAlign:"center"}}>{Math.round(zoom*100)}%</span><button type="button" className="text-button" disabled={zoom>=1.8} onClick={()=>setZoom(z=>Math.min(1.8,Number((z+.1).toFixed(2))))} aria-label="Zoom in">+</button></div></div>
  {loading&&<div className="auth-message">Loading the actual controlled PDF…</div>}{error&&<div className="error-message action-feedback">{error}</div>}
  <div ref={hostRef} style={{position:"relative",width:pageSize.width,maxWidth:"100%",margin:"0 auto",background:"var(--surface)",boxShadow:"0 2px 16px rgba(0,0,0,.35)",overflow:"hidden"}}>
   <canvas ref={canvasRef} style={{display:"block",width:"100%",height:"auto"}}/>{pageError&&<div role="alert" style={{position:"absolute",inset:0,zIndex:30,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:10,padding:16,background:"rgba(255,255,255,.97)",color:"#7f1d1d",border:"2px solid #dc2626",overflowWrap:"anywhere"}}><strong>Page {pageNum} could not be displayed: {pageError.name}: {pageError.message}</strong><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" onClick={()=>setRenderRetry(value=>value+1)}>Retry</button><a href={url.startsWith("drive://")?"#":url} target="_blank" rel="noreferrer" onClick={event=>{if(url.startsWith("drive://")){event.preventDefault();openOriginalPdf(url,documentId,envelopeId,true).catch(error=>{console.error("Open original signing PDF failed",error);setPageError(describePdfPageError(error));});}}}>Open original file</a></div></div>}
   {mine.map(f=>{const value=fieldValues[f.fieldId]||"";const common={position:"absolute",left:f.x+"%",top:f.y+"%",width:f.width+"%",height:f.height+"%",boxSizing:"border-box",border:"2px solid var(--border)",background:"transparent",borderRadius:5,zIndex:5};if(f.type==="Signature"||f.type==="Initials"){const automatic=f.type==="Signature"?profile?.signatureUrl:profile?.initialsUrl;return <button type="button" key={f.fieldId} data-signature-field-id={f.fieldId} onClick={()=>activate(f)} style={{...common,padding:4,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{value?<SignatureImagePreview data-testid={"placed-"+f.fieldId} src={value} alt={f.type==="Signature"?"Inserted saved signature":"Inserted saved initials"}/>:<span style={{fontSize:11,fontWeight:700,color:"var(--text)"}}>{value?"CONFIRMED — TAP TO CHANGE":"TAP TO SIGN"}</span>}</button>;}if(f.type==="Date")return <button type="button" key={f.fieldId} onClick={()=>activate(f)} style={{...common,border:"2px solid var(--border)",color:"var(--text)",fontWeight:700,fontSize:12,textAlign:"left",padding:"4px",cursor:"pointer"}}>{value||"CLICK TO INSERT DATE"}</button>;return <input key={f.fieldId} value={value} onChange={e=>setValue(f,e.target.value)} placeholder={f.placeholder||("Enter "+f.type.toLowerCase())} type={f.type==="Number"?"number":"text"} style={{...common,padding:"4px 7px",color:"var(--text)",fontSize:12,outline:"none"}}/>})}
  </div>
  {isAdmin&&integrity?.legacy&&<div role="status" className="auth-message" style={{marginTop:12}}>Legacy envelope: no expected SHA-256 hash or byte length exists on the envelope or source document. The PDF was opened normally; integrity comparison was unavailable.</div>}{isAdmin&&integrity&&<SignatureIntegrityPanel bytes={integrity.bytes} fileId={integrity.fileId} storedHash={integrity.storedHash} storedSize={integrity.storedSize} actualHash={integrity.actualHash} actualSize={integrity.actualSize}/> }
  {inkField&&<SignatureFieldConfirmationPad field={inkField} savedSignatureUrl={profile?.signatureUrl||""} savedInitialsUrl={profile?.initialsUrl||""} onCancel={()=>setInkField(null)} onConfirm={async(value,confirmedField)=>{if(!confirmedField?.fieldId)throw new Error("The assigned signing field is no longer available.");setFieldValues(prev=>({...prev,[confirmedField.fieldId]:value}));setInkField(null);setError("");}}/>}
   <div className="success-message action-feedback" style={{marginTop:10}}>Green fields are assigned to you. Click your Signature/Initials/Date fields to apply them; enter editorial text, numbers, comments or remarks directly on the document.</div>
 </div>;
}

export default function SignaturePlatform({signerOnly=false,signingEnvelopeId=null,initialDocument=null}){
 const addSignerInFlightRef=useRef(false),signInFlightRef=useRef(false);const[gatewayEmailStatus,setGatewayEmailStatus]=useState(null),[gatewayEmailStatusBusy,setGatewayEmailStatusBusy]=useState(false),[trackingSnapshots,setTrackingSnapshots]=useState({}),[trackingBusy,setTrackingBusy]=useState(false);
 const[isAdmin,setIsAdmin]=useState(false);
 useEffect(()=>{let alive=true;(async()=>{try{const token=await auth.currentUser?.getIdTokenResult();if(alive)setIsAdmin(auth.currentUser?.email?.toLowerCase()==="irpa2412@gmail.com"||token?.claims?.admin===true);}catch{if(alive)setIsAdmin(auth.currentUser?.email?.toLowerCase()==="irpa2412@gmail.com");}})();return()=>{alive=false}},[]);
 const[tab,setTab]=useState("Profile"),[profile,setProfile]=useState(null),[signerIdentity,setSignerIdentity]=useState(null),[docs,setDocs]=useState([]),[envelopes,setEnvelopes]=useState([]),[signedDocuments,setSignedDocuments]=useState([]),[members,setMembers]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[revokeOpen,setRevokeOpen]=useState(false),[revokeBusy,setRevokeBusy]=useState(false);
 const[authorityMember,setAuthorityMember]=useState(null),[authorityEmployee,setAuthorityEmployee]=useState(null),[authorityRegisterEntries,setAuthorityRegisterEntries]=useState([]),[authorityDepartment,setAuthorityDepartment]=useState(""),[authorityUnit,setAuthorityUnit]=useState(""),[authorityRole,setAuthorityRole]=useState(""),[authorityStatus,setAuthorityStatus]=useState("Current"),[authorityReference,setAuthorityReference]=useState(""),[authorityEffectiveAt,setAuthorityEffectiveAt]=useState(""),[authorityExpiresAt,setAuthorityExpiresAt]=useState(""),[authorityBusy,setAuthorityBusy]=useState(false);
 const[displayName,setDisplayName]=useState(""),[initials,setInitials]=useState(""),[servedSignatureSrc,setServedSignatureSrc]=useState(""),[servedInitialsSrc,setServedInitialsSrc]=useState(""),[signatureFile,setSignatureFile]=useState(null),[initialsFile,setInitialsFile]=useState(null),[drawnSignature,setDrawnSignature]=useState(""),[replacementMode,setReplacementMode]=useState(false);
 const[manualSigningAuthority,setManualSigningAuthority]=useState("");const[title,setTitle]=useState(""),[documentId,setDocumentId]=useState(""),[documentUrl,setDocumentUrl]=useState(""),[signingMode,setSigningMode]=useState("Sequential"),[selectedSigner,setSelectedSigner]=useState(""),[draftEnvelopeId,setDraftEnvelopeId]=useState(null),[signerEmail,setSignerEmail]=useState(""),[signerName,setSignerName]=useState(""),[signerTitle,setSignerTitle]=useState(""),[signerRole,setSignerRole]=useState("Review"),[signerAuthorityRole,setSignerAuthorityRole]=useState(""),[signerCapacity,setSignerCapacity]=useState(""),[recipients,setRecipients]=useState([]),[fields,setFields]=useState([]),[activeAssigneeUid,setActiveAssigneeUid]=useState(""),[selectedField,setSelectedField]=useState(null),[preparationPage,setPreparationPage]=useState(1),[fieldValues,setFieldValues]=useState({}),[ownerSigningEnabled,setOwnerSigningEnabled]=useState(false),[initiateTitle,setInitiateTitle]=useState(""),[initiateDocumentId,setInitiateDocumentId]=useState(""),[initiateSigningMode,setInitiateSigningMode]=useState("Sequential"),[initiatedDocument,setInitiatedDocument]=useState(null),[signingCircle,setSigningCircle]=useState("Initiated"),[signDocumentPickerOpen,setSignDocumentPickerOpen]=useState(false),[signDocumentPickerMode,setSignDocumentPickerMode]=useState("source");
 useEffect(()=>{
   let cancelled=false;
   (async()=>{
     const resolveAsset=async(url)=>{
       const value=String(url||"");
       if(!value)return "";
       if(!value.startsWith("drive://"))return value;
       try{
         const bytes=await downloadSignatureBytes(value.slice("drive://".length));
         let binary="";
         const chunk=0x8000;
         for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
         return "data:image/png;base64,"+btoa(binary);
       }catch(error){
         return "";
       }
     };
     const [sig,init]=await Promise.all([
       resolveAsset(profile?.signatureUrl),
       resolveAsset(profile?.initialsUrl)
     ]);
     if(!cancelled){
       setServedSignatureSrc(sig);
       setServedInitialsSrc(init);
     }
   })();
   return()=>{cancelled=true};
 },[profile?.signatureUrl,profile?.initialsUrl]);
 useEffect(()=>{(async()=>{
    try{
      if(signerOnly){
        if(!signingEnvelopeId)throw new Error("No signing invitation was supplied.");

        const [envelope, signerProfile] = await Promise.all([
          getSignatureEnvelope(signingEnvelopeId),
          getMySignatureProfile()
        ]);

        setEnvelopes([envelope]);
        setSelected(envelope);
        setProfile(signerProfile);
        setSignerIdentity(await getMySignerIdentity());
        setDisplayName(signerProfile?.displayName||"");
        setInitials(signerProfile?.initials||"");
        setTab("Sign Document");
        return;
      }

      // Load the persisted Signature Profile first. It is the authoritative
      // source for the user's saved signing specimen and must remain visible
      // even if another portal query or trust-record refresh is temporarily
      // unavailable.
      let p=null;
      try{
        p=await getMySignatureProfile();
        setProfile(p);
        setDisplayName(p?.displayName||"");
        setInitials(p?.initials||"");
      }catch(profileError){
        console.error("Signature Profile retrieval failed:",profileError);
        setMessage("Unable to retrieve the saved Signature Profile. No signature data has been deleted.");
      }

      // The supporting workspace datasets are intentionally loaded separately.
      // A failure in Documents or Envelopes must not erase/hide the saved
      // Signature Profile from the panel after refresh.
      try{
        const d=await getControlledDocumentsForSigning();
        setDocs(d);
      }catch(error){
        console.warn("Controlled Documents unavailable:",error);
        setDocs([]);
        setMessage("Controlled document list could not be loaded. Check the document access authorization and try again.");
      }
      try{
        const e=await getSignatureEnvelopes();
        setEnvelopes(e);
      }catch(error){
        console.warn("Signature Envelopes unavailable:",error);
        setEnvelopes([]);
      }
      try{
        const signed=await getMySignedDocuments();
        setSignedDocuments(signed);
      }catch(error){
        console.warn("Signed-document archive unavailable:",error);
        setSignedDocuments([]);
      }

      try{
        const identity=await getMySignerIdentity();
        setSignerIdentity(identity);
        if(identity){
          setAuthorityRole(identity.authorityRole&&identity.authorityRole!=="Not yet assigned"?identity.authorityRole:"");
          setAuthorityStatus(identity.authorityStatus&&identity.authorityStatus!=="Unspecified"?identity.authorityStatus:"Current");
          setAuthorityReference(identity.authorityReference||"");
          setAuthorityEffectiveAt(identity.authorityEffectiveAt||"");
          setAuthorityExpiresAt(identity.authorityExpiresAt||"");
        }
        const [memberRecord,employeeRecord,registerEntries]=await Promise.all([
          getCurrentMemberProfile().catch(()=>null),
          getCurrentEmployeeProfile().catch(()=>null),
          getCurrentSigningAuthorityRegisterEntries().catch(()=>[])
        ]);
        setAuthorityMember(memberRecord);
        setAuthorityEmployee(employeeRecord);
        setAuthorityRegisterEntries(Array.isArray(registerEntries)?registerEntries:[]);
        setAuthorityDepartment(identity?.authorityDepartment||registerEntries?.find(x=>x.department)?.department||employeeRecord?.department||memberRecord?.department||"");
        setAuthorityUnit(identity?.authorityUnit||registerEntries?.find(x=>x.department===(identity?.authorityDepartment||""))?.unit||registerEntries?.find(x=>x.department===(identity?.authorityDepartment||""))?.unitName||employeeRecord?.unit||employeeRecord?.unitName||memberRecord?.unit||memberRecord?.unitName||"");
      }catch(identityError){
        console.warn("IRPA Signature Portal: Signer Identity record unavailable.",identityError);
        setSignerIdentity(null);
        setMessage("Signer Identity trust record is not currently available. Your existing Signature Profile remains available and has not been changed.");
      }

      // Load both institutional registers. Board-member registrations commonly
      // use registrationStatus="Registered" rather than status="Active", so
      // accept registered members only when linked to an Auth UID and not
      // explicitly inactive. Never substitute a Firestore record ID for an Auth UID.
      const [memberRows,employeeRows]=await Promise.all([
        getRecords("members").catch(error=>{console.warn("Signature member register unavailable:",error);return null}),
        getRecords("employees").catch(error=>{console.warn("Signature employee register unavailable:",error);return null})
      ]);
      const safeEmployeeRows=Array.isArray(employeeRows)?employeeRows:[];
      // Older Board Member Register records may lack an Auth UID even when
      // the same registered officer has an authenticated Employee Register
      // record. Link only by a unique, exact normalized email match to an
      // active employee record; never treat a Firestore document ID as a UID.
      const employeeUidsByEmail=new Map();
      for(const employee of safeEmployeeRows){
        const email=String(employee.email||"").trim().toLowerCase();
        const uid=String(employee.uid||employee.firebaseAuthUid||employee.authUid||"").trim();
        const status=String(employee.status||employee.employmentStatus||employee.accountStatus||"").trim().toLowerCase();
        if(email&&uid&&["active","activated","current"].includes(status)){
          const existing=employeeUidsByEmail.get(email)||[];
          if(!existing.includes(uid))existing.push(uid);
          employeeUidsByEmail.set(email,existing);
        }
      }
      const candidates=[
        ...safeEmployeeRows.map(x=>({...x,registerType:"Employee Register"})),
        ...(Array.isArray(memberRows)?memberRows.map(x=>{
          const email=String(x.email||"").trim().toLowerCase();
          const existingUid=String(x.uid||x.firebaseAuthUid||x.authUid||"").trim();
          const linkedUids=employeeUidsByEmail.get(email)||[];
          const linkedUid=!existingUid&&linkedUids.length===1?linkedUids[0]:"";
          return {...x,...(!existingUid&&linkedUid?{uid:linkedUid}:{}),registerType:"Board Member Register"};
        }):[])
      ];
      const activeCandidates=candidates.filter(x=>{
        const status=String(x.status||x.employmentStatus||x.accountStatus||x.memberStatus||"").trim().toLowerCase();
        const registration=String(x.registrationStatus||"").trim().toLowerCase();
        const uid=String(x.uid||x.firebaseAuthUid||x.authUid||"").trim();
        const inactive=["inactive","suspended","revoked","terminated","disabled","rejected","cancelled"].includes(status)||["inactive","suspended","revoked","terminated","disabled","account pending","registered — account pending","registered - account pending"].includes(registration)||x.active===false||x.accountActivated===false;
        const active=["active","activated","current"].includes(status)||x.active===true||x.accountActivated===true||
          (x.registerType==="Board Member Register"&&["registered","active","activated","current"].includes(registration));
        return Boolean(uid&&x.email&&active&&!inactive);
      });
      const uniqueCandidates=[...new Map(activeCandidates.map(x=>{
        const uid=String(x.uid||x.firebaseAuthUid||x.authUid).trim();
        return [uid,{...x,uid,name:x.name||x.fullName||x.displayName||x.email,registerType:x.registerType||"Institutional Register"}];
      })).values()];
      setMembers(uniqueCandidates);
    }catch(x){
      setMessage(x.message||"Unable to load Signature Portal.")
    }
  })()},[signerOnly,signingEnvelopeId]);
 useEffect(()=>{if(!initialDocument?.id)return;const url=controlledPdfUrl(initialDocument);setDocs(prev=>[initialDocument,...prev.filter(d=>d.id!==initialDocument.id)]);setInitiateDocumentId(initialDocument.id);setInitiatedDocument(initialDocument);setDocumentId(initialDocument.id);setDocumentUrl(url);setTitle(initialDocument.title||initialDocument.reference||initialDocument.fileName||"Signing Document");setInitiateTitle(initialDocument.title||initialDocument.reference||initialDocument.fileName||"Signing Document");setDraftEnvelopeId(null);setFields([]);setRecipients([]);setActiveAssigneeUid("");setSelectedField(null);if(initialDocument.signatureEnvelopeId){setSigningCircle("Signing Circle");setTab("Envelopes");setMessage("This document already has a signature envelope. Opening its existing signing transaction…");return;}setSigningCircle("Document Selected");setTab("Prepare Envelope");setMessage(url? `Document "${initialDocument.title||initialDocument.fileName||initialDocument.id}" is selected. The PDF is ready for field placement and signer assignment.`:"Document selected, but no usable PDF URL was found. Re-select the controlled PDF before assigning fields.")},[initialDocument]);
 useEffect(()=>{if(signerOnly||!initialDocument?.signatureEnvelopeId)return;const envelopeId=String(initialDocument.signatureEnvelopeId);const envelope=envelopes.find(item=>String(item.id||"")===envelopeId||String(item.gatewayEnvelopeId||"")===envelopeId);if(envelope){setSelected(envelope);setTab("Sign Document");setSigningCircle("Signing Circle");setMessage(`Opened the existing signature envelope for ${initialDocument.title||initialDocument.reference||initialDocument.id}.`);return;}if(envelopes.length>0){setTab("Envelopes");setMessage("This document is already at the envelope stage, but its existing envelope is not visible to this account. Check the envelope assignment and access permissions; a duplicate envelope was not created.");}},[initialDocument?.signatureEnvelopeId,envelopes,signerOnly]);
 useEffect(()=>{if(signerOnly||initialDocument?.id)return;const context=readWorkflowContext();if(context?.documentId){setInitiateDocumentId(context.documentId);setTab("Sign a Document");setSigningCircle("Initiated");setMessage(`Signing initiated from ${context.module||"a governance portal"} for document ${context.documentReference||context.documentId}.`)}else if(context?.meetingId||context?.authorizationRequestId){setTab("Sign a Document");setSigningCircle("Initiated");setMessage(`Signing initiated from ${context.module||"a governance portal"}. Select a document from the archive or upload a new document.`)}},[signerOnly,initialDocument]);
 const selectedDoc=useMemo(()=>docs.find(x=>x.id===documentId),[docs,documentId]);
 const documentOwner=useMemo(()=>({uid:auth.currentUser?.uid,identityType:"account",name:auth.currentUser?.displayName||auth.currentUser?.email||"Document Owner",email:auth.currentUser?.email||"",role:"Document Owner",routingOrder:1,status:"Owner"}),[auth.currentUser?.uid,auth.currentUser?.displayName,auth.currentUser?.email]);
 const workflowRecipients=useMemo(()=>[...(ownerSigningEnabled?[{...documentOwner,optionalSigning:false,actionRequired:true}]:[]),...recipients.filter(r=>r.uid!==documentOwner.uid).map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+(ownerSigningEnabled?2:1):r.routingOrder||1}))],[documentOwner,recipients,signingMode,ownerSigningEnabled]);
 useEffect(()=>{if(selectedDoc){setDocumentUrl(controlledPdfUrl(selectedDoc))}else setDocumentUrl("")},[selectedDoc]);
 async function revokeApplication(){
  if(!profile||revokeBusy)return;
  setRevokeBusy(true);setMessage("Revoking your Signature Application…");
  try{
    const result=await revokeSignatureApplication();
    const updated={...profile,status:"Revoked",revokedAt:new Date().toISOString(),revokedByUid:auth.currentUser?.uid||""};
    setProfile(updated);
    setSignerIdentity(await getMySignerIdentity());
    setRevokeOpen(false);
    setServedSignatureSrc("");setServedInitialsSrc("");
    setMessage(result?.alreadyRevoked?"Your Signature Application is already revoked.":"Your Signature Application has been revoked by you, the Signature Profile owner. It cannot be used for signing until you establish an active Signature Profile again.");
  }catch(error){setMessage("REVOCATION FAILED: "+(error?.message||"No change was made."));}
  finally{setRevokeBusy(false)}
 }
 async function migrateProfileNow(){if(busy)return;setBusy(true);setMessage("Migrating your existing Signature Profile into the new Signer Identity layer…");try{const result=await migrateExistingSignatureProfile();if(result?.identity)setSignerIdentity(result.identity);setMessage(result?.migrated?"Migration verified. Your existing Signature Profile was retained and linked to the new Signer Identity record.":"No existing Signature Profile was found to migrate.");}catch(error){setMessage("MIGRATION FAILED: "+(error?.message||"No changes were made."));}finally{setBusy(false)}}
 const authorityRegisterRecords=useMemo(()=>{
   const sourceEntries=authorityRegisterEntries.length?authorityRegisterEntries:[authorityMember,authorityEmployee].filter(Boolean);
   const records=[];
   for(const record of sourceEntries){
     const sourceCollection=record.sourceCollection||"register";
     const department=String(record.department||"").trim();
     const unit=String(record.unit||record.unitName||"").trim();
     const values=[
       record.role,record.boardPosition,
       ...(Array.isArray(record.roles)?record.roles:[]),
       ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
       ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
       ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
     ].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
     for(const value of [...new Set(values)]){
       records.push({...record,sourceCollection,sourceRecordId:record.id||record.uid||"",department,unit,role:value});
     }
   }
   return records.filter(item=>item.department||item.unit||item.role);
 },[authorityRegisterEntries,authorityMember,authorityEmployee]);
 const authorityDepartments=useMemo(()=>{
   // Department choices are derived from the authenticated user's institutional
   // records. Employee register data is the primary source; signing-authority
   // register entries may add only departments already recorded for this user.
   const employeeDepartments=[
     authorityEmployee?.department,
     ...(Array.isArray(authorityEmployee?.departments)?authorityEmployee.departments:[])
   ].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
   const registeredDepartments=authorityRegisterRecords
     .map(x=>String(x.department||"").trim())
     .filter(Boolean);
   const memberDepartments=[
     authorityMember?.department,
     ...(Array.isArray(authorityMember?.departments)?authorityMember.departments:[])
   ].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
   const source=employeeDepartments.length
     ? [...employeeDepartments,...registeredDepartments]
     : [...registeredDepartments,...memberDepartments];
   return [...new Set(source)];
 },[authorityRegisterRecords,authorityEmployee,authorityMember]);
 const authorityOptions=useMemo(()=>{
   const department=String(authorityDepartment||"").trim().toLowerCase();
   if(department==="board of directors"){
     // Board capacity is a fixed five-role institutional selector aligned to
     // the approved role catalogue. Keep Board Member singular for exact matching.
     return [
       {role:"Board Chairperson",unit:"Board of Directors",sourceCollection:"governance",sourceRecordId:"board-chairperson"},
       {role:"Board Vice Chairperson",unit:"Board of Directors",sourceCollection:"governance",sourceRecordId:"board-vice-chairperson"},
       {role:"Board Secretary",unit:"Board of Directors",sourceCollection:"governance",sourceRecordId:"board-secretary"},
       {role:"Board Treasurer",unit:"Board of Directors",sourceCollection:"governance",sourceRecordId:"board-treasurer"},
       {role:"Board Member",unit:"Board of Directors",sourceCollection:"governance",sourceRecordId:"board-member"}
     ];
   }
   const options=[];
   for(const record of authorityRegisterRecords.filter(x=>x.department===authorityDepartment)){
     const values=[
       record.role,record.boardPosition,record.designation,record.jobTitle,record.position,record.title,record.authorityRole,record.unit,record.unitName,
       ...(Array.isArray(record.roles)?record.roles:[]),
       ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
       ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
       ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
     ].flatMap(value=>{
       const candidates=value&&typeof value==="object"?[value.role,value.title,value.designation,value.position]:[value];
       return candidates.flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
     });
     for(const role of [...new Set(values)]){
       if(!options.some(x=>x.role.toLowerCase()===role.toLowerCase())){
         options.push({role,unit:record.unit||record.unitName||"",sourceCollection:record.sourceCollection,sourceRecordId:record.sourceRecordId});
       }
     }
   }
   return options.sort((a,b)=>a.role.localeCompare(b.role));
 },[authorityRegisterRecords,authorityDepartment]);
 const authorityDisplayLabel=(role,department=authorityDepartment)=>{
   const normalized=String(role||"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
   if(String(department||"").trim().toLowerCase()==="board of directors"){
     if(/(^| )chairperson$|^board chairperson$|^chairman$|^chairwoman$/.test(normalized)) return "Board Chairperson";
     if(/(^| )vice chairperson$|^board vice chairperson$|^vice chairman$|^vice chairwoman$/.test(normalized)) return "Board Vice Chairperson";
     if(/(^| )board secretary$|^secretary$/.test(normalized)) return "Board Secretary";
     if(normalized==="board member"||normalized==="board members") return "Board Member";
   }
   return role;
 };
 const authorityCapacityPriority=(role,department=authorityDepartment)=>{
   const label=authorityDisplayLabel(role,department);
   if(label==="Board Chairperson")return 0;
   if(label==="Board Vice Chairperson")return 1;
   if(label==="Board Secretary")return 2;
   if(label==="Board Members")return 3;
   return 4;
 };
 const isPermanentExecutiveAuthority=(department=authorityDepartment,role=authorityRole)=>{
   const d=String(department||"").trim().toLowerCase();
   const r=String(role||"").trim().toLowerCase();
   return d==="executive office"&&(r==="executive director"||r==="executive office");
 };
 const isBoardMemberAuthority=(department=authorityDepartment,role=authorityRole)=>{
   const d=String(department||"").trim().toLowerCase();
   const r=String(role||"").trim().toLowerCase();
   return d==="board of directors"&&(r==="board member"||r==="board members");
 };
 async function saveSignerAuthority(e){
   e.preventDefault();
   if(authorityBusy)return;
   if(!authorityDepartment||!authorityRole){
     setMessage("Select the registered department and current signing authority before saving.");
     return;
   }
   setAuthorityBusy(true);
   setMessage("Saving your registered signing authority…");
   try{
     const selectedAuthority=authorityOptions.find(x=>x.role===authorityRole);
     await updateMySignerAuthority({
       authorityRole,
       authorityStatus:isPermanentExecutiveAuthority()?"Current":authorityStatus,
       authorityReference,
       authorityEffectiveAt:isBoardMemberAuthority()?authorityEffectiveAt:"",
       authorityExpiresAt:isBoardMemberAuthority()?authorityExpiresAt:"",
       authorityDepartment,
       authorityUnit:selectedAuthority?.unit||authorityUnit||authorityDepartment
     });
     // Re-read the persisted trust record from Firestore. Do not rely on the
     // callable response shape, because the identity panel must reflect the
     // exact record that will survive a full page refresh.
     const persisted=await getMySignerIdentity();
     if(!persisted)throw new Error("The authority update returned without a persisted Signer Identity record.");
     setSignerIdentity(persisted);
     setAuthorityRole(persisted.authorityRole||"");
     setAuthorityStatus(persisted.authorityStatus||"Current");
     setAuthorityReference(persisted.authorityReference||"");
     setAuthorityEffectiveAt(persisted.authorityEffectiveAt||"");
     setAuthorityExpiresAt(persisted.authorityExpiresAt||"");
     setAuthorityDepartment(persisted.authorityDepartment||authorityDepartment);
     setAuthorityUnit(persisted.authorityUnit||authorityUnit||persisted.authorityDepartment||"");
     setMessage("SUCCESS: the current signing authority is saved and re-read from the persistent Signer Identity record.");
   }catch(error){
     setMessage("SIGNING AUTHORITY UPDATE FAILED: "+(error?.message||"No changes were made."));
   }finally{setAuthorityBusy(false)}
 }
 async function saveProfile(e){e.preventDefault();setBusy(true);setMessage("");try{let file=signatureFile;if(!file&&drawnSignature){const blob=await(await fetch(drawnSignature)).blob();file=new File([blob],"IRPA-handwritten-signature.png",{type:"image/png"})}if(!file)throw new Error("Upload a signature image or use the on-screen signing pad.");const p=await saveMySignatureProfile({signatureFile:file,initialsFile,displayName,initials,method:drawnSignature?"Direct Handwritten Capture":"Upload"});setProfile(p);setSignatureFile(null);setInitialsFile(null);setDrawnSignature("");e.target.reset();setMessage(drawnSignature?"Handwritten signature captured and saved to your Signature Profile.":"Signature profile saved successfully.")}catch(x){setMessage(x.message||"Unable to save signature profile.")}finally{setBusy(false)}}
 async function saveDrawnSignature(dataUrl){if(busy)throw new Error("A signature save is already in progress.");if(!String(displayName||"").trim())throw new Error("Enter your Display name before saving the signature specimen.");setBusy(true);setMessage("Saving your handwritten signature to your Signature Profile…");try{const blob=await(await fetch(dataUrl)).blob();const file=new File([blob],"IRPA-handwritten-signature.png",{type:"image/png"});const p=await saveMySignatureProfile({signatureFile:file,initialsFile,displayName,initials,method:"Direct Handwritten Capture"});setProfile(p);setDrawnSignature("");setSignatureFile(null);setReplacementMode(false);setMessage("SUCCESS: your handwritten signature is now the CURRENT SIGNATURE and will be reused for future documents.");return p;}catch(x){const msg=x?.message||"Unable to save the signature specimen.";setMessage("ERROR: "+msg);throw x}finally{setBusy(false)}}
 async function addSigner(){
  if(addSignerInFlightRef.current||busy)return;
  const email=String(signerEmail||"").trim().toLowerCase();
  const registered=selectedSigner?members.find(x=>x.uid===selectedSigner):null;
  if(!registered&&!email){setMessage("Select a registered officer or enter a signer name and email address.");return;}
  if(!title.trim()){setMessage("Enter the envelope title before adding a signer.");return;}
  if(!documentId||!documentUrl){setMessage("Select a controlled PDF before adding a signer.");return;}
  const registeredEmail=String(registered?.email||email).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registeredEmail)){setMessage("The selected participant must have a valid email address before they can be assigned.");return;}if(!registered&&!String(signerName||"").trim()){setMessage("Enter the signer’s full name as well as their email address.");return;}
  const ownerEmail=String(documentOwner.email||"").trim().toLowerCase();
  const isOwnerDuplicate=!!(registered&&registered.uid===documentOwner.uid)||(!!registeredEmail&&!!ownerEmail&&registeredEmail===ownerEmail);
  if(isOwnerDuplicate){
    setOwnerSigningEnabled(true);
    setActiveAssigneeUid(documentOwner.uid);
    setSelectedSigner("");
    setSignerEmail("");
     setSignerName("");setSignerTitle("");
    setSignerRole("Review");
    setSignerAuthorityRole("");
    setSignerCapacity("");
    setMessage("This address belongs to the document owner. The owner has been selected once; no separate signer record was created. Assign the owner's field using the palette.");
    return;
  }
  const duplicate=recipients.find(x=>(registered&&x.uid===registered.uid)||(registeredEmail&&String(x.email||"").trim().toLowerCase()===registeredEmail));
  const role=signerRole||"Review";
  const capacity=String(signerCapacity||"").trim();
  const assignment={role,title:String(signerTitle||"").trim(),capacity,occupation:String(signerAuthorityRole||"").trim(),assignedAt:new Date().toISOString()};
  if(duplicate){
    const existingAssignments=Array.isArray(duplicate.roleAssignments)&&duplicate.roleAssignments.length?duplicate.roleAssignments:[{role:duplicate.role||"Review",capacity:String(duplicate.capacity||"").trim(),occupation:String(duplicate.occupation||"").trim()}];
    const sameAssignment=existingAssignments.some(item=>String(item.role||"").trim().toLowerCase()===role.trim().toLowerCase()&&String(item.title||"").trim().toLowerCase()===String(signerTitle||"").trim().toLowerCase()&&String(item.capacity||"").trim().toLowerCase()===capacity.toLowerCase());
    if(sameAssignment){
      setActiveAssigneeUid(duplicate.uid);setSelectedSigner("");setSignerEmail("");setSignerName("");setSignerTitle("");setSignerRole(role);setSignerAuthorityRole(assignment.occupation);setSignerCapacity(capacity);
      setMessage((duplicate.name||duplicate.email||"This signer")+" already has the "+role+" responsibility"+(capacity?" ("+capacity+")":"")+". The existing responsibility was selected; no duplicate was created.");return;
    }
    const updatedRecipient={...duplicate,roleAssignments:[...existingAssignments,assignment]};
    const updatedRecipients=recipients.map(item=>item.uid===duplicate.uid?updatedRecipient:item);
    addSignerInFlightRef.current=true;setBusy(true);
    try{
      const saved=await saveSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,signingMode,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",documentType:selectedDoc?.documentType||"Governance Document",documentUploadedAt:selectedDoc?.uploadedAt||selectedDoc?.documentTypeSelectedAt||null,recipients:updatedRecipients,fields,ownerSigningEnabled});
      setDraftEnvelopeId(saved.id);setRecipients(updatedRecipients);setActiveAssigneeUid(duplicate.uid);setSelectedSigner("");setSignerEmail("");setSignerName("");setSignerTitle("");setSignerRole("Review");setSignerAuthorityRole("");setSignerCapacity("");
      setMessage((duplicate.name||duplicate.email||"This signer")+" now has an additional responsibility: "+role+(capacity?" ("+capacity+")":"")+". One email-link identity and invitation covers the responsibilities; assign the relevant fields to this signer.");
    }catch(error){setMessage("The additional responsibility was not saved: "+(error?.message||"Unable to update the signer assignment."));}
    finally{addSignerInFlightRef.current=false;setBusy(false);}
    return;
  }
    addSignerInFlightRef.current=true;
  setBusy(true);
  setMessage("Adding this participant to the document and saving the signer assignment…");
  try{
    let next;
    if(registered){
      next={uid:registered.uid,identityType:"account",name:registered.name||registered.email,email:registeredEmail,role,institutionalRole:registered.boardPosition||registered.role||"",title:String(signerTitle||registered.jobTitle||registered.boardPosition||"").trim(),occupation:signerAuthorityRole.trim(),capacity:signerCapacity.trim(),routingOrder:signingMode==="Sequential"?recipients.length+2:1,status:"Pending"};
    }else{
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Enter a valid email address for the external participant.");
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(email));
      const emailHash=Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,"0")).join("");
      next={uid:"email-link-"+emailHash.slice(0,24),identityType:"email-link",name:String(signerName||"").trim(),email,role,institutionalRole:"",title:String(signerTitle||"").trim(),occupation:signerAuthorityRole.trim(),capacity:signerCapacity.trim(),routingOrder:signingMode==="Sequential"?recipients.length+2:1,status:"Pending",emailLinkStatus:"Not issued"};
    }
    const nextRecipients=[...recipients,next];
    const nextFields=[...fields];
    
    const saved=await saveSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,signingMode,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",documentType:selectedDoc?.documentType||"Governance Document",documentUploadedAt:selectedDoc?.uploadedAt||selectedDoc?.documentTypeSelectedAt||null,recipients:nextRecipients,fields:nextFields,ownerSigningEnabled});
    setDraftEnvelopeId(saved.id);
    setRecipients(nextRecipients);
    setFields(nextFields);
    setActiveAssigneeUid(next.uid);
    setSelectedSigner("");
    setSignerEmail("");
     setSignerName("");setSignerTitle("");
    setSignerRole("Review");
    setSignerAuthorityRole("");
    setSignerCapacity("");
    setMessage((registered?(registered.name||registered.email):email)+" added once and selected in the palette. Choose Signature, Initials or another field tool, then tap the PDF to assign their action.");
  }catch(x){setMessage("Participant was not added: "+(x.message||"Unable to save the workflow."));}
  finally{addSignerInFlightRef.current=false;setBusy(false);}
}
 function removeSigner(uid){if(!uid||uid===documentOwner.uid)return;const removed=recipients.find(r=>r.uid===uid);if(!removed)return;setRecipients(prev=>prev.filter(r=>r.uid!==uid));setFields(prev=>prev.map(f=>f.signerUid===uid?{...f,signerUid:""}:f));setActiveAssigneeUid(current=>current===uid?(ownerSigningEnabled?documentOwner.uid:(recipients.find(r=>r.uid!==uid)?.uid||"")):current);setMessage(`${removed.name||"Officer"} removed from the signer list. Their fields are now unassigned and can be reassigned in the palette.`)}
 function moveSigner(uid,direction){const index=recipients.findIndex(r=>r.uid===uid);const next=index+direction;if(index<0||next<0||next>=recipients.length)return;const copy=[...recipients];[copy[index],copy[next]]=[copy[next],copy[index]];setRecipients(copy.map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+(ownerSigningEnabled?2:1):r.routingOrder||1})));}
 function changeOwnerSigning(checked){setOwnerSigningEnabled(checked);if(checked)setActiveAssigneeUid(documentOwner.uid);else if(activeAssigneeUid===documentOwner.uid)setActiveAssigneeUid(recipients[0]?.uid||"");}
 async function initiateSigning(e){e.preventDefault();if(busy)return;setBusy(true);setMessage("");try{if(profile?.status!=="Active")throw new Error("Your Signature Application must be Active before you can initiate signing.");if(!initiateTitle.trim())throw new Error("Enter a document signing title.");if(!initiateDocumentId)throw new Error("Select a controlled document to initiate signing.");const source=docs.find(d=>d.id===initiateDocumentId);if(!source)throw new Error("The selected controlled document could not be found.");const url=controlledPdfUrl(source);if(!url)throw new Error("The selected controlled document has no usable PDF file.");const saved=await saveSignatureWorkflowDraft({title:initiateTitle.trim(),documentId:source.id,documentReference:source.reference||source.title||source.id,documentUrl:url,signingMode:initiateSigningMode,documentClassification:source.classification||source.accessLevel||"Public",documentArchiveCategory:source.archiveCategory||"Administrative Documents",documentType:source.documentType||"Governance Document",documentUploadedAt:source.uploadedAt||source.documentTypeSelectedAt||null,recipients:[],fields:[],ownerSigningEnabled:false});setDraftEnvelopeId(saved.id);setTitle(initiateTitle.trim());setDocumentId(source.id);setDocumentUrl(url);setSigningMode(initiateSigningMode);setRecipients([]);setFields([]);setActiveAssigneeUid("");setSelectedField(null);setInitiatedDocument(source);setInitiateTitle("");setInitiateDocumentId(source.id);setSigningCircle("Prepared");setTab("Prepare Envelope");setMessage(`${saved.envelopeReference} initiated. The signing circle is now open: assign officers, place fields and route the document.`);}catch(x){console.error("IRPA Signature Portal: Sign a Document initiation failed",x);setMessage(`SIGN A DOCUMENT was not initiated: ${x.message||"Unable to initiate signing."}`)}finally{setBusy(false)}}
 async function createEnvelope(e){
  e.preventDefault();
  if(busy)return;
  setMessage("Create Draft Envelope clicked. Checking the document and required fields…");setBusy(true);
  try{
    if(!title.trim())throw new Error("Enter an envelope title before creating the draft.");
    if(!documentId||!documentUrl)throw new Error("Select a controlled PDF before creating the draft envelope.");
    if(ownerSigningEnabled&&!fields.some(f=>f?.type==="Signature"&&f.required!==false&&f.signerUid===documentOwner.uid))throw new Error("Explicitly assign a required Signature field to the document owner before creating the envelope.");
    const orderedRecipients=recipients.filter(r=>r.uid!==documentOwner.uid).map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+(ownerSigningEnabled?2:1):r.routingOrder||1}));
    const seenSignerUids=new Set([documentOwner.uid]);
    const ownerEmailKey=String(documentOwner.email||"").trim().toLowerCase();
    const seenSignerEmails=new Set(ownerEmailKey?[ownerEmailKey]:[]);
    const duplicateRecipients=[];
    for(const recipient of orderedRecipients){
      const uid=String(recipient.uid||"").trim();
      const emailKey=String(recipient.email||"").trim().toLowerCase();
      if(!uid)throw new Error("Every participant must have a unique signer identity before the envelope can be created.");
      if(seenSignerUids.has(uid)||(emailKey&&seenSignerEmails.has(emailKey))){duplicateRecipients.push(recipient);continue;}
      seenSignerUids.add(uid);
      if(emailKey)seenSignerEmails.add(emailKey);
    }
    if(duplicateRecipients.length)throw new Error("Duplicate participants were detected by signer identity or email: "+duplicateRecipients.map(recipient=>recipient.name||recipient.email).join(", ")+". Remove duplicate people in the palette and reassign their fields before creating the envelope.");
    const signerUids=new Set([...orderedRecipients.map(r=>r.uid),...(ownerSigningEnabled?[documentOwner.uid]:[])]);
    if(!orderedRecipients.length&&!ownerSigningEnabled)throw new Error("Add at least one participant in the PDF palette before creating the envelope.");
    const recipientsWithoutFields=orderedRecipients.filter(recipient=>!fields.some(field=>field.signerUid===recipient.uid));
    if(recipientsWithoutFields.length)throw new Error("Assign at least one field to each participant in the palette before creating the envelope: "+recipientsWithoutFields.map(recipient=>recipient.name||recipient.email).join(", ")+".");
    if(fields.some(f=>!f.signerUid||!signerUids.has(f.signerUid)))throw new Error("Assign every field to the document owner or an assigned signer before creating the envelope.");
    setMessage("All checks passed. Saving the draft envelope and its field assignments…");
    let env=draftEnvelopeId
      ?await finalizeSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",documentType:selectedDoc?.documentType||"Governance Document",documentUploadedAt:selectedDoc?.uploadedAt||selectedDoc?.documentTypeSelectedAt||null,signingMode,recipients:orderedRecipients,fields,ownerSigningEnabled})
      :await createSignatureEnvelope({title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",documentType:selectedDoc?.documentType||"Governance Document",documentUploadedAt:selectedDoc?.uploadedAt||selectedDoc?.documentTypeSelectedAt||null,signingMode,recipients:orderedRecipients,fields,ownerSigningEnabled});
    setEnvelopes(prev=>[env,...prev.filter(item=>item.id!==env.id)]);
    setDraftEnvelopeId(null);setTitle("");setDocumentId("");setDocumentUrl("");setRecipients([]);setFields([]);setActiveAssigneeUid("");setSelectedField(null);setOwnerSigningEnabled(false);setTab("Envelopes");
    setMessage("Draft envelope saved. No invitations have been sent. Select Start Workflow when ready to issue secure email-link invitations to the assigned signers.");
  }catch(x){
    console.error("IRPA Signature Portal: Create Draft Envelope failed",{errorType:x?.name||"Error"});
    setMessage((draftEnvelopeId?"Draft saved; email-link setup did not finish: ":"Create Draft Envelope was not completed: ")+(x.message||"Unable to create envelope."));
  }finally{setBusy(false);}
}
 async function saveAndClosePreparation(){
  if(busy)return;
  setBusy(true);setMessage("Saving the current signing preparation as an inactive draft…");
  try{
    const orderedRecipients=recipients.filter(r=>r.uid!==documentOwner.uid).map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+(ownerSigningEnabled?2:1):r.routingOrder||1}));
    const saved=await saveSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",documentType:selectedDoc?.documentType||"Governance Document",documentUploadedAt:selectedDoc?.uploadedAt||selectedDoc?.documentTypeSelectedAt||null,signingMode,recipients:orderedRecipients,fields,ownerSigningEnabled});
    setEnvelopes(previous=>[saved,...previous.filter(item=>item.id!==saved.id)]);
    setSelected(saved);setDraftEnvelopeId(saved.id);setTab("Envelopes");
    setMessage("Preparation saved and closed by the document owner. The draft remains inactive; no signer invitations were sent. Reopen it with Continue Preparation or start the workflow when ready.");
  }catch(error){setMessage("Preparation was not closed: "+(error?.message||"Unable to save the draft."));}
  finally{setBusy(false);}
 }
 async function refreshDocumentTracking(){
  if(trackingBusy)return;
  setTrackingBusy(true);
  try{
    const uid=auth.currentUser?.uid;
    const visible=envelopes.filter(e=>e.gatewayEnvelopeId&&(e.ownerUid===uid||e.senderUid===uid));
    const rows=await Promise.all(visible.map(async envelope=>{
      try{return [envelope.id,await getGatewaySignatureEnvelopeStatus(envelope.gatewayEnvelopeId)];}
      catch(error){return [envelope.id,{error:error?.message||"Live holder status unavailable"}];}
    }));
    setTrackingSnapshots(previous=>({...previous,...Object.fromEntries(rows)}));
    const refreshed=rows.filter(([,status])=>!status.error).length;
    setMessage("Document tracking refreshed: "+refreshed+" of "+visible.length+" live Gateway workflow(s) verified. Drafts remain visible as preparation records.");
  }catch(error){setMessage(error?.message||"Unable to refresh document tracking.");}
  finally{setTrackingBusy(false);}
 }
 async function refreshGatewayEmailStatus(){
  if(!selected?.gatewayEnvelopeId)return;
  setGatewayEmailStatusBusy(true);
  try{
   const [status,delivery]=await Promise.all([
    getGatewaySignatureEnvelopeStatus(selected.gatewayEnvelopeId),
    getGatewaySignatureEnvelopeDeliveryStatus(selected.gatewayEnvelopeId)
   ]);
   const deliveryBySigner=new Map((delivery.signers||[]).map(signer=>[signer.id,signer]));
   const signers=(status.signers||[]).map(signer=>{
    const deliverySigner=deliveryBySigner.get(signer.id)||{};
    return {...deliverySigner,...signer,invitation:deliverySigner.invitation??signer.invitation};
   });
   setGatewayEmailStatus({...status,signers});
   setMessage("Envelope and invitation delivery status refreshed. Resend options are available for eligible email-link signers.");
  }catch(error){setMessage(error.message||"Unable to retrieve email-link invitation status.");}
  finally{setGatewayEmailStatusBusy(false);}
 }
 async function resendEmailLink(signerId){
  if(!selected?.gatewayEnvelopeId)return;
  setGatewayEmailStatusBusy(true);
  try{await resendGatewayEmailInvitation(selected.gatewayEnvelopeId,signerId);const status=await getGatewaySignatureEnvelopeStatus(selected.gatewayEnvelopeId);setGatewayEmailStatus(status);setMessage("A new email-link invitation was sent. The previous link has been revoked.");}
  catch(error){setMessage(error.message||"Unable to resend the email-link invitation.");}
  finally{setGatewayEmailStatusBusy(false);}
 }
 async function revokeEmailLink(signerId){
  if(!selected?.gatewayEnvelopeId)return;
  setGatewayEmailStatusBusy(true);
  try{await revokeGatewayEmailInvitation(selected.gatewayEnvelopeId,signerId);const status=await getGatewaySignatureEnvelopeStatus(selected.gatewayEnvelopeId);setGatewayEmailStatus(status);setMessage("The email signing link has been revoked.");}
  catch(error){setMessage(error.message||"Unable to revoke the email-link invitation.");}
  finally{setGatewayEmailStatusBusy(false);}
 }
 async function retryCompletedDistribution(){
  if(!selected?.gatewayEnvelopeId)return;
  setGatewayEmailStatusBusy(true);
  try{
    const result=await retryGatewaySignatureDistribution(selected.gatewayEnvelopeId);
    const status=await getGatewaySignatureEnvelopeStatus(selected.gatewayEnvelopeId);
    setGatewayEmailStatus(status);
    const delivery=result.distribution||status.distribution||{};
    setMessage(delivery.failed?("Retry finished. "+delivery.sent+" recipient email(s) delivered; "+delivery.failed+" remain failed."):("Completed-document distribution retry finished. "+delivery.sent+" recipient email(s) are recorded as delivered."));
  }catch(error){setMessage(error.message||"Unable to retry completed-document email delivery.");}
  finally{setGatewayEmailStatusBusy(false);}
 }
 async function sign(){
  if(signInFlightRef.current||busy)return;
  if(!selected){setMessage("Open a signing envelope first.");return;}
  if(!selected.gatewayEnvelopeId){setMessage("This draft has not been sent. The document owner must Start Workflow to issue secure email-link invitations.");return;}
  setMessage("This envelope must be signed through its verified email-link invitation. Open the unique link sent to your assigned email address.");
 }
 async function certificate(){setBusy(true);try{const url=await createCompletionCertificate(selected);const updated={...selected,certificateUrl:url};setSelected(updated);setEnvelopes(envelopes.map(e=>e.id===updated.id?updated:e));setMessage("Certificate of Completion generated.")}catch(x){setMessage(x.message||"Unable to generate certificate.")}finally{setBusy(false)}}
 return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA SIGNATURE PORTAL</span><h1>{signerOnly?"Signing Invitation":"Email-link E-signature Portal"}</h1><p>{signerOnly?"Review the invited controlled document and complete only the signature fields assigned to you.":"Prepare, route and track controlled documents. All signer actions are completed through verified email-link invitations."}</p></div><div className="identity-card"><span>Signature status</span><strong>{profile?.status||"Not configured"}</strong>{profile?.driveSignatureFolderId&&<a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer" className="text-button" style={{display:"inline-block",marginTop:8,textDecoration:"none"}}>Open My Signature Folder</a>}</div></section>
 {!signerOnly&&<div className="dashboard-grid" style={{marginBottom:18}}>{[["Signature Profile",profile?"Active":"Required"],["Envelopes",envelopes.length],["Controlled Documents",docs.length],["Pending Signing",envelopes.filter(e=>e.status!=="Completed").length]].map(([a,b])=><div className="stat-card" key={a}><span>{a}</span><strong>{b}</strong><small>Signature Portal</small></div>)}</div>}
 {!signerOnly&&<div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}><div className="signature-portal-nav">{["Profile","Sign a Document","Envelopes","Document Tracking","My Documents","Signature Pathway Self-Test"].map(x=><button type="button" key={x} className={tab===x?"signature-nav-button active":"signature-nav-button"} onClick={()=>{if(x==="Sign a Document"){if(profile?.status!=="Active"){setTab(x);setMessage("An active Signature Profile is required before starting a signing document.");return;}setTab(x);setSignDocumentPickerMode("source");setSignDocumentPickerOpen(true);setMessage("Document picker opened. Select a system document or choose a PDF/file from this device.");}else setTab(x)}}>{x}</button>)}</div></div>}{message&&<div className="auth-message" role="alert" aria-live="assertive" style={{marginBottom:16}}>{message}</div>}
 {signDocumentPickerOpen&&<div role="dialog" aria-modal="true" aria-label="Sign a Document picker" style={{position:"fixed",inset:0,zIndex:1000,background:"var(--surface)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
   <div className="panel" style={{width:"min(900px,96vw)",maxHeight:"90vh",overflow:"auto",boxShadow:"0 24px 70px rgba(0,0,0,.45)",border:"1px solid var(--border)"}}>
     <div className="panel-heading"><div><span className="eyebrow">DOCUMENT PICKER</span><h2>Choose a document to sign</h2><p className="muted">Select a controlled document already in IRPA-DBGS, or choose a PDF/file from your device. Save is the committing action; no separate upload button is required here.</p></div><button type="button" className="secondary-button" onClick={()=>setSignDocumentPickerOpen(false)} disabled={busy}>Close</button></div>
     {signDocumentPickerMode==="source"&&<div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
       <button type="button" className="stat-card" style={{textAlign:"left",cursor:"pointer",minHeight:130}} onClick={()=>{setSignDocumentPickerMode("system");setMessage("Select a document from the IRPA system archive.");}}>
         <strong>Select a file</strong><small style={{display:"block",marginTop:8}}>Open the IRPA system document archive and select an existing controlled PDF/document.</small>
       </button>
       <button type="button" className="stat-card" style={{textAlign:"left",cursor:"pointer",minHeight:130}} onClick={()=>{setSignDocumentPickerMode("device");setMessage("Choose a file from this device.");}}>
         <strong>Choose from device</strong><small style={{display:"block",marginTop:8}}>Open the device/system file picker and select the PDF or supported document.</small>
       </button>
     </div>}
     {signDocumentPickerMode==="system"&&<div className="panel" style={{marginTop:14}}>
       <h3>System files</h3><p className="muted">Select the controlled document already registered in IRPA-DBGS.</p>
       <div className="form-grid">
         <label>Document from system archive<select value={initiateDocumentId} onChange={e=>{const id=e.target.value;const d=docs.find(x=>x.id===id)||null;setInitiateDocumentId(id);setInitiatedDocument(d);setInitiateTitle(v=>v||(d?.title||d?.reference||""));}} disabled={busy}><option value="">Select a file</option>{docs.map(d=><option key={d.id} value={d.id}>{d.title||d.fileName||d.reference||d.id}</option>)}</select></label>
         <div style={{display:"flex",alignItems:"end"}}><button type="button" className="text-button" onClick={async()=>{if(busy)return;setBusy(true);try{setDocs(await getControlledDocumentsForSigning());setMessage("System archive refreshed.");}catch(error){setMessage(error?.message||"Unable to refresh archive.")}finally{setBusy(false)}}} disabled={busy}>↻ Refresh Archive</button></div>
       </div>
       <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
         <button type="button" onClick={()=>{const d=initiatedDocument||docs.find(x=>x.id===initiateDocumentId);if(!d){setMessage("Select a system document first.");return;}setDocumentId(d.id);setDocumentUrl(controlledPdfUrl(d));setTitle(initiateTitle.trim()||d.title||d.reference||"Signing Document");setDraftEnvelopeId(null);setFields([]);setRecipients([]);setActiveAssigneeUid("");setSelectedField(null);setSigningCircle("Document Selected");setSignDocumentPickerOpen(false);setTab("Prepare Envelope");setMessage("System document selected. Prepare Envelope is now open.")}} disabled={busy||!initiateDocumentId}>Save & Continue</button>
         <button type="button" className="secondary-button" onClick={()=>setSignDocumentPickerMode("source")} disabled={busy}>Back</button>
       </div>
     </div>}
     {signDocumentPickerMode==="device"&&<div style={{marginTop:14}}>
       <ControlledDocumentUpload purpose="Signing Document" compact submitLabel="Prepare Envelope" onUploaded={doc=>{setInitiatedDocument(doc);setInitiateDocumentId(doc.id);setInitiateTitle(v=>v||doc.title||doc.fileName||"Signing Document");setDocumentId(doc.id);setDocumentUrl(controlledPdfUrl(doc));setTitle(v=>v||doc.title||doc.fileName||"Signing Document");setDraftEnvelopeId(null);setFields([]);setRecipients([]);setActiveAssigneeUid("");setSelectedField(null);setSigningCircle("Document Selected");setSignDocumentPickerOpen(false);setTab("Prepare Envelope");setMessage("Document prepared from the selected archive and opened in Signature Portal → Prepare Envelope.")}}/>
       <div style={{display:"flex",gap:8,marginTop:10}}><button type="button" className="secondary-button" onClick={()=>setSignDocumentPickerMode("source")} disabled={busy}>Back</button></div>
     </div>}
   </div>
 </div>}
 
{!signerOnly&&tab==="Signature Pathway Self-Test"&&<SignaturePathwaySelfTest/>}
 {!signerOnly&&tab==="Profile"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">SIGNATURE IDENTITY</span><h2>My Signature Profile</h2><div className="panel-description" role="note" style={{marginTop:10,padding:"10px 12px",borderLeft:"3px solid #c9a227",background:"var(--surface)"}}><strong>IRPA Signature Safety Standards:</strong> Your signature is a personal signing credential linked to your authenticated profile. Keep your account credentials private, use only your own handwritten specimen, and review each signing request before approval. Signature assets and signing activity are handled through controlled access, authenticated signing workflows and audit records; completed signature records are protected from unauthorized alteration or deletion.</div></div></div><p className="muted">Upload the actual handwritten signature and optional initials used during signing.</p><div className="identity-card" role="note" aria-label="Signing method" style={{marginTop:12}}><span>Signing method</span><strong>Email-link e-signature</strong><small>Signing invitations are delivered to the assigned email address. The signer opens the unique link and completes the signing action through the secure email-link workflow.</small></div>{signerIdentity&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button type="button" className="text-button" disabled={busy} onClick={migrateProfileNow}>Verify / Migrate Existing Signature Profile</button></div>}{signerIdentity?<><div className="panel" style={{marginTop:14,border:"1px solid var(--border)"}}><div className="panel-heading"><div><span className="eyebrow">SIGNER IDENTITY & TRUST RECORD</span><h3 style={{margin:"6px 0"}}>Signing Identity</h3><p className="muted">Your existing Signature Profile remains the source signing specimen. This trust record adds identity, authority, document evidence and revocation state without replacing the profile.</p></div></div><div className="form-grid"><div><strong>Signer</strong><div>{signerIdentity.signerName}</div><small>{signerIdentity.email}</small></div><div><strong>Organisation</strong><div>{signerIdentity.organisationName}</div></div><div><strong>Signature status</strong><div>{signerIdentity.signatureStatus}</div><small>Revocation: {signerIdentity.revocationStatus}</small></div><div><strong>Current signature hash</strong><div style={{wordBreak:"break-all",fontSize:11}}>{signerIdentity.currentSignatureHash||"Not yet available"}</div></div><div><strong>Identity record</strong><div>{signerIdentity.id}</div><small>Historical Signature Profile retained</small></div></div><div className="identity-card" style={{marginTop:12}}><span>IRPA INSTITUTIONAL IDENTIFIERS</span><div style={{display:"flex",flexWrap:"wrap",gap:18,marginTop:6}}>{authorityMember?.memberNumber&&<div><small>Member Number</small><strong style={{display:"block"}}>{authorityMember.memberNumber}</strong></div>}{authorityEmployee?.employeeNumber&&<div><small>Employee Number</small><strong style={{display:"block"}}>{authorityEmployee.employeeNumber}</strong></div>}{!authorityMember?.memberNumber&&!authorityEmployee?.employeeNumber&&<small>Registered institutional number not currently available.</small>}</div></div>
 <div className="panel" style={{marginTop:14,border:"1px solid var(--border)"}}>
   <div className="panel-heading"><div>
     <span className="eyebrow">SIGNING IDENTITY · REGISTERED CAPACITY</span>
     <h3 style={{margin:"6px 0"}}>Current Signing Authority</h3>
     <p className="muted">Your signing capacity is taken directly from the active IRPA Member and Employee Registers. Department → unit/board capacity → registered authority controls the available choices; no free-text authority can be entered.</p>
   </div></div>
   <div className="form-grid">
     <label className="signature-authority-field">Department
       <select value={authorityDepartment} onChange={e=>{const value=e.target.value;setAuthorityDepartment(value);setAuthorityUnit("");setAuthorityRole("");setAuthorityEffectiveAt("");setAuthorityExpiresAt("");if(String(value||"").trim().toLowerCase()==="executive office")setAuthorityStatus("Current");}} required disabled={authorityBusy}>
         <option value="">Select registered department</option>
         {authorityDepartments.map(value=><option key={value} value={value}>{value}</option>)}
       </select>
     </label>
     <label className="signature-authority-field">Current signing authority / registered capacity
       <select value={authorityRole} onChange={e=>{
         const value=e.target.value;
         setAuthorityRole(value);
         if(!isBoardMemberAuthority(authorityDepartment,value)){setAuthorityEffectiveAt("");setAuthorityExpiresAt("");}
         if(isPermanentExecutiveAuthority(authorityDepartment,value))setAuthorityStatus("Current");
         const selectedAuthority=authorityOptions.find(x=>x.role===value);
         setAuthorityUnit(selectedAuthority?.unit||authorityDepartment||"");
       }} required disabled={authorityBusy||!authorityDepartment}>
         <option value="">Select registered authority / capacity</option>
         {authorityOptions
           .slice()
           .sort((a,b)=>{
             const aPriority=authorityCapacityPriority(a.role,a.department||authorityDepartment);
             const bPriority=authorityCapacityPriority(b.role,b.department||authorityDepartment);
             return aPriority-bPriority||a.role.localeCompare(b.role);
           })
           .map(option=><option key={option.sourceCollection+"|"+option.sourceRecordId+"|"+option.role} value={option.role}>{authorityDisplayLabel(option.role,option.department||authorityDepartment)}</option>)}
       </select>
       <small>Only capacities recorded for your authenticated Member/Employee register entries are offered. If you hold multiple registered roles, select the department first and then the applicable capacity. This prevents impersonation.</small>
     </label>
     <label className="signature-authority-field">Authority status
       <select value={authorityStatus} onChange={e=>setAuthorityStatus(e.target.value)} disabled={authorityBusy||isPermanentExecutiveAuthority()}>
         <option>Current</option><option>Not Applicable</option>{!isPermanentExecutiveAuthority()&&<><option>Pending Verification</option><option>Expired</option><option>Not yet assigned</option></>}
       </select>
       <small>{isPermanentExecutiveAuthority()?"Executive Director is a permanent Executive Office authority; status remains Current.":"Select the applicable registered authority status."}</small>
     </label>
     {authorityDepartment&&authorityUnit&&authorityRole&&<label className="signature-authority-field">Authority reference / appointment no. <span className="muted">(optional)</span>
       <input value={authorityReference} onChange={e=>setAuthorityReference(e.target.value)} placeholder="Appointment / authority reference (optional)" disabled={authorityBusy}/>
       <small>Optional for officers whose register capacity does not require a formal appointment reference.</small>
     </label>}
     {isBoardMemberAuthority()&&<label className="signature-authority-field">Effective date <span className="muted">(optional)</span>
       <input type="date" value={authorityEffectiveAt} onChange={e=>setAuthorityEffectiveAt(e.target.value)} disabled={authorityBusy}/>
     </label>}
     {isBoardMemberAuthority()&&<label className="signature-authority-field">Expiry date <span className="muted">(optional)</span>
       <input type="date" value={authorityExpiresAt} onChange={e=>setAuthorityExpiresAt(e.target.value)} min={authorityEffectiveAt||undefined} disabled={authorityBusy}/>
     </label>}
   </div>
   <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
     <button type="submit" disabled={authorityBusy||!authorityDepartment||!authorityRole}>{authorityBusy?"Saving Authority…":"Save Current Authority"}</button>
   </div>
 </div></div></>:<div className="panel" role="status" style={{marginTop:14,border:"1px solid var(--border)"}}><div className="panel-heading"><div><span className="eyebrow">SIGNER IDENTITY & TRUST RECORD</span><h3 style={{margin:"6px 0"}}>Trust Record Pending</h3><p className="muted">The Signer Identity record is not currently available. This does not delete, replace or invalidate your existing Signature Profile.</p></div></div><button type="button" className="text-button" disabled={busy} onClick={migrateProfileNow}>Verify / Restore Signer Identity Link</button></div>}{profile?.driveSignatureFolderId&&<div className="success-message action-feedback" style={{marginTop:12}}>Your signature assets are stored in your UID-restricted Google Drive folder: <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer">Open My Signature Folder</a>.</div>}<form onSubmit={saveProfile}><div className="form-grid"><label>Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} required/></label><label>Initials<input value={initials} onChange={e=>setInitials(e.target.value)} placeholder="e.g. DEM"/></label><label>Signature image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{setSignatureFile(e.target.files?.[0]||null);setDrawnSignature("")}}/><small>Optional if you sign directly below.</small></label><label>Initials image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setInitialsFile(e.target.files?.[0]||null)}/></label></div><InkCapture onUse={saveDrawnSignature} onSave={saveDrawnSignature} replacementMode={replacementMode}/><div className="dashboard-grid" style={{marginTop:16}}>{profile?.signatureUrl?<div className="stat-card"><span>CURRENT SIGNATURE</span><div style={{background:"var(--surface)",padding:12,borderRadius:8,marginTop:8}}>{servedSignatureSrc?<img src={servedSignatureSrc} alt="Current served signature" style={{maxWidth:"100%",maxHeight:100}}/>:<div className="auth-message" role="status">Loading current served signature…</div>}</div><small>SHA-256: {profile.signatureSha256}</small><div className="auth-message" role="status" style={{marginTop:10}}>This is the signature currently saved from your Signature Profile and reused for future signing.</div></div>:<div className="stat-card"><span>NO SIGNATURE CURRENTLY SERVED</span><div className="auth-message" role="status" style={{marginTop:10}}>Your handwritten specimen above has not been served yet. Press <strong>Save &amp; Serve Signature</strong> once to make it your persistent signature.</div></div>}{profile?.initialsUrl&&<div className="stat-card"><span>Saved initials</span><div style={{background:"var(--surface)",padding:12,borderRadius:8,marginTop:8}}>{servedInitialsSrc?<img src={servedInitialsSrc} alt="Initials" style={{maxWidth:"100%",maxHeight:100}}/>:<div className="auth-message" role="status">Loading initials…</div>}</div></div>}</div>{profile&&<div className="panel" style={{marginTop:16,border:"1px solid var(--border)"}}>
 <div className="panel-heading"><div><span className="eyebrow">SIGNATURE APPLICATION CONTROL</span><h3 style={{margin:"6px 0"}}>Revoke My Signature Application</h3><p className="muted">Only the Signature Profile owner can initiate this revocation. Revocation disables this Signature Application for future signing. It does not delete the person's account or erase completed signing records.</p></div></div>
 {!revokeOpen?<button type="button" className="secondary-button" onClick={()=>setRevokeOpen(true)} disabled={busy||revokeBusy||profile.status==="Revoked"}>{profile.status==="Revoked"?"Signature Application Revoked":"Revoke Signature Application"}</button>:
 <div role="alertdialog" aria-label="Confirm Signature Application revocation"><p className="muted"><strong>Security confirmation:</strong> review this action before proceeding. Revocation will prevent this Signature Profile from being used for new signing actions.</p><div className="form-actions"><button type="button" className="danger-button" onClick={revokeApplication} disabled={revokeBusy}>{revokeBusy?"Revoking…":"Confirm Revoke Signature Application"}</button><button type="button" className="secondary-button" onClick={()=>setRevokeOpen(false)} disabled={revokeBusy}>Cancel</button></div></div>}
 </div>}<button type="submit" className="signature-profile-primary-button" style={{marginTop:18}} disabled={busy||(!signatureFile&&!drawnSignature)}>{busy?"Saving...":profile?"Save Signature Profile":"Save Signature Profile"}</button>{profile&&<button type="button" className="signature-profile-secondary-button" style={{marginTop:12,border:replacementMode?"2px solid #f87171":"1px solid rgba(255,255,255,.2)",fontWeight:800}} disabled={busy} onClick={()=>{setReplacementMode(true);setSignatureFile(null);setDrawnSignature("");setMessage("REPLACEMENT MODE ACTIVE: draw the new handwritten signature in the box above, then press Save Signature. The current served signature remains active until the save succeeds.");document.querySelector("[data-signature-specimen]")?.scrollIntoView({behavior:"smooth",block:"center"})}}>{replacementMode?"Replacement Mode Active":"Replace Signature"}</button>}<div className="auth-message" role="status" aria-live="polite" style={{marginTop:12}}>{busy?"Saving signature to your persistent Signature Profile…":replacementMode?"REPLACEMENT MODE ACTIVE: draw the new signature and press Save Signature. The current served signature remains unchanged until the save succeeds.":profile?"CURRENT SIGNATURE SERVED: this signature will be reused for future documents.":"NO SIGNATURE SERVED: save your handwritten specimen above to activate it."}</div></form></section>}
 {!signerOnly&&tab==="My Documents"&&<section className="panel">
 <div className="panel-heading"><div><span className="eyebrow">SIGNATURE PROFILE ARCHIVE</span><h2>My Documents</h2><p className="muted">Every document you personally sign is tracked as part of its signing ceremony. If another required signer remains, the document stays in workflow tracking. After the last required signature is applied, the final fully signed document is delivered to your Signature Profile archive, regardless of who initiated the workflow.</p></div></div>
 
 <div className="identity-card" style={{marginBottom:14}}><span>Profile archive</span><strong>{signedDocuments.length} completed document cop{signedDocuments.length===1?"y":"ies"}</strong>{profile?.driveSignatureFolderId&&<a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer" className="text-button" style={{display:"inline-block",marginTop:8,textDecoration:"none"}}>Open Signature Profile Archive</a>}</div>
 {signedDocuments.length===0?<p className="muted">No signed documents are recorded for this Signature Profile yet.</p>:<div style={{display:"grid",gap:10}}>{signedDocuments.map(d=><article key={d.id} className="stat-card"><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}><div><span>{d.documentReference||d.documentId||"Signed Document"}</span><h3 style={{margin:"5px 0"}}>{d.documentTitle||d.title||d.documentReference||"Signed Document"}</h3><small>{d.copyRole==="Owner"?"Document owner copy":"Signed by you"} · {d.workflowRole||"Signature action"} · {d.signedAt?.seconds?new Date(Number(d.signedAt.seconds)*1000).toLocaleString():d.signedAt?new Date(d.signedAt).toLocaleString():"Date recorded"}</small><div style={{fontSize:11,opacity:.65,marginTop:5,wordBreak:"break-all"}}>SHA-256: {d.signedDocumentHash||"Recorded"}</div><div style={{fontSize:11,marginTop:5,opacity:.75}}>My Documents Portal: {d.myDocumentsPortalPath||"Completed Signed Documents"}</div></div><div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
 <button type="button" className="secondary-button" onClick={async()=>{try{const target=d.signerArchiveUrl||"";if(!target)throw new Error("The archived signed PDF link is missing.");if(target.startsWith("drive://")){const bytes=await downloadSignatureBytes(target.slice("drive://".length),d.documentId,d.envelopeId);const blob=new Blob([bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);window.open(url,"_blank","noopener,noreferrer");setTimeout(()=>URL.revokeObjectURL(url),60000)}else window.open(target,"_blank","noopener,noreferrer")}catch(error){setMessage(error.message||"Unable to open the archived signed document.")}}}>Open Signed PDF</button>
 <button type="button" className="secondary-button" disabled={busy} onClick={async()=>{try{const result=await downloadMySignedDocumentCopy(d.id);const blob=new Blob([result.bytes],{type:result.contentType||"application/pdf"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=result.fileName||"completed-signed-document.pdf";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage("Your personal signed-document copy has been downloaded.")}catch(error){setMessage(error.message||"Unable to download your signed document copy.")}}}>Download Copy</button>
 <button type="button" className="secondary-button" disabled={busy} onClick={async()=>{if(!window.confirm("Delete only your personal copy from My Documents? The authoritative executed document and audit trail will remain protected."))return;setBusy(true);try{await deleteMySignedDocumentCopy(d.id);const archived=await getMySignedDocuments();setSignedDocuments(archived);setMessage("Your personal copy was deleted. The authoritative executed document and audit trail are unchanged.")}catch(error){setMessage(error.message||"Unable to delete your personal copy.")}finally{setBusy(false)}}}>Delete My Copy</button>
</div></div></article>)}</div>}
 </section>}
 {!signerOnly&&tab==="Prepare Envelope"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENVELOPE PREPARATION</span><h2>Prepare, Assign & Route Document</h2><p className="muted">The document selected through Sign a Document is carried into this preparation stage. Place comments, numbers, remarks, dates and signatures, assign every field to an officer, and route the document in the required sequence.</p></div></div><form onSubmit={createEnvelope} noValidate><div className="panel" style={{marginBottom:18,border:"1px solid var(--border)",background:"var(--surface)"}}><div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:8}}>{["Initiated","Document Selected","Prepare Envelope","Field Palette","Signing Circle"].map((step,i)=><div key={step} style={{padding:"10px 8px",borderRadius:8,border:`1px solid ${signingCircle===step||["Initiated","Document Selected","Prepare Envelope","Field Palette","Signing Circle"].indexOf(signingCircle)>i?"rgba(34,197,94,.65)":"rgba(148,163,184,.25)"}`,background:"var(--surface)",textAlign:"center"}}><strong style={{display:"block",fontSize:11}}>{i+1}</strong><span style={{fontSize:11}}>{step}</span></div>)}</div></div><div className="form-grid"><label>Envelope title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Board Resolution Approval"/></label><label>Signing document<div className="auth-message" role="status"><strong>{initiatedDocument?.title||docs.find(d=>d.id===documentId)?.title||documentId||"No signing document selected"}</strong><small style={{display:"block",marginTop:6}}>{documentId?"Selected through Sign a Document. The signing loop carries this document into Prepare Envelope.":"Start with Sign a Document to choose the document."}</small></div></label><label>Signing arrangement<select value={signingMode} onChange={e=>setSigningMode(e.target.value)}><option value="Sequential">Hierarchical — sequential positions</option><option value="Parallel">Parallel — non-hierarchical</option></select></label><small style={{display:"block",gridColumn:"1 / -1",marginTop:-8}}>{signingMode==="Parallel"?"All required signers receive their email invitations together and may sign in any order. No hierarchy or approval sequence is applied.":"Signers follow the order assigned by the document owner. People at the same position sign together; the next position is invited after all previous-position signers submit."}</small></div>
 <PDFDesigner url={documentUrl} documentId={documentId} envelopeId={draftEnvelopeId} signingStage={tab==="Sign Document"} fields={fields} setFields={setFields} recipients={workflowRecipients} members={members} ownerSigner={ownerSigningEnabled?documentOwner:null} ownerSigningEnabled={ownerSigningEnabled} onOwnerSigningChange={changeOwnerSigning} onSelectAssignee={setActiveAssigneeUid} onRemoveSigner={removeSigner} onMoveSigner={moveSigner} onAddSigner={addSigner} selectedSigner={selectedSigner} setSelectedSigner={setSelectedSigner} signerEmail={signerEmail} setSignerEmail={setSignerEmail} signerName={signerName} setSignerName={setSignerName} signerTitle={signerTitle} setSignerTitle={setSignerTitle} signerRole={signerRole} setSignerRole={setSignerRole} signerAuthorityRole={signerAuthorityRole} setSignerAuthorityRole={setSignerAuthorityRole} signerCapacity={signerCapacity} setSignerCapacity={setSignerCapacity} busy={busy} selectedField={selectedField} setSelectedField={setSelectedField} activeAssigneeUid={activeAssigneeUid||(recipients.length?recipients[recipients.length-1].uid:(ownerSigningEnabled?documentOwner.uid:""))} signatureSrc={servedSignatureSrc} initialsSrc={servedInitialsSrc} onPageChange={setPreparationPage}/>
 <button type="submit" className="create-envelope-action" disabled={busy} aria-busy={busy?"true":"false"}>{busy?"Creating Draft Envelope…":"Create Draft Envelope"}</button><button type="button" className="secondary-button" style={{marginTop:10}} disabled={busy} onClick={saveAndClosePreparation}>{busy?"Saving…":"Save Draft & Close Preparation"}</button></form></section>}
{!signerOnly&&tab==="Envelopes"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENVELOPE REGISTER</span><h2>Signing Transactions</h2><p className="muted">Open an existing signing transaction or start the next assigned signing action. New documents enter the signing loop through Sign a Document.</p></div></div>{envelopes.filter(e=>(e.recipients||[]).some(r=>r?.uid===auth.currentUser?.uid)).length===0?<p className="muted">No signing assignments are currently assigned to you.</p>:envelopes.filter(e=>(e.recipients||[]).some(r=>r?.uid===auth.currentUser?.uid)).map(e=><article key={e.id} className="stat-card" style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><div><span>{e.envelopeReference}</span><h3 style={{margin:"5px 0"}}>{e.title}</h3><small>{e.documentReference} · {e.signingMode} · Your assignment</small></div><div><strong>{e.status}</strong><br/><button className="text-button" onClick={()=>{setSelected(e);setTab("Sign Document")}}>Open</button>{e.status==="Draft"&&(e.ownerUid===auth.currentUser?.uid||e.senderUid===auth.currentUser?.uid)&&<button className="text-button" onClick={()=>{const ownerEntry=(e.recipients||[]).find(r=>r.uid===auth.currentUser?.uid);const ownerEnabled=Boolean(ownerEntry&&ownerEntry.actionRequired!==false&&!ownerEntry.optionalSigning);setDraftEnvelopeId(e.id);setTitle(e.title||"");setDocumentId(e.documentId||"");setDocumentUrl(e.documentUrl||"");setRecipients((e.recipients||[]).filter(r=>r.uid!==auth.currentUser?.uid));setFields(e.fields||[]);setOwnerSigningEnabled(ownerEnabled);setActiveAssigneeUid(ownerEnabled?auth.currentUser.uid:(e.recipients||[]).find(r=>r.uid!==auth.currentUser?.uid)?.uid||"");setSelectedField(null);setPreparationPage(1);setInitiatedDocument(docs.find(d=>d.id===e.documentId)||null);setSigningCircle("Prepared");setTab("Prepare Envelope");setMessage("Draft reopened for owner preparation. No invitations have been sent.");}}>Continue Preparation</button>}{e.status==="Draft"&&<button className="text-button" onClick={async()=>{setBusy(true);setMessage("");try{const updated=await startSignatureWorkflow(e);if(updated.ownerSigningToken){window.location.assign("/?emailSignToken="+encodeURIComponent(updated.ownerSigningToken));return;}setEnvelopes(envelopes.map(x=>x.id===updated.id?updated:x));setSelected(updated);setTab("Sign Document");setMessage(updated.gatewayInvitationFailures?("Gateway workflow connected, but "+updated.gatewayInvitationFailures+" invitation(s) failed. Use Retry pending or failed invitations after opening this envelope."): "Workflow started. The current officer has been released.")}catch(x){setMessage(x.message||"Unable to start workflow.")}finally{setBusy(false)}}} disabled={busy}>{busy?"Starting…":e.ownerSigningEnabled===true?"Owner Sign in Portal & Release Signers":"Start Workflow"}</button>}</div></div></article>)}</section>}
 {!signerOnly&&tab==="Document Tracking"&&<section className="panel">
  <div className="panel-heading"><div><span className="eyebrow">DOCUMENT CONTROL & FOLLOW-UP</span><h2>Document Tracking Register</h2><p className="muted">Track each signing document from preparation to final archive, including the person currently expected to act and the latest recorded Gateway event.</p></div><button type="button" onClick={refreshDocumentTracking} disabled={trackingBusy}>{trackingBusy?"Refreshing…":"Refresh live tracking"}</button></div>
  {envelopes.length===0?<p className="muted">No signing documents are visible to this account.</p>:<div style={{display:"grid",gap:12}}>
   {envelopes.map(envelope=>{
    const live=trackingSnapshots[envelope.id];
    const liveSigners=Array.isArray(live?.signers)?live.signers:[];
    const pending=liveSigners.filter(s=>s.status==="Pending").sort((a,b)=>Number(a.order||0)-Number(b.order||0));
    const liveCompleted=live?.status==="Completed"||envelope.status==="Completed";
    const liveClosed=["Voided","Declined"].includes(live?.status)||["Cancelled","Declined"].includes(envelope.status);
    const current=pending.length?(envelope.signingMode==="Parallel"?pending:pending.slice(0,1)):[];
    const currentNames=current.map(s=>{const recipient=(envelope.recipients||[]).find(r=>String(r.email||"").trim().toLowerCase()===String(s.email||"").trim().toLowerCase())||{};return {name:s.name||recipient.name||s.email||"Assigned signer",email:s.email||recipient.email||"",role:recipient.role||s.roleAssignments?.[0]?.role||"Signer",invitation:s.invitation||"Pending"};});
    const fallback=(envelope.recipients||[]).find(r=>r.uid===envelope.currentSignerUid);
    const holder=live?.error?"Live holder status unavailable":currentNames.length?currentNames.map(x=>x.name+" · "+x.role).join(" / "):liveCompleted?"No current holder — completed":liveClosed?"No current holder — closed":fallback?(fallback.name||fallback.email)+" · "+(fallback.role||"Signer"):envelope.status==="Draft"?"Document owner — preparation":"Holder not yet confirmed";
    const stage=liveCompleted?"Completed — final document archived":liveClosed?"Closed — "+(live?.status||envelope.status):envelope.status==="Draft"?"Preparation / draft":currentNames.some(x=>x.invitation==="Portal")?"Awaiting document owner portal signature":currentNames.some(x=>x.invitation==="Failed")?"Invitation delivery failed":currentNames.some(x=>x.invitation==="Pending")?"Awaiting invitation dispatch":currentNames.length?"Awaiting signer action":envelope.status||"In progress";
    const last=live?.lastEvent;
    const signerForEvent=last?.signerId?liveSigners.find(s=>s.id===last.signerId):null;
    const lastAction=last?.type?(String(last.type).replace(/[._]/g," ").replace(/\b\w/g,m=>m.toUpperCase())+(signerForEvent?.name?" · "+signerForEvent.name:"")):(envelope.workflowHistory||[]).slice(-1)[0]?.role||"Envelope prepared";
    const lastAt=last?.at||envelope.updatedAt||envelope.createdAt;
    const formatDate=value=>{const date=value?.toDate?value.toDate():value?.seconds?new Date(Number(value.seconds)*1000):new Date(value);return Number.isNaN(date?.getTime?.())?"Not recorded":date.toLocaleString();};
    return <article key={envelope.id} className="stat-card" style={{display:"grid",gap:8}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><small>{envelope.envelopeReference||envelope.id} · {envelope.documentReference||envelope.documentId}</small><h3 style={{margin:"4px 0"}}>{envelope.title||"Untitled signing document"}</h3></div><strong>{stage}</strong></div>
      <div><small style={{opacity:.7}}>CURRENT HOLDER</small><div style={{fontWeight:800}}>{holder}</div>{currentNames.map((person,i)=><small key={i} style={{display:"block",opacity:.75}}>{person.email} · {person.invitation==="Portal"?"Owner portal — not emailed":person.invitation==="Sent"?"Invitation sent":person.invitation}</small>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
       <div><small style={{opacity:.7}}>LAST RECORDED ACTION</small><div>{lastAction}</div><small>{formatDate(lastAt)}</small></div>
       <div><small style={{opacity:.7}}>NEXT EXPECTED ACTION</small><div>{liveCompleted?"Retain and follow the archived record":liveClosed?"No further action":stage.includes("owner portal")?"Owner completes signature in the portal":stage.includes("invitation")?"Resolve invitation delivery":currentNames.length?"Current holder reviews and completes assigned fields":"Continue preparation or inspect workflow"}</div></div>
       <div><small style={{opacity:.7}}>AUDIT / LIVE STATUS</small><div>{live?.error?live.error:live?("Gateway "+live.status+" · "+(live.eventCount??"—")+" events"):"Not refreshed"}</div></div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" className="text-button" onClick={()=>{setSelected(envelope);setTab("Sign Document")}}>Open document record</button>{envelope.status==="Draft"&&(envelope.ownerUid===auth.currentUser?.uid||envelope.senderUid===auth.currentUser?.uid)&&<button type="button" className="text-button" onClick={()=>{setDraftEnvelopeId(envelope.id);setTitle(envelope.title||"");setDocumentId(envelope.documentId||"");setDocumentUrl(envelope.documentUrl||"");setRecipients((envelope.recipients||[]).filter(r=>r.uid!==auth.currentUser?.uid));setFields(envelope.fields||[]);setOwnerSigningEnabled(Boolean(envelope.ownerSigningEnabled));setActiveAssigneeUid(envelope.ownerSigningEnabled?auth.currentUser.uid:(envelope.recipients||[]).find(r=>r.uid!==auth.currentUser?.uid)?.uid||"");setSelectedField(null);setPreparationPage(1);setInitiatedDocument(docs.find(d=>d.id===envelope.documentId)||null);setTab("Prepare Envelope");setMessage("Draft reopened for preparation. No invitations have been sent.")}}>Continue preparation</button>}</div>
    </article>;
   })}
  </div>}
 </section>}
 {tab==="Sign Document"&&<section className="panel">{!selected?<><h2>Signing Ceremony</h2><p className="muted">This signing invitation could not be loaded.</p></>:<><div className="panel-heading"><div><span className="eyebrow">SIGNING CEREMONY</span><h2>{selected.title}</h2><p>{selected.envelopeReference} · {selected.status}</p></div></div>{!signerOnly&&selected.gatewayEnvelopeId&&<><div className="panel" style={{marginBottom:18}}><div className="panel-heading"><div><h3>Signer invitations</h3><p className="muted">Every signer receives a unique, single-use email-link invitation, including registered IRPA members and employees. After opening the link, profile holders can use their saved Signature Profile. Resend and revoke controls manage the email-link invitation.</p></div><button type="button" disabled={gatewayEmailStatusBusy} onClick={refreshGatewayEmailStatus}>{gatewayEmailStatusBusy?"Loading…":"Refresh status"}</button></div>{gatewayEmailStatus?.signers?.filter(item=>["email-link","account"].includes(item.identityType)).map(item=><div key={item.id} style={{display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",padding:"10px 0",borderBottom:"1px solid var(--border)"}}><div><strong>{item.name||"Email signer"}</strong><small style={{display:"block"}}>{maskRegisterEmail(item.email)} · {item.status==="Signed"?"signed":item.emailLinkStatus||item.status} · {item.identityType==="email-link"?"No time expiry":item.emailLinkExpiresAt?("Expires "+new Date(item.emailLinkExpiresAt).toLocaleString()):"—"}</small></div><div style={{display:"flex",gap:6}}>{item.identityType==="email-link"&&<><button type="button" className="text-button" disabled={gatewayEmailStatusBusy||item.status==="Signed"} onClick={()=>resendEmailLink(item.id)}>Resend</button><button type="button" className="text-button" disabled={gatewayEmailStatusBusy||item.emailLinkStatus==="revoked"||item.status==="Signed"} onClick={()=>revokeEmailLink(item.id)}>Revoke</button></>}</div></div>)}</div><div className="panel" style={{marginBottom:18}}><h3>Invitation Delivery</h3><p className="muted">Retry any pending or failed Gateway invitations. Each retry rotates the signer token and records the delivery outcome.</p><button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await resendFailedGatewaySignatureInvitations(selected.gatewayEnvelopeId);setMessage(result.attempted?("Invitation retry completed for "+result.attempted+" signer(s). Check the Gateway delivery status for any remaining failures."):"No pending or failed signer invitations were found.");}catch(error){setMessage(error.message||"Unable to retry Gateway invitations.");}finally{setBusy(false)}}}>Retry pending or failed invitations</button></div>{gatewayEmailStatus?.status==="Completed"&&gatewayEmailStatus?.distribution&&<div className="panel" style={{marginBottom:18}}><h3>Completed Document Distribution</h3><p className="muted">The final executed PDF is emailed to the document owner and every signer. Registered recipients also receive a personal copy in My Documents. Delivery outcomes are recorded separately from the immutable signing audit trail.</p><p>{gatewayEmailStatus.distribution.sent||0} of {gatewayEmailStatus.distribution.total||0} recipient email(s) delivered · {gatewayEmailStatus.distribution.failed||0} failed · {gatewayEmailStatus.distribution.unknown||0} with an ambiguous SMTP outcome.</p>{gatewayEmailStatus.distribution.failed>0&&<button type="button" disabled={gatewayEmailStatusBusy} onClick={retryCompletedDistribution}>{gatewayEmailStatusBusy?"Retrying…":"Retry failed recipient emails"}</button>}{gatewayEmailStatus.distribution.unknown>0&&<small style={{display:"block",marginTop:8,opacity:.7}}>Ambiguous SMTP outcomes are not retried automatically because the provider may already have accepted the email. Check the recipient mailbox before requesting a manual resend.</small>}</div>}</>}<div className="panel" style={{marginBottom:18}}><h3>Signing Progress</h3><div style={{display:"grid",gap:8,marginTop:10}}>{(selected.recipients||[]).filter(r=>r?.uid===auth.currentUser?.uid).map((r)=>{const isCurrent=selected.status!=="Completed"&&selected.currentSignerUid===r.uid;const isSigned=r.status==="Signed"||((selected.workflowHistory||[]).some(h=>h.uid===r.uid));const state=selected.status==="Completed"&&isSigned?"Completed":isSigned?"Signed":isCurrent?"Your assignment is active":"Your assignment is pending";const when=r.completedAt||((selected.workflowHistory||[]).filter(h=>h.uid===r.uid).slice(-1)[0]?.completedAt)||"";return <div key={r.uid} style={{display:"grid",gridTemplateColumns:"36px 1fr auto",gap:10,alignItems:"center",padding:"10px 12px",border:"1px solid var(--border)",borderRadius:8}}><strong>✓</strong><div><strong>My assignment</strong><div style={{fontSize:12,opacity:.7}}>{r.role||"Action"}</div>{when&&<div style={{fontSize:11,opacity:.6}}>Completed: {new Date(when).toLocaleString()}</div>}</div><span>{state}</span></div>})}</div>{selected.currentSignerUid===auth.currentUser?.uid&&selected.status!=="Completed"&&<p className="muted" style={{marginBottom:0,marginTop:10}}>Next action: complete your assigned fields.</p>}{selected.status==="Completed"&&<p className="muted" style={{marginBottom:0,marginTop:10}}>All required signing actions are complete.</p>}</div>{selected.documentUrl&&<SigningDocumentViewer url={selected.signedDocumentUrl||selected.documentUrl} documentId={selected.documentId} envelopeId={selected.id} fields={selected.fields||[]} profile={profile} fieldValues={fieldValues} setFieldValues={setFieldValues} record={selected} sourceDocument={docs.find(item=>item.id===selected.documentId)||null} isAdmin={isAdmin} setMessage={setMessage}/>}<div className="panel" style={{marginTop:18}}>
 <h3>Document Archive</h3>
 <p className="muted" style={{marginBottom:12}}>The controlled document remains available to the assigned signee throughout the workflow. After an action is completed, the latest signed version is exposed here for review and intended use.</p>
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  {selected.documentUrl&&<a className="controlled-document-open-button" href={selected.documentUrl.startsWith("drive://")?"#":selected.documentUrl} target="_blank" rel="noreferrer" onClick={async e=>{if(selected.documentUrl.startsWith("drive://")){e.preventDefault();try{const bytes=await downloadSignatureBytes(selected.documentUrl.slice("drive://".length),selected.documentId,selected.id);const blob=new Blob([bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);window.open(url,"_blank","noopener,noreferrer");setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(x){setMessage(x.message||"Unable to open the controlled document.")}}}}>Open Controlled Document</a>}
  {selected.signedDocumentUrl&&<a className="secondary-button" href={selected.signedDocumentUrl} target="_blank" rel="noreferrer">Open Latest Signed Document</a>}
  {selected.certificateUrl&&<a className="secondary-button" href={selected.certificateUrl} target="_blank" rel="noreferrer">Open Completion Certificate</a>}
 </div>
 </div><div className="panel" style={{marginTop:18,border:"1px solid var(--border)",background:"var(--surface)"}}><h3>Signer declaration</h3><p className="muted">Enter the occupation or capacity under which you are signing this document. This transaction-specific declaration is recorded for traceability and is not checked against an IRPA Member or Employee Register.</p><label style={{display:"block",marginTop:10}}>Your occupation / capacity *<input value={manualSigningAuthority} onChange={e=>setManualSigningAuthority(e.target.value)} placeholder="e.g. Executive Director, Board Member, Consultant" disabled={busy||selected.status==="Completed"} required/></label></div><div className="panel" style={{marginTop:18}}><h3>Fields assigned to you</h3>{(selected.fields||[]).filter(f=>f.signerUid===auth.currentUser?.uid).map(f=><label key={f.fieldId} style={{display:"block",marginTop:10}}>{f.type}{f.required?" *":""}{f.type==="Signature"||f.type==="Initials"?<div className="stat-card" style={{marginTop:5}}>{f.type} will use your saved Signature Profile.</div>:<input value={fieldValues[f.fieldId]||""} onChange={e=>setFieldValues({...fieldValues,[f.fieldId]:e.target.value})} placeholder={f.placeholder||`Enter ${f.type.toLowerCase()}`} type={f.type==="Number"?"number":"text"}/>}</label>)}<div style={{marginTop:18,display:"flex",gap:8,flexWrap:"wrap"}}><button onClick={sign} disabled={busy||selected.status==="Completed"||!(selected.fields||[]).some(f=>f?.signerUid===auth.currentUser?.uid)||!manualSigningAuthority.trim()}>{busy?"Processing...":selected.status==="Completed"?"Completed":(selected.fields||[]).some(f=>f?.signerUid===auth.currentUser?.uid)?"Adopt Signature & Sign":"Not Assigned — Signing Disabled"}</button>{selected.status==="Completed"&&<button className="secondary-button" onClick={certificate} disabled={busy}>Generate Certificate of Completion</button>}{selected.signedDocumentUrl&&<a className="secondary-button" href={selected.signedDocumentUrl} target="_blank" rel="noreferrer">Open Signed PDF</a>}{selected.certificateUrl&&<a className="secondary-button" href={selected.certificateUrl} target="_blank" rel="noreferrer">Open Certificate</a>}{selected.certificateArchiveUrl&&<a className="secondary-button" href={selected.certificateArchiveUrl} target="_blank" rel="noreferrer">Open Archived Certificate</a>}</div></div></>}</section>}
 </div>;
}
