const PROJECT_ID = "irpa-digital-board-governance";
const FIREBASE_API_KEY = "AIzaSyC2aMdxHD14nMnGiRyf4mSL1ixXdzBoOtE";
const ALLOWED_ORIGINS = new Set([
  "https://irpa-digital-board-governance.web.app",
  "https://irpa-digital-board-governance-frontend.irpa-governance.workers.dev"
]);
const LANGUAGES = {
  sw: {label:"Kiswahili", model:"sw"},
  en: {label:"English", model:"en"},
  fr: {label:"French", model:"fr"},
  es: {label:"Spanish", model:"es"},
  pt: {label:"Portuguese", model:"pt"},
  ar: {label:"Arabic", model:"ar"},
  hi: {label:"Hindi", model:"hi"},
  zh: {label:"Chinese (Simplified)", model:"zh"},
  de: {label:"German", model:"de"},
  it: {label:"Italian", model:"it"},
  ja: {label:"Japanese", model:"ja"},
  maa: {label:"Maa (dictionary-assisted)", model:null}
};
const SOURCE_LANGUAGES = {
  "en":"en","en-TZ":"en","en-US":"en","en-GB":"en","sw":"sw","sw-TZ":"sw","fr":"fr","fr-FR":"fr",
  "es-ES":"es","pt-PT":"pt","ar-SA":"ar","hi-IN":"hi","zh-CN":"zh","maa":"maa"
};
function json(data,status=200,origin="") {
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","vary":"Origin"};
  if(origin && ALLOWED_ORIGINS.has(origin)){headers["access-control-allow-origin"]=origin;headers["access-control-allow-headers"]="authorization,content-type";headers["access-control-allow-methods"]="POST,OPTIONS";}
  return new Response(JSON.stringify(data),{status,headers});
}
function field(v){if(!v)return null;if("stringValue"in v)return v.stringValue;if("booleanValue"in v)return v.booleanValue;if("integerValue"in v)return Number(v.integerValue);if("arrayValue"in v)return(v.arrayValue.values||[]).map(field);if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,field(x)]));return null;}
function fields(doc){return Object.fromEntries(Object.entries(doc?.fields||{}).map(([k,v])=>[k,field(v)]));}
async function firebaseUser(idToken){
  const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+FIREBASE_API_KEY,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})});
  if(!r.ok)throw Object.assign(new Error("Firebase sign-in is required. Please sign in again."),{status:401});
  const user=(await r.json()).users?.[0];
  if(!user?.localId)throw Object.assign(new Error("Firebase identity could not be verified."),{status:401});
  return {uid:user.localId,email:String(user.email||"").toLowerCase()};
}
async function firestoreGet(path,idToken){
  const r=await fetch("https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents/"+path,{headers:{authorization:"Bearer "+idToken}});
  if(r.status===404)return null;
  if(!r.ok)throw Object.assign(new Error("Firestore denied access to the meeting context."),{status:r.status===401?401:403});
  return fields(await r.json());
}
async function firestoreQuery(collectionName,meetingId,idToken,extraField,extraValue){
  const structuredQuery={from:[{collectionId:collectionName}],where:{fieldFilter:{field:{fieldPath:"meetingId"},op:"EQUAL",value:{stringValue:meetingId}}},limit:100};
  if(extraField)structuredQuery.where={compositeFilter:{op:"AND",filters:[structuredQuery.where,{fieldFilter:{field:{fieldPath:extraField},op:"EQUAL",value:{stringValue:extraValue}}}]}};
  const r=await fetch("https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents:runQuery",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+idToken},body:JSON.stringify({structuredQuery})});
  if(!r.ok)return [];
  const rows=await r.json();
  return (Array.isArray(rows)?rows:[]).filter(x=>x.document).map(x=>({id:x.document.name.split("/").pop(),...fields(x.document)}));
}
async function authorizeMeeting(meetingId,user,idToken){
  const meeting=await firestoreGet("meetings/"+encodeURIComponent(meetingId),idToken);
  if(!meeting)throw Object.assign(new Error("Meeting not found or access denied."),{status:404});
  const manager=String(meeting.chairpersonUid||"")===user.uid||String(meeting.secretaryUid||"")===user.uid||String(meeting.createdByUid||"")===user.uid||String(meeting.initiatorUid||"")===user.uid||
    [meeting.chairpersonEmail,meeting.secretaryEmail,meeting.initiatorEmail].some(v=>String(v||"").toLowerCase()===user.email);
  const listed=["participantUids","attendeeUids","memberUids","invitedUids","subscriberUids"].some(k=>Array.isArray(meeting[k])&&meeting[k].includes(user.uid));
  let participant=listed||manager;
  if(!participant){
    const [participants,subscriptions]=await Promise.all([
      firestoreQuery("participants",meetingId,idToken),
      firestoreQuery("meetingSubscriptions",meetingId,idToken)
    ]);
    participant=participants.some(p=>!["cancelled","canceled","revoked","removed","inactive","closed"].includes(String(p.status||p.registrationStatus||"").toLowerCase())&&
      [p.uid,p.userId,p.participantUid,p.memberUid,p.invitedUid].some(v=>String(v||"")===user.uid)&&
      !["cancelled","canceled","revoked","removed","inactive","closed"].includes(String(p.status||p.registrationStatus||"").toLowerCase()) ||
      !["cancelled","canceled","revoked","removed","inactive","closed"].includes(String(p.status||p.registrationStatus||"").toLowerCase())&&
      [p.email,p.participantEmail,p.invitedEmail].some(v=>String(v||"").toLowerCase()===user.email)) ||
      subscriptions.some(s=>[s.uid,s.subscriberUid,s.userId].some(v=>String(v||"")===user.uid)||String(s.email||"").toLowerCase()===user.email);
  }
  if(!participant)throw Object.assign(new Error("Only authorised participants, subscribers, chairpersons or secretaries may use the live interpreter for this meeting."),{status:403});
  return meeting;
}
import {dictionaryTranslate} from "./maaDictionary.js";
const TRANSLATION_REVIEWER_ROLES = new Set([
  "Executive Director","Director Outreach","Director Community Development",
  "Director Research","Research Director","Research Officer",
  "Director Human Resources","HR Director"
]);
function hasInstitutionalRole(record){
  if(!record)return false;
  const roles=[record.role,...(Array.isArray(record.roles)?record.roles:[]),...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),...(Array.isArray(record.selectedRoles)?record.selectedRoles:[])].map(v=>String(v||"").trim());
  const active=[record.status,record.registrationStatus,record.employmentStatus].some(value=>["active","activated"].includes(String(value||"").toLowerCase()));
  return active&&roles.some(role=>TRANSLATION_REVIEWER_ROLES.has(role));
}
async function authorizeDocumentTranslation(requestId,user,idToken){
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(requestId))throw Object.assign(new Error("A valid document translation request ID is required."),{status:400});
  const request=await firestoreGet("documentTranslationRequests/"+requestId,idToken);
  if(!request)throw Object.assign(new Error("Document translation request not found or access denied."),{status:404});
  if(String(request.status||"")!=="IN_REVIEW"||request.contentTransferAuthorized!==true)throw Object.assign(new Error("The request must be placed in review and content-transfer consent recorded before translation."),{status:409});
  const owner=String(request.documentOwnerUid||"")===user.uid&&String(request.requestedByUid||"")===user.uid;
  const [admin,member,employee]=await Promise.all([
    firestoreGet("adminProfiles/"+user.uid,idToken).catch(()=>null),
    firestoreGet("members/"+user.uid,idToken).catch(()=>null),
    firestoreGet("employees/"+user.uid,idToken).catch(()=>null)
  ]);
  const reviewer=Boolean(admin?.active===true)||user.email==="irpa2412@gmail.com"||hasInstitutionalRole(member)||hasInstitutionalRole(employee);
  if(!owner&&!reviewer)throw Object.assign(new Error("Only the document owner or an authorised translation reviewer may process this request."),{status:403});
  if(["Confidential","Restricted"].includes(String(request.documentClassification||""))&&(!reviewer||request.restrictedTransferAuthorized!==true))throw Object.assign(new Error("Confidential/Restricted content requires an authorised reviewer or administrator and recorded institutional transfer approval."),{status:403});
  return request;
}

export default {
  async fetch(request,env){
    const origin=request.headers.get("origin")||"";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST,OPTIONS","access-control-max-age":"86400","vary":"Origin"}});
    const url=new URL(request.url);
    if(url.pathname==="/health")return json({ok:true,service:"IRPA live AI interpreter",provider:"Cloudflare Workers AI",auth:"Firebase ID token",meetingAuthorization:"required"},200,origin);
    if(!["/api/translate","/api/document-translate"].includes(url.pathname)||request.method!=="POST")return json({ok:false,error:"Not found."},404,origin);
    if(!ALLOWED_ORIGINS.has(origin))return json({ok:false,error:"Origin is not allowed."},403,"");
    try{
      const authorization=request.headers.get("authorization")||"";
      const idToken=authorization.startsWith("Bearer ")?authorization.slice(7).trim():"";
      if(!idToken)throw Object.assign(new Error("Firebase sign-in is required."),{status:401});
      const body=await request.json();
      const isDocumentRequest=url.pathname==="/api/document-translate";
      const meetingId=String(body.meetingId||"").trim();
      const requestId=String(body.requestId||"").trim();
      const content=String(body.content||"").trim();
      const targetCode=String(body.targetLanguage||"").toLowerCase();
      const target=LANGUAGES[targetCode];
      const source=SOURCE_LANGUAGES[String(body.sourceLanguage||"")]||"en";
      if(!content||content.length>2500)throw Object.assign(new Error("Translation chunks must contain 1–2,500 characters."),{status:400});
      if(!target)throw Object.assign(new Error("The requested target language is not supported."),{status:400});
      const user=await firebaseUser(idToken);
      let documentRequest=null;
      if(isDocumentRequest){
        documentRequest=await authorizeDocumentTranslation(requestId,user,idToken);
        if(String(documentRequest.targetLanguage||"").toLowerCase()!==targetCode)throw Object.assign(new Error("Target language must match the document owner's request."),{status:403});
        const requestedSource=String(documentRequest.sourceLanguage||"AUTO");
        if(!["AUTO","other",""].includes(requestedSource)){
          const requestedCode=SOURCE_LANGUAGES[requestedSource]||requestedSource;
          if(requestedCode!==source)throw Object.assign(new Error("Source language must match the document owner's request."),{status:403});
        }
      }else{
        if(!meetingId||!/^[A-Za-z0-9_-]{1,160}$/.test(meetingId))throw Object.assign(new Error("A valid meeting ID is required."),{status:400});
        await authorizeMeeting(meetingId,user,idToken);
      }
      if(source==="maa"||targetCode==="maa"){
        if(targetCode==="maa"&&!["en","sw"].includes(source))throw Object.assign(new Error("Maa dictionary-assisted output requires English or Kiswahili source text."),{status:400});
        if(source==="maa"&& !["en","sw"].includes(targetCode))throw Object.assign(new Error("Maa source text currently supports English or Kiswahili targets only."),{status:400});
        const result=dictionaryTranslate(content,source,targetCode);
        return json({ok:true,translatedText:result.translatedText,targetLanguage:targetCode,sourceLanguage:source,provider:"IRPA Maa Dictionary · provisional glossary",dictionaryAssisted:true,matchedTerms:result.matchedTerms,coverage:result.coverage,requiresHumanReview:true,requestId:isDocumentRequest?requestId:undefined,notice:"This starter glossary does not translate Maa grammar or unknown words. Validate with a Kisonko Maa speaker before official use."},200,origin);
      }
      if(source===target.model)return json({ok:true,translatedText:content,targetLanguage:body.targetLanguage,provider:"Cloudflare Workers AI",unchanged:true,requiresHumanReview:true,requestId:isDocumentRequest?requestId:undefined},200,origin);
      if(!env.AI||typeof env.AI.run!=="function")throw Object.assign(new Error("Cloudflare Workers AI binding is not configured."),{status:503});
      const result=await env.AI.run("@cf/meta/m2m100-1.2b",{text:content,source_lang:source,target_lang:target.model});
      const translatedText=String(result?.translated_text||result?.translation||"").trim();
      if(!translatedText)throw new Error("The AI model returned no translated text.");
      return json({ok:true,translatedText,targetLanguage:body.targetLanguage,sourceLanguage:source,provider:"Cloudflare Workers AI · M2M100",requiresHumanReview:true,requestId:isDocumentRequest?requestId:undefined},200,origin);
    }catch(error){
      const status=Number(error?.status)||(/rate limit/i.test(String(error?.message||""))?429:503);
      if(status>=500)console.error("IRPA interpreter request failed",String(error?.message||error));
      return json({ok:false,error:status===503?"The live interpreter is temporarily unavailable. Please retry the phrase.":String(error?.message||"Interpreter request failed.")},status,origin);
    }
  }
};
