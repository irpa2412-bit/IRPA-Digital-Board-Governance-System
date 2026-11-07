export function isCurrentSigningAuthorityRecord(record,userUid,now=Date.now()){
  if(!record||typeof record!=="object")return false;
  const status=String(record.status||record.employmentStatus||"").trim().toLowerCase();
  if(status!=="active")return false;
  if(record.authorityStatus!==undefined&&String(record.authorityStatus||"").trim()!=="Current")return false;
  if(record.matchedByEmail&&String(record.uid||"")!==String(userUid||""))return false;
  const expiry=record.authorityExpiresAt||record.authorityExpiry||record.authorityValidUntil||record.validUntil||record.expiresAt;
  if(expiry){const timestamp=typeof expiry==="object"&&expiry!==null&&Number.isFinite(Number(expiry.seconds))?Number(expiry.seconds)*1000:expiry instanceof Date?expiry.getTime():Date.parse(String(expiry));if(!Number.isFinite(timestamp)||timestamp<=Number(now))return false;}
  return true;
}
