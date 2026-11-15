import React,{useEffect,useMemo,useState} from "react";
import {listLifecycleDocuments,uploadLifecycleDocument,downloadLifecycleDocument} from "../firebase/documentLifecycle";

const MANDATORY_POLICIES=[
 "IRPA Constitution",
 "Procurement Policy",
 "Staff Rules and Regulations",
 "Code of Conduct",
 "Safeguarding Policy",
 "Anti-Corruption and Anti-Fraud Policy",
 "Ethics Policy",
 "Financial Management and Accounting Policy",
 "Human Resources and Personnel Management Policy",
 "Conflict of Interest Policy",
 "Whistleblowing and Complaints Handling Policy",
 "Information Security, Data Protection and Privacy Policy",
 "Records Management and Document Retention Policy",
 "Monitoring, Evaluation, Accountability and Learning (MEAL) Policy",
 "Risk Management and Internal Controls Policy",
 "Gender Equality, Inclusion and Non-Discrimination Policy"
];
const MAX_FILE_BYTES=10*1024*1024;
const ACCEPT=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.tsv,.md,.png,.jpg,.jpeg,.webp";
const OTHER_TITLE="__OTHER__";
const STRATEGIC_PLAN_OPTIONS=["IRPA Strategic Plan","Annual Operational Plan","Departmental Strategic Plan","Programme Strategic Plan"];
const clean=value=>String(value||"").trim();
const readableDate=value=>{if(!value)return "—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleDateString();};
const normalize=value=>clean(value).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

function downloadFile(result,record){
 const blob=new Blob([result.bytes],{type:result.contentType||"application/octet-stream"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;
 link.download=result.fileName||record.fileName||record.title||"IRPA-governance-document";
 link.style.display="none";
 document.body.appendChild(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}

export default function PoliciesStrategicPlanPortal({profile,employee,admin=false}){
 const [documents,setDocuments]=useState([]);
 const [section,setSection]=useState("POLICIES");
 const [uploadOpen,setUploadOpen]=useState(false);
 const [kind,setKind]=useState("Policy");
 const [title,setTitle]=useState("");
 const [customTitle,setCustomTitle]=useState("");
 const [version,setVersion]=useState("1.0");
 const [file,setFile]=useState(null);
 const [search,setSearch]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const uid=profile?.uid||employee?.uid;

 async function refresh(){
  setBusy(true);setError("");setMessage("");
  try{
   const result=await listLifecycleDocuments();
   const records=Array.isArray(result?.documents)?result.documents:[];
   setDocuments(records.filter(item=>item.archiveCategory==="Governance Documents"&&["Policy","Strategic Plan"].includes(item.documentType)));
   setMessage("The authorised governance document register has been refreshed.");
  }catch(e){setError(e?.message||"Unable to retrieve the Policies and Strategic Plan register.");}
  finally{setBusy(false);}
 }
 useEffect(()=>{refresh();},[]);

 const visible=useMemo(()=>{
  const q=normalize(search);
  return documents.filter(item=>{
   if(section==="POLICIES"&&item.documentType!=="Policy")return false;
   if(section==="PLANS"&&item.documentType!=="Strategic Plan")return false;
   if(section==="OTHER"&&item.documentType!=="Policy"&&item.documentType!=="Strategic Plan")return false;
   return !q||[item.title,item.fileName,item.version,item.reference].some(value=>normalize(value).includes(q));
  }).sort((a,b)=>String(b.updatedAt||b.uploadedAt||"").localeCompare(String(a.updatedAt||a.uploadedAt||"")));
 },[documents,section,search]);

 const policyStatus=useMemo(()=>MANDATORY_POLICIES.map(name=>{
  const target=normalize(name);
  const record=documents.find(item=>item.documentType==="Policy"&&normalize(item.title)===target);
  return {name,record:record||null};
 }),[documents]);

 async function submitUpload(event){
  event.preventDefault();setError("");setMessage("");
  if(!file){setError("Select a document to upload.");return;}
  if(file.size>MAX_FILE_BYTES){setError("The selected file exceeds the 10 MB portal limit.");return;}
  const selectedTitle=title===OTHER_TITLE?clean(customTitle):clean(title);
  if(!selectedTitle){setError(title===OTHER_TITLE?"Enter the document title.":"Select a document name from the list.");return;}
  setBusy(true);
  try{
   await uploadLifecycleDocument({file,title:selectedTitle,documentType:kind,archiveCategory:"Governance Documents",classification:"Internal",version:clean(version)||"1.0"});
   setFile(null);setTitle("");setCustomTitle("");setVersion("1.0");setUploadOpen(false);
   await refresh();
   setMessage("Document uploaded to the IRPA Governance Documents archive as a working record. Upload does not itself constitute approval or publication.");
  }catch(e){setError(e?.message||"The document upload failed.");}
  finally{setBusy(false);}
 }

 async function retrieve(record){
  setBusy(true);setError("");setMessage("");
  try{
   if(!record?.documentId||!record?.fileId)throw new Error("The controlled archive record is missing its document or file identifier.");
   const result=await downloadLifecycleDocument(record.documentId,record.fileId);
   if(!result?.bytes?.length)throw new Error("The authorised archive returned no document content.");
   downloadFile(result,record);
   setMessage("Document retrieved. The controlled archive verified the request against your authenticated IRPA profile.");
  }catch(e){setError(e?.message||"Document retrieval failed.");}
  finally{setBusy(false);}
 }

 return <section className="policies-strategic-plan-portal">
  <div className="panel" style={{marginBottom:14}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap",alignItems:"flex-start"}}>
    <div style={{minWidth:0,flex:"1 1 320px"}}>
     <span className="eyebrow">IRPA INSTITUTIONAL GOVERNANCE LIBRARY</span>
     <h2 style={{margin:"5px 0"}}>Policies and Strategic Plan Portal</h2>
     <p className="panel-description" style={{margin:0}}>The central institutional register for IRPA policies, strategic plans and approved governance documents. Access is available through each active organisational profile and remains subject to the controlled-document service.</p>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button type="button" onClick={()=>setUploadOpen(value=>!value)}>{uploadOpen?"Close Upload":"Upload Document"}</button>
     <button type="button" className="secondary-button" onClick={refresh} disabled={busy}>{busy?"Refreshing…":"Refresh Register"}</button>
    </div>
   </div>
  </div>
  <div className="panel" style={{marginBottom:14}}>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}} role="tablist" aria-label="Governance library sections">
    {[["POLICIES","Mandatory Policies"],["PLANS","Strategic Plans"],["OTHER","All Governance Uploads"]].map(([value,label])=><button key={value} type="button" className={section===value?"":"secondary-button"} role="tab" aria-selected={section===value} onClick={()=>setSection(value)}>{label}</button>)}
   </div>
  </div>
  {uploadOpen&&<form className="panel" onSubmit={submitUpload} style={{marginBottom:14}}>
   <h3 style={{marginTop:0}}>Upload a Policy or Strategic Plan</h3>
   <p className="panel-description">Uploads are saved as working records in the controlled Governance Documents archive. Formal approval, signature and final adoption must follow IRPA's applicable governance authority and workflows.</p>
   <div className="form-grid">
    <div className="form-field"><label htmlFor="irpa-policy-kind">Document category</label><select id="irpa-policy-kind" value={kind} onChange={event=>{setKind(event.target.value);setTitle("");setCustomTitle("");}}><option value="Policy">Policy</option><option value="Strategic Plan">Strategic Plan</option></select></div>
    <div className="form-field"><label htmlFor="irpa-policy-version">Version</label><input id="irpa-policy-version" value={version} onChange={event=>setVersion(event.target.value)} placeholder="1.0" maxLength={30}/></div>
    <div className="form-field" style={{gridColumn:"1 / -1"}}>
     <label htmlFor="irpa-policy-title">Select document name</label>
     <select id="irpa-policy-title" value={title} onChange={event=>setTitle(event.target.value)} required>
      <option value="">Choose a {kind==="Policy"?"policy":"strategic plan"} name</option>
      {(kind==="Policy"?MANDATORY_POLICIES:STRATEGIC_PLAN_OPTIONS).map(name=><option key={name} value={name}>{name}</option>)}
      <option value={OTHER_TITLE}>Other — enter a different title</option>
     </select>
     {title===OTHER_TITLE&&<div style={{marginTop:9}}><label htmlFor="irpa-policy-custom-title">Enter document name</label><input id="irpa-policy-custom-title" value={customTitle} onChange={event=>setCustomTitle(event.target.value)} placeholder="Enter the full document title" required maxLength={180}/></div>}
     <small>Select the relevant name from the list. Choose Other only when the document is not listed.</small>
    </div>
    <div className="form-field" style={{gridColumn:"1 / -1"}}><label htmlFor="irpa-policy-file">Document file (maximum 10 MB)</label><input id="irpa-policy-file" type="file" accept={ACCEPT} onChange={event=>setFile(event.target.files?.[0]||null)} required/><small>PDF, Microsoft Office, OpenDocument, RTF, text, CSV and common image formats.</small></div>
   </div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button type="submit" disabled={busy||!file}>{busy?"Uploading…":"Upload Working Document"}</button><button type="button" className="secondary-button" onClick={()=>setUploadOpen(false)} disabled={busy}>Cancel</button></div>
  </form>}
  {error&&<div className="error-message action-feedback" role="alert" style={{marginBottom:12}}>{error}</div>}
  {message&&<div className="success-message action-feedback" role="status" style={{marginBottom:12}}>{message}</div>}
  {section==="POLICIES"&&<div className="panel" style={{marginBottom:14}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}><div><h3 style={{margin:"0 0 4px"}}>Mandatory Policies Register</h3><p className="panel-description" style={{margin:0}}>Required institutional documents and their upload status.</p></div><strong>{policyStatus.filter(item=>item.record).length} / {MANDATORY_POLICIES.length} uploaded</strong></div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:8,marginTop:12}}>
    {policyStatus.map((item,index)=><article key={item.name} style={{border:"1px solid var(--border-color, rgba(148,163,184,.35))",borderRadius:10,padding:12,minWidth:0}}>
     <div style={{display:"flex",gap:8,alignItems:"flex-start"}}><strong style={{flex:"1 1 auto",overflowWrap:"anywhere"}}>{index+1}. {item.name}</strong><span style={{fontSize:12,whiteSpace:"nowrap",fontWeight:700}}>{item.record?"UPLOADED":"NOT UPLOADED"}</span></div>
     {item.record&&<div style={{fontSize:13,marginTop:7}}>Version {item.record.version||"—"} · {String(item.record.status||"WORKING").replaceAll("_"," ")} · Updated {readableDate(item.record.updatedAt||item.record.uploadedAt)}</div>}
     {item.record&&<button type="button" className="secondary-button" style={{marginTop:8}} onClick={()=>retrieve(item.record)} disabled={busy}>Retrieve Policy</button>}
    </article>)}
   </div>
  </div>}
  <div className="panel">
   <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
    <div><h3 style={{margin:"0 0 4px"}}>{section==="POLICIES"?"Uploaded Policies":section==="PLANS"?"Strategic Plans":"Governance Documents"}</h3><p className="panel-description" style={{margin:0}}>Only records authorised for the signed-in profile are returned by the server.</p></div>
    <div style={{minWidth:"min(100%,240px)"}}><label htmlFor="irpa-governance-search">Search register</label><input id="irpa-governance-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search title, version or reference"/></div>
   </div>
   {visible.length===0?<div className="auth-message">No matching records are currently available in this section.</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:10}}>
    {visible.map(record=><article key={record.documentId} className="panel" style={{margin:0,minWidth:0}}>
     <strong style={{display:"block",overflowWrap:"anywhere"}}>{record.title||record.fileName||"Untitled governance document"}</strong>
     <div style={{fontSize:13,marginTop:7,lineHeight:1.6}}>Type: {record.documentType} · Version: {record.version||"—"}<br/>Lifecycle: {String(record.status||"WORKING").replaceAll("_"," ")}<br/>Classification: {record.classification||"Internal"}<br/>Updated: {readableDate(record.updatedAt||record.uploadedAt)}</div>
     <button type="button" style={{marginTop:10}} onClick={()=>retrieve(record)} disabled={busy||!record.fileId}>Retrieve Document</button>
    </article>)}
   </div>}
  </div>
  <p className="panel-description" style={{marginTop:12}}>A document marked as uploaded or archived is not automatically represented as Board-approved. Approval and effective status must be evidenced through the applicable IRPA decision and signature records.</p>
 </section>;
}
