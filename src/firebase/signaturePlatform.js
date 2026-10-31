import { arrayUnion, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { requireSupportedSignatureRoutingMode } from "./signatureWorkflowPolicy.js";
import { createGatewaySignatureEnvelope, voidGatewaySignatureEnvelope, downloadSignatureBytes, downloadControlledDocumentBytes, ensureSignatureWorkflowFolder, ensureSignedDocumentArchive, ensureSignatureProfileFolder, finalizeSignatureProfileArchives, getDownloadURL, ref, uploadBytes, fetchGatewaySigningStatus, fetchGatewaySigningResource, submitGatewaySignature, verifyGatewaySignedPdf } from "./signatureStorage";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { auth, db } from "./config";
import { ensureMySignerIdentity, getMySignerIdentity, recordSignerAuthenticationEvidence, IRPA_ORGANISATION } from "./signerIdentity";
import { getCurrentSigningAuthorityRegisterEntries } from "./data";
import { readWorkflowContext } from "./workflowLinks";
import { getGoogleDriveGatewayUrl } from "./gatewayUrl";
const PROFILE_COLLECTION="signatureProfiles";const ENVELOPE_COLLECTION="signatureEnvelopes";const EVENT_COLLECTION="signatureEvents";
const GATEWAY_URL=getGoogleDriveGatewayUrl();
const CRYPTOGRAPHIC_GATEWAY_BRIDGE_ENABLED=import.meta.env.VITE_IRPA_CRYPTOGRAPHIC_SIGNING_ENABLED==="true";
async function sendSignatureMail(envelope,recipient){
  if(!auth.currentUser) throw new Error("Authentication is required. Sign in again before sending the signing invitation.");
  try{
    const token=await auth.currentUser.getIdToken();
    const response=await fetch(`${GATEWAY_URL}/api/signature-invitations/send`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({envelopeId:envelope.id,signerUid:recipient.uid,signerEmail:recipient.email,signerName:recipient.name,role:recipient.role})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false) throw new Error(data.error||"The IRPA mail server could not send the signature invitation.");
    return data;
  }catch(error){
    console.error("IRPA signature invitation sender error",{firebaseErrorCode:error?.code||""});
    throw new Error(error?.message||"The signature invitation could not be sent. Check the invitation status and try again.");
  }
}
const VIEW_ONLY_ROLES=["View Only","Read Only","Information / FYI","Observer"];
const BOARD_SIGNING_ROLES=["Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member"];
function isBoardSigningRole(role,recipient){const values=[role,recipient?.institutionalRole].map(v=>String(v||"").trim()).filter(Boolean);return values.some(v=>BOARD_SIGNING_ROLES.includes(v));}
function isViewOnlyRecipient(recipient){return !!recipient?.accessOnly||VIEW_ONLY_ROLES.includes(String(recipient?.role||"").trim());}
function isActionRecipient(recipient){return !!recipient?.uid&&!isViewOnlyRecipient(recipient)&&recipient?.optionalSigning!==true;}
function nextActionRecipient(recipients,currentUid){const list=recipients||[];const index=list.findIndex(r=>r?.uid===currentUid);return list.slice(Math.max(0,index+1)).find(isActionRecipient)||null;}

function user(){if(!auth.currentUser)throw new Error("Authentication is required.");return auth.currentUser;}
function isTrialSignatureMode(){try{const environment=String(window.sessionStorage.getItem("irpaDataEnvironment")||"TRIAL").toUpperCase();const authority=String(window.sessionStorage.getItem("irpaActiveAccessAuthority")||"").toUpperCase();const verified=window.sessionStorage.getItem("irpaActualDataAccessVerified")==="true";return environment!=="ACTUAL"||(authority==="ADMINISTRATOR"&&!verified)}catch{return true}}
function matchesSignatureEnvironment(record={}){const trial=String(record.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"||record.trialData===true||record.isTrial===true;return trial===isTrialSignatureMode()}
function normalizeManualAuthority(value){
  return String(value||"").toLowerCase().replace(/^(the|irpa)\\s+/,"").replace(/[._-]+/g," ").replace(/\\s+/g," ").trim();
}
function authorityCandidates(record){
  return [
    record?.role,record?.boardPosition,record?.designation,record?.jobTitle,record?.position,record?.title,
    record?.authorityRole,record?.unit,record?.unitName
  ].map(normalizeManualAuthority).filter(Boolean);
}
export async function verifyManualSigningAuthority(manualAuthorityIdentification){
  const input=normalizeManualAuthority(manualAuthorityIdentification);
  if(!input) throw new Error("Enter the signing authority you are declaring before signing.");
  const entries=await getCurrentSigningAuthorityRegisterEntries();
  const matches=entries.filter(entry=>authorityCandidates(entry).includes(input));
  if(!matches.length){
    throw new Error("SYSTEM VERIFICATION FAILED: the manually entered signing authority does not match an active IRPA Member or Employee Register entry for this authenticated account.");
  }
  const match=matches[0];
  const verifiedRole=String(match.role||match.boardPosition||match.designation||match.jobTitle||match.position||match.title||manualAuthorityIdentification).trim();
  return {
    verified:true,
    manualAuthorityIdentification:String(manualAuthorityIdentification).trim(),
    authorityRole:verifiedRole,
    authorityDepartment:String(match.department||"").trim(),
    authorityUnit:String(match.unit||match.unitName||"").trim(),
    authoritySourceCollection:String(match.sourceCollection||"").trim(),
    authoritySourceRecordId:String(match.sourceRecordId||match.id||"").trim(),
    verificationMethod:"Authenticated Member/Employee Register Match"
  };
}
async function hashBytes(bytes){const d=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}
async function hash(file){return hashBytes(await file.arrayBuffer());}
async function cropSignatureImage(file){
  if(typeof document==="undefined")return file;
  const image=await new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("The signature image could not be read."))};img.src=url;});
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];if(a>20&&((r+g+b)<735||a<245)){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}
  if(maxX<0)return file;const pad=Math.max(2,Math.round(Math.min(canvas.width,canvas.height)*0.015));minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(canvas.width-1,maxX+pad);maxY=Math.min(canvas.height-1,maxY+pad);
  const out=document.createElement("canvas");out.width=maxX-minX+1;out.height=maxY-minY+1;const octx=out.getContext("2d");octx.clearRect(0,0,out.width,out.height);octx.drawImage(canvas,minX,minY,out.width,out.height,0,0,out.width,out.height);const blob=await new Promise(resolve=>out.toBlob(resolve,"image/png"));if(!blob)return file;
  return new File([blob],"IRPA-"+String(file.name||"signature").replace(/\.[^.]+$/,"")+"-cropped.png",{type:"image/png",lastModified:Date.now()});
}
async function fileDataUrl(file){
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("Unable to prepare signature preview."));
    reader.readAsDataURL(file);
  });
}
async function uploadAsset(uid,type,file,folderId){
  if(!file)throw new Error(type+" is required.");
  if(!["image/png","image/jpeg","image/jpg","image/webp"].includes(file.type))throw new Error(type+" must be PNG, JPG or WEBP.");
  const prepared=type==="Signature"||type==="Initials"?await cropSignatureImage(file):file;
  if(prepared.size>1024*1024)throw new Error(type+" must not exceed 1 MB after processing.");
  const sha=await hash(prepared);
  const path="signatureProfiles/"+uid+"/"+type.toLowerCase()+"-"+sha+".png";
  const r=ref(null,path);
  await uploadBytes(r,prepared,{contentType:prepared.type,ownerUid:uid,folderId,purpose:"Signature Profile",customMetadata:{ownerUid:uid,assetType:type,sha256:sha,purpose:"Signature Profile",cropped:true}});
  return{path,driveUrl:await getDownloadURL(r),displayUrl:await fileDataUrl(prepared),sha};
}
export async function migrateExistingSignatureProfile(){
  const u=user();
  const ref=doc(db,PROFILE_COLLECTION,u.uid);
  const snap=await getDoc(ref);
  if(!snap.exists()) return {migrated:false,reason:"No existing Signature Profile"};
  const profile={id:snap.id,...snap.data()};
  const identity=await ensureMySignerIdentity(profile,{organisationName:IRPA_ORGANISATION});
  return {migrated:true,profile,identity};
}

export async function getMySignatureProfile(){
  const u=user();
  const profileRef=doc(db,PROFILE_COLLECTION,u.uid);
  const snap=await getDoc(profileRef);
  if(!snap.exists()) return null;

  const existing=snap.data();
  const isLegacyPreloaded=
    String(existing.signaturePath||"").startsWith("preloaded/") ||
    existing.method==="Admin Assigned Upload";

  // Migration must retain historical Signature Profile data. Legacy/preloaded
  // records are therefore read-only from this migration path: no signature
  // asset, hash, method, or status is deleted or rewritten here.
  const migrated={id:snap.id,...existing};
  // The Signature Profile is the persistent signing specimen. Signer Identity
  // is an additional trust record and must never be allowed to hide a valid
  // Signature Profile after a page refresh.
  try{
    await ensureMySignerIdentity(migrated,{
      organisationName:IRPA_ORGANISATION,
      authorityStatus:isLegacyPreloaded?"Legacy Profile - Review Required":undefined
    });
  }catch(error){
    console.warn("Signer Identity refresh unavailable; retained Signature Profile will still be served.",error);
  }
  return migrated;
}

export async function saveMySignatureProfile({signatureFile,initialsFile,displayName,initials,method="Upload"}){
  const u=user();
  const cleanDisplayName=String(displayName||u.displayName||"").trim();
  if(!cleanDisplayName)throw new Error("Display name is required.");
  if(!signatureFile)throw new Error("A signature specimen is required.");

  // IRPA Signature Pathway V3:
  // capture -> protected profile folder -> specimen archive -> Firestore profile ->
  // immediate read-back verification -> supplementary Signer Identity synchronization.
  let folder;
  try{
    folder=await ensureSignatureProfileFolder(u.uid);
  }catch(error){
    throw new Error(`SIGNATURE PATHWAY / PROFILE STORAGE: ${error?.message||"Unable to establish the protected Signature Profile folder."}`);
  }
  if(!folder?.folderId)throw new Error("SIGNATURE PATHWAY / PROFILE STORAGE: Google Drive did not return the protected Signature Profile folder.");
  if(folder.ownerUid&&folder.ownerUid!==u.uid)throw new Error("SIGNATURE PATHWAY / PROFILE STORAGE: the Google Drive Signature Profile folder is not owned by the authenticated profile.");

  const folderId=folder.folderId;
  let signature;
  let initialsAsset=null;
  try{
    signature=await uploadAsset(u.uid,"Signature",signatureFile,folderId);
    if(initialsFile)initialsAsset=await uploadAsset(u.uid,"Initials",initialsFile,folderId);
  }catch(error){
    throw new Error(`SIGNATURE PATHWAY / SPECIMEN ARCHIVE: ${error?.message||"The signature specimen could not be archived."}`);
  }

  const p={
    uid:u.uid,
    email:u.email||"",
    displayName:cleanDisplayName,
    initials:String(initials||"").trim(),
    method,
    pathwayVersion:"IRPA-SIGNATURE-PATHWAY-V3",
    driveSignatureFolderId:folderId,
    driveSignatureFolderName:folder?.folderName||null,
    driveSignatureFolderPath:folder?.path||null,
    driveSignatureFolderUid:u.uid,
    completedDocumentsFolderId:folder?.completedDocumentsFolderId||null,
    completedDocumentsFolderLink:folder?.completedDocumentsFolderLink||null,
    completedDocumentsFolderPath:folder?.completedDocumentsFolderPath||null,
    signaturePath:signature.path,
    signatureUrl:signature.displayUrl,
    signatureDriveUrl:signature.driveUrl,
    signatureSha256:signature.sha,
    initialsPath:initialsAsset?.path||null,
    initialsUrl:initialsAsset?.displayUrl||null,
    initialsDriveUrl:initialsAsset?.driveUrl||null,
    initialsSha256:initialsAsset?.sha||null,
    status:"Active",
    adoptionDate:serverTimestamp(),
    updatedAt:serverTimestamp()
  };

  const profileRef=doc(db,PROFILE_COLLECTION,u.uid);
  try{
    await setDoc(profileRef,p,{merge:true});
  }catch(error){
    const code=String(error?.code||"");
    throw new Error(`SIGNATURE PATHWAY / PROFILE PERSISTENCE: Firestore rejected Signature Profile persistence${code?` (${code})`:""}: ${error?.message||"Missing or insufficient permissions."}`);
  }

  const persisted=await getDoc(profileRef);
  if(!persisted.exists())throw new Error("SIGNATURE PATHWAY / PROFILE VERIFICATION: the Signature Profile was not readable immediately after save.");
  const persistedProfile={id:persisted.id,...persisted.data()};
  if(persistedProfile.uid!==u.uid||persistedProfile.signatureSha256!==signature.sha||persistedProfile.driveSignatureFolderId!==folderId){
    throw new Error("SIGNATURE PATHWAY / PROFILE VERIFICATION: the persisted profile does not match the archived signature specimen.");
  }

  try{
    await ensureMySignerIdentity(persistedProfile,{organisationName:IRPA_ORGANISATION});
  }catch(error){
    console.warn("Signature Profile saved and verified; supplementary Signer Identity synchronization will be retried on profile load.",error);
    persistedProfile.signerIdentitySyncPending=true;
  }
  return persistedProfile;
}

export async function revokeSignatureApplication(){
  const u=user();
  const profileRef=doc(db,PROFILE_COLLECTION,u.uid);
  const snap=await getDoc(profileRef);
  if(!snap.exists()) throw new Error("No Signature Profile is registered for this account.");
  const current=snap.data()||{};
  if(current.status==="Revoked") return {ok:true,status:"Revoked",alreadyRevoked:true};
  await runTransaction(db,async tx=>{
    const fresh=await tx.get(profileRef);
    if(!fresh.exists()) throw new Error("No Signature Profile is registered for this account.");
    const data=fresh.data()||{};
    tx.update(profileRef,{
      status:"Revoked",
      revokedAt:serverTimestamp(),
      revokedByUid:u.uid,
      revokedByEmail:u.email||"",
      revocationReason:"User-initiated signature application revocation",
      updatedAt:serverTimestamp()
    });
    const eventRef=doc(collection(db,EVENT_COLLECTION));
    tx.set(eventRef,{
      envelopeId:null,
      event:"Signature Application Revoked",
      details:{signatureProfileUid:u.uid,signatureSha256:data.signatureSha256||null,reason:"User-initiated signature application revocation"},
      actorUid:u.uid,
      actorEmail:u.email||"",
      createdAt:serverTimestamp()
    });
  });
  await ensureMySignerIdentity({...current,status:"Revoked",revocationReason:"User-initiated signature application revocation"},{organisationName:IRPA_ORGANISATION});
  return {ok:true,status:"Revoked"};
}

async function fetchServerFilteredSignatureEnvelopes(path){
  const u=user();
  if(!auth.currentUser)throw new Error("Authentication is required to view signing envelopes.");
  const token=await auth.currentUser.getIdToken();
  const response=await fetch(`${GATEWAY_URL}${path}`,{method:"GET",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body?.ok!==true)throw new Error(body?.error||"The Signature Portal could not authorize this workflow view.");
  return body;
}
export async function getSignatureEnvelope(envelopeId){
  user();
  if(!envelopeId)throw new Error("Signing envelope ID is required.");
  const body=await fetchServerFilteredSignatureEnvelopes(`/api/signature-workflow/view?envelopeId=${encodeURIComponent(envelopeId)}`);
  const envelope=body.envelope;
  if(!envelope||!matchesSignatureEnvironment(envelope))throw new Error("This signing envelope belongs to a different data environment and is unavailable in the current portal session.");
  if(["Cancelled","Declined"].includes(envelope.status))throw new Error("This signing envelope is no longer available.");
  return envelope;
}
export async function getSignatureEnvelopes(){
  const body=await fetchServerFilteredSignatureEnvelopes("/api/signature-workflow/list");
  return (Array.isArray(body.envelopes)?body.envelopes:[]).filter(matchesSignatureEnvironment).sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
}
export async function getMySignedDocuments(){const u=user();const q=query(collection(db,"signatures"),where("signerUid","==",u.uid));const s=await getDocs(q);const rows=await Promise.all(s.docs.map(async x=>{const data=x.data();if(!matchesSignatureEnvironment(data))return null;if(data.signerArchiveUrl)return{id:x.id,...data};if(!data.envelopeId)return null;try{const envelopeSnap=await getDoc(doc(db,ENVELOPE_COLLECTION,data.envelopeId));if(!envelopeSnap.exists())return null;const envelope={id:envelopeSnap.id,...envelopeSnap.data()};const delivery=envelope.signerArchiveDeliveries?.[u.uid];if(!delivery?.webViewLink)return null;return{id:x.id,...data,signerArchiveUrl:delivery.webViewLink,signerArchiveFolderId:delivery.folderId||null,signerArchiveFolderLink:delivery.folderLink||null,myDocumentsPortal:delivery.myDocumentsPortal||"My Documents",myDocumentsPortalPath:delivery.myDocumentsPortalPath||null,signerArchiveFinalHash:delivery.finalHash||envelope.signerArchiveFinalHash||null,archivePending:false,archiveProtocol:delivery.archiveProtocol||"IRPA-SIGNER-COPY-V2",archiveState:"Final Completed Document"};}catch(error){console.warn("Unable to resolve completed signer archive delivery:",error);return null;}}));return rows.filter(x=>x&&x.status==="Signed"&&x.signerArchiveUrl).sort((a,b)=>{const at=a.signedAt?.seconds?Number(a.signedAt.seconds):Date.parse(a.signedAt||0);const bt=b.signedAt?.seconds?Number(b.signedAt.seconds):Date.parse(b.signedAt||0);return bt-at;});}
export async function sendSignatureInvitation(envelope, recipient) {
  const u = user();
  if (!envelope?.id) throw new Error("A valid signing envelope is required.");
  if (!recipient?.uid || !recipient?.email) throw new Error("The signer must have a valid account UID and email address.");
  if (!(envelope.participantUids || []).includes(recipient.uid)) throw new Error("The selected signer is not a participant in this envelope.");
  const cleanEmail = String(recipient.email).trim().toLowerCase();
  const result = await sendSignatureMail(envelope, recipient);
  await updateDoc(doc(db, ENVELOPE_COLLECTION, envelope.id), {
    status: envelope.status === "Draft" ? "Sent" : envelope.status,
    invitationStatus: result.deliveryStatus || "Sent",
    invitationSentAt: serverTimestamp(),
    invitationSentByUid: u.uid,
    invitationSentByEmail: u.email || "",
    updatedAt: serverTimestamp()
  });
  await recordEnvelopeEvent(envelope.id, "Signing Invitation Sent", {
    signerUid: recipient.uid, signerEmail: cleanEmail, signerName: recipient.name || "",
    deliveryStatus: result.deliveryStatus || "Sent"
  });
  return {...result,envelopeId:envelope.id,signerUid:recipient.uid,signerEmail:cleanEmail,emailRequested:true};
}

export async function saveSignatureWorkflowDraft({envelopeId,title,documentId,documentReference,documentUrl,documentClassification="Public",documentArchiveCategory="Administrative Documents",documentType="Governance Document",documentUploadedAt=null,authorizationRequestId=null,authorizationReference="",signingMode,recipients,fields,ownerSigningEnabled=true}){signingMode=requireSupportedSignatureRoutingMode(signingMode);const u=user();const workflowContext=readWorkflowContext();authorizationRequestId=authorizationRequestId||workflowContext?.authorizationRequestId||null;authorizationReference=authorizationReference||workflowContext?.authorizationReference||"";if(!title?.trim())throw new Error("Envelope title is required.");if(!documentId||!documentUrl)throw new Error("Select a controlled PDF before saving the workflow.");const sourceDocument=await getDoc(doc(db,"documents",documentId));if(!sourceDocument.exists())throw new Error("The selected controlled document could not be found.");const sourceDocumentData=sourceDocument.data()||{};const recordOrigin=String(sourceDocumentData.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION";const owner={uid:u.uid,name:u.displayName||u.email||"Document Owner",email:u.email||"",role:"Document Owner",routingOrder:1,status:"Pending",optionalSigning:!ownerSigningEnabled,actionRequired:ownerSigningEnabled};const supplied=(recipients||[]).filter(r=>r?.uid&&r.uid!==u.uid).map((r,i)=>({...r,accessOnly:isViewOnlyRecipient(r),routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}));const orderedRecipients=[owner,...supplied];const participantUids=orderedRecipients.map(r=>r.uid).filter(Boolean);const actionUids=[...new Set((fields||[]).map(f=>f?.signerUid).filter(Boolean))];const viewOnlyUids=new Set(orderedRecipients.filter(isViewOnlyRecipient).map(r=>r.uid));if((fields||[]).some(f=>f?.signerUid&&viewOnlyUids.has(f.signerUid)))throw new Error("View-only recipients cannot receive action fields.");const id=envelopeId||`IRPA-ENV-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;const payload={envelopeReference:id,title:title.trim(),documentId,documentReference:documentReference||"",documentUrl,sha256:sourceSha256,byteLength:sourceByteLength,senderUid:u.uid,senderEmail:u.email||"",ownerUid:u.uid,ownerName:owner.name,ownerEmail:owner.email,recordOrigin,trialData:recordOrigin==="TRIAL",documentClassification:documentClassification||"Public",status:"Draft",signingMode:signingMode||"Sequential",recipients:orderedRecipients,fields:(fields||[]).map(field=>{const prepared={...field,page:Number(field?.page||1),x:Number(field?.x??10),y:Number(field?.y??12),width:Number(field?.width??24),height:Number(field?.height??9)};if(["Signature","Initials"].includes(prepared.type)){delete prepared.value;delete prepared.signatureData;delete prepared.signatureUrl;delete prepared.signatureValue;}return prepared;}),participantUids,actionUids,currentSignerUid:ownerSigningEnabled?u.uid:(orderedRecipients.find(isActionRecipient)?.uid||null),ownerSectionSaved:true,documentClassification:documentClassification||"Public",documentArchiveCategory:documentArchiveCategory||"Administrative Documents",documentType:documentType||"Governance Document",documentUploadedAt:documentUploadedAt||sourceDocumentData.uploadedAt||sourceDocumentData.documentTypeSelectedAt||null,documentUploadDestinationKey:sourceDocumentData.documentUploadDestinationKey||null,authorizationRequestId:authorizationRequestId||null,authorizationReference:authorizationReference||null,updatedAt:serverTimestamp()};if(!envelopeId)payload.createdAt=serverTimestamp();const token=await u.getIdToken();const toIso=value=>{if(value&&typeof value.toDate==="function")return value.toDate().toISOString();if(value&&Number.isFinite(Number(value.seconds)))return new Date(Number(value.seconds)*1000+Number(value.nanoseconds||0)/1e6).toISOString();return typeof value==="string"?value:null};const workerDraft={...payload,updatedAt:new Date().toISOString(),documentUploadedAt:toIso(payload.documentUploadedAt),...(payload.createdAt?{createdAt:new Date().toISOString()}:{})};let response;try{response=await fetch(`${GATEWAY_URL}/api/signature-workflow/draft`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({draft:workerDraft,ownerSigningEnabled})});}catch(error){throw new Error("STEP Worker draft save failed: "+(error?.message||"The authenticated gateway request failed."));}const result=await response.json().catch(()=>({}));if(!response.ok||result.ok!==true){const d=result.diagnostics||{};throw new Error(`STEP ${d.step||result.step||"Worker draft save"} (${ENVELOPE_COLLECTION}/${id}) failed: HTTP ${response.status}; Firestore HTTP ${d.firestoreHttpStatus??"n/a"}; Google status ${d.googleStatus||"UNKNOWN"}; ${d.googleMessage||result.error||"No diagnostic detail"}`);}return{id,...(result.draft||workerDraft)};}

export async function finalizeSignatureWorkflowDraft(args){
  if(!args?.envelopeId)throw new Error("A saved signature draft is required.");
  return saveSignatureWorkflowDraft(args);
}

export async function startSignatureWorkflow(envelope){
  requireSupportedSignatureRoutingMode(envelope?.signingMode);
  const u=user();
  if(!envelope?.id)throw new Error("A valid workflow envelope is required.");
  if(envelope.senderUid!==u.uid&&envelope.ownerUid!==u.uid)throw new Error("Only the document owner can start this workflow.");
  if(envelope.status!=="Draft")return envelope;
  const current=(envelope.recipients||[]).find(r=>r.uid===envelope.currentSignerUid);
  const actionRecipients=(envelope.recipients||[]).filter(isActionRecipient);
  let gateway=null;
  if(CRYPTOGRAPHIC_GATEWAY_BRIDGE_ENABLED){
    if(envelope.gatewayEnvelopeId){
      gateway={gatewayEnvelopeId:envelope.gatewayEnvelopeId,gatewayDocumentId:envelope.gatewayDocumentId||null,gatewayOriginalHash:envelope.gatewayOriginalHash||null,gatewaySigningStatus:envelope.gatewaySigningStatus||"Sent",existing:true};
    }else{
      const sourceBytes=await fetchBytes(envelope.documentUrl,envelope.documentId,envelope.id);
      gateway=await createGatewaySignatureEnvelope({envelope,sourceBytes});
    }
  }
  const update={
    status:envelope.currentSignerUid?"In Progress":"Shared",
    workflowStartedAt:serverTimestamp(),
    workflowStartedByUid:u.uid,
    updatedAt:serverTimestamp(),
    ...(gateway?{
      gatewayEnvelopeId:gateway.gatewayEnvelopeId,
      gatewayDocumentId:gateway.gatewayDocumentId,
      gatewayOriginalHash:gateway.gatewayOriginalHash,
      gatewaySigningStatus:gateway.gatewaySigningStatus||"Sent",
      gatewayBridgeStatus:"Connected",
      gatewayEvidenceSchema:"IRPA-CRYPTOGRAPHIC-EVIDENCE-1"
    }:{})
  };
  try{
    await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),update);
  }catch(error){
    if(gateway?.gatewayEnvelopeId&&!gateway.existing){
      try{await voidGatewaySignatureEnvelope(gateway.gatewayEnvelopeId,"Firebase Signature Portal link could not be committed");}
      catch(rollbackError){console.error("Gateway envelope rollback failed; preserve the Gateway reference for reconciliation.",{gatewayEnvelopeId:gateway.gatewayEnvelopeId,message:rollbackError?.message||"rollback failed"});}
    }
    throw error;
  }
  if(!gateway&&current&&current.uid!==u.uid&&current.email)await releaseNextSigner({...envelope,...update},current);
  await recordEnvelopeEvent(envelope.id,"Workflow Started",{
    ownerUid:u.uid,
    currentSignerUid:envelope.currentSignerUid||null,
    currentSignerName:current?.name||"",
    requiredActionCount:actionRecipients.length,
    gatewayEnvelopeId:gateway?.gatewayEnvelopeId||null,
    gatewayBridgeStatus:gateway?"Connected":"Not Enabled"
  });
  return{...envelope,...update,...(gateway||{})};
}

export async function createSignatureEnvelope({title,documentId,documentReference,documentUrl,documentClassification="Public",documentArchiveCategory="Administrative Documents",documentType="Governance Document",documentUploadedAt=null,authorizationRequestId=null,authorizationReference="",signingMode,recipients,fields=[]}){signingMode=requireSupportedSignatureRoutingMode(signingMode);const u=user();const workflowContext=readWorkflowContext();authorizationRequestId=authorizationRequestId||workflowContext?.authorizationRequestId||null;authorizationReference=authorizationReference||workflowContext?.authorizationReference||"";if(!title?.trim())throw new Error("Envelope title is required.");if(!documentId)throw new Error("An authorized document must be selected.");if(!documentUrl)throw new Error("The selected document has no PDF file URL. Upload/link the controlled PDF before sending for signature.");const sourceDocumentSnap=await getDoc(doc(db,"documents",documentId));if(!sourceDocumentSnap.exists())throw new Error("The selected controlled document could not be found in the register.");const sourceDocumentData=sourceDocumentSnap.data()||{};let sourceSha256=sourceDocumentData.sha256||sourceDocumentData.hash||null;let sourceByteLength=sourceDocumentData.fileSize??sourceDocumentData.byteLength??sourceDocumentData.size??null;if(!sourceSha256||sourceByteLength==null){const sourceFileId=sourceDocumentData.fileId||sourceDocumentData.driveFileId||sourceDocumentData.archiveFileId||sourceDocumentData.sourceFileId||(String(documentUrl).startsWith("drive://")?String(documentUrl).slice(8):"");if(sourceFileId){const sourceBytes=await downloadControlledDocumentBytes(sourceFileId,documentId);const actualHash=await hashBytes(sourceBytes);if(sourceSha256&&String(sourceSha256).toLowerCase()!==actualHash)throw new Error("The source document SHA-256 does not match its registered integrity metadata.");if(sourceByteLength!=null&&Number(sourceByteLength)!==sourceBytes.byteLength)throw new Error("The source document byte length does not match its registered integrity metadata.");sourceSha256=sourceSha256||actualHash;sourceByteLength=sourceByteLength??sourceBytes.byteLength;}}const recordOrigin=String(sourceDocumentData.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION";if(!recipients?.length)throw new Error("At least the document owner is required.");const envelopeId=`IRPA-ENV-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;const owner={...(recipients.find(r=>r?.uid===u.uid)||{}),uid:u.uid,name:u.displayName||u.email||"Document Owner",email:u.email||"",role:"Document Owner",routingOrder:1,status:"Pending"};const supplied=recipients.filter(r=>r?.uid&&r.uid!==u.uid);const orderedRecipients=[owner,...supplied.map((r,i)=>({...r,accessOnly:isViewOnlyRecipient(r),routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}))];const participantUids=orderedRecipients.map(r=>r.uid).filter(Boolean);const viewOnlyUids=new Set(orderedRecipients.filter(isViewOnlyRecipient).map(r=>r.uid));if((fields||[]).some(f=>f?.signerUid&&viewOnlyUids.has(f.signerUid)))throw new Error("View-only recipients cannot be assigned action fields. Assign fields only to the document owner or an action officer.");const actionUids=[...new Set((fields||[]).map(f=>f?.signerUid).filter(Boolean))];const firstActionRecipient=orderedRecipients.find(isActionRecipient);const payload={envelopeReference:envelopeId,title:title.trim(),documentId,documentReference:documentReference||"",documentUrl,senderUid:u.uid,senderEmail:u.email||"",ownerUid:u.uid,ownerName:owner.name,ownerEmail:owner.email,recordOrigin,trialData:recordOrigin==="TRIAL",documentClassification:documentClassification||"Public",documentArchiveCategory:documentArchiveCategory||"Administrative Documents",documentType:documentType||"Governance Document",documentUploadedAt:documentUploadedAt||null,authorizationRequestId:authorizationRequestId||null,authorizationReference:authorizationReference||null,status:"Draft",signingMode:signingMode||"Sequential",recipients:orderedRecipients,fields:(fields||[]).map(field=>{const prepared={...field,page:Number(field?.page||1),x:Number(field?.x??10),y:Number(field?.y??12),width:Number(field?.width??24),height:Number(field?.height??9)};if(["Signature","Initials"].includes(prepared.type)){delete prepared.value;delete prepared.signatureData;delete prepared.signatureUrl;delete prepared.signatureValue;}return prepared;}),participantUids,actionUids,currentSignerUid:signingMode==="Sequential"?(firstActionRecipient?.uid||null):null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};const batch=writeBatch(db);batch.set(doc(db,ENVELOPE_COLLECTION,envelopeId),payload);batch.update(doc(db,"documents",documentId),{signatureEnvelopeId:envelopeId,signatureReference:envelopeId,signatureStatus:"Draft",signatureOwnerUid:u.uid,workflowOwnerSectionSaved:true,authorizationRequestId:authorizationRequestId||null,authorizationReference:authorizationReference||null,updatedAt:serverTimestamp()});await batch.commit();await recordEnvelopeEvent(envelopeId,"Envelope Created",{status:"Draft",ownerUid:u.uid,signingOrder:orderedRecipients.map(r=>({uid:r.uid,name:r.name,email:r.email,routingOrder:r.routingOrder,role:r.role,accessOnly:isViewOnlyRecipient(r),actionRequired:isActionRecipient(r)}))});const viewOnlyRecipients=orderedRecipients.filter(isViewOnlyRecipient);if(viewOnlyRecipients.length)await Promise.all(viewOnlyRecipients.map(r=>releaseViewOnlyRecipient({...payload,id:envelopeId},r).catch(async error=>{await recordEnvelopeEvent(envelopeId,"View-Only Invitation Failed",{signerUid:r.uid,signerEmail:r.email,error:error?.message||"Unable to send view-only invitation"});return null;})));return{id:envelopeId,...payload};}
export async function syncGatewaySigningMirror(envelopeId,gatewayStatus){
  const u=user();
  if(!envelopeId||gatewayStatus?.externalReference!==envelopeId)throw new Error("Gateway status does not match the Signature Portal envelope.");
  if(gatewayStatus.auditChainValid!==true)throw new Error("The Gateway audit chain did not verify. The Signature Portal status will not be synchronized.");
  const ref=doc(db,ENVELOPE_COLLECTION,envelopeId),snap=await getDoc(ref);
  if(!snap.exists())throw new Error("The Signature Portal envelope no longer exists.");
  const envelope={id:snap.id,...snap.data()};
  if(!Array.isArray(envelope.participantUids)||!envelope.participantUids.includes(u.uid))throw new Error("You are not assigned to this Signature Portal envelope.");
  if(!envelope.gatewayEnvelopeId||envelope.gatewayEnvelopeId!==gatewayStatus.envelopeId)throw new Error("The Gateway envelope ID does not match the linked Signature Portal record.");
  if(envelope.gatewayOriginalHash&&gatewayStatus.documentHash!==envelope.gatewayOriginalHash)throw new Error("The Gateway source PDF hash does not match the linked Signature Portal document.");
  if(gatewayStatus.status==="Completed"&&(!gatewayStatus.completion?.finalHash||!Array.isArray(gatewayStatus.completion?.cryptographicEvidenceIds)||gatewayStatus.completion.cryptographicEvidenceIds.length===0))throw new Error("The Gateway completion record has no verified PDF hash or cryptographic evidence reference.");
  const gatewaySigners=Array.isArray(gatewayStatus.signers)?gatewayStatus.signers:[];
  const recipients=(envelope.recipients||[]).map(recipient=>{
    const signer=gatewaySigners.find(item=>item.uid&&item.uid===recipient.uid);
    if(!signer)return recipient;
    const status=signer.status==="Signed"?"Signed":signer.status==="Declined"?"Declined":signer.status==="Pending"?(gatewayStatus.signingMode==="Parallel"?"Pending":recipient.uid===gatewaySigners.filter(x=>x.status==="Pending").sort((a,b)=>a.order-b.order)[0]?.uid?"Current":"Pending"):recipient.status;
    return {...recipient,status,completedAt:signer.signedAt||recipient.completedAt||null};
  });
  const pending=gatewaySigners.filter(x=>x.status==="Pending").sort((a,b)=>a.order-b.order);
  const overall=gatewayStatus.status==="Completed"?"Completed":gatewayStatus.status==="Declined"?"Declined":gatewayStatus.status==="Voided"?"Cancelled":"In Progress";
  const patch={
    recipients,
    status:overall,
    currentSignerUid:gatewayStatus.signingMode==="Parallel"?null:(pending[0]?.uid||null),
    gatewaySigningStatus:gatewayStatus.status,
    gatewayFinalHash:gatewayStatus.completion?.finalHash||null,
    gatewayCryptographicEvidenceIds:gatewayStatus.completion?.cryptographicEvidenceIds||[],
    gatewayAuditChainValid:true,
    gatewayStatusUpdatedAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  };
  await updateDoc(ref,patch);
  await recordEnvelopeEvent(envelopeId,"Gateway Signing Status Verified",{
    gatewayEnvelopeId:gatewayStatus.envelopeId,
    gatewayStatus:gatewayStatus.status,
    gatewayFinalHash:gatewayStatus.completion?.finalHash||null,
    cryptographicEvidenceCount:(gatewayStatus.completion?.cryptographicEvidenceIds||[]).length,
    auditChainValid:true
  });
  return {...envelope,...patch};
}

export async function recordEnvelopeEvent(envelopeId,event,details={}){const u=user();await setDoc(doc(collection(db,EVENT_COLLECTION)),{envelopeId,event,details,actorUid:u.uid,actorEmail:u.email||"",createdAt:serverTimestamp()});}
async function fetchBytes(url,documentId=null,envelopeId=null){const value=String(url||"");if(value.startsWith("drive://"))return downloadSignatureBytes(value.slice("drive://".length),documentId,envelopeId);const r=await fetch(value);if(!r.ok)throw new Error(`Unable to retrieve the controlled PDF (${r.status}).`);return new Uint8Array(await r.arrayBuffer());}
async function embedImage(pdfDoc,url){const bytes=await fetchBytes(url);const lower=url.toLowerCase();if(lower.includes(".jpg")||lower.includes(".jpeg"))return pdfDoc.embedJpg(bytes);return pdfDoc.embedPng(bytes);}
function pageSignatureManifest(pdf,records,paneId,profile,u,signedAt){
  const meta=pdf.setTitle ? null : null;
  // The visible signature pane is rendered in each assigned signature field;
  // this manifest is retained in the transaction record and binds those fields
  // to the signed PDF hash.
  return {paneId,records,signedAt,signerUid:u.uid,signerName:profile?.displayName||u.displayName||u.email||""};
}
function drawField(page,font,field,value){const{width,height}=page.getSize();const x=(Number(field.x||10)/100)*width;const y=height-((Number(field.y||80)/100)*height)-(Number(field.height||8)/100)*height;const w=(Number(field.width||22)/100)*width;const h=(Number(field.height||8)/100)*height;const size=Math.max(8,Math.min(18,h*.65));if(field.type==="Text"||field.type==="Name"||field.type==="Date"){page.drawText(String(value||""),{x,y:y+h*.2,size,font,color:rgb(0.05,0.05,0.08),maxWidth:w});}else if(field.type==="Checkbox"){page.drawRectangle({x,y,width:Math.min(w,h),height:Math.min(w,h),borderWidth:1,borderColor:rgb(0.1,0.1,0.1)});page.drawText("X",{x:x+2,y:y+1,size,font,color:rgb(0,0,0)});}}
export async function previewEnvelopeSigning(envelope,profile,fieldValues={}){const u=user();if(profile?.status!=="Active")throw new Error("Your Signature Application is not active. Activate your Signature Profile before signing.");if(!envelope?.documentUrl)throw new Error("This envelope has no controlled PDF URL.");if(!envelope.participantUids?.includes(u.uid))throw new Error("You are not a participant in this signing envelope.");const recipient=(envelope.recipients||[]).find(r=>r?.uid===u.uid);if(!recipient)throw new Error("You are not assigned to this workflow.");const signerIdentity=await getMySignerIdentity();if(!signerIdentity?.authorityRole||signerIdentity.authorityRole==="Not yet assigned")throw new Error("Your current signing authority has not been registered. Update your Signer Identity capacity before signing.");if(signerIdentity.authorityStatus!=="Current")throw new Error(`Your signing authority is ${signerIdentity.authorityStatus||"not verified"}. A Current authority is required to sign.`);if(isViewOnlyRecipient(recipient))throw new Error("This role has view-only access. No signature preview is required.");if(envelope.signingMode==="Sequential"&&envelope.currentSignerUid&&envelope.currentSignerUid!==u.uid)throw new Error("This envelope is waiting for another officer.");const source=await fetchBytes(envelope.signedDocumentUrl||envelope.documentUrl,envelope.documentId,envelope.id);const pdf=await PDFDocument.load(source);const font=await pdf.embedFont(StandardFonts.Helvetica);const signature=null;const initials=null;const signerFields=(envelope.fields||[]).filter(f=>f?.signerUid===u.uid);if(!signerFields.length)throw new Error("This signing task is assigned to another officer. Your profile is not authorized to execute it.");const requiresSignature=signerFields.some(f=>f.type==="Signature"||f.type==="Initials");for(const field of signerFields){const page=pdf.getPages()[Math.max(0,Number(field.page||1)-1)];if(!page)continue;const{width,height}=page.getSize();const x=(Number(field.x||10)/100)*width;const y=height-((Number(field.y||80)/100)*height)-(Number(field.height||8)/100)*height;const w=(Number(field.width||24)/100)*width;const h=(Number(field.height||9)/100)*height;if((field.type==="Signature"||field.type==="Initials")&&String(fieldValues[field.fieldId]||"").startsWith("data:image/png;base64,")){const ink=await embedImage(pdf,fieldValues[field.fieldId]);page.drawImage(ink,{x,y,width:w,height:h});}else if(field.type==="Signature"||field.type==="Initials"){/* Keep the unfilled field in envelope metadata; never paint an opaque placeholder into the PDF. */}else if(field.type==="Signature"&&signature){
  page.drawRectangle({x,y,width:w,height:h,borderWidth:0.8,borderColor:rgb(0.15,0.15,0.15)});
  page.drawImage(signature,{x:x+2,y:y+Math.max(2,h*0.14),width:Math.max(1,w-4),height:Math.max(1,h*0.62)});
  page.drawText("IRPA ELECTRONIC SIGNATURE",{x:x+3,y:y+2,size:Math.max(5,Math.min(7,h*0.08)),font,color:rgb(0.08,0.08,0.08),maxWidth:w-6});
}else if(field.type==="Initials"&&initials){
  page.drawRectangle({x,y,width:w,height:h,borderWidth:0.8,borderColor:rgb(0.15,0.15,0.15)});
  page.drawImage(initials,{x:x+2,y:y+Math.max(2,h*0.16),width:Math.max(1,w-4),height:Math.max(1,h*0.62)});
}else{
  const value=fieldValues[field.fieldId]??(field.type==="Name"?(profile?.displayName||u.displayName||u.email||""):field.type==="Date"?new Date().toLocaleDateString():fieldValues[field.fieldId]||"");
  drawField(page,font,field,value);
}}return await pdf.save();}


function readGatewaySigningToken(){
  try{return typeof window!=="undefined"?new URLSearchParams(window.location.search).get("gatewayToken")||"":"";}
  catch{return "";}
}
async function signatureProfilePngDataUrl(url){
  if(!url)return "";
  const bytes=await fetchBytes(url);
  if(bytes.length<8||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw new Error("The Gateway requires the authorized signer specimen as a PNG image. Re-save the Signature Profile specimen as PNG before signing.");
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return "data:image/png;base64,"+btoa(binary);
}
async function signEnvelopeThroughGateway({envelope,profile,fieldValues,manualAuthorityIdentification,recipient,signerFields,signerAuthority,authorityVerification,u}){
  const token=readGatewaySigningToken();
  if(!token)throw new Error("Cryptographic Gateway signing is enabled, but this session has no Gateway invitation token. Open the authenticated Gateway signing invitation; legacy Firebase signing is disabled for this workflow.");
  const status=await fetchGatewaySigningStatus(token);
  const expectedDocumentId=("DOC-"+String(envelope.id)).replace(/[^A-Za-z0-9_-]/g,"-").slice(0,64);
  if(status.externalReference!==envelope.id||status.documentId!==expectedDocumentId||status.signer?.uid!==u.uid||status.envelopeId!==envelope.gatewayEnvelopeId){
    throw new Error("The Gateway signing token does not match this Firebase envelope, controlled document, and authenticated signer.");
  }
  if(status.signingMode!==envelope.signingMode)throw new Error("The Gateway signing route differs from the authorized Signature Portal route. Signing has been blocked.");
  const fieldApplications=signerFields.filter(field=>["Signature","Initials"].includes(field.type)).map(field=>{const value=fieldValues?.[field.fieldId];if(typeof value!=="string"||!value.startsWith("data:image/png;base64,")){if(field.required)throw new Error("Tap the assigned "+field.type.toLowerCase()+" field and confirm it before signing.");return null;}return{fieldId:field.fieldId,confirmed:true,page:Number(field.page||1),x:Number(field.x??0),y:Number(field.y??0),width:Number(field.width??24),height:Number(field.height??9),value};}).filter(Boolean);
  if(!fieldApplications.length)throw new Error("Tap your assigned signature field and confirm it before signing.");
  const signatureValue=fieldApplications.find(application=>signerFields.find(field=>field.fieldId===application.fieldId)?.type==="Signature")?.value||fieldApplications[0].value;
  const signature={type:"drawn",value:signatureValue};
  const gatewayFields={};
  for(const field of signerFields){
    const supplied=fieldValues?.[field.fieldId];
    if(field.type==="Signature"||field.type==="Initials"){
      if(typeof supplied==="string"&&supplied.startsWith("data:image/png;base64,"))gatewayFields[field.fieldId]=supplied;
    }else if(supplied!==undefined&&supplied!==null)gatewayFields[field.fieldId]=supplied;
    else if(field.type==="Name")gatewayFields[field.fieldId]=profile?.displayName||u.displayName||u.email||"";
    else if(field.type==="Date")gatewayFields[field.fieldId]=new Date().toISOString().slice(0,10);
  }
  const submission=await submitGatewaySignature({token,signature,fieldValues:gatewayFields,fieldApplications,signatureConfirmed:true,consent:true,manualAuthorityIdentification:authorityVerification.manualAuthorityIdentification||manualAuthorityIdentification||""});
  const after=await fetchGatewaySigningStatus(token);
  if(after.envelopeId!==status.envelopeId||after.signer?.uid!==u.uid||after.signer?.status!=="Signed")throw new Error("Gateway did not persist the authenticated signer action. No Firebase completion was recorded.");
  const gatewaySigners=Array.isArray(after.signers)?after.signers:[];
  const nextGatewaySigner=gatewaySigners.find(s=>s.status!=="Signed");
  const completed=after.status==="Completed";
  let signedUrl=envelope.signedDocumentUrl||envelope.documentUrl;
  let finalHash=null;
  let evidence=null;
  if(completed){
    const signedBytes=await fetchGatewaySigningResource("/api/sign/pdf",token,{pdf:true});
    const pdfCheck=await verifyGatewaySignedPdf({token,bytes:signedBytes});
    if(pdfCheck.envelopeId!==after.envelopeId||pdfCheck.documentHash!==after.completion?.finalHash||!pdfCheck.verified)throw new Error("The completed PDF hash does not match the Gateway envelope completion record.");
    evidence=await fetchGatewaySigningResource("/api/sign/evidence",token);
    if(evidence.envelopeId!==after.envelopeId||evidence.documentHash!==pdfCheck.documentHash||evidence.auditChainValid!==true||!Array.isArray(evidence.evidence)||!evidence.evidence.length||evidence.evidence.some(e=>e.signerUid!==u.uid))throw new Error("Persisted cryptographic evidence does not verify for this envelope, final PDF, authenticated signer, and audit chain.");
    finalHash=pdfCheck.documentHash;
    const archive=await ensureSignedDocumentArchive({documentId:envelope.documentId,title:envelope.title||envelope.documentReference,reference:envelope.documentReference||envelope.documentId,archiveCategory:envelope.documentArchiveCategory||"Administrative Documents",classification:envelope.documentClassification||"Restricted",documentType:envelope.documentType||"Governance Document",uploadedAt:envelope.documentUploadedAt||null});
    const target=ref(null,`signatureEnvelopes/${envelope.id}/gateway-final-${finalHash}.pdf`);
    await uploadBytes(target,new Blob([signedBytes],{type:"application/pdf"}),{contentType:"application/pdf",purpose:"Signed Documents Archive",folderId:archive.folderId,customMetadata:{envelopeId:envelope.id,gatewayEnvelopeId:after.envelopeId,signerUid:u.uid,finalHash,documentId:envelope.documentId,archiveProtocol:"IRPA-GATEWAY-CRYPTOGRAPHIC-EVIDENCE-1"}});
    signedUrl=await getDownloadURL(target);
  }
  const updatedRecipients=(envelope.recipients||[]).map(r=>{
    const gs=gatewaySigners.find(s=>s.uid===r.uid);
    if(!gs)return r;
    return {...r,status:gs.status==="Signed"?"Signed":(!completed&&envelope.signingMode!=="Parallel"&&nextGatewaySigner?.uid===r.uid?"Current":(r.status||"Pending")),completedAt:gs.signedAt||r.completedAt||null};
  });
  const actionRecord={uid:u.uid,name:profile?.displayName||u.displayName||u.email||"Signer",email:u.email||"",role:recipient.role||"Action",completedAt:new Date().toISOString(),fields:signerFields.map(f=>({fieldId:f.fieldId,type:f.type,value:fieldValues?.[f.fieldId]??""})),signatureAuthority:authorityVerification.authorityRole||signerAuthority.authorityRole,authorityVerificationStatus:"Verified",gatewayEnvelopeId:after.envelopeId,gatewaySignerId:after.signer?.id,cryptographicEvidenceStatus:completed?"Verified":"Pending completion"};
  const update={status:completed?"Completed":"In Progress",recipients:updatedRecipients,lastSignedByUid:u.uid,lastSignedAt:serverTimestamp(),workflowHistory:arrayUnion(actionRecord),gatewaySigningStatus:after.status,gatewayBridgeStatus:"Connected",gatewayLastSignerUid:u.uid,gatewayEvidenceStatus:completed?"Verified":"Awaiting all required signatures",gatewayAuditChainValid:completed?evidence.auditChainValid:null,updatedAt:serverTimestamp(),...(completed?{signedDocumentUrl:signedUrl,ownerCompletedDocumentUrl:signedUrl,latestDocumentHash:finalHash,originalDocumentHash:status.documentHash,completedAt:serverTimestamp(),signerArchiveStatus:"Gateway PDF and evidence verified"}:{currentSignerUid:envelope.signingMode==="Sequential"?(nextGatewaySigner?.uid||null):null})};
  await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),update);
  if(completed)await updateDoc(doc(db,"documents",envelope.documentId),{workflowActionStatus:"Signed",lastWorkflowAction:recipient.role||"Action",lastWorkflowActionUid:u.uid,lastWorkflowActionAt:serverTimestamp(),completedDocumentUrl:signedUrl,ownerCompletedDocumentUrl:signedUrl,ownerRecordStatus:"Completed",lastCompletedDocumentHash:finalHash,updatedAt:serverTimestamp()});
  await setDoc(doc(db,"signatures",`gateway-${envelope.id}-${u.uid}`),{envelopeId:envelope.id,documentId:envelope.documentId,signerUid:u.uid,signerEmail:u.email||"",signerName:profile?.displayName||u.displayName||u.email||"Signer",workflowRole:recipient.role||"Action",signatureAuthority:authorityVerification.authorityRole||signerAuthority.authorityRole,signatureAuthorityVerificationStatus:"Verified",signatureStatus:"Signed",status:"Signed",signedAt:serverTimestamp(),gatewayEnvelopeId:after.envelopeId,gatewaySignerId:after.signer?.id,gatewayDocumentHash:completed?finalHash:null,cryptographicEvidenceStatus:completed?"Verified":"Pending completion",immutable:true},{merge:true});
  await recordEnvelopeEvent(envelope.id,"Gateway Signature Submitted",{signerUid:u.uid,gatewayEnvelopeId:after.envelopeId,gatewayStatus:after.status,completed,finalDocumentHash:finalHash,evidenceVerified:completed,auditChainValid:completed?evidence.auditChainValid:null,idempotent:submission.idempotent===true});
  return {...envelope,...update,id:envelope.id,gatewayEnvelopeId:after.envelopeId,gatewayCompletion:after.completion||null,gatewayEvidence:evidence||null};
}

export async function signEnvelope(envelope,profile,fieldValues={},manualAuthorityIdentification=""){const u=user();if(profile?.status!=="Active")throw new Error("Your Signature Application is not active. Activate your Signature Profile before signing.");if(!u?.uid||!u?.email)throw new Error("Your secure signing session has expired. Sign in again before signing this document.");if(!envelope?.documentUrl)throw new Error("This envelope has no controlled PDF URL.");if(!envelope.participantUids?.includes(u.uid))throw new Error("You are not a participant in this signing envelope.");const recipient=(envelope.recipients||[]).find(r=>r?.uid===u.uid);if(!recipient)throw new Error("You are not assigned to this workflow.");const signerAuthority=await getMySignerIdentity();if(!signerAuthority?.authorityRole||signerAuthority.authorityRole==="Not yet assigned")throw new Error("Your current signing authority has not been registered. Update your Signer Identity capacity before signing.");if(signerAuthority.authorityStatus!=="Current")throw new Error(`Your signing authority is ${signerAuthority.authorityStatus||"not verified"}. A Current authority is required to sign.`);const authorityVerification=await verifyManualSigningAuthority(manualAuthorityIdentification);if(isViewOnlyRecipient(recipient))throw new Error("This role has view-only access. No action or signature is required.");if(envelope.signingMode==="Sequential"&&envelope.currentSignerUid&&envelope.currentSignerUid!==u.uid)throw new Error("This envelope is waiting for another officer.");const signerFields=(envelope.fields||[]).filter(f=>f?.signerUid===u.uid);if(!signerFields.length)throw new Error("This signing task is assigned to another officer. Your profile is not authorized to execute it.");const requiresSignature=signerFields.some(f=>f.type==="Signature"||f.type==="Initials");if(requiresSignature&&signerFields.some(f=>["Signature","Initials"].includes(f.type)&&f.required&&!String(fieldValues?.[f.fieldId]||"").startsWith("data:image/png;base64,")))throw new Error("Tap each required signature field and confirm it before signing.");if(CRYPTOGRAPHIC_GATEWAY_BRIDGE_ENABLED)return await signEnvelopeThroughGateway({envelope,profile,fieldValues,manualAuthorityIdentification,recipient,signerFields,signerAuthority,authorityVerification,u});const source=await fetchBytes(envelope.signedDocumentUrl||envelope.documentUrl,envelope.documentId,envelope.id);const originalHash=await hashBytes(source);const pdf=await PDFDocument.load(source);const font=await pdf.embedFont(StandardFonts.Helvetica);const signature=profile?.signatureUrl?await embedImage(pdf,profile.signatureUrl):null;const initials=profile?.initialsUrl?await embedImage(pdf,profile.initialsUrl):null;for(const field of signerFields){const page=pdf.getPages()[Math.max(0,Number(field.page||1)-1)];if(!page)continue;const{width,height}=page.getSize();const x=(Number(field.x||10)/100)*width;const y=height-((Number(field.y||80)/100)*height)-(Number(field.height||8)/100)*height;const w=(Number(field.width||24)/100)*width;const h=(Number(field.height||9)/100)*height;if((field.type==="Signature"||field.type==="Initials")&&String(fieldValues?.[field.fieldId]||"").startsWith("data:image/png;base64,")){const confirmedImage=await embedImage(pdf,fieldValues[field.fieldId]);page.drawImage(confirmedImage,{x,y,width:w,height:h});}else if(field.type==="Signature"||field.type==="Initials"){if(field.required)throw new Error("Tap and confirm the assigned "+field.type.toLowerCase()+" field before signing.");}else{const value=fieldValues[field.fieldId]??(field.type==="Name"?(profile?.displayName||u.displayName||u.email||""):field.type==="Date"?new Date().toLocaleDateString():fieldValues[field.fieldId]||"");drawField(page,font,field,value);}}const signaturePaneRecords=signerFields.filter(f=>f?.type==="Signature"||f?.type==="Initials").map(f=>({fieldId:f.fieldId||null,type:f.type,page:Number(f.page||1),x:Number(f.x||10),y:Number(f.y||80),width:Number(f.width||24),height:Number(f.height||9),signatureAssetHash:profile?.signatureHash||profile?.signatureSha256||null}));
const signaturePaneId=`IRPA-SP-${envelope.id}-${u.uid}-${Date.now()}`;
const signedAt=new Date().toISOString();
pageSignatureManifest(pdf,signaturePaneRecords,signaturePaneId,profile,u,signedAt);
const signedBytes=await pdf.save();const finalHash=await hashBytes(signedBytes);const signerIdentity=await ensureMySignerIdentity(profile,{organisationName:IRPA_ORGANISATION});await recordSignerAuthenticationEvidence(signerIdentity.id,{context:"Signature signing ceremony"});const workingFolder=await ensureSignatureWorkflowFolder(envelope.id);const signedDocumentArchive=await ensureSignedDocumentArchive({documentId:envelope.documentId,title:envelope.title||envelope.documentReference||envelope.documentId,reference:envelope.documentReference||envelope.documentId,archiveCategory:envelope.documentArchiveCategory||"Administrative Documents",classification:envelope.documentClassification||"Public",documentType:envelope.documentType||"Governance Document",uploadedAt:envelope.documentUploadedAt||null});const path=`signatureEnvelopes/${envelope.id}/signed-${u.uid}-${finalHash}.pdf`;const storageRef=ref(null,path);await uploadBytes(storageRef,signedBytes,{contentType:"application/pdf",purpose:"Signed Documents Archive",folderId:signedDocumentArchive.folderId,customMetadata:{envelopeId:envelope.id,signerUid:u.uid,originalHash,finalHash,workflowRole:recipient.role||"Action",documentId:envelope.documentId,documentUid:envelope.documentId,workingFolderId:workingFolder.folderId,signedDocumentArchiveFolderId:signedDocumentArchive.folderId,signedDocumentArchiveFolderLink:signedDocumentArchive.archiveUidLink,signedDocumentArchiveProtocol:"IRPA-SIGNED-DOCUMENT-V1"}});const signedUrl=await getDownloadURL(storageRef);
await setDoc(doc(collection(db,"signatures")),{envelopeId:envelope.id,documentId:envelope.documentId,documentReference:envelope.documentReference,documentTitle:envelope.title||envelope.documentReference||envelope.documentId,signerUid:u.uid,signerIdentityId:signerIdentity.id,signerEmail:u.email||"",signerName:profile?.displayName||u.displayName||u.email||"Signer",signaturePaneId,signaturePaneRecords,signaturePaneStatus:"Embedded in Signed PDF and Hash-Bound",signedAt,signatureSpecimenHash:profile?.signatureHash||profile?.signatureSha256||null,associatedOrganisation:IRPA_ORGANISATION,associatedTransactionId:envelope.transactionId||envelope.authorizationRequestId||envelope.id,workflowRole:recipient.role||"Action",responsibility:recipient.role||"Action",signatureAuthority:authorityVerification.authorityRole||signerAuthority.authorityRole,signatureAuthorityDeclared:authorityVerification.manualAuthorityIdentification,signatureAuthorityVerificationStatus:"Verified",signatureAuthorityVerificationMethod:authorityVerification.verificationMethod,signatureAuthorityVerificationAt:new Date().toISOString(),signatureAuthorityDepartment:authorityVerification.authorityDepartment||signerAuthority.authorityDepartment||"",signatureAuthorityUnit:authorityVerification.authorityUnit||signerAuthority.authorityUnit||"",signatureAuthorityStatus:signerAuthority.authorityStatus||"",signatureAuthoritySourceCollection:authorityVerification.authoritySourceCollection||signerAuthority.authoritySourceCollection||"",signatureAuthoritySourceRecordId:authorityVerification.authoritySourceRecordId||signerAuthority.authoritySourceRecordId||"",signatureMethod:profile?.method||"No Signature Field",signatureSha256:profile?.signatureSha256||null,documentVersion:envelope.documentVersion||envelope.version||"1",documentType:envelope.documentType||"Governance Document",documentUploadedAt:envelope.documentUploadedAt||null,documentUploadDestinationKey:envelope.documentUploadDestinationKey||null,signatureStatus:"Signed",status:"Signed",signedAt:serverTimestamp(),originalDocumentHash:originalHash,signedDocumentHash:finalHash,signerArchivePath:null,signerArchiveUrl:null,signerArchiveFolderId:null,signerArchiveFolderLink:null,signerProfileFolderId:null,signedDocumentArchiveFolderId:signedDocumentArchive.folderId,signedDocumentArchiveFolderLink:signedDocumentArchive.archiveUidLink,signedDocumentArchiveProtocol:"IRPA-SIGNED-DOCUMENT-V1",signedDocumentArchiveState:"Saved Signed Document",archivePending:true,archiveProtocol:"IRPA-SIGNER-COPY-V2",revocationStatus:"Active",immutable:true});const actionable=(envelope.recipients||[]).filter(isActionRecipient);let completed=false;let nextRecipient=null;if(envelope.signingMode==="Parallel"){const signedSnap=await getDocs(query(collection(db,"signatures"),where("envelopeId","==",envelope.id),where("status","==","Signed")));const signedUids=new Set(signedSnap.docs.map(d=>d.data().signerUid));completed=actionable.length===0||actionable.every(r=>signedUids.has(r.uid));}else{nextRecipient=nextActionRecipient(envelope.recipients,u.uid);completed=!nextRecipient;}let archive=null;let archiveSignedUrl=signedUrl;let governanceArchiveSignedUrl=null;let signerArchiveDeliveries={};
if(completed){
  archive=await ensureSignedDocumentArchive({
    documentId:envelope.documentId,
    title:envelope.title,
    reference:envelope.documentReference,
    archiveCategory:envelope.documentArchiveCategory||"Administrative Documents",
    classification:envelope.documentClassification||"Public",
    documentType:envelope.documentType||"Governance Document",
    uploadedAt:envelope.documentUploadedAt||null
  });
  const archiveRef=ref(null,`signatureEnvelopes/${envelope.id}/final-${finalHash}.pdf`);
  await uploadBytes(archiveRef,signedBytes,{
    contentType:"application/pdf",
    purpose:"Signed Documents Archive",
    folderId:archive.folderId,
    customMetadata:{
      envelopeId:envelope.id,
      signerUid:u.uid,
      originalHash,
      finalHash,
      workflowRole:recipient.role||"Final Signer",
      documentId:envelope.documentId,
      documentUid:envelope.documentId,
      archiveFolderId:archive.folderId,
      archiveUidLink:archive.archiveUidLink,
      archiveAccess:archive.archiveAccess,
      archiveProtocol:"IRPA-SIGNED-DOCUMENT-V1"
    }
  });
  archiveSignedUrl=await getDownloadURL(archiveRef);

  if(archive.governanceArchive?.folderId){
    const governanceRef=ref(null,`signatureEnvelopes/${envelope.id}/board-governance-final-${finalHash}.pdf`);
    await uploadBytes(governanceRef,signedBytes,{
      contentType:"application/pdf",
      purpose:"Signed Documents Archive",
      folderId:archive.governanceArchive.folderId,
      customMetadata:{
        envelopeId:envelope.id,
        signerUid:u.uid,
        originalHash,
        finalHash,
        workflowRole:recipient.role||"Final Signer",
        documentId:envelope.documentId,
        documentUid:envelope.documentId,
        archiveFolderId:archive.governanceArchive.folderId,
        archiveUidLink:archive.governanceArchive.archiveUidLink,
        archiveProtocol:"IRPA-BOARD-GOVERNANCE-SIGNED-V1"
      }
    });
    governanceArchiveSignedUrl=await getDownloadURL(governanceRef);
  }
}

const actionFields=signerFields.map(field=>({fieldId:field.fieldId,type:field.type,responsibility:field.responsibility||"Action",required:!!field.required,value:fieldValues[field.fieldId]??(field.type==="Name"?(profile?.displayName||u.displayName||u.email||""):field.type==="Date"?new Date().toLocaleDateString():"")}));const commentEntries=actionFields.filter(x=>x.type==="Comment"||x.responsibility==="Comment").map(x=>({fieldId:x.fieldId,value:x.value}));const completedAt=new Date().toISOString();const actionRecord={uid:u.uid,name:profile?.displayName||u.displayName||u.email||"Signer",email:u.email||"",role:recipient.role||"Action",completedAt,fields:actionFields,comments:commentEntries,manualAuthorityIdentification:authorityVerification.manualAuthorityIdentification,authorityRole:authorityVerification.authorityRole,authorityVerificationStatus:"Verified",authorityVerificationMethod:authorityVerification.verificationMethod,authoritySourceCollection:authorityVerification.authoritySourceCollection,authoritySourceRecordId:authorityVerification.authoritySourceRecordId};const progressionRecipients=(envelope.recipients||[]).map(r=>r.uid===u.uid?{...r,status:"Signed",completedAt}:(!completed&&nextRecipient&&r.uid===nextRecipient.uid?{...r,status:"Current",releasedAt:completedAt}:{...r,status:r.status||"Pending"}));const update={status:completed?"Completed":"In Progress",lastSignedByUid:u.uid,lastSignedAt:serverTimestamp(),signedDocumentPath:path,signedDocumentUrl:completed?archiveSignedUrl:signedUrl,ownerCompletedDocumentPath:path,ownerCompletedDocumentUrl:completed?archiveSignedUrl:signedUrl,ownerRecordStatus:completed?"Completed":"In Progress",originalDocumentHash:originalHash,latestDocumentHash:finalHash,workflowHistory:arrayUnion(actionRecord),signerArchiveDeliveries:envelope.signerArchiveDeliveries||{},signerArchiveFinalHash:envelope.signerArchiveFinalHash||null,signerArchiveStatus:completed?"Final Document Pending Archive Delivery":"Tracking Until Final Signature",recipients:progressionRecipients,documentCustodianUid:completed&&isBoardSigningRole(recipient.role,recipient)?u.uid:(envelope.documentCustodianUid||null),documentCustodianRole:completed&&isBoardSigningRole(recipient.role,recipient)?(recipient.institutionalRole||recipient.role||"Board Member"):(envelope.documentCustodianRole||null),documentCustodyStatus:completed&&isBoardSigningRole(recipient.role,recipient)?"Board Custody":(envelope.documentCustodyStatus||null),documentCustodyAssignedAt:completed&&isBoardSigningRole(recipient.role,recipient)?serverTimestamp():(envelope.documentCustodyAssignedAt||null),updatedAt:serverTimestamp()};if(!completed&&envelope.signingMode!=="Parallel")update.currentSignerUid=nextRecipient.uid;if(completed)update.completedAt=serverTimestamp();else if(envelope.signingMode==="Parallel")update.currentSignerUid=null;await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),update);if(completed){const delivery=await finalizeSignatureProfileArchives({envelopeId:envelope.id,signedBytes,finalHash,originalHash});signerArchiveDeliveries=delivery.deliveries||{};await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),{signerArchiveDeliveries,signerArchiveFinalHash:finalHash,signerArchiveStatus:"Final Completed Document Delivered",updatedAt:serverTimestamp()});}const role=String(recipient.role||"").toLowerCase();const workflowStatus=role.includes("final authorization")||role==="authorization"?"Authorized":role.includes("approval")?"Approved":role.includes("review")?"Reviewed":role.includes("signature")?"Signed":"Action Completed";await updateDoc(doc(db,"documents",envelope.documentId),{workflowActionStatus:workflowStatus,lastWorkflowAction:recipient.role||"Action",lastWorkflowActionUid:u.uid,lastWorkflowActionAt:serverTimestamp(),authorizationStatus:role.includes("authorization")?"Authorized":role.includes("approval")?"Approved":"In Workflow",completedDocumentUrl:signedUrl,ownerCompletedDocumentUrl:signedUrl,ownerCompletedDocumentPath:path,ownerRecordStatus:completed?"Completed":"In Progress",lastCompletedDocumentHash:finalHash,documentArchiveUid:envelope.documentId,documentArchiveFolderId:archive?.folderId||envelope.documentArchiveFolderId||null,documentArchiveUidLink:archive?.archiveUidLink||envelope.documentArchiveUidLink||null,documentArchivePath:archive?.archivePath||envelope.documentArchivePath||null,documentArchiveAccess:archive?.archiveAccess||envelope.documentArchiveAccess||"Restricted",documentArchiveCategory:envelope.documentArchiveCategory||"Administrative Documents",documentType:envelope.documentType||"Governance Document",documentUploadedAt:envelope.documentUploadedAt||null,documentUploadDestinationKey:envelope.documentUploadDestinationKey||null,governanceArchiveFolderId:archive?.governanceArchive?.folderId||envelope.governanceArchiveFolderId||null,governanceArchiveUidLink:archive?.governanceArchive?.archiveUidLink||envelope.governanceArchiveUidLink||null,governanceArchivePath:archive?.governanceArchive?.archivePath||envelope.governanceArchivePath||null,governanceArchiveSignedUrl:governanceArchiveSignedUrl||envelope.governanceArchiveSignedUrl||null,documentClassification:envelope.documentClassification||"Public",documentCustodianUid:isBoardSigningRole(recipient.role,recipient)?u.uid:(envelope.documentCustodianUid||null),documentCustodianRole:isBoardSigningRole(recipient.role,recipient)?(recipient.institutionalRole||recipient.role||"Board Member"):(envelope.documentCustodianRole||null),documentCustodyStatus:isBoardSigningRole(recipient.role,recipient)?"Board Custody":(envelope.documentCustodyStatus||"Owner Custody"),documentCustodyAssignedAt:isBoardSigningRole(recipient.role,recipient)?serverTimestamp():(envelope.documentCustodyAssignedAt||null),updatedAt:serverTimestamp()});if(!completed&&envelope.signingMode!=="Parallel"&&nextRecipient){try{await releaseNextSigner({...envelope,...update},nextRecipient);}catch(error){await recordEnvelopeEvent(envelope.id,"Next Signer Release Failed",{signerUid:nextRecipient.uid,signerEmail:nextRecipient.email||"",error:error?.message||"Unable to release next signer"});}}await recordEnvelopeEvent(envelope.id,"Workflow Action Completed",{signerUid:u.uid,signerName:profile?.displayName||u.displayName||u.email,workflowRole:recipient.role||"Action",originalDocumentHash:originalHash,signedDocumentHash:finalHash,status:completed?"Completed":"In Progress",signingMode:envelope.signingMode,requiredActionCount:actionable.length,comments:commentEntries,nextSignerUid:nextRecipient?.uid||null,nextSignerName:nextRecipient?.name||"",nextSignerRole:nextRecipient?.role||""});return{...envelope,...update,id:envelope.id,signerArchiveDeliveries,signerArchiveFinalHash:completed?finalHash:(envelope.signerArchiveFinalHash||null),signerArchiveStatus:completed?"Final Completed Document Delivered":"Tracking Until Final Signature"};}
async function releaseViewOnlyRecipient(envelope,recipient){
  if(!recipient?.email)return{sent:false};
  const result=await sendSignatureMail(envelope,recipient);
  await recordEnvelopeEvent(envelope.id,"View-Only Access Released",{signerUid:recipient.uid,signerEmail:recipient.email,signerName:recipient.name||"",role:recipient.role||"View Only",deliveryStatus:result.deliveryStatus||"Sent"});
  return{sent:true,email:recipient.email,deliveryStatus:result.deliveryStatus||"Sent"};
}

async function releaseNextSigner(envelope,nextRecipient){
  if(!nextRecipient?.email)return {sent:false};
  try{
    const result=await sendSignatureMail(envelope,nextRecipient);
    const cleanEmail=String(nextRecipient.email).trim().toLowerCase();
    await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),{currentSignerEmail:cleanEmail,currentSignerName:nextRecipient.name||"",currentSignerInvitationStatus:result.deliveryStatus||"Sent",currentSignerInvitationSentAt:serverTimestamp(),updatedAt:serverTimestamp()});
    await recordEnvelopeEvent(envelope.id,"Next Signer Released",{signerUid:nextRecipient.uid,signerEmail:cleanEmail,signerName:nextRecipient.name||"",routingOrder:nextRecipient.routingOrder,deliveryStatus:result.deliveryStatus||"Sent"});
    return {sent:true,email:cleanEmail,deliveryStatus:result.deliveryStatus||"Sent"};
  }catch(error){
    console.error("IRPA next-signer invitation sender error",{firebaseErrorCode:error?.code||""});
    throw new Error(error?.message||"The next signer invitation could not be sent. The workflow was not silently advanced.");
  }
}

export async function recordSignatureAdoption({documentId,documentReference,fieldId,signatureProfile}){const u=user(),r=doc(collection(db,"signatures"));await setDoc(r,{documentId:documentId||null,documentReference:documentReference||"",fieldId:fieldId||"",signerUid:u.uid,signerEmail:u.email||"",signerName:signatureProfile?.displayName||u.displayName||"",signatureMethod:signatureProfile?.method||"Upload",signatureSha256:signatureProfile?.signatureSha256||null,status:"Signed",signedAt:serverTimestamp(),createdAt:serverTimestamp(),immutable:true});return r.id;}
export async function createCompletionCertificate(envelope){
  const u=user();
  if(!envelope?.id)throw new Error("A signing envelope is required.");
  if(envelope.status!=="Completed")throw new Error("The completion certificate can only be archived after all required signing actions are completed.");
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([595,842]);
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("IRPA DIGITAL GOVERNANCE SYSTEM",{x:48,y:790,size:11,font:bold,color:rgb(.15,.2,.3)});
  page.drawText("CERTIFICATE OF COMPLETION",{x:48,y:750,size:24,font:bold});
  const rows=[["Envelope",envelope.envelopeReference],["Subject",envelope.title],["Document",envelope.documentReference],["Status",envelope.status],["Completed",new Date().toISOString()],["Final document hash",envelope.latestDocumentHash||"—"]];
  let y=700;
  for(const [a,b]of rows){page.drawText(a,{x:48,y,size:10,font:bold});page.drawText(String(b),{x:190,y,size:10,font});y-=34;}
  page.drawText("SIGNER EVENTS",{x:48,y:y-10,size:13,font:bold});y-=40;
  for(const r of envelope.recipients||[]){page.drawText(`${r.name||r.email} — ${r.email||""}`,{x:48,y,size:10,font});y-=20;}
  page.drawText("This certificate records the signing transaction captured by the IRPA Signature Platform. It is an electronic transaction record, not a PKI certificate.",{x:48,y:80,size:8,font,maxWidth:500});
  const bytes=await pdf.save();
  const certificateHash=await hashBytes(bytes);
  const path=`signatureEnvelopes/${envelope.id}/certificate-${certificateHash}.pdf`;
  const r=ref(null,path);
  await uploadBytes(r,bytes,{contentType:"application/pdf",purpose:"Signature Certificate",customMetadata:{envelopeId:envelope.id,certificateHash,finalDocumentHash:envelope.latestDocumentHash||""}});
  const url=await getDownloadURL(r);
  const archive=await ensureSignedDocumentArchive({
    documentId:envelope.documentId,
    title:envelope.title,
    reference:envelope.documentReference,
    archiveCategory:envelope.documentArchiveCategory||"Administrative Documents",
    classification:envelope.documentClassification||"Public",
    documentType:envelope.documentType||"Governance Document",
    uploadedAt:envelope.documentUploadedAt||null
  });
  const archivePath=`signatureEnvelopes/${envelope.id}/certificate-archive-${certificateHash}.pdf`;
  const archiveRef=ref(null,archivePath);
  await uploadBytes(archiveRef,bytes,{contentType:"application/pdf",purpose:"Signature Certificate Archive",folderId:archive.folderId,customMetadata:{envelopeId:envelope.id,certificateHash,finalDocumentHash:envelope.latestDocumentHash||"",archiveFolderId:archive.folderId,archiveUidLink:archive.archiveUidLink,archiveProtocol:"IRPA-SIGNATURE-CERTIFICATE-V1"}});
  const archiveUrl=await getDownloadURL(archiveRef);
  await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),{
    certificatePath:path,
    certificateUrl:url,
    certificateHash,
    certificateArchivePath:archivePath,
    certificateArchiveUrl:archiveUrl,
    certificateArchiveFolderId:archive.folderId,
    certificateArchiveFolderLink:archive.archiveUidLink||null,
    certificateArchiveProtocol:"IRPA-SIGNATURE-CERTIFICATE-V1",
    updatedAt:serverTimestamp()
  });
  await recordEnvelopeEvent(envelope.id,"Certificate Generated and Archived",{certificateHash,archiveFolderId:archive.folderId,archiveUrl,actorUid:u.uid});
  return url;
}
