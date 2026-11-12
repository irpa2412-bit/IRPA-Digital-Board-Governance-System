export async function applySigningAuthorityEnforcement({env={},user,manualAuthorityIdentification,documentId,verify,recordAudit,logger=console}){
  try{
    return await verify();
  }catch(error){
    if(Number(error?.status)!==403)throw error;
    const mode=String(env.AUTHORITY_ENFORCEMENT||"shadow").trim().toLowerCase()==="enforce"?"enforce":"shadow";
    if(mode==="enforce")throw error;
    const audit={documentId:String(documentId||""),signerUid:String(user?.uid||""),statusValue:String(error?.authorityStatusValue||"MISSING"),reason:String(error?.authorityReason||error?.message||"authority verification failed")};
    if(typeof recordAudit!=="function")throw new Error("Signing authority shadow audit is not configured.");
    await recordAudit(audit);
    logger.warn?.("Signing authority rejection recorded in shadow mode",audit);
    return{verified:false,shadowAllowed:true,authorityRole:String(manualAuthorityIdentification||""),authorityDepartment:"",authorityUnit:"",authoritySourceCollection:"",authoritySourceRecordId:"",verificationMethod:"AUTHORITY_ENFORCEMENT_SHADOW"};
  }
}
