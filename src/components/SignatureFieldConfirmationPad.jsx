import React,{useLayoutEffect,useRef,useState}from"react";
import{trimSignatureCanvas}from"../utils/signatureImageCanvas.mjs";

export default function SignatureFieldConfirmationPad({field,savedSignatureUrl="",savedInitialsUrl="",onConfirm,onCancel,allowTyped=true}){
  const canvasRef=useRef(null),drawing=useRef(false),last=useRef(null),canvasSize=useRef({width:0,height:0}),dirtyRef=useRef(false);
  const hasSavedSpecimen=Boolean(field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl);
  const[mode,setMode]=useState(hasSavedSpecimen?"Use my saved signature":"Draw"),[typed,setTyped]=useState(""),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  const label=field?.type==="Initials"?"initials":"signature";
  useLayoutEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas)return;
    const resize=()=>{
      const rect=canvas.getBoundingClientRect();
      // Ignore transient collapsed layout measurements: resizing the backing canvas to 1px during a viewport transition irreversibly destroys in-progress ink.
      if(rect.width<64||rect.height<48)return;
      if(canvasSize.current.width===rect.width&&canvasSize.current.height===rect.height)return;
      const ratio=Math.max(1,window.devicePixelRatio||1);
      const previous=document.createElement("canvas");
      const hadInk=dirtyRef.current&&canvas.width>0&&canvas.height>0;
      if(hadInk){previous.width=canvas.width;previous.height=canvas.height;previous.getContext("2d").drawImage(canvas,0,0);}
      canvas.width=Math.round(rect.width*ratio);
      canvas.height=Math.round(rect.height*ratio);
      canvasSize.current={width:rect.width,height:rect.height};
      const ctx=canvas.getContext("2d");
      ctx.setTransform(ratio,0,0,ratio,0,0);
      ctx.clearRect(0,0,rect.width,rect.height);
      if(hadInk){
        const scale=Math.min(canvas.width/previous.width,canvas.height/previous.height);
        const width=previous.width*scale,height=previous.height*scale;
        ctx.drawImage(previous,0,0,previous.width,previous.height,(rect.width-width/ratio)/2,(rect.height-height/ratio)/2,width/ratio,height/ratio);
      }
      ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=5;ctx.strokeStyle="#111827";
      setError("");
    };
    resize();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(resize):null;
    observer?.observe(canvas);window.addEventListener("resize",resize);
    return()=>{observer?.disconnect();window.removeEventListener("resize",resize)};
  },[mode,field?.fieldId]);
  const point=e=>{const rect=canvasRef.current.getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top};};
  const start=e=>{
    if(mode!=="Draw")return;e.preventDefault();
    const canvas=canvasRef.current,ctx=canvas.getContext("2d"),p=point(e);
    drawing.current=true;last.current=p;
    try{canvas.setPointerCapture(e.pointerId)}catch{}
    ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fillStyle="#111827";ctx.fill();
    dirtyRef.current=true;setDirty(true);
  };
  const move=e=>{
    if(mode!=="Draw"||!drawing.current||!last.current)return;e.preventDefault();
    const ctx=canvasRef.current.getContext("2d"),p=point(e);
    ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(p.x,p.y);ctx.stroke();last.current=p;
  };
  const end=event=>{drawing.current=false;last.current=null;const canvas=canvasRef.current;try{if(canvas&&event?.pointerId!==undefined&&canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture(event.pointerId)}catch{}};
  const clear=()=>{
    const canvas=canvasRef.current;
    if(canvas){const rect=canvas.getBoundingClientRect();const ratio=Math.max(1,window.devicePixelRatio||1);const context=canvas.getContext("2d");context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,rect.width,rect.height);}
    if(mode==="Use my saved signature")setMode("Draw");
    setTyped("");dirtyRef.current=false;setDirty(false);setError("");
  };
  async function confirm(){
    try{
      let specimen;
      if(mode==="Draw"){
        if(!dirtyRef.current)throw new Error("Draw your signature first, or choose Type or Use my saved signature.");
        specimen=trimSignatureCanvas(canvasRef.current,{padding:4,devicePixelRatio:Math.max(1,window.devicePixelRatio||1)});
      }else if(mode==="Type"){
        const value=typed.trim().slice(0,80);
        if(!value)throw new Error("Enter your name before confirming.");
        const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
        const dpr=Math.max(1,window.devicePixelRatio||1);const font=`italic ${72*dpr}px cursive`;ctx.font=font;
        const metrics=ctx.measureText(value);
        const left=Math.max(0,metrics.actualBoundingBoxLeft||0),right=Math.max(1,metrics.actualBoundingBoxRight||metrics.width);
        const ascent=Math.max(1,metrics.actualBoundingBoxAscent||60),descent=Math.max(0,metrics.actualBoundingBoxDescent||12);
        const padding=8*dpr;canvas.width=Math.ceil(left+right+padding*2);canvas.height=Math.ceil(ascent+descent+padding*2);
        const textContext=canvas.getContext("2d");textContext.font=font;textContext.fillStyle="#111827";textContext.textBaseline="alphabetic";
        textContext.fillText(value,padding+left,padding+ascent);
        specimen=trimSignatureCanvas(canvas,{padding:4,devicePixelRatio:dpr});
      }else{
        const src=field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl;
        if(!src)throw new Error("No saved "+label+" is available. Choose Draw or Type instead.");
        const img=new Image();img.crossOrigin="anonymous";img.src=src;
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("The saved specimen could not be loaded. Choose Draw or Type instead."));});
        specimen=trimSignatureCanvas(img,{padding:4});
      }
      if(!specimen.dataUrl.startsWith("data:image/png;base64,"))throw new Error("The signature image could not be prepared.");
      await onConfirm(specimen.dataUrl,field);
    }catch(e){setError(e?.message||"The signature was not confirmed.");}
  }
  return <section role="dialog" aria-modal="false" aria-label={"Confirm "+label} className="panel signature-confirmation-dock" style={{position:"fixed",left:0,right:0,bottom:0,zIndex:1000,display:"flex",flexDirection:"column",maxHeight:"calc(100dvh - 12px)",height:"auto",minHeight:0,overflow:"hidden",boxSizing:"border-box",background:"#ffffff",boxShadow:"0 -4px 16px rgba(0,0,0,0.25)"}}>
      <header style={{flex:"0 0 auto",padding:"12px 16px 0"}}>
        <h2 style={{margin:"0 0 8px"}}>Confirm {field?.type||"Signature"}</h2>
        <p className="muted" style={{margin:"0 0 12px"}}>Assigned field: page {field?.page||1}, {Number(field?.x||0).toFixed(1)}% from left, {Number(field?.y||0).toFixed(1)}% from top. If an active saved specimen is available in your own profile, it is selected for your review. Nothing is applied until you confirm.</p>
        <div role="group" aria-label="Signature method" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          {["Draw",...(allowTyped?["Type"]:[]),"Use my saved signature"].map(item=><button key={item} type="button" className={mode===item?"":"secondary-button"} onClick={()=>setMode(item)} style={{minHeight:44}}>{item}</button>)}
        </div>
      </header>
      <div className="signature-confirmation-content" style={{flex:"1 1 auto",minHeight:0,overflowY:"auto",overscrollBehavior:"contain",padding:"0 16px 12px",WebkitOverflowScrolling:"touch"}}>
        {mode==="Draw"?<canvas ref={canvasRef} width={900} height={240} aria-label="Draw signature" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} style={{position:"relative",zIndex:1,width:"100%",height:220,border:"2px solid var(--border)",borderRadius:8,background:"#fff",touchAction:"none",pointerEvents:"auto",userSelect:"none",display:"block",boxSizing:"border-box"}}/>:mode==="Type"?<label style={{display:"block"}}>Type your signature<input autoComplete="off" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Type the name you want to sign with" style={{display:"block",width:"100%",marginTop:8,minHeight:44,boxSizing:"border-box"}}/><div aria-label="Typed signature preview" style={{fontFamily:"cursive",fontStyle:"italic",fontSize:36,minHeight:64,padding:12}}>{typed||"Signature preview"}</div></label>:<div className="stat-card">{(field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl)?"Your saved specimen is selected. Tap “Use this signature” to apply it.":"No saved specimen is available; choose Draw or Type."}</div>}
        {error&&<p role="alert" className="error-message">{error}</p>}
      </div>
      <footer className="signature-confirmation-actions" style={{position:"sticky",bottom:0,zIndex:2,flex:"0 0 auto",display:"flex",justifyContent:"flex-end",alignItems:"center",gap:8,flexWrap:"wrap",padding:"10px 16px calc(10px + env(safe-area-inset-bottom, 0px))",borderTop:"1px solid #d1d5db",background:"#fff",boxShadow:"0 -3px 10px rgba(0,0,0,.08)"}}>
        <button type="button" className="secondary-button" onClick={clear} style={{minHeight:44}}>Clear and redo</button>
        <button type="button" className="secondary-button" onClick={onCancel} style={{minHeight:44}}>Cancel</button>
        <button type="button" onClick={confirm} style={{minHeight:44,padding:"10px 18px"}}>{mode==="Use my saved signature"?"Use this signature":mode==="Type"?"Confirm "+(field?.type||"Signature"):"Confirm "+(field?.type||"Signature")}</button>
      </footer>
  </section>;
}
