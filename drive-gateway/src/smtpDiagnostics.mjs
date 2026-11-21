import { classifySmtpReplyCategory, buildRawMailMimeMessage, validateRecipient } from "./invitationEmail.mjs";

const REQUIRED_STAGES = Object.freeze(["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]);
const REPLY_CATEGORIES = Object.freeze(["ACCEPTED","RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"]);

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
    const fields=profile?.fields||{};
    const active=fields.active?.booleanValue===true;
    const role=String(fields.role?.stringValue||"").trim().toLowerCase();
    const owner=fields.isOwner?.booleanValue===true||role==="owner"||fields.authorizationType?.stringValue==="owner";
    const admin=role==="administrator";
    if(!active||(!admin&&!owner)) return json({ok:false,error:"Administrator or system owner authorization is required."},403,corsHeaders(request));

    const body=await request.json().catch(()=>({}));
    const to=validateRecipient(body?.to||body?.email);
    if(!to)return json({ok:false,error:"Enter a valid test recipient email address."},400,corsHeaders(request));
    const from=validateRecipient(env?.SMTP_FROM||"info@irpa.or.tz");
    if(!from)return json({ok:false,error:"The configured sender address is invalid."},503,corsHeaders(request));
    const messageId="<"+crypto.randomUUID()+"@irpa.or.tz>";
    const date=new Date().toUTCString();
    const subject="IRPA SMTP self-check "+new Date().toISOString();
    const text="This is an administrator-requested SMTP delivery self-check for the IRPA Digital Board Governance System. It tests the configured sender and SMTP route only; acceptance by the mail server does not confirm inbox delivery.";
    const html="<p>This is an administrator-requested SMTP delivery self-check for the IRPA Digital Board Governance System.</p><p>It tests the configured sender and SMTP route only; acceptance by the mail server does not confirm inbox delivery.</p>";
    let rawMime;
    try{rawMime=buildRawMailMimeMessage({fromName:"IRPA Digital Signing",from,replyTo:from,to,subject,text,html,messageId,date});}
    catch{return json({ok:false,error:"The SMTP self-check message could not be built.",stageCode:"BUILD_MESSAGE",messageId},400,corsHeaders(request));}

    const stages=[];
    const onStage=async(stageCode,outcome,smtpReplyCategory="UNKNOWN",details={})=>{
      if(!REQUIRED_STAGES.includes(stageCode))return;
      const category=REPLY_CATEGORIES.includes(smtpReplyCategory)?smtpReplyCategory:"UNKNOWN";
      const stage={
        stageCode,
        outcome,
        smtpReplyCategory:category,
        at:new Date().toISOString(),
        messageId:details.messageId||messageId,
        ...(Number.isInteger(details.smtpReplyCode)?{smtpReplyCode:details.smtpReplyCode}:{}),
        ...(details.smtpReply?{smtpReply:String(details.smtpReply).replace(/[\r\n]+/g," ").slice(0,180)}:{})
      };
      stages.push(stage);
      await writeAudit(env,claims,stage);
    };
    try {
      const smtpReply=await smtpSend(env,{to,subject,text,html,rawMime,messageId,date,onStage});
      const submit=[...stages].reverse().find(stage=>stage.stageCode==="SUBMIT")||null;
      return json({
        ok:true,
        acceptedByMailServer:true,
        deliveryMeaning:"Accepted by the mail server is not proof of inbox delivery.",
        messageId,
        smtpReply:String(submit?.smtpReply||smtpReply||"").slice(0,180),
        smtpReplyCode:submit?.smtpReplyCode||Number(String(smtpReply||"").slice(0,3))||null,
        stages
      },200,corsHeaders(request));
    } catch(error) {
      const stageCode=REQUIRED_STAGES.includes(error?.stageCode)?error.stageCode:"SUBMIT";
      const smtpReplyCategory=REPLY_CATEGORIES.includes(error?.smtpReplyCategory)?error.smtpReplyCategory:classifySmtpReplyCategory(error,stageCode);
      return json({
        ok:false,
        error:"SMTP self-check failed.",
        stageCode,
        smtpReplyCategory,
        smtpReplyCode:error?.smtpResponseCode||null,
        smtpReply:error?.smtpReply||null,
        messageId,
        stages
      },502,corsHeaders(request));
    }
  };
}

export { REQUIRED_STAGES as SMTP_SELF_CHECK_STAGES, REPLY_CATEGORIES as SMTP_REPLY_CATEGORIES };
