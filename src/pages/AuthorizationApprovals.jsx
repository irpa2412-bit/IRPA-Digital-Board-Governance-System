import React,{useState}from"react";
import AuthorizationWorkflow from"./AuthorizationWorkflow";
import ControlledDocumentUpload from"../components/ControlledDocumentUpload";
export default function AuthorizationApprovals(){const[doc,setDoc]=useState(null);return <div><ControlledDocumentUpload purpose="Authorization Supporting Document" onUploaded={setDoc}/>{doc&&<div className="success-message action-feedback">Supporting document ready: <strong>{doc.title}</strong>. It is available in the controlled Documents register for authorization processing.</div>}<AuthorizationWorkflow/></div>}
