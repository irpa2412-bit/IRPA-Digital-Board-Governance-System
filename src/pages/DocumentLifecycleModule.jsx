import React,{useEffect,useMemo,useState}from"react";
import SignaturePlatform from "./SignaturePlatform";
import DocumentReader from "../components/DocumentReader";
import { listLifecycleDocuments,uploadLifecycleDocument,downloadLifecycleDocument,transitionLifecycleDocument,completeLifecycleSignature,shareLifecycleDocument } from "../firebase/documentLifecycle";

const TYPES=["Governance","Finance","Procurement","Administrative","HR","Research","Project","Other"];
const FORMAT_REQUIREMENTS={
 Governance:[".pdf",".doc",".docx",".ppt",".pptx",".txt",".png",".jpg",".jpeg"],
 Finance:[".pdf",".doc",".docx",".xls",".xlsx",".csv",".txt",".png",".jpg",".jpeg"],
 Procurement:[".pdf",".doc",".docx",".xls",".xlsx",".csv",".txt",".png",".jpg",".jpeg"],
 Administrative:[".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".txt",".csv",".png",".jpg",".jpeg",".webp"],
 HR:[".pdf",".doc",".docx",".xls",".xlsx",".csv",".txt",".png",".jpg",".jpeg"],
 Research:[".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".csv",".txt",".png",".jpg",".jpeg",".webp"],
 Project:[".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".csv",".txt",".png",".jpg",".jpeg",".webp"],
 Other:[".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".odt",".ods",".odp",".rtf",".txt",".csv",".tsv",".md",".html",".xhtml",".epub",".json",".xml",".png",".jpg",".jpeg",".webp",".svg"]
};
const formatAccept=type=>(FORMAT_REQUIREMENTS[type]||FORMAT_REQUIREMENTS.Other).join(",");
const formatLabel=type=>(FORMAT_REQUIREMENTS[type]||FORMAT_REQUIREMENTS.Other).join(", ");
const CATEGORIES=["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents","Administrator Documents"];
const CLASSIFICATIONS=["Public","Internal","Confidential","Restricted"];
const STAGES=["WORKING","PENDING_SIGNATURE","SIGNED","POST_SIGNATURE","FINAL_ARCHIVE"];

function fmt(value){try{return value?new Date(value).toLocaleString():"—"}catch{return String(value||"—")}}
function badge(status){return String(status||"WORKING").replaceAll("_"," ")}
function readStatus(doc){return doc?.status||"WORKING"}

export default function DocumentLifecycleModule({profile,employee,admin=false}){
 const[documents,setDocuments]=useState([]),[selected,setSelected]=useState(null),[tab,setTab]=useState("MY_WORK"),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[reader,setReader]=useState(false),[signing,setSigning]=useState(false),[uploadOpen,setUploadOpen]=useState(false),[shareOpen,setShareOpen]=useState(false),[shareUid,setShareUid]=useState(""),[file,setFile]=useState(null),[title,setTitle]=useState(""),[documentType,setDocumentType]=useState(""),[archiveCategory,setArchiveCategory]=useState("Administrative Documents"),[classification,setClassification]=useState("Internal"),[version,setVersion]=useState("1.0");
 const load=async()=>{setBusy(true);setError("");try{const r=await listLifecycleDocuments();setDocuments(r.documents||[]);if(selected){const fresh=(r.documents||[]).find(x=>x.documentId===selected.documentId);if(fresh)setSelected(fresh)}}catch(e){setError(e.message||"Unable to load the document workspace.")}finally{setBusy(false)}};
 useEffect(()=>{load()},[]);
 const filtered=useMemo(()=>documents.filter(d=>{const s=readStatus(d);if(tab==="MY_WORK")return d.ownerUid===profile?.uid||d.ownerUid===employee?.uid; if(tab==="DEPARTMENT")return d.department&&(d.department===profile?.department||d.department===employee?.department);if(tab==="SHARED")return Array.isArray(d.authorizedUids)&&d.authorizedUids.includes(profile?.uid||employee?.uid);if(tab==="SIGNATURE")return s==="PENDING_SIGNATURE"||s==="SIGNED";if(tab==="POST")return s==="POST_SIGNATURE";if(tab==="FINAL")return s==="FINAL_ARCHIVE";return true}),[documents,tab,profile,employee]);
 const select=doc=>{setSelected(doc);setMessage("");setError("")};
 const action=async(fn,success)=>{setBusy(true);setError("");setMessage("");try{const r=await fn();setMessage(success||"Document workflow updated.");await load();if(r?.documentId){const fresh=(documents||[]).find(d=>d.documentId===r.documentId);if(fresh)setSelected(fresh)}}catch(e){setError(e.message||"Document action failed.")}finally{setBusy(false)}};
 const upload=async e=>{e.preventDefault();if(!file)return;const allowed=FORMAT_REQUIREMENTS[documentType]||FORMAT_REQUIREMENTS.Other;const extension="."+String(file.name||"").split(".").pop().toLowerCase();if(!allowed.includes(extension)){setError("The selected file format does not meet the requirements for "+documentType+". Allowed: "+allowed.join(", "));return;}await action(async()=>{const r=await uploadLifecycleDocument({file,title,documentType,archiveCategory,classification,version});setUploadOpen(false);setFile(null);setTitle("");setDocumentType("");setClassification("Internal");return r},"Document uploaded into the Working Documents archive.");};
 const currentUid=profile?.uid||employee?.uid;
 return <section className="document-lifecycle-module">
  <div className="panel" style={{marginBottom:14}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap",alignItems:"flex-start"}}>
    <div><span className="eyebrow">IRPA DOCUMENT LIFECYCLE</span><h2 style={{margin:"5px 0"}}>Documents Workspace</h2><p className="panel-description" style={{margin:0}}>Upload → work → sign → channel after signature → continue working → final archive. Each document remains under its registered access policy.</p></div>
    <button type="button" onClick={()=>setUploadOpen(v=>!v)}>{uploadOpen?"Close Upload":"Upload Document"}</button>
   </div>
  </div>
  {uploadOpen&&<form className="panel" onSubmit={upload} style={{marginBottom:14}}>
   <div className="form-grid">
    <div className="form-field"><label>Document Title</label><input value={title} onChange={e=>setTitle(e.target.value)} required/></div>
    <div className="form-field"><label>Document Type</label><select value={documentType} onChange={e=>setDocumentType(e.target.value)} required><option value="">Select</option>{TYPES.map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="form-field"><label>Archive Category</label><select value={archiveCategory} onChange={e=>setArchiveCategory(e.target.value)}>{CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="form-field"><label>Classification</label><select value={classification} onChange={e=>setClassification(e.target.value)}>{CLASSIFICATIONS.map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="form-field"><label>Version</label><input value={version} onChange={e=>setVersion(e.target.value)}/></div>
    <div className="form-field"><label>Document File</label><input type="file" accept={formatAccept(documentType)} onChange={e=>setFile(e.target.files?.[0]||null)} required/><small style={{display:"block",marginTop:5,opacity:.78}}>Required format(s) for {documentType||"the selected document type"}: {documentType?formatLabel(documentType):"select a document type first"}</small>{file&&<small style={{display:"block",marginTop:4}}>Selected: {file.name} ({file.type||"format not identified"})</small>}</div>
   </div>
   <div className="form-actions"><button type="submit" disabled={busy||!file}>{busy?"Uploading…":"Upload to Working Archive"}</button></div>
  </form>}
  {message&&<div className="success-message action-feedback" role="status">{message}</div>}{error&&<div className="error-message action-feedback" role="alert">{error}</div>}
  <div className="panel" style={{marginTop:12}}>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>{[["MY_WORK","My Documents"],["DEPARTMENT","Department"],["SHARED","Shared With Me"],["SIGNATURE","Signing"],["POST","Post-Signature Work"],["FINAL","Final Archive"]].map(([id,label])=><button key={id} type="button" className={tab===id?"":"secondary-button"} onClick={()=>setTab(id)}>{label}</button>)}</div>
   <div style={{display:"grid",gridTemplateColumns:"minmax(300px,1.1fr) minmax(360px,1fr)",gap:14}}>
    <div style={{minWidth:0}}>
     <div className="panel-header"><div><strong>{filtered.length} document{filtered.length===1?"":"s"}</strong><small style={{display:"block",marginTop:4}}>{busy?"Refreshing…":"Controlled results for the selected workspace."}</small></div><button type="button" className="secondary-button" onClick={load}>Refresh</button></div>
     <div style={{display:"grid",gap:8}}>{filtered.map(doc=><button key={doc.documentId} type="button" onClick={()=>select(doc)} style={{textAlign:"left",padding:12,borderRadius:10,border:selected?.documentId===doc.documentId?"2px solid rgba(109,93,252,.8)":"1px solid rgba(148,163,184,.25)",background:"transparent",color:"inherit"}}>
       <strong>{doc.title||doc.fileName}</strong><small style={{display:"block",marginTop:5}}>{doc.reference} · {badge(doc.status)} · {doc.classification}</small><small style={{display:"block",marginTop:3,opacity:.78}}>{doc.department||"Institutional"} · updated {fmt(doc.updatedAt)}</small>
     </button>)}{!filtered.length&&<div className="auth-message">No documents are visible in this workspace under the current authorization policy.</div>}</div>
    </div>
    <div>
     {!selected?<div className="auth-message"><strong>Select a document.</strong><div style={{marginTop:5}}>The workflow actions will appear only after an authorized document is selected.</div></div>:<div className="panel" style={{margin:0}}>
      <span className="eyebrow">DOCUMENT CONTROL</span><h3 style={{margin:"5px 0"}}>{selected.title}</h3><p className="muted" style={{marginTop:0}}>{selected.reference} · {selected.fileName}</p>
      <dl style={{display:"grid",gridTemplateColumns:"max-content 1fr",gap:"6px 12px",fontSize:13}}><dt>Stage</dt><dd>{badge(selected.status)}</dd><dt>Classification</dt><dd>{selected.classification}</dd><dt>Owner</dt><dd>{selected.ownerUid}</dd><dt>SHA-256</dt><dd style={{wordBreak:"break-all"}}>{selected.sha256||"—"}</dd><dt>Uploaded</dt><dd>{fmt(selected.uploadedAt)}</dd></dl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
       <button type="button" onClick={()=>setReader(true)}>Open Document</button>
       {selected.status==="WORKING"&&<button type="button" onClick={()=>action(()=>transitionLifecycleDocument(selected.documentId,"PENDING_SIGNATURE"),"Document moved to Pending Signature.")}>Send to Signature</button>}
       {selected.status==="PENDING_SIGNATURE"&&<button type="button" onClick={()=>setSigning(true)}>Open Signing Workspace</button>}
       {selected.status==="SIGNED"&&<button type="button" onClick={()=>action(()=>transitionLifecycleDocument(selected.documentId,"POST_SIGNATURE"),"Signed document channel opened for post-signature work.")}>Channel After Signature</button>}
       {selected.status==="POST_SIGNATURE"&&<button type="button" onClick={()=>action(()=>transitionLifecycleDocument(selected.documentId,"FINAL_ARCHIVE",{sourceFileId:selected.signedSourceFileId||selected.signedArchiveFileId||selected.fileId}),"Document moved to the Final Archive.")}>Final Archive</button>}
       <button type="button" className="secondary-button" onClick={()=>setShareOpen(v=>!v)}>Share</button>
      </div>
      {shareOpen&&<div className="auth-message" style={{marginTop:12}}><label>Authorized user UID</label><input value={shareUid} onChange={e=>setShareUid(e.target.value)} placeholder="Firebase UID"/><button type="button" disabled={!shareUid} onClick={()=>action(()=>shareLifecycleDocument(selected.documentId,shareUid),"Document access granted to the selected user.")}>Grant Access</button></div>}
      {selected.status==="PENDING_SIGNATURE"&&selected.signatureEnvelopeId&&<div className="auth-message" style={{marginTop:12}}><strong>Signature envelope registered.</strong><button type="button" onClick={()=>action(()=>completeLifecycleSignature(selected.documentId,selected.signatureEnvelopeId),"Completed signature verified and document marked Signed.")}>Verify Completed Signature</button></div>}
     </div>}
    </div>
   </div>
  </div>
  {reader&&selected&&<DocumentReader document={{...selected,id:selected.documentId}} onClose={()=>setReader(false)}/>}
  {signing&&selected&&<div className="panel" style={{marginTop:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><span className="eyebrow">SIGNATURE WORKSPACE</span><h3 style={{margin:"5px 0"}}>{selected.title}</h3></div><button type="button" className="secondary-button" onClick={()=>setSigning(false)}>Close Signing Workspace</button></div><SignaturePlatform initialDocument={{...selected,id:selected.documentId}}/></div>}
 </section>;
}
