import React,{useState}from"react";
import AuthorizationWorkflow from"./AuthorizationWorkflow";
import ControlledDocumentUpload from"../components/ControlledDocumentUpload";
export default function AuthorizationApprovals(){const[doc,setDoc]=useState(null);return <div><ControlledDocumentUpload purpose="Authorization Supporting Document" onUploaded={setDoc}/>{doc&&<div className="success-message action-feedback">Supporting document ready and linked to the next authorization request: <strong>{doc.reference||doc.title}</strong>. Signature routing is available only after an authorization record reaches the appropriate approved state.</div>}<AuthorizationWorkflow supportingDocument={doc}/></div>}
