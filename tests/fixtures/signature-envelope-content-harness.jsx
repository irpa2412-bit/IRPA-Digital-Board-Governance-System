import React,{useEffect,useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import*as pdfjsLib from"pdfjs-dist";
import pdfWorker from"pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;
const AUTH_UID="fixture-authenticated-signer";
function Harness(){
 const canvasRef=useRef(null);
 const [bytes,setBytes]=useState(null),[pdf,setPdf]=useState(null),[pageText,setPageText]=useState(""),[sourceHash,setSourceHash]=useState(""),[stage,setStage]=useState("WAITING FOR CONTROLLED PDF"),[signerAdded,setSignerAdded]=useState(false),[field,setField]=useState(null),[envelope,setEnvelope]=useState(false),[signingView,setSigningView]=useState(false),[rendered,setRendered]=useState(false),[error,setError]=useState("");
 async function upload(event){
  try{
   const file=event.target.files?.[0];
   if(!file||file.type!=="application/pdf")throw new Error("Select a PDF controlled document.");
   const raw=new Uint8Array(await file.arrayBuffer());
   const digest=await crypto.subtle.digest("SHA-256",raw.slice().buffer);
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
   const loaded=await pdfjsLib.getDocument({data:raw.slice()}).promise;
   if(loaded.numPages!==3)throw new Error("The controlled source PDF must contain exactly three pages.");
   const page=await loaded.getPage(3);
   const content=await page.getTextContent();
   setBytes(raw);setPdf(loaded);setPageText(content.items.map(item=>item.str).join(" "));setSourceHash(hash);setStage("CONTROLLED PDF UPLOADED");setError("");
  }catch(e){setError(e.message||String(e));}
 }
 async function saveDraft(step,recipientsOverride,fieldOverride){
  const recipients=recipientsOverride??(signerAdded?[{uid:AUTH_UID,email:"signer@irpa.test",role:"Review"}]:[]);
  const assignedField=fieldOverride===undefined?field:fieldOverride;
  const response=await fetch("/__mock_gateway__/api/signature-workflow/draft",{method:"POST",headers:{Authorization:"Bearer fixture-authenticated-token","Content-Type":"application/json"},body:JSON.stringify({step,draft:{documentId:"controlled-document-3-page",documentUrl:"mock://controlled-document/source.pdf",sha256:sourceHash,byteLength:bytes?.byteLength||0,recipients,fields:assignedField?[assignedField]:[]}})});
  const result=await response.json();
  if(!response.ok||result.ok!==true)throw new Error(result.error||"Mock Gateway draft save failed.");
  return result.draft;
 }
 async function addSigner(){
  try{await saveDraft("add-signer",[{uid:AUTH_UID,email:"signer@irpa.test",role:"Review"}],null);setSignerAdded(true);setStage("SIGNER ADDED");setError("");}
  catch(e){setError(e.message||String(e));}
 }
 function assignField(){
  const selectedPage=Number(document.querySelector("[data-testid=field-page]")?.value||1);
  setField({fieldId:"fixture-signature-page-3",type:"Signature",page:selectedPage,signerUid:AUTH_UID,x:10,y:18,width:80,height:14});
  setStage("PAGE "+selectedPage+" FIELD ASSIGNED");
 }
 async function createEnvelope(){
  try{
   if(!signerAdded||!field||field.page!==3||field.signerUid!==AUTH_UID)throw new Error("Assign the page-3 signature field to the authenticated signer before creating the envelope.");
   await saveDraft("finalize-envelope");setEnvelope(true);setStage("ENVELOPE CREATED");setError("");
  }catch(e){setError(e.message||String(e));}
 }
 useEffect(()=>{let cancelled=false;(async()=>{
  if(!pdf||!canvasRef.current)return;
  setRendered(false);
  try{const page=await pdf.getPage(3),viewport=page.getViewport({scale:1}),canvas=canvasRef.current;canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);canvas.style.width="100%";canvas.style.height="auto";await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;if(!cancelled)setRendered(true);}
  catch(e){if(!cancelled)setError(e.message||String(e));}
 })();return()=>{cancelled=true}},[pdf,signingView]);
 const originalBase64=bytes?btoa(Array.from(bytes,b=>String.fromCharCode(b)).join("")):"";
 return <main style={{maxWidth:900,margin:"0 auto",background:"#fff",padding:16,borderRadius:12,fontFamily:"Arial,sans-serif"}}>
  <h1>Signature Portal · authenticated Add Signer acceptance fixture</h1>
  <p data-testid="authenticated-user">Authenticated signer UID: {AUTH_UID}</p>
  <p data-testid="stage">Stage: {stage}</p>
  <label htmlFor="controlled-pdf-upload">Upload controlled PDF</label>
  <input id="controlled-pdf-upload" data-testid="controlled-pdf-upload" type="file" accept="application/pdf" onChange={upload}/>
  {bytes&&<section>
   <p>Source SHA-256: <output data-testid="source-hash">{sourceHash}</output></p>
   <p>Source byte length: <output data-testid="source-byte-length">{bytes.byteLength}</output></p>
   {!signerAdded&&<button type="button" onClick={addSigner}>Add Signer</button>}
   {signerAdded&&<p data-testid="signer-added">Signer assigned: signer@irpa.test</p>}
   {signerAdded&&<div><label htmlFor="field-page">Signature field page</label><select id="field-page" data-testid="field-page" defaultValue="3"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select><button type="button" onClick={assignField}>Assign Signature Field to Page 3</button></div>}
   {field&&<p data-testid="field-assignment">Signature field assigned to page {field.page} for {field.signerUid}</p>}
   {field&&!envelope&&<button type="button" onClick={createEnvelope}>Create envelope</button>}
   {envelope&&!signingView&&<button type="button" onClick={()=>{setSigningView(true);setStage("SIGNING VIEW");}}>Open signing view as assigned signer</button>}
  </section>}
  {error&&<p role="alert">{error}</p>}
  {pdf&&<div data-testid="pdf-page" data-page="3" style={{position:"relative",maxWidth:595,margin:"16px auto",background:"#fff",boxShadow:"0 2px 12px #0002",overflow:"hidden"}}>
   <canvas ref={canvasRef} data-testid="pdf-page-3-canvas" data-rendered={rendered?"true":"false"} aria-label="Rendered page 3 PDF" style={{display:"block",width:"100%"}}/>
   {signingView&&field&&field.page===3&&field.signerUid===AUTH_UID&&<button type="button" data-testid="signature-field-overlay" aria-label="Assigned signature field on page 3" style={{position:"absolute",left:"5%",top:"20%",width:"90%",height:"38%",boxSizing:"border-box",border:"2px dashed #6d5dfc",background:"transparent",borderRadius:5,zIndex:5,pointerEvents:"auto",color:"#4c3fc7",fontWeight:700}}>TAP TO SIGN · PAGE 3</button>}
  </div>}
  <output data-testid="original-pdf-base64" style={{display:"none"}}>{originalBase64}</output>
  <output data-testid="page3-text">{pageText}</output>
 </main>;
}
createRoot(document.getElementById("root")).render(<Harness/>);
