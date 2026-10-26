import { SOCIAL_PROVIDER_MANIFEST, socialProviderStatus } from "./socialProviderManifest.mjs";
export function communicationsPortalSelfTest({env={},routes=[],scheduled=false}={}){
 const results=[];
 for(const r of routes) results.push({name:String(r.name||r.path||"route"),status:r.status==="PASS"?"PASS":"FAIL",reason:String(r.reason||"Route has not been exercised against a live Worker.")});
 for(const platform of Object.keys(SOCIAL_PROVIDER_MANIFEST)){const s=socialProviderStatus(env,platform);results.push({name:s.label+" connection",status:s.status==="credentials_configured_unverified"?"FAIL":"FAIL",reason:s.reason,missingSecrets:s.missingSecrets||[]});}
 results.push({name:"scheduler",status:scheduled?"PASS":"FAIL",reason:scheduled?"Scheduler execution observed.":"Scheduler execution has not been verified; no scheduled publication claimed."});
 results.push({name:"global pause",status:String(env.COMMUNICATIONS_PAUSE_ALL||"true")!=="false"?"PASS":"FAIL",reason:String(env.COMMUNICATIONS_PAUSE_ALL||"true")!=="false"?"Pause defaults to active.":"Publishing pause appears disabled; verify authorization before use."});
 return {ok:results.every(r=>r.status==="PASS"),results};
}
