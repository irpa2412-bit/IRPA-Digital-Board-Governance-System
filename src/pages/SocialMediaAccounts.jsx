import React,{useEffect,useMemo,useState} from "react";
import {collection,doc,limit,onSnapshot,orderBy,query,serverTimestamp,writeBatch} from "firebase/firestore";
import {auth,db} from "../firebase/config";
import {getGoogleDriveGatewayUrl} from "../firebase/gatewayUrl";
import "../styles/social-media-accounts.css";

const PLATFORMS=["Facebook","Instagram","LinkedIn","X","YouTube","TikTok","WhatsApp","Telegram","Other"];
const ACCOUNT_TYPES=["Organization page","Public profile","Channel","Group","Messaging channel","Other"];
const STATES=["Pending Verification","Active","Suspended","Disconnected","Archived"];
const RESTORABLE_STATES=["Pending Verification","Active","Suspended","Disconnected"];
const EDITOR_ROLES=["Communication & Media","Communications & Media","Communication and Media","Communications and Media","Communications Officer","Communication Officer","Communications Manager","Communication Manager","Media Officer","Media Manager","Public Relations Officer","Communications & Media Officer","Communications and Media Officer","Media and Communications Officer","Media & Communications Officer","Director Outreach","Outreach Director","Director Community Development","Community Development Director","Executive Director"];
const REVIEW_ROLES=["Executive Director","Director Outreach","Outreach Director","Director Community Development","Community Development Director"];
const clean=v=>String(v??"").trim();
const panel={background:"var(--surface, #fff)",color:"var(--text-primary, #172033)",border:"1px solid var(--border-color, #d6dee8)",borderRadius:12,padding:14,minWidth:0};
const input={width:"100%",boxSizing:"border-box",padding:"10px 11px",borderRadius:8,border:"1px solid var(--border-color, #cbd5e1)",background:"var(--input-bg, #fff)",color:"var(--text-primary, #172033)",font:"inherit"};
const blank=()=>({platform:"Facebook",accountName:"",handle:"",profileUrl:"",accountType:"Organization page",owner:"",custodian:"",purpose:"",audience:"",authorizationReference:"",connectionStatus:"Pending Verification",reviewDate:"",notes:""});
const FIELDS=[["accountName","Account / page name"],["handle","Public handle / username"],["profileUrl","Public profile URL"],["accountType","Account type"],["owner","Responsible officer"],["custodian","Access custodian / team"],["purpose","Purpose"],["audience","Target audience"],["authorizationReference","Internal authorization reference"],["reviewDate","Next access review date"],["notes","Operational notes"]];
export default function SocialMediaAccounts({profile,employee,selectedAuthority,isAdmin=false}){
 const user=auth.currentUser;
 const roles=useMemo(()=>[selectedAuthority,profile?.role,profile?.title,profile?.position,profile?.departmentalRole,employee?.role,employee?.title,employee?.position,employee?.departmentalRole,...(profile?.roles||[]),...(profile?.assignedRoles||[]),...(employee?.roles||[]),...(employee?.assignedRoles||[])].filter(Boolean).flatMap(v=>String(v).split(",").map(x=>x.trim())),[selectedAuthority,profile,employee]);
 const allowed=isAdmin||roles.some(r=>EDITOR_ROLES.includes(r));
 const reviewer=isAdmin||roles.some(r=>REVIEW_ROLES.includes(r));
 const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null),[filter,setFilter]=useState("All"),[search,setSearch]=useState(""),[audit,setAudit]=useState([]),[form,setForm]=useState(blank),[restoreTarget,setRestoreTarget]=useState(null),[restoreReason,setRestoreReason]=useState(""),[restoreBusy,setRestoreBusy]=useState(false);
 const META_GATEWAY=getGoogleDriveGatewayUrl();
 const metaStagingEnabled=String(import.meta.env.VITE_META_STAGING_GATEWAY_URL||"").replace(/\/+$/,"")===META_GATEWAY&&String(import.meta.env.VITE_META_OAUTH_ENABLED||"")==="true";
 const [metaStatus,setMetaStatus]=useState(null),[metaBusy,setMetaBusy]=useState(false);
 useEffect(()=>{if(!user?.uid||!allowed){setItems([]);setLoading(false);return}const q=query(collection(db,"socialMediaAccounts"),orderBy("updatedAt","desc"));return onSnapshot(q,s=>{setItems(s.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);setError("")},e=>{setLoading(false);setError(e?.code==="permission-denied"?"Access denied by social-account policy. Verify your assigned communications role and deployed rules.":e.message||"Unable to load social accounts.")})},[user?.uid,allowed]);
 useEffect(()=>{if(!user?.uid||!reviewer){setAudit([]);return}const q=query(collection(db,"socialMediaAccountsAudit"),orderBy("createdAt","desc"),limit(50));return onSnapshot(q,s=>setAudit(s.docs.map(d=>({id:d.id,...d.data()}))),e=>setError(e?.message||"Unable to load account audit history."))},[user?.uid,reviewer]);
 const reset=()=>{setEditing(null);setForm(blank())};
 const visible=items.filter(x=>(filter==="All"||x.connectionStatus===filter)&&(!search||[x.platform,x.accountName,x.handle,x.owner,x.custodian,x.purpose].join(" ").toLowerCase().includes(search.toLowerCase())));
 const activeCount=items.filter(x=>x.connectionStatus==="Active").length;
 const archivedCount=items.filter(x=>x.connectionStatus==="Archived").length;
 const restoreStatus=RESTORABLE_STATES.includes(restoreTarget?.previousConnectionStatus)&&restoreTarget.previousConnectionStatus!=="Active"?restoreTarget.previousConnectionStatus:"Pending Verification";
 function edit(item){setEditing(item);setForm({...blank(),...item})}
 async function save(e){e.preventDefault();if(!allowed||!user?.uid||busy)return;setError("");setNotice("");
  if(!clean(form.accountName)){setError("Enter the account or page name.");return}
  if(form.profileUrl&&!/^https:\/\//i.test(form.profileUrl)){setError("Profile links must use HTTPS.");return}
  if(!clean(form.owner)){setError("Assign a responsible officer.");return}
  setBusy(true);
  try{
   const data={platform:form.platform,accountName:clean(form.accountName).slice(0,180),handle:clean(form.handle).slice(0,120),profileUrl:clean(form.profileUrl).slice(0,1000),accountType:form.accountType,owner:clean(form.owner).slice(0,180),custodian:clean(form.custodian).slice(0,180),purpose:clean(form.purpose).slice(0,1000),audience:clean(form.audience).slice(0,500),authorizationReference:clean(form.authorizationReference).slice(0,180),connectionStatus:editing?.connectionStatus||"Pending Verification",reviewDate:clean(form.reviewDate),notes:clean(form.notes).slice(0,1500),updatedByUid:user.uid,updatedAt:serverTimestamp(),recordOrigin:"PRODUCTION"};
   const batch=writeBatch(db);let recordRef;
   if(editing){recordRef=doc(db,"socialMediaAccounts",editing.id);batch.update(recordRef,{...data,createdByUid:editing.createdByUid,createdAt:editing.createdAt});}
   else{recordRef=doc(collection(db,"socialMediaAccounts"));batch.set(recordRef,{...data,connectionStatus:"Pending Verification",createdByUid:user.uid,createdByEmail:user.email||"",createdAt:serverTimestamp()});}
   const a=doc(collection(db,"socialMediaAccountsAudit"));batch.set(a,{recordId:recordRef.id,platform:data.platform,accountName:data.accountName,action:editing?"UPDATED":"ENROLLED",actorUid:user.uid,actorEmail:user.email||"",createdAt:serverTimestamp(),recordOrigin:"PRODUCTION"});
   await batch.commit();setNotice(editing?"Account details updated and audit recorded.":"Social-media account enrolled and audit recorded.");reset();
  }catch(x){setError(x?.code==="permission-denied"?"The security rules refused this change. No save is assumed; verify role assignments and deployed rules.":x.message||"Unable to save the account record.")}finally{setBusy(false)}
 }
 async function changeStatus(item,status){if(!reviewer||busy)return;if(status==="Archived"&&!window.confirm("Archive this account record? It will be retained and not deleted."))return;if(status==="Disconnected"&&!window.confirm("Mark this account as disconnected? This changes only the register and does not revoke platform access."))return;
  setError("");setNotice("");setBusy(true);try{const batch=writeBatch(db);const update={connectionStatus:status,updatedByUid:user.uid,updatedAt:serverTimestamp()};if(status==="Archived")update.previousConnectionStatus=item.connectionStatus;batch.update(doc(db,"socialMediaAccounts",item.id),update);const a=doc(collection(db,"socialMediaAccountsAudit"));batch.set(a,{recordId:item.id,platform:item.platform,accountName:item.accountName,action:"STATUS_"+status.toUpperCase().replace(/\s+/g,"_"),actorUid:user.uid,actorEmail:user.email||"",createdAt:serverTimestamp(),recordOrigin:"PRODUCTION"});await batch.commit();setNotice("Account register status updated and audit recorded.")}catch(e){setError(e?.code==="permission-denied"?"Status change denied by security rules. No change is assumed.":e.message||"Unable to update account status.")}finally{setBusy(false)}
 }
 async function restoreArchivedAccount(){if(!reviewer||!restoreTarget||restoreBusy)return;const reason=clean(restoreReason).slice(0,500);if(!reason){setError("Enter a reason for restoring this archived account.");return}
  setError("");setNotice("");setRestoreBusy(true);try{const batch=writeBatch(db);batch.update(doc(db,"socialMediaAccounts",restoreTarget.id),{connectionStatus:restoreStatus,restoredAt:serverTimestamp(),restoredBy:user.uid,restoreReason:reason});const a=doc(collection(db,"socialMediaAccountsAudit"));batch.set(a,{recordId:restoreTarget.id,platform:restoreTarget.platform,accountName:restoreTarget.accountName,action:"STATUS_RESTORED",actorUid:user.uid,actorEmail:user.email||"",reason,createdAt:serverTimestamp(),recordOrigin:"PRODUCTION"});await batch.commit();setNotice("Archived account restored to "+restoreStatus+"; reason and audit event recorded.");setRestoreTarget(null);setRestoreReason("")}catch(e){setError(e?.code==="permission-denied"?"Restoration denied by security rules. No change is assumed.":e.message||"Unable to restore the archived account.")}finally{setRestoreBusy(false)}
 }
 async function metaRequest(path,method="GET"){
  if(!metaStagingEnabled)throw new Error("Meta OAuth is available only in the isolated staging build.");
  if(!auth.currentUser)throw new Error("Sign in to IRPA DBGS first.");
  const idToken=await auth.currentUser.getIdToken();
  const response=await fetch(META_GATEWAY+path,{method,headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok===false)throw new Error(result.error||"Meta API request failed.");
  return result;
 }
 async function connectMeta(){
  setError("");setNotice("");setMetaBusy(true);
  try{const result=await metaRequest("/api/communications/meta/connect","POST");if(!result.authorizationUrl)throw new Error("Meta authorization URL was not returned.");window.location.assign(result.authorizationUrl);}
  catch(e){setError(e.message||"Unable to start Meta authorization.");setMetaBusy(false);}
 }
 async function checkMeta(){
  setError("");setNotice("");setMetaBusy(true);
  try{const result=await metaRequest("/api/communications/meta/status","GET");setMetaStatus(result);setNotice(result.status==="verified"?"Meta read-only API access verified. Posting remains disabled.":result.status==="not_connected"?"No Meta connection is registered for this signed-in staging user.":"Meta connection needs attention.");}
  catch(e){setError(e.message||"Unable to verify Meta API access.");setMetaStatus(null);}
  finally{setMetaBusy(false);}
 }
 async function disconnectMeta(){
  if(!window.confirm("Remove the encrypted Meta connection from this staging gateway? This does not revoke the app inside Meta."))return;
  setError("");setNotice("");setMetaBusy(true);
  try{const result=await metaRequest("/api/communications/meta/disconnect","POST");setMetaStatus(result);setNotice("Local staging connection removed. Revoke app authorization separately in Meta settings if required.");}
  catch(e){setError(e.message||"Unable to remove the staging connection.");}
  finally{setMetaBusy(false);}
 }
 if(!allowed)return <section style={panel} role="alert"><h3>Social-media accounts</h3><p>Your assigned role does not permit account management.</p></section>;
 return <section className="social-media-accounts" style={{display:"grid",gap:14,color:"var(--text-primary, #172033)"}}>
  <header style={{...panel,display:"grid",gap:8}}><h3 style={{margin:0}}>Social-media account enrolment &amp; management</h3><p style={{margin:0}}>Register IRPA's official accounts, custodians, purpose, authorization and review dates. Account records are audited and archived rather than deleted.</p><p style={{margin:0,fontSize:13}}>This is an account register, not an OAuth connection. It never asks for or stores passwords, recovery codes, access tokens or API secrets; it does not publish posts, read private messages, or revoke platform access.</p></header>
  {error&&<div role="alert" aria-live="assertive" style={{...panel,borderColor:"#dc2626",color:"#b91c1c"}}>{error}</div>}
  {notice&&<div role="status" aria-live="polite" style={{...panel,borderColor:"#16a34a"}}>{notice}</div>}
  {metaStagingEnabled&&<section style={{...panel,display:"grid",gap:10}} aria-label="Meta read-only API connection">
   <h4 style={{margin:0}}>Meta API connection · staging only</h4>
   <p style={{margin:0,fontSize:13}}>Connect an authorized Facebook account and verify its eligible Pages and linked Instagram professional accounts. Requested access is read-only; publishing, scheduling, messaging and analytics are not enabled. OAuth tokens remain encrypted in the staging gateway and are never returned to this page.</p>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <button type="button" disabled={metaBusy} style={{...input,width:"auto",cursor:"pointer",fontWeight:700}} onClick={connectMeta}>{metaBusy?"Working…":"Connect Meta (read-only)"}</button>
    <button type="button" disabled={metaBusy} style={{...input,width:"auto",cursor:"pointer"}} onClick={checkMeta}>{metaBusy?"Checking…":"Verify API access"}</button>
    {metaStatus?.status==="verified"&&<button type="button" disabled={metaBusy} style={{...input,width:"auto",cursor:"pointer"}} onClick={disconnectMeta}>Disconnect staging</button>}
   </div>
   {metaStatus&&<div role="status" style={{border:"1px solid var(--border-color, #d6dee8)",borderRadius:9,padding:10,display:"grid",gap:6}}>
    <strong>Connection status: {metaStatus.status||"unknown"}</strong>
    {metaStatus.user?.name&&<span>Authorized Meta user: {metaStatus.user.name}</span>}
    {metaStatus.facebookPages&&<div><strong>Facebook Pages</strong>{metaStatus.facebookPages.length?metaStatus.facebookPages.map(a=><div key={a.id}>{a.name} · ID {a.id}</div>):<div>No Pages were returned for the granted permissions.</div>}</div>}
    {metaStatus.instagramAccounts&&<div><strong>Linked Instagram professional accounts</strong>{metaStatus.instagramAccounts.length?metaStatus.instagramAccounts.map(a=><div key={a.id}>@{a.username||"(username unavailable)"} · ID {a.id} · {a.accountType||"type unavailable"}</div>):<div>No eligible linked Instagram professional accounts were returned.</div>}</div>}
    {metaStatus.expiresAt&&<small>Reported token expiry: {new Date(metaStatus.expiresAt).toLocaleString()}</small>}
    {(metaStatus.missingPermissions||[]).length>0&&<small role="alert">Missing required read permissions: {metaStatus.missingPermissions.join(", ")}</small>}
    <small>Posting enabled: No. Only read-only access is in scope.</small>
   </div>}
  </section>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14}}>
   <form onSubmit={save} noValidate style={{...panel,display:"grid",gap:10,alignContent:"start"}}>
    <h4 style={{margin:0}}>{editing?"Edit account record":"Enrol a social-media account"}</h4>
    <label style={{display:"grid",gap:5,fontWeight:650,fontSize:13}}>Platform<select style={input} value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{PLATFORMS.map(x=><option key={x}>{x}</option>)}</select></label>
    {FIELDS.map(([key,label])=><label key={key} style={{display:"grid",gap:5,fontWeight:650,fontSize:13}}>{label}{key==="accountType"?<select style={input} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}>{ACCOUNT_TYPES.map(x=><option key={x}>{x}</option>)}</select>:<input style={input} type={key==="reviewDate"?"date":"text"} maxLength={key==="notes"?1500:1000} value={form[key]||""} required={["accountName","owner"].includes(key)} onChange={e=>setForm({...form,[key]:e.target.value})}/>}</label>)}
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="submit" disabled={busy} style={{...input,width:"auto",cursor:"pointer",fontWeight:700}}>{busy?"Saving…":editing?"Save changes":"Enrol account"}</button>{editing&&<button type="button" style={{...input,width:"auto",cursor:"pointer"}} onClick={reset}>Cancel</button>}</div>
   </form>
   <div style={{...panel,display:"grid",gap:10,alignContent:"start"}}><h4 style={{margin:0}}>Registered accounts</h4><div className="social-media-accounts__counts" aria-live="polite"><span>Active accounts: <strong>{activeCount}</strong></span><span>Archived accounts: <strong>{archivedCount}</strong></span></div><input style={input} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search accounts" aria-label="Search social-media accounts"/><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["All",...STATES].map(s=><button type="button" key={s} onClick={()=>setFilter(s)} aria-pressed={filter===s} style={{...input,width:"auto",cursor:"pointer",fontWeight:filter===s?700:500}}>{s==="Archived"?"Archived ("+archivedCount+")":s}</button>)}</div>
    {loading?<p>Loading accounts…</p>:visible.length===0?<p>No matching accounts. Enrol an official account to begin.</p>:visible.map(item=><article key={item.id} className="social-media-accounts__record" style={{border:"1px solid var(--border-color, #d6dee8)",borderRadius:9,padding:10,display:"grid",gap:6}}><div style={{display:"flex",gap:8,alignItems:"start",justifyContent:"space-between",flexWrap:"wrap"}}><strong>{item.platform}: {item.accountName}</strong><span style={{fontSize:12,fontWeight:700}}>{item.connectionStatus}</span></div><p style={{margin:0,fontSize:13}}>{item.handle||"No public handle"} · Owner: {item.owner||"Unassigned"} · Custodian: {item.custodian||"Unassigned"}</p><p style={{margin:0,fontSize:13}}>{item.purpose||"No purpose recorded."}</p>{item.profileUrl&&<a href={item.profileUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open public profile ↗</a>}<p style={{margin:0,fontSize:12}}>Next review: {item.reviewDate||"Not scheduled"} · Updated: {item.updatedAt?.toDate?item.updatedAt.toDate().toLocaleString():"Pending timestamp"}</p><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{(item.connectionStatus!=="Archived"&&(reviewer||(item.connectionStatus==="Pending Verification"&&item.createdByUid===user?.uid)))&&<button type="button" style={{...input,width:"auto",cursor:"pointer"}} onClick={()=>edit(item)}>Edit</button>}{reviewer&&item.connectionStatus==="Pending Verification"&&<button type="button" disabled={busy} style={{...input,width:"auto",cursor:"pointer"}} onClick={()=>changeStatus(item,"Active")}>Mark verified</button>}{reviewer&&item.connectionStatus==="Active"&&<button type="button" disabled={busy} style={{...input,width:"auto",cursor:"pointer"}} onClick={()=>changeStatus(item,"Suspended")}>Suspend</button>}{reviewer&&item.connectionStatus==="Suspended"&&<button type="button" disabled={busy} style={{...input,width:"auto",cursor:"pointer"}} onClick={()=>changeStatus(item,"Active")}>Reactivate</button>}{reviewer&&item.connectionStatus==="Archived"&&<button type="button" disabled={busy||restoreBusy} style={{...input,width:"auto",cursor:"pointer",fontWeight:700}} onClick={()=>{setRestoreTarget(item);setRestoreReason("");setError("");}}>Unarchive</button>}{reviewer&&item.connectionStatus!=="Disconnected"&&item.connectionStatus!=="Archived"&&<button type="button" disabled={busy} style={{...input,width:"auto",cursor:"pointer"}} onClick={()=>changeStatus(item,"Disconnected")}>Mark disconnected</button>}{reviewer&&item.connectionStatus!=="Archived"&&<button type="button" disabled={busy} style={{...input,width:"auto",cursor:"pointer"}} onClick={()=>changeStatus(item,"Archived")}>Archive</button>}</div></article>)}
   </div>
  </div>
  {restoreTarget&&<div className="social-media-accounts__dialog-backdrop"><section className="social-media-accounts__dialog" role="dialog" aria-modal="true" aria-labelledby="social-account-restore-title" aria-describedby="social-account-restore-description"><h3 id="social-account-restore-title">Restore archived social account</h3><p id="social-account-restore-description">You are restoring <strong>{restoreTarget.accountName}</strong> on <strong>{restoreTarget.platform}</strong>.</p><p>The account will return to <strong>{restoreStatus}</strong>.{restoreTarget.previousConnectionStatus==="Active"?" Its stored status was Active, but restoration never reactivates an account. A reviewer must verify it again before setting Active.":RESTORABLE_STATES.includes(restoreTarget.previousConnectionStatus)?" This is its stored status before archiving.":" No previous status was stored; it will return to Pending Verification and require attention."}</p><label className="social-media-accounts__reason-label" htmlFor="social-account-restore-reason">Reason for restoration (required)</label><textarea id="social-account-restore-reason" className="social-media-accounts__reason" rows={4} maxLength={500} value={restoreReason} disabled={restoreBusy} onChange={e=>setRestoreReason(e.target.value)} placeholder="Explain why this account is being restored."/><div className="social-media-accounts__dialog-actions"><button type="button" disabled={restoreBusy} onClick={()=>{setRestoreTarget(null);setRestoreReason("");}}>Cancel</button><button type="button" disabled={restoreBusy||!clean(restoreReason)} onClick={restoreArchivedAccount}>{restoreBusy?"Restoring…":"Confirm restoration"}</button></div></section></div>}
  {reviewer&&<section style={{...panel,display:"grid",gap:8}}><h3 style={{margin:0}}>Social-account audit history</h3><p style={{margin:0,fontSize:13}}>Latest 50 account register events. Entries are immutable.</p>{audit.length===0?<p>No account audit events recorded yet.</p>:audit.map(a=><article key={a.id} style={{borderBottom:"1px solid var(--border-color, #d6dee8)",padding:"8px 0",display:"grid",gap:3}}><strong>{a.action} · {a.platform}: {a.accountName}</strong><span style={{fontSize:12}}>Actor: {a.actorEmail||a.actorUid||"Unknown"} · Time: {a.createdAt?.toDate?a.createdAt.toDate().toLocaleString():"Pending timestamp"}</span></article>)}</section>}
 </section>
}
