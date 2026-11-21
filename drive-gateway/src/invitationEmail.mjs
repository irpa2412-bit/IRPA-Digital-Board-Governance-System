// drive-gateway/src/invitationEmail.mjs
// Isolated member invitation sender. Caller authorization remains in the Worker route.

import { buildMailMimeMessage, escapeHtml, normalizeRecipientEmail } from "./mailDelivery.js";

const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
const CRLF_RE = /[\r\n\u2028\u2029]/;
const SUBJECT = "Invitation to the IRPA Digital Board Governance System";

export function validateRecipient(email) {
  if (typeof email !== "string") return null;
  const v = email.trim().toLowerCase();
  if (!v || v.length > 254 || CRLF_RE.test(v) || !EMAIL_RE.test(v)) return null;
  return v;
}
export function buildSmtpRecipientEnvelope({from,to,subject,text,html,attachments=[]}) {
  const typedRecipient=validateRecipient(to);
  if(!typedRecipient)throw new Error("A valid single signer recipient email address is required.");
  const recipient=normalizeRecipientEmail(typedRecipient);
  const mime=buildMailMimeMessage({from,to:recipient,subject,text,html,attachments});
  return {recipient,rcptCommand:"RCPT TO:<"+recipient+">",toHeader:"<"+recipient+">",mime};
}

export function buildSignerInvitationSubject({title,position,positionCount,name}={}) {
  const safeTitle=String(title||"Controlled document").replace(/[\r\n\u2028\u2029]+/g," ").trim().slice(0,180)||"Controlled document";
  const safeName=validateName(name);
  if(!safeName)throw new Error("Invalid signer name");
  const firstName=safeName.split(/\s+/)[0]||"Signer";
  return "Please sign: "+safeTitle+" - "+firstName+" (signer "+Math.max(1,Number(position)||1)+" of "+Math.max(1,Number(positionCount)||1)+")";
}

export function buildSigningInvitationAuditMessage({recipientPrefix,recipientDomain,position,positionCount,title,envelopeId,messageId,smtpReplyCategory="UNKNOWN",stageCode=null,invitationKind="creation",at=new Date()}={}) {
  const domain=String(recipientDomain||"unknown").toLowerCase().replace(/[^a-z0-9.-]/g,"").slice(0,253)||"unknown";
  const maskedRecipient=String(recipientPrefix||"").slice(0,3)+"...@"+domain;
  const safeTitle=String(title||"Controlled document").replace(/[\r\n\u2028\u2029]+/g," ").trim().slice(0,180)||"Controlled document";
  const when=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Dar_es_Salaam",dateStyle:"medium",timeStyle:"medium"}).format(new Date(at||Date.now()))+" EAT";
  const type=invitationKind==="resend"?"resend":"creation";
  const category="SMTP reply category: "+String(smtpReplyCategory||"UNKNOWN").slice(0,40);
  const details=category+(stageCode?"\nStage code: "+String(stageCode).replace(/[^A-Z0-9_-]/gi,"").slice(0,40):"");
  const subject="AUDIT: invitation to "+maskedRecipient+" position "+Math.max(1,Number(position)||1)+" - "+safeTitle;
  const text="Time (EAT): "+when+"\nEnvelope ID: "+String(envelopeId||"")+"\nPosition: "+Math.max(1,Number(position)||1)+" of "+Math.max(1,Number(positionCount)||1)+"\nMessage-ID: "+String(messageId||"Not recorded")+"\nType: "+type+"\n"+details+"\nRecipient domain: "+domain;
  const html="<p><strong>Time (EAT):</strong> "+escapeHtml(when)+"</p><p><strong>Envelope ID:</strong> "+escapeHtml(envelopeId||"")+"</p><p><strong>Position:</strong> "+Math.max(1,Number(position)||1)+" of "+Math.max(1,Number(positionCount)||1)+"</p><p><strong>Message-ID:</strong> "+escapeHtml(messageId||"Not recorded")+"</p><p><strong>Type:</strong> "+type+"</p><p>"+escapeHtml(details).replace(/\n/g,"<br>")+"</p><p><strong>Recipient domain:</strong> "+escapeHtml(domain)+"</p>";
  return {to:"info@irpa.or.tz",subject,text,html};
}

export function buildEmailSigningInvitationMessage({name,link,title,ownerName,expiresAt}) {
  const safeName=validateName(name);
  if(!safeName)throw new Error("Invalid name");
  const safeLink=new URL(link).toString();
  const clean=(value,max=180)=>String(value||"").replace(/[\r\n\u2028\u2029]+/g," ").trim().slice(0,max);
  const safeTitle=clean(title)||"A controlled IRPA document";
  const safeOwner=clean(ownerName)||"IRPA Document Owner";
  const expiryDate=expiresAt?new Date(expiresAt):null;
  const hasExpiry=Boolean(expiryDate&&Number.isFinite(expiryDate.getTime()));
  const expiryLabel=hasExpiry?new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Dar_es_Salaam",dateStyle:"medium",timeStyle:"short"}).format(expiryDate)+" EAT":"the expiry shown in your signing invitation";
  const expiryText="Link expiry: "+expiryLabel+". The link can be redeemed once; after expiry or replacement, ask the document owner for a new link.";
  const expiryHtml="<strong>Link expiry:</strong> "+escapeHtml(expiryLabel)+". The link can be redeemed once; after expiry or replacement, ask the document owner for a new link.";
  const subject="IRPA secure document-signing invitation";
  const text="Dear "+safeName+",\n\n"+safeOwner+" has invited you to review and sign a controlled document in the IRPA Digital Board Governance System.\n\nDocument: "+safeTitle+"\n"+expiryText+"\n\nOpen your single-use secure link:\n"+safeLink+"\n\nOpening the link verifies control of this email address and starts a signer-specific session. Review the document, complete your transaction declaration and sign in that session. Keep the same browser tab open to resume; if you lose the session, ask the document owner to resend the invitation.\n\nThis link does not independently verify your legal identity or institutional authority. Do not forward it. If you did not expect this invitation, contact IRPA Administration.";
  const html="<p>Dear "+escapeHtml(safeName)+",</p><p>"+escapeHtml(safeOwner)+" has invited you to review and sign a controlled document in the IRPA Digital Board Governance System.</p><p><strong>Document:</strong> "+escapeHtml(safeTitle)+"<br>"+expiryHtml+"</p><p><a href=\""+escapeHtml(safeLink)+"\">Open secure document link</a></p><p>This is a private, single-use link. Opening it verifies control of this email address and starts a signer-specific session. Review the document, complete your transaction declaration and sign in that session. Keep the same browser tab open to resume; if you lose the session, ask the document owner to resend the invitation.</p><p>This link does not independently verify your legal identity or institutional authority. Do not forward it.</p><p>If you did not expect this invitation, contact IRPA Administration.</p>";
  return {subject,text,html};
}

export const EMAIL_LINK_STAGE_CODES=Object.freeze(["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT","TOKEN_LOOKUP","SESSION_CREATE"]);

export function classifySmtpReplyCategory(error, stage = "") {
  const message = String(error?.message || error || "").toLowerCase();
  const code = Number(error?.smtpResponseCode || (message.match(/(?:smtp error |^)(\d{3})/i) || [])[1] || 0);
  const transportCode = String(error?.code || "").toUpperCase();
  if (stage === "SMTP_AUTH" || /authentication failed|auth failed|invalid credentials|credentials rejected|not authorized/.test(message)) return "AUTH_FAILED";
  if (transportCode === "ECONNREFUSED" || /connection refused/.test(message)) return "CONNECTION_REFUSED";
  if (/mailbox full|mailbox is full|quota exceeded|over quota|insufficient storage/.test(message) || code === 552 || code === 452 && /4\.2\.2/.test(message)) return "MAILBOX_FULL";
  if (/rate.?limit|too many messages|throttl|sending limit|try again later/.test(message) || [421,450,451,452,454].includes(code)) return "RATE_LIMITED";
  if (/recipient.*reject|unknown recipient|user unknown|no such user|address rejected/.test(message) || [550,551,553].includes(code) || /5\.1\.[0-9]/.test(message)) return "RECIPIENT_REJECTED";
  return "UNKNOWN";
}
export async function runEmailStage(stage,action,onStage){
  if(!EMAIL_LINK_STAGE_CODES.includes(stage))throw new Error("Unsupported email stage.");
  try{
    const result=await action();
    try{await onStage?.(stage,"success","UNKNOWN")}catch{}
    return result;
  }catch(error){
    const response=String(error?.message||"").match(/IRPA SMTP error (\d{3})/i);
    const safe=new Error(response?`IRPA SMTP error ${response[1]}`:`Email delivery failed at ${stage}.`);
    safe.name=String(error?.name||"Error").slice(0,40);
    safe.stageCode=stage;
    safe.smtpReplyCategory=["RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"].includes(error?.smtpReplyCategory)?error.smtpReplyCategory:classifySmtpReplyCategory(error,stage);
    if(response)safe.smtpResponseCode=Number(response[1]);
    if(/^[A-Z0-9_-]{1,40}$/i.test(String(error?.code||"")))safe.code=String(error.code);
    if(error?.deliveryOutcome==="unknown")safe.deliveryOutcome="unknown";
    if(error?.retryable===false)safe.retryable=false;
    try{await onStage?.(stage,"failure",safe.smtpReplyCategory)}catch{}
    throw safe;
  }
}

export async function sendEmailSigningInvitation({email,name,link,title,ownerName,expiresAt,smtpSend,logger=console,sleep,onStage}) {
  const to=validateRecipient(email);
  if(!to)throw new Error("Invalid recipient");
  const outcomes=new Map();
  const capture=async(stage,outcome,smtpReplyCategory)=>outcomes.set(stage,{outcome,smtpReplyCategory});
  let result,error;
  try{
    const message=await runEmailStage("BUILD_MESSAGE",()=>buildEmailSigningInvitationMessage({name,link,title,ownerName,expiresAt}),capture);
    result=await sendWithRetry(()=>smtpSend({to,...message,onStage:capture}),{logger,sleep});
  }catch(err){
    error=err;
    if(EMAIL_LINK_STAGE_CODES.includes(err?.stageCode))outcomes.set(err.stageCode,"failure");
  }
  for(const [stage,result] of outcomes){try{await onStage?.(stage,result.outcome,result.smtpReplyCategory)}catch{}}
  if(error)throw error;
  return result;
}

export async function handleSendInvitationEmail(request, env, deps = {}) {
  const { authenticateFirebaseRequest, smtpSend, enforceRateLimit, logger = console, sleep, json, corsHeaders } = deps;
  const respond = (status, body) => typeof json === "function"
    ? json(body, status, typeof corsHeaders === "function" ? corsHeaders(request) : {})
    : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (typeof authenticateFirebaseRequest !== "function" || typeof smtpSend !== "function") {
    return respond(503, { ok:false, error:"Email delivery service is unavailable." });
  }
  let claims;
  const authorization = String(request.headers.get("Authorization") || "").trim();
  if (authorization) {
    try {
      claims = await authenticateFirebaseRequest(request, env, { skipActivation:true });
    } catch {
      return respond(401, { ok:false, error:"Firebase service authentication is required." });
    }
    if (claims?.user_id !== "irpa-email-dispatcher" || claims?.firebaseClaims?.emailDeliveryService !== true) {
      return respond(403, { ok:false, error:"Authorised email service identity is required." });
    }
  } else {
    // Temporary compatibility bridge: keep existing deployed Functions working
    // until the Firebase Functions release is confirmed live.
    const supplied = String(request.headers.get("x-irpa-service-key") || "");
    const expected = String(env?.INVITE_SERVICE_KEY || "");
    if (!supplied || !expected) return respond(401, { ok:false, error:"Email service authentication is required." });
    const left = new TextEncoder().encode(supplied);
    const right = new TextEncoder().encode(expected);
    let difference = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) difference |= (left[i] || 0) ^ (right[i] || 0);
    if (difference !== 0) return respond(401, { ok:false, error:"Email service authentication is required." });
    claims = { user_id:"legacy-invite-service", firebaseClaims:{ emailDeliveryService:true }, legacy:true };
  }

  let body;
  try { body = await request.json(); } catch { return respond(400, { ok:false, error:"Invalid JSON" }); }
  const to = validateRecipient(body?.to);
  if (!to) return respond(400, { ok:false, error:"Invalid recipient" });
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  if (!subject || subject.length > 200 || CRLF_RE.test(subject)) return respond(400, { ok:false, error:"Invalid subject" });
  if (typeof body?.text !== "string" || typeof body?.html !== "string" ||
      body.text.length > 100000 || body.html.length > 100000) {
    return respond(400, { ok:false, error:"Invalid message body" });
  }
  if (typeof enforceRateLimit === "function") {
    try { await enforceRateLimit(env, to, claims); }
    catch (error) {
      const status = Number(error?.status) === 429 ? 429 : 503;
      return respond(status, { ok:false, error:status === 429 ? "Too many messages to this address." : "Email rate-limit service is unavailable." });
    }
  }

  try {
    const result = await sendWithRetry(
      () => smtpSend(env, { to, subject, text:body.text, html:body.html }),
      { logger, sleep }
    );
    return respond(200, { ok:true, messageId:result?.messageId || result || null });
  } catch (error) {
    logger.error("SERVER_EMAIL_PROVIDER_FAILED", {
      recipientDomain: to.split("@")[1] || "unknown",
      message: String(error?.message || error).replace(/[\r\n]/g, " ").slice(0, 200)
    });
    return respond(502, { ok:false, error:"EMAIL_PROVIDER_FAILED" });
  }
}
