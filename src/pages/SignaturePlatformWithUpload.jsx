import React,{useState}from"react";
import SignaturePlatform from"./SignaturePlatform";
import ControlledDocumentUpload from"../components/ControlledDocumentUpload";
export default function SignaturePlatformWithUpload({signerOnly=false,signingEnvelopeId=null}){const[doc,setDoc]=useState(null);return <div>{!signerOnly&&<><ControlledDocumentUpload purpose="Signature Source Document" onUploaded={setDoc}/>{doc&&<div className="success-message action-feedback">PDF uploaded: <strong>{doc.title}</strong>. The uploaded PDF is selected automatically below. You can immediately create the authorization, review, signature and approval workflow.</div>}</>}<SignaturePlatform signerOnly={signerOnly} signingEnvelopeId={signingEnvelopeId} initialDocument={doc}/></div>}
