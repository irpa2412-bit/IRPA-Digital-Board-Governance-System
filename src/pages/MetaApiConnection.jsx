import React,{useCallback,useEffect,useState} from "react";
import {auth,firebaseConfig} from "../firebase/config";

const GATEWAY_URL=String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_STAGING_URL||"https://irpa-google-drive-gateway-staging.irpa-governance.workers.dev").replace(/\/+$/,"");
const panel={background:"var(--surface, #fff)",color:"var(--text-primary, #172033)",border:"1px solid var(--border-color, #d6dee8)",borderRadius:12,padding:14,minWidth:0};
const button={padding:"10px 13px",borderRadius:9,border:"1px solid var(--border-color, #cbd5e1)",background:"var(--surface-elevated, #f8fafc)",color:"var(--text-primary, #172033)",font:"inherit",fontWeight:700,cursor:"pointer"};
function stagingGateway(){
 const url=new URL(GATEWAY_URL);
 if(url.protocol!=="https:"||url.hostname!=="irpa-google-drive-gateway-staging.irpa-governance.workers.dev")throw new Error("Meta connection is restricted to the dedicated staging Cloudflare gateway.");
 return url.toString().replace(/\/$/,"");
}
function MetaApiConnectionPanel(){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const request=useCallback(async(path,method="GET")=>{
  const user=auth.currentUser;
  if(!user)throw new Error("Sign in to the IRPA staging portal first.");
  const token=await user.getIdToken();
  const response=await fetch(stagingGateway()+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},redirect:"error",cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||"The staging Meta API request failed.");
  return body;
 },[]);
 const refresh=useCallback(async()=>{
  setError("");
  try{setStatus(await request("/api/communications/meta/status"))}
  catch(e){setStatus(null);setError(e.message||"Unable to verify the staging Meta connection.")}
 },[request]);
 useEffect(()=>{refresh()},[refresh]);
 async function connect(){
  if(busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   const result=await request("/api/communications/meta/connect","POST");
   const target=new URL(result.authorizationUrl);
   if(target.protocol!=="https:"||target.hostname!=="www.facebook.com")throw new Error("The authorization destination failed validation.");
   setNotice("Opening Meta authorization. Grant only the requested read permissions.");
   window.location.assign(target.toString());
  }catch(e){setError(e.message||"Unable to start Meta authorization.");setBusy(false)}
 }
 return <section style={{...panel,display:"grid",gap:9}} aria-labelledby="meta-api-connection-heading">
  <h4 id="meta-api-connection-heading" style={{margin:0}}>Meta API connection — staging only</h4>
  <p style={{margin:0}}>Connect IRPA's Facebook Pages and linked Instagram professional accounts for read-access verification through the existing Cloudflare gateway. Only these permissions are requested: <code>pages_show_list</code>, <code>pages_read_engagement</code>, and <code>instagram_basic</code>.</p>
  <p style={{margin:0,fontSize:13,fontWeight:700}}>Social posting is disabled. No publishing, messaging, comments management, ads, or insights access is requested.</p>
  {status?.connected?<div style={{display:"grid",gap:5}}>
   <strong>API connection verified · {status.metaUser?.name||"Meta user"}</strong>
   <span style={{fontSize:13}}>Last checked: {status.verifiedAt||"Not recorded"}</span>
   <span style={{fontSize:13}}>Facebook Pages: {status.facebookPages?.length||0} · Linked Instagram professional accounts: {status.instagramAccounts?.length||0}</span>
   <span style={{fontSize:13}}>Granted read permissions: {(status.grantedPermissions||[]).join(", ")||"none"}</span>
   {(status.missingPermissions||[]).length>0&&<span role="alert" style={{fontSize:13}}>Missing required permissions: {status.missingPermissions.join(", ")}</span>}
   {status.facebookPages?.map(page=><div key={page.id} style={{fontSize:13}}>Facebook: {page.name}{page.instagramLinked?" · Instagram linked":""}</div>)}
   {status.instagramAccounts?.map(account=><div key={account.id} style={{fontSize:13}}>Instagram: @{account.username||account.id} · Page: {account.linkedFacebookPage}</div>)}
  </div>:<p style={{margin:0,fontSize:13}}>No verified Meta connection is currently available for this signed-in account.</p>}
  {error&&<p role="alert" style={{margin:0,color:"var(--danger, #b91c1c)"}}>{error}</p>}
  {notice&&<p role="status" style={{margin:0}}>{notice}</p>}
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
   <button type="button" disabled={busy} style={{...button,opacity:busy ? 0.65 : 1}} onClick={connect}>{busy?"Connecting…":status?.connected?"Reconnect Meta account":"Connect Meta account"}</button>
   <button type="button" disabled={busy} style={button} onClick={refresh}>Verify API access</button>
  </div>
  <small style={{opacity:.8}}>Tokens remain encrypted in the staging Worker KV store and are never returned to this page. This control is not a publishing approval.</small>
 </section>
}

export default function MetaApiConnection(){
 if(firebaseConfig.projectId!=="irpa-dbg-staging-a73ec")return null;
 return <MetaApiConnectionPanel />;
}
