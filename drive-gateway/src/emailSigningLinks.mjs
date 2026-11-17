import { sha256Hex, safeEqual } from "./util.mjs";

const NEUTRAL = "This signing link is unavailable. Contact the document owner for a new invitation.";
const normalizeEmail = value => String(value || "").trim().toLowerCase();

export function genericEmailSigningFailure(){ return NEUTRAL; }

export async function hashNormalizedEmail(email){
  const normalized=normalizeEmail(email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("A valid signer email is required.");
  return sha256Hex(normalized);
}

export async function createEmailSigningToken({envelopeId,signerId,email,now=new Date(),ttlDays=7,randomBytes}){
  const bytes=randomBytes?new Uint8Array(randomBytes):crypto.getRandomValues(new Uint8Array(32));
  if(bytes.byteLength<32)throw new Error("Email signing tokens require at least 32 random bytes.");
  const token=[...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
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
