import {sealAndPersist,rollbackCryptographicEvidence,importPublicKeyJwk,verifyCryptographicEvidence} from "./cryptographicGate.mjs";import {Conflict,VersionConflict} from "./adapters.mjs";import {archivePath,parseArchiveSelection,signerCopyPath} from "./archives.mjs";import {buildSignedPdf,validateSignatureInput} from "./pdf.mjs";import {HttpError,ID_RE,canonicalJson,cleanSegment,cleanText,randomHex,safeEqual,sha256Hex,validateEmail,validateName} from "./util.mjs";
import {createEmailSigningToken,markEmailSigningTokenOpened,genericEmailSigningFailure} from "./emailSigningLinks.mjs";
import {distributeCompletedSignatureDocument,getSignatureDistributionSummary,retryFailedSignatureDistributions} from "./signatureDistribution.mjs";
import {SIGNATURE_FIELD_COORDINATE_SPACE,normalizeSignatureField} from "../../src/utils/signatureFieldCoordinates.mjs";
export async function chainEvents(events,e){const body={...e,prevHash:events.length?events.at(-1).hash:"GENESIS"};return[...events,{...body,hash:await sha256Hex(canonicalJson(body))}]}
export async function verifyChain(events){if(!Array.isArray(events))return false;let p="GENESIS";for(const e of events){const {hash,...b}=e;if(b.prevHash!==p||await sha256Hex(canonicalJson(b))!==hash)return false;p=hash}return true}
async function mutate(ctx,id,fn){for(let i=0;i<5;i++){const c=await ctx.meta.get("envelopes",id);if(!c)throw new HttpError(404,"Envelope not found.");if(!await verifyChain(c.events))throw new HttpError(409,"Signing audit chain failed verification.");const {patch,result}=await fn(c);if(!patch)return result;try{await ctx.meta.update("envelopes",id,patch,{ifVersion:c._v});return result}catch(e){if(!(e instanceof VersionConflict))throw e}}throw new HttpError(409,"Please retry.")}
const EMAIL_STAGE_SET=new Set(["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT","TOKEN_LOOKUP","SESSION_CREATE"]);
export async function recordEmailLinkStage(ctx,envelopeId,signerId,stage,outcome,smtpReplyCategory="UNKNOWN"){
  if(!EMAIL_STAGE_SET.has(stage)||!["success","failure"].includes(outcome))return;
  const category=["RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"].includes(smtpReplyCategory)?smtpReplyCategory:"UNKNOWN";
  try{
    await mutate(ctx,envelopeId,async current=>{
      if(!(current.signers||[]).some(signer=>signer.id===signerId))return{patch:null};
      return{patch:{events:await chainEvents(current.events,{type:"email_link.stage",stage,outcome,smtpReplyCategory:category,signerId,at:ctx.now().toISOString()})}};
    });
  }catch(error){
    ctx.logger?.error?.("EMAIL_LINK_STAGE_AUDIT_FAILED",{stage,outcome,smtpReplyCategory:category,errorType:String(error?.name||"Error").slice(0,40)});
  }
}
function invitationFailureDiagnostics(error){
  const message=String(error?.message||"");
  const smtp=message.match(/IRPA SMTP error (\d{3})/i);
  const smtpResponseCode=smtp?Number(smtp[1]):null;
  const errorCode=String(error?.code||"").replace(/[^A-Z0-9_-]/gi,"").slice(0,40)||null;
  const failureClass=smtpResponseCode!==null?(smtpResponseCode>=500?"permanent-provider-rejection":smtpResponseCode>=400?"temporary-provider-rejection":"provider-response"):error?.deliveryOutcome==="unknown"?"delivery-outcome-unknown":errorCode||/password.*not configured/i.test(message)?"smtp-configuration-or-transport":"smtp-transport-error";
  return{errorType:String(error?.name||"Error").slice(0,60),errorCode,smtpResponseCode,failureClass,deliveryOutcome:error?.deliveryOutcome==="unknown"?"unknown":"not-confirmed",retryable:error?.retryable===false?false:(smtpResponseCode!==null?smtpResponseCode>=400&&smtpResponseCode<500:true)};
}
function tokenParts(t){const p=String(t||"").split(".");if(p.length!==3||!ID_RE.test(p[0])||!/^S\d+$/.test(p[1])||!/^[0-9a-f]{64}$/.test(p[2]))throw new HttpError(401,"Invalid signing link.");return p}
async function load(ctx,t){const[eid,sid,secret]=tokenParts(t),e=await ctx.meta.get("envelopes",eid),s=e?.signers.find(x=>x.id===sid);if(!e||!s)throw new HttpError(401,"Invalid signing link.");const suppliedHash=await sha256Hex(secret);if(!safeEqual(suppliedHash,s.tokenHash)){const replaced=[...(s.tokenHistory||[]),...(s.emailLinkTokenHistory||[])].some(item=>item?.status==="replaced"&&safeEqual(suppliedHash,String(item.tokenHash||"")));if(replaced)throw new HttpError(410,"This link was replaced. Please use the newest email.");throw new HttpError(403,"This signing link is not valid.");}const expiry=s.tokenExpiresAt||s.emailLinkExpiresAt||e.expiresAt;const expiryMs=Date.parse(String(expiry||""));if(Number.isFinite(expiryMs)&&ctx.now().getTime()>expiryMs)throw new HttpError(410,"This signing link has expired. Contact the document owner for a new invitation.");if(s.identityType==="email-link"&&(!["issued","opened"].includes(s.emailLinkStatus)))throw new HttpError(401,genericEmailSigningFailure());return{env:e,signer:s}}
function active(ctx,e,s=null){if(["Voided","Declined","Cancelled","Canceled"].includes(e.status))throw new HttpError(403,"This envelope is no longer active.");const expiry=s?.tokenExpiresAt||s?.emailLinkExpiresAt||e.expiresAt;if(expiry&&ctx.now().getTime()>new Date(expiry).getTime())throw new HttpError(403,"This signing link has expired.")}
const can=(e,s)=>s.status==="Pending"&&e.signers.every(x=>x.order>=s.order||x.status==="Signed");
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
  const allowed=new Set(["Signature","Initials","Date","Number","Text","Comment","Remarks","Checkbox","Name","Title"]);
  return fields.map(f=>{
    const fieldId=cleanSegment(f?.fieldId,100),type=String(f?.type||"");
    const normalized=normalizeSignatureField({page:f?.page||1,x:f?.x??10,y:f?.y??80,width:f?.width??24,height:f?.height??9,coordinateSpace:f?.coordinateSpace,fieldId}),page=Number(normalized.page),x=Number(normalized.x),y=Number(normalized.y),width=Number(normalized.width),height=Number(normalized.height),requestedSignerId=String(f?.signerId||""),signerUid=String(f?.signerUid||""),roleAssignmentIndex=f?.roleAssignmentIndex==null?0:Number(f.roleAssignmentIndex);
    const assigned=requestedSignerId?byId.get(requestedSignerId):(signerUid?(signers||[]).find(item=>item.uid===signerUid):null);
    if(!fieldId||ids.has(fieldId)||!allowed.has(type)||!assigned||!Number.isInteger(roleAssignmentIndex)||roleAssignmentIndex<0||roleAssignmentIndex>=Math.max(1,Array.isArray(assigned.roleAssignments)?assigned.roleAssignments.length:1)||(signerUid&&assigned.uid!==signerUid)||!Number.isInteger(page)||page<1||page>500||![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>1||y+height>1)throw new HttpError(400,"A signing field is invalid or assigned to an unauthorized signer.");
    ids.add(fieldId);
    return{fieldId,type,page,x,y,width,height,coordinateSpace:SIGNATURE_FIELD_COORDINATE_SPACE,signerId:assigned.id,signerUid:assigned.uid||null,roleAssignmentIndex,required:f?.required===true,placeholder:cleanText(f?.placeholder||"",160)};
  });
}
export function validateFieldValues(fields,signer,values,signature,fieldApplications=[]){
  const assigned=(fields||[]).map(field=>normalizeSignatureField(field)).filter(f=>f.signerId===signer.id||(!f.signerId&&signer.uid&&f.signerUid===signer.uid)),out={},byId=new Map(assigned.map(f=>[f.fieldId,f])),applications=new Map();
  if(!Array.isArray(fieldApplications))throw new HttpError(400,"Explicit confirmed signature field applications are required.");
  for(const application of fieldApplications){
    const field=byId.get(String(application?.fieldId||""));
    if(!field||!["Signature","Initials"].includes(field.type))throw new HttpError(403,"A signature field application is not assigned to this signer.");
    if(applications.has(field.fieldId))throw new HttpError(400,"A signature field may be confirmed only once per submission.");
    if(application.confirmed!==true)throw new HttpError(400,"Signature application requires an explicit Confirm action.");
    if(application.coordinateSpace!=null&&application.coordinateSpace!==SIGNATURE_FIELD_COORDINATE_SPACE)throw new HttpError(409,"The confirmed signature field coordinate space is not supported.");
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
export async function resolveOptionalEmailLinkProfileUid(resolveProfileUid,email,signerName,timeoutMs=3000){
  if(typeof resolveProfileUid!=="function")return null;
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(()=>resolveProfileUid(email,signerName)).then(value=>value||null),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.max(1,Math.min(3000,Number(timeoutMs)||3000)))})
    ]);
  }catch{return null}
  finally{if(timer)clearTimeout(timer)}
}
export async function createEnvelope(ctx,user,body){
  if(!ctx.sendInvitation&&!ctx.allowReturnTokens)throw new HttpError(500,"Invitation transport is not configured.");
  const doc=ID_RE.test(String(body?.documentId||""))&&await ctx.meta.get("documents",body.documentId);
  if(!doc||doc.status!=="Stored"||(doc.ownerUid!==user.uid&&!user.isAdmin))throw new HttpError(403,"You are not authorized for this document.");
  const archives=parseArchiveSelection(body.archives),input=body.signers,signingMode=String(body?.signingMode||"Sequential");
  if(!["Sequential","Parallel"].includes(signingMode))throw new HttpError(400,"Unsupported signing mode.");
  if(!Array.isArray(input)||input.length<1)throw new HttpError(400,"Provide at least one signer.");
  const cryptoRequired=["staging","production"].includes(ctx.env?.IRPA_ENVIRONMENT)||(ctx.env?.DRIVE_MOCK==="false"&&ctx.allowReturnTokens!==true);
  if(cryptoRequired&&input.some(s=>s?.identityType!=="email-link"||s?.uid))throw new HttpError(400,"Every staging and production signer must use a verified email-link identity.");
  // Email-link possession is transaction-scoped mailbox control, not an authority-register lookup.
  const sourceBytes=await ctx.storage.get(doc.primaryStorageId);
  if(!sourceBytes)throw new HttpError(409,"The stored document failed its integrity check.");
  await verifySourceDocumentIntegrity(sourceBytes,{},doc);
  const externalReference=String(body?.externalReference||"").trim();
  if(externalReference&&!ID_RE.test(externalReference))throw new HttpError(400,"Invalid external envelope reference.");
  const id=`ENV-${randomHex(8)}`,seenUids=new Set(),signers=[],secrets=[];
  for(let i=0;i<input.length;i++){
    const s=input[i],email=validateEmail(s?.email).trim().toLowerCase(),uid=s?.uid?cleanSegment(s.uid,128):null;
    // Delivery email may be shared. Signers remain isolated by signerId and token hash.
    if(uid&&seenUids.has(uid))throw new HttpError(400,"Duplicate signer UID.");
    if(uid)seenUids.add(uid);
    const signerId=`S${i+1}`,secret=randomHex(32),emailLink=s?.identityType==="email-link",authority=null;
    const profileUid=emailLink?await resolveOptionalEmailLinkProfileUid(ctx.resolveEmailLinkProfileUid,email,s?.name,3000):null;
    if(!uid&&!emailLink&&!ctx.allowLegacyTestSigners)throw new HttpError(403,"Unregistered email-only signers must use the verified email-link path.");
    const issued=emailLink?await createEmailSigningToken({envelopeId:id,signerId,email,now:ctx.now(),randomBytes:Uint8Array.from(secret.match(/.{2}/g).map(value=>parseInt(value,16)))}):null;
    const finalSecret=issued?.token||secret;secrets.push(finalSecret);
    signers.push({id:signerId,email,emailHash:issued?.record.emailHash||null,profileUid:profileUid||null,name:validateName(s?.name||email),title:cleanText(s?.title||"",160),declaredParticulars:{name:cleanText(s?.name||"",160),title:cleanText(s?.title||"",160),occupation:cleanText(s?.occupation||s?.capacity||"",160),capacity:cleanText(s?.capacity||"",160)},roleAssignments:(Array.isArray(s?.roleAssignments)?s.roleAssignments:[{role:s?.role||"Signer",title:s?.title||"",capacity:s?.capacity||"",occupation:s?.occupation||""}]).slice(0,12).map(item=>({role:cleanText(item?.role||"Signer",120),title:cleanText(item?.title||s?.title||"",160),capacity:cleanText(item?.capacity||"",160),occupation:cleanText(item?.occupation||"",160)})),order:Number.isInteger(s?.order)&&s.order>0?s.order:i+1,uid,status:"Pending",identityType:emailLink?"email-link":uid?"account":"legacy-token",tokenHash:issued?.record.tokenHash||await sha256Hex(secret),invitation:"Pending",...(issued?{emailLinkStatus:"issued",emailLinkAttemptCount:0,emailLinkOpenCount:0,emailLinkIpAttempts:{}}:{})});
  }
  const fields=validateEnvelopeFields(body?.fields,signers);
  const ownerPreSignEmail=String(body?.ownerPreSignEmail||"").trim().toLowerCase();
  const ownerPreSignSignerId=String(body?.ownerPreSignSignerId||"").trim();
  let ownerPreSignSigner=null,ownerPreSignIndex=-1;
  if(ownerPreSignEmail||ownerPreSignSignerId){
    if(!user?.email||String(user.email).trim().toLowerCase()!==ownerPreSignEmail)throw new HttpError(403,"Only the authenticated document owner's own account may request portal-first signing.");
    if(ownerPreSignSignerId){
      ownerPreSignIndex=signers.findIndex(signer=>signer.id===ownerPreSignSignerId);
      ownerPreSignSigner=signers[ownerPreSignIndex]||null;
      if(ownerPreSignSigner&&ownerPreSignSigner.email!==ownerPreSignEmail)throw new HttpError(403,"The portal-first signer identity does not match the authenticated document owner.");
    }else{
      const matches=signers.map((signer,index)=>({signer,index})).filter(item=>item.signer.email===ownerPreSignEmail);
      if(matches.length!==1)throw new HttpError(400,"The owner-first participant is ambiguous because the delivery email is shared. Retry with an identity-bound owner assignment.");
      ownerPreSignSigner=matches[0].signer;ownerPreSignIndex=matches[0].index;
    }
    const firstOrder=Math.min(...signers.map(signer=>signer.order));
    if(!ownerPreSignSigner||ownerPreSignSigner.order!==firstOrder)throw new HttpError(400,"The document owner must be the first signing participant.");
    if(!fields.some(field=>field.signerId===ownerPreSignSigner.id&&field.type==="Signature"&&field.required===true))throw new HttpError(400,"The document owner must have a required Signature field before invitations can be deferred.");
  }
  for(const signer of signers){
    const assignments=Array.isArray(signer.roleAssignments)&&signer.roleAssignments.length?signer.roleAssignments:[{role:"Signer"}];
    for(let roleAssignmentIndex=0;assignments.length>1&&roleAssignmentIndex<assignments.length;roleAssignmentIndex++){
      if(!fields.some(field=>field.signerId===signer.id&&field.roleAssignmentIndex===roleAssignmentIndex&&["Signature","Initials"].includes(field.type)))throw new HttpError(400,"Every signer responsibility must have at least one assigned Signature or Initials field.");
    }
  }
  const sourceHash=doc.sha256||doc.hash||await sha256Hex(sourceBytes),sourceSize=doc.fileSize??doc.byteLength??doc.size??sourceBytes.byteLength;
  const e={id,externalReference:externalReference||null,documentId:doc.id,documentHash:sourceHash,sha256:sourceHash,byteLength:sourceSize,documentSize:sourceSize,title:doc.title,fileName:doc.fileName,classification:doc.classification,ownerName:String(user.name||user.email||"IRPA Document Owner"),ownerEmail:String(user.email||"").trim().toLowerCase(),createdByEmail:String(user.email||"").trim().toLowerCase(),createdBy:user.uid,status:"Sent",signingMode,signers,fields,archiveTargets:archives,createdAt:ctx.now().toISOString(),expiresAt:new Date(ctx.now().getTime()+ctx.config.ttlDays*86400000).toISOString(),events:[],completion:null};
  for(const signer of e.signers){signer.tokenExpiresAt=e.expiresAt;if(signer.identityType==="email-link")signer.emailLinkExpiresAt=e.expiresAt;}
  e.events=await chainEvents([],{type:"envelope.created",at:e.createdAt,actor:user.uid,documentHash:sourceHash,signerCount:signers.length});
  let reservationKey=null;
  if(externalReference){
    reservationKey=await sha256Hex(user.uid+"\\n"+externalReference);
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
  const firstPosition=Math.min(...signers.map(s=>s.order));
  for(let i=0;i<signers.length;i++){
    if(signers[i].order!==firstPosition)continue;
    const token=`${id}.${signers[i].id}.${secrets[i]}`;
    if(ownerPreSignEmail){
      if(signers[i].id===ownerPreSignSigner.id)signers[i].invitation="Portal";
      continue;
    }
    if(ctx.sendInvitation){try{const emailLink=signers[i].identityType==="email-link";const link=emailLink?`${ctx.config.appUrl}/?emailSignToken=${encodeURIComponent(token)}`:`${ctx.config.appUrl}/sign?gatewayToken=${encodeURIComponent(token)}&signEnvelope=${encodeURIComponent(externalReference||"")}`;await ctx.sendInvitation({to:signers[i].email,name:signers[i].name,link,emailLink,title:e.title,ownerName:user.name||user.email||"IRPA Document Owner",envelopeId:id,signerId:signers[i].id,...(emailLink?{onStage:(stage,outcome,category)=>recordEmailLinkStage(ctx,id,signers[i].id,stage,outcome,category)}:{}),expiresAt:e.expiresAt});signers[i].invitation="Sent";}
    catch(err){signers[i].invitation="Failed";signers[i].deliveryStageCode=EMAIL_STAGE_SET.has(err?.stageCode)?err.stageCode:null;ctx.logger?.error?.("ENVELOPE_INVITATION_FAILED",{envelopeId:id,signerId:signers[i].id,...invitationFailureDiagnostics(err),...(signers[i].deliveryStageCode?{stageCode:signers[i].deliveryStageCode}:{})});}}
    else signers[i].invitation="Sent";
  }
  await mutate(ctx,id,async cur=>{
    const at=ctx.now().toISOString();
    const updatedSigners=cur.signers.map((signer,index)=>({...signer,invitation:signers[index]?.invitation||signer.invitation,...(signers[index]?.deliveryStageCode?{deliveryStageCode:signers[index].deliveryStageCode}:{})}));
    let events=cur.events;
    for(let index=0;index<updatedSigners.length;index++){
      const signer=updatedSigners[index];
      if(signer.invitation==="Pending")continue;
      events=await chainEvents(events,{type:signer.invitation==="Portal"?"owner.portal_issued":signer.identityType==="email-link"?"email_link.issued":"invitation.issued",signerId:signer.id,emailHash:signer.emailHash||null,deliveryStatus:signer.invitation,at});
    }
    return{patch:{signers:updatedSigners,events}};
  });
  const returnTokens=ctx.env?.IRPA_ENVIRONMENT==="staging"&&ctx.env?.IRPA_STAGING_CRYPTO_TEST_MODE==="true"?(body?.returnTokens===true&&signers.every(s=>s.uid===user.uid)):ctx.allowReturnTokens;
  return{ok:true,envelopeId:id,status:ownerPreSignEmail?"Awaiting Owner Signature":"Sent",invitations:signers.map(s=>({signerId:s.id,email:s.email,status:s.invitation,...(s.deliveryStageCode?{stageCode:s.deliveryStageCode}:{})})),...(ownerPreSignSigner?{ownerSigningToken:`${id}.${ownerPreSignSigner.id}.${secrets[ownerPreSignIndex]}`}:{}),...(returnTokens?{tokens:secrets.map((s,i)=>signers[i].order===firstPosition?`${id}.S${i+1}.${s}`:null).filter(Boolean)}:{})};
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

export async function openEmailSigning(ctx,token,ip=""){
  const now=ctx.now(),ipHash=await sha256Hex(String(ip||"unknown"));
  let parts=null,tokenLookupSucceeded=false,sessionCreationAttempted=false,sessionCreationSucceeded=false;
  try{
    parts=tokenParts(token);
    const tokenHash=await sha256Hex(parts[2]);
    await consumeEmailLinkRateLimit(ctx,"token:"+tokenHash,8,now);
    await consumeEmailLinkRateLimit(ctx,"ip:"+ipHash,20,now);
    const loaded=await load(ctx,token);
    tokenLookupSucceeded=true;
    await recordEmailLinkStage(ctx,loaded.env.id,loaded.signer.id,"TOKEN_LOOKUP","success");
    if(loaded.signer.identityType!=="email-link"||!["issued","opened"].includes(loaded.signer.emailLinkStatus))throw new HttpError(401,genericEmailSigningFailure());
    active(ctx,loaded.env,loaded.signer);
    let sessionToken=token;
    if(loaded.signer.emailLinkStatus==="issued"){
      sessionCreationAttempted=true;
      const sessionSecret=randomHex(32);
      sessionToken=loaded.env.id+"."+loaded.signer.id+"."+sessionSecret;
      const sessionHash=await sha256Hex(sessionSecret);
      await mutate(ctx,loaded.env.id,async current=>{
        const signer=current.signers.find(item=>item.id===loaded.signer.id);
        if(!signer||signer.identityType!=="email-link"||signer.emailLinkStatus!=="issued")throw new HttpError(401,genericEmailSigningFailure());
        const opened=await markEmailSigningTokenOpened({tokenHash:signer.tokenHash,status:signer.emailLinkStatus,attemptCount:signer.emailLinkAttemptCount,openCount:signer.emailLinkOpenCount,ipAttempts:signer.emailLinkIpAttempts},{token:parts[2],now,ipHash,maxAttempts:8});
        signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"used",usedAt:now.toISOString()}].slice(-10);
        signer.tokenHash=sessionHash;
        signer.emailLinkStatus=opened.status;
        signer.emailLinkOpenCount=opened.openCount;
        signer.emailLinkAttemptCount=opened.attemptCount;
        signer.emailLinkIpAttempts=opened.ipAttempts;
        signer.emailLinkLastIpHash=opened.lastIpHash;
        signer.emailLinkOpenedAt=opened.openedAt;
        let events=await chainEvents(current.events,{type:"email_link.stage",stage:"SESSION_CREATE",outcome:"success",signerId:signer.id,at:now.toISOString()});
        events=await chainEvents(events,{type:"email_link.opened",signerId:signer.id,at:now.toISOString(),ipHash,sessionTokenHash:sessionHash,invitationTokenConsumed:true});
        return {patch:{signers:current.signers,events}};
      });
      sessionCreationSucceeded=true;
    }
    const preview=await openSigning(ctx,sessionToken,null);
    return {ok:true,title:preview.title,ownerName:preview.ownerName,linkExpiresAt:null,envelopeId:preview.envelopeId,signer:preview.signer,fields:preview.fields,canSign:preview.canSign,ownerDeclaredParticulars:preview.ownerDeclaredParticulars,sessionToken};
  }catch(error){
    const stage=tokenLookupSucceeded?(sessionCreationAttempted&&!sessionCreationSucceeded?"SESSION_CREATE":"TOKEN_LOOKUP"):"TOKEN_LOOKUP";
    if(parts?.length===3)await recordEmailLinkStage(ctx,parts[0],parts[1],stage,"failure");
    const failure=new HttpError(401,genericEmailSigningFailure());
    failure.code=stage;
    throw failure;
  }
}

function readEnvelopeFields(ctx,fields){return (fields||[]).map(field=>normalizeSignatureField(field,{warn:(event,details)=>ctx.logger?.warn?.(event,details)}));}
export async function openSigning(ctx,token,user=null){const{env,signer}=await load(ctx,token);active(ctx,env,signer);assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");return{ok:true,envelopeId:env.id,externalReference:env.externalReference||null,documentId:env.documentId,title:env.title,ownerName:env.ownerName||"IRPA Document Owner",linkExpiresAt:signer.identityType==="email-link"?null:env.expiresAt,documentHash:env.documentHash,sha256:env.sha256||env.documentHash,byteLength:env.byteLength??env.documentSize??null,status:env.status,signer:{id:signer.id,identityType:signer.identityType,email:signer.email,name:signer.name,title:signer.title||"",status:signer.status,roleAssignments:signer.roleAssignments||[],emailVerified:signer.identityType==="email-link"&&signer.emailLinkStatus==="opened",authenticated:signer.identityType==="email-link"?signer.emailLinkStatus==="opened":!!signer.uid},signers:env.signers.map(s=>({id:s.id,name:s.name,order:s.order,status:s.status,signedAt:s.signedAt||null})),fields:readEnvelopeFields(ctx,env.fields).filter(f=>f.signerId===signer.id||(!f.signerId&&signer.uid&&f.signerUid===signer.uid)),appliedFields:[],canSign:can(env,signer),ownerDeclaredParticulars:signer.declaredParticulars||{}}}
export async function getSigningPdf(ctx,token,user=null){const{env,signer}=await load(ctx,token);if(signer.identityType==="email-link"&&signer.emailLinkStatus!=="opened")throw new HttpError(401,genericEmailSigningFailure());const isOwner=Boolean(user?.uid)&&user.uid===env.createdBy;if(!isOwner)assertSignerAuthentication(signer,user);if(env.status==="Completed"){if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");const b=await ctx.storage.get(env.completion.primaryStorageId);if(!b||await sha256Hex(b)!==env.completion.finalHash)throw new HttpError(500,"Integrity check failed.");return{bytes:b,fileName:env.completion.fileName,hash:env.completion.finalHash}}if(isOwner)throw new HttpError(409,"The completed signed PDF is not available yet.");active(ctx,env,signer);const x=await original(ctx,env);return{bytes:x.bytes,fileName:env.fileName,hash:env.documentHash}}
async function inviteNextPosition(ctx,id){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||["Completed","Voided","Declined","Completing","Finalizing","CompletionFailed"].includes(envelope.status))return;
  const orders=[...new Set(envelope.signers.filter(s=>s.status!=="Signed").map(s=>s.order))].sort((a,b)=>a-b);
  for(const order of orders){
    if(!envelope.signers.filter(s=>s.order<order).every(s=>s.status==="Signed"))continue;
    const pending=envelope.signers.filter(s=>s.order===order&&s.status==="Pending"&&s.invitation==="Pending");
    if(!pending.length)continue;
    for(const signer of pending){
      try{await resendInvitation(ctx,{uid:envelope.createdBy,isAdmin:false},id,signer.id);}
      catch(error){ctx.logger?.error?.("SIGNING_NEXT_POSITION_INVITATION_FAILED",{envelopeId:id,signerId:signer.id,errorType:String(error?.name||"Error")});}
    }
    return;
  }
}

export async function sign(ctx,{token,signature,fieldValues,fieldApplications=[],signatureConfirmed=false,consent,declarations={},ip,userAgent,user}){
  if(consent!==true)throw new HttpError(400,"Consent to sign electronically is required.");
  if(signatureConfirmed!==true&&Array.isArray(fieldApplications)&&fieldApplications.length>0)throw new HttpError(400,"A signature field cannot be applied without an explicit Confirm action.");
  const sig=signature?.type==="field-applications"&&Array.isArray(fieldApplications)&&fieldApplications.length?await validateSignatureInput({type:"drawn",value:fieldApplications[0]?.value}):await validateSignatureInput(signature),loaded=await load(ctx,token),e0=loaded.env,s0=loaded.signer;
  if(s0.identityType==="email-link"){if(s0.emailLinkStatus!=="opened")throw new HttpError(401,genericEmailSigningFailure());}
  else assertSignerAuthentication(s0,user);
  if(!await verifyChain(e0.events))throw new HttpError(409,"Signing audit chain failed verification.");
  if(s0.status==="Signed")return{ok:true,idempotent:true,status:e0.status,completed:e0.status==="Completed"};
  active(ctx,e0,s0);
  if(!can(e0,s0))throw new HttpError(409,"It is not yet your turn to sign.");
  const checkedFieldValues=validateFieldValues(e0.fields,s0,fieldValues,sig,fieldApplications);
  const declared={name:cleanText(declarations?.name||"",160),occupation:cleanText(declarations?.title||declarations?.occupation||"",160),capacity:cleanText(declarations?.capacity||"",160),title:cleanText(declarations?.title||declarations?.occupation||"",160)};
  const roleAssignmentEvidence= (Array.isArray(s0.roleAssignments)&&s0.roleAssignments.length?s0.roleAssignments:[{role:"Signer",capacity:"",occupation:""}]).map((assignment,roleAssignmentIndex)=>{
    const assignedFields=(e0.fields||[]).filter(field=>field.signerId===s0.id&&Number(field.roleAssignmentIndex||0)===roleAssignmentIndex);
    return {roleAssignmentIndex,role:cleanText(assignment.role||"Signer",120),capacity:cleanText(assignment.capacity||"",160),occupation:cleanText(assignment.occupation||"",160),fieldIds:assignedFields.map(field=>field.fieldId),signatureFieldHashes:[]};
  });
  for(const assignment of roleAssignmentEvidence){
    assignment.signatureFieldHashes=[];
    for(const fieldId of assignment.fieldIds){const field=(e0.fields||[]).find(item=>item.fieldId===fieldId);if(field&&["Signature","Initials"].includes(field.type))assignment.signatureFieldHashes.push({fieldId,type:field.type,hash:await sha256Hex(checkedFieldValues[fieldId])});}
  }
  if(!declared.name)throw new HttpError(400,"Enter your name before signing.");
  const ownerDeclared=s0.declaredParticulars||{};
  const discrepancyFields=["name","occupation","capacity"].filter(key=>String(ownerDeclared[key]||"").trim()!==""&&String(ownerDeclared[key]||"").trim().toLowerCase()!==String(declared[key]||"").trim().toLowerCase());
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
    s.signerDeclarations=declared;s.roleAssignmentEvidence=roleAssignmentEvidence;
    s.declarationDiscrepancy={detected:discrepancyFields.length>0,fields:discrepancyFields,ownerDeclared:{...ownerDeclared},signerDeclared:{...declared},detectedAt:at};
    s.authorityVerification=null;s.ip=ip||null;s.userAgent=cleanText(userAgent||"",200)||null;
    const last=cur.signers.every(x=>x.status==="Signed");
    let events=cur.events;
    for(const assignment of roleAssignmentEvidence){
      events=await chainEvents(events,{type:"signer.role_assignment.completed",signerId:s.id,at,roleAssignmentIndex:assignment.roleAssignmentIndex,role:assignment.role,capacity:assignment.capacity,fieldIds:assignment.fieldIds,signatureFieldHashes:assignment.signatureFieldHashes});
    }
    events=await chainEvents(events,{type:"signer.signed",signerId:s.id,at,ip:ip||null,signatureType:sig.type,signatureHash:await sha256Hex(sig.value),identityType:s.identityType,roleAssignments:s.roleAssignments||[],roleAssignmentEvidence,signerDeclarations:declared,declarationDiscrepancy:s.declarationDiscrepancy});
    return{patch:{signers:cur.signers,status:last?"Completing":"InProgress",events},result:{idempotent:false,winner:last,status:last?"Completing":"InProgress"}};
  });
  if(out.idempotent)return{ok:true,idempotent:true,status:out.status,completed:out.status==="Completed"};
  if(!out.winner){await inviteNextPosition(ctx,e0.id);return{ok:true,status:"InProgress",completed:false};}
  const done=await finalizeEnvelope(ctx,e0.id);
  return done.completed?{ok:true,status:"Completed",completed:true,distribution:done.distribution||null}:{ok:true,status:"CompletionFailed",completed:false};
}
export async function declineSigning(ctx,{token,reason,ip,user}){const{env,signer}=await load(ctx,token);active(ctx,env,signer);assertSignerAuthentication(signer,user);await mutate(ctx,env.id,async cur=>{const s=cur.signers.find(x=>x.id===signer.id);if(s.status!=="Pending")throw new HttpError(409,"This envelope can no longer be declined.");const at=ctx.now().toISOString();const emailLink=s.identityType==="email-link";s.status="Declined";if(emailLink){s.emailLinkTokenHistory=[...(s.emailLinkTokenHistory||[]),{tokenHash:s.tokenHash,status:"revoked_by_signer",revokedAt:at}].slice(-10);s.emailLinkStatus="revoked";}return{patch:{signers:cur.signers,status:"Declined",events:await chainEvents(cur.events,{type:emailLink?"email_link.revoked_by_signer":"signer.declined",signerId:s.id,at,ip:ip||null,reason:cleanText(reason||"",300),identityType:s.identityType||"firebase-uid"})}}});return{ok:true,status:"Declined",revoked:signer.identityType==="email-link"}}
export async function finalizeEnvelope(ctx,id){const e=await ctx.meta.get("envelopes",id);if(!e)throw new HttpError(404,"Envelope not found.");if(e.status==="Completed"){let distribution=null;try{distribution=await distributeCompletedSignatureDocument(ctx,e,e.completion)}catch(error){ctx.logger?.error?.("SIGNATURE_DISTRIBUTION_RECONCILIATION_FAILED",{envelopeId:id,errorType:String(error?.name||"Error")})}return{ok:true,completed:true,completion:e.completion,distribution}}if(!["Completing","CompletionFailed"].includes(e.status))return{ok:false,completed:false};await ctx.meta.update("envelopes",id,{status:"Finalizing"},{ifVersion:e._v});const cur=await ctx.meta.get("envelopes",id),stored=[];try{const{bytes:orig}=await original(ctx,cur),completedAt=ctx.now().toISOString(),finalBytes=await buildSignedPdf(orig,{envelopeId:cur.id,documentId:cur.documentId,title:cur.title,originalHash:cur.documentHash,chainHead:cur.events.at(-1).hash,events:cur.events,completedAt,signers:cur.signers.map(s=>({id:s.id,uid:s.uid,name:s.name,email:s.email,signedAt:s.signedAt,ip:s.ip,signatureType:s.signatureType,signatureValue:s.signatureValue,fieldValues:s.fieldValues||{},signerDeclarations:s.signerDeclarations||{},declarationDiscrepancy:s.declarationDiscrepancy||null})),fields:cur.fields||[]}),finalHash=await sha256Hex(finalBytes),fileName=`${cleanSegment(cur.fileName.replace(/\.pdf$/i,""),80)}-signed-${finalHash.slice(0,12)}.pdf`;for(const k of cur.archiveTargets){const path=archivePath({archiveKey:k,classification:cur.classification,documentId:cur.documentId,fileName});const r=await ctx.storage.put({path,bytes:finalBytes,contentType:"application/pdf",metadata:{envelopeId:cur.id,documentId:cur.documentId,finalHash,state:"Final Completed Document",archive:k}});stored.push({kind:"archive",archiveKey:k,id:r.id,path})}for(const c of[{kind:"owner-copy",ownerKey:cur.createdBy,recipientUid:cur.createdBy,recipientEmailHash:cur.ownerEmail?await sha256Hex(cur.ownerEmail):null},...cur.signers.map(s=>({kind:"signer-copy",ownerKey:s.profileUid||s.uid||`${cur.id}-${s.id}`,signerId:s.id,recipientUid:s.profileUid||s.uid||null,recipientEmailHash:s.emailHash||null}))]){const path=signerCopyPath({ownerKey:c.ownerKey,fileName});const r=await ctx.storage.put({path,bytes:finalBytes,contentType:"application/pdf",metadata:{envelopeId:cur.id,documentId:cur.documentId,recipientUid:c.recipientUid||"",recipientSignerId:c.signerId||"",recipientEmailHash:c.recipientEmailHash||"",copyKind:c.kind,finalHash,state:"Final Completed Document",archive:"my-documents"}});stored.push({kind:c.kind,signerId:c.signerId,recipientUid:c.recipientUid||null,id:r.id,path})}const cryptoRequired=["staging","production"].includes(ctx.env?.IRPA_ENVIRONMENT)||(ctx.env?.DRIVE_MOCK==="false"&&ctx.allowReturnTokens!==true);if(cryptoRequired&&!ctx.crypto?.keyProvider)throw new Error("Cryptographic signer key custody is not configured.");const cryptoResult=ctx.crypto?.keyProvider?await sealAndPersist({meta:ctx.meta,storage:ctx.storage,keyProvider:ctx.crypto.keyProvider,envelope:{...cur,chainHead:cur.events.at(-1).hash},document:{id:cur.documentId,bytes:finalBytes}}):null;if(cryptoRequired&&(!cryptoResult?.sealed||cryptoResult.documentHash!==finalHash||cryptoResult.evidenceIds?.length!==cur.signers.length))throw new Error("Cryptographic evidence does not bind every authenticated signer to the exact completed PDF.");const cryptoEvents=cryptoResult ? cryptoResult.auditEvents : [];const cryptographicEvidenceIds=cryptoResult ? cryptoResult.evidenceIds : [];let events=cur.events;for(const event of cryptoEvents)events=await chainEvents(events,event);const lastSigner=[...cur.signers].sort((a,b)=>Date.parse(b.signedAt||0)-Date.parse(a.signedAt||0))[0];const completion={finalHash,fileName,completedAt,lastSignedByUid:lastSigner?.uid||null,primaryStorageId:stored[0].id,files:stored,cryptographicEvidenceIds,signerEvidence:(cryptoResult?.evidence||[]).map(e=>({signerId:e.signerId,evidenceId:e.evidenceId,identityType:e.signerIdentityType||"firebase-uid"}))};await ctx.meta.update("envelopes",id,{status:"Completed",completion,events:await chainEvents(events,{type:"envelope.completed",at:completedAt,finalHash,fileCount:stored.length,cryptographicEvidenceCount:cryptographicEvidenceIds.length})},{ifVersion:cur._v});if(cur.externalReference&&typeof ctx.persistCompletedSignatureEnvelope==="function"){await persistMirrorWithStatus(ctx,{...cur,status:"Completed",completion,events},completion)}let distribution=null;try{distribution=await distributeCompletedSignatureDocument(ctx,{...cur,status:"Completed"},completion,{bytes:finalBytes})}catch(error){ctx.logger?.error?.("SIGNATURE_DISTRIBUTION_RECONCILIATION_FAILED",{envelopeId:id,errorType:String(error?.name||"Error")})}return{ok:true,completed:true,completion,distribution}}catch(err){try{await rollbackCryptographicEvidence(ctx.meta,id)}catch{}for(const f of stored){try{await ctx.storage.delete(f.id)}catch{}}await ctx.meta.update("envelopes",id,{status:"CompletionFailed"},{ifVersion:(await ctx.meta.get("envelopes",id))._v});return{ok:false,completed:false,error:"COMPLETION_FAILED"}}}
const owner=(e,u)=>e.createdBy===u.uid||u.isAdmin===true;
export async function retryCompletion(ctx,user,id){const e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");return finalizeEnvelope(ctx,id)}
export async function retryCompletedDocumentDistribution(ctx,user,id){return retryFailedSignatureDistributions(ctx,user,id)}
export async function voidEnvelope(ctx,user,id,reason){const e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");if(e.status==="Completed")throw new HttpError(409,"A completed envelope cannot be voided.");await mutate(ctx,id,async c=>{if(c.status==="Completed")throw new HttpError(409,"A completed envelope cannot be voided.");for(const signer of c.signers||[])if(signer.identityType==="email-link"&&signer.emailLinkStatus!=="used"){signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]),{tokenHash:signer.tokenHash,status:"revoked",revokedAt:ctx.now().toISOString()}].slice(-10);signer.emailLinkStatus="revoked";}return{patch:{status:"Voided",signers:c.signers,events:await chainEvents(c.events,{type:"envelope.voided",at:ctx.now().toISOString(),actor:user.uid,reason:cleanText(reason||"",300)})}}});return{ok:true,status:"Voided"}}

export async function resendInvitation(ctx,user,id,signerId){
  const envelope=await ctx.meta.get("envelopes",id);
  if(!envelope||!owner(envelope,user))throw new HttpError(403,"Not authorized.");
  if(["Completed","Voided","Declined","Cancelled","Canceled"].includes(envelope.status))throw new HttpError(409,"A completed or cancelled signing envelope cannot send another link.");
  const target=envelope.signers.find(s=>s.id===signerId);
  if(!target)throw new HttpError(404,"Signer assignment not found.");
  if(target.status==="Signed")throw new HttpError(409,"A signer who has completed signing cannot receive another link.");
  if(envelope.signers.some(s=>s.order<target.order&&s.status!=="Signed"))throw new HttpError(409,"This signer is not yet at the current signing position. Later signers cannot be emailed early.");
  if(typeof ctx.sendInvitation!=="function")throw new HttpError(503,"Signing invitation transport is not configured.");
  const emailLink=target.identityType==="email-link";
  const secret=randomHex(32),now=ctx.now(),expiresAt=new Date(now.getTime()+ctx.config.ttlDays*86400000).toISOString();
  const token=`${id}.${signerId}.${secret}`;
  const link=emailLink?`${ctx.config.appUrl}/?emailSignToken=${encodeURIComponent(token)}`:`${ctx.config.appUrl}/sign?gatewayToken=${encodeURIComponent(token)}&signEnvelope=${encodeURIComponent(envelope.externalReference||"")}`;
  try{
    await ctx.sendInvitation({to:target.email,name:target.name,link,emailLink,title:envelope.title,ownerName:envelope.ownerName||user.email||"IRPA Document Owner",envelopeId:id,signerId,expiresAt,...(emailLink?{onStage:(stage,outcome,category)=>recordEmailLinkStage(ctx,id,signerId,stage,outcome,category)}:{})});
  }catch(error){
    ctx.logger?.error?.("SIGNING_INVITATION_DELIVERY_FAILED",{envelopeId:id,signerId,...invitationFailureDiagnostics(error)});
    await mutate(ctx,id,async current=>({patch:{events:await chainEvents(current.events,{type:"invitation.resend.failed",signerId,actor:user.uid,stageCode:EMAIL_STAGE_SET.has(error?.stageCode)?error.stageCode:"SUBMIT",at:ctx.now().toISOString()})}}));
    const failure=new HttpError(502,"The signing invitation could not be delivered. The previous link remains valid; retry after resolving the delivery error.");failure.code=EMAIL_STAGE_SET.has(error?.stageCode)?error.stageCode:"SUBMIT";throw failure;
  }
  await mutate(ctx,id,async current=>{
    if(["Completed","Voided","Declined","Cancelled","Canceled"].includes(current.status))throw new HttpError(409,"A completed or cancelled signing envelope cannot send another link.");
    const signer=current.signers.find(s=>s.id===signerId);
    if(!signer||signer.status==="Signed")throw new HttpError(409,"This signer assignment can no longer receive another link.");
    if(current.signers.some(s=>s.order<signer.order&&s.status!=="Signed"))throw new HttpError(409,"This signer is not yet at the current signing position.");
    signer.tokenHistory=[...(signer.tokenHistory||[]),{tokenHash:signer.tokenHash,status:"replaced",replacedAt:now.toISOString()}].slice(-20);
    if(signer.identityType==="email-link"){
      signer.emailLinkTokenHistory=[...(signer.emailLinkTokenHistory||[]).map(item=>({...item,status:"replaced",replacedAt:now.toISOString()})),{tokenHash:signer.tokenHash,status:"replaced",replacedAt:now.toISOString()}].slice(-20);
      signer.emailLinkStatus="issued";signer.emailLinkExpiresAt=expiresAt;signer.emailLinkAttemptCount=0;signer.emailLinkOpenCount=0;signer.emailLinkIpAttempts={};signer.emailLinkLastIpHash=null;signer.emailLinkOpenedAt=null;
    }
    signer.tokenHash=await sha256Hex(secret);signer.tokenExpiresAt=expiresAt;signer.invitation="Sent";delete signer.deliveryStageCode;
    return{patch:{signers:current.signers,events:await chainEvents(current.events,{type:emailLink?"email_link.resent":"invitation.resent",signerId,actor:user.uid,expiresAt,at:now.toISOString()})}};
  });
  return{ok:true,envelopeId:id,signerId,deliveryStatus:"Sent",expiresAt};
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


export async function getEnvelopeStatus(ctx,user,id){let e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");if(e.status==="Completed"&&e.externalReference&&e.mirrorStatus==="Pending"&&typeof ctx.persistCompletedSignatureEnvelope==="function"){await persistMirrorWithStatus(ctx,e,e.completion);e=await ctx.meta.get("envelopes",id)||e}const last=e.events?.at(-1)||null;const lastEvent=last?{type:last.type||"event",at:last.at||null,signerId:last.signerId||null,deliveryStatus:last.deliveryStatus||null}:null;return{ok:true,envelopeId:id,documentId:e.documentId,status:e.status,mirrorStatus:e.mirrorStatus||null,mirrorError:e.mirrorError||null,mirrorAttempts:Number(e.mirrorAttempts||0),signers:e.signers.map(s=>({id:s.id,name:s.name,email:s.email,title:s.title||"",roleAssignments:s.roleAssignments||[],order:s.order,status:s.status,signedAt:s.signedAt||null,invitation:s.invitation,identityType:s.identityType||"account",emailLinkStatus:s.emailLinkStatus||null,emailLinkExpiresAt:s.emailLinkExpiresAt||null,linkExpiresAt:s.tokenExpiresAt||s.emailLinkExpiresAt||e.expiresAt,linkExpired:Boolean((Date.parse(String(s.tokenExpiresAt||s.emailLinkExpiresAt||e.expiresAt||""))||0)<=ctx.now().getTime())})),lastEvent,completion:e.completion?{finalHash:e.completion.finalHash,completedAt:e.completion.completedAt,files:e.completion.files}:null,eventCount:e.events.length,auditChainValid:await verifyChain(e.events),distribution:await getSignatureDistributionSummary(ctx,id)}}
export async function resyncMirror(ctx,user,id){const e=await ctx.meta.get("envelopes",id);if(!e||!owner(e,user))throw new HttpError(403,"Not authorized.");if(e.status!=="Completed"||!e.externalReference||!e.completion)throw new HttpError(409,"Only completed linked envelopes can be resynchronized.");if(typeof ctx.persistCompletedSignatureEnvelope!=="function")throw new HttpError(503,"Signature mirror persistence is not configured.");await persistMirrorWithStatus(ctx,e,e.completion);const updated=await ctx.meta.get("envelopes",id);return{ok:true,envelopeId:id,status:updated?.status||"Completed",mirrorStatus:updated?.mirrorStatus||"Pending",mirrorError:updated?.mirrorError||null,mirrorAttempts:Number(updated?.mirrorAttempts||0)}}
export async function persistMirrorWithStatus(ctx,envelope,completion){const id=envelope.id;const now=ctx.now();const nextAt=Number(new Date(envelope.mirrorNextRetryAt||0));if(envelope.mirrorStatus==="Pending"&&Number.isFinite(nextAt)&&nextAt>now.getTime())return false;const attempts=Number(envelope.mirrorAttempts||0)+1;try{await ctx.persistCompletedSignatureEnvelope({envelope,completion});await ctx.meta.update("envelopes",id,{mirrorStatus:"Completed",mirrorError:null,mirrorAttempts:attempts,mirrorNextRetryAt:null,mirrorUpdatedAt:now.toISOString()});return true}catch(error){const message=String(error?.message||error).slice(0,300);const delayMs=Math.min(60*60*1000,30*1000*Math.pow(2,Math.min(attempts-1,7)));try{const latest=await ctx.meta.get("envelopes",id);if(latest)await ctx.meta.update("envelopes",id,{mirrorStatus:"Pending",mirrorError:message,mirrorAttempts:attempts,mirrorNextRetryAt:new Date(now.getTime()+delayMs).toISOString(),mirrorUpdatedAt:now.toISOString()},{ifVersion:latest._v})}catch(statusError){ctx.logger?.error?.("SIGNATURE_MIRROR_STATUS_PERSIST_FAILED",{envelopeId:id,message:String(statusError?.message||statusError).slice(0,200)})}ctx.logger?.error?.("SIGNATURE_PORTAL_COMPLETION_PERSIST_FAILED",{envelopeId:envelope.externalReference,gatewayEnvelopeId:id,message,attempts});return false}}
export async function getSigningStatus(ctx,token,user=null){const{env,signer}=await load(ctx,token);const privileged=Boolean(user?.uid)&&(user.uid===env.createdBy||user.isAdmin===true);if(!privileged)assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");const completion=env.completion?{finalHash:env.completion.finalHash,completedAt:env.completion.completedAt,primaryStorageId:env.completion.primaryStorageId,fileName:env.completion.fileName,signedFileReference:env.completion.primaryStorageId,files:(env.completion.files||[]).filter(file=>file?.kind==="archive"||(file?.kind==="signer-copy"&&file.signerId===signer.id)),cryptographicEvidenceIds:env.completion.cryptographicEvidenceIds||[]}:null;const distribution=await getSignatureDistributionSummary(ctx,env.id);return{ok:true,envelopeId:env.id,externalReference:env.externalReference||null,documentId:env.documentId,status:env.status,distribution:{complete:distribution.complete,sent:distribution.sent,total:distribution.total},signingMode:env.signingMode||"Sequential",signer:{id:signer.id,uid:signer.uid||null,status:signer.status},signers:env.signers.map(s=>({id:s.id,uid:privileged||s.id===signer.id?(s.uid||null):null,name:s.name,order:s.order,status:s.status,signedAt:s.signedAt||null})),completion,eventCount:env.events.length,auditChainValid:await verifyChain(env.events)}}
export async function verifySigningPdf(ctx,token,user,bytes){const{env,signer}=await load(ctx,token);assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");if(env.status!=="Completed"||!env.completion?.finalHash)throw new HttpError(409,"The signing envelope is not completed.");if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>12*1024*1024)throw new HttpError(413,"A completed PDF of at most 12 MB is required.");const actualHash=await sha256Hex(bytes);if(actualHash!==env.completion.finalHash)throw new HttpError(409,"The provided PDF does not match the completed envelope hash.");return{ok:true,verified:true,envelopeId:env.id,externalReference:env.externalReference||null,documentHash:actualHash,cryptographicEvidenceIds:env.completion.cryptographicEvidenceIds||[]}}
export async function getSigningEvidence(ctx,token,user=null){const{env,signer}=await load(ctx,token);assertSignerAuthentication(signer,user);if(!await verifyChain(env.events))throw new HttpError(409,"Signing audit chain failed verification.");if(env.status!=="Completed"||!env.completion?.finalHash)throw new HttpError(409,"Cryptographic evidence is available only after successful completion.");const rows=await ctx.meta.list("cryptographicEvidence"),matches=(rows||[]).filter(e=>e?.envelopeId===env.id&&(signer.uid?e?.signerUid===signer.uid:(e?.signerId===signer.id&&e?.signerIdentityType==="email-link"&&e?.signerIdentityHash===signer.emailHash)));if(!matches.length)throw new HttpError(404,"Cryptographic signing evidence is not available for this signer.");const verified=[];for(const evidence of matches){let valid=false;try{const publicKey=await importPublicKeyJwk(evidence.publicKeyJwk);valid=await verifyCryptographicEvidence(evidence,{documentHash:env.completion.finalHash,signerUid:signer.uid||null,signerIdentityType:signer.identityType,signerIdentityHash:signer.emailHash||null,publicKey})}catch{}if(!valid)throw new HttpError(409,"Persisted cryptographic evidence failed verification.");verified.push(evidence)}return{ok:true,envelopeId:env.id,externalReference:env.externalReference||null,documentHash:env.completion.finalHash,evidence:verified,auditChainValid:await verifyChain(env.events)}}
