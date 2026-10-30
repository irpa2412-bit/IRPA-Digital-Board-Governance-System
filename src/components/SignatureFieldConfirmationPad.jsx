import React,{useLayoutEffect,useRef,useState}from"react";

export default function SignatureFieldConfirmationPad({field,savedSignatureUrl="",savedInitialsUrl="",onConfirm,onCancel}){
  const canvasRef=useRef(null),drawing=useRef(false),last=useRef(null),canvasSize=useRef({width:0,height:0});
  const[mode,setMode]=useState("Draw"),[typed,setTyped]=useState(""),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  const label=field?.type==="Initials"?"initials":"signature";
  useLayoutEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas)return;
    const resize=()=>{
      const rect=canvas.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      if(canvasSize.current.width===rect.width&&canvasSize.current.height===rect.height)return;
      const ratio=Math.max(1,window.devicePixelRatio||1);
      canvas.width=Math.round(rect.width*ratio);
      canvas.height=Math.round(rect.height*ratio);
      canvasSize.current={width:rect.width,height:rect.height};
      const ctx=canvas.getContext("2d");
      ctx.setTransform(ratio,0,0,ratio,0,0);
      ctx.clearRect(0,0,rect.width,rect.height);
      ctx.lineCap="round";
      ctx.lineJoin="round";
      ctx.lineWidth=5;
      ctx.strokeStyle="#111827";
      setDirty(false);
      setError("");
    };
    resize();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(resize):null;
    observer?.observe(canvas);
    window.addEventListener("resize",resize);
    return()=>{observer?.disconnect();window.removeEventListener("resize",resize)};
  },[mode,field?.fieldId]);
  const point=e=>{
    const rect=canvasRef.current.getBoundingClientRect();
    return{x:e.clientX-rect.left,y:e.clientY-rect.top};
  };
  const start=e=>{
    if(mode!=="Draw")return;
    e.preventDefault();
    const canvas=canvasRef.current,ctx=canvas.getContext("2d"),p=point(e);
    drawing.current=true;
    last.current=p;
    try{canvas.setPointerCapture(e.pointerId)}catch{}
    ctx.beginPath();
    ctx.arc(p.x,p.y,2.5,0,Math.PI*2);
    ctx.fillStyle="#111827";
    ctx.fill();
    setDirty(true);
  };
  const move=e=>{
    if(mode!=="Draw"||!drawing.current||!last.current)return;
    e.preventDefault();
    const ctx=canvasRef.current.getContext("2d"),p=point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x,last.current.y);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
    last.current=p;
  };
  const end=()=>{drawing.current=false;last.current=null};
  const clear=()=>{
    const canvas=canvasRef.current;
    if(canvas){
      const rect=canvas.getBoundingClientRect();
      canvas.getContext("2d").clearRect(0,0,rect.width,rect.height);
    }
    if(mode==="Use my saved signature")setMode("Draw");
    setTyped("");
    setDirty(false);
    setError("");
  };
  async function confirm(){
    try{
      let dataUrl="";
      if(mode==="Draw"){
        if(!dirty)throw new Error("Draw your signature first, or choose Type or Use my saved signature.");
        dataUrl=canvasRef.current.toDataURL("image/png");
      }else if(mode==="Type"){
        if(!typed.trim())throw new Error("Enter your name before confirming.");
        const canvas=document.createElement("canvas");canvas.width=900;canvas.height=240;
        const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#111827";ctx.font="italic 72px cursive";ctx.textBaseline="middle";ctx.fillText(typed.trim().slice(0,80),24,120,850);dataUrl=canvas.toDataURL("image/png");
      }else{
        const src=field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl;
        if(!src)throw new Error("No saved "+label+" is available. Choose Draw or Type instead.");
        const img=new Image();img.crossOrigin="anonymous";img.src=src;
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("The saved specimen could not be loaded. Choose Draw or Type instead."))});
        const canvas=document.createElement("canvas");canvas.width=900;canvas.height=240;
        const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);dataUrl=canvas.toDataURL("image/png");
      }
      if(!dataUrl.startsWith("data:image/png;base64,"))throw new Error("The signature image could not be prepared.");
      await onConfirm(dataUrl);
    }catch(e){setError(e?.message||"The signature was not confirmed.");}
  }
  return <section role="dialog" aria-modal="false" aria-label={"Confirm "+label} className="panel signature-confirmation-dock" style={{position:"relative",zIndex:10,width:"100%",maxWidth:720,margin:"16px auto",maxHeight:"min(70vh,620px)",overflowY:"auto",overflowX:"hidden",boxSizing:"border-box",border:"2px solid var(--border)",boxShadow:"0 8px 24px rgba(15,23,42,.18)",background:"var(--surface)",color:"var(--text)"}}>
      <h2>Confirm {field?.type||"Signature"}</h2><p className="muted">Assigned field: page {field?.page||1}, {Number(field?.x||0).toFixed(1)}% from left, {Number(field?.y||0).toFixed(1)}% from top. Nothing is applied until you tap Confirm.</p>
      <div role="group" aria-label="Signature method" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {["Draw","Type","Use my saved signature"].map(item=><button key={item} type="button" className={mode===item?"":"secondary-button"} onClick={()=>setMode(item)}>{item}</button>)}
      </div>
      {mode==="Draw"?<canvas ref={canvasRef} width={900} height={240} aria-label="Draw signature" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} style={{width:"100%",height:220,border:"2px solid var(--border)",borderRadius:8,background:"#fff",touchAction:"none",pointerEvents:"auto",userSelect:"none",display:"block"}}/>:mode==="Type"?<label style={{display:"block"}}>Type your signature<input autoComplete="off" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Type the name you want to sign with" style={{display:"block",width:"100%",marginTop:8}}/><div aria-label="Typed signature preview" style={{fontFamily:"cursive",fontStyle:"italic",fontSize:36,minHeight:64,padding:12}}>{typed||"Signature preview"}</div></label>:<div className="stat-card">{(field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl)?"Your saved specimen is selected. Tap Confirm to apply it.":"No saved specimen is available; choose Draw or Type."}</div>}
      {error&&<p role="alert" className="error-message">{error}</p>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14,flexWrap:"wrap"}}><button type="button" className="secondary-button" onClick={clear}>Clear and redo</button><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="button" onClick={confirm}>Confirm {field?.type||"Signature"}</button></div>
  </section>
}
