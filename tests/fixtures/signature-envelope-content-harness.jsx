import React,{useEffect,useRef,useState} from "react";
import{createRoot}from"react-dom/client";
import{PDFDocument,StandardFonts,rgb}from"pdf-lib";
import*as pdfjsLib from"pdfjs-dist";
import pdfWorker from"pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;
async function makeSourcePdf(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 for(let i=1;i<=3;i++){
  const page=doc.addPage([595.28,841.89]);
  page.drawText("IRPA CONTROLLED DOCUMENT",{x:54,y:790,size:17,font:bold,color:rgb(.12,.18,.28)});
  page.drawText("Improvement of Rangeland in Pastoral Areas",{x:54,y:766,size:10,font,color:rgb(.35,.38,.42)});
  page.drawText("CONFIDENTIAL • GOVERNANCE DOCUMENT",{x:54,y:735,size:8,font,color:rgb(.55,.57,.6)});
  for(let n=0;n<8;n++)page.drawText("PAGE "+i+" BODY CONTENT LINE "+(n+1)+" — This paragraph must remain visible after envelope creation.",{x:60,y:625-n*34,size:10,font,color:rgb(.05,.05,.05)});
  page.drawText("Faint watermark",{x:170,y:390,size:38,font:bold,color:rgb(.91,.92,.94),rotate:{type:"degrees",angle:35}});
  page.drawText("Page "+i+" of 3",{x:500,y:28,size:8,font,color:rgb(.45,.45,.45)});
 }
 return new Uint8Array(await doc.save());
}
function Harness(){
 const canvasRef=useRef(null),[bytes,setBytes]=useState(null),[pdf,setPdf]=useState(null),[textBefore,setTextBefore]=useState([]),[textAfter,setTextAfter]=useState([]),[hashBefore,setHashBefore]=useState(""),[hashAfter,setHashAfter]=useState(""),[stage,setStage]=useState("DRAFT"),[error,setError]=useState(""),[rendered,setRendered]=useState(false);
 useEffect(()=>{let dead=false;(async()=>{try{const source=await makeSourcePdf();const sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",source)),b=>b.toString(16).padStart(2,"0")).join("");const loaded=await pdfjsLib.getDocument({data:new Uint8Array(source)}).promise;const extracted=[];for(let p=1;p<=loaded.numPages;p++){const page=await loaded.getPage(p);const content=await page.getTextContent();extracted.push(content.items.map(item=>item.str).join(" "));}if(!dead){setBytes(source);setPdf(loaded);setTextBefore(extracted);setHashBefore(sourceHash);}}catch(e){if(!dead)setError(e.message||String(e));}})();return()=>{dead=true}},[]);
 useEffect(()=>{let dead=false;(async()=>{if(!pdf||!canvasRef.current)return;setRendered(false);try{const page=await pdf.getPage(3),viewport=page.getViewport({scale:1});const canvas=canvasRef.current;canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);canvas.style.width="100%";canvas.style.height="auto";await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;if(!dead)setRendered(true);}catch(e){if(!dead)setError(e.message||String(e));}})();return()=>{dead=true}},[pdf,stage]);
 const createEnvelope=async()=>{if(!bytes||!pdf)return;try{const sameBytes=new Uint8Array(bytes);const afterHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",sameBytes)),b=>b.toString(16).padStart(2,"0")).join("");const next=await pdfjsLib.getDocument({data:sameBytes}).promise;const extracted=[];for(let p=1;p<=next.numPages;p++){const page=await next.getPage(p);const content=await page.getTextContent();extracted.push(content.items.map(item=>item.str).join(" "));}setTextAfter(extracted);setHashAfter(afterHash);setPdf(next);setStage("ENVELOPE");}catch(e){setError(e.message||String(e));}};
 return <main style={{maxWidth:900,margin:"0 auto",background:"#fff",padding:16,borderRadius:12}}>
  <h1>Signature Portal · PDF envelope content regression</h1><p>Fixture document: 3 pages, body text on every page, signature field assigned to page 3.</p>
  <p data-testid="stage">Stage: {stage}</p>{error&&<p role="alert">{error}</p>}
  <button type="button" onClick={createEnvelope} disabled={!bytes||stage==="ENVELOPE"}>Create envelope</button>
  <div data-testid="pdf-page" data-page="3" style={{position:"relative",maxWidth:595,margin:"16px auto",background:"#fff",boxShadow:"0 2px 12px #0002",overflow:"hidden"}}>
   <canvas ref={canvasRef} data-rendered={rendered?"true":"false"} aria-label="Rendered page 3 PDF" style={{display:"block",width:"100%"}}/>
   {stage==="ENVELOPE"&&<div data-testid="signature-field-overlay" aria-label="Signature field on page 3" style={{position:"absolute",left:"5%",top:"20%",width:"90%",height:"42%",boxSizing:"border-box",border:"2px solid #6d5dfc",background:"transparent",borderRadius:5,zIndex:5,pointerEvents:"none"}}/>}
  </div>
  <output data-testid="hash-before">{hashBefore}</output><output data-testid="hash-after">{hashAfter}</output><pre data-testid="text-before" style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(textBefore)}</pre><pre data-testid="text-after" style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(textAfter)}</pre>
 </main>;
}
createRoot(document.getElementById("root")).render(<Harness/>);