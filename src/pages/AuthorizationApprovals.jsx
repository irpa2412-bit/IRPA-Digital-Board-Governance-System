import React,{useState}from"react";
import AuthorizationWorkflow from"./AuthorizationWorkflow";
import{navigateWorkflow}from"../firebase/workflowLinks";
import ControlledDocumentUpload from"../components/ControlledDocumentUpload";
export default function AuthorizationApprovals(){const[doc,setDoc]=useState(null);return <div><ControlledDocumentUpload purpose="Authorization Supporting Document" onUploaded={setDoc}/>{doc&&<><div className="success-message action-feedback">Supporting document ready and linked to the next authorization request: <strong>{doc.title}</strong>.</div><div className="form-actions" style={{marginTop:12}}><button type="button" onClick={()=>navigateWorkflow("Signature Platform",{authorizationRequestId:"pending",authorizationReference:doc.reference||doc.title||"",documentId:doc.id,documentReference:doc.reference||doc.title||""})}>Sign a Document</button></div></>}<AuthorizationWorkflow supportingDocument={doc}/></div>}
