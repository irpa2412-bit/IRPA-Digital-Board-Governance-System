// drive-gateway/src/invitationEmail.mjs
// Isolated member invitation sender. Caller authorization remains in the Worker route.

const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
const CRLF_RE = /[\r\n\u2028\u2029]/;
const SUBJECT = "Invitation to the IRPA Digital Board Governance System";

export function validateRecipient(email) {
  if (typeof email !== "string") return null;
  const v = email.trim();
  if (!v || v.length > 254 || CRLF_RE.test(v) || !EMAIL_RE.test(v)) return null;
  return v;
}
export function validateName(name) {
  if (name === undefined || name === null || name === "") return "Member";
  if (typeof name !== "string" || name.length > 100 || CRLF_RE.test(name)) return null;
  return name.trim() || "Member";
}
export function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
export async function sendWithRetry(fn, opts = {}) {
  const { attempts=3, delayMs=300, logger=console, shouldRetry=()=>true, sleep=(ms)=>new Promise(r=>setTimeout(r,ms)) }=opts;
  let lastErr;
  for(let i=1;i<=attempts;i++){
    try{return await fn(i);}
    catch(e){
      lastErr=e;
      if(i===attempts||!shouldRetry(e)) break;
      await sleep(delayMs*2**(i-1));
    }
  }
  throw lastErr;
}
export function buildInvitationMessage({name,link,meetingAccess=null}) {
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
    if(!meetingName||!password||password.length>32||CRLF_RE.test(password))throw new Error("Invalid meeting access details");
    const detail=(value,max=240)=>String(value??"").replace(/[\r\n\u2028\u2029]+/g," ").trim().slice(0,max);
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
    meetingText=`\n\nREGISTERED MEETING PARTICULARS\nMeeting reference: ${meetingName}\nMeeting title: ${meetingTitle}\nDate: ${meetingDate||"Not recorded"}\nTime: ${meetingTime||"Not recorded"}\nPlatform: ${meetingPlatform}\nPlatform access URL: ${platformUrl||"Not recorded"}\nPlatform meeting ID: ${platformMeetingId||"Not recorded"}\nPlatform passcode: ${platformPasscode||"Not recorded"}\nPhysical venue: ${meetingVenue||"Not recorded"}\nChairperson: ${meetingChairperson||"Not recorded"}\nAgenda / purpose: ${meetingAgenda||"Refer to the official meeting agenda"}\n\nMEETING ACCESS\nOpen the IRPA meeting gate after activating your account: ${gateLink}\nMeeting gate password: ${password}\nThis gate pass expires on ${String(meetingAccess.expiresAt||"the date shown by IRPA Administration")}. Do not forward it to another person.`;
    meetingHtml=`<hr><h3>Registered Meeting Particulars</h3><table><tbody><tr><th align="left">Meeting reference</th><td>${escapeHtml(meetingName)}</td></tr><tr><th align="left">Meeting title</th><td>${escapeHtml(meetingTitle)}</td></tr><tr><th align="left">Date</th><td>${escapeHtml(meetingDate||"Not recorded")}</td></tr><tr><th align="left">Time</th><td>${escapeHtml(meetingTime||"Not recorded")}</td></tr><tr><th align="left">Platform</th><td>${escapeHtml(meetingPlatform)}</td></tr><tr><th align="left">Platform access</th><td>${platformUrl?`<a href="${escapeHtml(platformUrl)}">Open ${escapeHtml(meetingPlatform)} platform</a>`:"Not recorded"}</td></tr><tr><th align="left">Platform meeting ID</th><td>${escapeHtml(platformMeetingId||"Not recorded")}</td></tr><tr><th align="left">Platform passcode</th><td>${escapeHtml(platformPasscode||"Not recorded")}</td></tr><tr><th align="left">Physical venue</th><td>${escapeHtml(meetingVenue||"Not recorded")}</td></tr><tr><th align="left">Chairperson</th><td>${escapeHtml(meetingChairperson||"Not recorded")}</td></tr><tr><th align="left">Agenda / purpose</th><td>${escapeHtml(meetingAgenda||"Refer to the official meeting agenda")}</td></tr></tbody></table><h3>IRPA Meeting Access</h3><p>After activating your account, open the meeting gate:</p><p><a href="${escapeHtml(gateLink)}">Open IRPA Meeting Gateway</a></p><p><strong>Meeting gate password:</strong> <code>${escapeHtml(password)}</code></p><p>This gate pass expires on ${escapeHtml(String(meetingAccess.expiresAt||"the date shown by IRPA Administration"))}. Do not forward it to another person.</p>`;
  }
  return {
    subject,
    text:`Dear ${safeName},\\n\\nYou have been invited to access the IRPA Digital Board Governance System workspace.\\n\\nOpen the invitation link to create your password and activate your account:\\n${safeLink}\\n\\nAfter activation, you can sign in directly to your IRPA workspace.${meetingText}\\n\\nIf you did not expect this email, please contact IRPA Administration.`,
    html:`<p>Dear ${escapeHtml(safeName)},</p><p>You have been invited to access the IRPA Digital Board Governance System workspace.</p><p>Open the invitation link below to create your password and activate your account:</p><p><a href="${escapeHtml(safeLink)}">Activate My Account</a></p><p>After activation, you can sign in directly to your IRPA workspace.</p>${meetingHtml}<p>If you did not expect this email, please contact IRPA Administration.</p>`
  };
}
export async function sendInvitationEmail({email,name,link,meetingAccess=null,smtpSend,logger=console,sleep}) {
  const to=validateRecipient(email);
  if(!to) throw new Error("Invalid recipient");
  const message=buildInvitationMessage({name,link,meetingAccess});
  return sendWithRetry(()=>smtpSend({to,...message}),{logger,sleep});
}


export async function handleSendInvitationEmail(request, env, deps = {}) {
  const { smtpSend, logger = console, sleep } = deps;
  const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" }
  });
  const supplied = request.headers.get("x-irpa-service-key");
  const expected = env?.INVITE_SERVICE_KEY;
  if (!supplied || !expected || supplied !== expected) return json(401, { ok:false, error:"Unauthorized" });

  let body;
  try { body = await request.json(); } catch { return json(400, { ok:false, error:"Invalid JSON" }); }

  const to = validateRecipient(body?.to);
  if (!to) return json(400, { ok:false, error:"Invalid recipient" });
  const name = validateName(body?.name);
  if (!name) return json(400, { ok:false, error:"Invalid name" });

  let link;
  try {
    const u = new URL(body?.link);
    const allowed = new URL(env.IRPA_APP_URL);
    if (u.protocol !== "https:" || u.origin !== allowed.origin) throw new Error("origin");
    link = u.toString();
  } catch { return json(400, { ok:false, error:"Invalid link" }); }

  const store = env.DRIVE_KV;
  if (store) {
    const key = "invite-rate:" + to.toLowerCase();
    const count = Number((await store.get(key)) || 0);
    if (count >= 5) return json(429, { ok:false, error:"Too many invitations to this address" });
    await store.put(key, String(count + 1), { expirationTtl: 3600 });
  }

  const message = buildInvitationMessage({ name, link });
  try {
    const result = await sendWithRetry(
      () => smtpSend(env, { to, ...message }),
      { logger, sleep }
    );
    return json(200, { ok:true, messageId:result?.messageId || result || null });
  } catch (error) {
    logger.error("SIGNATURE_INVITATION_PROVIDER_FAILED", {
      recipientDomain: to.split("@")[1] || "unknown",
      message: String(error?.message || error).slice(0, 200)
    });
    return json(502, { ok:false, error:"EMAIL_PROVIDER_FAILED" });
  }
}
