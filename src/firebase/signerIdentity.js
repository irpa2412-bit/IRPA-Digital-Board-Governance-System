import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db } from "./config";

export const SIGNER_IDENTITY_COLLECTION = "signerIdentities";
export const IRPA_ORGANISATION = "Improvement of Rangeland in Pastoral Areas";

function currentUser(){
  if(!auth.currentUser) throw new Error("Authentication is required.");
  return auth.currentUser;
}

function normalise(value){
  return String(value||"").trim();
}

export async function getMySignerIdentity(){
  const u=currentUser();
  const ref=doc(db,SIGNER_IDENTITY_COLLECTION,u.uid);
  const snap=await getDoc(ref);
  return snap.exists()?{id:snap.id,...snap.data()}:null;
}

export async function ensureMySignerIdentity(profile, options={}){
  const u=currentUser();
  const ref=doc(db,SIGNER_IDENTITY_COLLECTION,u.uid);
  const existing=await getDoc(ref);
  const authorityRole=normalise(options.authorityRole||existing.data()?.authorityRole||"");
  const organisationName=normalise(options.organisationName||existing.data()?.organisationName||IRPA_ORGANISATION);
  const payload={
    uid:u.uid,
    signerProfileId:u.uid,
    signerName:normalise(profile?.displayName||u.displayName||u.email||"Signer"),
    email:normalise(profile?.email||u.email||""),
    organisationName,
    authorityRole:authorityRole||"Not yet assigned",
    authorityStatus:normalise(options.authorityStatus||existing.data()?.authorityStatus||"Unspecified"),
    authorityReference:normalise(options.authorityReference||existing.data()?.authorityReference||""),
    authorityEffectiveAt:options.authorityEffectiveAt||existing.data()?.authorityEffectiveAt||null,
    authorityExpiresAt:options.authorityExpiresAt||existing.data()?.authorityExpiresAt||null,
    trustRecordVersion:"1.0",
    migrationSource:existing.data()?.migrationSource||"signatureProfiles",
    migratedFromSignatureProfile:existing.data()?.migratedFromSignatureProfile??true,
    signatureStatus:normalise(profile?.status||existing.data()?.signatureStatus||"Profile Setup Required"),
    revocationStatus:normalise(profile?.status==="Revoked"?"Revoked":existing.data()?.revocationStatus||"Active"),
    revocationReason:normalise(profile?.revocationReason||existing.data()?.revocationReason||""),
    currentSignatureHash:profile?.signatureSha256||existing.data()?.currentSignatureHash||null,
    updatedAt:serverTimestamp()
  };
  if(!existing.exists()){
    await setDoc(ref,{...payload,createdAt:serverTimestamp()});
  }else{
    await updateDoc(ref,payload);
  }
  return {id:u.uid,...payload};
}

export async function updateMySignerAuthority(data={}){ 
  const u=currentUser();
  const ref=doc(db,SIGNER_IDENTITY_COLLECTION,u.uid);
  const snap=await getDoc(ref);
  if(!snap.exists()) throw new Error("Signer Identity record is not available. Restore the Signer Identity link before updating signing authority.");

  const email=normalise(u.email).toLowerCase();
  const registeredRecords=[];
  const directMember=await getDoc(doc(db,"members",u.uid)).catch(()=>null);
  const directEmployee=await getDoc(doc(db,"employees",u.uid)).catch(()=>null);
  if(directMember?.exists())registeredRecords.push({id:directMember.id,...directMember.data(),sourceCollection:"members"});
  if(directEmployee?.exists())registeredRecords.push({id:directEmployee.id,...directEmployee.data(),sourceCollection:"employees"});
  if(email){
    const [memberMatches,employeeMatches]=await Promise.all([
      getDocs(query(collection(db,"members"),where("email","==",email))).catch(()=>null),
      getDocs(query(collection(db,"employees"),where("email","==",email))).catch(()=>null)
    ]);
    memberMatches?.forEach(item=>registeredRecords.push({id:item.id,...item.data(),sourceCollection:"members"}));
    employeeMatches?.forEach(item=>registeredRecords.push({id:item.id,...item.data(),sourceCollection:"employees"}));
  }
  const uniqueRecords=[...new Map(registeredRecords.map(item=>[item.sourceCollection+":"+item.id,item])).values()]
    .filter(item=>String(item.status||item.employmentStatus||"Active").toLowerCase()!=="inactive");
  if(!uniqueRecords.length) throw new Error("No active IRPA member or employee register entry was found for this account.");

  const authorityOptions=[...new Set(uniqueRecords.flatMap(record=>[
    record.role,record.boardPosition,
    ...(Array.isArray(record.roles)?record.roles:[]),
    ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
    ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
    ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
  ]).flatMap(value=>String(value||"").split(",").map(value=>value.trim()).filter(Boolean)))];

  const authorityRole=normalise(data.authorityRole);
  if(!authorityRole) throw new Error("Select the current signing authority before saving.");
  if(!authorityOptions.includes(authorityRole)){
    throw new Error("The selected signing authority is not registered to your IRPA member/employee record. Select an authority from the controlled list.");
  }

  const authorityStatus=normalise(data.authorityStatus||"Current");
  const allowedStatuses=["Current","Pending Verification","Expired","Not yet assigned"];
  if(!allowedStatuses.includes(authorityStatus)) throw new Error("Select a valid signing authority status.");

  const authorityReference=normalise(data.authorityReference||"");
  const authorityEffectiveAt=normalise(data.authorityEffectiveAt||"")||null;
  const authorityExpiresAt=normalise(data.authorityExpiresAt||"")||null;
  if(authorityExpiresAt&&authorityEffectiveAt&&authorityExpiresAt<authorityEffectiveAt){
    throw new Error("Authority expiry date cannot be earlier than the effective date.");
  }

  const source=uniqueRecords.find(record=>{
    const values=[
      record.role,record.boardPosition,
      ...(Array.isArray(record.roles)?record.roles:[]),
      ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
      ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
      ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
    ].flatMap(value=>String(value||"").split(",").map(value=>value.trim()).filter(Boolean));
    return values.includes(authorityRole);
  })||uniqueRecords[0];

  const authorityDepartment=normalise(source.department||"");
  const authorityUnit=normalise(source.unit||source.unitName||source.boardPosition||"");
  await updateDoc(ref,{
    authorityRole,
    authorityStatus,
    authorityReference,
    authorityEffectiveAt,
    authorityExpiresAt,
    authorityDepartment,
    authorityUnit,
    authoritySourceCollection:source.sourceCollection,
    authoritySourceRecordId:source.id,
    authorityUpdatedAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  });
  const updated=await getDoc(ref);
  return updated.exists()?{id:updated.id,...updated.data()}:null;
}

export async function recordSignerAuthenticationEvidence(identityId, context={}){
  const u=currentUser();
  if(identityId!==u.uid) throw new Error("Signer identity ownership verification failed.");
  const ref=doc(db,SIGNER_IDENTITY_COLLECTION,identityId);
  await updateDoc(ref,{
    lastAuthentication:{
      uid:u.uid,
      email:normalise(u.email),
      provider:normalise(u.providerData?.[0]?.providerId||"firebase"),
      authenticatedAt:serverTimestamp(),
      context:normalise(context.context||"Signature Portal")
    },
    updatedAt:serverTimestamp()
  });
}
