import React,{useMemo,useState} from "react";
import { listLifecycleDocuments, downloadLifecycleDocument } from "../firebase/documentLifecycle";

const ARCHIVES=["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents","Administrator Documents"];
const CLASSIFICATIONS=["Public","Internal","Confidential","Restricted"];
const STAGES=[
  ["WORKING","Working Documents"],
  ["PENDING_SIGNATURE","Pending Signature"],
  ["SIGNED","Signed Documents"],
  ["POST_SIGNATURE","Post-Signature Working"],
  ["FINAL_ARCHIVE","Final Archive"]
];

function readableDate(value){
  if(!value)return "—";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleString();
}

export default function DocumentRetrievalAccessPoint(){
  const [open,setOpen]=useState(false);
  const [environment,setEnvironment]=useState(()=>{try{return sessionStorage.getItem("irpaDataEnvironment")||""}catch{return ""}});
  const [confirmActual,setConfirmActual]=useState(false);
  const [documents,setDocuments]=useState([]);
  const [archive,setArchive]=useState("ALL");
  const [classification,setClassification]=useState("ALL");
  const [stage,setStage]=useState("ALL");
  const [search,setSearch]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function refresh(){
    setBusy(true);setError("");setMessage("");
    try{
      const result=await listLifecycleDocuments();
      setDocuments(Array.isArray(result.documents)?result.documents:[]);
      setMessage("Archive register refreshed. Only records authorized for this registered profile are listed.");
    }catch(e){
      setError(e?.message||"The controlled document archive could not be retrieved.");
    }finally{setBusy(false);}
  }

  async function selectEnvironment(value){
    if(value==="ACTUAL"&&!confirmActual)return;
    try{
      sessionStorage.setItem("irpaDataEnvironment",value);
      sessionStorage.setItem("irpaDataEnvironmentTarget","Document Retrieval");
      sessionStorage.setItem("irpaDataEnvironmentSelectedAt",new Date().toISOString());
    }catch{}
    setEnvironment(value);
    await refresh();
  }

  async function retrieve(document){
    setBusy(true);setError("");setMessage("");
    try{
      if(!document?.documentId||!document?.fileId)throw new Error("The archive record is missing its registered document or file identifier.");
      const result=await downloadLifecycleDocument(document.documentId,document.fileId);
      if(!result?.bytes?.length)throw new Error("The authorized archive returned no document content.");
      const blob=new Blob([result.bytes],{type:result.contentType||"application/octet-stream"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;
      link.download=result.fileName||document.fileName||document.title||"IRPA-archived-document";
      link.style.display="none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1500);
      setMessage("Document retrieved. The server verified the registered archive file and SHA-256 integrity before returning it.");
    }catch(e){setError(e?.message||"Document retrieval failed. Access may be restricted by your registered authority.");}
    finally{setBusy(false);}
  }

  const visible=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return documents.filter(item=>{
      if(archive!=="ALL"&&item.archiveCategory!==archive)return false;
      if(classification!=="ALL"&&item.classification!==classification)return false;
      if(stage!=="ALL"&&(item.status||"WORKING")!==stage)return false;
      if(q&&![
        item.title,item.fileName,item.reference,item.documentId,item.documentType,item.archivePath
      ].some(value=>String(value||"").toLowerCase().includes(q)))return false;
      return true;
    }).sort((a,b)=>String(b.updatedAt||b.uploadedAt||"").localeCompare(String(a.updatedAt||a.uploadedAt||"")));
  },[documents,archive,classification,stage,search]);

  return <section className="document-retrieval-access-point" aria-label="Controlled document archive retrieval" style={{marginBottom:14}}>
    <div className="panel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div style={{minWidth:0,flex:"1 1 260px"}}>
        <span className="eyebrow">REGISTERED PROFILE · CONTROLLED ACCESS</span>
        <h3 style={{margin:"4px 0"}}>Documents Retrieval</h3>
        <p className="panel-description" style={{margin:0}}>Select an archive category and retrieve an authorized document. Access is checked against your active IRPA profile and the document's registered classification, owner, department and role permissions.</p>
      </div>
      <button type="button" className={open?"secondary-button":""} onClick={()=>{const next=!open;setOpen(next);if(next&&environment)refresh();}} aria-expanded={open}>
        {open?"Close Documents Retrieval":"Retrieve Archived Documents"}
      </button>
    </div>
    {open&&<div className="panel" style={{marginTop:10}}>
      {!environment&&<div className="auth-message" style={{marginBottom:12}}>
        <strong>Select the data environment</strong>
        <p style={{margin:"6px 0 12px"}}>Document retrieval uses the selected IRPA data environment. Your registered profile permissions remain in force in either environment.</p>
        <div className="form-grid">
          <button type="button" className="secondary-button" onClick={()=>{setConfirmActual(false);selectEnvironment("TRIAL")}} disabled={busy}>Use Trial / Test Archives</button>
          <button type="button" className="secondary-button" onClick={()=>setConfirmActual(true)} disabled={busy}>Select Actual Institutional Records</button>
        </div>
        {confirmActual&&<div style={{marginTop:12}}>
          <label style={{display:"flex",alignItems:"flex-start",gap:9,lineHeight:1.5}}>
            <input type="checkbox" checked={false} onChange={()=>selectEnvironment("ACTUAL")} disabled={busy}/>
            <span>I understand that this retrieves actual IRPA institutional records, subject to my registered access authority.</span>
          </label>
          <button type="button" onClick={()=>selectEnvironment("ACTUAL")} disabled={busy} style={{marginTop:10}}>Confirm Actual Records</button>
        </div>}
      </div>}
      {environment&&<div className="auth-message" style={{marginBottom:12}}>
        <strong>Environment: {environment==="TRIAL"?"Trial / Test":"Actual Institutional Records"}</strong>
        <div style={{marginTop:5}}>The server returns only records authorized for the authenticated, active profile. Download requests are independently re-authorized and SHA-256 checked.</div>
        <button type="button" className="secondary-button" style={{marginTop:10}} onClick={()=>{setEnvironment("");setDocuments([]);setMessage("");setError("");setConfirmActual(false);}} disabled={busy}>Change Environment</button>
      </div>}
      {environment&&<div className="form-grid" style={{marginBottom:12}}>
        <div className="form-field"><label htmlFor="irpa-retrieval-archive">Archive Category</label><select id="irpa-retrieval-archive" value={archive} onChange={e=>setArchive(e.target.value)}><option value="ALL">All authorized archives</option>{ARCHIVES.map(x=><option key={x} value={x}>{x}</option>)}</select></div>
        <div className="form-field"><label htmlFor="irpa-retrieval-classification">Classification</label><select id="irpa-retrieval-classification" value={classification} onChange={e=>setClassification(e.target.value)}><option value="ALL">All authorized classifications</option>{CLASSIFICATIONS.map(x=><option key={x} value={x}>{x}</option>)}</select></div>
        <div className="form-field"><label htmlFor="irpa-retrieval-stage">Archive Stage</label><select id="irpa-retrieval-stage" value={stage} onChange={e=>setStage(e.target.value)}><option value="ALL">All stages</option>{STAGES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
        <div className="form-field"><label htmlFor="irpa-retrieval-search">Search archive register</label><input id="irpa-retrieval-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title, reference, type or ID"/></div>
      </div>}
      {message&&<div className="success-message action-feedback" role="status" style={{marginBottom:10}}>{message}</div>}
      {error&&<div className="error-message action-feedback" role="alert" style={{marginBottom:10}}>{error}</div>}
      {environment&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
          <strong>{visible.length} authorized archive record{visible.length===1?"":"s"}</strong>
          <button type="button" className="secondary-button" onClick={refresh} disabled={busy}>{busy?"Working…":"Refresh Archives"}</button>
        </div>
        {visible.length===0?<div className="auth-message">No records match this selection, or no documents are visible to this profile under the current authority policy.</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:10}}>
          {visible.map(item=><article key={item.documentId} className="panel" style={{margin:0,minWidth:0,border:"1px solid var(--border-color, rgba(148,163,184,.35))"}}>
            <strong style={{display:"block",overflowWrap:"anywhere"}}>{item.title||item.fileName||"Untitled document"}</strong>
            <p style={{margin:"6px 0",overflowWrap:"anywhere"}}>{item.reference||item.documentId}</p>
            <dl style={{display:"grid",gridTemplateColumns:"max-content minmax(0,1fr)",gap:"4px 9px",fontSize:13,margin:"8px 0 12px"}}>
              <dt>Archive</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{item.archiveCategory||"—"}</dd>
              <dt>Classification</dt><dd style={{margin:0}}>{item.classification||"—"}</dd>
              <dt>Stage</dt><dd style={{margin:0}}>{STAGES.find(([value])=>value===(item.status||"WORKING"))?.[1]||item.status||"Working Documents"}</dd>
              <dt>Updated</dt><dd style={{margin:0}}>{readableDate(item.updatedAt||item.uploadedAt)}</dd>
              <dt>SHA-256</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{item.sha256||"Not recorded"}</dd>
            </dl>
            <button type="button" onClick={()=>retrieve(item)} disabled={busy||!item.fileId||!item.documentId}>{busy?"Retrieving…":"Retrieve Document"}</button>
          </article>)}
        </div>}
      </div>}
    </div>}
  </section>;
}
