// drive-gateway/src/invitationEmail.mjs
// Isolated member invitation sender. Caller authorization remains in the Worker route.

import { buildMailMimeMessage, normalizeRecipientEmail } from "./mailDelivery.js";

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
  const details=category+(stageCode?"\nStage code: "+String(stageCode).slice(0,40):"");
  const subject="AUDIT: invitation to "+maskedRecipient+" position "+Number(position||1)+" - "+safeTitle;
  const text="Time (EAT): "+when+"\nEnvelope ID: "+String(envelopeId||"")+"\nPosition: "+Number(position||1)+" of "+Number(positionCount||1)+"\nMessage-ID: "+String(messageId||"Not recorded")+"\nType: "+type+"\n"+details+"\nRecipient domain: "+domain;
  const html="<p><strong>Time (EAT):</strong> "+escapeHtml(when)+"</p><p><strong>Envelope ID:</strong> "+escapeHtml(envelopeId||"")+"</p><p><strong>Position:</strong> "+Number(position||1)+" of "+Number(positionCount||1)+"</p><p><strong>Message-ID:</strong> "+escapeHtml(messageId||"Not recorded")+"</p><p><strong>Type:</strong> "+type+"</p><p>"+escapeHtml(details).replace(/\n/g,"<br>")+"</p><p><strong>Recipient domain:</strong> "+escapeHtml(domain)+"</p>";
  return {to:"info@irpa.or.tz",subject,text,html};
}

export function validateName(name) {
  if (name === undefined || name === null || name === "") return "Member";
  if (typeof name !== "string" || name.length > 100 || CRLF_RE.test(name)) return null;
  return name.trim() || "Member";
}
export function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
export const MAX_INVITATION_MAIL_ATTEMPTS = 3;
export const MAX_INVITATION_RETRY_DELAY_MS = 2000;

// A queued delivery is considered in-flight only for a short bounded lease.
// Missing or stale timestamps are recoverable and must not block a resend forever.
export function isInvitationQueueActive(queuedAt, now = Date.now(), leaseMs = 5 * 60 * 1000) {
  const queuedAtMs = Date.parse(String(queuedAt || ""));
  return Number.isFinite(queuedAtMs) && queuedAtMs <= now + 30_000 && now - queuedAtMs < leaseMs;
}

export function isRetryableMailError(error) {
  const message = String(error?.message || error || "");
  const smtp = message.match(/IRPA SMTP error (\d{3})/i);
  if (smtp) {
    const code = Number(smtp[1]);
    return Number(smtp[1]) >= 400 && Number(smtp[1]) < 500;
  }
  if (error?.deliveryOutcome === "unknown" || error?.retryable === false) return false;
  return true;
}

export async function sendWithRetry(fn, opts = {}) {
  const { attempts=MAX_INVITATION_MAIL_ATTEMPTS, delayMs=300,
    maxDelayMs=MAX_INVITATION_RETRY_DELAY_MS, logger=console,
    shouldRetry=isRetryableMailError, sleep=(ms)=>new Promise(r=>setTimeout(r,ms)) }=opts;
  const boundedAttempts=Math.max(1,Math.min(MAX_INVITATION_MAIL_ATTEMPTS,Number(attempts)||MAX_INVITATION_MAIL_ATTEMPTS));
  let lastErr;
  for(let i=1;i<=boundedAttempts;i++){
    try{return await fn(i);}
    catch(e){
      lastErr=e;
      try { logger?.error?.("IRPA invitation mail attempt failed", {attempt:i, retryable:shouldRetry(e), stage:e?.stage||"provider"}); } catch {}
      if(i===boundedAttempts||!shouldRetry(e)) break;
      const cap=Math.max(0,Number(maxDelayMs)||MAX_INVITATION_RETRY_DELAY_MS);
      const exponential=Math.min(cap,Math.max(0,Number(delayMs)||300)*2**(i-1));
      const jitter=Math.floor(Math.random()*Math.max(1,Math.floor(exponential*0.2)));
      await sleep(Math.min(cap,exponential+jitter));
    }
  }
  throw lastErr || new Error("Invitation mail delivery failed.");
}
export function buildInvitationMessage({name,link,meetingAccess=null,username=""}) {
  const safeName=validateName(name);
  if(!safeName) throw new Error("Invalid name");
  const safeLink=new URL(link).toString();
  let meetingText="";
  let meetingHtml="";
  let subject=SUBJECT;
  if(meetingAccess){
    const meetingName=validateName(String(meetingAccess.meetingReference||"IRPA Meeting"));
    const gateLink=new URL(String(meetingAccess.link||"")).toString();
    const password=String(meetingAccess.password||"").trim();
    const cleanUsername=validateRecipient(String(username||""))||"";
    const usernameText=cleanUsername?"\nIRPA username: "+cleanUsername:"";
    const usernameHtml=cleanUsername?"<p><strong>IRPA username:</strong> "+escapeHtml(cleanUsername)+"</p>":"";
    if(!meetingName||!password||password.length>32||CRLF_RE.test(password))throw new Error("Invalid meeting access details");
    const detail=(value,max=240)=>String(value??"").replace(/[\r\n\u2028\u2029]+/g," ").trim().slice(0,max);
    const meetingIdentity=detail(meetingAccess.meetingIdentity||"System identity not recorded",180);
    const meetingTitle=detail(meetingAccess.meetingTitle||meetingName,180);
    const meetingDate=detail(meetingAccess.meetingDate,80);
    const meetingTime=detail([meetingAccess.meetingStartTime,meetingAccess.meetingEndTime].filter(Boolean).join(" – "),80);
    const meetingPlatform=detail(meetingAccess.meetingPlatform||"Platform details not recorded",120);
    const meetingVenue=detail(meetingAccess.meetingVenue,240);
    const platformMeetingId=detail(meetingAccess.platformMeetingId,120);
    const platformPasscode=detail(meetingAccess.platformPasscode,120);
    const meetingChairperson=detail(meetingAccess.meetingChairperson,120);
    const meetingAgenda=detail(meetingAccess.meetingAgenda,1000);
    let platformUrl="";
    if(String(meetingAccess.platformAccessUrl||"").trim()){
      try{const parsed=new URL(String(meetingAccess.platformAccessUrl).trim());if(parsed.protocol!=="https:")throw new Error("protocol");platformUrl=parsed.toString();}
      catch{throw new Error("Invalid registered meeting platform URL");}
    }
    subject="IRPA account activation and meeting access";
    meetingText=`\n\nREGISTERED MEETING PARTICULARS\nMeeting identity: ${meetingIdentity}\nMeeting reference: ${meetingName}\nMeeting title: ${meetingTitle}\nDate: ${meetingDate||"Not recorded"}\nTime: ${meetingTime||"Not recorded"}\nPlatform: ${meetingPlatform}\nPlatform access URL: ${platformUrl||"Not recorded"}\nPlatform meeting ID: ${platformMeetingId||"Not recorded"}\nPlatform passcode: ${platformPasscode||"Not recorded"}\nPhysical venue: ${meetingVenue||"Not recorded"}\nChairperson: ${meetingChairperson||"Not recorded"}\nAgenda / purpose: ${meetingAgenda||"Refer to the official meeting agenda"}\n\nMEETING ACCESS${usernameText}\nOpen the IRPA meeting gate after activating your account: ${gateLink}\nMeeting gate password: ${password}\nThis gate pass expires on ${String(meetingAccess.expiresAt||"the date shown by IRPA Administration")}. Do not forward it to another person.`;
    meetingHtml=`<hr><h3>Registered Meeting Particulars</h3><table><tbody><tr><th align="left">Meeting identity</th><td>${escapeHtml(meetingIdentity)}</td></tr><tr><th align="left">Meeting reference</th><td>${escapeHtml(meetingName)}</td></tr><tr><th align="left">Meeting title</th><td>${escapeHtml(meetingTitle)}</td></tr><tr><th align="left">Date</th><td>${escapeHtml(meetingDate||"Not recorded")}</td></tr><tr><th align="left">Time</th><td>${escapeHtml(meetingTime||"Not recorded")}</td></tr><tr><th align="left">Platform</th><td>${escapeHtml(meetingPlatform)}</td></tr><tr><th align="left">Platform access</th><td>${platformUrl?`<a href="${escapeHtml(platformUrl)}">Open ${escapeHtml(meetingPlatform)} platform</a>`:"Not recorded"}</td></tr><tr><th align="left">Platform meeting ID</th><td>${escapeHtml(platformMeetingId||"Not recorded")}</td></tr><tr><th align="left">Platform passcode</th><td>${escapeHtml(platformPasscode||"Not recorded")}</td></tr><tr><th align="left">Physical venue</th><td>${escapeHtml(meetingVenue||"Not recorded")}</td></tr><tr><th align="left">Chairperson</th><td>${escapeHtml(meetingChairperson||"Not recorded")}</td></tr><tr><th align="left">Agenda / purpose</th><td>${escapeHtml(meetingAgenda||"Refer to the official meeting agenda")}</td></tr></tbody></table><h3>IRPA Meeting Access</h3>${usernameHtml}<p>After activating your account, open the meeting gate:</p><p><a href="${escapeHtml(gateLink)}">Open IRPA Meeting Gateway</a></p><p><strong>Meeting gate password:</strong> <code>${escapeHtml(password)}</code></p><p>This gate pass expires on ${escapeHtml(String(meetingAccess.expiresAt||"the date shown by IRPA Administration"))}. Do not forward it to another person.</p>`;
  }
  return {
    subject,
    text:`Dear ${safeName},\n\nYou have been invited to access the IRPA Digital Board Governance System workspace.\n\nOpen the invitation link to create your password and activate your account:\n${safeLink}\n\nAfter activation, you can sign in directly to your IRPA workspace.${meetingText}\n\nIf you did not expect this email, please contact IRPA Administration.`,
    html:`<p>Dear ${escapeHtml(safeName)},</p><p>You have been invited to access the IRPA Digital Board Governance System workspace.</p><p>Open the invitation link below to create your password and activate your account:</p><p><a href="${escapeHtml(safeLink)}">Activate My Account</a></p><p>After activation, you can sign in directly to your IRPA workspace.</p>${meetingHtml}<p>If you did not expect this email, please contact IRPA Administration.</p>`
  };
}
export async function sendInvitationEmail({email,name,link,meetingAccess=null,smtpSend,logger=console,sleep}) {
  const to=validateRecipient(email);
  if(!to) throw new Error("Invalid recipient");
  const message=buildInvitationMessage({name,link,meetingAccess,username:to});
  return sendWithRetry(()=>smtpSend({to,...message}),{logger,sleep});
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
