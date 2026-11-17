import {sealAndPersist,rollbackCryptographicEvidence,importPublicKeyJwk,verifyCryptographicEvidence} from "./cryptographicGate.mjs";import {Conflict,VersionConflict} from "./adapters.mjs";import {archivePath,parseArchiveSelection,signerCopyPath} from "./archives.mjs";import {MAX_SIGNERS,buildSignedPdf,validateSignatureInput} from "./pdf.mjs";import {HttpError,ID_RE,canonicalJson,cleanSegment,cleanText,randomHex,safeEqual,sha256Hex,validateEmail,validateName} from "./util.mjs";
import {createEmailSigningToken,markEmailSigningTokenOpened,genericEmailSigningFailure} from "./emailSigningLinks.mjs";
import {distributeCompletedSignatureDocument,getSignatureDistributionSummary,retryFailedSignatureDistributions} from "./signatureDistribution.mjs";
export async function chainEvents(events,e){const body={...e,prevHash:events.length?events.at(-1).hash:"GENESIS"};return[...events,{...body,hash:await sha256Hex(canonicalJson(body))}]}
export async function verifyChain(events){if(!Array.isArray(events))return false;let p="GENESIS";for(const e of events){const {hash,...b}=e;if(b.prevHash!==p||await sha256Hex(canonicalJson(b))!==hash)return false;p=hash}return true}
async function mutate(ctx,id,fn){for(let i=0;i<5;i++){const c=await ctx.meta.get("envelopes",id);if(!c)throw new HttpError(404,"Envelope not found.");if(!await verifyChain(c.events))throw new HttpError(409,"Signing audit chain failed verification.");const {patch,result}=await fn(c);if(!patch)return result;try{await ctx.meta.update("envelopes",id,patch,{ifVersion:c._v});return result}catch(e){if(!(e instanceof VersionConflict))throw e}}throw new HttpError(409,"Please retry.")}
function tokenParts(t){const p=String(t||"").split(".");if(p.length!==3||!ID_RE.test(p[0])||!/^S\d{1,2}$/.test(p[1])||!/^[0-9a-f]{64}$/.test(p[2]))throw new HttpError(401,"Invalid signing link.");return p}
async function load(ctx,t){const[eid,sid,secret]=tokenParts(t),e=await ctx.meta.get("envelopes",eid),s=e?.signers.find(x=>x.id===sid);if(!e||!s)throw new HttpError(401,"Invalid signing link.");if(!safeEqual(await sha256Hex(secret),s.tokenHash))throw new HttpError(403,"This signing link is not valid.");if(s.identityType==="email-link"&&(!["issued","opened"].includes(s.emailLinkStatus)||!Number.isFinite(Date.parse(s.emailLinkExpiresAt))||ctx.now().getTime()>=Date.parse(s.emailLinkExpiresAt)))throw new HttpError(401,genericEmailSigningFailure());return{env:e,signer:s}}
function active(ctx,e){if(["Voided","Declined"].includes(e.status))throw new HttpError(403,"This envelope is no longer active.");if(ctx.now()>new Date(e.expiresAt))throw new HttpError(403,"This signing link has expired.")}
function signingActionForFields(fields=[]){
  const responsibilities=(fields||[]).map(field=>String(field?.responsibility||"").trim().toLowerCase());
  if(responsibilities.some(value=>/authori[sz]/.test(value)))return "Authorise";
  if(responsibilities.some(value=>/approv/.test(value)))return "Approve";
  const types=new Set((fields||[]).map(field=>String(field?.type||"")));
  if(types.has("Initials")&&!types.has("Signature"))return "Initial";
  if(types.has("Signature"))return "Sign";
  if(types.has("Initials"))return "Initial";
  return "Review";
}
const can=(e,s)=>s.status==="Pending"&&e.signers.every(x=>Number(x.routingPosition??x.order??1)>=Number(s.routingPosition??s.order??1)||x.status==="Signed");
// Email-link bearer access is valid only after the one-time invitation redemption; every lookup remains scoped by load() to this envelope and signer ID.
export function canAuthenticatedSignerAccess(signer,user){
  if(signer?.identityType==="email-link") return signer.emailLinkStatus==="opened";
  if(!signer?.uid) return false;
  return Boolean(user?.uid)&&user.uid===signer.uid;
}
function assertSignerAuthentication(signer,user){
  if(!canAuthenticatedSignerAccess(signer,user)) throw new HttpError(403,"Sign in as the invited signer to continue.");
}
export async function verifySourceDocumentIntegrity(bytes,envelope={},sourceDocument={}){const rawHash=envelope.sha256||envelope.documentHash||envelope.originalHash||sourceDocument.sha256||sourceDocument.hash||null;const rawSize=envelope.byteLength??envelope.documentSize??envelope.fileSize??sourceDocument.fileSize??sourceDocument.byteLength??sourceDocument.size??null;const expectedHash=rawHash==null||String(rawHash).trim()===""?null:String(rawHash).trim().toLowerCase();const expectedSize=rawSize==null||rawSize===""||!Number.isFinite(Number(rawSize))?null:Number(rawSize);if((expectedHash&&expectedHash!==await sha256Hex(bytes))||(expectedSize!=null&&expectedSize!==bytes.byteLength))throw new HttpError(409,"The document failed its integrity check.");return{expectedHash,expectedSize}}
async function original(ctx,e){const d=await ctx.meta.get("documents",e.documentId),b=d&&await ctx.storage.get(d.primaryStorageId);if(!b)throw new HttpError(409,"The source document is unavailable.");await verifySourceDocumentIntegrity(b,e,d);return{doc:d,bytes:b}}
export function validateEnvelopeFields(fields,signers){
  if(fields==null)return[];
  if(!Array.isArray(fields)||fields.length>100)throw new HttpError(400,"Invalid signing fields.");
  const ids=new Set(),byId=new Map((signers||[]).map(x=>[x.id,x])),uids=new Set((signers||[]).map(x=>x.uid).filter(Boolean));
  const allowed=new Set(["Signature","Initials","Date","Number","Text","Comment","Remarks","Checkbox","Name"]);
  return fields.map(f=>{
    const fieldId=cleanSegment(f?.fieldId,100),type=String(f?.type||"");
    const page=Number(f?.page||1),x=Number(f?.x??10),y=Number(f?.y??80),width=Number(f?.width??24),height=Number(f?.height??9),requestedSignerId=String(f?.signerId||""),signerUid=String(f?.signerUid||"");
    const assigned=requestedSignerId?byId.get(requestedSignerId):(signerUid?(signers||[]).find(item=>item.uid===signerUid):null);
    if(!fieldId||ids.has(fieldId)||!allowed.has(type)||!assigned||(signerUid&&assigned.uid!==signerUid)||!Number.isInteger(page)||page<1||page>500||![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100||y+height>100)throw new HttpError(400,"A signing field is invalid or assigned to an unauthorized signer.");
    ids.add(fieldId);
    return{fieldId,type,page,x,y,width,height,signerId:assigned.id,signerUid:assigned.uid||null,required:f?.required===true,placeholder:cleanText(f?.placeholder||"",160),responsibility:cleanText(f?.responsibility||"",40)};
  });
}
export function validateFieldValues(fields,signer,values,signature,fieldApplications=[]){
  const assigned=(fields||[]).filter(f=>f.signerId===signer.id||(!f.signerId&&signer.uid&&f.signerUid===signer.uid)),out={},byId=new Map(assigned.map(f=>[f.fieldId,f])),applications=new Map();
  if(!Array.isArray(fieldApplications))throw new HttpError(400,"Explicit confirmed signature field applications are required.");
  for(const application of fieldApplications){
    const field=byId.get(String(application?.fieldId||""));
    if(!field||!["Signature","Initials"].includes(field.type))throw new HttpError(403,"A signature field application is not assigned to this signer.");
    if(applications.has(field.fieldId))throw new HttpError(400,"A signature field may be confirmed only once per submission.");
    if(application.confirmed!==true)throw new HttpError(400,"Signature application requires an explicit Confirm action.");
    for(const key of ["page","x","y","width","height"]){
      const submitted=Number(application[key]),saved=Number(field[key]??(key==="page"?1:0));
      if(!Number.isFinite(submitted)||submitted!==saved)throw new HttpError(409,"The confirmed signature field page or position differs from the saved assignment.");
    }
    const value=application.value;
    if(typeof value!=="string"||!value.startsWith("data:image/png;base64,")||value.length>120000)throw new HttpError(400,"Confirmed signature fields require a PNG specimen no larger than 120 KB.");
    applications.set(field.fieldId,value);
  }
  for(const f of assigned){
    let value=values&&Object.prototype.hasOwnProperty.call(values,f.fieldId)?values[f.fieldId]:undefined;
    if(f.type==="Signature"||f.type==="Initials"){
      value=applications.get(f.fieldId);
      if(!value)throw new HttpError(400,"Tap the assigned "+f.type.toLowerCase()+" field and confirm it before signing.");
      // Each assigned Signature/Initials field carries its own confirmed specimen; signer-level evidence remains a separate transaction event.
    }else if(f.type==="Checkbox"){
      value=value===true||value==="true"?"true":value===false||value==="false"?"false":"";
      if(value==="")throw new HttpError(400,"Complete the assigned checkbox field.");if(f.required&&value!=="true")throw new HttpError(400,"Complete the required checkbox field.");
    }else{
      value=String(value??"").trim();
      if(!value)throw new HttpError(400,"Complete the assigned "+f.type.toLowerCase()+" field.");
      if(value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new HttpError(400,"A signing field value is invalid.");
    }
    out[f.fieldId]=value;
  }
  if(JSON.stringify(out).length>240000)throw new HttpError(413,"Assigned signing field values exceed the permitted request size. Reduce the signature image size and try again.");
  return out;
}
export async function createEnvelope(ctx,user,body){
  if(!ctx.sendInvitation&&!ctx.allowReturnTokens)throw new HttpError(500,"Invitation transport is not configured.");
  const doc=ID_RE.test(String(body?.documentId||""))&&await ctx.meta.get("documents",body.documentId);
  if(!doc||doc.status!=="Stored"||(doc.ownerUid!==user.uid&&!user.isAdmin))throw new HttpError(403,"You are not authorized for this document.");
  const archives=parseArchiveSelection(body.archives),input=body.signers,signingMode=String(body?.signingMode||"Sequential");
  if(!["Sequential","Parallel"].includes(signingMode))throw new HttpError(400,"Unsupported signing mode.");
  if(!Array.isArray(input)||input.length<1||input.length>MAX_SIGNERS)throw new HttpError(400,`Provide between 1 and ${MAX_SIGNERS} signers.`);
  const cryptoRequired=["staging","production"].includes(ctx.env?.IRPA_ENVIRONMENT)||(ctx.env?.DRIVE_MOCK==="false"&&ctx.allowReturnTokens!==true);
  if(cryptoRequired&&input.some(s=>s?.identityType!=="email-link"))throw new HttpError(400,"Every signer must use the invited email-link identity.");
  // Email-link possession is transaction-scoped mailbox control, not an authority-register lookup.
  const sourceBytes=await ctx.storage.get(doc.primaryStorageId);
  if(!sourceBytes)throw new HttpError(409,"The stored document failed its integrity check.");
  await verifySourceDocumentIntegrity(sourceBytes,{},doc);
  const externalReference=String(body?.externalReference||"").trim();
  if(externalReference&&!ID_RE.test(externalReference))throw new HttpError(400,"Invalid external envelope reference.");
  const id=`ENV-${randomHex(8)}`,seenEmails=new Set(),seenUids=new Set(),signers=[],secrets=[];
  for(let i=0;i<input.length;i++){
    const s=input[i],email=validateEmail(s?.email).trim().toLowerCase(),uid=s?.uid?cleanSegment(s.uid,128):null;
    if(seenEmails.has(email))throw new HttpError(400,"Duplicate signer email.");
    seenEmails.add(email);
    if(uid&&seenUids.has(uid))throw new HttpError(400,"Duplicate signer UID.");
    if(uid)seenUids.add(uid);
    const signerId=`S${i+1}`,secret=randomHex(32),emailLink=true,authority=null;
    const profileUid=emailLink&&typeof ctx.resolveEmailLinkProfileUid==="function"?await ctx.resolveEmailLinkProfileUid(email):null;
    if(!uid&&!emailLink&&!ctx.allowLegacyTestSigners)throw new HttpError(403,"Unregistered email-only signers must use the verified email-link path.");
    const issued=emailLink?await createEmailSigningToken({envelopeId:id,signerId,email,now:ctx.now(),ttlDays:ctx.config?.emailLinkTtlDays||7,randomBytes:Uint8Array.from(secret.match(/.{2}/g).map(value=>parseInt(value,16)))}):null;
    secrets.push(secret);
    signers.push({id:signerId,email,emailHash:issued?.record.emailHash||null,profileUid:profileUid||null,name:validateName(s?.name||email),declaredParticulars:{name:cleanText(s?.name||"",160),title:cleanText(s?.title||"",160)},order:Number.isInteger(s?.routingPosition)&&s.routingPosition>0?s.routingPosition:Number.isInteger(s?.order)&&s.order>0?s.order:i+1,routingPosition:Number.isInteger(s?.routingPosition)&&s.routingPosition>0?s.routingPosition:Number.isInteger(s?.order)&&s.order>0?s.order:i+1,uid,status:"Pending",identityType:"email-link",tokenHash:issued?.record.tokenHash||await sha256Hex(secret),invitation:"Waiting",...(issued?{emailLinkStatus:"issued",emailLinkExpiresAt:issued.record.expiresAt,emailLinkAttemptCount:0,emailLinkOpenCount:0,emailLinkIpAttempts:{}}:{})});
  }
  const fields=validateEnvelopeFields(body?.fields,signers);
  const attachmentInputs=Array.isArray(body?.attachments)?body.attachments:[];
  if(attachmentInputs.length>10)throw new HttpError(400,"An envelope may include at most 10 optional attachments.");
  const attachments=[];
  for(let index=0;index<attachmentInputs.length;index++){
    const attachmentId=String(attachmentInputs[index]?.documentId||attachmentInputs[index]?.id||"").trim();
    if(!ID_RE.test(attachmentId)||attachmentId===doc.id)throw new HttpError(400,"An optional attachment reference is invalid.");
    const attachmentDoc=await ctx.meta.get("documents",attachmentId);
    if(!attachmentDoc||attachmentDoc.status!=="Stored"||(attachmentDoc.ownerUid!==user.uid&&!user.isAdmin))throw new HttpError(403,"You are not authorized for an optional envelope attachment.");
    const attachmentBytes=await ctx.storage.get(attachmentDoc.primaryStorageId);
    if(!attachmentBytes)throw new HttpError(409,"An optional attachment failed its integrity check.");
    const verified=await verifySourceDocumentIntegrity(attachmentBytes,{},attachmentDoc);
    attachments.push({id:"A"+String(index+1),documentId:attachmentDoc.id,title:cleanText(attachmentDoc.title||attachmentDoc.fileName||"Optional attachment",180),fileName:cleanText(attachmentDoc.fileName||"attachment",180),contentType:String(attachmentDoc.contentType||"application/octet-stream"),hash:verified.hash||attachmentDoc.sha256||attachmentDoc.hash||await sha256Hex(attachmentBytes),size:attachmentBytes.byteLength,storageId:attachmentDoc.primaryStorageId,optional:true});
  }
  const sourceHash=doc.sha256||doc.hash||await sha256Hex(sourceBytes),sourceSize=doc.fileSize??doc.byteLength??doc.size??sourceBytes.byteLength;
  const e={id,externalReference:externalReference||null,documentId:doc.id,documentHash:sourceHash,sha256:sourceHash,byteLength:sourceSize,documentSize:sourceSize,title:doc.title,fileName:doc.fileName,classification:doc.classification,ownerName:String(user.name||user.email||"IRPA Document Owner"),ownerEmail:String(user.email||"").trim().toLowerCase(),createdByEmail:String(user.email||"").trim().toLowerCase(),createdBy:user.uid,status:"Sent",signingMode,signers,fields,attachments,archiveTargets:archives,createdAt:ctx.now().toISOString(),expiresAt:new Date(ctx.now().getTime()+ctx.config.ttlDays*86400000).toISOString(),events:[],completion:null};
  e.events=await chainEvents([],{type:"envelope.created",at:e.createdAt,actor:user.uid,documentHash:sourceHash,signerCount:signers.length});
  let reservationKey=null;
  if(externalReference){
    reservationKey=await sha256Hex(user.uid+"\n"+externalReference);
    try{await ctx.meta.create("externalReferences",reservationKey,{ownerUid:user.uid,externalReference,envelopeId:id,createdAt:e.createdAt});}
    catch(error){
      if(!(error instanceof Conflict))throw error;
      const reservation=await ctx.meta.get("externalReferences",reservationKey);
      const existing=reservation?.envelopeId?await ctx.meta.get("envelopes",reservation.envelopeId):null;
      if(existing)return{ok:true,existing:true,envelopeId:existing.id,externalReference,status:existing.status,invitations:existing.signers.map(s=>({signerId:s.id,email:s.email,status:s.invitation}))};
      const reservationCreatedAt=Date.parse(String(reservation?.createdAt||""));
      const reservationAge=ctx.now().getTime()-reservationCreatedAt;
      if(reservation&&Number.isFinite(reservationAge)&&reservationAge>=5*60*1000&&Number.isInteger(reservation._v)){
        try{await ctx.meta.update("externalReferences",reservationKey,{ownerUid:user.uid,externalReference,envelopeId:id,createdAt:e.createdAt},{ifVersion:reservation._v});}
        catch(reclaimError){const current=await ctx.meta.get("externalReferences",reservationKey);const currentEnvelope=current?.envelopeId?await ctx.meta.get("envelopes",current.envelopeId):null;if(currentEnvelope)return{ok:true,existing:true,envelopeId:currentEnvelope.id,externalReference,status:currentEnvelope.status,invitations:currentEnvelope.signers.map(s=>({signerId:s.id,email:s.email,status:s.invitation}))};throw new HttpError(409,"An envelope is already being created for this external reference. Retry after it finishes.");}
      }else throw new HttpError(409,"An envelope is already being created for this external reference. Retry after it finishes.");
    }
  }
  try{await ctx.meta.create("envelopes",id,e);}
  catch(error){if(reservationKey)await ctx.meta.delete("externalReferences",reservationKey).catch(()=>{});throw error;}
  const firstPosition=Math.min(...signers.map(s=>Number(s.routingPosition||s.order||1)));
  for(let i=0;i<signers.length;i++){
    if(Number(signers[i].routingPosition||signers[i].order||1)!==firstPosition)continue;
    const token=id+"."+signers[i].id+"."+secrets[i];
    if(ctx.sendInvitation){try{const link=(ctx.config?.appUrl||"https://irpa-digital-board-governance.web.app")+"/?emailSignToken="+encodeURIComponent(token);await ctx.sendInvitation({to:signers[i].email,name:signers[i].name,link,emailLink:true,title:e.title,ownerName:user.name||user.email||"IRPA Document Owner",expiresAt:signers[i].emailLinkExpiresAt||e.expiresAt,role:String(input[i]?.title||input[i]?.role||""),action:signingActionForFields(fields.filter(f=>f.signerId===signers[i].id)),fieldCount:fields.filter(f=>f.signerId===signers[i].id).length});signers[i].invitation="Sent";signers[i].invitedAt=ctx.now().toISOString();}
    catch(err){signers[i].invitation="Failed";ctx.logger.error("ENVELOPE_INVITATION_FAILED",{envelopeId:id,signerId:signers[i].id,errorType:String(err?.name||"Error")});}}
    else signers[i].invitation="Sent";
  }
  await mutate(ctx,id,async cur=>{
    const at=ctx.now().toISOString();
    const updatedSigners=cur.signers.map((signer,index)=>({...signer,invitation:signers[index]?.invitation||signer.invitation,invitedAt:signers[index]?.invitedAt||signer.invitedAt||null,emailLinkStatus:Number(signer.routingPosition||signer.order||1)===firstPosition?"issued":"waiting"}));
    let events=cur.events;
    for(let index=0;index<updatedSigners.length;index++){
      const signer=updatedSigners[index];
      events=await chainEvents(events,{type:Number(signer.routingPosition||signer.order||1)===firstPosition?"email_link.issued":"signer.waiting_for_route",signerId:signer.id,emailHash:signer.emailHash||null,deliveryStatus:signer.invitation,expiresAt:signer.emailLinkExpiresAt||null,routingPosition:signer.routingPosition||signer.order,at});
    }
    return{patch:{signers:updatedSigners,events}};
  });
  const returnTokens=ctx.env?.IRPA_ENVIRONMENT==="staging"&&ctx.env?.IRPA_STAGING_CRYPTO_TEST_MODE==="true"?(body?.returnTokens===true):ctx.allowReturnTokens;
  return{ok:true,envelopeId:id,status:"Sent",invitations:signers.map(s=>({signerId:s.id,email:s.email,status:s.invitation})),...(returnTokens?{tokens:secrets.map((s,i)=>`${id}.S${i+1}.${s}`)}:{})};
}
async function consumeEmailLinkRateLimit(ctx,key,maxAttempts,now){
  const id=await sha256Hex("email-signing-rate:"+key);
  const cutoff=now.getTime()-15*60*1000;
  for(let attempt=0;attempt<5;attempt++){
    const current=await ctx.meta.get("emailLinkRateLimits",id);
    const attempts=(Array.isArray(current?.attempts)?current.attempts:[]).map(Number).filter(value=>Number.isFinite(value)&&value>cutoff);
    if(attempts.length>=maxAttempts)throw new HttpError(401,genericEmailSigningFailure());
    attempts.push(now.getTime());
    try{
      if(current)await ctx.meta.update("emailLinkRateLimits",id,{attempts,updatedAt:now.toISOString()},{ifVersion:current._v});
      else await ctx.meta.create("emailLinkRateLimits",id,{attempts,updatedAt:now.toISOString()});
      return;
    }catch(error){if(!(error instanceof Conflict)&&!(error instanceof VersionConflict))throw error;}
  }
  throw new HttpError(401,genericEmailSigningFailure());
}

export async function releaseRoutingPosition(ctx,id,position){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||["Completed","Voided","Declined"].includes(envelope.status))return{released:0};
  const eligible=envelope.signers.filter(s=>s.status==="Pending"&&Number(s.routingPosition??s.order??1)===Number(position));
  let released=0;
  for(const target of eligible){
    const now=ctx.now(),secret=randomHex(32),issued=await createEmailSigningToken({envelopeId:id,signerId:target.id,email:target.email,now,ttlDays:ctx.config?.emailLinkTtlDays||7,randomBytes:Uint8Array.from(secret.match(/.{2}/g).map(value=>parseInt(value,16)))});
    const committed=await mutate(ctx,id,async current=>{
      const signer=current.signers.find(item=>item.id===target.id);
      if(!signer||signer.status!=="Pending"||!can(current,signer))return{patch:null,result:false};
      signer.tokenHash=issued.record.tokenHash;signer.emailHash=issued.record.emailHash;signer.invitedAt=now.toISOString();signer.emailLinkStatus="issued";signer.emailLinkExpiresAt=issued.record.expiresAt;signer.emailLinkAttemptCount=0;signer.emailLinkOpenCount=0;signer.emailLinkIpAttempts={};signer.emailLinkOpenedAt=null;signer.openedAt=null;signer.invitedAt=now.toISOString();signer.invitation="Pending";
      return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:"email_link.issued",signerId:signer.id,routingPosition:position,emailHash:signer.emailHash,expiresAt:signer.emailLinkExpiresAt,at:now.toISOString()})},result:true};
    });
    if(!committed)continue;
    const link=(ctx.config?.appUrl||"https://irpa-digital-board-governance.web.app")+"/?emailSignToken="+encodeURIComponent(issued.token);
    try{
      if(typeof ctx.sendInvitation==="function")await ctx.sendInvitation({to:target.email,name:target.name,link,emailLink:true,title:envelope.title,ownerName:envelope.ownerName||"IRPA Document Owner",expiresAt:issued.record.expiresAt,role:String(target.declaredParticulars?.title||target.title||""),action:signingActionForFields((envelope.fields||[]).filter(field=>field.signerId===target.id)),fieldCount:(envelope.fields||[]).filter(field=>field.signerId===target.id).length});
      await mutate(ctx,id,async current=>{const signer=current.signers.find(item=>item.id===target.id);if(!signer)return{patch:null};signer.invitation="Sent";signer.invitedAt=ctx.now().toISOString();return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:typeof ctx.sendInvitation==="function"?"email_link.delivered":"email_link.delivery_simulated",signerId:signer.id,routingPosition:position,at:signer.invitedAt})}};});
      released++;
    }catch(error){
      await mutate(ctx,id,async current=>{const signer=current.signers.find(item=>item.id===target.id);if(signer){signer.invitation="Failed";signer.emailLinkStatus="revoked";}return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:"email_link.delivery_failed",signerId:target.id,routingPosition:position,at:ctx.now().toISOString(),errorType:String(error?.name||"Error")})}};});
      throw error;
    }
  }
  return{released,position};
}

export async function requestEmailSigningCode(ctx,token,ip=""){
  const now=ctx.now();
  try{
    const parts=tokenParts(token),tokenHash=await sha256Hex(parts[2]),earlyEnvelope=await ctx.meta.get("envelopes",parts[0]),earlySigner=earlyEnvelope?.signers?.find(item=>item.id===parts[1]);
    if(earlySigner&&earlyEnvelope&&safeEqual(await sha256Hex(parts[2]),earlySigner.tokenHash)&&!can(earlyEnvelope,earlySigner))throw new HttpError(409,"Not your turn yet. Your invitation will become active after every signer in the previous position has signed.");
    const loaded=await load(ctx,token),signer=loaded.signer;
    if(signer.identityType!=="email-link"||!["issued","opened"].includes(signer.emailLinkStatus)||now.getTime()>=Date.parse(signer.emailLinkExpiresAt))throw new Error("unavailable");
    if(signer.emailLinkStatus==="opened")return await openEmailSigning(ctx,token,ip);
    const kv=ctx.env?.DRIVE_KV;
    if(!kv||typeof kv.put!=="function"||typeof kv.get!=="function"||typeof kv.delete!=="function"||typeof ctx.sendEmailVerificationCode!=="function")throw new HttpError(503,"Email verification is temporarily unavailable.");
    const ipHash=await sha256Hex(String(ip||"unknown"));
    await consumeEmailLinkRateLimit(ctx,"code-send:"+tokenHash,3,now);
    await consumeEmailLinkRateLimit(ctx,"code-ip:"+ipHash,10,now);
    const code=String(Number.parseInt(randomHex(4),16)%1000000).padStart(6,"0");
    const expiresAt=new Date(now.getTime()+10*60*1000).toISOString();
    await kv.put("email-signing-code:"+tokenHash,JSON.stringify({codeHash:await sha256Hex(code+tokenHash),expiresAt}),{expirationTtl:600});
    await ctx.sendEmailVerificationCode({to:signer.email,name:signer.name,code,expiresAt});
    return {ok:true,requiresEmailCode:true,message:"Enter the 6-digit code sent to your email address to continue signing."};
  }catch(error){if(error instanceof HttpError&&(error.status===503||error.status===409))throw error;throw new HttpError(401,genericEmailSigningFailure());}
}

export async function confirmEmailSigningCode(ctx,token,code,ip=""){
  try{
    const parts=tokenParts(token),tokenHash=await sha256Hex(parts[2]);
    const loaded=await load(ctx,token);
    if(loaded.signer.identityType!=="email-link"||loaded.signer.emailLinkStatus!=="issued")throw new Error("unavailable");
    const kv=ctx.env?.DRIVE_KV;
    if(!kv||typeof kv.get!=="function"||typeof kv.delete!=="function")throw new Error("unavailable");
    const ipHash=await sha256Hex(String(ip||"unknown"));
    await consumeEmailLinkRateLimit(ctx,"code-verify:"+tokenHash+":"+ipHash,5,ctx.now());
    const raw=await kv.get("email-signing-code:"+tokenHash);
    const challenge=raw?JSON.parse(raw):null;
    if(!challenge||!/^\d{6}$/.test(String(code||""))||Date.parse(challenge.expiresAt)<=ctx.now().getTime()||!safeEqual(await sha256Hex(String(code)+tokenHash),String(challenge.codeHash||"")))throw new Error("unavailable");
    await kv.delete("email-signing-code:"+tokenHash);
    return await openEmailSigning(ctx,token,ip);
  }catch{throw new HttpError(401,genericEmailSigningFailure());}
}
export async function openEmailSigning(ctx,token,ip=""){
  const now=ctx.now(),ipHash=await sha256Hex(String(ip||"unknown"));
  try{
    const parts=tokenParts(token),earlyEnvelope=await ctx.meta.get("envelopes",parts[0]),earlySigner=earlyEnvelope?.signers?.find(item=>item.id===parts[1]);
    if(earlySigner&&earlyEnvelope&&safeEqual(await sha256Hex(parts[2]),earlySigner.tokenHash)&&!can(earlyEnvelope,earlySigner))throw new HttpError(409,"Not your turn yet. Your invitation will become active after every signer in the previous position has signed.");
    const tokenHash=await sha256Hex(parts[2]);
    await consumeEmailLinkRateLimit(ctx,"token:"+tokenHash,8,now);
    await consumeEmailLinkRateLimit(ctx,"ip:"+ipHash,20,now);
    const loaded=await load(ctx,token);
    if(loaded.signer.identityType!=="email-link"||!["issued","opened"].includes(loaded.signer.emailLinkStatus)||now.getTime()>=Date.parse(loaded.signer.emailLinkExpiresAt))throw new HttpError(401,genericEmailSigningFailure());
    active(ctx,loaded.env);
    let sessionToken=token;
    if(loaded.signer.emailLinkStatus==="issued"){
      const sessionSecret=randomHex(32);
      sessionToken=loaded.env.id+"."+loaded.signer.id+"."+sessionSecret;
      const sessionHash=await sha256Hex(sessionSecret);
      await mutate(ctx,loaded.env.id,async current=>{
        const signer=current.signers.find(item=>item.id===loaded.signer.id);
        if(!signer||signer.identityType!=="email-link"||signer.emailLinkStatus!=="issued")throw new HttpError(401,genericEmailSigningFailure());
        const opened=await markEmailSigningTokenOpened({tokenHash:signer.tokenHash,expiresAt:signer.emailLinkExpiresAt,status:signer.emailLinkStatus,attemptCount:signer.emailLinkAttemptCount,openCount:signer.emailLinkOpenCount,ipAttempts:signer.emailLinkIpAttempts},{token:parts[2],now,ipHash,maxAttempts:8});
        signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"used",usedAt:now.toISOString()}].slice(-10);
        signer.tokenHash=sessionHash;
        signer.emailLinkStatus=opened.status;
        signer.emailLinkOpenCount=opened.openCount;
        signer.emailLinkAttemptCount=opened.attemptCount;
        signer.emailLinkIpAttempts=opened.ipAttempts;
        signer.emailLinkLastIpHash=opened.lastIpHash;
        signer.emailLinkOpenedAt=opened.openedAt;signer.openedAt=opened.openedAt;signer.emailVerifiedAt=opened.openedAt;
        return {patch:{signers:current.signers,events:await chainEvents(current.events,{type:"email_link.opened",signerId:signer.id,at:now.toISOString(),ipHash,sessionTokenHash:sessionHash,invitationTokenConsumed:true})}};
      });
    }
    const preview=await openSigning(ctx,sessionToken,null);
    return {ok:true,title:preview.title,ownerName:preview.ownerName,linkExpiresAt:preview.linkExpiresAt,envelopeId:preview.envelopeId,signer:preview.signer,fields:preview.fields,canSign:preview.canSign,ownerDeclaredParticulars:preview.ownerDeclaredParticulars,sessionToken};
  }catch(error){
    if(error instanceof HttpError&&error.status===409)throw error;
    throw new HttpError(401,genericEmailSigningFailure());
  }
}

export async function openSigning(ctx,token,user=null){const{env,signer}=await load(ctx,token);active(ctx,env);assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");return{ok:true,envelopeId:env.id,externalReference:env.externalReference||null,documentId:env.documentId,title:env.title,ownerName:env.ownerName||"IRPA Document Owner",linkExpiresAt:signer.emailLinkExpiresAt||env.expiresAt,documentHash:env.documentHash,sha256:env.sha256||env.documentHash,byteLength:env.byteLength??env.documentSize??null,status:env.status,signer:{id:signer.id,identityType:signer.identityType,email:signer.email,name:signer.name,status:signer.status,emailVerified:signer.identityType==="email-link"&&signer.emailLinkStatus==="opened",authenticated:signer.identityType==="email-link"?signer.emailLinkStatus==="opened":!!signer.uid},signers:env.signers.map(s=>({id:s.id,name:s.name,title:s.title||"",email:s.email,routingPosition:Number(s.routingPosition??s.order??1),order:s.order,status:s.status,invitedAt:s.invitedAt||null,openedAt:s.openedAt||s.emailLinkOpenedAt||null,emailVerifiedAt:s.emailVerifiedAt||null,signedAt:s.signedAt||null})),fields:(env.fields||[]).filter(f=>f.signerId===signer.id||(!f.signerId&&signer.uid&&f.signerUid===signer.uid)),appliedFields:[],canSign:can(env,signer),ownerDeclaredParticulars:signer.declaredParticulars||{},attachments:(env.attachments||[]).map(a=>({id:a.id,title:a.title,fileName:a.fileName,contentType:a.contentType,hash:a.hash,size:a.size,optional:true}))}}
export async function getSigningAttachment(ctx,token,attachmentId,user=null){
  const{env,signer}=await load(ctx,token);
  active(ctx,env);
  if(signer.identityType==="email-link"&&signer.emailLinkStatus!=="opened")throw new HttpError(401,genericEmailSigningFailure());
  if(!user?.uid)assertSignerAuthentication(signer,user);
  const attachment=(env.attachments||[]).find(item=>item.id===attachmentId);
  if(!attachment)throw new HttpError(404,"Attachment not found.");
  const bytes=await ctx.storage.get(attachment.storageId);
  if(!bytes||await sha256Hex(bytes)!==attachment.hash)throw new HttpError(500,"Optional attachment integrity verification failed.");
  return{bytes,fileName:attachment.fileName,contentType:attachment.contentType,hash:attachment.hash};
}
export async function getSigningPdf(ctx,token,user=null){const{env,signer}=await load(ctx,token);if(signer.identityType==="email-link"&&signer.emailLinkStatus!=="opened")throw new HttpError(401,genericEmailSigningFailure());const isOwner=Boolean(user?.uid)&&user.uid===env.createdBy;if(!isOwner)assertSignerAuthentication(signer,user);if(env.status==="Completed"){if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");const b=await ctx.storage.get(env.completion.primaryStorageId);if(!b||await sha256Hex(b)!==env.completion.finalHash)throw new HttpError(500,"Integrity check failed.");return{bytes:b,fileName:env.completion.fileName,hash:env.completion.finalHash}}if(isOwner)throw new HttpError(409,"The completed signed PDF is not available yet.");active(ctx,env);const x=await original(ctx,env);return{bytes:x.bytes,fileName:env.fileName,hash:env.documentHash}}
export async function sign(ctx,{token,signature,fieldValues,fieldApplications=[],signatureConfirmed=false,consent,declarations={},ip,userAgent,user}){
  if(consent!==true)throw new HttpError(400,"Consent to sign electronically is required.");
  if(signatureConfirmed!==true&&Array.isArray(fieldApplications)&&fieldApplications.length>0)throw new HttpError(400,"A signature field cannot be applied without an explicit Confirm action.");
  const sig=signature?.type==="field-applications"&&Array.isArray(fieldApplications)&&fieldApplications.length?await validateSignatureInput({type:"drawn",value:fieldApplications[0]?.value}):await validateSignatureInput(signature),loaded=await load(ctx,token),e0=loaded.env,s0=loaded.signer;
  if(s0.identityType==="email-link"){if(s0.emailLinkStatus!=="opened")throw new HttpError(401,genericEmailSigningFailure());}
  else assertSignerAuthentication(s0,user);
  if(!await verifyChain(e0.events))throw new HttpError(409,"Signing audit chain failed verification.");
  if(s0.status==="Signed")return{ok:true,idempotent:true,status:e0.status,completed:e0.status==="Completed"};
  active(ctx,e0);
  if(!can(e0,s0))throw new HttpError(409,"It is not yet your turn to sign.");
  const checkedFieldValues=validateFieldValues(e0.fields,s0,fieldValues,sig,fieldApplications);
  const declared={name:cleanText(declarations?.name||"",160),title:cleanText(declarations?.title||"",160)};
  if(!declared.name)throw new HttpError(400,"Enter your full name before signing.");
  const ownerDeclared=s0.declaredParticulars||{};
  const discrepancyFields=["name","title"].filter(key=>String(ownerDeclared[key]||"").trim()!==""&&String(ownerDeclared[key]||"").trim().toLowerCase()!==String(declared[key]||"").trim().toLowerCase());
  await original(ctx,e0);
  const out=await mutate(ctx,e0.id,async cur=>{
    const s=cur.signers.find(x=>x.id===s0.id);
    if(s.status==="Signed")return{patch:null,result:{idempotent:true,status:cur.status}};
    if(!can(cur,s))throw new HttpError(409,"It is not yet your turn to sign.");
    const at=ctx.now().toISOString();
    const signedFieldValues={...checkedFieldValues};
    for(const field of cur.fields||[]){
      const assignedToSigner=field.signerId===s.id||(!field.signerId&&s.uid&&field.signerUid===s.uid);
      if(assignedToSigner&&field.type==="Date")signedFieldValues[field.fieldId]=at;
    }
    s.status="Signed";s.signedAt=at;s.signatureType=sig.type;s.signatureValue=sig.value;s.fieldValues=signedFieldValues;
    s.signerDeclarations=declared;
    s.declarationDiscrepancy={detected:discrepancyFields.length>0,fields:discrepancyFields,ownerDeclared:{...ownerDeclared},signerDeclared:{...declared},detectedAt:at};
    s.authorityVerification=null;s.ip=ip||null;s.userAgent=cleanText(userAgent||"",200)||null;
    const currentPosition=Number(s.routingPosition??s.order??1),positionComplete=cur.signers.filter(x=>Number(x.routingPosition??x.order??1)===currentPosition).every(x=>x.status==="Signed"),last=cur.signers.every(x=>x.status==="Signed");
    return{patch:{signers:cur.signers,status:last?"Completing":"InProgress",events:await chainEvents(cur.events,{type:"signer.signed",signerId:s.id,routingPosition:currentPosition,at,ip:ip||null,signatureType:sig.type,signatureHash:await sha256Hex(sig.value),identityType:s.identityType,signerDeclarations:declared,declarationDiscrepancy:s.declarationDiscrepancy})},result:{idempotent:false,winner:last,positionComplete,nextPosition:positionComplete?Math.min(...cur.signers.filter(x=>x.status!=="Signed"&&Number(x.routingPosition??x.order??1)>currentPosition).map(x=>Number(x.routingPosition??x.order??1)),Infinity):null,status:last?"Completing":"InProgress"}};
  });
  if(out.idempotent)return{ok:true,idempotent:true,status:out.status,completed:out.status==="Completed"};
  if(!out.winner){if(out.positionComplete&&Number.isFinite(out.nextPosition))await releaseRoutingPosition(ctx,e0.id,out.nextPosition);return{ok:true,status:"InProgress",completed:false};}
  const done=await finalizeEnvelope(ctx,e0.id);
  return done.completed?{ok:true,status:"Completed",completed:true}:{ok:true,status:"CompletionFailed",completed:false};
}
export async function declineSigning(ctx,{token,reason,ip,user}){
  const{env,signer}=await load(ctx,token);
  active(ctx,env);assertSignerAuthentication(signer,user);
  await mutate(ctx,env.id,async cur=>{
    const s=cur.signers.find(x=>x.id===signer.id);
    if(s.status!=="Pending")throw new HttpError(409,"This envelope can no longer be declined.");
    const at=ctx.now().toISOString(),emailLink=s.identityType==="email-link";
    s.status="Declined";
    if(emailLink){s.emailLinkTokenHistory=[...(s.emailLinkTokenHistory||[]),{tokenHash:s.tokenHash,status:"revoked_by_signer",revokedAt:at}].slice(-10);s.emailLinkStatus="revoked";}
    return{patch:{signers:cur.signers,status:"Declined",events:await chainEvents(cur.events,{type:"signer.declined",signerId:s.id,routingPosition:s.routingPosition||s.order,at,ip:ip||null,reason:cleanText(reason||"",300),identityType:s.identityType||"email-link"})}};
  });
  if(env.ownerEmail&&typeof ctx.sendWorkflowNotice==="function"){
    try{await ctx.sendWorkflowNotice({to:env.ownerEmail,name:env.ownerName||"Document owner",title:env.title,notice:(signer.name||"A signer")+" declined the signing request. Reason: "+cleanText(reason||"No reason supplied",300)+". The routing chain has stopped."});}
    catch(error){ctx.logger?.error?.("SIGNATURE_DECLINE_NOTICE_FAILED",{envelopeId:env.id,signerId:signer.id,errorType:String(error?.name||"Error")});}
  }
  return{ok:true,status:"Declined",revoked:signer.identityType==="email-link"};
}
export async function finalizeEnvelope(ctx,id){const e=await ctx.meta.get("envelopes",id);if(!e)throw new HttpError(404,"Envelope not found.");if(e.status==="Completed"){let distribution=null;try{distribution=await distributeCompletedSignatureDocument(ctx,e,e.completion)}catch(error){ctx.logger?.error?.("SIGNATURE_DISTRIBUTION_RECONCILIATION_FAILED",{envelopeId:id,errorType:String(error?.name||"Error")})}return{ok:true,completed:true,completion:e.completion,distribution}}if(!["Completing","CompletionFailed"].includes(e.status))return{ok:false,completed:false};await ctx.meta.update("envelopes",id,{status:"Finalizing"},{ifVersion:e._v});const cur=await ctx.meta.get("envelopes",id),stored=[];try{const{bytes:orig}=await original(ctx,cur),completedAt=ctx.now().toISOString(),finalBytes=await buildSignedPdf(orig,{envelopeId:cur.id,documentId:cur.documentId,title:cur.title,originalHash:cur.documentHash,chainHead:cur.events.at(-1).hash,events:cur.events,completedAt,signers:cur.signers.map(s=>({id:s.id,uid:s.uid,name:s.name,title:s.title||"",email:s.email,routingPosition:Number(s.routingPosition??s.order??1),order:s.order,invitedAt:s.invitedAt||null,openedAt:s.openedAt||s.emailLinkOpenedAt||null,emailVerifiedAt:s.emailVerifiedAt||null,signedAt:s.signedAt,ip:s.ip,signatureType:s.signatureType,signatureValue:s.signatureValue,fieldValues:s.fieldValues||{},signerDeclarations:s.signerDeclarations||{},declarationDiscrepancy:s.declarationDiscrepancy||null})),fields:cur.fields||[]}),finalHash=await sha256Hex(finalBytes),fileName=`${cleanSegment(cur.fileName.replace(/\.pdf$/i,""),80)}-signed-${finalHash.slice(0,12)}.pdf`;for(const k of cur.archiveTargets){const path=archivePath({archiveKey:k,classification:cur.classification,documentId:cur.documentId,fileName});const r=await ctx.storage.put({path,bytes:finalBytes,contentType:"application/pdf",metadata:{envelopeId:cur.id,documentId:cur.documentId,finalHash,state:"Final Completed Document",archive:k}});stored.push({kind:"archive",archiveKey:k,id:r.id,path})}for(const c of[{kind:"owner-copy",ownerKey:cur.createdBy,recipientUid:cur.createdBy,recipientEmailHash:cur.ownerEmail?await sha256Hex(cur.ownerEmail):null},...cur.signers.map(s=>({kind:"signer-copy",ownerKey:s.profileUid||s.uid||`${cur.id}-${s.id}`,signerId:s.id,recipientUid:s.profileUid||s.uid||null,recipientEmailHash:s.emailHash||null}))]){const path=signerCopyPath({ownerKey:c.ownerKey,fileName});const r=await ctx.storage.put({path,bytes:finalBytes,contentType:"application/pdf",metadata:{envelopeId:cur.id,documentId:cur.documentId,recipientUid:c.recipientUid||"",recipientSignerId:c.signerId||"",recipientEmailHash:c.recipientEmailHash||"",copyKind:c.kind,finalHash,state:"Final Completed Document",archive:"my-documents"}});stored.push({kind:c.kind,signerId:c.signerId,recipientUid:c.recipientUid||null,id:r.id,path})}const cryptoRequired=["staging","production"].includes(ctx.env?.IRPA_ENVIRONMENT)||(ctx.env?.DRIVE_MOCK==="false"&&ctx.allowReturnTokens!==true);if(cryptoRequired&&!ctx.crypto?.keyProvider)throw new Error("Cryptographic signer key custody is not configured.");const cryptoResult=ctx.crypto?.keyProvider?await sealAndPersist({meta:ctx.meta,storage:ctx.storage,keyProvider:ctx.crypto.keyProvider,envelope:{...cur,chainHead:cur.events.at(-1).hash},document:{id:cur.documentId,bytes:finalBytes}}):null;if(cryptoRequired&&(!cryptoResult?.sealed||cryptoResult.documentHash!==finalHash||cryptoResult.evidenceIds?.length!==cur.signers.length))throw new Error("Cryptographic evidence does not bind every authenticated signer to the exact completed PDF.");const cryptoEvents=cryptoResult ? cryptoResult.auditEvents : [];const cryptographicEvidenceIds=cryptoResult ? cryptoResult.evidenceIds : [];let events=cur.events;for(const event of cryptoEvents)events=await chainEvents(events,event);const lastSigner=[...cur.signers].sort((a,b)=>Date.parse(b.signedAt||0)-Date.parse(a.signedAt||0))[0];const completion={finalHash,fileName,completedAt,lastSignedByUid:lastSigner?.uid||null,primaryStorageId:stored[0].id,files:stored,cryptographicEvidenceIds,signerEvidence:(cryptoResult?.evidence||[]).map(e=>({signerId:e.signerId,evidenceId:e.evidenceId,identityType:e.signerIdentityType||"firebase-uid"}))};await ctx.meta.update("envelopes",id,{status:"Completed",completion,events:await chainEvents(events,{type:"envelope.completed",at:completedAt,finalHash,fileCount:stored.length,cryptographicEvidenceCount:cryptographicEvidenceIds.length})},{ifVersion:cur._v});if(cur.externalReference&&typeof ctx.persistCompletedSignatureEnvelope==="function"){await persistMirrorWithStatus(ctx,{...cur,status:"Completed",completion,events},completion)}let distribution=null;try{distribution=await distributeCompletedSignatureDocument(ctx,{...cur,status:"Completed"},completion,{bytes:finalBytes})}catch(error){ctx.logger?.error?.("SIGNATURE_DISTRIBUTION_RECONCILIATION_FAILED",{envelopeId:id,errorType:String(error?.name||"Error")})}return{ok:true,completed:true,completion,distribution}}catch(err){try{await rollbackCryptographicEvidence(ctx.meta,id)}catch{}for(const f of stored){try{await ctx.storage.delete(f.id)}catch{}}await ctx.meta.update("envelopes",id,{status:"CompletionFailed"},{ifVersion:(await ctx.meta.get("envelopes",id))._v});return{ok:false,completed:false,error:"COMPLETION_FAILED"}}}
const owner=(e,u)=>e.createdBy===u.uid||u.isAdmin===true;
export async function retryCompletion(ctx,user,id){const e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");return finalizeEnvelope(ctx,id)}
export async function retryCompletedDocumentDistribution(ctx,user,id){return retryFailedSignatureDistributions(ctx,user,id)}
export async function voidEnvelope(ctx,user,id,reason){
  const e=await ctx.meta.get("envelopes",id);
  if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");
  if(e.status==="Completed")throw new HttpError(409,"A completed envelope cannot be voided.");
  const cleanReason=cleanText(reason||"",300);
  if(!cleanReason)throw new HttpError(400,"Provide a reason for voiding this envelope.");
  await mutate(ctx,id,async c=>{
    if(c.status==="Completed")throw new HttpError(409,"A completed envelope cannot be voided.");
    for(const signer of c.signers||[])if(signer.identityType==="email-link"&&signer.emailLinkStatus!=="used"){
      signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"revoked",revokedAt:ctx.now().toISOString()}].slice(-10);
      signer.emailLinkStatus="revoked";
    }
    return{patch:{status:"Voided",signers:c.signers,events:await chainEvents(c.events,{type:"envelope.voided",at:ctx.now().toISOString(),actor:user.uid,reason:cleanReason})}};
  });
  if(typeof ctx.sendWorkflowNotice==="function"){
    for(const signer of e.signers||[]){
      try{await ctx.sendWorkflowNotice({to:signer.email,name:signer.name,title:e.title,notice:"The document owner has voided this signing request. No further action is required. Reason: "+cleanReason});}
      catch(error){ctx.logger?.error?.("SIGNATURE_VOID_NOTICE_FAILED",{envelopeId:id,signerId:signer.id,errorType:String(error?.name||"Error")});}
    }
  }
  return{ok:true,status:"Voided"};
}

export async function resendInvitation(ctx,user,id,signerId,mailMetadata={}){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||!owner(envelope,user))throw new HttpError(403,"Not authorized.");
  if(["Completed","Voided","Declined"].includes(envelope.status))throw new HttpError(409,"This signing envelope is no longer active.");
  const target=envelope.signers.find(s=>s.id===signerId);
  if(!target)throw new HttpError(404,"Signer assignment not found.");
  if(target.status==="Signed")throw new HttpError(409,"A signed assignment cannot receive another signing invitation.");
  if(!can(envelope,target))throw new HttpError(409,"This signer is waiting for the previous routing position to complete.");
  const emailLink=target.identityType==="email-link";
  const secret=randomHex(32),now=ctx.now(),expiresAt=new Date(now.getTime()+(ctx.config?.emailLinkTtlDays||7)*86400000).toISOString();
  await mutate(ctx,id,async current=>{
    const signer=current.signers.find(s=>s.id===signerId);
    if(!signer||signer.status==="Signed")throw new HttpError(409,"This signer assignment can no longer be invited.");
    if(signer.identityType==="email-link"){
      signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"revoked",revokedAt:now.toISOString()}].slice(-10);
      signer.emailLinkStatus="issued";signer.emailLinkExpiresAt=expiresAt;signer.emailLinkAttemptCount=0;signer.emailLinkOpenCount=0;signer.emailLinkIpAttempts={};signer.emailLinkLastIpHash=null;signer.emailLinkOpenedAt=null;
      
    }
    signer.tokenHash=await sha256Hex(secret);signer.invitation="Pending";signer.invitedAt=now.toISOString();
    return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:mailMetadata?.eventType||(emailLink?"email_link.resent":"invitation.resend.requested"),signerId,actor:user.uid,at:now.toISOString()})}};
  });
  const token=`${id}.${signerId}.${secret}`;
  const link=emailLink?`${ctx.config.appUrl}/?emailSignToken=${encodeURIComponent(token)}`:`${ctx.config.appUrl}/sign?gatewayToken=${encodeURIComponent(token)}&signEnvelope=${encodeURIComponent(envelope.externalReference||"")}`;
  try{if(typeof ctx.sendInvitation==="function")await ctx.sendInvitation({to:target.email,name:target.name,link,emailLink:true,title:envelope.title,ownerName:envelope.ownerName||user.email||"IRPA Document Owner",expiresAt,role:target.title||target.declaredParticulars?.title||"",action:signingActionForFields((envelope.fields||[]).filter(field=>field.signerId===target.id)),fieldCount:(envelope.fields||[]).filter(field=>field.signerId===target.id).length});}
  catch(error){
    await mutate(ctx,id,async current=>{const signer=current.signers.find(s=>s.id===signerId);if(signer){signer.invitation="Failed";if(emailLink)signer.emailLinkStatus="revoked";}return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:"invitation.resend.failed",signerId,actor:user.uid,at:ctx.now().toISOString()})}};});
    throw new HttpError(502,"The signing invitation could not be delivered. Check the SMTP provider status and retry.");
  }
  await mutate(ctx,id,async current=>{const signer=current.signers.find(s=>s.id===signerId);if(signer)signer.invitation="Sent";return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:mailMetadata?.eventType==="email_link.reminded"?"email_link.reminder_sent":typeof ctx.sendInvitation==="function"?"invitation.resent":"email_link.delivery_simulated",signerId,actor:user.uid,at:ctx.now().toISOString()})}};});
  return{ok:true,envelopeId:id,signerId,deliveryStatus:"Sent"};
}

export async function changeSignerEmail(ctx,user,id,signerId,{email,name,title}={}){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||!owner(envelope,user))throw new HttpError(403,"Not authorized.");
  const target=envelope.signers.find(s=>s.id===signerId);
  if(!target||target.status!=="Pending"||target.emailLinkOpenedAt||target.emailLinkStatus==="opened")throw new HttpError(409,"A signer email can only be changed before the invitation is opened.");
  const nextEmail=validateEmail(email).trim().toLowerCase();
  if(envelope.signers.some(s=>s.id!==signerId&&String(s.email||"").trim().toLowerCase()===nextEmail))throw new HttpError(409,"That email address is already assigned to this envelope.");
  await mutate(ctx,id,async current=>{
    const signer=current.signers.find(s=>s.id===signerId);
    if(!signer||signer.status!=="Pending"||signer.emailLinkOpenedAt||signer.emailLinkStatus==="opened")throw new HttpError(409,"A signer email can only be changed before the invitation is opened.");
    const at=ctx.now().toISOString();
    signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"revoked_email_changed",revokedAt:at}].slice(-10);
    const previousEmailHash=signer.emailHash;
    signer.email=nextEmail;signer.emailHash=await sha256Hex(nextEmail);signer.emailLinkStatus="revoked";signer.invitation="Revoked";
    if(name!==undefined)signer.name=validateName(name);
    if(title!==undefined){signer.title=cleanText(title,120);signer.declaredParticulars={...(signer.declaredParticulars||{}),title:signer.title};}
    return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:"signer.email_changed",signerId,actor:user.uid,previousEmailHash,nextEmailHash:signer.emailHash,at})}};
  });
  const result=await resendInvitation(ctx,user,id,signerId,{eventType:"email_link.reissued_after_email_change"});
  return{...result,emailChanged:true};
}

export async function remindInvitation(ctx,user,id,signerId){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||!owner(envelope,user))throw new HttpError(403,"Not authorized.");
  const signer=envelope.signers.find(s=>s.id===signerId);
  if(!signer||signer.status!=="Pending"||signer.invitation!=="Sent")throw new HttpError(409,"Only an invited, unsigned signer can receive a reminder.");
  const now=ctx.now(),last=Date.parse(String(signer.lastReminderAt||""));
  if(Number.isFinite(last)&&now.getTime()-last<60*60*1000)throw new HttpError(429,"A reminder was already sent to this signer within the last hour.");
  await mutate(ctx,id,async current=>{
    const target=current.signers.find(s=>s.id===signerId);
    const prior=Date.parse(String(target?.lastReminderAt||""));
    if(!target||target.status!=="Pending"||(Number.isFinite(prior)&&now.getTime()-prior<60*60*1000))throw new HttpError(429,"A reminder was already sent to this signer within the last hour.");
    target.lastReminderAt=now.toISOString();
    return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:"email_link.reminder_requested",signerId,actor:user.uid,at:now.toISOString()})}};
  });
  return resendInvitation(ctx,user,id,signerId,{eventType:"email_link.reminded"});
}

export async function revokeInvitation(ctx,user,id,signerId){
  await mutate(ctx,id,async current=>{
    if(!owner(current,user))throw new HttpError(403,"Not authorized.");
    if(current.status==="Completed")throw new HttpError(409,"A completed envelope cannot be changed.");
    const signer=current.signers.find(item=>item.id===signerId);
    if(!signer||signer.identityType!=="email-link")throw new HttpError(404,"Signer assignment not found.");
    if(signer.emailLinkStatus==="used")throw new HttpError(409,"A used signing link cannot be revoked.");
    signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"revoked",revokedAt:ctx.now().toISOString()}].slice(-10);
    signer.emailLinkStatus="revoked";signer.invitation="Revoked";
    return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:"email_link.revoked",signerId,actor:user.uid,at:ctx.now().toISOString()})}};
  });
  return{ok:true,envelopeId:id,signerId,status:"revoked"};
}


export async function getEnvelopeStatus(ctx,user,id){let e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");if(e.status==="Completed"&&e.externalReference&&e.mirrorStatus==="Pending"&&typeof ctx.persistCompletedSignatureEnvelope==="function"){await persistMirrorWithStatus(ctx,e,e.completion);e=await ctx.meta.get("envelopes",id)||e}return{ok:true,envelopeId:id,documentId:e.documentId,status:e.status,mirrorStatus:e.mirrorStatus||null,mirrorError:e.mirrorError||null,mirrorAttempts:Number(e.mirrorAttempts||0),signers:e.signers.map(s=>({id:s.id,name:s.name,email:s.email,order:s.order,status:s.status,signedAt:s.signedAt||null,invitation:s.invitation,identityType:s.identityType||"account",emailLinkStatus:s.emailLinkStatus||null,emailLinkExpiresAt:s.emailLinkExpiresAt||null,routingPosition:Number(s.routingPosition??s.order??1),invitedAt:s.invitedAt||null,openedAt:s.emailLinkOpenedAt||null,signedAt:s.signedAt||null})),completion:e.completion?{finalHash:e.completion.finalHash,completedAt:e.completion.completedAt,files:e.completion.files}:null,eventCount:e.events.length,auditChainValid:await verifyChain(e.events),distribution:await getSignatureDistributionSummary(ctx,id)}}
export async function resyncMirror(ctx,user,id){const e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");if(e.status!=="Completed"||!e.externalReference||!e.completion)throw new HttpError(409,"Only completed linked envelopes can be resynchronized.");if(typeof ctx.persistCompletedSignatureEnvelope!=="function")throw new HttpError(503,"Signature mirror persistence is not configured.");await persistMirrorWithStatus(ctx,e,e.completion);const updated=await ctx.meta.get("envelopes",id);return{ok:true,envelopeId:id,status:updated?.status||"Completed",mirrorStatus:updated?.mirrorStatus||"Pending",mirrorError:updated?.mirrorError||null,mirrorAttempts:Number(updated?.mirrorAttempts||0)}}
export async function persistMirrorWithStatus(ctx,envelope,completion){const id=envelope.id;const now=ctx.now();const nextAt=Number(new Date(envelope.mirrorNextRetryAt||0));if(envelope.mirrorStatus==="Pending"&&Number.isFinite(nextAt)&&nextAt>now.getTime())return false;const attempts=Number(envelope.mirrorAttempts||0)+1;try{await ctx.persistCompletedSignatureEnvelope({envelope,completion});await ctx.meta.update("envelopes",id,{mirrorStatus:"Completed",mirrorError:null,mirrorAttempts:attempts,mirrorNextRetryAt:null,mirrorUpdatedAt:now.toISOString()});return true}catch(error){const message=String(error?.message||error).slice(0,300);const delayMs=Math.min(60*60*1000,30*1000*Math.pow(2,Math.min(attempts-1,7)));try{const latest=await ctx.meta.get("envelopes",id);if(latest)await ctx.meta.update("envelopes",id,{mirrorStatus:"Pending",mirrorError:message,mirrorAttempts:attempts,mirrorNextRetryAt:new Date(now.getTime()+delayMs).toISOString(),mirrorUpdatedAt:now.toISOString()},{ifVersion:latest._v})}catch(statusError){ctx.logger?.error?.("SIGNATURE_MIRROR_STATUS_PERSIST_FAILED",{envelopeId:id,message:String(statusError?.message||statusError).slice(0,200)})}ctx.logger?.error?.("SIGNATURE_PORTAL_COMPLETION_PERSIST_FAILED",{envelopeId:envelope.externalReference,gatewayEnvelopeId:id,message,attempts});return false}}
export async function getSigningStatus(ctx,token,user=null){const{env,signer}=await load(ctx,token);const privileged=Boolean(user?.uid)&&(user.uid===env.createdBy||user.isAdmin===true);if(!privileged)assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");const completion=env.completion?{finalHash:env.completion.finalHash,completedAt:env.completion.completedAt,primaryStorageId:env.completion.primaryStorageId,fileName:env.completion.fileName,signedFileReference:env.completion.primaryStorageId,files:(env.completion.files||[]).filter(file=>file?.kind==="archive"||(file?.kind==="signer-copy"&&file.signerId===signer.id)),cryptographicEvidenceIds:env.completion.cryptographicEvidenceIds||[]}:null;return{ok:true,envelopeId:env.id,externalReference:env.externalReference||null,documentId:env.documentId,status:env.status,signingMode:env.signingMode||"Sequential",signer:{id:signer.id,uid:signer.uid||null,status:signer.status},signers:env.signers.map(s=>({id:s.id,uid:privileged||s.id===signer.id?(s.uid||null):null,name:s.name,order:s.order,status:s.status,signedAt:s.signedAt||null})),completion,eventCount:env.events.length,auditChainValid:await verifyChain(env.events)}}
export async function verifySigningPdf(ctx,token,user,bytes){const{env,signer}=await load(ctx,token);assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");if(env.status!=="Completed"||!env.completion?.finalHash)throw new HttpError(409,"The signing envelope is not completed.");if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>12*1024*1024)throw new HttpError(413,"A completed PDF of at most 12 MB is required.");const actualHash=await sha256Hex(bytes);if(actualHash!==env.completion.finalHash)throw new HttpError(409,"The provided PDF does not match the completed envelope hash.");return{ok:true,verified:true,envelopeId:env.id,externalReference:env.externalReference||null,documentHash:actualHash,cryptographicEvidenceIds:env.completion.cryptographicEvidenceIds||[]}}
export async function getSigningEvidence(ctx,token,user=null){const{env,signer}=await load(ctx,token);assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");if(env.status!=="Completed"||!env.completion?.finalHash)throw new HttpError(409,"Cryptographic evidence is available only after successful completion.");const rows=await ctx.meta.list("cryptographicEvidence"),matches=(rows||[]).filter(e=>e?.envelopeId===env.id&&(signer.uid?e?.signerUid===signer.uid:(e?.signerId===signer.id&&e?.signerIdentityType==="email-link"&&e?.signerIdentityHash===signer.emailHash)));if(!matches.length)throw new HttpError(404,"Cryptographic signing evidence is not available for this signer.");const verified=[];for(const evidence of matches){let valid=false;try{const publicKey=await importPublicKeyJwk(evidence.publicKeyJwk);valid=await verifyCryptographicEvidence(evidence,{documentHash:env.completion.finalHash,signerUid:signer.uid||null,signerIdentityType:signer.identityType,signerIdentityHash:signer.emailHash||null,publicKey})}catch{}if(!valid)throw new HttpError(409,"Persisted cryptographic evidence failed verification.");verified.push(evidence)}return{ok:true,envelopeId:env.id,externalReference:env.externalReference||null,documentHash:env.completion.finalHash,evidence:verified,auditChainValid:await verifyChain(env.events)}}
