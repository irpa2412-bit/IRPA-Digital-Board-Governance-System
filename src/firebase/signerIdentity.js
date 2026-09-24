import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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

  // The authority selector is constrained to the authenticated person's
  // registered IRPA roles. Department/unit are identity attributes, not
  // free-text values supplied by the signer, which prevents impersonation
  // through arbitrary authority labels.
  const [memberSnap,employeeSnap]=await Promise.all([
    getDoc(doc(db,"members",u.uid)),
    getDoc(doc(db,"employees",u.uid))
  ]);
  const member=memberSnap.exists()?memberSnap.data():{};
  const employee=employeeSnap.exists()?employeeSnap.data():{};
  const registeredRoles=[
    ...(Array.isArray(member.roles)?member.roles:[]),
    ...(Array.isArray(employee.roles)?employee.roles:[]),
    member.role,employee.role,member.boardPosition,employee.boardPosition
  ].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
  const allowedRoles=[...new Set(registeredRoles)];
  const authorityRole=normalise(data.authorityRole);
  if(!authorityRole) throw new Error("Select the current signing authority before saving.");
  if(!allowedRoles.includes(authorityRole)){
    throw new Error("The selected signing authority is not registered to this member. Use the authority options provided by the member and employee registers.");
  }
  if(!authorityRole) throw new Error("Enter the current signing authority before saving.");
  const authorityStatus=normalise(data.authorityStatus||"Current");
  const allowedStatuses=["Current","Pending Verification","Expired","Not yet assigned"];
  if(!allowedStatuses.includes(authorityStatus)) throw new Error("Select a valid signing authority status.");
  const authorityReference=normalise(data.authorityReference||"");
  const authorityEffectiveAt=normalise(data.authorityEffectiveAt||"")||null;
  const authorityExpiresAt=normalise(data.authorityExpiresAt||"")||null;
  if(authorityExpiresAt&&authorityEffectiveAt&&authorityExpiresAt<authorityEffectiveAt){
    throw new Error("Authority expiry date cannot be earlier than the effective date.");
  }
  await updateDoc(ref,{
    authorityRole,
    authorityStatus,
    authorityReference,
    authorityEffectiveAt,
    authorityExpiresAt,
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
