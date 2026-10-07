import { canUpload, canRead, canTransition, resolveIdentity, buildDocumentRecord } from "./documentPolicy.mjs";

const MAX_BYTES = 10 * 1024 * 1024;
const CLASSIFICATIONS = new Set(["Public","Internal","Confidential","Restricted"]);
const ARCHIVE_CATEGORIES = new Set(["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents","Administrator Documents"]);
const STAGES = {
  WORKING: "01-Working Documents",
  PENDING_SIGNATURE: "02-Pending Signature",
  SIGNED: "03-Signed Documents",
  POST_SIGNATURE: "04-Post-Signature Working",
  FINAL_ARCHIVE: "05-Final Archive"
};

const clean = value => String(value ?? "").trim();
const cleanName = value => clean(value).replace(/[\\/:*?"<>|]/g,"-").slice(0,160) || "Document";
const cleanId = value => clean(value).replace(/[^a-zA-Z0-9_-]/g,"");
const nowIso = () => new Date().toISOString();

function fsValue(value) {
  if (value === null || value === undefined) return {nullValue:null};
  if (typeof value === "boolean") return {booleanValue:value};
  if (typeof value === "number" && Number.isInteger(value)) return {integerValue:String(value)};
  if (typeof value === "number") return {doubleValue:value};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(fsValue)}};
  if (typeof value === "object") return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fsValue(v)]))}};
  return {stringValue:String(value)};
}

function firestoreFields(data) {
  return Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined).map(([k,v])=>[k,fsValue(v)]));
}

async function putDocument(deps, env, claims, documentId, data) {
  return deps.updateFirestoreDocument(env, "documents/"+cleanId(documentId), claims.token, firestoreFields(data), Object.keys(data));
}

async function getPlainDocument(deps, env, claims, documentId) {
  const raw = await deps.getFirestoreDocument(env, "documents/"+cleanId(documentId), claims.token);
  return raw ? deps.firestoreDocumentToPlain(raw) : null;
}

async function getIdentity(deps, env, claims) {
  const [adminDoc,memberDoc,employeeDoc] = await Promise.all([
    deps.getFirestoreDocument(env, "adminProfiles/"+claims.user_id, claims.token),
    deps.getFirestoreDocument(env, "members/"+claims.user_id, claims.token),
    deps.getFirestoreDocument(env, "employees/"+claims.user_id, claims.token)
  ]);
  return resolveIdentity({
    uid:claims.user_id,
    email:claims.email,
    admin:deps.firestoreDocumentToPlain(adminDoc),
    member:deps.firestoreDocumentToPlain(memberDoc),
    employee:deps.firestoreDocumentToPlain(employeeDoc)
  });
}

async function listVisibleDocuments(deps, env, claims, identity) {
  const response = await fetch("https://firestore.googleapis.com/v1/projects/"+deps.FIREBASE_PROJECT_ID+"/databases/(default)/documents:runQuery",{
    method:"POST",
    headers:{Authorization:"Bearer "+claims.token,"Content-Type":"application/json"},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:"documents"}],limit:100}})
  });
  if(!response.ok) throw new Error("Unable to retrieve the controlled-document register.");
  const rows=await response.json();
  return rows.filter(row=>row.document).map(row=>deps.firestoreDocumentToPlain(row.document)).filter(doc=>canRead(identity,doc).allowed);
}

function archiveFolderPath(category,classification,stage,documentId) {
  return ["IRPA Governance System","Document Lifecycle",stage,category,classification,"IRPA-DOC-"+documentId].join("/");
}

async function ensureLifecycleArchive(deps,env,accessToken,{category,classification,stage,documentId,title,reference}) {
  const root=await deps.findOrCreateFolder(env,accessToken,"Document Lifecycle",null,{irpaDocumentLifecycle:true,purpose:"Controlled Document Lifecycle"});
  const stageId=await deps.findOrCreateFolder(env,accessToken,STAGES[stage]||STAGES.WORKING,root,{irpaDocumentLifecycle:true,stage});
  const categoryId=await deps.findOrCreateFolder(env,accessToken,category,stageId,{irpaDocumentLifecycle:true,archiveCategory:category});
  const classificationId=await deps.findOrCreateFolder(env,accessToken,classification,categoryId,{irpaDocumentLifecycle:true,classification});
  const folderId=await deps.findOrCreateFolder(env,accessToken,"IRPA-DOC-"+documentId,classificationId,{
    irpaDocumentLifecycle:true,documentId,documentTitle:title,documentReference:reference,stage,archiveCategory:category,classification
  });
  return {folderId,archivePath:archiveFolderPath(category,classification,STAGES[stage]||STAGES.WORKING,documentId),stageId,categoryId,classificationId};
}

async function uploadToDrive(deps,env,accessToken,{folderId,fileName,contentType,bytes,description}) {
  const boundary="irpa-document-"+crypto.randomUUID();
  const encoder=new TextEncoder();
  const head=encoder.encode("--"+boundary+"\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n"+JSON.stringify({name:fileName,parents:[folderId],mimeType:contentType,description:JSON.stringify(description)})+"\\r\\n--"+boundary+"\\r\\nContent-Type: "+contentType+"\\r\\n\\r\\n");
  const tail=encoder.encode("\\r\\n--"+boundary+"--");
  const body=new Uint8Array(head.length+bytes.length+tail.length);body.set(head);body.set(bytes,head.length);body.set(tail,head.length+bytes.length);
  const response=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents",{
    method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"multipart/related; boundary="+boundary},body
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.message||"Google Drive document upload failed.");
  return result;
}

async function deleteDriveFile(deps,env,accessToken,fileId) {
  if(!fileId)return;
  try{await deps.driveFetch(env,accessToken,"/drive/v3/files/"+encodeURIComponent(fileId),{method:"DELETE"});}catch(error){console.warn("Document lifecycle rollback could not delete Drive file",fileId,error?.message||error);}
}

function bytesFromBase64(base64) {
  const normalized=clean(base64);
  if(!normalized)return new Uint8Array();
  return Uint8Array.from(atob(normalized),c=>c.charCodeAt(0));
}

async function sha256(bytes) {
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function fileIdFromUrl(value) {
  const v=clean(value);
  if(v.startsWith("drive://"))return cleanId(v.slice(8));
  const m=v.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return m?.[1]||"";
}

async function copyToStage(deps,env,accessToken,fileId,folderId,fileName) {
  if(!fileId)return "";
  const copied=await deps.driveFetch(env,accessToken,"/drive/v3/files/"+encodeURIComponent(fileId)+"/copy?supportsAllDrives=true",{
    method:"POST",body:JSON.stringify({name:cleanName(fileName),parents:[folderId]})
  });
  return copied.id||"";
}

async function audit(deps,env,claims,documentId,event,details={}) {
  try {
    await deps.updateFirestoreDocument(env,"audit/"+cleanId(documentId)+"-"+Date.now(),claims.token,firestoreFields({
      action:"DOCUMENT_LIFECYCLE_"+event,collection:"documents",recordId:documentId,details,actorUid:claims.user_id,actorEmail:claims.email||null,createdAt:nowIso()
    }));
  } catch(error) { console.warn("Document lifecycle audit write failed",error?.message||error); }
}

export function createDocumentLifecycleRouter(deps) {
  return async function routeDocumentLifecycle(request,env) {
    const url=new URL(request.url);
    const pathname=url.pathname.replace(/\/+$/,"")||"/";
    const claims=await deps.authenticateFirebaseRequest(request,env);
    const identity=await getIdentity(deps,env,claims);
    const method=request.method;

    if(pathname==="/api/document-lifecycle/list"&&method==="POST"){
      const documents=await listVisibleDocuments(deps,env,claims,identity);
      return deps.json({ok:true,documents},200,deps.corsHeaders(request));
    }

    if(pathname==="/api/document-lifecycle/get"&&method==="POST"){
      const data=await request.json();const documentId=cleanId(data.documentId);
      if(!documentId)return deps.json({ok:false,error:"Document ID is required."},400,deps.corsHeaders(request));
      const document=await getPlainDocument(deps,env,claims,documentId);
      if(!document)return deps.json({ok:false,error:"Document registry record was not found."},404,deps.corsHeaders(request));
      const access=canRead(identity,document);if(!access.allowed)return deps.json({ok:false,error:access.reason},403,deps.corsHeaders(request));
      return deps.json({ok:true,document},200,deps.corsHeaders(request));
    }

    if(pathname==="/api/document-lifecycle/upload"&&method==="POST"){
      const data=await request.json();
      const bytes=bytesFromBase64(data.base64);
      const fileName=cleanName(data.fileName||"document");
      const contentType=clean(data.contentType);
      if(!bytes.length)return deps.json({ok:false,error:"Document content is required."},400,deps.corsHeaders(request));
      if(bytes.length>MAX_BYTES)return deps.json({ok:false,error:"Documents must not exceed 10 MB."},400,deps.corsHeaders(request));
      if(!deps.allowedContentTypes.has(contentType))return deps.json({ok:false,error:"The selected file format is not supported."},400,deps.corsHeaders(request));
      const policy=canUpload(identity,data);if(!policy.allowed)return deps.json({ok:false,error:policy.reason},403,deps.corsHeaders(request));
      const classification=clean(data.classification||"Internal");const category=clean(data.archiveCategory||"Administrative Documents");
      if(!CLASSIFICATIONS.has(classification)||!ARCHIVE_CATEGORIES.has(category))return deps.json({ok:false,error:"Invalid document archive classification or category."},400,deps.corsHeaders(request));
      const documentId="LIFE-"+crypto.randomUUID().replace(/-/g,"").slice(0,24);
      const reference="IRPA-DOC-"+new Date().getUTCFullYear()+"-"+documentId.slice(-8).toUpperCase();
      const hash=await sha256(bytes);
      const accessToken=await deps.getDriveAccessToken(env);
      const archive=await ensureLifecycleArchive(deps,env,accessToken,{category,classification,stage:"WORKING",documentId,title:clean(data.title||fileName),reference});
      let uploaded=null;
      try {
        uploaded=await uploadToDrive(deps,env,accessToken,{folderId:archive.folderId,fileName,contentType,bytes,description:{irpaGovernance:true,irpaDocumentLifecycle:true,documentId,reference,stage:"WORKING",ownerUid:claims.user_id,classification,archiveCategory:category,sha256:hash}});
        const record=buildDocumentRecord(identity,{...data,reference,classification,archiveCategory},{documentId,fileId:uploaded.id,fileName,fileSize:bytes.length,sha256:hash,archivePath:archive.archivePath});
        record.archiveFolderId=archive.folderId;record.archiveUidLink="https://drive.google.com/drive/folders/"+encodeURIComponent(archive.folderId);record.archiveFileWebViewLink=uploaded.webViewLink||null;record.webViewLink=uploaded.webViewLink||null;record.fileUrl=uploaded.id?"drive://"+uploaded.id:null;record.recordOrigin=String(data.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION";
        await putDocument(deps,env,claims,documentId,record);
      } catch(error) {
        if(uploaded?.id)await deleteDriveFile(deps,env,accessToken,uploaded.id);
        throw error;
      }
      await audit(deps,env,claims,documentId,"UPLOADED",{reference,classification,archiveCategory:category,sha256:hash});
      return deps.json({ok:true,documentId,reference,archivePath:archive.archivePath,fileId:uploaded.id,fileName,sha256:hash,status:"WORKING"},201,deps.corsHeaders(request));
    }

    if(pathname==="/api/document-lifecycle/download"&&method==="POST"){
      const data=await request.json();const documentId=cleanId(data.documentId);const suppliedFileId=cleanId(data.fileId);
      if(!documentId)return deps.json({ok:false,error:"Document ID is required."},400,deps.corsHeaders(request));
      const document=await getPlainDocument(deps,env,claims,documentId);
      if(!document)return deps.json({ok:false,error:"Document registry record was not found."},404,deps.corsHeaders(request));
      const access=canRead(identity,document);if(!access.allowed)return deps.json({ok:false,error:access.reason},403,deps.corsHeaders(request));
      if(!suppliedFileId||suppliedFileId!==cleanId(document.fileId))return deps.json({ok:false,error:"The supplied Drive file does not match the controlled document record."},409,deps.corsHeaders(request));
      const accessToken=await deps.getDriveAccessToken(env);
      const metadata=await deps.driveFetch(env,accessToken,"/drive/v3/files/"+encodeURIComponent(suppliedFileId)+"?fields=id,name,mimeType,size,description,trashed");
      const description=JSON.parse(metadata.description||"{}");
      if(!description.irpaGovernance||description.documentId!==documentId)return deps.json({ok:false,error:"The requested file is not the registered IRPA lifecycle file."},403,deps.corsHeaders(request));
      const media=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(suppliedFileId)+"?alt=media",{headers:{Authorization:"Bearer "+accessToken}});
      if(!media.ok)throw new Error("Google Drive download failed.");
      const bytes=new Uint8Array(await media.arrayBuffer());
      const actualHash=await sha256(bytes);
      if(document.sha256&&actualHash!==document.sha256)return deps.json({ok:false,error:"Document integrity verification failed."},409,deps.corsHeaders(request));
      let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return deps.json({ok:true,fileId:suppliedFileId,fileName:metadata.name,contentType:metadata.mimeType,base64:btoa(binary),sha256:actualHash},200,deps.corsHeaders(request));
    }

    if(pathname==="/api/document-lifecycle/transition"&&method==="POST"){
      const data=await request.json();const documentId=cleanId(data.documentId);const target=clean(data.targetStage);
      if(!documentId||!target)return deps.json({ok:false,error:"Document ID and target stage are required."},400,deps.corsHeaders(request));
      const document=await getPlainDocument(deps,env,claims,documentId);
      if(!document)return deps.json({ok:false,error:"Document registry record was not found."},404,deps.corsHeaders(request));
      const transition=canTransition(identity,document,target);
      if(!transition.allowed)return deps.json({ok:false,error:transition.reason},403,deps.corsHeaders(request));
      const accessToken=await deps.getDriveAccessToken(env);
      const patch={status:target,updatedAt:nowIso()};
      if(target==="PENDING_SIGNATURE"){patch.signatureStatus="PENDING";patch.signatureRequestedAt=nowIso();patch.signatureRequestedByUid=claims.user_id;}
      if(target==="SIGNED"){patch.signatureStatus="COMPLETED";patch.signedAt=nowIso();patch.signedByUid=claims.user_id;}
      if(target==="POST_SIGNATURE"){patch.postSignatureStatus="IN_PROGRESS";patch.postSignatureStartedAt=nowIso();patch.postSignatureStartedByUid=claims.user_id;}
      if(target==="FINAL_ARCHIVE"){patch.finalArchiveStatus="ARCHIVED";patch.finalArchivedAt=nowIso();patch.finalArchivedByUid=claims.user_id;}
      const archive=await ensureLifecycleArchive(deps,env,accessToken,{category:document.archiveCategory||"Administrative Documents",classification:document.classification||"Internal",stage:target,documentId,title:document.title,reference:document.reference});
      patch.archiveFolderId=archive.folderId;patch.archivePath=archive.archivePath;
      if(target==="SIGNED"&&document.fileId)patch.signedArchiveFileId=await copyToStage(deps,env,accessToken,document.fileId,archive.folderId,document.fileName||document.title);
      if(target==="POST_SIGNATURE"){patch.channelStatus="READY";patch.channelledAt=nowIso();patch.channelledByUid=claims.user_id;patch.channelDestination="POST_SIGNATURE_WORKING";}
      if(target==="FINAL_ARCHIVE"){
        const sourceFileId=cleanId(data.sourceFileId||document.signedArchiveFileId||document.fileId);
        if(sourceFileId&&sourceFileId!==cleanId(document.fileId)){
          patch.finalArchiveFileId=await copyToStage(deps,env,accessToken,sourceFileId,archive.folderId,document.fileName||document.title);
        } else if(sourceFileId){
          patch.finalArchiveFileId=await copyToStage(deps,env,accessToken,sourceFileId,archive.folderId,document.fileName||document.title);
        }
      }
      await putDocument(deps,env,claims,documentId,patch);
      await audit(deps,env,claims,documentId,"TRANSITIONED",{from:document.status,to:target});
      return deps.json({ok:true,documentId,status:target,archivePath:archive.archivePath,archiveFolderId:archive.folderId,...patch},200,deps.corsHeaders(request));
    }

    if(pathname==="/api/document-lifecycle/signature-complete"&&method==="POST"){
      const data=await request.json();const documentId=cleanId(data.documentId);const envelopeId=cleanId(data.envelopeId);
      if(!documentId||!envelopeId)return deps.json({ok:false,error:"Document ID and signature envelope ID are required."},400,deps.corsHeaders(request));
      const document=await getPlainDocument(deps,env,claims,documentId);if(!document)return deps.json({ok:false,error:"Document registry record was not found."},404,deps.corsHeaders(request));
      const access=canRead(identity,document);if(!access.allowed)return deps.json({ok:false,error:access.reason},403,deps.corsHeaders(request));
      if(document.status!=="PENDING_SIGNATURE")return deps.json({ok:false,error:"The document is not awaiting signature."},409,deps.corsHeaders(request));
      const envelopeRaw=await deps.getFirestoreDocument(env,"signatureEnvelopes/"+envelopeId,claims.token);const envelope=envelopeRaw?deps.firestoreDocumentToPlain(envelopeRaw):null;
      if(!envelope||clean(envelope.documentId)!==documentId)return deps.json({ok:false,error:"The signature envelope does not belong to this document."},403,deps.corsHeaders(request));
      if(clean(envelope.status)!=="Completed")return deps.json({ok:false,error:"The signature envelope is not completed."},409,deps.corsHeaders(request));
      const signedFileId=fileIdFromUrl(envelope.signedDocumentUrl||envelope.ownerCompletedDocumentUrl||envelope.signedDocumentPath||"");
      const patch={status:"SIGNED",signatureStatus:"COMPLETED",signatureEnvelopeId:envelopeId,signedAt:nowIso(),signedByUid:envelope.lastSignedByUid||claims.user_id,signedDocumentUrl:envelope.signedDocumentUrl||envelope.ownerCompletedDocumentUrl||null,signedSourceFileId:signedFileId||null,updatedAt:nowIso()};
      await putDocument(deps,env,claims,documentId,patch);await audit(deps,env,claims,documentId,"SIGNATURE_COMPLETED",{envelopeId});
      return deps.json({ok:true,documentId,status:"SIGNED",envelopeId,signedSourceFileId:signedFileId||null},200,deps.corsHeaders(request));
    }

    if(pathname==="/api/document-lifecycle/share"&&method==="POST"){
      const data=await request.json();const documentId=cleanId(data.documentId);const targetUid=cleanId(data.targetUid);
      if(!documentId||!targetUid)return deps.json({ok:false,error:"Document ID and target user UID are required."},400,deps.corsHeaders(request));
      const document=await getPlainDocument(deps,env,claims,documentId);if(!document)return deps.json({ok:false,error:"Document registry record was not found."},404,deps.corsHeaders(request));
      if(identity.actorType!=="ADMINISTRATOR"&&document.ownerUid!==identity.uid)return deps.json({ok:false,error:"Only the document owner or an administrator may share a document."},403,deps.corsHeaders(request));
      const authorizedUids=[...new Set([...(Array.isArray(document.authorizedUids)?document.authorizedUids:[]),targetUid])];
      await putDocument(deps,env,claims,documentId,{authorizedUids,updatedAt:nowIso()});await audit(deps,env,claims,documentId,"SHARED",{targetUid});
      return deps.json({ok:true,documentId,authorizedUids},200,deps.corsHeaders(request));
    }

    return null;
  };
}
