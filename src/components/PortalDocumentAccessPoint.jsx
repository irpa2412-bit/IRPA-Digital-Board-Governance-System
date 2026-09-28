import React,{useState}from"react";
import ControlledDocumentUpload from"./ControlledDocumentUpload";

export default function PortalDocumentAccessPoint({portal="Current Portal",allowRestrictedUpload=false}){
  const [open,setOpen]=useState(false);
  const [uploaded,setUploaded]=useState(null);
  const label=String(portal||"Current Portal").trim()||"Current Portal";
  return <section className="portal-document-access-point" aria-label={`Document access for ${label}`} style={{marginBottom:16}}>
    <div className="panel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div>
        <span className="eyebrow">DOCUMENT ACCESS POINT</span>
        <h3 style={{margin:"4px 0"}}>{label} — Upload Documents</h3>
        <p className="panel-description" style={{margin:0}}>Upload PDF or another supported document in its native format. Select the document type before upload so IRPA-DBGS records the final archive destination at upload time.</p>
      </div>
      <button type="button" onClick={()=>setOpen(v=>!v)}>{open?"Close Document Upload":"Upload Document"}</button>
    </div>
    {open&&<div style={{marginTop:12}}>
      <ControlledDocumentUpload purpose={`${label} — Document Upload`} allowRestrictedUpload={allowRestrictedUpload} onUploaded={doc=>{setUploaded(doc);}}/>
    </div>}
    {uploaded&&<div className="success-message action-feedback" role="status" style={{marginTop:12}}>Document ready in the IRPA controlled-document register: <strong>{uploaded.title||uploaded.fileName}</strong> · {uploaded.reference||"Reference assigned"}.</div>}
  </section>;
}
