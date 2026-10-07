export const CLASSIFICATIONS = ["Public","Internal","Confidential","Restricted"];
export const WORKFLOW_STAGES = ["WORKING","PENDING_SIGNATURE","SIGNED","POST_SIGNATURE","FINAL_ARCHIVE"];
const normalize = v => String(v ?? "").trim();
const upper = v => normalize(v).toUpperCase();
const list = v => Array.isArray(v) ? v.map(normalize).filter(Boolean) : [];
export function resolveIdentity({uid,email,member,employee,admin}={}) {
  if (!normalize(uid)) throw new Error("Authenticated user UID is required.");
  const activeAdmin = Boolean(admin?.active === true);
  const activeMember = [member?.status,member?.registrationStatus].some(v => ["active","activated"].includes(String(v||"").toLowerCase()));
  const activeEmployee = [employee?.status,employee?.employmentStatus,employee?.registrationStatus].some(v => ["active","activated"].includes(String(v||"").toLowerCase()));
  if (!activeAdmin && !activeMember && !activeEmployee) throw new Error("An active IRPA member, employee, or administrator profile is required.");
  const roles = [...list(member?.roles),...list(member?.assignedRoles),...list(member?.selectedRoles),member?.role,...list(employee?.roles),...list(employee?.assignedRoles),...list(employee?.selectedRoles),employee?.role].map(normalize).filter(Boolean);
  return {uid:normalize(uid),email:normalize(email).toLowerCase(),actorType:activeAdmin?"ADMINISTRATOR":activeEmployee?"EMPLOYEE":"MEMBER",roles:[...new Set(roles)],department:normalize(employee?.department||member?.department),unit:normalize(employee?.unit||member?.unit)};
}
export function canUpload(identity,{classification="Internal",documentType="Administrative",archiveCategory="Administrative Documents"}={}) {
  const c=normalize(classification),t=normalize(documentType),a=normalize(archiveCategory);
  if(!CLASSIFICATIONS.includes(c))return{allowed:false,reason:"Invalid classification."};
  if(!t||!a)return{allowed:false,reason:"Document type and archive category are required."};
  const roleSet=identity.roles.map(upper);
  if(c==="Restricted"&&identity.actorType!=="ADMINISTRATOR"&&!roleSet.includes("RESTRICTED_DOCUMENT_UPLOAD"))return{allowed:false,reason:"Restricted document upload permission is required."};
  if((t==="Administrator"||a==="Administrator Documents")&&identity.actorType!=="ADMINISTRATOR"&&!roleSet.includes("ADMINISTRATOR_DOCUMENT_UPLOAD"))return{allowed:false,reason:"Administrator document upload permission is required."};
  if(a==="Finance Documents"&&identity.actorType!=="ADMINISTRATOR"&&!identity.roles.some(r=>/finance/i.test(r))&&!/finance/i.test(identity.department))return{allowed:false,reason:"Finance document upload authority is required."};
  if(a==="Procurement Documents"&&identity.actorType!=="ADMINISTRATOR"&&!identity.roles.some(r=>/procurement/i.test(r))&&!/procurement/i.test(identity.department))return{allowed:false,reason:"Procurement document upload authority is required."};
  return{allowed:true};
}
export function canRead(identity,doc) {
  if(!doc||!normalize(doc.documentId||doc.id))return{allowed:false,reason:"Document registry record is required."};
  if(identity.actorType==="ADMINISTRATOR")return{allowed:true,reason:"Administrator"};
  const c=normalize(doc.classification||"Internal");
  if(c==="Public"||c==="Internal")return{allowed:true,reason:c};
  if(normalize(doc.ownerUid)===identity.uid)return{allowed:true,reason:"Owner"};
  if(list(doc.authorizedUids).includes(identity.uid))return{allowed:true,reason:"Explicit user authorization"};
  if(list(doc.authorizedDepartments).includes(identity.department))return{allowed:true,reason:"Department authorization"};
  if(list(doc.authorizedRoles).some(r=>identity.roles.includes(r)))return{allowed:true,reason:"Role authorization"};
  return{allowed:false,reason:normalize(doc.classification||"Controlled")+" document is not authorized for this user."};
}
export function canTransition(identity,doc,targetStage) {
  const target=normalize(targetStage);
  if(!WORKFLOW_STAGES.includes(target))return{allowed:false,reason:"Invalid workflow stage."};
  if(!canRead(identity,doc).allowed)return{allowed:false,reason:"Document access is required."};
  if(target==="PENDING_SIGNATURE"&&normalize(doc.status)!=="WORKING")return{allowed:false,reason:"Only working documents can be sent for signature."};
  if(target==="SIGNED"&&normalize(doc.status)!=="PENDING_SIGNATURE")return{allowed:false,reason:"Only documents pending signature can be marked signed."};
  if(target==="POST_SIGNATURE"&&normalize(doc.status)!=="SIGNED")return{allowed:false,reason:"Only signed documents can enter post-signature processing."};
  if(target==="FINAL_ARCHIVE"&&normalize(doc.status)!=="POST_SIGNATURE")return{allowed:false,reason:"Only post-signature documents can enter final archive."};
  if((target==="SIGNED"||target==="FINAL_ARCHIVE")&&identity.actorType!=="ADMINISTRATOR"&&normalize(doc.ownerUid)!==identity.uid&&!list(doc.authorizedRoles).some(r=>identity.roles.includes(r)))return{allowed:false,reason:"Workflow authority is required."};
  return{allowed:true};
}
export function buildDocumentRecord(identity,input,{documentId,fileId,fileName,fileSize,sha256,archivePath}={}) {
  const now=new Date().toISOString(),id=normalize(documentId||input.documentId||input.reference);
  if(!id)throw new Error("Document ID/reference is required.");
  const c=normalize(input.classification||"Internal");
  return{documentId:id,reference:normalize(input.reference)||id,title:normalize(input.title)||normalize(fileName)||id,fileName:normalize(fileName),fileId:normalize(fileId),storageProvider:"Google Drive",fileSize:Number(fileSize||0),sha256:normalize(sha256),ownerUid:identity.uid,ownerType:identity.actorType,department:identity.department||null,unit:identity.unit||null,documentType:normalize(input.documentType),archiveCategory:normalize(input.archiveCategory),classification:c,accessPolicy:c==="Public"?"PUBLIC":c==="Internal"?"IRPA_INTERNAL":"CONTROLLED",authorizedUids:[identity.uid],authorizedRoles:list(input.authorizedRoles),authorizedDepartments:list(input.authorizedDepartments),status:"WORKING",authorizationStatus:"AUTHORIZED",signatureStatus:"NOT_SENT",postSignatureStatus:"NOT_STARTED",finalArchiveStatus:"NOT_ARCHIVED",version:normalize(input.version)||"1.0",parentDocumentId:normalize(input.parentDocumentId)||null,supersedesDocumentId:normalize(input.supersedesDocumentId)||null,archivePath:normalize(archivePath),uploadedAt:now,uploadedByUid:identity.uid,createdAt:now,updatedAt:now};
}
