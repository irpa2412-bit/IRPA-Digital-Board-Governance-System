import { classifySmtpReplyCategory } from "./invitationEmail.mjs";

const REQUIRED_STAGES = Object.freeze(["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]);
const REPLY_CATEGORIES = Object.freeze(["RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"]);

export function createSmtpSelfcheckRoute({authenticateFirebaseRequest,getFirestoreDocument,smtpSend,writeAudit,json,corsHeaders}) {
  return async function smtpSelfcheckRoute(request,env) {
    let claims;
    try { claims = await authenticateFirebaseRequest(request,env); }
    catch(error) { return json({ok:false,error:"Firebase authentication is required."},Number(error?.status)||401,corsHeaders(request)); }

    const uid=String(claims?.user_id||"").trim();
    if(!uid) return json({ok:false,error:"Administrator authorization is required."},403,corsHeaders(request));
    let profile;
    try { profile=await getFirestoreDocument(env,"adminProfiles/"+uid,claims.token); }
    catch { return json({ok:false,error:"Administrator authorization could not be verified."},403,corsHeaders(request)); }
    const activeAdmin=profile?.fields?.active?.booleanValue===true && profile?.fields?.role?.stringValue==="Administrator";
    if(!activeAdmin) return json({ok:false,error:"Administrator authorization is required."},403,corsHeaders(request));

    const stages=[];
    const onStage=async(stageCode,outcome,smtpReplyCategory="UNKNOWN")=>{
      if(!REQUIRED_STAGES.includes(stageCode))return;
      const category=REPLY_CATEGORIES.includes(smtpReplyCategory)?smtpReplyCategory:"UNKNOWN";
      stages.push({stageCode,outcome,smtpReplyCategory:category});
      await writeAudit(env,claims,{stageCode,outcome,smtpReplyCategory:category});
    };
    try {
      await smtpSend(env,{
        to:"info@irpa.or.tz",
        subject:"IRPA SMTP delivery self-check",
        text:"This is an administrator-requested SMTP delivery self-check for the IRPA Digital Board Governance System.",
        html:"<p>This is an administrator-requested SMTP delivery self-check for the IRPA Digital Board Governance System.</p>",
        onStage
      });
      return json({ok:true,stageCode:"SUBMIT",smtpReplyCategory:"UNKNOWN",stages},200,corsHeaders(request));
    } catch(error) {
      const stageCode=REQUIRED_STAGES.includes(error?.stageCode)?error.stageCode:"SUBMIT";
      const smtpReplyCategory=REPLY_CATEGORIES.includes(error?.smtpReplyCategory)?error.smtpReplyCategory:classifySmtpReplyCategory(error,stageCode);
      return json({ok:false,error:"SMTP self-check failed.",stageCode,smtpReplyCategory,stages},502,corsHeaders(request));
    }
  };
}

export { REQUIRED_STAGES as SMTP_SELF_CHECK_STAGES, REPLY_CATEGORIES as SMTP_REPLY_CATEGORIES };
