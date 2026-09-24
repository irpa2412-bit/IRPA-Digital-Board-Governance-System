import React,{useEffect,useMemo,useRef,useState}from"react";
import{getCurrentEmployeeProfile,getCurrentMemberProfile,getCurrentSigningAuthorityRegisterEntries,getRecords}from"../firebase/data";
import{downloadDriveBytes}from"../firebase/signatureStorage";
import{auth}from"../firebase/config";
import{getMySignerIdentity}from"../firebase/signerIdentity";
import{createCompletionCertificate,createSignatureEnvelope,getMySignatureProfile,getSignatureEnvelope,getSignatureEnvelopes,getMySignedDocuments,saveMySignatureProfile,signEnvelope,saveSignatureWorkflowDraft,finalizeSignatureWorkflowDraft,startSignatureWorkflow}from"../firebase/signaturePlatform";
import{updateMySignerAuthority}from"../firebase/signerIdentity";
import*as pdfjsLib from"pdfjs-dist";
import pdfWorker from"pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

const TYPES=["Signature","Initials","Date","Name","Text","Number","Comment","Remarks","Checkbox"];const TYPE_LABELS={Signature:"Signature",Initials:"Initials",Date:"Date & Time",Name:"Name",Text:"Text",Number:"Number",Comment:"Comment",Remarks:"Remarks",Checkbox:"Checkbox"};
const COLORS={Signature:"#6d5dfc",Initials:"#7c3aed",Date:"#0891b2",Name:"#2563eb",Text:"#0f766e",Number:"#db2777",Comment:"#0284c7",Remarks:"#ea580c",Checkbox:"#b45309"};
const DEFAULTS={Signature:{width:28,height:10},Initials:{width:16,height:8},Date:{width:18,height:6},Name:{width:24,height:6},Text:{width:30,height:7},Number:{width:20,height:6},Comment:{width:34,height:10},Remarks:{width:34,height:10},Checkbox:{width:7,height:7}};

function makeField(type,i,uid,page=1){const d=DEFAULTS[type]||DEFAULTS.Text;return{fieldId:`FIELD-${Date.now()}-${i}`,type,page,x:8,y:12,width:d.width,height:d.height,required:type!=="Checkbox",signerUid:uid,responsibility:type==="Signature"?"Signature":type==="Initials"?"Initial":type==="Date"?"Date":type==="Comment"?"Comment":type==="Remarks"?"Remarks":type==="Number"?"Number Entry":type==="Checkbox"?"Approval":"Review",placeholder:type==="Comment"?"Enter comment":type==="Remarks"?"Enter remarks":type==="Number"?"Enter number":""};}

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
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
      const dataUrl=canvasRef.current.toDataURL("image/png");
      const result=await(onSave?onSave(dataUrl):onUse(dataUrl));
      setFeedback("SUCCESS: this handwritten signature is now the CURRENT SIGNATURE and will be reused for future documents.");
      return result;
    }catch(e){
      setFeedback("SAVE FAILED: "+(e?.message||"The signature could not be stored."));
    }
  };

  return(
    <div data-signature-specimen="true">
      <div className="panel" style={{marginTop:16,border:"1px solid rgba(109,93,252,.45)"}}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DIGITAL SIGNING SPECIMEN</span>
            <h3 style={{margin:"6px 0"}}>{label}</h3>
            <p className="muted">Sign in the box below using your finger, stylus or mouse. This is your signing specimen and can be saved directly to your Signature Profile.</p>
          </div>
        </div>
        <div role="status" aria-live="polite" style={{marginBottom:10,padding:"12px 14px",borderRadius:8,background:replacementMode?"rgba(220,38,38,.16)":"rgba(22,163,74,.10)",border:replacementMode?"1px solid rgba(248,113,113,.55)":"1px solid rgba(74,222,128,.35)",color:"#fff",fontWeight:700}}>
          {replacementMode
            ?"REPLACEMENT MODE — your current served signature remains active until this new handwritten specimen is successfully saved."
            :"HANDWRITTEN SPECIMEN — save it once to make it the persistent signature for future documents."}
        </div>
        <div style={{background:"#fff",border:"2px solid #6d5dfc",borderRadius:10,padding:6,overflow:"hidden",boxShadow:"inset 0 -28px 0 rgba(109,93,252,.06)"}}>
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
   <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:Math.max(9,11*zoom),fontWeight:700,color:c,overflow:"hidden",whiteSpace:"nowrap",padding:"2px 18px 2px 5px",boxSizing:"border-box"}}>{(field.type==="Signature"&&signatureSrc)||(field.type==="Initials"&&initialsSrc)?<img src={field.type==="Signature"?signatureSrc:initialsSrc} alt={TYPE_LABELS[field.type]||field.type} style={{maxWidth:"88%",maxHeight:"58%",objectFit:"contain",display:"block",pointerEvents:"none",userSelect:"none"}}/>:field.type==="Date"?<span style={{fontSize:Math.max(9,10*zoom),fontWeight:900,whiteSpace:"nowrap"}}>{new Date(designerNow||Date.now()).toLocaleString()}</span>:<span>{active?"ACTIVE ASSESSMENT · ":""}{TYPE_LABELS[field.type]||field.type}{field.required?" *":""}</span>}<small style={{fontSize:Math.max(7,8*zoom),opacity:.85,overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{recipients.find(r=>r.uid===field.signerUid)?.name||"Unassigned"} · {field.responsibility||"Review"}</small></div>
   {selected&&<><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(field.fieldId)}} style={{position:"absolute",right:2,top:2,width:18,height:18,border:0,borderRadius:4,background:"#111827",color:"#fff",fontSize:11,cursor:"pointer"}}>×</button><span onPointerDown={startResize} style={{position:"absolute",right:-4,bottom:-4,width:10,height:10,borderRadius:2,background:c,cursor:"nwse-resize"}}/></>}
 </div>;
}

function PDFDesigner({url,documentId,fields,setFields,recipients,selectedField,setSelectedField,activeAssigneeUid,signatureSrc,initialsSrc}){
 const canvasRef=useRef(null),pageHostRef=useRef(null);const[pdf,setPdf]=useState(null);const[pageNum,setPageNum]=useState(1);const[pageSize,setPageSize]=useState({width:800,height:1035});const[zoom,setZoom]=useState(1);const[loading,setLoading]=useState(false);const[error,setError]=useState("");const[grid,setGrid]=useState(true);const[history,setHistory]=useState([]);const[redoStack,setRedoStack]=useState([]);const[designerNow,setDesignerNow]=useState(()=>new Date());
 useEffect(()=>{const timer=window.setInterval(()=>setDesignerNow(new Date()),1000);return()=>window.clearInterval(timer)},[]);useEffect(()=>{let dead=false;(async()=>{if(!url){setPdf(null);return}setLoading(true);setError("");try{const source=url.startsWith("drive://")?{data:await downloadDriveBytes(url.slice("drive://".length),documentId)}:{url};const task=pdfjsLib.getDocument(source);const p=await task.promise;if(!dead){setPdf(p);setPageNum(1)}}catch(e){if(!dead)setError(e.message||"Unable to render PDF.")}finally{if(!dead)setLoading(false)}})();return()=>{dead=true};},[url]);
 useEffect(()=>{let dead=false;(async()=>{if(!pdf||!canvasRef.current)return;try{const page=await pdf.getPage(pageNum);const base=page.getViewport({scale:1});const scale=Math.max(.55,(760/base.width))*zoom;const viewport=page.getViewport({scale});const canvas=canvasRef.current;const output=window.devicePixelRatio||1;canvas.width=Math.floor(viewport.width*output);canvas.height=Math.floor(viewport.height*output);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;setPageSize({width:viewport.width,height:viewport.height});const ctx=canvas.getContext("2d");ctx.setTransform(output,0,0,output,0,0);await page.render({canvasContext:ctx,viewport}).promise;if(!dead){} }catch(e){if(!dead)setError(e.message||"Unable to render page.")}})();return()=>{dead=true}},[pdf,pageNum,zoom]);
 const pageFields=fields.filter(f=>Number(f.page)===pageNum);
 const commit=next=>{setHistory(h=>[...h,fields].slice(-50));setRedoStack([]);setFields(next)};const undo=()=>{setHistory(h=>{if(!h.length)return h;const previous=h[h.length-1];setRedoStack(r=>[fields,...r].slice(0,50));setFields(previous);return h.slice(0,-1)})};const redo=()=>{setRedoStack(r=>{if(!r.length)return r;const next=r[r.length-1];setHistory(h=>[...h,fields].slice(-50));setFields(next);return r.slice(0,-1)})};const addAt=(type,x=50,y=20)=>{if(!recipients.length){setError("Add at least one signer before placing fields.");return}const f=makeField(type,fields.length,recipients[0].uid,pageNum);f.x=clamp(x-f.width/2,0,100-f.width);f.y=clamp(y-f.height/2,0,100-f.height);commit([...fields,f]);setSelectedField(f.fieldId);setError("")};
 const drop=e=>{e.preventDefault();const type=e.dataTransfer.getData("fieldType");if(!type)return;const r=pageHostRef.current.getBoundingClientRect();addAt(type,((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100);};
 const update=(id,patch)=>commit(fields.map(f=>f.fieldId===id?{...f,...patch}:f));const deleteSelected=()=>{if(!selectedField)return;commit(fields.filter(f=>f.fieldId!==selectedField));setSelectedField(null)};const duplicateSelected=()=>{const f=fields.find(x=>x.fieldId===selectedField);if(!f)return;const copy={...f,fieldId:"FIELD-"+Date.now()+"-"+fields.length,x:clamp(f.x+3,0,100-f.width),y:clamp(f.y+3,0,100-f.height)};commit([...fields,copy]);setSelectedField(copy.fieldId)};const centerX=()=>{const f=fields.find(x=>x.fieldId===selectedField);if(f)update(f.fieldId,{x:clamp((100-f.width)/2,0,100-f.width)})};const centerY=()=>{const f=fields.find(x=>x.fieldId===selectedField);if(f)update(f.fieldId,{y:clamp((100-f.height)/2,0,100-f.height)})};const clearPage=()=>{if(pageFields.length){commit(fields.filter(f=>Number(f.page)!==pageNum));setSelectedField(null)}};
 return <div style={{display:"grid",gridTemplateColumns:"240px minmax(560px,1fr) 320px",gap:14,marginTop:18,minHeight:700,alignItems:"start"}}>
  <aside style={{background:"#0b1220",color:"#f8fafc",border:"1px solid rgba(148,163,184,.32)",borderRadius:12,padding:14,overflow:"auto",maxHeight:"78vh",boxShadow:"0 10px 28px rgba(0,0,0,.22)"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div><strong style={{display:"block",fontSize:14}}>FIELD PALETTE</strong><small style={{display:"block",marginTop:3,color:"#cbd5e1",opacity:1}}>Click a tool to add it, or drag it onto the PDF</small></div><span style={{fontSize:11,padding:"5px 8px",borderRadius:999,background:"rgba(22,163,74,.18)",border:"1px solid rgba(134,239,172,.35)",color:"#bbf7d0",fontWeight:800,whiteSpace:"nowrap"}}>{fields.length} field{fields.length===1?"":"s"}</span></div><div style={{fontSize:11,color:"#bfdbfe",letterSpacing:".08em",fontWeight:900,marginBottom:8}}>SIGNING &amp; IDENTITY</div>{TYPES.slice(0,5).map(t=><button key={t} type="button" draggable onDragStart={e=>e.dataTransfer.setData("fieldType",t)} onClick={()=>addAt(t)} title={"Add "+TYPE_LABELS[t]} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 10px",minHeight:t==="Signature"?88:68,marginBottom:7,borderRadius:9,border:`1px solid ${COLORS[t]}99`,background:`linear-gradient(180deg,${COLORS[t]}24,rgba(15,23,42,.82))`,color:"#f8fafc",cursor:"grab",fontWeight:800,boxShadow:"inset 0 1px 0 rgba(255,255,255,.05)",overflow:"hidden"}}>{t==="Signature"&&signatureSrc?<img src={signatureSrc} alt="Saved signature" style={{display:"block",width:"100%",height:44,objectFit:"contain",background:"#fff",borderRadius:5,padding:"3px",boxSizing:"border-box",marginBottom:6,pointerEvents:"none"}}/>:t==="Initials"&&initialsSrc?<img src={initialsSrc} alt="Saved initials" style={{display:"block",width:"72%",height:34,objectFit:"contain",background:"#fff",borderRadius:5,padding:"3px",boxSizing:"border-box",marginBottom:6,pointerEvents:"none"}}/>:<span style={{display:"inline-block",width:8,height:8,borderRadius:3,background:COLORS[t],marginRight:8}}/>}{t==="Signature"&&!signatureSrc?<span>Signature Profile Required</span>:t==="Date"?<span style={{display:"block",fontSize:12,fontWeight:900,marginTop:2}}>{designerNow.toLocaleString()}</span>:TYPE_LABELS[t]}<small style={{display:"block",marginTop:4,color:"#cbd5e1",opacity:1,fontSize:10,fontWeight:500}}>{t==="Date" ? "Live date & time • click or drag" : "Click or drag to page"}</small></button>)}<div style={{fontSize:11,color:"#ddd6fe",letterSpacing:".08em",fontWeight:900,margin:"16px 0 8px"}}>EDITORIAL &amp; REVIEW</div>{TYPES.slice(5).map(t=><button key={t} type="button" draggable onDragStart={e=>e.dataTransfer.setData("fieldType",t)} onClick={()=>addAt(t)} title={"Add "+TYPE_LABELS[t]} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 10px",marginBottom:6,borderRadius:8,border:`1px solid ${COLORS[t]}88`,background:`${COLORS[t]}20`,color:"#fff",cursor:"grab",fontWeight:700}}><span style={{display:"inline-block",width:8,height:8,borderRadius:3,background:COLORS[t],marginRight:8}}/>{TYPE_LABELS[t]}<small style={{display:"block",marginLeft:16,opacity:.55,fontWeight:400}}>Click or drag to page</small></button>)}<div style={{borderTop:"1px solid rgba(148,163,184,.24)",paddingTop:14,marginTop:12}}><strong style={{display:"block",fontSize:12,color:"#e2e8f0",letterSpacing:".04em",marginBottom:8}}>EDITORIAL TOOLS</strong><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}><button type="button" onClick={undo} disabled={!history.length} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:history.length?"#172033":"#111827",color:history.length?"#f8fafc":"#64748b",fontWeight:800,cursor:history.length?"pointer":"not-allowed"}}>↶ Undo</button><button type="button" onClick={redo} disabled={!redoStack.length} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:redoStack.length?"#172033":"#111827",color:redoStack.length?"#f8fafc":"#64748b",fontWeight:800,cursor:redoStack.length?"pointer":"not-allowed"}}>↷ Redo</button><button type="button" onClick={duplicateSelected} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:selectedField?"#172033":"#111827",color:selectedField?"#f8fafc":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Duplicate</button><button type="button" onClick={deleteSelected} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(248,113,113,.35)",background:selectedField?"rgba(127,29,29,.42)":"#111827",color:selectedField?"#fecaca":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Delete</button><button type="button" onClick={centerX} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:selectedField?"#172033":"#111827",color:selectedField?"#f8fafc":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Center X</button><button type="button" onClick={centerY} disabled={!selectedField} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:selectedField?"#172033":"#111827",color:selectedField?"#f8fafc":"#64748b",fontWeight:800,cursor:selectedField?"pointer":"not-allowed"}}>Center Y</button><button type="button" onClick={()=>setGrid(v=>!v)} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(96,165,250,.35)",background:"#172033",color:"#dbeafe",fontWeight:800,cursor:"pointer"}}>{grid?"Hide Grid":"Show Grid"}</button><button type="button" onClick={()=>setZoom(1)} style={{minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(148,163,184,.28)",background:"#172033",color:"#f8fafc",fontWeight:800,cursor:"pointer"}}>100%</button></div><button type="button" style={{width:"100%",marginTop:7,minHeight:38,padding:"8px 9px",borderRadius:7,border:"1px solid rgba(248,113,113,.35)",background:pageFields.length?"rgba(127,29,29,.42)":"#111827",color:pageFields.length?"#fecaca":"#64748b",fontWeight:800,cursor:pageFields.length?"pointer":"not-allowed"}} onClick={clearPage} disabled={!pageFields.length}>Clear Current Page</button></div><div className="panel" style={{marginTop:16,padding:12,background:"#111a2b",border:"1px solid rgba(148,163,184,.22)",color:"#f8fafc"}}><strong style={{display:"block",marginBottom:8,fontSize:12,color:"#e2e8f0"}}>ASSIGN RESPONSIBILITY</strong><p style={{fontSize:11,lineHeight:1.5,color:"#cbd5e1",opacity:1,margin:"0 0 10px"}}>Every highlighted field is assigned to an addressee. The assigned officer will see only their responsibilities when signing.</p>{fields.length===0?<div style={{fontSize:11,opacity:.6}}>Place a field on the document to assign it.</div>:fields.map((f,i)=><div key={f.fieldId} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><strong style={{fontSize:11}}>{i+1}. {f.type}</strong><label style={{display:"block",marginTop:5,fontSize:11}}>Addressee<select value={f.signerUid||""} onChange={e=>setFields(fields.map(x=>x.fieldId===f.fieldId?{...x,signerUid:e.target.value}:x))}><option value="">Select addressee</option>{recipients.map(r=><option key={r.uid} value={r.uid}>{r.name||r.email}</option>)}</select></label><label style={{display:"block",marginTop:5,fontSize:11}}>Responsibility<select value={f.responsibility||""} onChange={e=>setFields(fields.map(x=>x.fieldId===f.fieldId?{...x,responsibility:e.target.value}:x))}><option value="">Select responsibility</option><option>Signature</option><option>Initial</option><option>Review</option><option>Comment</option><option>Number Entry</option><option>Remarks</option><option>Date & Time</option><option>Verification</option><option>Recommendation</option><option>Authorization</option><option>Approval</option><option>Final Authorization</option></select></label></div>)}</div><div style={{marginTop:14,fontSize:12,lineHeight:1.5,color:"#cbd5e1",opacity:1,padding:"9px 10px",borderRadius:7,background:"rgba(148,163,184,.08)"}}>Drag, move and resize fields directly on the rendered PDF page.</div></aside>
  <main style={{background:"#1e293b",borderRadius:12,padding:12,overflow:"auto",minHeight:680}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:12,position:"sticky",top:0,zIndex:50,background:"#1e293b",paddingBottom:8}}><div style={{display:"flex",gap:6}}><button type="button" className="text-button" disabled={!pdf||pageNum<=1} onClick={()=>setPageNum(p=>p-1)}>‹</button><span style={{padding:"8px 10px",fontSize:13}}>Page {pageNum} / {pdf?.numPages||0}</span><button type="button" className="text-button" disabled={!pdf||pageNum>=pdf.numPages} onClick={()=>setPageNum(p=>p+1)}>›</button></div><div style={{display:"flex",gap:6,alignItems:"center"}}><button type="button" className="text-button" onClick={()=>setZoom(z=>clamp(Number((z-.1).toFixed(2)),.6,1.8))}>−</button><span style={{fontSize:12}}>{Math.round(zoom*100)}%</span><button type="button" className="text-button" onClick={()=>setZoom(z=>clamp(Number((z+.1).toFixed(2)),.6,1.8))}>+</button></div></div>{loading&&<div className="muted">Rendering PDF…</div>}{error&&<div className="auth-message" style={{marginBottom:10}}>{error}</div>} {!url?<div className="muted" style={{padding:40,textAlign:"center"}}>Select a controlled PDF to open the visual designer.</div>:<div style={{display:"flex",justifyContent:"center",padding:8}}><div ref={pageHostRef} onDragOver={e=>e.preventDefault()} onDrop={drop} onPointerDown={()=>setSelectedField(null)} style={{position:"relative",width:pageSize.width,height:pageSize.height,background:"#fff",boxShadow:"0 8px 30px rgba(0,0,0,.35)",flex:"0 0 auto",backgroundImage:grid?"linear-gradient(rgba(15,23,42,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,.06) 1px,transparent 1px)":"none",backgroundSize:grid?"20px 20px":"auto"}}><canvas ref={canvasRef} style={{position:"absolute",inset:0,pointerEvents:"none"}}/>{pageFields.map(f=><FieldBox key={f.fieldId} field={f} selected={selectedField===f.fieldId} onSelect={setSelectedField} onMove={(id,x,y)=>update(id,{x,y})} onResize={(id,width,height)=>update(id,{width,height})} onDelete={id=>{commit(fields.filter(f=>f.fieldId!==id));setSelectedField(null)}} zoom={zoom} recipients={recipients} activeAssigneeUid={activeAssigneeUid} signatureSrc={signatureSrc} initialsSrc={initialsSrc} designerNow={designerNow}/>)}</div></div>}</main>
  <aside style={{background:"#0b1220",color:"#f8fafc",border:"1px solid rgba(148,163,184,.32)",borderRadius:12,padding:14,boxShadow:"0 10px 28px rgba(0,0,0,.22)"}}><div style={{fontSize:14,fontWeight:900,color:"#f8fafc",paddingBottom:10,borderBottom:"1px solid rgba(148,163,184,.22)"}}>FIELD PROPERTIES</div>{!selectedField?<p style={{fontSize:13,lineHeight:1.5,color:"#cbd5e1",marginTop:16}}>Select a field on the PDF to edit its properties.</p>:(()=>{const f=fields.find(x=>x.fieldId===selectedField);if(!f)return null;return <div style={{marginTop:14,color:"#f8fafc"}}><label style={{display:"block",color:"#e2e8f0",fontWeight:700}}>Type<select value={f.type} onChange={e=>update(f.fieldId,{type:e.target.value})}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label><label>Assigned addressee<select value={f.signerUid||""} onChange={e=>update(f.fieldId,{signerUid:e.target.value})}><option value="">Assign addressee</option>{recipients.map(r=><option key={r.uid} value={r.uid}>{r.name||r.email} · {r.role||""}</option>)}</select></label><label>Responsibility<select value={f.responsibility||""} onChange={e=>update(f.fieldId,{responsibility:e.target.value})}><option value="">Select responsibility</option><option>Signature</option><option>Initial</option><option>Review</option><option>Comment</option><option>Number Entry</option><option>Remarks</option><option>Date</option><option>Verification</option><option>Recommendation</option><option>Authorization</option><option>Approval</option><option>Final Authorization</option></select></label><label>Page<input type="number" min="1" max={pdf?.numPages||1} value={f.page} onChange={e=>update(f.fieldId,{page:clamp(Number(e.target.value)||1,1,pdf?.numPages||1)})}/></label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><label>X %<input type="number" min="0" max="100" step=".1" value={Number(f.x).toFixed(1)} onChange={e=>update(f.fieldId,{x:clamp(Number(e.target.value)||0,0,100-f.width)})}/></label><label>Y %<input type="number" min="0" max="100" step=".1" value={Number(f.y).toFixed(1)} onChange={e=>update(f.fieldId,{y:clamp(Number(e.target.value)||0,0,100-f.height)})}/></label><label>Width %<input type="number" min="3" max="100" step=".1" value={Number(f.width).toFixed(1)} onChange={e=>update(f.fieldId,{width:clamp(Number(e.target.value)||3,3,100-f.x)})}/></label><label>Height %<input type="number" min="3" max="100" step=".1" value={Number(f.height).toFixed(1)} onChange={e=>update(f.fieldId,{height:clamp(Number(e.target.value)||3,3,100-f.y)})}/></label></div><label style={{display:"flex",gap:8,alignItems:"center",marginTop:12}}><input type="checkbox" checked={!!f.required} onChange={e=>update(f.fieldId,{required:e.target.checked})}/> Required field</label><button type="button" className="text-button" style={{marginTop:14}} onClick={deleteSelected}>Delete field</button></div>})()}</aside>
 </div>;
}

function SigningDocumentViewer({url,documentId,fields,profile,fieldValues,setFieldValues}){
 const canvasRef=useRef(null);const hostRef=useRef(null);const inkCanvasRef=useRef(null);const[inkField,setInkField]=useState(null);const[drawing,setDrawing]=useState(false);const[pdf,setPdf]=useState(null);const[pageNum,setPageNum]=useState(1);const[pageSize,setPageSize]=useState({width:760,height:980});const[error,setError]=useState("");const[loading,setLoading]=useState(false);
 useEffect(()=>{let dead=false;(async()=>{if(!url){setPdf(null);return}setLoading(true);setError("");try{const source=url.startsWith("drive://")?{data:await downloadDriveBytes(url.slice("drive://".length),documentId)}:{url};const task=pdfjsLib.getDocument(source);const p=await task.promise;if(!dead){setPdf(p);setPageNum(1)}}catch(e){if(!dead)setError(e.message||"Unable to open the signing document.")}finally{if(!dead)setLoading(false)}})();return()=>{dead=true}},[url,documentId]);
 useEffect(()=>{let dead=false;(async()=>{if(!pdf||!canvasRef.current)return;try{const page=await pdf.getPage(pageNum);const base=page.getViewport({scale:1});const scale=Math.max(.55,760/base.width);const viewport=page.getViewport({scale});const canvas=canvasRef.current;const dpr=window.devicePixelRatio||1;canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);canvas.style.width=viewport.width+"px";canvas.style.height=viewport.height+"px";setPageSize({width:viewport.width,height:viewport.height});const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);await page.render({canvasContext:ctx,viewport}).promise}catch(e){if(!dead)setError(e.message||"Unable to render signing page.")}})();return()=>{dead=true}},[pdf,pageNum]);
 const mine=(fields||[]).filter(f=>Number(f.page||1)===pageNum&&f.signerUid===auth.currentUser?.uid);
 const setValue=(f,v)=>setFieldValues(prev=>({...prev,[f.fieldId]:v}));
 const activate=(f)=>{if(f.type==="Date"){setValue(f,new Date().toLocaleString([], {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));return;}if((f.type==="Signature"||f.type==="Initials")){const src=f.type==="Signature"?profile?.signatureUrl:profile?.initialsUrl;if(src){setValue(f,src);}else{setError?.("Your Signature Profile does not contain a saved "+f.type.toLowerCase()+" specimen.");}}};
 return <div className="panel mobile-signing-panel" style={{marginBottom:18}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}><div><strong>Document you are signing</strong><div className="muted" style={{fontSize:12}}>Review the actual PDF below. Only fields assigned to you are active.</div></div><div style={{display:"flex",gap:6}}><button type="button" className="text-button" disabled={!pdf||pageNum<=1} onClick={()=>setPageNum(p=>p-1)}>‹</button><span style={{padding:"7px 8px",fontSize:12}}>Page {pageNum} / {pdf?.numPages||0}</span><button type="button" className="text-button" disabled={!pdf||pageNum>=pdf.numPages} onClick={()=>setPageNum(p=>p+1)}>›</button></div></div>
  {loading&&<div className="auth-message">Loading the actual controlled PDF…</div>}{error&&<div className="error-message action-feedback">{error}</div>}
  <div ref={hostRef} style={{position:"relative",width:pageSize.width,maxWidth:"100%",margin:"0 auto",background:"#fff",boxShadow:"0 2px 16px rgba(0,0,0,.35)",overflow:"hidden"}}>
   <canvas ref={canvasRef} style={{display:"block",width:"100%"}}/>
   {mine.map(f=>{const value=fieldValues[f.fieldId]||"";const common={position:"absolute",left:f.x+"%",top:f.y+"%",width:f.width+"%",height:f.height+"%",boxSizing:"border-box",border:"2px solid #16a34a",background:"rgba(22,163,74,.10)",borderRadius:5,zIndex:5};if(f.type==="Signature"||f.type==="Initials"){const automatic=f.type==="Signature"?profile?.signatureUrl:profile?.initialsUrl;return <button type="button" key={f.fieldId} onClick={()=>automatic?setValue(f,automatic):setInkField(f)} style={{...common,padding:4,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{value?<img src={value} alt={f.type==="Signature"?"Inserted saved signature":"Inserted saved initials"} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>:<span style={{fontSize:11,fontWeight:700,color:"#15803d"}}>{automatic?"CLICK TO INSERT":"CLICK TO CAPTURE INK"}</span>}</button>;}if(f.type==="Date")return <button type="button" key={f.fieldId} onClick={()=>activate(f)} style={{...common,border:"2px solid #0891b2",color:"#075985",fontWeight:700,fontSize:12,textAlign:"left",padding:"4px",cursor:"pointer"}}>{value||"CLICK TO INSERT DATE"}</button>;return <input key={f.fieldId} value={value} onChange={e=>setValue(f,e.target.value)} placeholder={f.placeholder||("Enter "+f.type.toLowerCase())} type={f.type==="Number"?"number":"text"} style={{...common,padding:"4px 7px",color:"#111827",fontSize:12,outline:"none"}}/>})}
  </div>
  {inkField&&<div style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><div className="panel" style={{width:"min(680px,96vw)",background:"#fff",color:"#111827"}}><h3>Capture Handwritten {TYPE_LABELS[inkField.type]||inkField.type}</h3><p className="muted">Use a mouse, trackpad, stylus, or your phone/tablet touchscreen. Turn your phone or tablet sideways if the document is easier to review in landscape. Your handwritten signature is captured as live touch/stylus ink and inserted into the assigned field.</p><div className="success-message action-feedback" style={{marginBottom:10}}>PHONE / TABLET SIGNING ENABLED — tap the green Signature field, write with your finger or stylus, then tap <strong>Use Handwritten Ink</strong>.</div><canvas ref={inkCanvasRef} width="900" height="300" style={{width:"100%",height:"clamp(180px,38vw,300px)",minHeight:180,border:"2px solid #cbd5e1",background:"#fff",touchAction:"none",cursor:"crosshair",display:"block",userSelect:"none",WebkitUserSelect:"none"}} onPointerDown={startInk} onPointerMove={moveInk} onPointerUp={()=>setDrawing(false)} onPointerCancel={()=>setDrawing(false)}/><div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:12}}><button type="button" className="text-button" onClick={clearInk}>Clear</button><button type="button" className="secondary-button" onClick={()=>setInkField(null)}>Cancel</button><button type="button" onClick={saveInk}>Use Handwritten Ink</button></div></div></div>}
  <div className="success-message action-feedback" style={{marginTop:10}}>Green fields are assigned to you. Click your Signature/Initials/Date fields to apply them; enter editorial text, numbers, comments or remarks directly on the document.</div>
 </div>;
}

export default function SignaturePlatform({signerOnly=false,signingEnvelopeId=null,initialDocument=null}){
 const[tab,setTab]=useState("Profile"),[profile,setProfile]=useState(null),[signerIdentity,setSignerIdentity]=useState(null),[docs,setDocs]=useState([]),[envelopes,setEnvelopes]=useState([]),[signedDocuments,setSignedDocuments]=useState([]),[members,setMembers]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[revokeOpen,setRevokeOpen]=useState(false),[revokeBusy,setRevokeBusy]=useState(false);
 const[authorityMember,setAuthorityMember]=useState(null),[authorityEmployee,setAuthorityEmployee]=useState(null),[authorityRegisterEntries,setAuthorityRegisterEntries]=useState([]),[authorityDepartment,setAuthorityDepartment]=useState(""),[authorityUnit,setAuthorityUnit]=useState(""),[authorityRole,setAuthorityRole]=useState(""),[authorityStatus,setAuthorityStatus]=useState("Current"),[authorityReference,setAuthorityReference]=useState(""),[authorityEffectiveAt,setAuthorityEffectiveAt]=useState(""),[authorityExpiresAt,setAuthorityExpiresAt]=useState(""),[authorityBusy,setAuthorityBusy]=useState(false);
 const[displayName,setDisplayName]=useState(""),[initials,setInitials]=useState(""),[servedSignatureSrc,setServedSignatureSrc]=useState(""),[servedInitialsSrc,setServedInitialsSrc]=useState(""),[signatureFile,setSignatureFile]=useState(null),[initialsFile,setInitialsFile]=useState(null),[drawnSignature,setDrawnSignature]=useState(""),[replacementMode,setReplacementMode]=useState(false);
 const[title,setTitle]=useState(""),[documentId,setDocumentId]=useState(""),[documentUrl,setDocumentUrl]=useState(""),[signingMode,setSigningMode]=useState("Sequential"),[selectedSigner,setSelectedSigner]=useState(""),[draftEnvelopeId,setDraftEnvelopeId]=useState(null),[signerEmail,setSignerEmail]=useState(""),[signerRole,setSignerRole]=useState("Review"),[recipients,setRecipients]=useState([]),[fields,setFields]=useState([]),[selectedField,setSelectedField]=useState(null),[fieldValues,setFieldValues]=useState({}),[ownerSigningEnabled,setOwnerSigningEnabled]=useState(false),[initiateTitle,setInitiateTitle]=useState(""),[initiateDocumentId,setInitiateDocumentId]=useState(""),[initiateSigningMode,setInitiateSigningMode]=useState("Sequential");
 useEffect(()=>{
   let cancelled=false;
   (async()=>{
     const resolveAsset=async(url)=>{
       const value=String(url||"");
       if(!value)return "";
       if(!value.startsWith("drive://"))return value;
       try{
         const bytes=await downloadDriveBytes(value.slice("drive://".length));
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
        const d=await getRecords("documents");
        setDocs(d);
      }catch(error){
        console.warn("Controlled Documents unavailable:",error);
        setDocs([]);
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

      const m=await getRecords("members");
      setMembers(m.filter(x=>x.status==="Active"));
    }catch(x){
      setMessage(x.message||"Unable to load Signature Portal.")
    }
  })()},[signerOnly,signingEnvelopeId]);
 useEffect(()=>{if(initialDocument?.id){setDocs(prev=>[initialDocument,...prev.filter(d=>d.id!==initialDocument.id)]);setDocumentId(initialDocument.id);setTab("Prepare Envelope");setMessage(`Document "${initialDocument.title||initialDocument.fileName||initialDocument.id}" is ready for selection and signing.`)}},[initialDocument]);
 const selectedDoc=useMemo(()=>docs.find(x=>x.id===documentId),[docs,documentId]);
 const documentOwner=useMemo(()=>({uid:auth.currentUser?.uid,name:auth.currentUser?.displayName||auth.currentUser?.email||"Document Owner",email:auth.currentUser?.email||"",role:"Document Owner",routingOrder:1,status:"Owner"}),[auth.currentUser?.uid,auth.currentUser?.displayName,auth.currentUser?.email]);
 const workflowRecipients=useMemo(()=>[documentOwner,...recipients.filter(r=>r.uid!==documentOwner.uid).map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}))],[documentOwner,recipients,signingMode]);
 useEffect(()=>{if(selectedDoc){const link=String(selectedDoc.webViewLink||"");const driveId=selectedDoc.fileId||((link.match(/\/d\/([a-zA-Z0-9_-]+)/)||[])[1])||((link.match(/[?&]id=([a-zA-Z0-9_-]+)/)||[])[1])||"";const url=selectedDoc.fileUrl||selectedDoc.documentUrl||selectedDoc.storageUrl||selectedDoc.pdfUrl||(driveId?`drive://${driveId}`:"");setDocumentUrl(url)}else setDocumentUrl("")},[selectedDoc]);
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
 const authorityDepartments=useMemo(()=>[...new Set(authorityRegisterRecords.map(x=>x.department).filter(Boolean))],[authorityRegisterRecords]);
 const authorityOptions=useMemo(()=>{
   const options=[];
   for(const record of authorityRegisterRecords.filter(x=>x.department===authorityDepartment)){
     const values=[
       record.role,record.boardPosition,record.unit,record.unitName,
       ...(Array.isArray(record.roles)?record.roles:[]),
       ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
       ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
       ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
     ].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
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
     if(/(^| )board secretary$|^secretary$/.test(normalized)) return "Board Secretary";
   }
   return role;
 };
 const authorityCapacityPriority=(role,department=authorityDepartment)=>{
   const label=authorityDisplayLabel(role,department);
   if(label==="Board Chairperson")return 0;
   if(label==="Board Secretary")return 1;
   return 2;
 };
 const isPermanentExecutiveAuthority=(department=authorityDepartment,role=authorityRole)=>{
   const d=String(department||"").trim().toLowerCase();
   const r=String(role||"").trim().toLowerCase();
   return d==="executive office"&&(r==="executive director"||r==="executive office");
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
       authorityEffectiveAt,
       authorityExpiresAt,
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
 async function addSigner(){if(busy)return;const email=String(signerEmail||"").trim().toLowerCase();const m=members.find(x=>x.uid===selectedSigner||String(x.email||"").trim().toLowerCase()===email);if(!m){setMessage("Select a registered officer or enter the email address of a registered IRPA officer.");return;}if(recipients.some(x=>x.uid===m.uid)){setMessage("This officer is already in the signer hierarchy.");return;}if(!title.trim()){setMessage("Enter the envelope title before adding a signer. The owner section cannot be saved without a title.");return;}if(!documentId||!documentUrl){setMessage("Select a controlled PDF before adding a signer. The owner section will be saved automatically when you add the officer.");return;}const role=signerRole||"Review";const institutionalRole=m.boardPosition||m.role||"";const next={uid:m.uid,name:m.name||m.email,email:m.email||email,role,institutionalRole,routingOrder:signingMode==="Sequential"?recipients.length+2:1,status:"Pending"};const nextRecipients=[...recipients,next];setBusy(true);setMessage("Saving the owner section and the new officer assignment…");try{const saved=await saveSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,signingMode,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",recipients:nextRecipients,fields,ownerSigningEnabled});setDraftEnvelopeId(saved.id);setRecipients(nextRecipients);setSelectedSigner("");setSignerEmail("");setSignerRole("Review");setMessage("Owner section saved. "+(m.name||m.email)+" is now assigned as "+role+" and added to the workflow.");}catch(x){setMessage("Signer was not added: "+(x.message||"Unable to save the workflow."));}finally{setBusy(false)}}
 function removeSigner(uid){const removed=recipients.find(r=>r.uid===uid);setRecipients(recipients.filter(r=>r.uid!==uid));setFields(fields.map(f=>f.signerUid===uid?{...f,signerUid:""}:f));setMessage(`${removed?.name||"Officer"} removed. Reassign any fields previously assigned to this officer before saving the draft.`)}
 function moveSigner(uid,direction){const index=recipients.findIndex(r=>r.uid===uid);const next=index+direction;if(index<0||next<0||next>=recipients.length)return;const copy=[...recipients];[copy[index],copy[next]]=[copy[next],copy[index]];setRecipients(copy.map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1})));}
 async function initiateSigning(e){e.preventDefault();if(busy)return;setBusy(true);setMessage("");try{if(profile?.status!=="Active")throw new Error("Your Signature Application must be Active before you can initiate signing.");if(!initiateTitle.trim())throw new Error("Enter a document signing title.");if(!initiateDocumentId)throw new Error("Select a controlled document to initiate signing.");const source=docs.find(d=>d.id===initiateDocumentId);if(!source)throw new Error("The selected controlled document could not be found.");const link=String(source.webViewLink||"");const driveId=source.fileId||((link.match(/\/d\/([a-zA-Z0-9_-]+)/)||[])[1])||((link.match(/[?&]id=([a-zA-Z0-9_-]+)/)||[])[1])||"";const url=source.fileUrl||source.documentUrl||source.storageUrl||source.pdfUrl||(driveId?`drive://${driveId}`:"");if(!url)throw new Error("The selected controlled document has no usable PDF file.");const saved=await saveSignatureWorkflowDraft({title:initiateTitle.trim(),documentId:source.id,documentReference:source.reference||source.title||source.id,documentUrl:url,signingMode:initiateSigningMode,documentClassification:source.classification||source.accessLevel||"Public",documentArchiveCategory:source.archiveCategory||"Administrative Documents",recipients:[],fields:[],ownerSigningEnabled:false});setDraftEnvelopeId(saved.id);setTitle(initiateTitle.trim());setDocumentId(source.id);setDocumentUrl(url);setSigningMode(initiateSigningMode);setRecipients([]);setFields([]);setSelectedField(null);setInitiateTitle("");setInitiateDocumentId("");setTab("Prepare Envelope");setMessage(`${saved.envelopeReference} initiated. Continue in Prepare Envelope to assign the signing officers, place fields and route the document.`);}catch(x){console.error("IRPA Signature Portal: Sign a Document initiation failed",x);setMessage(`SIGN A DOCUMENT was not initiated: ${x.message||"Unable to initiate signing."}`)}finally{setBusy(false)}}
 async function createEnvelope(e){e.preventDefault();if(busy)return;setMessage("Create Draft Envelope clicked. Checking the document and required fields…");setBusy(true);try{if(!title.trim()){setMessage("Cannot create the draft yet: enter an envelope title.");throw new Error("Enter an envelope title before creating the draft.");}if(!documentId){setMessage("Cannot create the draft yet: no controlled document is selected. A signed document is not required at this stage; select the controlled PDF first.");throw new Error("Select a controlled document before creating the draft envelope.");}if(!documentUrl){setMessage("Cannot create the draft yet: the selected controlled document has no usable PDF file. Please select the uploaded PDF again.");throw new Error("The selected controlled document has no PDF file URL. Please select the uploaded PDF again.");}const owner={...documentOwner,optionalSigning:!ownerSigningEnabled};const orderedRecipients=[owner,...recipients.filter(r=>r.uid!==owner.uid).map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}))];const signerUids=new Set(orderedRecipients.map(r=>r.uid));if(fields.some(f=>!f.signerUid||!signerUids.has(f.signerUid))){setMessage("Cannot create the draft yet: one or more document fields have no responsible officer. Assign every field before continuing.");throw new Error("Assign every field to the document owner or an assigned signer before creating the envelope.");}setMessage("All checks passed. Saving the draft envelope and its field assignments…");const env=draftEnvelopeId
?await finalizeSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",archiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",signingMode,recipients:orderedRecipients,fields,ownerSigningEnabled})
:await createSignatureEnvelope({title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",archiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",signingMode,recipients:orderedRecipients,fields});setEnvelopes(prev=>[env,...prev]);setDraftEnvelopeId(null);setTitle("");setDocumentId("");setDocumentUrl("");setRecipients([]);setFields([]);setSelectedField(null);setTab("Envelopes");setMessage(`${env.envelopeReference} created as Draft.`)}catch(x){console.error("IRPA Signature Portal: Create Draft Envelope failed",x);setMessage(`Create Draft Envelope was not completed: ${x.message||"Unable to create envelope."}`)}finally{setBusy(false)}}
 async function sign(){setBusy(true);setMessage("");try{if(!selected)throw new Error("Open a signing envelope first.");const uid=auth.currentUser?.uid;if(selected.signingMode==="Sequential"&&selected.currentSignerUid!==uid)throw new Error("This envelope is waiting for another signer.");const mine=(selected.fields||[]).filter(f=>f?.signerUid===uid);if(!mine.length)throw new Error("This signing task is assigned to another officer. Your profile cannot execute another officer's assignment.");if(mine.some(f=>f.required&&["Text","Name","Date","Number","Comment","Remarks"].includes(f.type)&&!fieldValues[f.fieldId]))throw new Error("Complete all required fields assigned to you.");const updated=await signEnvelope(selected,profile,fieldValues);setSelected(updated);setEnvelopes(envelopes.map(e=>e.id===updated.id?updated:e));try{setSignedDocuments(await getMySignedDocuments())}catch(error){console.warn("Signed-document archive refresh unavailable:",error)}setMessage(updated.status==="Completed"?"Document completed and signed successfully. Your signed copy has been archived in your Signature Profile.":"Your signature was applied. A signed copy has been archived in your Signature Profile; the next signer can continue.")}catch(x){setMessage(x.message||"Unable to complete signing.")}finally{setBusy(false)}}
 async function certificate(){setBusy(true);try{const url=await createCompletionCertificate(selected);const updated={...selected,certificateUrl:url};setSelected(updated);setEnvelopes(envelopes.map(e=>e.id===updated.id?updated:e));setMessage("Certificate of Completion generated.")}catch(x){setMessage(x.message||"Unable to generate certificate.")}finally{setBusy(false)}}
 return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA SIGNATURE PORTAL</span><h1>{signerOnly?"Signing Invitation":"Electronic Signature Workspace"}</h1><p>{signerOnly?"Review the invited controlled document and complete only the signature fields assigned to you.":"Prepare, route, sign and evidence controlled IRPA documents."}</p></div><div className="identity-card"><span>Signature status</span><strong>{profile?.status||"Not configured"}</strong>{profile?.driveSignatureFolderId&&<a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer" className="text-button" style={{display:"inline-block",marginTop:8,textDecoration:"none"}}>Open My Signature Folder</a>}</div></section>
 {!signerOnly&&<div className="dashboard-grid" style={{marginBottom:18}}>{[["Signature Profile",profile?"Active":"Required"],["Envelopes",envelopes.length],["Controlled Documents",docs.length],["Pending Signing",envelopes.filter(e=>e.status!=="Completed").length]].map(([a,b])=><div className="stat-card" key={a}><span>{a}</span><strong>{b}</strong><small>Signature Portal</small></div>)}</div>}
 {!signerOnly&&<div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>{["Profile","Sign a Document","Prepare Envelope","Envelopes","Sign Document","My Signed Documents"].map(x=><button key={x} className={tab===x?"secondary-button":"text-button"} onClick={()=>setTab(x)}>{x}</button>)}</div>}{message&&<div className="auth-message" style={{marginBottom:16}}>{message}</div>}
 {!signerOnly&&tab==="Sign a Document"&&<section className="panel">
 <div className="panel-heading"><div><span className="eyebrow">SIGN A DOCUMENT · INITIATE SIGNING</span><h2>Sign a Document</h2><p className="muted">Start a controlled signing transaction directly from your Signature Profile. This is the initiation point; the existing Prepare Envelope workflow remains the place where officers, fields and routing are configured.</p></div></div>
 <div className="panel" style={{border:"1px solid rgba(109,93,252,.4)",background:"rgba(109,93,252,.06)"}}>
   <div className="form-grid">
     <label>Signing title<input value={initiateTitle} onChange={e=>setInitiateTitle(e.target.value)} placeholder="e.g. Board Resolution Approval" disabled={busy}/></label>
     <label>Controlled document<select value={initiateDocumentId} onChange={e=>setInitiateDocumentId(e.target.value)} disabled={busy}><option value="">Select controlled document</option>{docs.map(d=><option key={d.id} value={d.id}>{d.reference||d.title||d.id}</option>)}</select></label>
     <label>Signing route<select value={initiateSigningMode} onChange={e=>setInitiateSigningMode(e.target.value)} disabled={busy}><option>Sequential</option><option>Parallel</option><option>Mixed</option></select></label>
   </div>
   <div className="identity-card" style={{marginTop:14}}>
     <span>Initiation authority</span>
     <strong>{profile?.status==="Active"?"Signature Profile Owner":"Active Signature Profile Required"}</strong>
     <small>{profile?.status==="Active"?"The authenticated Signature Profile owner may initiate the transaction. Invitees do not receive this control.":"Activate your Signature Profile before initiating a signing transaction."}</small>
   </div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
     <button type="button" onClick={initiateSigning} disabled={busy||profile?.status!=="Active"||!initiateDocumentId||!initiateTitle.trim()}>{busy?"Initiating Signing…":"SIGN A DOCUMENT"}</button>
     <button type="button" className="text-button" onClick={()=>setTab("Prepare Envelope")} disabled={busy}>Open Prepare Envelope</button>
   </div>
 </div>
 <div className="panel" style={{marginTop:16}}>
   <h3>What this command does</h3>
   <p className="muted">It creates the controlled signing draft against the selected document, then hands the transaction to the established Prepare Envelope workflow. No invitation is sent and no signer is released at this step.</p>
 </div>
 </section>}
 {!signerOnly&&tab==="Profile"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">SIGNATURE IDENTITY</span><h2>My Signature Profile</h2><div className="panel-description" role="note" style={{marginTop:10,padding:"10px 12px",borderLeft:"3px solid #c9a227",background:"rgba(201,162,39,.08)"}}><strong>IRPA Signature Safety Standards:</strong> Your signature is a personal signing credential linked to your authenticated profile. Keep your account credentials private, use only your own handwritten specimen, and review each signing request before approval. Signature assets and signing activity are handled through controlled access, authenticated signing workflows and audit records; completed signature records are protected from unauthorized alteration or deletion.</div></div></div><p className="muted">Upload the actual handwritten signature and optional initials used during signing.</p>{signerIdentity&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button type="button" className="text-button" disabled={busy} onClick={migrateProfileNow}>Verify / Migrate Existing Signature Profile</button></div>}{signerIdentity?<><div className="panel" style={{marginTop:14,border:"1px solid rgba(96,165,250,.35)"}}><div className="panel-heading"><div><span className="eyebrow">SIGNER IDENTITY & TRUST RECORD</span><h3 style={{margin:"6px 0"}}>Signing Identity</h3><p className="muted">Your existing Signature Profile remains the source signing specimen. This trust record adds identity, authority, document evidence and revocation state without replacing the profile.</p></div></div><div className="form-grid"><div><strong>Signer</strong><div>{signerIdentity.signerName}</div><small>{signerIdentity.email}</small></div><div><strong>Organisation</strong><div>{signerIdentity.organisationName}</div></div><div><strong>Signature status</strong><div>{signerIdentity.signatureStatus}</div><small>Revocation: {signerIdentity.revocationStatus}</small></div><div><strong>Current signature hash</strong><div style={{wordBreak:"break-all",fontSize:11}}>{signerIdentity.currentSignatureHash||"Not yet available"}</div></div><div><strong>Identity record</strong><div>{signerIdentity.id}</div><small>Historical Signature Profile retained</small></div></div>
 <div className="panel" style={{marginTop:14,border:"1px solid rgba(34,197,94,.35)"}}>
   <div className="panel-heading"><div>
     <span className="eyebrow">SIGNING IDENTITY · REGISTERED CAPACITY</span>
     <h3 style={{margin:"6px 0"}}>Current Signing Authority</h3>
     <p className="muted">Your signing capacity is taken directly from the active IRPA Member and Employee Registers. Department → unit/board capacity → registered authority controls the available choices; no free-text authority can be entered.</p>
   </div></div>
   <div className="form-grid">
     <label className="signature-authority-field">Department
       <select value={authorityDepartment} onChange={e=>{const value=e.target.value;setAuthorityDepartment(value);setAuthorityUnit("");setAuthorityRole("");if(String(value||"").trim().toLowerCase()==="executive office")setAuthorityStatus("Current");}} required disabled={authorityBusy}>
         <option value="">Select registered department</option>
         {authorityDepartments.map(value=><option key={value} value={value}>{value}</option>)}
       </select>
     </label>
     <label className="signature-authority-field">Current signing authority / registered capacity
       <select value={authorityRole} onChange={e=>{
         const value=e.target.value;
         setAuthorityRole(value);
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
     {authorityDepartment&&authorityUnit&&authorityRole&&<label className="signature-authority-field">Effective date <span className="muted">(optional)</span>
       <input type="date" value={authorityEffectiveAt} onChange={e=>setAuthorityEffectiveAt(e.target.value)} disabled={authorityBusy}/>
     </label>}
     {authorityDepartment&&authorityUnit&&authorityRole&&<label className="signature-authority-field">Expiry date <span className="muted">(optional)</span>
       <input type="date" value={authorityExpiresAt} onChange={e=>setAuthorityExpiresAt(e.target.value)} min={authorityEffectiveAt||undefined} disabled={authorityBusy}/>
     </label>}
   </div>
   <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
     <button type="submit" disabled={authorityBusy||!authorityDepartment||!authorityRole}>{authorityBusy?"Saving Authority…":"Save Current Authority"}</button>
   </div>
 </div></div></>:<div className="panel" role="status" style={{marginTop:14,border:"1px solid rgba(245,158,11,.4)"}}><div className="panel-heading"><div><span className="eyebrow">SIGNER IDENTITY & TRUST RECORD</span><h3 style={{margin:"6px 0"}}>Trust Record Pending</h3><p className="muted">The Signer Identity record is not currently available. This does not delete, replace or invalidate your existing Signature Profile.</p></div></div><button type="button" className="text-button" disabled={busy} onClick={migrateProfileNow}>Verify / Restore Signer Identity Link</button></div>}{profile?.driveSignatureFolderId&&<div className="success-message action-feedback" style={{marginTop:12}}>Your signature assets are stored in your UID-restricted Google Drive folder: <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer">Open My Signature Folder</a>.</div>}<form onSubmit={saveProfile}><div className="form-grid"><label>Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} required/></label><label>Initials<input value={initials} onChange={e=>setInitials(e.target.value)} placeholder="e.g. DEM"/></label><label>Signature image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{setSignatureFile(e.target.files?.[0]||null);setDrawnSignature("")}}/><small>Optional if you sign directly below.</small></label><label>Initials image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setInitialsFile(e.target.files?.[0]||null)}/></label></div><InkCapture onUse={saveDrawnSignature} onSave={saveDrawnSignature} replacementMode={replacementMode}/><div className="dashboard-grid" style={{marginTop:16}}>{profile?.signatureUrl?<div className="stat-card"><span>CURRENT SIGNATURE</span><div style={{background:"#fff",padding:12,borderRadius:8,marginTop:8}}>{servedSignatureSrc?<img src={servedSignatureSrc} alt="Current served signature" style={{maxWidth:"100%",maxHeight:100}}/>:<div className="auth-message" role="status">Loading current served signature…</div>}</div><small>SHA-256: {profile.signatureSha256}</small><div className="auth-message" role="status" style={{marginTop:10}}>This is the signature currently saved from your Signature Profile and reused for future signing.</div></div>:<div className="stat-card"><span>NO SIGNATURE CURRENTLY SERVED</span><div className="auth-message" role="status" style={{marginTop:10}}>Your handwritten specimen above has not been served yet. Press <strong>Save &amp; Serve Signature</strong> once to make it your persistent signature.</div></div>}{profile?.initialsUrl&&<div className="stat-card"><span>Saved initials</span><div style={{background:"#fff",padding:12,borderRadius:8,marginTop:8}}>{servedInitialsSrc?<img src={servedInitialsSrc} alt="Initials" style={{maxWidth:"100%",maxHeight:100}}/>:<div className="auth-message" role="status">Loading initials…</div>}</div></div>}</div>{profile&&<div className="panel" style={{marginTop:16,border:"1px solid rgba(220,38,38,.45)"}}>
 <div className="panel-heading"><div><span className="eyebrow">SIGNATURE APPLICATION CONTROL</span><h3 style={{margin:"6px 0"}}>Revoke My Signature Application</h3><p className="muted">Only the Signature Profile owner can initiate this revocation. Revocation disables this Signature Application for future signing. It does not delete the person's account or erase completed signing records.</p></div></div>
 {!revokeOpen?<button type="button" className="secondary-button" onClick={()=>setRevokeOpen(true)} disabled={busy||revokeBusy||profile.status==="Revoked"}>{profile.status==="Revoked"?"Signature Application Revoked":"Revoke Signature Application"}</button>:
 <div role="alertdialog" aria-label="Confirm Signature Application revocation"><p className="muted"><strong>Security confirmation:</strong> review this action before proceeding. Revocation will prevent this Signature Profile from being used for new signing actions.</p><div className="form-actions"><button type="button" className="danger-button" onClick={revokeApplication} disabled={revokeBusy}>{revokeBusy?"Revoking…":"Confirm Revoke Signature Application"}</button><button type="button" className="secondary-button" onClick={()=>setRevokeOpen(false)} disabled={revokeBusy}>Cancel</button></div></div>}
 </div>}<button type="submit" style={{marginTop:18}} disabled={busy||(!signatureFile&&!drawnSignature)}>{busy?"Saving...":profile?"Save Signature Profile":"Save Signature Profile"}</button>{profile&&<button type="button" className="secondary-button" style={{marginTop:12,border:replacementMode?"2px solid #f87171":"1px solid rgba(255,255,255,.2)",fontWeight:800}} disabled={busy} onClick={()=>{setReplacementMode(true);setSignatureFile(null);setDrawnSignature("");setMessage("REPLACEMENT MODE ACTIVE: draw the new handwritten signature in the box above, then press Save Signature. The current served signature remains active until the save succeeds.");document.querySelector("[data-signature-specimen]")?.scrollIntoView({behavior:"smooth",block:"center"})}}>{replacementMode?"Replacement Mode Active":"Replace Signature"}</button>}<div className="auth-message" role="status" aria-live="polite" style={{marginTop:12}}>{busy?"Saving signature to your persistent Signature Profile…":replacementMode?"REPLACEMENT MODE ACTIVE: draw the new signature and press Save Signature. The current served signature remains unchanged until the save succeeds.":profile?"CURRENT SIGNATURE SERVED: this signature will be reused for future documents.":"NO SIGNATURE SERVED: save your handwritten specimen above to activate it."}</div></form></section>}
 {!signerOnly&&tab==="My Signed Documents"&&<section className="panel">
 <div className="panel-heading"><div><span className="eyebrow">SIGNATURE PROFILE ARCHIVE</span><h2>My Signed Documents</h2><p className="muted">Every document you personally sign is copied immediately at the end of your signing ceremony into your Signature Profile archive, regardless of who initiated the workflow or whether another signer remains.</p></div></div>
 <div className="identity-card" style={{marginBottom:14}}><span>Profile archive</span><strong>{signedDocuments.length} signed document{signedDocuments.length===1?"":"s"}</strong>{profile?.driveSignatureFolderId&&<a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer" className="text-button" style={{display:"inline-block",marginTop:8,textDecoration:"none"}}>Open Signature Profile Archive</a>}</div>
 {signedDocuments.length===0?<p className="muted">No signed documents are recorded for this Signature Profile yet.</p>:<div style={{display:"grid",gap:10}}>{signedDocuments.map(d=><article key={d.id} className="stat-card"><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}><div><span>{d.documentReference||d.documentId||"Signed Document"}</span><h3 style={{margin:"5px 0"}}>{d.documentTitle||d.title||d.documentReference||"Signed Document"}</h3><small>Signed by you · {d.workflowRole||"Signature action"} · {d.signedAt?.seconds?new Date(Number(d.signedAt.seconds)*1000).toLocaleString():d.signedAt?new Date(d.signedAt).toLocaleString():"Date recorded"}</small><div style={{fontSize:11,opacity:.65,marginTop:5,wordBreak:"break-all"}}>SHA-256: {d.signedDocumentHash||"Recorded"}</div></div><button type="button" className="secondary-button" onClick={async()=>{try{const target=d.signerArchiveUrl||"";if(!target)throw new Error("The archived signed PDF link is missing.");if(target.startsWith("drive://")){const bytes=await downloadDriveBytes(target.slice("drive://".length));const blob=new Blob([bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);window.open(url,"_blank","noopener,noreferrer");setTimeout(()=>URL.revokeObjectURL(url),60000)}else window.open(target,"_blank","noopener,noreferrer")}catch(error){setMessage(error.message||"Unable to open the archived signed document.")}}}>Open Signed PDF</button></div></article>)}</div>}
 </section>}
 {!signerOnly&&tab==="Prepare Envelope"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENVELOPE PREPARATION</span><h2>Prepare, Assign & Route Document</h2><p className="muted">Upload/select the controlled PDF, place comments, numbers, remarks, dates and signatures, assign every field to an officer, and route the document in the required sequence.</p></div></div><form onSubmit={createEnvelope} noValidate><div className="form-grid"><label>Envelope title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Board Resolution Approval"/></label><label>Controlled document<select value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">Select document</option>{docs.map(d=><option key={d.id} value={d.id}>{d.reference||d.title||d.id}</option>)}</select></label><label>Signing route<select value={signingMode} onChange={e=>setSigningMode(e.target.value)}><option>Sequential</option><option>Parallel</option><option>Mixed</option></select></label></div>
 <div className="panel" style={{marginTop:18,border:"1px solid rgba(109,93,252,.35)"}}><h3>Signer Hierarchy</h3><p className="muted" style={{marginTop:4}}>The document owner controls the workflow. Add each signing officer as a separate level. Define the officer by email and assign the purpose of their action. Add as many levels as required.</p><div className="form-grid"><label>1. Add signer / officer<select value={selectedSigner} onChange={e=>{setSelectedSigner(e.target.value);const m=members.find(x=>x.uid===e.target.value);setSignerEmail(m?.email||"")}}><option value="">Select registered officer</option>{members.filter(m=>m.uid!==documentOwner.uid&&!recipients.some(r=>r.uid===m.uid)).map(m=><option key={m.uid} value={m.uid}>{m.name||m.email}</option>)}</select></label><label>Signer email address<input type="email" value={signerEmail} onChange={e=>setSignerEmail(e.target.value)} placeholder="officer@irpa.or.tz"/></label><label>Role / action<select value={signerRole} onChange={e=>setSignerRole(e.target.value)}><option>Review</option><option>Authorization</option><option>Approval</option><option>Verification</option><option>Recommendation</option><option>Comment</option><option>Signature</option><option>Final Authorization</option><option>Board Chairperson</option><option>Board Vice Chairperson</option><option>Board Secretary</option><option>Board Treasurer</option><option>Board Member</option><option>Other</option></select></label></div><button type="button" className="secondary-button" onClick={addSigner} disabled={!selectedSigner&&!signerEmail}>Add signer / next level</button><div style={{marginTop:16}}><strong>Workflow ladder</strong>{recipients.length===0?<p className="muted">No officers added yet. Add Level 2, Level 3, Level 4 and as many additional levels as required.</p>:recipients.map((r,i)=><div key={r.uid} style={{display:"grid",gridTemplateColumns:"44px minmax(0,1fr) auto",gap:10,alignItems:"center",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><strong>Level {i+2}</strong><span><strong>{r.name}</strong><small style={{display:"block"}}>{r.email} · {r.role}</small></span><span style={{display:"flex",gap:4}}><button type="button" className="text-button" onClick={()=>moveSigner(r.uid,-1)} disabled={i===0}>↑</button><button type="button" className="text-button" onClick={()=>moveSigner(r.uid,1)} disabled={i===recipients.length-1}>↓</button><button type="button" className="text-button" onClick={()=>removeSigner(r.uid)}>Remove</button></span></div>)}</div></div>
 <div className="panel" style={{marginTop:18}}><h3>Document Workflow & Signer Hierarchy</h3><p className="muted" style={{marginTop:4}}>Assign each field to the document owner or an officer. The owner can be included as an optional signing step; if optional, the workflow proceeds to the first assigned officer without requiring the owner to sign.</p><div style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><strong>1. {documentOwner.name}</strong><small style={{display:"block"}}>{documentOwner.email} · Document Owner</small><label style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}><input type="checkbox" checked={ownerSigningEnabled} onChange={e=>setOwnerSigningEnabled(e.target.checked)}/> Owner must sign first before the routed officers</label></div>{recipients.length===0?<p className="muted" style={{marginTop:10}}>Add the responsible officers who must sign or complete this document.</p>:recipients.map((r,i)=><div key={r.uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><span><strong>{signingMode==="Sequential"?`${i+2}. `:""}{r.name}</strong><small style={{display:"block"}}>{r.email} · {r.role}</small></span><button type="button" className="text-button" onClick={()=>removeSigner(r.uid)}>Remove officer</button></div>)}</div>
 <div className="panel" style={{marginTop:18,border:"1px solid rgba(109,93,252,.35)"}}><h3>Field Assignment</h3><p className="muted" style={{marginTop:4}}>When you place a Signature, Initials, Date, Number, Comment or Remarks field, select the responsible person in <strong>FIELD PROPERTIES → Signer</strong>. This assignment controls who receives the task and the signing sequence.</p></div>
 <PDFDesigner url={documentUrl} documentId={documentId} fields={fields} setFields={setFields} recipients={workflowRecipients} selectedField={selectedField} setSelectedField={setSelectedField} activeAssigneeUid={recipients.length?recipients[recipients.length-1].uid:documentOwner.uid} signatureSrc={servedSignatureSrc} initialsSrc={servedInitialsSrc}/>
 <button type="submit" className="create-envelope-action" disabled={busy} aria-busy={busy?"true":"false"}>{busy?"Creating Draft Envelope…":"Create Draft Envelope"}</button></form></section>}
{!signerOnly&&tab==="Envelopes"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENVELOPE REGISTER</span><h2>Signing Transactions</h2></div></div>{envelopes.filter(e=>(e.recipients||[]).some(r=>r?.uid===auth.currentUser?.uid)).length===0?<p className="muted">No signing assignments are currently assigned to you.</p>:envelopes.filter(e=>(e.recipients||[]).some(r=>r?.uid===auth.currentUser?.uid)).map(e=><article key={e.id} className="stat-card" style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><div><span>{e.envelopeReference}</span><h3 style={{margin:"5px 0"}}>{e.title}</h3><small>{e.documentReference} · {e.signingMode} · Your assignment</small></div><div><strong>{e.status}</strong><br/><button className="text-button" onClick={()=>{setSelected(e);setTab("Sign Document")}}>Open</button>{e.status==="Draft"&&<button className="text-button" onClick={async()=>{setBusy(true);setMessage("");try{const updated=await startSignatureWorkflow(e);setEnvelopes(envelopes.map(x=>x.id===updated.id?updated:x));setSelected(updated);setTab("Sign Document");setMessage("Workflow started. The current officer has been released.")}catch(x){setMessage(x.message||"Unable to start workflow.")}finally{setBusy(false)}}} disabled={busy}>Start Workflow</button>}</div></div></article>)}</section>}
 {tab==="Sign Document"&&<section className="panel">{!selected?<><h2>Signing Ceremony</h2><p className="muted">This signing invitation could not be loaded.</p></>:<><div className="panel-heading"><div><span className="eyebrow">SIGNING CEREMONY</span><h2>{selected.title}</h2><p>{selected.envelopeReference} · {selected.status}</p></div></div><div className="panel" style={{marginBottom:18}}><h3>Signing Progress</h3><div style={{display:"grid",gap:8,marginTop:10}}>{(selected.recipients||[]).filter(r=>r?.uid===auth.currentUser?.uid).map((r)=>{const isCurrent=selected.status!=="Completed"&&selected.currentSignerUid===r.uid;const isSigned=r.status==="Signed"||((selected.workflowHistory||[]).some(h=>h.uid===r.uid));const state=selected.status==="Completed"&&isSigned?"Completed":isSigned?"Signed":isCurrent?"Your assignment is active":"Your assignment is pending";const when=r.completedAt||((selected.workflowHistory||[]).filter(h=>h.uid===r.uid).slice(-1)[0]?.completedAt)||"";return <div key={r.uid} style={{display:"grid",gridTemplateColumns:"36px 1fr auto",gap:10,alignItems:"center",padding:"10px 12px",border:"1px solid rgba(255,255,255,.09)",borderRadius:8}}><strong>✓</strong><div><strong>My assignment</strong><div style={{fontSize:12,opacity:.7}}>{r.role||"Action"}</div>{when&&<div style={{fontSize:11,opacity:.6}}>Completed: {new Date(when).toLocaleString()}</div>}</div><span>{state}</span></div>})}</div>{selected.currentSignerUid===auth.currentUser?.uid&&selected.status!=="Completed"&&<p className="muted" style={{marginBottom:0,marginTop:10}}>Next action: complete your assigned fields.</p>}{selected.status==="Completed"&&<p className="muted" style={{marginBottom:0,marginTop:10}}>All required signing actions are complete.</p>}</div>{selected.documentUrl&&<SigningDocumentViewer url={selected.signedDocumentUrl||selected.documentUrl} documentId={selected.documentId} fields={selected.fields||[]} profile={profile} fieldValues={fieldValues} setFieldValues={setFieldValues}/>}<div className="panel" style={{marginTop:18}}>
 <h3>Document Archive</h3>
 <p className="muted" style={{marginBottom:12}}>The controlled document remains available to the assigned signee throughout the workflow. After an action is completed, the latest signed version is exposed here for review and intended use.</p>
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  {selected.documentUrl&&<a className="controlled-document-open-button" href={selected.documentUrl.startsWith("drive://")?"#":selected.documentUrl} target="_blank" rel="noreferrer" onClick={async e=>{if(selected.documentUrl.startsWith("drive://")){e.preventDefault();try{const bytes=await downloadDriveBytes(selected.documentUrl.slice("drive://".length));const blob=new Blob([bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);window.open(url,"_blank","noopener,noreferrer");setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(x){setMessage(x.message||"Unable to open the controlled document.")}}}}>Open Controlled Document</a>}
  {selected.signedDocumentUrl&&<a className="secondary-button" href={selected.signedDocumentUrl} target="_blank" rel="noreferrer">Open Latest Signed Document</a>}
  {selected.certificateUrl&&<a className="secondary-button" href={selected.certificateUrl} target="_blank" rel="noreferrer">Open Completion Certificate</a>}
 </div>
 </div><div className="panel" style={{marginTop:18}}><h3>Fields assigned to you</h3>{(selected.fields||[]).filter(f=>f.signerUid===auth.currentUser?.uid).map(f=><label key={f.fieldId} style={{display:"block",marginTop:10}}>{f.type}{f.required?" *":""}{f.type==="Signature"||f.type==="Initials"?<div className="stat-card" style={{marginTop:5}}>{f.type} will use your saved Signature Profile.</div>:<input value={fieldValues[f.fieldId]||""} onChange={e=>setFieldValues({...fieldValues,[f.fieldId]:e.target.value})} placeholder={f.placeholder||`Enter ${f.type.toLowerCase()}`} type={f.type==="Number"?"number":"text"}/>}</label>)}<div style={{marginTop:18,display:"flex",gap:8,flexWrap:"wrap"}}><button onClick={sign} disabled={busy||selected.status==="Completed"||!(selected.fields||[]).some(f=>f?.signerUid===auth.currentUser?.uid)}>{busy?"Processing...":selected.status==="Completed"?"Completed":(selected.fields||[]).some(f=>f?.signerUid===auth.currentUser?.uid)?"Adopt Signature & Sign":"Not Assigned — Signing Disabled"}</button>{selected.status==="Completed"&&<button className="secondary-button" onClick={certificate} disabled={busy}>Generate Certificate of Completion</button>}{selected.signedDocumentUrl&&<a className="secondary-button" href={selected.signedDocumentUrl} target="_blank" rel="noreferrer">Open Signed PDF</a>}{selected.certificateUrl&&<a className="secondary-button" href={selected.certificateUrl} target="_blank" rel="noreferrer">Open Certificate</a>}</div></div></>}</section>}
 </div>;
}
