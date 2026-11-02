import React,{useEffect,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import*as pdfjsLib from"pdfjs-dist";
import pdfWorker from"pdfjs-dist/build/pdf.worker.min.mjs?url";
import{renderPdfPageToCanvas,describePdfPageError}from"../../src/utils/pdfPageRendering.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;
function Harness(){
 const [bytes,setBytes]=useState(null),[pdf,setPdf]=useState(null),[stage,setStage]=useState("WAITING FOR CONTROLLED PDF"),[signer,setSigner]=useState(false),[field,setField]=useState(null),[envelope,setEnvelope]=useState(false),[view,setView]=useState("signature"),[error,setError]=useState(null),[metrics,setMetrics]=useState(null),[retry,setRetry]=useState(0);
 const canvas=useRef(null);
 async function upload(event){try{const file=event.target.files?.[0];if(!file)throw new Error("Select a generated PDF fixture.");const raw=new Uint8Array(await file.arrayBuffer());const doc=await pdfjsLib.getDocument({data:raw.slice()}).promise;if(doc.numPages!==3)throw new Error("Fixture must contain exactly three pages; received "+doc.numPages);setBytes(raw);setPdf(doc);setSigner(false);setField(null);setEnvelope(false);setStage("CONTROLLED PDF UPLOADED");setError(null);setView("signature");}catch(e){setError(describePdfPageError(e));}}
 async function addSigner(){if(!bytes)throw new Error("Upload the controlled PDF first.");setSigner(true);setStage("SIGNER ADDED");}
 function assignField(){setField({page:3,fieldId:"PAGE-3-SIGNATURE",signerUid:"authenticated-fixture-signer"});setStage("SIGNATURE FIELD ASSIGNED TO PAGE 3");}
 function createEnvelope(){if(!signer||field?.page!==3)throw new Error("Add a signer and assign the page-3 signature field before creating the envelope.");setEnvelope(true);setStage("ENVELOPE CREATED");}
 useEffect(()=>{let alive=true;(async()=>{if(!pdf||!canvas.current)return;setMetrics(null);setError(null);try{const result=await renderPdfPageToCanvas(pdf,3,canvas.current,{maxWidth:760,maxPixels:4000000});const page=await pdf.getPage(3);const text=await page.getTextContent();const textCharacters=(text.items||[]).reduce((sum,item)=>sum+String(item.str||"").length,0);if(alive){setMetrics({...result,textCharacters,view,retry});setStage(view==="signature"?"SIGNING VIEW — PAGE 3 RENDERED":view==="controlled"?"CONTROLLED DOCUMENT VIEW — PAGE 3 RENDERED":"GATEWAY SIGNING VIEW — PAGE 3 RENDERED");}}catch(e){console.error("Acceptance fixture page render failed",{view,page:3,error:e});if(alive)setError(describePdfPageError(e));}})();return()=>{alive=false}},[pdf,view,retry]);
 const sourceUrl=bytes?URL.createObjectURL(new Blob([bytes],{type:"application/pdf"})):"";
 return <main style={{maxWidth:900,margin:"0 auto",padding:16,fontFamily:"Arial,sans-serif",background:"#fff"}}>
  <h1>Last-page rendering acceptance fixture</h1>
  <p data-testid="stage">{stage}</p>
  <label>Upload controlled PDF <input data-testid="pdf-upload" type="file" accept="application/pdf" onChange={upload}/></label>
  {bytes&&<section><p>Controlled PDF uploaded ({bytes.byteLength} bytes)</p><button onClick={addSigner}>Add Signer</button>{signer&&<p data-testid="signer-added">Authenticated fixture signer added</p>}<button onClick={assignField} disabled={!signer}>Assign signature field to page 3</button>{field&&<p data-testid="page3-field">Page 3 field assigned to {field.signerUid}</p>}<button onClick={createEnvelope} disabled={!field}>Create envelope</button>{envelope&&<p data-testid="envelope-created">Envelope created with page 3 field</p>}<button type="button" data-testid="simulate-render-error" onClick={()=>setError({name:"SimulatedRenderError",message:"Injected PDF.js worker failure"})}>Simulate page render failure</button><nav style={{display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0"}}><button onClick={()=>setView("signature")}>Signature Portal viewer</button><button onClick={()=>setView("controlled")}>Controlled Documents reader</button><button onClick={()=>setView("gateway")}>Gateway signing portal</button></nav></section>}
  <section data-testid="viewer" data-view={view} style={{position:"relative",width:"100%",maxWidth:760,margin:"0 auto",background:"#fff",border:"1px solid #999",minHeight:400}}>
   <canvas ref={canvas} data-testid="page-3-canvas" style={{display:"block",width:"100%",height:"auto"}}/>
   {view==="signature"&&field&&<div data-testid="page-3-signature-overlay" style={{position:"absolute",left:"8%",top:"75%",width:"45%",height:"8%",border:"2px dashed #6d5dfc",background:"transparent",pointerEvents:"auto"}}/>}
   {error&&<div role="alert" style={{position:"absolute",inset:0,zIndex:10,background:"rgba(255,255,255,.97)",color:"#7f1d1d",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:10,padding:16}}><strong>Page 3 could not be displayed: {error.name}: {error.message}</strong><button onClick={()=>setRetry(value=>value+1)}>Retry</button><a href={sourceUrl} target="_blank" rel="noreferrer">Open original file</a></div>}
  </section>
  {metrics&&<pre data-testid="page-metrics">{JSON.stringify(metrics)}</pre>}
  <p><a href={sourceUrl} target="_blank" rel="noreferrer">Open original file</a></p>
 </main>;
}
createRoot(document.getElementById("root")).render(<Harness/>);
