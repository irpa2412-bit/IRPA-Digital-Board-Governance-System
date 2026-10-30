import React,{useEffect,useRef,useState}from"react";

export default function SignatureFieldConfirmationPad({field,savedSignatureUrl="",savedInitialsUrl="",onConfirm,onCancel}){
  const canvasRef=useRef(null),drawing=useRef(false),last=useRef(null);
  const[mode,setMode]=useState("Draw"),[typed,setTyped]=useState(""),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  const label=field?.type==="Initials"?"initials":"signature";
  useEffect(()=>{const c=canvasRef.current;if(!c)return;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=5;ctx.strokeStyle="#111827";setDirty(false);setError("");},[mode,field?.fieldId]);
  const point=e=>{const c=canvasRef.current,r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/Math.max(1,r.width),y:(e.clientY-r.top)*c.height/Math.max(1,r.height)}};
  const start=e=>{if(mode!=="Draw")return;e.preventDefault();const c=canvasRef.current,ctx=c.getContext("2d"),p=point(e);drawing.current=true;last.current=p;c.setPointerCapture?.(e.pointerId);ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fillStyle="#111827";ctx.fill();setDirty(true)};
  const move=e=>{if(mode!=="Draw"||!drawing.current)return;e.preventDefault();const c=canvasRef.current,ctx=c.getContext("2d"),p=point(e);ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(p.x,p.y);ctx.stroke();last.current=p};
  const end=()=>{drawing.current=false;last.current=null};
  const clear=()=>{const c=canvasRef.current;if(c){const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height)}if(mode==="Use my saved signature")setMode("Draw");setTyped("");setDirty(false);setError("")};
  async function confirm(){
    try{
      let dataUrl="";
      if(mode==="Draw"){
        if(!dirty)throw new Error("Draw your signature first, or choose Type or Use my saved signature.");
        dataUrl=canvasRef.current.toDataURL("image/png");
      }else if(mode==="Type"){
        if(!typed.trim())throw new Error("Enter your name before confirming.");
        const c=document.createElement("canvas");c.width=900;c.height=240;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle="#111827";ctx.font="italic 72px cursive";ctx.textBaseline="middle";ctx.fillText(typed.trim().slice(0,80),24,120,850);dataUrl=c.toDataURL("image/png");
      }else{
        const src=field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl;
        if(!src)throw new Error("No saved "+label+" is available. Choose Draw or Type instead.");
        const img=new Image();img.crossOrigin="anonymous";img.src=src;
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("The saved specimen could not be loaded. Choose Draw or Type instead."))});
        const c=document.createElement("canvas");c.width=900;c.height=240;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);dataUrl=c.toDataURL("image/png");
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
      {mode==="Draw"?<canvas ref={canvasRef} width={900} height={240} aria-label="Draw signature" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} style={{width:"100%",height:220,border:"2px solid var(--border)",borderRadius:8,background:"#fff",touchAction:"none",display:"block"}}/>:mode==="Type"?<label style={{display:"block"}}>Type your signature<input autoComplete="off" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Type the name you want to sign with" style={{display:"block",width:"100%",marginTop:8}}/><div aria-label="Typed signature preview" style={{fontFamily:"cursive",fontStyle:"italic",fontSize:36,minHeight:64,padding:12}}>{typed||"Signature preview"}</div></label>:<div className="stat-card">{(field?.type==="Initials"?savedInitialsUrl:savedSignatureUrl)?"Your saved specimen is selected. Tap Confirm to apply it.":"No saved specimen is available; choose Draw or Type."}</div>}
      {error&&<p role="alert" className="error-message">{error}</p>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14,flexWrap:"wrap"}}><button type="button" className="secondary-button" onClick={clear}>Clear and redo</button><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="button" onClick={confirm}>Confirm {field?.type||"Signature"}</button></div>
  </section>
}
