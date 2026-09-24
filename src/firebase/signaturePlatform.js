import { arrayUnion, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { sendSignInLinkToEmail } from "firebase/auth";
import { downloadDriveBytes, ensureSignedDocumentArchive, ensureSignatureProfileFolder, finalizeSignatureProfileArchives, getDownloadURL, ref, uploadBytes } from "./signatureStorage";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { auth, db } from "./config";
import { ensureMySignerIdentity, getMySignerIdentity, recordSignerAuthenticationEvidence, IRPA_ORGANISATION } from "./signerIdentity";
const PROFILE_COLLECTION="signatureProfiles";const ENVELOPE_COLLECTION="signatureEnvelopes";const EVENT_COLLECTION="signatureEvents";
const VIEW_ONLY_ROLES=["View Only","Read Only","Information / FYI","Observer"];
const BOARD_SIGNING_ROLES=["Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member"];
function isBoardSigningRole(role,recipient){const values=[role,recipient?.institutionalRole].map(v=>String(v||"").trim()).filter(Boolean);return values.some(v=>BOARD_SIGNING_ROLES.includes(v));}
function isViewOnlyRecipient(recipient){return !!recipient?.accessOnly||VIEW_ONLY_ROLES.includes(String(recipient?.role||"").trim());}
function isActionRecipient(recipient){return !!recipient?.uid&&!isViewOnlyRecipient(recipient)&&recipient?.optionalSigning!==true;}
function nextActionRecipient(recipients,currentUid){const list=recipients||[];const index=list.findIndex(r=>r?.uid===currentUid);return list.slice(Math.max(0,index+1)).find(isActionRecipient)||null;}

function user(){if(!auth.currentUser)throw new Error("Authentication is required.");return auth.currentUser;}
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
  if(!String(displayName||u.displayName||"").trim())throw new Error("Display name is required.");

  const folder=await ensureSignatureProfileFolder(u.uid);if(!folder?.folderId)throw new Error("Your protected Google Drive Signature Profile folder could not be established. No signature asset has been saved.");if(folder.ownerUid&&folder.ownerUid!==u.uid)throw new Error("The Google Drive Signature Profile folder is not owned by the authenticated profile.");

  const folderId=folder?.folderId||null;
  const signature=await uploadAsset(u.uid,"Signature",signatureFile,folderId);
  const initialsAsset=initialsFile?await uploadAsset(u.uid,"Initials",initialsFile,folderId):null;

  const p={
    uid:u.uid,
    email:u.email||"",
    displayName:String(displayName).trim(),
    initials:String(initials||"").trim(),
    method,
    driveSignatureFolderId:folder?.folderId||null,
    driveSignatureFolderName:folder?.folderName||null,
    driveSignatureFolderPath:folder?.path||null,
    driveSignatureFolderUid:folder?u.uid:null,
    signaturePath:signature.path,
    // The served signature is a browser-renderable data URL. Google Drive remains the archive.
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

  await setDoc(doc(db,PROFILE_COLLECTION,u.uid),p,{merge:true});
  await ensureMySignerIdentity(p,{organisationName:IRPA_ORGANISATION});
  return p;
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

export async function getSignatureEnvelope(envelopeId){
  const u=user();
  if(!envelopeId)throw new Error("Signing envelope ID is required.");
  const snap=await getDoc(doc(db,ENVELOPE_COLLECTION,envelopeId));
  if(!snap.exists())throw new Error("This signing invitation is no longer available.");
  const envelope={id:snap.id,...snap.data()};
  // A signing envelope is private to its participants. The document PDF may be
  // visible to an assigned participant, but other officers' assignments are not.
  if(!Array.isArray(envelope.participantUids)||!envelope.participantUids.includes(u.uid)){
    throw new Error("You are not assigned to this signing envelope.");
  }
  if(["Cancelled","Declined"].includes(envelope.status)){
    throw new Error("This signing envelope is no longer available.");
  }
  return envelope;
}

export async function getSignatureEnvelopes(){const u=user();const q=query(collection(db,ENVELOPE_COLLECTION),where("participantUids","array-contains",u.uid));const s=await getDocs(q);return s.docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));}
export async function getMySignedDocuments(){const u=user();const q=query(collection(db,"signatures"),where("signerUid","==",u.uid));const s=await getDocs(q);const rows=await Promise.all(s.docs.map(async x=>{const data=x.data();if(data.signerArchiveUrl)return{id:x.id,...data};if(!data.envelopeId)return null;try{const envelopeSnap=await getDoc(doc(db,ENVELOPE_COLLECTION,data.envelopeId));if(!envelopeSnap.exists())return null;const envelope={id:envelopeSnap.id,...envelopeSnap.data()};const delivery=envelope.signerArchiveDeliveries?.[u.uid];if(!delivery?.webViewLink)return null;return{id:x.id,...data,signerArchiveUrl:delivery.webViewLink,signerArchiveFolderId:delivery.folderId||null,signerArchiveFolderLink:delivery.folderLink||null,signerArchiveFinalHash:delivery.finalHash||envelope.signerArchiveFinalHash||null,archivePending:false,archiveProtocol:delivery.archiveProtocol||"IRPA-SIGNER-COPY-V2",archiveState:"Final Completed Document"};}catch(error){console.warn("Unable to resolve completed signer archive delivery:",error);return null;}}));return rows.filter(x=>x&&x.status==="Signed"&&x.signerArchiveUrl).sort((a,b)=>{const at=a.signedAt?.seconds?Number(a.signedAt.seconds):Date.parse(a.signedAt||0);const bt=b.signedAt?.seconds?Number(b.signedAt.seconds):Date.parse(b.signedAt||0);return bt-at;});}
export async function sendSignatureInvitation(envelope, recipient) {
  const u = user();

  if (!envelope?.id) throw new Error("A valid signing envelope is required.");
  if (!recipient?.uid || !recipient?.email) {
    throw new Error("The signer must have a valid account UID and email address.");
  }

  if (!(envelope.participantUids || []).includes(recipient.uid)) {
    throw new Error("The selected signer is not a participant in this envelope.");
  }

  const cleanEmail = String(recipient.email).trim().toLowerCase();

  const actionCodeSettings = {
    url:
      window.location.origin +
      "/?signEnvelope=" +
      encodeURIComponent(envelope.id),
    handleCodeInApp: true
  };

  await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);

  await updateDoc(doc(db, ENVELOPE_COLLECTION, envelope.id), {
    status: envelope.status === "Draft" ? "Sent" : envelope.status,
    invitationStatus: "Sent",
    invitationSentAt: serverTimestamp(),
    invitationSentByUid: u.uid,
    invitationSentByEmail: u.email || "",
    updatedAt: serverTimestamp()
  });

  await recordEnvelopeEvent(envelope.id, "Signing Invitation Sent", {
    signerUid: recipient.uid,
    signerEmail: cleanEmail,
    signerName: recipient.name || "",
    deliveryStatus: "Accepted by Firebase Authentication"
  });

  return {
    envelopeId: envelope.id,
    signerUid: recipient.uid,
    signerEmail: cleanEmail,
    emailRequested: true,
    deliveryStatus: "Accepted by Firebase Authentication"
  };
}

export async function saveSignatureWorkflowDraft({envelopeId,title,documentId,documentReference,documentUrl,documentClassification="Public",documentArchiveCategory="Administrative Documents",signingMode,recipients,fields,ownerSigningEnabled=true}){const u=user();if(!title?.trim())throw new Error("Envelope title is required.");if(!documentId||!documentUrl)throw new Error("Select a controlled PDF before saving the workflow.");const sourceDocument=await getDoc(doc(db,"documents",documentId));if(!sourceDocument.exists())throw new Error("The selected controlled document could not be found.");const sourceDocumentData=sourceDocument.data()||{};const recordOrigin=String(sourceDocumentData.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION";const owner={uid:u.uid,name:u.displayName||u.email||"Document Owner",email:u.email||"",role:"Document Owner",routingOrder:1,status:"Pending",optionalSigning:!ownerSigningEnabled,actionRequired:ownerSigningEnabled};const supplied=(recipients||[]).filter(r=>r?.uid&&r.uid!==u.uid).map((r,i)=>({...r,accessOnly:isViewOnlyRecipient(r),routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}));const orderedRecipients=[owner,...supplied];const participantUids=orderedRecipients.map(r=>r.uid).filter(Boolean);const actionUids=[...new Set((fields||[]).map(f=>f?.signerUid).filter(Boolean))];const viewOnlyUids=new Set(orderedRecipients.filter(isViewOnlyRecipient).map(r=>r.uid));if((fields||[]).some(f=>f?.signerUid&&viewOnlyUids.has(f.signerUid)))throw new Error("View-only recipients cannot receive action fields.");const id=envelopeId||`IRPA-ENV-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;const payload={envelopeReference:id,title:title.trim(),documentId,documentReference:documentReference||"",documentUrl,senderUid:u.uid,senderEmail:u.email||"",ownerUid:u.uid,ownerName:owner.name,ownerEmail:owner.email,recordOrigin,trialData:recordOrigin==="TRIAL",documentClassification:documentClassification||"Public",status:"Draft",signingMode:signingMode||"Sequential",recipients:orderedRecipients,fields:fields||[],participantUids,actionUids,currentSignerUid:ownerSigningEnabled?u.uid:(orderedRecipients.find(isActionRecipient)?.uid||null),ownerSectionSaved:true,documentClassification:documentClassification||"Public",documentArchiveCategory:documentArchiveCategory||"Administrative Documents",updatedAt:serverTimestamp()};if(!envelopeId)payload.createdAt=serverTimestamp();await setDoc(doc(db,ENVELOPE_COLLECTION,id),payload,{merge:true});await updateDoc(doc(db,"documents",documentId),{signatureEnvelopeId:id,signatureReference:id,signatureStatus:"Draft",signatureOwnerUid:u.uid,workflowOwnerSectionSaved:true,updatedAt:serverTimestamp()});await recordEnvelopeEvent(id,"Owner Section Saved",{ownerUid:u.uid,ownerSigningEnabled,fieldCount:(fields||[]).filter(f=>f.signerUid===u.uid).length,recipientCount:orderedRecipients.length});return{id,...payload};}

export async function finalizeSignatureWorkflowDraft(args){
  if(!args?.envelopeId)throw new Error("A saved signature draft is required.");
  return saveSignatureWorkflowDraft(args);
}

export async function startSignatureWorkflow(envelope){const u=user();if(!envelope?.id)throw new Error("A valid workflow envelope is required.");if(envelope.senderUid!==u.uid&&envelope.ownerUid!==u.uid)throw new Error("Only the document owner can start this workflow.");if(envelope.status!=="Draft")return envelope;const current=(envelope.recipients||[]).find(r=>r.uid===envelope.currentSignerUid);const actionRecipients=(envelope.recipients||[]).filter(isActionRecipient);const update={status:envelope.currentSignerUid?"In Progress":"Shared",workflowStartedAt:serverTimestamp(),workflowStartedByUid:u.uid,updatedAt:serverTimestamp()};await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),update);if(current&&current.uid!==u.uid&&current.email)await releaseNextSigner({...envelope,...update},current);await recordEnvelopeEvent(envelope.id,"Workflow Started",{ownerUid:u.uid,currentSignerUid:envelope.currentSignerUid||null,currentSignerName:current?.name||"",requiredActionCount:actionRecipients.length});return{...envelope,...update};}

export async function createSignatureEnvelope({title,documentId,documentReference,documentUrl,documentClassification="Public",signingMode,recipients,fields=[]}){const u=user();if(!title?.trim())throw new Error("Envelope title is required.");if(!documentId)throw new Error("An authorized document must be selected.");if(!documentUrl)throw new Error("The selected document has no PDF file URL. Upload/link the controlled PDF before sending for signature.");if(!recipients?.length)throw new Error("At least the document owner is required.");const envelopeId=`IRPA-ENV-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;const owner={...(recipients.find(r=>r?.uid===u.uid)||{}),uid:u.uid,name:u.displayName||u.email||"Document Owner",email:u.email||"",role:"Document Owner",routingOrder:1,status:"Pending"};const supplied=recipients.filter(r=>r?.uid&&r.uid!==u.uid);const orderedRecipients=[owner,...supplied.map((r,i)=>({...r,accessOnly:isViewOnlyRecipient(r),routingOrder:signingMode==="Sequential"?i+2:r.routingOrder||1}))];const participantUids=orderedRecipients.map(r=>r.uid).filter(Boolean);const viewOnlyUids=new Set(orderedRecipients.filter(isViewOnlyRecipient).map(r=>r.uid));if((fields||[]).some(f=>f?.signerUid&&viewOnlyUids.has(f.signerUid)))throw new Error("View-only recipients cannot be assigned action fields. Assign fields only to the document owner or an action officer.");const firstActionRecipient=orderedRecipients.find(isActionRecipient);const payload={envelopeReference:envelopeId,title:title.trim(),documentId,documentReference:documentReference||"",documentUrl,senderUid:u.uid,senderEmail:u.email||"",ownerUid:u.uid,ownerName:owner.name,ownerEmail:owner.email,documentClassification:documentClassification||"Public",archiveCategory:archiveCategory||"Administrative Documents",status:"Draft",signingMode:signingMode||"Sequential",recipients:orderedRecipients,fields,participantUids,actionUids,currentSignerUid:signingMode==="Sequential"?(firstActionRecipient?.uid||null):null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};const batch=writeBatch(db);batch.set(doc(db,ENVELOPE_COLLECTION,envelopeId),payload);batch.update(doc(db,"documents",documentId),{signatureEnvelopeId:envelopeId,signatureReference:envelopeId,signatureStatus:"Draft",signatureOwnerUid:u.uid,workflowOwnerSectionSaved:true,updatedAt:serverTimestamp()});await batch.commit();await recordEnvelopeEvent(envelopeId,"Envelope Created",{status:"Draft",ownerUid:u.uid,signingOrder:orderedRecipients.map(r=>({uid:r.uid,name:r.name,email:r.email,routingOrder:r.routingOrder,role:r.role,accessOnly:isViewOnlyRecipient(r),actionRequired:isActionRecipient(r)}))});const viewOnlyRecipients=orderedRecipients.filter(isViewOnlyRecipient);if(viewOnlyRecipients.length)await Promise.all(viewOnlyRecipients.map(r=>releaseViewOnlyRecipient({...payload,id:envelopeId},r).catch(async error=>{await recordEnvelopeEvent(envelopeId,"View-Only Invitation Failed",{signerUid:r.uid,signerEmail:r.email,error:error?.message||"Unable to send view-only invitation"});return null;})));return{id:envelopeId,...payload};}
export async function recordEnvelopeEvent(envelopeId,event,details={}){const u=user();await setDoc(doc(collection(db,EVENT_COLLECTION)),{envelopeId,event,details,actorUid:u.uid,actorEmail:u.email||"",createdAt:serverTimestamp()});}
async function fetchBytes(url){const value=String(url||"");if(value.startsWith("drive://"))return downloadDriveBytes(value.slice("drive://".length));const r=await fetch(value);if(!r.ok)throw new Error(`Unable to retrieve the controlled PDF (${r.status}).`);return new Uint8Array(await r.arrayBuffer());}
async function embedImage(pdfDoc,url){const bytes=await fetchBytes(url);const lower=url.toLowerCase();if(lower.includes(".jpg")||lower.includes(".jpeg"))return pdfDoc.embedJpg(bytes);return pdfDoc.embedPng(bytes);}
function drawField(page,font,field,value){const{width,height}=page.getSize();const x=(Number(field.x||10)/100)*width;const y=height-((Number(field.y||80)/100)*height)-(Number(field.height||8)/100)*height;const w=(Number(field.width||22)/100)*width;const h=(Number(field.height||8)/100)*height;const size=Math.max(8,Math.min(18,h*.65));if(field.type==="Text"||field.type==="Name"||field.type==="Date"){page.drawText(String(value||""),{x,y:y+h*.2,size,font,color:rgb(0.05,0.05,0.08),maxWidth:w});}else if(field.type==="Checkbox"){page.drawRectangle({x,y,width:Math.min(w,h),height:Math.min(w,h),borderWidth:1,borderColor:rgb(0.1,0.1,0.1)});page.drawText("X",{x:x+2,y:y+1,size,font,color:rgb(0,0,0)});}}
export async function previewEnvelopeSigning(envelope,profile,fieldValues={}){const u=user();if(profile?.status!=="Active")throw new Error("Your Signature Application is not active. Activate your Signature Profile before signing.");if(!envelope?.documentUrl)throw new Error("This envelope has no controlled PDF URL.");if(!envelope.participantUids?.includes(u.uid))throw new Error("You are not a participant in this signing envelope.");const recipient=(envelope.recipients||[]).find(r=>r?.uid===u.uid);if(!recipient)throw new Error("You are not assigned to this workflow.");const signerIdentity=await getMySignerIdentity();if(!signerIdentity?.authorityRole||signerIdentity.authorityRole==="Not yet assigned")throw new Error("Your current signing authority has not been registered. Update your Signer Identity capacity before signing.");if(signerIdentity.authorityStatus!=="Current")throw new Error(`Your signing authority is ${signerIdentity.authorityStatus||"not verified"}. A Current authority is required to sign.`);if(isViewOnlyRecipient(recipient))throw new Error("This role has view-only access. No signature preview is required.");if(envelope.signingMode==="Sequential"&&envelope.currentSignerUid&&envelope.currentSignerUid!==u.uid)throw new Error("This envelope is waiting for another officer.");const source=await fetchBytes(envelope.signedDocumentUrl||envelope.documentUrl);const pdf=await PDFDocument.load(source);const font=await pdf.embedFont(StandardFonts.Helvetica);const signature=profile?.signatureUrl?await embedImage(pdf,profile.signatureUrl):null;const initials=profile?.initialsUrl?await embedImage(pdf,profile.initialsUrl):null;const signerFields=(envelope.fields||[]).filter(f=>f?.signerUid===u.uid);if(!signerFields.length)throw new Error("This signing task is assigned to another officer. Your profile is not authorized to execute it.");const requiresSignature=signerFields.some(f=>f.type==="Signature"||f.type==="Initials");if(requiresSignature&&!profile?.signatureUrl&&!signerFields.some(f=>String(fieldValues[f.fieldId]||"").startsWith("data:image/")))throw new Error("Capture your handwritten ink in the assigned signature field before signing.");for(const field of signerFields){const page=pdf.getPages()[Math.max(0,Number(field.page||1)-1)];if(!page)continue;const{width,height}=page.getSize();const x=(Number(field.x||10)/100)*width;const y=height-((Number(field.y||80)/100)*height)-(Number(field.height||8)/100)*height;const w=(Number(field.width||24)/100)*width;const h=(Number(field.height||9)/100)*height;if(field.type==="Signature"&&String(fieldValues[field.fieldId]||"").startsWith("data:image/")){const ink=await embedImage(pdf,fieldValues[field.fieldId]);page.drawImage(ink,{x,y,width:w,height:h});}else if(field.type==="Initials"&&String(fieldValues[field.fieldId]||"").startsWith("data:image/")){const ink=await embedImage(pdf,fieldValues[field.fieldId]);page.drawImage(ink,{x,y,width:w,height:h});}else if(field.type==="Signature"&&signature){page.drawImage(signature,{x,y,width:w,height:h});}else if(field.type==="Initials"&&initials){page.drawImage(initials,{x,y,width:w,height:h});}else{const value=fieldValues[field.fieldId]??(field.type==="Name"?(profile?.displayName||u.displayName||u.email||""):field.type==="Date"?new Date().toLocaleDateString():fieldValues[field.fieldId]||"");drawField(page,font,field,value);}}return await pdf.save();}

export async function signEnvelope(envelope,profile,fieldValues={}){const u=user();if(profile?.status!=="Active")throw new Error("Your Signature Application is not active. Activate your Signature Profile before signing.");if(!u?.uid||!u?.email)throw new Error("Your secure signing session has expired. Sign in again before signing this document.");if(!envelope?.documentUrl)throw new Error("This envelope has no controlled PDF URL.");if(!envelope.participantUids?.includes(u.uid))throw new Error("You are not a participant in this signing envelope.");const recipient=(envelope.recipients||[]).find(r=>r?.uid===u.uid);if(!recipient)throw new Error("You are not assigned to this workflow.");const signerAuthority=await getMySignerIdentity();if(!signerAuthority?.authorityRole||signerAuthority.authorityRole==="Not yet assigned")throw new Error("Your current signing authority has not been registered. Update your Signer Identity capacity before signing.");if(signerAuthority.authorityStatus!=="Current")throw new Error(`Your signing authority is ${signerAuthority.authorityStatus||"not verified"}. A Current authority is required to sign.`);if(isViewOnlyRecipient(recipient))throw new Error("This role has view-only access. No action or signature is required.");if(envelope.signingMode==="Sequential"&&envelope.currentSignerUid&&envelope.currentSignerUid!==u.uid)throw new Error("This envelope is waiting for another officer.");const source=await fetchBytes(envelope.signedDocumentUrl||envelope.documentUrl);const originalHash=await hashBytes(source);const pdf=await PDFDocument.load(source);const font=await pdf.embedFont(StandardFonts.Helvetica);const signature=profile?.signatureUrl?await embedImage(pdf,profile.signatureUrl):null;const initials=profile?.initialsUrl?await embedImage(pdf,profile.initialsUrl):null;const signerFields=(envelope.fields||[]).filter(f=>f?.signerUid===u.uid);if(!signerFields.length)throw new Error("This signing task is assigned to another officer. Your profile is not authorized to execute it.");const requiresSignature=signerFields.some(f=>f.type==="Signature"||f.type==="Initials");if(requiresSignature&&!profile?.signatureUrl)throw new Error("Your Signature Profile is not configured for the signature fields assigned to you.");for(const field of signerFields){const page=pdf.getPages()[Math.max(0,Number(field.page||1)-1)];if(!page)continue;const{width,height}=page.getSize();const x=(Number(field.x||10)/100)*width;const y=height-((Number(field.y||80)/100)*height)-(Number(field.height||8)/100)*height;const w=(Number(field.width||24)/100)*width;const h=(Number(field.height||9)/100)*height;if(field.type==="Signature"&&signature){page.drawImage(signature,{x,y,width:w,height:h});}else if(field.type==="Initials"&&initials){page.drawImage(initials,{x,y,width:w,height:h});}else{const value=fieldValues[field.fieldId]??(field.type==="Name"?(profile?.displayName||u.displayName||u.email||""):field.type==="Date"?new Date().toLocaleDateString():fieldValues[field.fieldId]||"");drawField(page,font,field,value);}}const signedBytes=await pdf.save();const finalHash=await hashBytes(signedBytes);const signerIdentity=await ensureMySignerIdentity(profile,{organisationName:IRPA_ORGANISATION});await recordSignerAuthenticationEvidence(signerIdentity.id,{context:"Signature signing ceremony"});const workingFolder=await ensureSignatureWorkflowFolder(envelope.id);const path=`signatureEnvelopes/${envelope.id}/signed-${u.uid}-${finalHash}.pdf`;const storageRef=ref(null,path);await uploadBytes(storageRef,signedBytes,{contentType:"application/pdf",purpose:"Signed Documents Archive",folderId:workingFolder.folderId,customMetadata:{envelopeId:envelope.id,signerUid:u.uid,originalHash,finalHash,workflowRole:recipient.role||"Action",documentId:envelope.documentId,documentUid:envelope.documentId,workingFolderId:workingFolder.folderId}});const signedUrl=await getDownloadURL(storageRef);
await setDoc(doc(collection(db,"signatures")),{envelopeId:envelope.id,documentId:envelope.documentId,documentReference:envelope.documentReference,documentTitle:envelope.title||envelope.documentReference||envelope.documentId,signerUid:u.uid,signerIdentityId:signerIdentity.id,signerEmail:u.email||"",signerName:profile?.displayName||u.displayName||u.email||"Signer",associatedOrganisation:IRPA_ORGANISATION,associatedTransactionId:envelope.transactionId||envelope.authorizationRequestId||envelope.id,workflowRole:recipient.role||"Action",responsibility:recipient.role||"Action",signatureAuthority:signerAuthority.authorityRole,signatureAuthorityDepartment:signerAuthority.authorityDepartment||"",signatureAuthorityUnit:signerAuthority.authorityUnit||"",signatureAuthorityStatus:signerAuthority.authorityStatus||"",signatureAuthoritySourceCollection:signerAuthority.authoritySourceCollection||"",signatureAuthoritySourceRecordId:signerAuthority.authoritySourceRecordId||"",signatureMethod:profile?.method||"No Signature Field",signatureSha256:profile?.signatureSha256||null,documentVersion:envelope.documentVersion||envelope.version||"1",signatureStatus:"Signed",status:"Signed",signedAt:serverTimestamp(),originalDocumentHash:originalHash,signedDocumentHash:finalHash,signerArchivePath:null,signerArchiveUrl:null,signerArchiveFolderId:null,signerArchiveFolderLink:null,signerProfileFolderId:null,archivePending:true,archiveProtocol:"IRPA-SIGNER-COPY-V2",revocationStatus:"Active",immutable:true});const actionable=(envelope.recipients||[]).filter(isActionRecipient);let completed=false;let nextRecipient=null;if(envelope.signingMode==="Parallel"){const signedSnap=await getDocs(query(collection(db,"signatures"),where("envelopeId","==",envelope.id),where("status","==","Signed")));const signedUids=new Set(signedSnap.docs.map(d=>d.data().signerUid));completed=actionable.length===0||actionable.every(r=>signedUids.has(r.uid));}else{nextRecipient=nextActionRecipient(envelope.recipients,u.uid);completed=!nextRecipient;}let archive=null;let archiveSignedUrl=signedUrl;let signerArchiveDeliveries={};if(completed){archive=await ensureSignedDocumentArchive({documentId:envelope.documentId,title:envelope.title,reference:envelope.documentReference,archiveCategory:envelope.documentArchiveCategory||"Administrative Documents",classification:envelope.documentClassification||"Public"});const archiveRef=ref(null,`signatureEnvelopes/${envelope.id}/final-${finalHash}.pdf`);await uploadBytes(archiveRef,signedBytes,{contentType:"application/pdf",purpose:"Signed Documents Archive",folderId:archive.folderId,customMetadata:{envelopeId:envelope.id,signerUid:u.uid,originalHash,finalHash,workflowRole:recipient.role||"Final Signer",documentId:envelope.documentId,documentUid:envelope.documentId,archiveFolderId:archive.folderId,archiveUidLink:archive.archiveUidLink,archiveAccess:archive.archiveAccess,archiveProtocol:"IRPA-SIGNED-DOCUMENT-V1"}});archiveSignedUrl=await getDownloadURL(archiveRef);}
const actionFields=signerFields.map(field=>({fieldId:field.fieldId,type:field.type,responsibility:field.responsibility||"Action",required:!!field.required,value:fieldValues[field.fieldId]??(field.type==="Name"?(profile?.displayName||u.displayName||u.email||""):field.type==="Date"?new Date().toLocaleDateString():"")}));const commentEntries=actionFields.filter(x=>x.type==="Comment"||x.responsibility==="Comment").map(x=>({fieldId:x.fieldId,value:x.value}));const completedAt=new Date().toISOString();const actionRecord={uid:u.uid,name:profile?.displayName||u.displayName||u.email||"Signer",email:u.email||"",role:recipient.role||"Action",completedAt,fields:actionFields,comments:commentEntries};const progressionRecipients=(envelope.recipients||[]).map(r=>r.uid===u.uid?{...r,status:"Signed",completedAt}:(!completed&&nextRecipient&&r.uid===nextRecipient.uid?{...r,status:"Current",releasedAt:completedAt}:{...r,status:r.status||"Pending"}));const update={status:completed?"Completed":"In Progress",lastSignedByUid:u.uid,lastSignedAt:serverTimestamp(),signedDocumentPath:path,signedDocumentUrl:completed?archiveSignedUrl:signedUrl,ownerCompletedDocumentPath:path,ownerCompletedDocumentUrl:completed?archiveSignedUrl:signedUrl,ownerRecordStatus:completed?"Completed":"In Progress",originalDocumentHash:originalHash,latestDocumentHash:finalHash,workflowHistory:arrayUnion(actionRecord),signerArchiveDeliveries:envelope.signerArchiveDeliveries||{},signerArchiveFinalHash:envelope.signerArchiveFinalHash||null,signerArchiveStatus:completed?"Final Document Pending Archive Delivery":"Tracking Until Final Signature",recipients:progressionRecipients,documentCustodianUid:completed&&isBoardSigningRole(recipient.role,recipient)?u.uid:(envelope.documentCustodianUid||null),documentCustodianRole:completed&&isBoardSigningRole(recipient.role,recipient)?(recipient.institutionalRole||recipient.role||"Board Member"):(envelope.documentCustodianRole||null),documentCustodyStatus:completed&&isBoardSigningRole(recipient.role,recipient)?"Board Custody":(envelope.documentCustodyStatus||null),documentCustodyAssignedAt:completed&&isBoardSigningRole(recipient.role,recipient)?serverTimestamp():(envelope.documentCustodyAssignedAt||null),updatedAt:serverTimestamp()};if(!completed&&envelope.signingMode!=="Parallel")update.currentSignerUid=nextRecipient.uid;if(completed)update.completedAt=serverTimestamp();else if(envelope.signingMode==="Parallel")update.currentSignerUid=null;await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),update);if(completed){const delivery=await finalizeSignatureProfileArchives({envelopeId:envelope.id,signedBytes,finalHash,originalHash});signerArchiveDeliveries=delivery.deliveries||{};await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),{signerArchiveDeliveries,signerArchiveFinalHash:finalHash,signerArchiveStatus:"Final Completed Document Delivered",updatedAt:serverTimestamp()});}const role=String(recipient.role||"").toLowerCase();const workflowStatus=role.includes("final authorization")||role==="authorization"?"Authorized":role.includes("approval")?"Approved":role.includes("review")?"Reviewed":role.includes("signature")?"Signed":"Action Completed";await updateDoc(doc(db,"documents",envelope.documentId),{workflowActionStatus:workflowStatus,lastWorkflowAction:recipient.role||"Action",lastWorkflowActionUid:u.uid,lastWorkflowActionAt:serverTimestamp(),authorizationStatus:role.includes("authorization")?"Authorized":role.includes("approval")?"Approved":"In Workflow",completedDocumentUrl:signedUrl,ownerCompletedDocumentUrl:signedUrl,ownerCompletedDocumentPath:path,ownerRecordStatus:completed?"Completed":"In Progress",lastCompletedDocumentHash:finalHash,documentArchiveUid:envelope.documentId,documentArchiveFolderId:archive?.folderId||envelope.documentArchiveFolderId||null,documentArchiveUidLink:archive?.archiveUidLink||envelope.documentArchiveUidLink||null,documentArchivePath:archive?.archivePath||envelope.documentArchivePath||null,documentArchiveAccess:archive?.archiveAccess||envelope.documentArchiveAccess||"Restricted",documentArchiveCategory:envelope.documentArchiveCategory||"Administrative Documents",documentClassification:envelope.documentClassification||"Public",documentCustodianUid:isBoardSigningRole(recipient.role,recipient)?u.uid:(envelope.documentCustodianUid||null),documentCustodianRole:isBoardSigningRole(recipient.role,recipient)?(recipient.institutionalRole||recipient.role||"Board Member"):(envelope.documentCustodianRole||null),documentCustodyStatus:isBoardSigningRole(recipient.role,recipient)?"Board Custody":(envelope.documentCustodyStatus||"Owner Custody"),documentCustodyAssignedAt:isBoardSigningRole(recipient.role,recipient)?serverTimestamp():(envelope.documentCustodyAssignedAt||null),updatedAt:serverTimestamp()});if(!completed&&envelope.signingMode!=="Parallel"&&nextRecipient){try{await releaseNextSigner({...envelope,...update},nextRecipient);}catch(error){await recordEnvelopeEvent(envelope.id,"Next Signer Release Failed",{signerUid:nextRecipient.uid,signerEmail:nextRecipient.email||"",error:error?.message||"Unable to release next signer"});}}await recordEnvelopeEvent(envelope.id,"Workflow Action Completed",{signerUid:u.uid,signerName:profile?.displayName||u.displayName||u.email,workflowRole:recipient.role||"Action",originalDocumentHash:originalHash,signedDocumentHash:finalHash,status:completed?"Completed":"In Progress",signingMode:envelope.signingMode,requiredActionCount:actionable.length,comments:commentEntries,nextSignerUid:nextRecipient?.uid||null,nextSignerName:nextRecipient?.name||"",nextSignerRole:nextRecipient?.role||""});return{...envelope,...update,id:envelope.id,signerArchiveDeliveries,signerArchiveFinalHash:completed?finalHash:(envelope.signerArchiveFinalHash||null),signerArchiveStatus:completed?"Final Completed Document Delivered":"Tracking Until Final Signature"};}
async function releaseViewOnlyRecipient(envelope,recipient){if(!recipient?.email)return{sent:false};const cleanEmail=String(recipient.email).trim().toLowerCase();const actionCodeSettings={url:window.location.origin+"/?signEnvelope="+encodeURIComponent(envelope.id),handleCodeInApp:true};await sendSignInLinkToEmail(auth,cleanEmail,actionCodeSettings);await recordEnvelopeEvent(envelope.id,"View-Only Access Released",{signerUid:recipient.uid,signerEmail:cleanEmail,signerName:recipient.name||"",role:recipient.role||"View Only",deliveryStatus:"Accepted by Firebase Authentication"});return{sent:true,email:cleanEmail};}
async function releaseNextSigner(envelope,nextRecipient){
  if(!nextRecipient?.email)return {sent:false};
  const cleanEmail=String(nextRecipient.email).trim().toLowerCase();
  const actionCodeSettings={url:window.location.origin+"/?signEnvelope="+encodeURIComponent(envelope.id),handleCodeInApp:true};
  await sendSignInLinkToEmail(auth,cleanEmail,actionCodeSettings);
  await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),{currentSignerEmail:cleanEmail,currentSignerName:nextRecipient.name||"",currentSignerInvitationStatus:"Sent",currentSignerInvitationSentAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await recordEnvelopeEvent(envelope.id,"Next Signer Released",{signerUid:nextRecipient.uid,signerEmail:cleanEmail,signerName:nextRecipient.name||"",routingOrder:nextRecipient.routingOrder,deliveryStatus:"Accepted by Firebase Authentication"});
  return {sent:true,email:cleanEmail};
}

export async function recordSignatureAdoption({documentId,documentReference,fieldId,signatureProfile}){const u=user(),r=doc(collection(db,"signatures"));await setDoc(r,{documentId:documentId||null,documentReference:documentReference||"",fieldId:fieldId||"",signerUid:u.uid,signerEmail:u.email||"",signerName:signatureProfile?.displayName||u.displayName||"",signatureMethod:signatureProfile?.method||"Upload",signatureSha256:signatureProfile?.signatureSha256||null,status:"Signed",signedAt:serverTimestamp(),createdAt:serverTimestamp(),immutable:true});return r.id;}
export async function createCompletionCertificate(envelope){const u=user();const pdf=await PDFDocument.create();const page=pdf.addPage([595,842]);const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);page.drawText("IRPA DIGITAL GOVERNANCE SYSTEM",{x:48,y:790,size:11,font:bold,color:rgb(.15,.2,.3)});page.drawText("CERTIFICATE OF COMPLETION",{x:48,y:750,size:24,font:bold});const rows=[["Envelope",envelope.envelopeReference],["Subject",envelope.title],["Document",envelope.documentReference],["Status",envelope.status],["Completed",new Date().toISOString()],["Final document hash",envelope.latestDocumentHash||"—"]];let y=700;for(const [a,b]of rows){page.drawText(a,{x:48,y,size:10,font:bold});page.drawText(String(b),{x:190,y,size:10,font});y-=34;}page.drawText("SIGNER EVENTS",{x:48,y:y-10,size:13,font:bold});y-=40;for(const r of envelope.recipients||[]){page.drawText(`${r.name||r.email} — ${r.email||""}`,{x:48,y,size:10,font});y-=20;}page.drawText("This certificate records the signing transaction captured by the IRPA Signature Platform. It is an electronic transaction record, not a PKI certificate.",{x:48,y:80,size:8,font,maxWidth:500});const bytes=await pdf.save();const certificateHash=await hashBytes(bytes);const path=`signatureEnvelopes/${envelope.id}/certificate-${certificateHash}.pdf`;const r=ref(null,path);await uploadBytes(r,bytes,{contentType:"application/pdf",customMetadata:{envelopeId:envelope.id,certificateHash}});const url=await getDownloadURL(r);await updateDoc(doc(db,ENVELOPE_COLLECTION,envelope.id),{certificatePath:path,certificateUrl:url,certificateHash,updatedAt:serverTimestamp()});await recordEnvelopeEvent(envelope.id,"Certificate Generated",{certificateHash,actorUid:u.uid});return url;}
