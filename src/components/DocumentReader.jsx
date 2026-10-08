import React,{useEffect,useRef,useState}from"react";
import{downloadDriveBytes}from"../firebase/signatureStorage";
import*as pdfjsLib from"pdfjs-dist";
import mammoth from"mammoth";import DOMPurify from"dompurify";
import*as XLSX from"xlsx";
import{PPTXViewer}from"pptx-viewer";

pdfjsLib.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.mjs",import.meta.url).toString();

const EXT_MIME={pdf:"application/pdf",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",ods:"application/vnd.oasis.opendocument.spreadsheet",csv:"text/csv",tsv:"text/tab-separated-values",ppt:"application/vnd.ms-powerpoint",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",odp:"application/vnd.oasis.opendocument.presentation",odt:"application/vnd.oasis.opendocument.text",rtf:"application/rtf",txt:"text/plain",md:"text/markdown",html:"text/html",xml:"application/xml",json:"application/json",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",svg:"image/svg+xml",epub:"application/epub+zip"};
function ext(name=""){return String(name).split(".").pop().toLowerCase()}
function mime(name,type){return String(type||EXT_MIME[ext(name)]||"application/octet-stream").toLowerCase()}
function downloadBlob(bytes,type,name){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement("a");a.href=url;a.download=name||"document";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function ReaderText({bytes,type}){
 const[html,setHtml]=useState("");const[text,setText]=useState("");
 useEffect(()=>{let alive=true;(async()=>{try{if(type.includes("html"))setHtml(new TextDecoder().decode(bytes));else setText(new TextDecoder().decode(bytes));}catch(e){if(alive)setText(e.message)}})();return()=>{alive=false}},[bytes,type]);
 return html?<iframe title="HTML document" sandbox="" srcDoc={html} style={{width:"100%",minHeight:650,border:0,background:"var(--surface)"}}/>:<pre style={{whiteSpace:"pre-wrap",wordBreak:"break-word",background:"var(--surface)",color:"var(--text)",padding:24,minHeight:650,overflow:"auto"}}>{text}</pre>
}
function SheetReader({bytes}){const[book,setBook]=useState(null);useEffect(()=>{try{setBook(XLSX.read(bytes,{type:"array",cellDates:true}));}catch(e){setBook({error:e.message})}},[bytes]);if(!book)return <div>Loading spreadsheet…</div>;if(book.error)return <div className="error-message">{book.error}</div>;return <div style={{overflow:"auto",background:"var(--surface)",padding:12}}>{book.SheetNames.map(n=>{const rows=XLSX.utils.sheet_to_json(book.Sheets[n],{header:1,defval:""});return <section key={n} style={{marginBottom:24}}><h3 style={{color:"var(--text)"}}>{n}</h3><table style={{borderCollapse:"collapse",width:"100%",color:"var(--text)"}}><tbody>{rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} style={{border:"1px solid var(--border)",padding:"6px 8px",verticalAlign:"top"}}>{String(v??"")}</td>)}</tr>)}</tbody></table></section>})}</div>}
function PdfReader({bytes}){const ref=useRef(null);const[pdf,setPdf]=useState(null);const[page,setPage]=useState(1);useEffect(()=>{let alive=true;pdfjsLib.getDocument({data:bytes}).promise.then(x=>alive&&setPdf(x)).catch(()=>{});return()=>{alive=false}},[bytes]);useEffect(()=>{if(!pdf||!ref.current)return;pdf.getPage(page).then(p=>{const viewport=p.getViewport({scale:1.25});const canvas=ref.current;canvas.width=viewport.width;canvas.height=viewport.height;p.render({canvasContext:canvas.getContext("2d"),viewport})})},[pdf,page]);if(!pdf)return <div>Loading PDF…</div>;return <div><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {pdf.numPages}</span><button type="button" disabled={page>=pdf.numPages} onClick={()=>setPage(p=>p+1)}>Next</button></div><div style={{overflow:"auto",background:"var(--surface)",padding:16,textAlign:"center"}}><canvas ref={ref}/></div></div>}
export default function DocumentReader({document:doc,onClose}){
 const[bytes,setBytes]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(true);const host=useRef(null);
 const name=doc?.fileName||doc?.title||"IRPA document";const type=mime(name,doc?.contentType);const e=ext(name);
 useEffect(()=>{let alive=true;(async()=>{try{if(!doc?.fileId)throw new Error("This document has no readable Google Drive file reference.");const b=await downloadDriveBytes(doc.fileId,doc.id||null);if(alive)setBytes(b);}catch(x){if(alive)setError(x.message||"Unable to retrieve document.");}finally{if(alive)setBusy(false)}})();return()=>{alive=false}},[doc]);
 useEffect(()=>{if(!bytes||e!=="pptx"||!host.current)return;let viewer;try{viewer=new PPTXViewer(host.current);viewer.load(new Blob([bytes],{type}));}catch(x){setError(x.message||"PowerPoint reader could not open this file.");}return()=>{try{viewer?.destroy?.()}catch{}}},[bytes,e,type]);
 function save(){if(bytes)downloadBlob(bytes,type,name)}
 let body=null;
 if(error)body=<div className="error-message">{error}<div style={{marginTop:12}}><button type="button" onClick={save} disabled={!bytes}>Download Original</button></div></div>;
 else if(busy)body=<div className="panel"><strong>IRPA Document Reader</strong><p>Retrieving the document securely from the controlled archive…</p></div>;
 else if(e==="pdf")body=<PdfReader bytes={bytes}/>;
 else if(["xlsx","xls","ods","csv","tsv"].includes(e))body=<SheetReader bytes={bytes}/>;
 else if(e==="docx"){body=<DocxReader bytes={bytes}/>;}
 else if(e==="pptx")body=<div ref={host} style={{minHeight:650,background:"var(--surface)"}}/>;
 else if(["txt","md","xml","json","html"].includes(e)||type.startsWith("text/"))body=<ReaderText bytes={bytes} type={type}/>;
 else if(["jpg","jpeg","png","webp","svg"].includes(e)){const src=URL.createObjectURL(new Blob([bytes],{type}));body=<img src={src} alt={name} style={{maxWidth:"100%",maxHeight:"75vh",display:"block",margin:"auto",background:"var(--surface)"}}/>;}
 else body=<div className="panel"><strong>IRPA Reader compatibility fallback</strong><p>The original {e.toUpperCase()||"document"} is securely retrieved. This format is retained without conversion so its native structure is preserved.</p><button type="button" onClick={save}>Open / Download Original</button></div>;
 return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`IRPA Document Reader — ${name}`}><div className="modal" style={{maxWidth:1100,width:"96%",maxHeight:"92vh",overflow:"auto"}}><div className="panel-header"><div><span className="eyebrow">IRPA DOCUMENT READER</span><h2>{name}</h2><p className="panel-description">{type} · native archive file · no conversion of the stored original</p></div><div style={{display:"flex",gap:8}}><button type="button" onClick={save} disabled={!bytes}>Download Original</button><button type="button" onClick={onClose}>Close</button></div></div>{body}</div></div>
}
function DocxReader({bytes}){const[html,setHtml]=useState("");const[error,setError]=useState("");useEffect(()=>{mammoth.convertToHtml({arrayBuffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}).then(r=>setHtml(r.value)).catch(e=>setError(e.message||"DOCX reader failed."))},[bytes]);if(error)return <div className="error-message">{error}</div>;return <article style={{background:"var(--surface)",color:"var(--text)",padding:"40px 48px",minHeight:650,lineHeight:1.6}} dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(html)}}/>}
