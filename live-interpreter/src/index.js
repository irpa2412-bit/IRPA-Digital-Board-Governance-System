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
  ja: {label:"Japanese", model:"ja"}
};
const SOURCE_LANGUAGES = {
  "en-TZ":"en","en-US":"en","en-GB":"en","sw-TZ":"sw","fr-FR":"fr",
  "es-ES":"es","pt-PT":"pt","ar-SA":"ar","hi-IN":"hi","zh-CN":"zh"
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
export default {
  async fetch(request,env){
    const origin=request.headers.get("origin")||"";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST,OPTIONS","access-control-max-age":"86400","vary":"Origin"}});
    const url=new URL(request.url);
    if(url.pathname==="/health")return json({ok:true,service:"IRPA live AI interpreter",provider:"Cloudflare Workers AI",auth:"Firebase ID token",meetingAuthorization:"required"},200,origin);
    if(url.pathname!=="/api/translate"||request.method!=="POST")return json({ok:false,error:"Not found."},404,origin);
    if(!ALLOWED_ORIGINS.has(origin))return json({ok:false,error:"Origin is not allowed."},403,"");
    try{
      const authorization=request.headers.get("authorization")||"";
      const idToken=authorization.startsWith("Bearer ")?authorization.slice(7).trim():"";
      if(!idToken)throw Object.assign(new Error("Firebase sign-in is required."),{status:401});
      const body=await request.json();
      const meetingId=String(body.meetingId||"").trim();
      const content=String(body.content||"").trim();
      const target=LANGUAGES[String(body.targetLanguage||"").toLowerCase()];
      const source=SOURCE_LANGUAGES[String(body.sourceLanguage||"")]||"en";
      if(!meetingId||!/^[A-Za-z0-9_-]{1,160}$/.test(meetingId))throw Object.assign(new Error("A valid meeting ID is required."),{status:400});
      if(!content||content.length>2500)throw Object.assign(new Error("Interpreter phrases must contain 1–2,500 characters."),{status:400});
      if(!target)throw Object.assign(new Error("The requested target language is not supported."),{status:400});
      const user=await firebaseUser(idToken);
      await authorizeMeeting(meetingId,user,idToken);
      if(source===target.model)return json({ok:true,translatedText:content,targetLanguage:body.targetLanguage,provider:"Cloudflare Workers AI",unchanged:true,requiresHumanReview:true},200,origin);
      if(!env.AI||typeof env.AI.run!=="function")throw Object.assign(new Error("Cloudflare Workers AI binding is not configured."),{status:503});
      const result=await env.AI.run("@cf/meta/m2m100-1.2b",{text:content,source_lang:source,target_lang:target.model});
      const translatedText=String(result?.translated_text||result?.translation||"").trim();
      if(!translatedText)throw new Error("The AI model returned no translated text.");
      return json({ok:true,translatedText,targetLanguage:body.targetLanguage,sourceLanguage:source,provider:"Cloudflare Workers AI · M2M100",requiresHumanReview:true},200,origin);
    }catch(error){
      const status=Number(error?.status)||(/rate limit/i.test(String(error?.message||""))?429:503);
      if(status>=500)console.error("IRPA interpreter request failed",String(error?.message||error));
      return json({ok:false,error:status===503?"The live interpreter is temporarily unavailable. Please retry the phrase.":String(error?.message||"Interpreter request failed.")},status,origin);
    }
  }
};
