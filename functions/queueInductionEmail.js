// functions/queueInductionEmail.js
// CommonJS bridge for the existing functions/index.js runtime.
async function retry(fn, { attempts = 3, delayMs = 300, logger = console, shouldRetry = () => true, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) {
      lastErr = e; logger.error("invitation gateway attempt failed", { attempt:i, status:e?.status||null, message:String(e?.message||e).slice(0,200) });
      if (i === attempts || !shouldRetry(e)) break;
      await sleep(delayMs * 2 ** (i - 1));
    }
  } throw lastErr;
}
function cleanError(error){ return String(error?.message||error).replace(/[\r\n]/g," ").slice(0,200); }
async function queueInductionEmail(inputOrEmail, subjectOrOptions, text, html, options = {}) {
  const legacy = typeof inputOrEmail === "string";
  if (!legacy && subjectOrOptions && typeof subjectOrOptions === "object") options = subjectOrOptions;
  const input = legacy ? { recipientEmail: inputOrEmail, subject: subjectOrOptions, text, html, invitedByUid:null } : (inputOrEmail || {});
  const { db, invitationId, recipientEmail, recipientName, invitedByUid, logger=console, fetchFn=fetch, env=process.env, sleep=(ms)=>new Promise(r=>setTimeout(r,ms)) } = options;
  const firestore = db || input.db || require("firebase-admin/firestore").getFirestore();
  if (!recipientEmail && input.recipientEmail) Object.assign(input,{recipientEmail:input.recipientEmail});
  const to=input.recipientEmail || recipientEmail; if(!to) throw new Error("recipientEmail is required");
  const queueRef = input.invitationId ? firestore.collection("emailQueue").doc(input.invitationId) : firestore.collection("emailQueue").doc();
  const domain=String(to).split("@")[1]||"unknown";
  await queueRef.set({status:"Queued",recipientEmail:to,invitedByUid:input.invitedByUid||invitedByUid||null,createdAt:new Date().toISOString()});
  try {
    const result=await retry(async()=>{
      const payload={to,name:input.recipientName||recipientName||"Member",subject:input.subject||subject,text:input.text||text,html:input.html||html,invitationId:input.invitationId||null};
      const res=await fetchFn(env.GATEWAY_URL+"/api/send-invitation-email",{method:"POST",headers:{"content-type":"application/json","x-irpa-service-key":env.INVITE_SERVICE_KEY},body:JSON.stringify(payload)});
      if(!res.ok){const err=new Error("Gateway responded "+res.status);err.status=res.status;throw err;} return res.json();
    },{logger,sleep,shouldRetry:(e)=>!(e?.status>=400&&e?.status<500)});
    await queueRef.update({status:"Sent",sentAt:new Date().toISOString(),messageId:result?.messageId||null});
    return {ok:true,status:"Sent",messageId:result?.messageId||null};
  } catch(e) {
    logger.error("INVITATION_EMAIL_FAILED",{recipientDomain:domain,message:cleanError(e)});
    await queueRef.update({status:"Failed",failedAt:new Date().toISOString(),errorMessage:cleanError(e)});
    return {ok:false,status:"Failed",error:cleanError(e)};
  }
}
module.exports={queueInductionEmail,retry};