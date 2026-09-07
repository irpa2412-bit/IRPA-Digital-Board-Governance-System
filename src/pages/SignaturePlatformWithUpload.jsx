import React,{useState}from"react";
import SignaturePlatform from"./SignaturePlatform";
import ControlledDocumentUpload from"../components/ControlledDocumentUpload";
export default function SignaturePlatformWithUpload(){const[doc,setDoc]=useState(null);return <div><ControlledDocumentUpload purpose="Signature Source Document" onUploaded={setDoc}/>{doc&&<div className="success-message action-feedback">PDF uploaded: <strong>{doc.title}</strong>. Open Signature Platform below and select it from the controlled document list.</div>}<SignaturePlatform/></div>}
