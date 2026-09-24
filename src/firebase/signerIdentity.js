import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db } from "./config";
import { getFunctions, httpsCallable } from "firebase/functions";

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
    await setDoc(ref,{
      ...payload,
      authorityRole:authorityRole||"Not yet assigned",
      authorityStatus:normalise(options.authorityStatus||"Unspecified"),
      authorityReference:normalise(options.authorityReference||""),
      authorityEffectiveAt:options.authorityEffectiveAt||null,
      authorityExpiresAt:options.authorityExpiresAt||null,
      createdAt:serverTimestamp()
    });
  }else{
    // Authority is a separately controlled trust attribute. Existing authority
    // values are deliberately preserved here; changes go through the
    // server-authorized updateSignerAuthority callable.
    await updateDoc(ref,payload);
  }
  return {id:u.uid,...payload};
}

export async function updateMySignerAuthority(data={}){ 
  const u=currentUser();
  const authorityRole=normalise(data.authorityRole);
  if(!authorityRole) throw new Error("Select the current signing authority before saving.");
  const call=httpsCallable(getFunctions(undefined,"us-central1"),"updateSignerAuthority");
  const payload={
    authorityRole,
    authorityStatus:normalise(data.authorityStatus||"Current"),
    authorityReference:normalise(data.authorityReference||""),
    authorityEffectiveAt:normalise(data.authorityEffectiveAt||""),
    authorityExpiresAt:normalise(data.authorityExpiresAt||""),
    authorityDepartment:normalise(data.authorityDepartment||""),
    authorityUnit:normalise(data.authorityUnit||"")
  };
  try{
    const result=await call(payload);
    return {id:u.uid,...(result.data||{})};
  }catch(error){
    // The production project currently cannot deploy new callable functions
    // because its Google Cloud billing account is closed. Fall back only for
    // an unavailable/not-deployed function; Firestore rules remain the final
    // authorization boundary and validate the same institutional register.
    const code=String(error?.code||"");
    if(code!=="functions/not-found"&&code!=="functions/unavailable") {
      throw new Error(error?.message||"The server could not verify and save the signing authority.");
    }
    const ref=doc(db,SIGNER_IDENTITY_COLLECTION,u.uid);
    const snap=await getDoc(ref);
    if(!snap.exists()) throw new Error("Signer Identity record is not available. Restore the Signer Identity link before updating signing authority.");
    await updateDoc(ref,{
      ...payload,
      authorityUpdatedAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
    const updated=await getDoc(ref);
    return updated.exists()?{id:updated.id,...updated.data()}:null;
  }
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
