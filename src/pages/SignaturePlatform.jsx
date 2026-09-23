import React,{useEffect,useMemo,useRef,useState}from"react";
import{getRecords}from"../firebase/data";
import{downloadDriveBytes}from"../firebase/signatureStorage";
import{auth}from"../firebase/config";
import{createCompletionCertificate,createSignatureEnvelope,getMySignatureProfile,getSignatureEnvelope,getSignatureEnvelopes,saveMySignatureProfile,signEnvelope,saveSignatureWorkflowDraft,finalizeSignatureWorkflowDraft,startSignatureWorkflow}from"../firebase/signaturePlatform";
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
    setFeedback("Saving and serving this handwritten signature…");
    try{
      const dataUrl=canvasRef.current.toDataURL("image/png");
      const result=await(onSave?onSave(dataUrl):onUse(dataUrl));
      setFeedback("SUCCESS: this handwritten signature is now the CURRENT SERVED SIGNATURE and will be reused for future documents.");
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
            {replacementMode?"Save & Serve Replacement":"Save & Serve Signature"}
          </button>
        </div>
        {feedback&&<div className="auth-message" role="status" aria-live="polite" style={{marginTop:10}}>{feedback}</div>}
      </div>
    </div>
  );
}

function FieldBox({field,selected,onSelect,onMove,onResize,onDelete,zoom,recipients,activeAssigneeUid}){
 const ref=useRef(null);const drag=useRef(null);const resize=useRef(null);
 const startMove=e=>{e.preventDefault();e.stopPropagation();onSelect(field.fieldId);const r=ref.current?.parentElement?.getBoundingClientRect();if(!r)return;drag.current={sx:e.clientX,sy:e.clientY,fx:field.x,fy:field.y,w:r.width,h:r.height};window.addEventListener("pointermove",move);window.addEventListener("pointerup",end,{once:true});};
 const move=e=>{if(!drag.current)return;const d=drag.current;onMove(field.fieldId,clamp(d.fx+((e.clientX-d.sx)/d.w)*100,0,100-field.width),clamp(d.fy+((e.clientY-d.sy)/d.h)*100,0,100-field.height));};
 const end=()=>{drag.current=null;window.removeEventListener("pointermove",move);};
 const startResize=e=>{e.preventDefault();e.stopPropagation();onSelect(field.fieldId);const r=ref.current?.parentElement?.getBoundingClientRect();if(!r)return;resize.current={sx:e.clientX,sy:e.clientY,fw:field.width,fh:field.height,w:r.width,h:r.height};window.addEventListener("pointermove",resizeMove);window.addEventListener("pointerup",resizeEnd,{once:true});};
 const resizeMove=e=>{if(!resize.current)return;const d=resize.current;onResize(field.fieldId,clamp(d.fw+((e.clientX-d.sx)/d.w)*100,3,100-field.x),clamp(d.fh+((e.clientY-d.sy)/d.h)*100,3,100-field.y));};
 const resizeEnd=()=>{resize.current=null;window.removeEventListener("pointermove",resizeMove);};
 const c=COLORS[field.type]||COLORS.Text;const active=!!activeAssigneeUid&&field.signerUid===activeAssigneeUid;
 return <div ref={ref} onPointerDown={startMove} onClick={e=>{e.stopPropagation();onSelect(field.fieldId)}} style={{position:"absolute",left:`${field.x}%`,top:`${field.y}%`,width:`${field.width}%`,height:`${field.height}%`,boxSizing:"border-box",border:`3px ${active?"solid":selected?"solid":"dashed"} ${active?"#16a34a":c}`,background:active?"rgba(22,163,74,.16)":`${c}18`,borderRadius:5,cursor:"move",zIndex:selected?30:20,userSelect:"none",minWidth:22,minHeight:18}}>
   <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontSize:Math.max(9,11*zoom),fontWeight:700,color:c,overflow:"hidden",whiteSpace:"nowrap",padding:"2px 18px 2px 5px",boxSizing:"border-box"}}><span>{active?"ACTIVE ASSESSMENT · ":""}{TYPE_LABELS[field.type]||field.type}{field.required?" *":""}</span><small style={{fontSize:Math.max(7,8*zoom),opacity:.85,overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{recipients.find(r=>r.uid===field.signerUid)?.name||"Unassigned"} · {field.responsibility||"Review"}</small></div>
   {selected&&<><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(field.fieldId)}} style={{position:"absolute",right:2,top:2,width:18,height:18,border:0,borderRadius:4,background:"#111827",color:"#fff",fontSize:11,cursor:"pointer"}}>×</button><span onPointerDown={startResize} style={{position:"absolute",right:-4,bottom:-4,width:10,height:10,borderRadius:2,background:c,cursor:"nwse-resize"}}/></>}
 </div>;
}

function PDFDesigner({url,documentId,fields,setFields,recipients,selectedField,setSelectedField,activeAssigneeUid}){
 const canvasRef=useRef(null),pageHostRef=useRef(null);const[pdf,setPdf]=useState(null);const[pageNum,setPageNum]=useState(1);const[pageSize,setPageSize]=useState({width:800,height:1035});const[zoom,setZoom]=useState(1);const[loading,setLoading]=useState(false);const[error,setError]=useState("");
 useEffect(()=>{let dead=false;(async()=>{if(!url){setPdf(null);return}setLoading(true);setError("");try{const source=url.startsWith("drive://")?{data:await downloadDriveBytes(url.slice("drive://".length),documentId)}:{url};const task=pdfjsLib.getDocument(source);const p=await task.promise;if(!dead){setPdf(p);setPageNum(1)}}catch(e){if(!dead)setError(e.message||"Unable to render PDF.")}finally{if(!dead)setLoading(false)}})();return()=>{dead=true};},[url]);
 useEffect(()=>{let dead=false;(async()=>{if(!pdf||!canvasRef.current)return;try{const page=await pdf.getPage(pageNum);const base=page.getViewport({scale:1});const scale=Math.max(.55,(760/base.width))*zoom;const viewport=page.getViewport({scale});const canvas=canvasRef.current;const output=window.devicePixelRatio||1;canvas.width=Math.floor(viewport.width*output);canvas.height=Math.floor(viewport.height*output);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;setPageSize({width:viewport.width,height:viewport.height});const ctx=canvas.getContext("2d");ctx.setTransform(output,0,0,output,0,0);await page.render({canvasContext:ctx,viewport}).promise;if(!dead){} }catch(e){if(!dead)setError(e.message||"Unable to render page.")}})();return()=>{dead=true}},[pdf,pageNum,zoom]);
 const pageFields=fields.filter(f=>Number(f.page)===pageNum);
 const addAt=(type,x,y)=>{if(!recipients.length){setError("Add at least one signer before placing fields.");return}const f=makeField(type,fields.length,recipients[0].uid,pageNum);f.x=clamp(x-f.width/2,0,100-f.width);f.y=clamp(y-f.height/2,0,100-f.height);setFields([...fields,f]);setSelectedField(f.fieldId);};
 const drop=e=>{e.preventDefault();const type=e.dataTransfer.getData("fieldType");if(!type)return;const r=pageHostRef.current.getBoundingClientRect();addAt(type,((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100);};
 const update=(id,patch)=>setFields(fields.map(f=>f.fieldId===id?{...f,...patch}:f));
 return <div style={{display:"grid",gridTemplateColumns:"180px minmax(500px,1fr) 250px",gap:12,marginTop:18,minHeight:700}}>
  <aside style={{background:"rgba(15,23,42,.7)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding:12}}><strong style={{display:"block",marginBottom:12}}>FIELD PALETTE</strong>{TYPES.map(t=><div key={t} draggable onDragStart={e=>e.dataTransfer.setData("fieldType",t)} onClick={()=>{const r=pageHostRef.current?.getBoundingClientRect();if(r)addAt(t,50,20)}} style={{padding:"10px 9px",marginBottom:8,borderRadius:7,border:`1px solid ${COLORS[t]}80`,background:`${COLORS[t]}18`,color:"#fff",cursor:"grab",fontWeight:700}}>{TYPE_LABELS[t]}<small style={{display:"block",opacity:.65,fontWeight:400}}>Drag onto page</small></div>)}<div className="panel" style={{marginTop:16,padding:10,background:"rgba(255,255,255,.03)"}}><strong style={{display:"block",marginBottom:8}}>ASSIGN RESPONSIBILITY</strong><p style={{fontSize:11,opacity:.7,margin:"0 0 10px"}}>Every highlighted field is assigned to an addressee. The assigned officer will see only their responsibilities when signing.</p>{fields.length===0?<div style={{fontSize:11,opacity:.6}}>Place a field on the document to assign it.</div>:fields.map((f,i)=><div key={f.fieldId} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><strong style={{fontSize:11}}>{i+1}. {f.type}</strong><label style={{display:"block",marginTop:5,fontSize:11}}>Addressee<select value={f.signerUid||""} onChange={e=>setFields(fields.map(x=>x.fieldId===f.fieldId?{...x,signerUid:e.target.value}:x))}><option value="">Select addressee</option>{recipients.map(r=><option key={r.uid} value={r.uid}>{r.name||r.email}</option>)}</select></label><label style={{display:"block",marginTop:5,fontSize:11}}>Responsibility<select value={f.responsibility||""} onChange={e=>setFields(fields.map(x=>x.fieldId===f.fieldId?{...x,responsibility:e.target.value}:x))}><option value="">Select responsibility</option><option>Signature</option><option>Initial</option><option>Review</option><option>Comment</option><option>Number Entry</option><option>Remarks</option><option>Date & Time</option><option>Verification</option><option>Recommendation</option><option>Authorization</option><option>Approval</option><option>Final Authorization</option></select></label></div>)}</div><div style={{marginTop:16,fontSize:12,opacity:.7}}>Drag, move and resize fields directly on the rendered PDF page.</div></aside>
  <main style={{background:"#1e293b",borderRadius:12,padding:12,overflow:"auto",minHeight:680}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:12,position:"sticky",top:0,zIndex:50,background:"#1e293b",paddingBottom:8}}><div style={{display:"flex",gap:6}}><button type="button" className="text-button" disabled={!pdf||pageNum<=1} onClick={()=>setPageNum(p=>p-1)}>‹</button><span style={{padding:"8px 10px",fontSize:13}}>Page {pageNum} / {pdf?.numPages||0}</span><button type="button" className="text-button" disabled={!pdf||pageNum>=pdf.numPages} onClick={()=>setPageNum(p=>p+1)}>›</button></div><div style={{display:"flex",gap:6,alignItems:"center"}}><button type="button" className="text-button" onClick={()=>setZoom(z=>clamp(Number((z-.1).toFixed(2)),.6,1.8))}>−</button><span style={{fontSize:12}}>{Math.round(zoom*100)}%</span><button type="button" className="text-button" onClick={()=>setZoom(z=>clamp(Number((z+.1).toFixed(2)),.6,1.8))}>+</button></div></div>{loading&&<div className="muted">Rendering PDF…</div>}{error&&<div className="auth-message" style={{marginBottom:10}}>{error}</div>} {!url?<div className="muted" style={{padding:40,textAlign:"center"}}>Select a controlled PDF to open the visual designer.</div>:<div style={{display:"flex",justifyContent:"center",padding:8}}><div ref={pageHostRef} onDragOver={e=>e.preventDefault()} onDrop={drop} onPointerDown={()=>setSelectedField(null)} style={{position:"relative",width:pageSize.width,height:pageSize.height,background:"#fff",boxShadow:"0 8px 30px rgba(0,0,0,.35)",flex:"0 0 auto"}}><canvas ref={canvasRef} style={{position:"absolute",inset:0,pointerEvents:"none"}}/>{pageFields.map(f=><FieldBox key={f.fieldId} field={f} selected={selectedField===f.fieldId} onSelect={setSelectedField} onMove={(id,x,y)=>update(id,{x,y})} onResize={(id,width,height)=>update(id,{width,height})} onDelete={id=>{setFields(fields.filter(f=>f.fieldId!==id));setSelectedField(null)}} zoom={zoom} recipients={recipients} activeAssigneeUid={activeAssigneeUid}/>)}</div></div>}</main>
  <aside style={{background:"rgba(15,23,42,.7)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding:12}}><strong>FIELD PROPERTIES</strong>{!selectedField?<p className="muted" style={{fontSize:13,marginTop:16}}>Select a field on the PDF to edit its properties.</p>:(()=>{const f=fields.find(x=>x.fieldId===selectedField);if(!f)return null;return <div style={{marginTop:14}}><label>Type<select value={f.type} onChange={e=>update(f.fieldId,{type:e.target.value})}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label><label>Assigned addressee<select value={f.signerUid||""} onChange={e=>update(f.fieldId,{signerUid:e.target.value})}><option value="">Assign addressee</option>{recipients.map(r=><option key={r.uid} value={r.uid}>{r.name||r.email} · {r.role||""}</option>)}</select></label><label>Responsibility<select value={f.responsibility||""} onChange={e=>update(f.fieldId,{responsibility:e.target.value})}><option value="">Select responsibility</option><option>Signature</option><option>Initial</option><option>Review</option><option>Comment</option><option>Number Entry</option><option>Remarks</option><option>Date</option><option>Verification</option><option>Recommendation</option><option>Authorization</option><option>Approval</option><option>Final Authorization</option></select></label><label>Page<input type="number" min="1" max={pdf?.numPages||1} value={f.page} onChange={e=>update(f.fieldId,{page:clamp(Number(e.target.value)||1,1,pdf?.numPages||1)})}/></label><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><label>X %<input type="number" min="0" max="100" step=".1" value={Number(f.x).toFixed(1)} onChange={e=>update(f.fieldId,{x:clamp(Number(e.target.value)||0,0,100-f.width)})}/></label><label>Y %<input type="number" min="0" max="100" step=".1" value={Number(f.y).toFixed(1)} onChange={e=>update(f.fieldId,{y:clamp(Number(e.target.value)||0,0,100-f.height)})}/></label><label>Width %<input type="number" min="3" max="100" step=".1" value={Number(f.width).toFixed(1)} onChange={e=>update(f.fieldId,{width:clamp(Number(e.target.value)||3,3,100-f.x)})}/></label><label>Height %<input type="number" min="3" max="100" step=".1" value={Number(f.height).toFixed(1)} onChange={e=>update(f.fieldId,{height:clamp(Number(e.target.value)||3,3,100-f.y)})}/></label></div><label style={{display:"flex",gap:8,alignItems:"center",marginTop:12}}><input type="checkbox" checked={!!f.required} onChange={e=>update(f.fieldId,{required:e.target.checked})}/> Required field</label><button type="button" className="text-button" style={{marginTop:14}} onClick={()=>{setFields(fields.filter(x=>x.fieldId!==f.fieldId));setSelectedField(null)}}>Delete field</button></div>})()}</aside>
 </div>;
}

function SigningDocumentViewer({url,documentId,fields,profile,fieldValues,setFieldValues}){
 const canvasRef=useRef(null);const hostRef=useRef(null);const inkCanvasRef=useRef(null);const[inkField,setInkField]=useState(null);const[drawing,setDrawing]=useState(false);const[pdf,setPdf]=useState(null);const[pageNum,setPageNum]=useState(1);const[pageSize,setPageSize]=useState({width:760,height:980});const[error,setError]=useState("");const[loading,setLoading]=useState(false);
 useEffect(()=>{let dead=false;(async()=>{if(!url){setPdf(null);return}setLoading(true);setError("");try{const source=url.startsWith("drive://")?{data:await downloadDriveBytes(url.slice("drive://".length),documentId)}:{url};const task=pdfjsLib.getDocument(source);const p=await task.promise;if(!dead){setPdf(p);setPageNum(1)}}catch(e){if(!dead)setError(e.message||"Unable to open the signing document.")}finally{if(!dead)setLoading(false)}})();return()=>{dead=true}},[url,documentId]);
 useEffect(()=>{let dead=false;(async()=>{if(!pdf||!canvasRef.current)return;try{const page=await pdf.getPage(pageNum);const base=page.getViewport({scale:1});const scale=Math.max(.55,760/base.width);const viewport=page.getViewport({scale});const canvas=canvasRef.current;const dpr=window.devicePixelRatio||1;canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);canvas.style.width=viewport.width+"px";canvas.style.height=viewport.height+"px";setPageSize({width:viewport.width,height:viewport.height});const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);await page.render({canvasContext:ctx,viewport}).promise}catch(e){if(!dead)setError(e.message||"Unable to render signing page.")}})();return()=>{dead=true}},[pdf,pageNum]);
 const mine=(fields||[]).filter(f=>Number(f.page||1)===pageNum&&f.signerUid===auth.currentUser?.uid);
 const setValue=(f,v)=>setFieldValues(prev=>({...prev,[f.fieldId]:v}));
 const activate=(f)=>{if(f.type==="Date")setValue(f,new Date().toLocaleString([], {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));};
 return <div className="panel mobile-signing-panel" style={{marginBottom:18}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}><div><strong>Document you are signing</strong><div className="muted" style={{fontSize:12}}>Review the actual PDF below. Only fields assigned to you are active.</div></div><div style={{display:"flex",gap:6}}><button type="button" className="text-button" disabled={!pdf||pageNum<=1} onClick={()=>setPageNum(p=>p-1)}>‹</button><span style={{padding:"7px 8px",fontSize:12}}>Page {pageNum} / {pdf?.numPages||0}</span><button type="button" className="text-button" disabled={!pdf||pageNum>=pdf.numPages} onClick={()=>setPageNum(p=>p+1)}>›</button></div></div>
  {loading&&<div className="auth-message">Loading the actual controlled PDF…</div>}{error&&<div className="error-message action-feedback">{error}</div>}
  <div ref={hostRef} style={{position:"relative",width:pageSize.width,maxWidth:"100%",margin:"0 auto",background:"#fff",boxShadow:"0 2px 16px rgba(0,0,0,.35)",overflow:"hidden"}}>
   <canvas ref={canvasRef} style={{display:"block",width:"100%"}}/>
   {mine.map(f=>{const value=fieldValues[f.fieldId]||"";const common={position:"absolute",left:f.x+"%",top:f.y+"%",width:f.width+"%",height:f.height+"%",boxSizing:"border-box",border:"2px solid #16a34a",background:"rgba(22,163,74,.10)",borderRadius:5,zIndex:5};if(f.type==="Signature"||f.type==="Initials")return <button type="button" key={f.fieldId} onClick={()=>setInkField(f)} style={{...common,padding:4,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{value?<img src={value} alt="Captured handwritten ink" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>:<span style={{fontSize:11,fontWeight:700,color:"#15803d"}}>CLICK TO CAPTURE INK</span>}</button>;if(f.type==="Date")return <button type="button" key={f.fieldId} onClick={()=>activate(f)} style={{...common,border:"2px solid #0891b2",color:"#075985",fontWeight:700,fontSize:12,textAlign:"left",padding:"4px",cursor:"pointer"}}>{value||"CLICK TO INSERT DATE"}</button>;return <input key={f.fieldId} value={value} onChange={e=>setValue(f,e.target.value)} placeholder={f.placeholder||("Enter "+f.type.toLowerCase())} type={f.type==="Number"?"number":"text"} style={{...common,padding:"4px 7px",color:"#111827",fontSize:12,outline:"none"}}/>})}
  </div>
  {inkField&&<div style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><div className="panel" style={{width:"min(680px,96vw)",background:"#fff",color:"#111827"}}><h3>Capture Handwritten {TYPE_LABELS[inkField.type]||inkField.type}</h3><p className="muted">Use a mouse, trackpad, stylus, or your phone/tablet touchscreen. Turn your phone or tablet sideways if the document is easier to review in landscape. Your handwritten signature is captured as live touch/stylus ink and inserted into the assigned field.</p><div className="success-message action-feedback" style={{marginBottom:10}}>PHONE / TABLET SIGNING ENABLED — tap the green Signature field, write with your finger or stylus, then tap <strong>Use Handwritten Ink</strong>.</div><canvas ref={inkCanvasRef} width="900" height="300" style={{width:"100%",height:"clamp(180px,38vw,300px)",minHeight:180,border:"2px solid #cbd5e1",background:"#fff",touchAction:"none",cursor:"crosshair",display:"block",userSelect:"none",WebkitUserSelect:"none"}} onPointerDown={startInk} onPointerMove={moveInk} onPointerUp={()=>setDrawing(false)} onPointerCancel={()=>setDrawing(false)}/><div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:12}}><button type="button" className="text-button" onClick={clearInk}>Clear</button><button type="button" className="secondary-button" onClick={()=>setInkField(null)}>Cancel</button><button type="button" onClick={saveInk}>Use Handwritten Ink</button></div></div></div>}
  <div className="success-message action-feedback" style={{marginTop:10}}>Green fields are assigned to you. Click your Signature/Initials/Date fields to apply them; enter editorial text, numbers, comments or remarks directly on the document.</div>
 </div>;
}

export default function SignaturePlatform({signerOnly=false,signingEnvelopeId=null,initialDocument=null}){
 const[tab,setTab]=useState("Profile"),[profile,setProfile]=useState(null),[docs,setDocs]=useState([]),[envelopes,setEnvelopes]=useState([]),[members,setMembers]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const[displayName,setDisplayName]=useState(""),[initials,setInitials]=useState(""),[servedSignatureSrc,setServedSignatureSrc]=useState(""),[servedInitialsSrc,setServedInitialsSrc]=useState(""),[signatureFile,setSignatureFile]=useState(null),[initialsFile,setInitialsFile]=useState(null),[drawnSignature,setDrawnSignature]=useState(""),[replacementMode,setReplacementMode]=useState(false);
 const[title,setTitle]=useState(""),[documentId,setDocumentId]=useState(""),[documentUrl,setDocumentUrl]=useState(""),[signingMode,setSigningMode]=useState("Sequential"),[selectedSigner,setSelectedSigner]=useState(""),[draftEnvelopeId,setDraftEnvelopeId]=useState(null),[signerEmail,setSignerEmail]=useState(""),[signerRole,setSignerRole]=useState("Review"),[recipients,setRecipients]=useState([]),[fields,setFields]=useState([]),[selectedField,setSelectedField]=useState(null),[fieldValues,setFieldValues]=useState({}),[ownerSigningEnabled,setOwnerSigningEnabled]=useState(false);
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
        setDisplayName(signerProfile?.displayName||"");
        setInitials(signerProfile?.initials||"");
        setTab("Sign Document");
        return;
      }

      const[p,d,e]=await Promise.all([
        getMySignatureProfile(),
        getRecords("documents"),
        getSignatureEnvelopes()
      ]);

      setProfile(p);
      setDocs(d);
      setEnvelopes(e);
      setDisplayName(p?.displayName||"");
      setInitials(p?.initials||"");

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
 async function saveProfile(e){e.preventDefault();setBusy(true);setMessage("");try{let file=signatureFile;if(!file&&drawnSignature){const blob=await(await fetch(drawnSignature)).blob();file=new File([blob],"IRPA-handwritten-signature.png",{type:"image/png"})}if(!file)throw new Error("Upload a signature image or use the on-screen signing pad.");const p=await saveMySignatureProfile({signatureFile:file,initialsFile,displayName,initials,method:drawnSignature?"Direct Handwritten Capture":"Upload"});setProfile(p);setSignatureFile(null);setInitialsFile(null);setDrawnSignature("");e.target.reset();setMessage(drawnSignature?"Handwritten signature captured and saved to your Signature Profile.":"Signature profile saved successfully.")}catch(x){setMessage(x.message||"Unable to save signature profile.")}finally{setBusy(false)}}
 async function saveDrawnSignature(dataUrl){if(busy)throw new Error("A signature save is already in progress.");if(!String(displayName||"").trim())throw new Error("Enter your Display name before saving the signature specimen.");setBusy(true);setMessage("Saving your handwritten signature to your Signature Profile…");try{const blob=await(await fetch(dataUrl)).blob();const file=new File([blob],"IRPA-handwritten-signature.png",{type:"image/png"});const p=await saveMySignatureProfile({signatureFile:file,initialsFile,displayName,initials,method:"Direct Handwritten Capture"});setProfile(p);setDrawnSignature("");setSignatureFile(null);setReplacementMode(false);setMessage("SUCCESS: your handwritten signature is now the CURRENT SERVED SIGNATURE and will be reused for future documents.");return p;}catch(x){const msg=x?.message||"Unable to save the signature specimen.";setMessage("ERROR: "+msg);throw x}finally{setBusy(false)}}
 async function addSigner(){if(busy)return;const email=String(signerEmail||"").trim().toLowerCase();const m=members.find(x=>x.uid===selectedSigner||String(x.email||"").trim().toLowerCase()===email);if(!m){setMessage("Select a registered officer or enter the email address of a registered IRPA officer.");return;}if(recipients.some(x=>x.uid===m.uid)){setMessage("This officer is already in the signer hierarchy.");return;}if(!title.trim()){setMessage("Enter the envelope title before adding a signer. The owner section cannot be saved without a title.");return;}if(!documentId||!documentUrl){setMessage("Select a controlled PDF before adding a signer. The owner section will be saved automatically when you add the officer.");return;}const role=signerRole||"Review";const next={uid:m.uid,name:m.name||m.email,email:m.email||email,role,routingOrder:signingMode==="Sequential"?recipients.length+2:1,status:"Pending"};const nextRecipients=[...recipients,next];setBusy(true);setMessage("Saving the owner section and the new officer assignment…");try{const saved=await saveSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,signingMode,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",documentArchiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",recipients:nextRecipients,fields,ownerSigningEnabled});setDraftEnvelopeId(saved.id);setRecipients(nextRecipients);setSelectedSigner("");setSignerEmail("");setSignerRole("Review");setMessage("Owner section saved. "+(m.name||m.email)+" is now assigned as "+role+" and added to the workflow.");}catch(x){setMessage("Signer was not added: "+(x.message||"Unable to save the workflow."));}finally{setBusy(false)}}
 function removeSigner(uid){const removed=recipients.find(r=>r.uid===uid);setRecipients(recipients.filter(r=>r.uid!==uid));setFields(fields.map(f=>f.signerUid===uid?{...f,signerUid:""}:f));setMessage(`${removed?.name||"Officer"} removed. Reassign any fields previously assigned to this officer before saving the draft.`)}
 function moveSigner(uid,direction){const index=recipients.findIndex(r=>r.uid===uid);const next=index+direction;if(index<0||next<0||next>=recipients.length)return;const copy=[...recipients];[copy[index],copy[next]]=[copy[next],copy[index]];setRecipients(copy.map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1})));}
 async function createEnvelope(e){e.preventDefault();if(busy)return;setMessage("Create Draft Envelope clicked. Checking the document and required fields…");setBusy(true);try{if(!title.trim()){setMessage("Cannot create the draft yet: enter an envelope title.");throw new Error("Enter an envelope title before creating the draft.");}if(!documentId){setMessage("Cannot create the draft yet: no controlled document is selected. A signed document is not required at this stage; select the controlled PDF first.");throw new Error("Select a controlled document before creating the draft envelope.");}if(!documentUrl){setMessage("Cannot create the draft yet: the selected controlled document has no usable PDF file. Please select the uploaded PDF again.");throw new Error("The selected controlled document has no PDF file URL. Please select the uploaded PDF again.");}const owner={...documentOwner,optionalSigning:!ownerSigningEnabled};const orderedRecipients=[owner,...recipients.filter(r=>r.uid!==owner.uid).map((r,i)=>({...r,routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}))];const signerUids=new Set(orderedRecipients.map(r=>r.uid));if(fields.some(f=>!f.signerUid||!signerUids.has(f.signerUid))){setMessage("Cannot create the draft yet: one or more document fields have no responsible officer. Assign every field before continuing.");throw new Error("Assign every field to the document owner or an assigned signer before creating the envelope.");}setMessage("All checks passed. Saving the draft envelope and its field assignments…");const env=draftEnvelopeId
?await finalizeSignatureWorkflowDraft({envelopeId:draftEnvelopeId,title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",archiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",signingMode,recipients:orderedRecipients,fields,ownerSigningEnabled})
:await createSignatureEnvelope({title,documentId,documentReference:selectedDoc?.reference||selectedDoc?.title||documentId,documentUrl,documentClassification:selectedDoc?.classification||selectedDoc?.accessLevel||"Public",archiveCategory:selectedDoc?.archiveCategory||"Administrative Documents",signingMode,recipients:orderedRecipients,fields});setEnvelopes(prev=>[env,...prev]);setDraftEnvelopeId(null);setTitle("");setDocumentId("");setDocumentUrl("");setRecipients([]);setFields([]);setSelectedField(null);setTab("Envelopes");setMessage(`${env.envelopeReference} created as Draft.`)}catch(x){console.error("IRPA Signature Portal: Create Draft Envelope failed",x);setMessage(`Create Draft Envelope was not completed: ${x.message||"Unable to create envelope."}`)}finally{setBusy(false)}}
 async function sign(){setBusy(true);setMessage("");try{if(!selected)throw new Error("Open a signing envelope first.");const uid=auth.currentUser?.uid;if(selected.signingMode==="Sequential"&&selected.currentSignerUid!==uid)throw new Error("This envelope is waiting for another signer.");const mine=(selected.fields||[]).filter(f=>f.signerUid===uid);if(mine.some(f=>f.required&&["Text","Name","Date","Number","Comment","Remarks"].includes(f.type)&&!fieldValues[f.fieldId]))throw new Error("Complete all required fields assigned to you.");const updated=await signEnvelope(selected,profile,fieldValues);setSelected(updated);setEnvelopes(envelopes.map(e=>e.id===updated.id?updated:e));setMessage(updated.status==="Completed"?"Document completed and signed successfully.":"Your signature was applied. The next signer can continue.")}catch(x){setMessage(x.message||"Unable to complete signing.")}finally{setBusy(false)}}
 async function certificate(){setBusy(true);try{const url=await createCompletionCertificate(selected);const updated={...selected,certificateUrl:url};setSelected(updated);setEnvelopes(envelopes.map(e=>e.id===updated.id?updated:e));setMessage("Certificate of Completion generated.")}catch(x){setMessage(x.message||"Unable to generate certificate.")}finally{setBusy(false)}}
 return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA SIGNATURE PORTAL</span><h1>{signerOnly?"Signing Invitation":"Electronic Signature Workspace"}</h1><p>{signerOnly?"Review the invited controlled document and complete only the signature fields assigned to you.":"Prepare, route, sign and evidence controlled IRPA documents."}</p></div><div className="identity-card"><span>Signature status</span><strong>{profile?.status||"Not configured"}</strong>{profile?.driveSignatureFolderId&&<a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer" className="text-button" style={{display:"inline-block",marginTop:8,textDecoration:"none"}}>Open My Signature Folder</a>}</div></section>
 {!signerOnly&&<div className="dashboard-grid" style={{marginBottom:18}}>{[["Signature Profile",profile?"Active":"Required"],["Envelopes",envelopes.length],["Controlled Documents",docs.length],["Pending Signing",envelopes.filter(e=>e.status!=="Completed").length]].map(([a,b])=><div className="stat-card" key={a}><span>{a}</span><strong>{b}</strong><small>Signature Portal</small></div>)}</div>}
 {!signerOnly&&<div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>{["Profile","Prepare Envelope","Envelopes","Sign Document"].map(x=><button key={x} className={tab===x?"secondary-button":"text-button"} onClick={()=>setTab(x)}>{x}</button>)}</div>}{message&&<div className="auth-message" style={{marginBottom:16}}>{message}</div>}
 {!signerOnly&&tab==="Profile"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">SIGNATURE IDENTITY</span><h2>My Signature Profile</h2></div></div><p className="muted">Upload the actual handwritten signature and optional initials used during signing.</p>{profile?.driveSignatureFolderId&&<div className="success-message action-feedback" style={{marginTop:12}}>Your signature assets are stored in your UID-restricted Google Drive folder: <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(profile.driveSignatureFolderId)}`} target="_blank" rel="noopener noreferrer">Open My Signature Folder</a>.</div>}<form onSubmit={saveProfile}><div className="form-grid"><label>Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} required/></label><label>Initials<input value={initials} onChange={e=>setInitials(e.target.value)} placeholder="e.g. DEM"/></label><label>Signature image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{setSignatureFile(e.target.files?.[0]||null);setDrawnSignature("")}}/><small>Optional if you sign directly below.</small></label><label>Initials image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setInitialsFile(e.target.files?.[0]||null)}/></label></div><InkCapture onUse={saveDrawnSignature} onSave={saveDrawnSignature} replacementMode={replacementMode}/><div className="dashboard-grid" style={{marginTop:16}}>{profile?.signatureUrl?<div className="stat-card"><span>CURRENT SERVED SIGNATURE</span><div style={{background:"#fff",padding:12,borderRadius:8,marginTop:8}}>{servedSignatureSrc?<img src={servedSignatureSrc} alt="Current served signature" style={{maxWidth:"100%",maxHeight:100}}/>:<div className="auth-message" role="status">Loading current served signature…</div>}</div><small>SHA-256: {profile.signatureSha256}</small><div className="auth-message" role="status" style={{marginTop:10}}>This is the signature currently served from your Signature Profile and reused for future signing.</div></div>:<div className="stat-card"><span>NO SIGNATURE CURRENTLY SERVED</span><div className="auth-message" role="status" style={{marginTop:10}}>Your handwritten specimen above has not been served yet. Press <strong>Save &amp; Serve Signature</strong> once to make it your persistent signature.</div></div>}{profile?.initialsUrl&&<div className="stat-card"><span>Saved initials</span><div style={{background:"#fff",padding:12,borderRadius:8,marginTop:8}}>{servedInitialsSrc?<img src={servedInitialsSrc} alt="Initials" style={{maxWidth:"100%",maxHeight:100}}/>:<div className="auth-message" role="status">Loading initials…</div>}</div></div>}</div><button type="submit" style={{marginTop:18}} disabled={busy||(!signatureFile&&!drawnSignature)}>{busy?"Saving...":profile?"Save Signature Profile":"Save Signature Profile"}</button>{profile&&<button type="button" className="secondary-button" style={{marginTop:12,border:replacementMode?"2px solid #f87171":"1px solid rgba(255,255,255,.2)",fontWeight:800}} disabled={busy} onClick={()=>{setReplacementMode(true);setSignatureFile(null);setDrawnSignature("");setMessage("REPLACEMENT MODE ACTIVE: draw the new handwritten signature in the box above, then press Save & Serve Replacement. The current served signature remains active until the save succeeds.");document.querySelector("[data-signature-specimen]")?.scrollIntoView({behavior:"smooth",block:"center"})}}>{replacementMode?"Replacement Mode Active":"Replace Signature"}</button>}<div className="auth-message" role="status" aria-live="polite" style={{marginTop:12}}>{busy?"Saving signature to your persistent Signature Profile…":replacementMode?"REPLACEMENT MODE ACTIVE: draw the new signature and press Save & Serve Signature. The current served signature remains unchanged until the save succeeds.":profile?"CURRENT SIGNATURE SERVED: this signature will be reused for future documents.":"NO SIGNATURE SERVED: save your handwritten specimen above to activate it."}</div></form></section>}
 {!signerOnly&&tab==="Prepare Envelope"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENVELOPE PREPARATION</span><h2>Prepare, Assign & Route Document</h2><p className="muted">Upload/select the controlled PDF, place comments, numbers, remarks, dates and signatures, assign every field to an officer, and route the document in the required sequence.</p></div></div><form onSubmit={createEnvelope} noValidate><div className="form-grid"><label>Envelope title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Board Resolution Approval"/></label><label>Controlled document<select value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">Select document</option>{docs.map(d=><option key={d.id} value={d.id}>{d.reference||d.title||d.id}</option>)}</select></label><label>Signing route<select value={signingMode} onChange={e=>setSigningMode(e.target.value)}><option>Sequential</option><option>Parallel</option><option>Mixed</option></select></label></div>
 <div className="panel" style={{marginTop:18,border:"1px solid rgba(109,93,252,.35)"}}><h3>Signer Hierarchy</h3><p className="muted" style={{marginTop:4}}>The document owner controls the workflow. Add each signing officer as a separate level. Define the officer by email and assign the purpose of their action. Add as many levels as required.</p><div className="form-grid"><label>1. Add signer / officer<select value={selectedSigner} onChange={e=>{setSelectedSigner(e.target.value);const m=members.find(x=>x.uid===e.target.value);setSignerEmail(m?.email||"")}}><option value="">Select registered officer</option>{members.filter(m=>m.uid!==documentOwner.uid&&!recipients.some(r=>r.uid===m.uid)).map(m=><option key={m.uid} value={m.uid}>{m.name||m.email}</option>)}</select></label><label>Signer email address<input type="email" value={signerEmail} onChange={e=>setSignerEmail(e.target.value)} placeholder="officer@irpa.or.tz"/></label><label>Role / action<select value={signerRole} onChange={e=>setSignerRole(e.target.value)}><option>Review</option><option>Authorization</option><option>Approval</option><option>Verification</option><option>Recommendation</option><option>Comment</option><option>Signature</option><option>Final Authorization</option><option>Other</option></select></label></div><button type="button" className="secondary-button" onClick={addSigner} disabled={!selectedSigner&&!signerEmail}>Add signer / next level</button><div style={{marginTop:16}}><strong>Workflow ladder</strong>{recipients.length===0?<p className="muted">No officers added yet. Add Level 2, Level 3, Level 4 and as many additional levels as required.</p>:recipients.map((r,i)=><div key={r.uid} style={{display:"grid",gridTemplateColumns:"44px minmax(0,1fr) auto",gap:10,alignItems:"center",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><strong>Level {i+2}</strong><span><strong>{r.name}</strong><small style={{display:"block"}}>{r.email} · {r.role}</small></span><span style={{display:"flex",gap:4}}><button type="button" className="text-button" onClick={()=>moveSigner(r.uid,-1)} disabled={i===0}>↑</button><button type="button" className="text-button" onClick={()=>moveSigner(r.uid,1)} disabled={i===recipients.length-1}>↓</button><button type="button" className="text-button" onClick={()=>removeSigner(r.uid)}>Remove</button></span></div>)}</div></div>
 <div className="panel" style={{marginTop:18}}><h3>Document Workflow & Signer Hierarchy</h3><p className="muted" style={{marginTop:4}}>Assign each field to the document owner or an officer. The owner can be included as an optional signing step; if optional, the workflow proceeds to the first assigned officer without requiring the owner to sign.</p><div style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><strong>1. {documentOwner.name}</strong><small style={{display:"block"}}>{documentOwner.email} · Document Owner</small><label style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}><input type="checkbox" checked={ownerSigningEnabled} onChange={e=>setOwnerSigningEnabled(e.target.checked)}/> Owner must sign first before the routed officers</label></div>{recipients.length===0?<p className="muted" style={{marginTop:10}}>Add the responsible officers who must sign or complete this document.</p>:recipients.map((r,i)=><div key={r.uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}><span><strong>{signingMode==="Sequential"?`${i+2}. `:""}{r.name}</strong><small style={{display:"block"}}>{r.email} · {r.role}</small></span><button type="button" className="text-button" onClick={()=>removeSigner(r.uid)}>Remove officer</button></div>)}</div>
 <div className="panel" style={{marginTop:18,border:"1px solid rgba(109,93,252,.35)"}}><h3>Field Assignment</h3><p className="muted" style={{marginTop:4}}>When you place a Signature, Initials, Date, Number, Comment or Remarks field, select the responsible person in <strong>FIELD PROPERTIES → Signer</strong>. This assignment controls who receives the task and the signing sequence.</p></div>
 <PDFDesigner url={documentUrl} documentId={documentId} fields={fields} setFields={setFields} recipients={workflowRecipients} selectedField={selectedField} setSelectedField={setSelectedField} activeAssigneeUid={recipients.length?recipients[recipients.length-1].uid:documentOwner.uid}/>
 <button type="submit" className="create-envelope-action" disabled={busy} aria-busy={busy?"true":"false"}>{busy?"Creating Draft Envelope…":"Create Draft Envelope"}</button></form></section>}
 {!signerOnly&&tab==="Envelopes"&&<section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENVELOPE REGISTER</span><h2>Signing Transactions</h2></div></div>{envelopes.length===0?<p className="muted">No signing envelopes yet.</p>:envelopes.map(e=><article key={e.id} className="stat-card" style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><div><span>{e.envelopeReference}</span><h3 style={{margin:"5px 0"}}>{e.title}</h3><small>{e.documentReference} · {e.signingMode} · {e.recipients?.length||0} signer(s)</small></div><div><strong>{e.status}</strong><br/><button className="text-button" onClick={()=>{setSelected(e);setTab("Sign Document")}}>Open</button>{e.status==="Draft"&&<button className="text-button" onClick={async()=>{setBusy(true);setMessage("");try{const updated=await startSignatureWorkflow(e);setEnvelopes(envelopes.map(x=>x.id===updated.id?updated:x));setSelected(updated);setTab("Sign Document");setMessage("Workflow started. The current officer has been released.")}catch(x){setMessage(x.message||"Unable to start workflow.")}finally{setBusy(false)}}} disabled={busy}>Start Workflow</button>}</div></div></article>)}</section>}
 {tab==="Sign Document"&&<section className="panel">{!selected?<><h2>Signing Ceremony</h2><p className="muted">This signing invitation could not be loaded.</p></>:<><div className="panel-heading"><div><span className="eyebrow">SIGNING CEREMONY</span><h2>{selected.title}</h2><p>{selected.envelopeReference} · {selected.status}</p></div></div><div className="panel" style={{marginBottom:18}}><h3>Signing Progress</h3><div style={{display:"grid",gap:8,marginTop:10}}>{(selected.recipients||[]).map((r,index)=>{const isCurrent=selected.status!=="Completed"&&selected.currentSignerUid===r.uid;const isSigned=r.status==="Signed"||((selected.workflowHistory||[]).some(h=>h.uid===r.uid));const state=selected.status==="Completed"&&isSigned?"Completed":isSigned?"Signed":isCurrent?"Current signer":"Pending";const when=r.completedAt||((selected.workflowHistory||[]).filter(h=>h.uid===r.uid).slice(-1)[0]?.completedAt)||"";return <div key={r.uid||index} style={{display:"grid",gridTemplateColumns:"36px 1fr auto",gap:10,alignItems:"center",padding:"10px 12px",border:"1px solid rgba(255,255,255,.09)",borderRadius:8}}><strong>{index+1}</strong><div><strong>{r.name||r.email||"Assigned signer"}</strong><div style={{fontSize:12,opacity:.7}}>{r.role||"Action"} · {r.email||""}</div>{when&&<div style={{fontSize:11,opacity:.6}}>Completed: {new Date(when).toLocaleString()}</div>}</div><span>{state}</span></div>})}</div>{selected.currentSignerUid&&selected.status!=="Completed"&&<p className="muted" style={{marginBottom:0,marginTop:10}}>Next action: {(selected.recipients||[]).find(r=>r.uid===selected.currentSignerUid)?.name||"Assigned signer"}.</p>}{selected.status==="Completed"&&<p className="muted" style={{marginBottom:0,marginTop:10}}>All required signing actions are complete.</p>}</div>{selected.documentUrl&&<SigningDocumentViewer url={selected.signedDocumentUrl||selected.documentUrl} documentId={selected.documentId} fields={selected.fields||[]} profile={profile} fieldValues={fieldValues} setFieldValues={setFieldValues}/>}<div className="panel" style={{marginTop:18}}>
 <h3>Document Archive</h3>
 <p className="muted" style={{marginBottom:12}}>The controlled document remains available to the assigned signee throughout the workflow. After an action is completed, the latest signed version is exposed here for review and intended use.</p>
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
  {selected.documentUrl&&<a className="controlled-document-open-button" href={selected.documentUrl.startsWith("drive://")?"#":selected.documentUrl} target="_blank" rel="noreferrer" onClick={async e=>{if(selected.documentUrl.startsWith("drive://")){e.preventDefault();try{const bytes=await downloadDriveBytes(selected.documentUrl.slice("drive://".length));const blob=new Blob([bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);window.open(url,"_blank","noopener,noreferrer");setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(x){setMessage(x.message||"Unable to open the controlled document.")}}}}>Open Controlled Document</a>}
  {selected.signedDocumentUrl&&<a className="secondary-button" href={selected.signedDocumentUrl} target="_blank" rel="noreferrer">Open Latest Signed Document</a>}
  {selected.certificateUrl&&<a className="secondary-button" href={selected.certificateUrl} target="_blank" rel="noreferrer">Open Completion Certificate</a>}
 </div>
 </div><div className="panel" style={{marginTop:18}}><h3>Fields assigned to you</h3>{(selected.fields||[]).filter(f=>f.signerUid===auth.currentUser?.uid).map(f=><label key={f.fieldId} style={{display:"block",marginTop:10}}>{f.type}{f.required?" *":""}{f.type==="Signature"||f.type==="Initials"?<div className="stat-card" style={{marginTop:5}}>{f.type} will use your saved Signature Profile.</div>:<input value={fieldValues[f.fieldId]||""} onChange={e=>setFieldValues({...fieldValues,[f.fieldId]:e.target.value})} placeholder={f.placeholder||`Enter ${f.type.toLowerCase()}`} type={f.type==="Number"?"number":"text"}/>}</label>)}<div style={{marginTop:18,display:"flex",gap:8,flexWrap:"wrap"}}><button onClick={sign} disabled={busy||selected.status==="Completed"}>{busy?"Processing...":selected.status==="Completed"?"Completed":"Adopt Signature & Sign"}</button>{selected.status==="Completed"&&<button className="secondary-button" onClick={certificate} disabled={busy}>Generate Certificate of Completion</button>}{selected.signedDocumentUrl&&<a className="secondary-button" href={selected.signedDocumentUrl} target="_blank" rel="noreferrer">Open Signed PDF</a>}{selected.certificateUrl&&<a className="secondary-button" href={selected.certificateUrl} target="_blank" rel="noreferrer">Open Certificate</a>}</div></div></>}</section>}
 </div>;
}
