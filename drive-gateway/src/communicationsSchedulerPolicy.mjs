import { publishingGate } from "./communicationsPortalIntegrationGate.mjs";
export function selectDueCommunicationItems(items, { env={}, now=Date.now() }={}) {
 if(String(env.COMMUNICATIONS_SCHEDULER_ENABLED||"false")!=="true") return {items:[],reason:"Scheduler feature flag is disabled."};
 if(String(env.COMMUNICATIONS_PUBLISHING_ENABLED||"false")!=="true" || String(env.COMMUNICATIONS_PAUSE_ALL||"true")!=="false") return {items:[],reason:"Publishing disabled or global pause active."};
 const due=(Array.isArray(items)?items:[]).filter(item=>item?.status==="Approved"&&item?.approvedBy&&item?.approvedAt&&item?.scheduledAt&&Number.isFinite(Date.parse(item.scheduledAt))&&Date.parse(item.scheduledAt)<=now);
 return {items:due,reason:due.length?"Approved scheduled items are due; each item still requires an authenticated service actor and provider verification.":"No approved scheduled items are due."};
}
export function schedulerRunLog({startedAt=new Date().toISOString(),endedAt=new Date().toISOString(),status="FAIL",reason="Not executed",checked=0,published=0}={}) {
 return {type:"communications_scheduler_run",startedAt,endedAt,status,reason,checked,published,externalPublishingEnabled:false};
}
