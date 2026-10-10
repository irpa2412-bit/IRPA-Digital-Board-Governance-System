import { getIdToken } from "firebase/auth";
import { auth } from "./config";

const PRODUCTION_GATEWAY_URL=String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL||"https://irpa-google-drive-gateway.irpa-governance.workers.dev").replace(/\/$/,"");
function getGatewayUrl(){
 let environment="";
 try{environment=window.sessionStorage.getItem("irpaDataEnvironment")||""}catch{}
 if(environment==="TRIAL"){
  const staging=String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL||"").replace(/\/$/,"");
  if(!staging)throw new Error("Trial document operations are disabled until an isolated staging gateway is configured.");
  return staging;
 }
 if(environment==="ACTUAL")return PRODUCTION_GATEWAY_URL;
 throw new Error("Choose Trial/Test or Actual Institutional Records in the Data Environment Gate before using Documents.");
}
function resolveRecordOrigin(value){
 const explicit=String(value||"").trim().toUpperCase();
 if(explicit==="TRIAL"||explicit==="PRODUCTION")return explicit;
 try{return window.sessionStorage.getItem("irpaDataEnvironment")==="TRIAL"?"TRIAL":"PRODUCTION"}catch{return "PRODUCTION"}
}
async function post(path,payload={}){if(!auth.currentUser)throw new Error("Authentication is required.");const token=await getIdToken(auth.currentUser);const response=await fetch(getGatewayUrl()+path,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||"Document lifecycle gateway request failed.");return data;}
function base64(bytes){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(binary);}
export async function listLifecycleDocuments(){return post("/api/document-lifecycle/list",{});}
export async function getLifecycleDocument(documentId){return post("/api/document-lifecycle/get",{documentId});}
export async function uploadLifecycleDocument({file,title,documentType,archiveCategory,classification,version="1.0",recordOrigin,parentDocumentId}={}){if(!file)throw new Error("Select a document file.");const bytes=new Uint8Array(await file.arrayBuffer());return post("/api/document-lifecycle/upload",{fileName:file.name,contentType:file.type||"application/octet-stream",base64:base64(bytes),title,documentType,archiveCategory,classification,version,recordOrigin:resolveRecordOrigin(recordOrigin),parentDocumentId:parentDocumentId||undefined});}
export async function downloadLifecycleDocument(documentId,fileId){const result=await post("/api/document-lifecycle/download",{documentId,fileId});const binary=atob(result.base64||"");const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return{...result,bytes};}
export async function transitionLifecycleDocument(documentId,targetStage,extra={}){return post("/api/document-lifecycle/transition",{documentId,targetStage,...extra});}
export async function completeLifecycleSignature(documentId,envelopeId){return post("/api/document-lifecycle/signature-complete",{documentId,envelopeId});}
export async function shareLifecycleDocument(documentId,targetUid){return post("/api/document-lifecycle/share",{documentId,targetUid});}
