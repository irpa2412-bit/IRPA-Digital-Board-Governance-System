import { sha256Hex, safeEqual } from "./util.mjs";
import { gatewayAuthorityCandidates, normalizeGatewayAuthority, resolveGatewayAuthorityLabel } from "./signatureAuthority.mjs";

const NEUTRAL = "This signing link is unavailable. Contact the document owner for a new invitation.";
const normalizeEmail = value => String(value || "").trim().toLowerCase();

export function genericEmailSigningFailure(){ return NEUTRAL; }

export async function hashNormalizedEmail(email){
  const normalized=normalizeEmail(email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("A valid signer email is required.");
  return sha256Hex(normalized);
}

function base64Url(bytes){
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}

export async function createEmailSigningToken({envelopeId,signerId,email,now=new Date(),ttlDays=7,randomBytes}){
  const bytes=randomBytes?new Uint8Array(randomBytes):crypto.getRandomValues(new Uint8Array(32));
  if(bytes.byteLength<32)throw new Error("Email signing tokens require at least 32 random bytes.");
  const token=base64Url(bytes);
  const tokenHash=await sha256Hex(token);
  const createdAt=new Date(now).toISOString();
  const days=Math.max(1,Math.min(30,Number(ttlDays)||7));
  const record={
    tokenHash,
    envelopeId:String(envelopeId),
    signerId:String(signerId),
    emailHash:await hashNormalizedEmail(email),
    createdAt,
    expiresAt:new Date(new Date(now).getTime()+days*86400000).toISOString(),
    status:"issued",
    attemptCount:0,
    openCount:0,
    ipAttempts:{},
    lastIpHash:null,
    usedAt:null,
    revokedAt:null
  };
  return {token,tokenBytes:bytes.byteLength,record};
}

export async function inspectEmailSigningToken(token,record,now=new Date()){
  const hash=await sha256Hex(String(token||""));
  const valid=Boolean(record&&record.status==="issued"&&record.tokenHash&&safeEqual(hash,record.tokenHash)&&Number.isFinite(Date.parse(record.expiresAt))&&new Date(now).getTime()<Date.parse(record.expiresAt));
  return valid?{ok:true,record}:{ok:false,error:genericEmailSigningFailure()};
}

export async function markEmailSigningTokenOpened(record,{token,now=new Date(),ipHash=null,maxAttempts=8,windowMs=15*60*1000}={}){
  const inspected=await inspectEmailSigningToken(token,record,now);
  if(!inspected.ok)throw new Error(genericEmailSigningFailure());
  const previous=record.ipAttempts&&typeof record.ipAttempts==="object"?record.ipAttempts:{};
  const cutoff=new Date(now).getTime()-windowMs;
  const ipAttempts={};
  for(const [key,values] of Object.entries(previous)){
    const kept=(Array.isArray(values)?values:[]).map(Number).filter(value=>Number.isFinite(value)&&value>cutoff);
    if(kept.length)ipAttempts[key]=kept;
  }
  const key=String(ipHash||"unknown");
  const attempts=ipAttempts[key]||[];
  if(Number(record.attemptCount||0)>=maxAttempts||attempts.length>=maxAttempts)throw new Error(genericEmailSigningFailure());
  attempts.push(new Date(now).getTime());
  ipAttempts[key]=attempts;
  return {...record,status:"opened",openCount:Number(record.openCount||0)+1,attemptCount:Number(record.attemptCount||0)+1,ipAttempts,lastIpHash:ipHash||null,openedAt:new Date(now).toISOString()};
}

export function consumeEmailSigningToken(record,{now=new Date()}={}){
  if(!record||record.status!=="opened"||Date.parse(record.expiresAt)<=new Date(now).getTime())throw new Error(genericEmailSigningFailure());
  return {...record,status:"used",usedAt:new Date(now).toISOString()};
}

export function revokeEmailSigningToken(record,{now=new Date(),actorUid=""}={}){
  if(!record||["used","revoked"].includes(record.status))return record;
  return {...record,status:"revoked",revokedAt:new Date(now).toISOString(),revokedByUid:String(actorUid||"")};
}

function isActive(record){
  const status=String(record?.status||record?.employmentStatus||record?.registrationStatus||"").trim().toLowerCase();
  return ["active","activated"].includes(status)&&record?.accountActivated!==false;
}

function matrixAllows(role,matrix){
  const wanted=normalizeGatewayAuthority(role);
  const rows=Array.isArray(matrix)?matrix:Array.isArray(matrix?.rows)?matrix.rows:[];
  return rows.some(row=>{
    const rowRole=normalizeGatewayAuthority(row?.role||row?.authorityRole||row?.title||"");
    const action=String(row?.sign||row?.signature||row?.action||"").toLowerCase();
    const allowed=row?.canSign===true||row?.signature===true||/sign|execute|authori[sz]ed signatory/.test(action);
    return rowRole===wanted&&allowed&&row?.active!==false;
  });
}

export function resolveEmailSignerAuthority({email,memberRecords=[],employeeRecords=[],matrix=[],now=new Date()}={}){
  const normalized=normalizeEmail(email);
  const records=[
    ...(Array.isArray(memberRecords)?memberRecords:[]).map(record=>({...record,sourceCollection:"members"})),
    ...(Array.isArray(employeeRecords)?employeeRecords:[]).map(record=>({...record,sourceCollection:"employees"}))
  ].filter(record=>normalizeEmail(record.email)===normalized&&isActive(record));
  if(records.length!==1)return {verified:false,reason:"No unique active Member or Employee register match."};
  const record=records[0];
  const roles=gatewayAuthorityCandidates(record);
  const matchedRole=roles.find(role=>matrixAllows(role,matrix));
  if(!matchedRole)return {verified:false,reason:"The active register entry has no matching signature-authority matrix role."};
  const expiry=record.authorityExpiresAt||record.authorityExpiry||record.validUntil||null;
  if(expiry&&Date.parse(String(expiry))<=new Date(now).getTime())return {verified:false,reason:"The registered authority has expired."};
  return {verified:true,authorityRole:resolveGatewayAuthorityLabel(record,matchedRole)||matchedRole,sourceCollection:record.sourceCollection,sourceRecordId:String(record.id||""),department:String(record.department||""),unit:String(record.unit||record.unitName||""),matchedEmailHashOnly:true};
}
