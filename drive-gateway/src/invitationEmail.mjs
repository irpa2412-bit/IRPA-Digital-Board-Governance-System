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
export function buildInvitationMessage({name,link}) {
  const safeName=validateName(name);
  if(!safeName) throw new Error("Invalid name");
  const safeLink=new URL(link).toString();
  return {
    subject: SUBJECT,
    text:\`Dear \${safeName},\\n\\nYou have been invited to the IRPA Digital Board Governance System.\\nOpen this link to accept: \${safeLink}\\n\\nIf you did not expect this email, you can ignore it.\`,
    html:\`<p>Dear \${escapeHtml(safeName)},</p><p>You have been invited to the IRPA Digital Board Governance System.</p><p><a href="\${escapeHtml(safeLink)}">Accept invitation</a></p><p>If you did not expect this email, you can ignore it.</p>\`
  };
}
export async function sendInvitationEmail({email,name,link,smtpSend,logger=console,sleep}) {
  const to=validateRecipient(email);
  if(!to) throw new Error("Invalid recipient");
  const message=buildInvitationMessage({name,link});
  return sendWithRetry(()=>smtpSend({to,...message}),{logger,sleep});
}
