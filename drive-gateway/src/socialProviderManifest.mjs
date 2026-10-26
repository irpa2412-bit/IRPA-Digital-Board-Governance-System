export const SOCIAL_PROVIDER_MANIFEST = Object.freeze({
 facebook:{label:"Facebook Pages",secrets:["META_APP_ID","META_APP_SECRET","META_TOKEN_ENCRYPTION_KEY"],limit:63206,media:["image","video"],enabled:false},
 instagram:{label:"Instagram",secrets:["META_APP_ID","META_APP_SECRET","META_TOKEN_ENCRYPTION_KEY"],limit:2200,media:["image","video"],enabled:false},
 linkedin:{label:"LinkedIn",secrets:["LINKEDIN_CLIENT_ID","LINKEDIN_CLIENT_SECRET"],limit:3000,media:["image","video","document"],enabled:false},
 x:{label:"X",secrets:["X_CLIENT_ID","X_CLIENT_SECRET"],limit:280,media:["image","video"],enabled:false},
 youtube:{label:"YouTube",secrets:["YOUTUBE_CLIENT_ID","YOUTUBE_CLIENT_SECRET"],limit:5000,media:["video","thumbnail"],enabled:false},
 whatsapp:{label:"WhatsApp Business",secrets:["WHATSAPP_ACCESS_TOKEN","WHATSAPP_PHONE_NUMBER_ID"],limit:4096,media:["image","video","document"],enabled:false}
});
export function socialProviderStatus(env={},platform){
 const p=SOCIAL_PROVIDER_MANIFEST[platform];
 if(!p)return {status:"FAIL",reason:"Unknown provider."};
 const missingSecrets=p.secrets.filter(n=>!String(env[n]||"").trim());
 return {platform,label:p.label,status:missingSecrets.length?"not_connected":"credentials_configured_unverified",missingSecrets,limit:p.limit,media:p.media,automaticPublishing:false,reason:missingSecrets.length?"Missing required Worker secrets.":"Credentials are not proof of OAuth grant, account identity, scopes, or publishing API approval."};
}
export function makeManualExport(platform,text){
 const p=SOCIAL_PROVIDER_MANIFEST[platform]; if(!p)throw new Error("Unknown platform.");
 const body=String(text||"").trim(); if(!body)throw new Error("Post text is required.");
 if(body.length>p.limit)throw new Error(p.label+" text exceeds "+p.limit+" characters.");
 return {platform,text:body,mode:"manual-export",published:false,reason:"Copy and paste manually; no platform API was called."};
}
