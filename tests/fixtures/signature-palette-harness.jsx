import React,{useEffect,useState} from "react";
import{createRoot}from"react-dom/client";
import SignatureFieldConfirmationPad from "../../src/components/SignatureFieldConfirmationPad.jsx";
import"../../src/styles/portal-readability-standard.css";

const initialFields=[
 {fieldId:"sig-page-1",type:"Signature",page:1,x:16,y:26,width:32,height:10},
 {fieldId:"initial-page-1",type:"Initials",page:1,x:58,y:26,width:22,height:10},
 {fieldId:"sig-page-2",type:"Signature",page:2,x:20,y:48,width:34,height:11}
];
function Harness(){
 const[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[active,setActive]=useState(null);
 const[state,setState]=useState(()=>{try{return JSON.parse(sessionStorage.getItem("signature-envelope-fixture")||"{}")}catch{return {}}});
 const values=state.values||{};
 useEffect(()=>{sessionStorage.setItem("signature-envelope-fixture",JSON.stringify(state))},[state]);
 const current=initialFields.filter(f=>f.page===page);
 const apply=(field,value)=>{setState(prev=>({...prev,values:{...(prev.values||{}),[field.fieldId]:value}}));setActive(null)};
 return <main style={{maxWidth:1000,margin:"0 auto",background:"#fff",padding:16,borderRadius:12}}>
  <h1>Signing ceremony · Envelope TEST-ENVELOPE</h1>
  <section aria-label="Controlled PDF viewer">
   <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:12}}>
    <div><button type="button" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>Previous page</button> <span>Page <strong data-testid="page-number">{page}</strong> / 2</span> <button type="button" onClick={()=>setPage(p=>Math.min(2,p+1))} disabled={page===2}>Next page</button></div>
    <div><button type="button" aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.6,Number((z-.1).toFixed(2))))}>−</button> <span data-testid="zoom-level">{Math.round(zoom*100)}%</span> <button type="button" aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(1.8,Number((z+.1).toFixed(2))))}>+</button></div>
   </div>
   <div data-testid="pdf-page" data-page={page} style={{position:"relative",width:"100%",maxWidth:Math.round(680*zoom),aspectRatio:"0.72",margin:"0 auto",background:"linear-gradient(180deg,#fff,#f8fafc)",border:"1px solid #94a3b8",boxShadow:"0 2px 12px #0002",overflow:"hidden"}}>
    <canvas aria-label="Rendered PDF page" width="680" height="944" style={{width:"100%",height:"100%",display:"block"}}/>
    {current.map(field=><button type="button" key={field.fieldId} data-testid={"field-"+field.fieldId} data-field-id={field.fieldId} onClick={()=>setActive(field)} style={{position:"absolute",zIndex:5,left:field.x+"%",top:field.y+"%",width:field.width+"%",height:field.height+"%",border:"2px solid #15803d",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",padding:3}}>
      {values[field.fieldId]?<img data-testid={"placed-"+field.fieldId} alt={"Confirmed "+field.type} src={values[field.fieldId]} style={{width:"100%",height:"100%",objectFit:"contain"}}/>: "Tap to sign"}
    </button>)}
   </div>
  </section>
  {active&&<SignatureFieldConfirmationPad field={active} savedSignatureUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9XcAAAAASUVORK5CYII=" savedInitialsUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9XcAAAAASUVORK5CYII=" onCancel={()=>setActive(null)} onConfirm={value=>apply(active,value)}/>}
  <p data-testid="envelope-state">Confirmed fields: {Object.keys(values).length}</p>
 </main>;
}
createRoot(document.getElementById("root")).render(<Harness/>);
