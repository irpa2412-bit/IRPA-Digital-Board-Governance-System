function getPortalContentItems(active,modules){const groups=[["Meetings",["Meeting Room","Participants","Resolutions","Voting","Actions","Decisions"]],["Induction and Orientation",["Induction Applications"]],["Finance Portfolio",["Procurement"]]];const group=groups.find(([parent,children])=>active===parent||children.includes(active));if(group){const [parent,children]=group;return[parent,...children].filter(item=>modules.includes(item));}return modules.includes(active)?[active]:[];}
function WebAppNavigationRoller({active,modules,onNavigate}){const items=[...new Set(modules)].filter(Boolean);if(!items.length)return null;return <div className="desktop-webapp-navigation-roller" aria-label="Web app navigation"><span className="webapp-navigation-roller-kicker">WEB APP NAVIGATION</span><strong>{displayModuleName(active)}</strong><select aria-label="Navigate web app" value={active} onChange={e=>onNavigate(e.target.value)}>{items.map(item=><option key={item} value={item}>{displayModuleName(item)}</option>)}</select><span className="webapp-navigation-roller-chevron" aria-hidden="true">⌄</span></div>}

function PortalContentRoller({active,modules,onNavigate}){const items=getPortalContentItems(active,modules);if(!items.length)return null;const label=PORTAL_LABELS[active]||displayModuleName(active);return <div className="mobile-portal-content-roller" aria-label="Current portal content navigator"><div className="mobile-portal-content-roller-label"><span>IN-PORTAL CONTENT</span><strong>{PORTAL_LABELS[active]||displayModuleName(active)}</strong></div><select aria-label="Navigate within current portal" value={active} onChange={e=>onNavigate(e.target.value)}>{items.map(item=><option key={item} value={item}>{PORTAL_LABELS[item]||displayModuleName(item)}</option>)}</select><span className="mobile-portal-content-roller-chevron" aria-hidden="true">⌄</span></div>}

import React,{useEffect,useMemo,useState}from"react";import Invitations from"./pages/Invitations";import Employees from"./pages/Employees";import BoardMembers from"./pages/BoardMembers";import Members from"./pages/Members";import EmployeePayments from"./pages/EmployeePayments";import Meetings from"./pages/Meetings";import Resolutions from"./pages/Resolutions";import Voting from"./pages/Voting";import OperationalGateways from"./pages/OperationalGateways";import OperationalGatewaysParticipants from"./pages/OperationalGatewaysParticipants";import AuthorizationApprovals from"./pages/AuthorizationApprovals";import SignaturePlatformWithUpload from"./pages/SignaturePlatformWithUpload";import FinancePortfolio from"./pages/FinancePortfolio";import ProcurementPortal from"./pages/ProcurementPortal";import Settings from"./pages/Settings";import InductionOrientation from"./pages/InductionOrientation";import InductionAdmin from"./pages/InductionAdmin";import ExternalAuditorPortal from"./pages/ExternalAuditorPortal";import AddAdministratorPortal from"./pages/AddAdministratorPortal";import ModuleInterlinkBar from"./components/ModuleInterlinkBar";import{observeAuthState,loginWithEmail,loginWithGoogle,completeGoogleRedirect,registerWithEmail,sendPasswordReset,sendAdminMagicLink,isMagicLink,completeMagicLink,completeInvitationToken,logout}from"./firebase/auth";import{getAdminProfile,getCurrentMemberProfile,getCurrentEmployeeProfile,getCurrentInductionContext,getRecords,COLLECTIONS}from"./firebase/data";import{getSignatureEnvelope}from"./firebase/signaturePlatform";import{provisionCurrentMemberFromInvitationV2}from"./firebase/invitationWorkflow";import{doc,getDoc}from"firebase/firestore";import{auth,db}from"./firebase/config";
const displayModuleName=m=>({"Dashboard":"Dashboard","Induction and Orientation":"Induction & Orientation Portal","Induction Applications":"Induction Applications Portal","Board Members Registration":"Board Members Registration Portal","Members & Personnel":"Members & Personnel Portal","Invitations":"Invitations Portal","Meetings":"Meeting Portal","Meeting Room":"Meeting Room Portal","Participants":"Participants Portal","Resolutions":"Resolutions Portal","Voting":"Voting Portal","Actions":"Actions Portal","Documents":"Documents Portal","Signature Platform":"Signature Portal","Decisions":"Decisions Portal","Risk Register":"Risk Register Portal","Authorization & Approvals":"Authorization & Approvals Portal","Employee Payments":"Employee Payments Portal","Finance Portfolio":"Finance Portal","Procurement":"Procurement Portal","Reports":"Reports Portal","Audit Trail":"Audit Trail Portal","Downloads":"Downloads Portal","Settings":"Settings Portal","Add Administrator":"Add Administrator Portal"}[m]||m);const roleValues=v=>Array.isArray(v)?v.flatMap(roleValues):String(v||"").split(",").map(x=>x.trim()).filter(Boolean);const hasRole=(p,roles)=>roleValues(p?.roles||p?.role).some(r=>roles.includes(r));
const NAV={GOVERNANCE:["Dashboard","Induction and Orientation","Induction Applications","Board Members Registration","Members & Personnel","Invitations","Meetings","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Risk Register","Authorization & Approvals","Employee Payments"],FINANCE:["Finance Portfolio","Procurement"],EVIDENCE:["Reports","Audit Trail"],SYSTEM:["Downloads","Settings","Add Administrator","External Auditor Portal"]};const PORTAL_CHILDREN={Meetings:["Meeting Room","Participants","Resolutions","Voting","Actions","Decisions"],"Induction and Orientation":["Induction Applications"]};const PORTAL_CHILDREN_SET=new Set(Object.values(PORTAL_CHILDREN).flat());const PORTAL_LABELS={Meetings:"Meeting Portal","Induction and Orientation":"Induction & Orientation Portal"};const ALL_MODULES=[...new Set([...Object.values(NAV).flat(),...Object.values(PORTAL_CHILDREN).flat()])];const BASE_MEMBER_MODULES=["Dashboard","Meetings","Meeting Room","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Authorization & Approvals","Employee Payments","Induction and Orientation","Procurement","Reports","Downloads"];const FINANCE_ROLES=["Finance Personnel","Finance Manager","Accountant","Finance Officer","Executive Director","Director Finance & Administration"];const PROCUREMENT_ROLES=["Procurement Officer","Procurement Manager","Procurement Team Member"];const PROCUREMENT_APPROVAL_ROLES=["Executive Director","Director Livestock","Livestock Director","Director Internal Oversight","Internal Oversight Director","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Environment","Director Field","Director Operations","Operations Director","Outreach Director","Community Development Director","Environment Director","Field Director"];const HR_ROLES=["Executive Director","Director Human Resources","HR Manager"];const EXECUTIVE_DIRECTOR_MODULES=["Members & Personnel","Participants","Risk Register"];const CONFIGURED_MODULES=["Meeting Room","Actions","Documents","Decisions","Risk Register","Reports","Audit Trail"];const LOGIN_ROLE_OPTIONS=["Administrator","Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member","Executive Director","Director Internal Oversight","Director Livestock","Director Environment","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Field Operations","HR Manager","HR Officer","Finance Manager","Finance Officer","Accountant","Internal Oversight Officer","Rangeland Officer","Livestock Officer","Environment Officer","Outreach Officer","Community Development Officer","Programme/Technical Officer","Procurement Officer","Operations Manager","IT Specialist","Information Technology Officer","Driver","Field Assistant","Administrative Assistant","Communications Officer","Monitoring & Evaluation Officer","Project Officer","Management","Employee"];
function isFinancePortalMember(p,e){return hasRole(p,FINANCE_ROLES)||hasRole(e,FINANCE_ROLES)||(p?.department==="Finance & Administration"&&["Finance Unit","Accounting Unit"].includes(p?.unit))||(e?.department==="Finance & Administration"&&["Finance Unit","Accounting Unit"].includes(e?.unit));}function isProcurementPortalMember(p,e){return hasRole(p,PROCUREMENT_ROLES)||hasRole(p,PROCUREMENT_APPROVAL_ROLES)||hasRole(e,PROCUREMENT_ROLES)||hasRole(e,PROCUREMENT_APPROVAL_ROLES)||(p?.department==="Finance & Administration"&&p?.unit==="Procurement Unit")||(e?.department==="Finance & Administration"&&e?.unit==="Procurement Unit");}function memberModules(p,e,selectedAuthority){const selected=String(selectedAuthority||"").trim();const roles=selected?[selected]:[],m=[...BASE_MEMBER_MODULES.filter(x=>x!=="Procurement")];const authorityProfile=selected?{roles:[selected],role:selected}:p;const authorityEmployee=selected&&roleValues(e?.roles||e?.role).includes(selected)?{roles:[selected],role:selected}:null;if(isFinancePortalMember(authorityProfile,authorityEmployee))m.splice(m.indexOf("Reports"),0,"Finance Portfolio");if(isProcurementPortalMember(authorityProfile,authorityEmployee))m.splice(m.indexOf("Reports"),0,"Procurement");if(roles.some(r=>HR_ROLES.includes(r)))m.splice(m.indexOf("Reports"),0,"Members & Personnel");if(roles.includes("Executive Director"))m.push(...EXECUTIVE_DIRECTOR_MODULES);return[...new Set(m)]}
function MemberActivationScreen({invitationId}) {
  const[email,setEmail]=useState(""),[password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[passwordPopup,setPasswordPopup]=useState(null);const notifyPasswordPopup=(text,type="info")=>{setPasswordPopup({text,type});window.setTimeout(()=>setPasswordPopup(null),3600)};
  async function activate(e){
    e.preventDefault(); setMessage("");
    const clean=email.trim().toLowerCase();
    if(password.length<8){setMessage("Use a password with at least 8 characters.");return}
    if(password!==confirm){setMessage("The passwords do not match.");return}
    setBusy(true);
    try{
      const {loginWithEmail}=await import("./firebase/auth");
      const signedIn=await loginWithEmail(clean,password);
      if(!signedIn?.uid) throw new Error("IRPA account authentication did not return a valid user session.");
      await provisionCurrentMemberFromInvitationV2(invitationId);
      window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
      window.location.reload();
    }catch(x){const code=String(x?.code||"");setMessage(code==="auth/invalid-credential"?"The email or password is incorrect. First complete the password setup from the IRPA invitation email, then enter the same email and the new permanent password here.":x.message||"Unable to activate the IRPA account.");}
    finally{setBusy(false)}
  }
  return <main className="auth-screen"><section className="auth-card"><div className="auth-logo-wrap"><img className="auth-logo" src="/irpa-logo.svg" alt="IRPA" /></div><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Activate Your IRPA Account</h1><p>Use the email address that received your invitation and create your permanent password for the IRPA Digital Board Governance System.</p></div><div className="auth-divider"><span>Invitation Activation</span></div><form onSubmit={activate}><label>Invited email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/><PasswordEntryField label="Create permanent password" value={password} onChange={setPassword} minLength={8} autoComplete="new-password" notify={notifyPasswordPopup}/><PasswordEntryField label="Confirm password" value={confirm} onChange={setConfirm} minLength={8} autoComplete="new-password" notify={notifyPasswordPopup}/><button type="submit" disabled={busy}>{busy?"Activating Account...":"Activate IRPA Account"}</button></form>{message&&<div className="auth-message">{message}</div>}<PasswordEntryPopup notice={passwordPopup}/><div className="auth-links"><button className="text-button" onClick={()=>window.location.href=window.location.origin} disabled={busy}>Return to Sign In</button></div></section></main>
}

function PasswordEntryPopup({notice}){if(!notice?.text)return null;const tone=notice.type==="warning"?"#f59e0b":notice.type==="success"?"#22c55e":"#60a5fa";return <div role="status" aria-live="polite" style={{position:"fixed",right:18,bottom:18,zIndex:10000,maxWidth:"min(420px,calc(100vw - 36px))",padding:"14px 16px",borderRadius:12,border:"1px solid "+tone,background:"rgba(2,6,23,.96)",boxShadow:"0 14px 40px rgba(0,0,0,.35)",color:"#f8fafc"}}><strong style={{display:"block",fontSize:11,letterSpacing:".08em",color:tone,marginBottom:5}}>{notice.type==="warning"?"PASSWORD CAUTION":notice.type==="success"?"PASSWORD ACCEPTED":"PASSWORD ENTRY"}</strong><span style={{fontSize:13,lineHeight:1.45}}>{notice.text}</span></div>}

function PasswordEntryField({label,value,onChange,minLength=6,autoComplete="current-password",notify,required=true}){const[caps,setCaps]=useState(false);const checkCaps=e=>{const active=!!e?.getModifierState?.("CapsLock");setCaps(active);if(active)notify?.("Caps Lock appears to be ON. Passwords are case-sensitive; check your capital-letter setting before continuing.","warning")};const change=e=>{const next=e.target.value;onChange(next);if(next.length>=minLength&&value.length<minLength)notify?.("Password entry is complete. Review it before submitting.","info")};const blur=()=>{setCaps(false);if(value)notify?.("Password entry field closed. Your password remains hidden and is not displayed.","info")};return <div style={{position:"relative"}}><label>{label}</label><input type="password" value={value} onChange={change} onKeyDown={checkCaps} onKeyUp={checkCaps} onFocus={checkCaps} onBlur={blur} required={required} minLength={minLength} autoComplete={autoComplete}/>{caps&&<small style={{display:"block",marginTop:5,color:"#fbbf24",fontWeight:700}}>⚠ Caps Lock appears to be ON — password case matters.</small>}</div>}

function AuthScreen(){const params=new URLSearchParams(window.location.search);const adminGateway=params.get("adminGateway")==="1";const inductionMode=params.get("induction")==="1";const[mode,setMode]=useState("login"),[email,setEmail]=useState(()=>adminGateway?"irpa2412@gmail.com":(new URLSearchParams(window.location.search).get("adminEmail")||"")),[password,setPassword]=useState(""),[selectedRole,setSelectedRole]=useState(()=>adminGateway?"Administrator":""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[authCooldown,setAuthCooldown]=useState(0),[passwordPopup,setPasswordPopup]=useState(null);const notifyPasswordPopup=(text,type="info")=>{setPasswordPopup({text,type});window.setTimeout(()=>setPasswordPopup(null),3600)};useEffect(()=>{if(authCooldown<=0)return;const t=window.setInterval(()=>setAuthCooldown(v=>v>0?v-1:0),1000);return()=>window.clearInterval(t)},[authCooldown]);async function verifyRole(user){if(adminGateway){const p=await getAdminProfile(user.uid);if(p?.active!==true)throw new Error("This account is not an active IRPA Administrator. The email address must be registered in the IRPA Administrator Registry.");return;}if(inductionMode){await getCurrentInductionContext();return;}const [m,e]=await Promise.all([getCurrentMemberProfile().catch(()=>null),getCurrentEmployeeProfile().catch(()=>null)]);if(!(m?.status==="Active"||e))throw new Error("This account has no active IRPA registration. Complete Induction and Orientation or use your invitation activation link before signing in.");}async function submit(e){e.preventDefault();if(authCooldown>0){setMessage("Firebase has temporarily rate-limited password sign-in on this device. Do not keep retrying. Use Sign In with Google for an Administrator account, or wait for the Firebase block to clear and then use Forgot administrator password? if needed.");return}setBusy(true);setMessage("");try{if(adminGateway){const signedIn=await loginWithEmail(email,password);if(signedIn){await verifyRole(signedIn);notifyPasswordPopup("Password accepted. Secure authentication completed; opening the IRPA workspace.","success");window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");setMessage("Administrator authenticated. Opening the governance dashboard...");await new Promise(resolve=>window.setTimeout(resolve,700));}}else if(mode==="register"){await registerWithEmail(email.trim(),password);setMessage("Account created. Please verify your email before continuing")}else {const signedIn=await loginWithEmail(email.trim(),password);await verifyRole(signedIn);notifyPasswordPopup("Password accepted. Secure authentication completed; opening the IRPA workspace.","success");await new Promise(resolve=>window.setTimeout(resolve,700))}}catch(x){console.error("IRPA authentication failed:",x);const code=String(x?.code||"");const msg=String(x?.message||"Authentication failed.");if(code==="auth/too-many-requests"||msg.includes("auth/too-many-requests")){setAuthCooldown(60);setMessage("Firebase has temporarily blocked password sign-in from this device because of too many attempts. Stop retrying the password. For an Administrator account, use Sign In with Google now, or wait for the block to clear and then use Forgot administrator password? to establish a new password.");}else setMessage(msg)}finally{setBusy(false)}}async function reset(){if(!email.trim()){setMessage(adminGateway?"Enter the administrator email address first.":"Enter your registered IRPA email address first.");return}setBusy(true);setMessage("");try{await sendPasswordReset(email.trim());setMessage(adminGateway?"Password reset email sent. Open the newest reset email and create a new IRPA Administrator password.":"Credential assistance email sent. Open the newest reset email, create your password, then return to this IRPA sign-in page and sign in normally. Your existing administrator-registered identity remains unchanged.")}catch(x){const code=String(x?.code||"");if(code==="auth/too-many-requests")setMessage("Firebase is temporarily rate-limiting this device. Do not keep retrying. Wait for the block to clear before requesting another password reset.");else setMessage(x.message||"Unable to send password reset email.")}finally{setBusy(false)}}function openAdminGateway(){window.location.href=window.location.pathname+"?adminGateway=1"}function returnToSignIn(){window.location.href=window.location.pathname}return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Digital Board Governance</h1><p>Secure institutional governance, authorization, finance and employee management for Improvement of Rangeland in Pastoral Areas.</p></div><div className="auth-divider"><span>{adminGateway?"Administrator Gateway":inductionMode?"Induction and Orientation":mode==="login"?"Secure sign in":"Create account"}</span></div>{adminGateway&&<div className="auth-message" style={{marginBottom:16}}>Administrator accounts may sign in with their Google account. If password sign-in is temporarily blocked, use <strong>Sign In with Google</strong> instead of retrying the password.</div>}{inductionMode&&!adminGateway&&<div className="auth-message" style={{marginBottom:16}}><strong>Induction and Orientation — Login Assistance</strong><br/>This is a parallel assistance pathway for IRPA Members and Employees who are already registered by the Administrator. It does not create a new account or replace the normal sign-in gateway. If a password or other sign-in blocker prevents access, use <strong>Forgot password?</strong> below, then return here to complete your registered induction and orientation.</div>}<form onSubmit={submit}><label>Email address</label><input type="email"value={email}onChange={e=>setEmail(e.target.value)}required/><PasswordEntryField label="Password" value={password} onChange={setPassword} minLength={6} autoComplete="current-password" notify={notifyPasswordPopup}/><button type="submit"disabled={busy||authCooldown>0}>{busy?"Please wait...":authCooldown>0?"Password Sign In Temporarily Blocked ("+authCooldown+"s)":adminGateway?"Administrator Sign In":mode==="register"?"Create Account":"Sign In Securely"}</button></form><div className="auth-links">{adminGateway&&<><button type="button"className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{const signedIn=await loginWithGoogle("",{admin:true});await verifyRole(signedIn)}catch(x){setMessage(x.message||"Google administrator sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Sign In with Google</button><button type="button"className="secondary-button"onClick={()=>{window.location.href=window.location.pathname+"?auditor=1"}}disabled={busy}>External Auditor Portal</button><button type="button"className="text-button"onClick={reset}disabled={busy}>Forgot administrator password?</button><button type="button"className="text-button"onClick={returnToSignIn}disabled={busy}>Return to sign in</button></>}{!adminGateway&&<><button type="button"className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{const signedIn=await loginWithGoogle("");await verifyRole(signedIn)}catch(x){setMessage(x.message||"Google sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Continue with Google</button><button type="button"className="text-button"onClick={reset}disabled={busy}>Forgot password?</button><button type="button"className="secondary-button"onClick={()=>{window.location.href=window.location.pathname+"?induction=1&applicant=1&route=assistance"}}disabled={busy}>Induction & Orientation — Start Application</button><button type="button"className="text-button"onClick={openAdminGateway}disabled={busy}>Administrator Gateway</button><button type="button"className="text-button"onClick={()=>{setMode(mode==="login"?"register":"login");setMessage("")}}disabled={busy}>{mode==="login"?"Create a member account":"Return to sign in"}</button></>}</div>{message&&<div className="auth-message">{message}</div>}<PasswordEntryPopup notice={passwordPopup}/></section></main>}
function Loading(){const[slow,setSlow]=useState(false);useEffect(()=>{const t=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(t)},[]);return <div className="loading-screen"><div><strong>IRPA Digital Governance</strong><div className="loading-sub">{slow?"Authorization check is taking longer than expected.":"Establishing secure IRPA session..."}</div>{slow&&<button onClick={()=>window.location.reload()}>Retry Secure Session</button>}</div></div>}
function AccessDenied({user,reason}){return <main className="auth-screen"><section className="auth-card"><h1>Access Not Authorised</h1><p>{reason||"No active IRPA authorization profile was found."}</p><p className="muted">{user?.email}</p><button type="button" className="logout-button" onClick={logout} aria-label="Sign out of IRPA Digital Governance">Sign Out</button></section></main>}
function profileLabel(admin,employee){return admin?"Administrator":employee?.employeeNumber?("Authorized employee • "+employee.employeeNumber):"Authorized IRPA user"}
function resolveLoginCategories(profile,employee,admin){if(admin)return["ADMINISTRATOR"];const boardPosition=String(profile?.boardPosition||employee?.boardPosition||"").trim();const boardRoles=["Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member"];const normalize=v=>String(v||"").trim();const values=[...(Array.isArray(profile?.roles)?profile.roles:[]),...(Array.isArray(profile?.assignedRoles)?profile.assignedRoles:[]),...(Array.isArray(profile?.selectedRoles)?profile.selectedRoles:[]),...(Array.isArray(profile?.roleAssignments)?profile.roleAssignments:[]),profile?.role,employee?.role,...(Array.isArray(employee?.roles)?employee.roles:[]),...(Array.isArray(employee?.assignedRoles)?employee.assignedRoles:[]),...(Array.isArray(employee?.selectedRoles)?employee.selectedRoles:[]),...(Array.isArray(employee?.roleAssignments)?employee.roleAssignments:[])].map(normalize).filter(Boolean);const filtered=values.filter(v=>!(boardPosition&&boardRoles.includes(v)&&v!==boardPosition));if(boardPosition)filtered.unshift(boardPosition);return [...new Set(filtered)];}
function LoginCategoryBadges({profile,employee,admin,selectedAuthority}){const categories=resolveLoginCategories(profile,employee,admin);const memberNumber=String(profile?.memberNumber||"").trim();const employeeNumber=String(employee?.employeeNumber||"").trim();return <div aria-label="Login category" style={{marginTop:4}}><span style={{fontSize:10,fontWeight:800,letterSpacing:".08em",opacity:.72,display:"block"}}>AUTHORIZED USER · ACCESS CATEGORIES</span><div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:4,alignItems:"flex-start"}}>{categories.length?categories.map(category=><div key={category} style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-start",gap:3}}><span style={{display:"inline-flex",alignItems:"center",padding:"3px 7px",borderRadius:999,fontSize:11,fontWeight:700,border:"1px solid currentColor",lineHeight:1.2}}>{category}</span></div>):<span style={{fontSize:11,opacity:.72}}>Authorized IRPA User</span>}</div>{(memberNumber||employeeNumber)&&<div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:7,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.12)"}}>{memberNumber&&<div><small style={{display:"block",fontSize:8,letterSpacing:".06em",opacity:.62}}>MEMBER NUMBER</small><strong style={{fontSize:10}}>{memberNumber}</strong></div>}{employeeNumber&&<div><small style={{display:"block",fontSize:8,letterSpacing:".06em",opacity:.62}}>EMPLOYEE NUMBER</small><strong style={{fontSize:10}}>{employeeNumber}</strong></div>}</div>}<small style={{display:"block",fontSize:9,lineHeight:1.25,opacity:.62,marginTop:6}}>Access categories and institutional identifiers only — the current signing authority is selected separately in the Signing Identity · Registered Capacity panel.</small></div>}
function Dashboard({user,admin,employee,profile,onNavigate,selectedAuthority,authorityCategories}){
 const[liveNow,setLiveNow]=useState(()=>new Date());
 const[stats,setStats]=useState({employees:0,members:0,meetings:0,authorizations:0,actions:0,risks:0,payments:0,signatures:0,reports:0});
 const[busy,setBusy]=useState(true);
 const[activity,setActivity]=useState([]);
 const role=String(profile?.role||"").toLowerCase();
 const isMember=!admin&&!employee?.employeeNumber&&/member|board/.test(role);
 const displayName=profile?.name||employee?.name||employee?.fullName||user?.displayName||profile?.email||user?.email||"IRPA User";
 const profileTitle=profile?.title||profile?.jobTitle||profile?.position||employee?.jobTitle||employee?.position||profile?.role||(admin?"Administrator":"Authorized User");
 const registrationNo=employee?.employeeNumber||employee?.registrationNumber||profile?.registrationNumber||profile?.memberNumber||profile?.employeeNumber||"";
 const photo=profile?.photoUrl||profile?.photoURL||profile?.avatarUrl||profile?.profilePhotoUrl||employee?.photoUrl||employee?.photoURL||employee?.avatarUrl||user?.photoURL||"";
 const initials=displayName.split(/\\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"IR";
 useEffect(()=>{const clockId=setInterval(()=>setLiveNow(new Date()),1000);return()=>clearInterval(clockId)},[]);
 const liveDate=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",day:"2-digit",month:"long",year:"numeric"}).format(liveNow);
 const liveDay=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",weekday:"long"}).format(liveNow);
 const liveTime=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(liveNow);
 useEffect(()=>{let live=true;(async()=>{
   try{
    if(admin){
      const names=[COLLECTIONS.employees,COLLECTIONS.members,COLLECTIONS.meetings,COLLECTIONS.authorizationRequests,COLLECTIONS.actions,COLLECTIONS.risks,COLLECTIONS.reports];
      const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));
      if(live){
       setStats({employees:v[0].length,members:v[1].length,meetings:v[2].length,authorizations:v[3].filter(x=>["Submitted","Under Review"].includes(x.status)).length,actions:v[4].filter(x=>!["Completed","Cancelled"].includes(x.status)).length,risks:v[5].filter(x=>!["Closed","Mitigated"].includes(x.status)).length,payments:0,signatures:0,reports:v[6].filter(x=>!["Archived"].includes(x.status)).length});
       const rows=[...v[3].map(x=>({...x,_kind:"Authorization"})),...v[2].map(x=>({...x,_kind:"Meeting"})),...v[4].map(x=>({...x,_kind:"Action"}))];
       setActivity(rows.sort((a,b)=>String(b.updatedAt||b.createdAt||b.date||"").localeCompare(String(a.updatedAt||a.createdAt||a.date||""))).slice(0,5));
      }
    }else{
      const uid=auth.currentUser?.uid;const names=[COLLECTIONS.meetings,COLLECTIONS.actions,COLLECTIONS.authorizationRequests,COLLECTIONS.staffPaymentRequests,COLLECTIONS.signatures,COLLECTIONS.reports];
      const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));
      const mine=x=>x.uid===uid||x.employeeUid===uid||x.ownerUid===uid||x.requesterUid===uid||x.createdByUid===uid||x.assignedToUid===uid||x.signerUid===uid||x.recipientUid===uid||(Array.isArray(x.participantUids)&&x.participantUids.includes(uid));
      if(live){
       setStats({employees:0,members:0,meetings:v[0].filter(x=>mine(x)||x.status==="Scheduled"||x.status==="In Progress").length,authorizations:v[2].filter(x=>mine(x)&&["Submitted","Under Review"].includes(x.status)).length,actions:v[1].filter(x=>mine(x)&&!["Completed","Cancelled"].includes(x.status)).length,risks:0,payments:v[3].filter(x=>mine(x)&&!["Paid","Rejected","Cancelled"].includes(x.status)).length,signatures:v[4].filter(x=>mine(x)&&!["Completed","Signed","Declined"].includes(x.status)).length,reports:v[5].filter(x=>mine(x)&&!["Published","Archived"].includes(x.status)).length});
       const rows=[...v[2].filter(mine).map(x=>({...x,_kind:"Authorization"})),...v[0].filter(mine).map(x=>({...x,_kind:"Meeting"})),...v[1].filter(mine).map(x=>({...x,_kind:"Action"})),...v[3].filter(mine).map(x=>({...x,_kind:"Payment"}))];
       setActivity(rows.sort((a,b)=>String(b.updatedAt||b.createdAt||b.date||"").localeCompare(String(a.updatedAt||a.createdAt||a.date||""))).slice(0,5));
      }
    }
   }finally{if(live)setBusy(false)}
 })();return()=>{live=false}},[admin,employee?.employeeNumber,profile?.role]);
 const go=target=>onNavigate?.(target);
 const cards=admin?[["Members",stats.members,"Current register","Members & Personnel"],["Meetings",stats.meetings,"This month","Meetings"],["Pending Authorizations",stats.authorizations,"Awaiting action","Authorization & Approvals"],["Reports",stats.reports,"Available reports","Reports"]]:isMember?[["My Meetings",stats.meetings,"Meeting register","Meetings"],["My Actions",stats.actions,"Implementation control","Actions"],["Pending Authorizations",stats.authorizations,"Awaiting action","Authorization & Approvals"],["Pending Signatures",stats.signatures,"Signature platform","Signature Platform"]]:[["My Meetings",stats.meetings,"Meeting register","Meetings"],["Actions Assigned",stats.actions,"Implementation control","Actions"],["Pending Authorizations",stats.authorizations,"Awaiting action","Authorization & Approvals"],["My Payment Requests",stats.payments,"Payment workflow","Employee Payments"]];
 const quick=admin?[["Create Authorization","Authorization & Approvals","Create and track governance authorizations","check"],["New Payment","Employee Payments","Start an employee payment workflow","finance"],["Upload Document","Documents","Upload and manage authorised documents","document"],["View Reports","Reports","Open governance reports and analytics","analytics"],["Meetings","Meetings","Schedule and manage governance meetings","calendar"],["Signatures","Signature Platform","Manage governance signatures","signature"]]:[["Meetings","Meetings","Schedule and manage assigned meetings","calendar"],["Documents","Documents","Access authorised governance documents","document"],["Finance","Finance Portfolio","Access authorised finance workflows","finance"],["Authorizations","Authorization & Approvals","Review assigned approvals","check"],["Signatures","Signature Platform","Complete assigned signatures","signature"],["Reports","Reports","View authorised reports","analytics"]];
 const iconFor=label=>{const icons={Employees:"fa-users",Members:"fa-users",Meetings:"fa-calendar-days","Pending Authorizations":"fa-circle-check","My Actions":"fa-list-check","Actions Assigned":"fa-list-check","My Payment Requests":"fa-money-bill-wave","My Meetings":"fa-calendar-days","Pending Signatures":"fa-file-signature",groups:"fa-users",calendar:"fa-calendar-days",document:"fa-folder-open",check:"fa-circle-check",finance:"fa-coins",analytics:"fa-chart-column",risk:"fa-triangle-exclamation",settings:"fa-gear",signature:"fa-file-signature"};return <i className={"fa-solid "+(icons[label]||"fa-circle")} aria-hidden="true"/>}
 const activityLabel=x=>x._kind==="Authorization"?(x.title||x.description||x.referenceNumber||"Authorization request"):x._kind==="Meeting"?(x.title||x.subject||"Meeting"):x._kind==="Payment"?(x.referenceNumber||x.type||"Payment request"):(x.title||x.description||"Action");
 const activityStatus=x=>x.status||x.workflowStage||"Recorded";
  const activityStatusClass=status=>{const v=String(status||"").toLowerCase();if(v.includes("reject")||v.includes("declin")||v.includes("cancel"))return "is-danger";if(v.includes("pend")||v.includes("review")||v.includes("await"))return "is-warning";if(v.includes("activ")||v.includes("approv")||v.includes("submit")||v.includes("complet"))return "is-success";return "is-neutral"};
 return <div className="page dashboard-command">
   <div className="dashboard-desktop-view">
    <section className="desktop-quote4-hero">
      <div className="desktop-quote4-hero-image"></div>
      <div className="desktop-quote4-hero-overlay"></div>
      <div className="desktop-quote4-hero-content">
       <div className="desktop-profile-photo">{photo?<img src={photo} alt={displayName}/>:<span>{initials}</span>}</div>
       <div><span className="eyebrow">GOOD DAY</span><h1>{displayName}</h1><p>{profileTitle}{registrationNo?" · "+registrationNo:""}</p><span className="desktop-motto">Sustainable rangelands · resilient communities</span>{authorityCategories?.length>1&&<div className="dashboard-authority-context"><small>ACTIVE ACCESS AUTHORITY</small><strong>{selectedAuthority||"Select authority"}</strong></div>}</div>
      </div>
      
    </section>
    <div className="dashboard-live-date-slot"><div className="desktop-date-card open-portal-panel" aria-label="Live date and time"><div className="live-date-time-content"><span>LIVE DATE & TIME</span><strong>{liveDay}</strong><small>{liveDate} · {liveTime}</small><em className="desktop-date-workspace">IRPA Digital Governance Workspace</em></div><div className="live-date-stat-buttons" aria-label="Dashboard portal shortcuts">{cards.slice(2,4).map(([label,value,sub,target])=><button className="desktop-blue-nav-button" key={label} type="button" onClick={()=>go(target)}><span className="quote4-stat-icon">{iconFor(label)}</span><div><strong>{busy?"—":value}</strong><b>{label}</b><small>{sub}</small></div><i>›</i></button>)}</div></div></div><section className="dashboard-quote4-stats">{cards.slice(2).concat(cards.slice(0,2)).map(([label,value,sub,target])=><button className="desktop-blue-nav-button" key={label} type="button" onClick={()=>go(target)}><span className="quote4-stat-icon">{iconFor(label)}</span><div><strong>{busy?"—":value}</strong><b>{label}</b><small>{sub}</small></div><i>›</i></button>)}</section>
    <section className="dashboard-quote4-main">
      <div className="dashboard-quote4-activity panel">
       <div className="quote4-heading"><div><span className="eyebrow">LIVE GOVERNANCE CONTROL</span><h2>Recent Activities</h2></div><button type="button" onClick={()=>go("Reports")}>View all activities ›</button></div>
       <div className="quote4-activity-table"><div className="quote4-activity-header" aria-hidden="true"><span>Date</span><span>Activity</span><span>Reference</span><span>Status</span><span></span></div>{activity.length?activity.map((x,i)=>{const status=activityStatus(x);const target=x._kind==="Authorization"?"Authorization & Approvals":x._kind==="Meeting"?"Meetings":x._kind==="Payment"?"Employee Payments":"Actions";return <button type="button" key={x.id||i} aria-label={`Open ${activityLabel(x)}`} onClick={()=>go(target)}><span>{x.date||x.updatedAt||x.createdAt||"—"}</span><strong>{activityLabel(x)}</strong><small>{x.referenceNumber||x.reference||x.employeeNumber||x._kind}</small><em className={activityStatusClass(status)}>{status}</em><b>›</b></button>}):<div className="quote4-empty">Live governance activities will appear here as records are created.</div>}</div>
      </div>
      <div className="dashboard-quote4-quick panel">
       <div className="quote4-heading"><div><span className="eyebrow">WORKSPACE</span><h2>Quick Access</h2></div></div>
       <div className="quote4-quick-grid">{quick.slice(0,6).map(([label,target,desc,ico])=><button className="desktop-blue-nav-button" key={target} type="button" onClick={()=>go(target)}><span>{iconFor(ico)}</span><strong>{label}</strong><small>{desc}</small><b>›</b></button>)}</div>
      </div>
    </section>
   </div>
   <div className="dashboard-mobile-view" aria-label="Mobile IRPA governance dashboard">
    <section className="mobile-quote1-hero">
      <div className="mobile-quote1-image" aria-hidden="true"></div>
      <svg className="mobile-quote1-silhouette" viewBox="0 0 800 280" preserveAspectRatio="none" aria-hidden="true">
        <path fill="#2D5A45" d="M0 205 105 118 170 170 245 84 325 170 405 72 495 170 590 105 680 176 800 92V280H0Z"/>
        <path fill="#234A38" d="M0 238 125 184 205 212 300 148 380 205 470 158 560 222 655 166 800 226V280H0Z" opacity=".92"/>
        <path fill="#2D5A45" d="M0 248c70-19 121-19 185 0 55 17 112 17 171-1 72-22 132-20 202 3 74 24 152 20 242-5V280H0Z"/>
        <path fill="#1B4332" d="M0 259c70-12 143-9 210 4 70 13 127 8 191-6 76-17 141-14 207 2 65 16 128 15 192-1v22H0Z"/>
      </svg>
      <div className="mobile-quote1-shade"></div>
      <div className="mobile-quote1-user"><div className="mobile-quote1-photo">{photo?<img src={photo} alt={displayName}/>:<span>{initials}</span>}</div><div><span>GOOD DAY,</span><h1>{displayName}</h1><p>{profileTitle}{registrationNo?" · "+registrationNo:""}</p><em>{admin?"Administrator":profileTitle}</em></div></div>
    </section>
    <section className="mobile-quote1-stats">{cards.map(([label,value,sub,target])=><button className="mobile-blue-nav-button" style={{backgroundColor:"#0b5fa8",color:"#fff"}} key={label} type="button" onClick={()=>go(target)}><span>{iconFor(label)}</span><strong>{busy?"—":value}</strong><b>{label}</b><small>{sub}</small><i>›</i></button>)}</section>
    <section className="mobile-quote1-quick"><div className="mobile-quote1-heading"><h2>Quick Access</h2><button className="mobile-blue-nav-button" style={{backgroundColor:"#0b5fa8",color:"#fff"}} type="button" onClick={()=>go("Meetings")}>View all ›</button></div><div className="mobile-quote1-grid">{quick.slice(0,6).map(([label,target,desc,ico])=><button className="mobile-blue-nav-button" style={{backgroundColor:"#0b5fa8",color:"#fff"}} key={target} type="button" onClick={()=>go(target)}><span>{iconFor(ico)}</span><strong>{label}</strong></button>)}</div></section>
   </div>
 </div>
}function Downloads(){const[installEvent,setInstallEvent]=useState(null);const[message,setMessage]=useState("");useEffect(()=>{const handler=e=>{e.preventDefault();setInstallEvent(e)};window.addEventListener("beforeinstallprompt",handler);return()=>window.removeEventListener("beforeinstallprompt",handler)},[]);async function install(){if(installEvent){await installEvent.prompt();const choice=await installEvent.userChoice;setMessage(choice?.outcome==="accepted"?"IRPA Digital Governance was added to your PC.":"Installation was cancelled.");setInstallEvent(null);return}setMessage("Your browser does not expose the automatic install prompt. Use the browser menu and choose “Install this site as an app” or “Apps → Install this site as an app”.")}function shortcut(){const blob=new Blob(["[InternetShortcut]\\r\\nURL="+window.location.origin+"\\r\\nIconIndex=0\\r\\n"],{type:"application/internet-shortcut"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="IRPA-Digital-Governance.url";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA DIGITAL GOVERNANCE</span><h1>Downloads & PC Access</h1><p>Install or download access resources for the IRPA Digital Board Governance System.</p></div><div className="identity-card"><span>Application</span><strong>Live</strong></div></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">DOWNLOAD CENTRE</span><h2>IRPA Application Downloads</h2><p className="muted">Choose the option you need. The live application remains securely hosted online.</p></div></div><div className="dashboard-grid" style={{marginTop:18}}><div className="stat-card"><span>INSTALL ON PC</span><strong>App</strong><small>Desktop-style browser installation</small><button type="button" style={{marginTop:12}} onClick={install}>{installEvent?"Install IRPA App":"Install / Add to PC"}</button></div><div className="stat-card"><span>PC SHORTCUT</span><strong>.URL</strong><small>Download a Windows Internet Shortcut</small><button type="button" className="secondary-button" style={{marginTop:12}} onClick={shortcut}>Download PC Shortcut</button></div><div className="stat-card"><span>ANDROID APP</span><strong>.APK</strong><small>Download and install IRPA Digital Governance on Android</small><a className="secondary-button" style={{display:"inline-block",marginTop:12,textDecoration:"none"}} href="https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/35520435278" target="_blank" rel="noreferrer">Download Android APK</a></div><div className="stat-card"><span>SOURCE PACKAGE</span><strong>.ZIP</strong><small>Download the current GitHub source package</small><a className="secondary-button" style={{display:"inline-block",marginTop:12,textDecoration:"none"}} href="https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/archive/refs/heads/main.zip" target="_blank" rel="noreferrer">Download Source ZIP</a></div></div>{message&&<div className="auth-message" style={{marginTop:18}}>{message}</div>}<div className="form-actions" style={{marginTop:18}}><button type="button" onClick={()=>window.open(window.location.origin,"_blank","noopener,noreferrer")}>Open Live Application</button><button type="button" className="secondary-button" onClick={()=>{window.location.href=window.location.origin}}>Return to Application</button></div></section></div>}
function SignerShell({user,profile,signingEnvelopeId}){
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-copy">
          <strong>IRPA</strong>
          <span>Digital Governance</span>
          <small>Improvement of Rangeland in Pastoral Areas</small>
        </div>
      </div>
      <div className="authority-card">
        <span>SIGNING PARTICIPANT</span>
        <strong>{profile?.name||profile?.email||user.email}</strong>
        <small>Invitation-only access</small>
      </div>
      <nav>
        <div className="nav-group">
          <div className="nav-group-title">SIGNING</div>
          <button className="nav-item active">
            <span>Signature Invitation</span>
            <i/>
          </button>
        </div>
      </nav>
      <div className="sidebar-footer">
        <div className="secure-label">● Secure signing session</div>
        <button className="logout-button" onClick={logout}>Sign Out</button>
      </div>
    </aside>
    <section className="main-area">
      <header className="topbar">
        <div>
          <span className="topbar-kicker">IMPROVEMENT OF RANGELAND IN PASTORAL AREAS</span>
          <h2>Signature Invitation</h2>
          <p>Secure Electronic Signing Ceremony</p>
        </div>
        <div className="user-info">
          <div className="user-avatar">{(profile?.name||user.email||"S").slice(0,1).toUpperCase()}</div>
          <div>
            <strong>{profile?.name||"Signing Participant"}</strong>
            <LoginCategoryBadges profile={profile} employee={null} admin={false}/>
          </div>
        </div>
      </header>
      <main className="content-area">
        <SignaturePlatformWithUpload signerOnly={true} signingEnvelopeId={signingEnvelopeId}/>
      </main>
    </section>
  </div>
}


function MobileGlobalNavigation({mobileNav,setMobileNav,active,setActive,modules,groups,admin}){const go=target=>{setMobileNav("");setActive(target)};const portalItems=[["Meeting Portal","Meetings"],["Members & Personnel Portal","Members & Personnel"],["Invitations Portal","Invitations"],["Documents Portal","Documents"],["Finance Portal","Finance Portfolio"],["Signature Portal","Signature Platform"],["Authorization & Approvals Portal","Authorization & Approvals"],["Employee Payments Portal","Employee Payments"],["Reports Portal","Reports"],["Audit Trail Portal","Audit Trail"],["External Auditor Portal","External Auditor Portal"],["Induction & Orientation Portal","Induction and Orientation"]].filter(([,target])=>modules.includes(target));const menuItems=groups.flatMap(([,items])=>items.filter(x=>!PORTAL_CHILDREN_SET.has(x)));return <><div className="mobile-global-nav" aria-label="Mobile navigation"><button className={active==="Dashboard"&&!mobileNav?"active":""} type="button" onClick={()=>go("Dashboard")}><span className="mobile-nav-icon"><i className="fa-solid fa-house" aria-hidden="true"></i></span><b>Home</b></button><button className={mobileNav==="portals"?"active":""} type="button" onClick={()=>setMobileNav(mobileNav==="portals"?"":"portals")}><span className="mobile-nav-icon"><i className="fa-solid fa-table-cells-large" aria-hidden="true"></i></span><b>Portals</b></button><button className={mobileNav==="alerts"?"active":""} type="button" onClick={()=>setMobileNav(mobileNav==="alerts"?"":"alerts")}><span className="mobile-nav-icon mobile-nav-bell"><i className="fa-solid fa-bell" aria-hidden="true"></i><b>1</b></span><b>Alerts</b></button><button className={mobileNav==="menu"?"active":""} type="button" onClick={()=>setMobileNav(mobileNav==="menu"?"":"menu")}><span className="mobile-nav-icon"><i className="fa-solid fa-bars" aria-hidden="true"></i></span><b>Menu</b></button></div>{mobileNav&&<div className="mobile-nav-sheet" role="dialog" aria-label="Mobile navigation"><div className="mobile-nav-sheet-header"><strong>{mobileNav==="portals"?"Portals":mobileNav==="alerts"?"Attention Required":"Navigation"}</strong><div style={{display:"flex",gap:8}}><button type="button" className="logout-button" onClick={logout}>Sign Out</button><button type="button" onClick={()=>setMobileNav("")}>Close</button></div></div>{mobileNav==="portals"&&<div className="mobile-nav-sheet-list">{portalItems.map(([label,target])=><button key={target} type="button" onClick={()=>go(target)}><span>{label}</span><b>›</b></button>)}</div>}{mobileNav==="alerts"&&<div className="mobile-nav-sheet-list"><button type="button" onClick={()=>go("Authorization & Approvals")}><span>Pending Authorizations</span><b>›</b></button><button type="button" onClick={()=>go("Actions")}><span>Open Actions</span><b>›</b></button>{admin&&<button type="button" onClick={()=>go("Induction Applications")}><span>Induction Applications</span><b>›</b></button>}</div>}{mobileNav==="menu"&&<div className="mobile-nav-sheet-list">{menuItems.map(x=><button key={x} type="button" onClick={()=>go(x)}><span>{PORTAL_LABELS[x]||displayModuleName(x)}</span><b>›</b></button>)}</div>}</div>}</>}
function LiveWeatherPanel(){
  const WEATHER_POINTS=[
   {latitude:-2.73319,longitude:36.69773},
   {latitude:-2.6098,longitude:36.7355},
   {latitude:-2.5053,longitude:36.5455},
   {latitude:-2.73333,longitude:36.26667},
   {latitude:-3.3697,longitude:36.6881}
  ];
  const[weather,setWeather]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[lastUpdated,setLastUpdated]=useState("");
  const apiKey=String(import.meta.env.VITE_GOOGLE_WEATHER_API_KEY||"").trim();
  useEffect(()=>{
   const loadWeather=async()=>{
    if(!apiKey){setError("Google Weather is not configured");setLoading(false);return;}
    try{
     setError("");setLoading(true);
     const requests=WEATHER_POINTS.map(point=>{
      const params=new URLSearchParams({key:apiKey,"location.latitude":String(point.latitude),"location.longitude":String(point.longitude),unitsSystem:"METRIC"});
      const currentUrl="https://weather.googleapis.com/v1/currentConditions:lookup?"+params.toString();
      const hourlyUrl="https://weather.googleapis.com/v1/forecast/hours:lookup?"+params.toString()+"&hours=96";
      const dailyUrl="https://weather.googleapis.com/v1/forecast/days:lookup?"+params.toString()+"&days=4";
      return Promise.all([fetch(currentUrl,{cache:"no-store"}),fetch(hourlyUrl,{cache:"no-store"}),fetch(dailyUrl,{cache:"no-store"})]);
     });
     const responses=await Promise.all(requests);
     if(responses.some(([currentResponse,hourlyResponse,dailyResponse])=>!currentResponse.ok||!hourlyResponse.ok||!dailyResponse.ok)) throw new Error("Google Weather service unavailable");
     const payloads=await Promise.all(responses.map(async([currentResponse,hourlyResponse,dailyResponse])=>[await currentResponse.json(),await hourlyResponse.json(),await dailyResponse.json()]));
     const valid=payloads.filter(([current,hourly,daily])=>current?.weatherCondition&&hourly?.forecastHours?.length&&daily?.forecastDays?.length);
     if(!valid.length) throw new Error("Incomplete Google Weather response");

     const average=numbers=>{
      const values=numbers.filter(value=>Number.isFinite(value));
      return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
     };
     const mode=values=>{
      const counts=new Map();
      values.filter(Boolean).forEach(value=>counts.set(value,(counts.get(value)||0)+1));
      return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
     };
     const currentRows=valid.map(([current])=>current);
     const googleUpdateTimes=currentRows.map(row=>row.currentTime).filter(Boolean).sort();
     setLastUpdated(googleUpdateTimes[googleUpdateTimes.length-1]||new Date().toISOString());
     const current={
      weatherCondition:{type:mode(currentRows.map(row=>row.weatherCondition?.type)),description:{text:mode(currentRows.map(row=>row.weatherCondition?.description?.text))||"Regional conditions"}},
      temperature:{degrees:average(currentRows.map(row=>row.temperature?.degrees))},
      feelsLikeTemperature:{degrees:average(currentRows.map(row=>row.feelsLikeTemperature?.degrees))},
      relativeHumidity:average(currentRows.map(row=>row.relativeHumidity)),
      wind:{speed:{value:average(currentRows.map(row=>row.wind?.speed?.value))}},
      precipitation:{probability:{percent:average(currentRows.map(row=>row.precipitation?.probability?.percent))}}
     };

     const dailyByDay=new Map();
     valid.forEach(([,hourly,daily])=>daily.forecastDays.slice(0,4).forEach((day,index)=>{
      const key=day.interval?.startTime||String(index);
      if(!dailyByDay.has(key)) dailyByDay.set(key,[]);
      dailyByDay.get(key).push(day);
     }));
     const forecastDays=[...dailyByDay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(0,4).map(([key,days])=>{
      const forecasts=days.map(day=>day.daytimeForecast||day.nighttimeForecast||{});
      const conditionTypes=forecasts.map(forecast=>forecast.weatherCondition?.type);
      const descriptions=forecasts.map(forecast=>forecast.weatherCondition?.description?.text);
      const precipitation=days.map(day=>day.daytimeForecast?.precipitation?.probability?.percent??day.precipitation?.probability?.percent);
      return {
       interval:{startTime:key},
       maxTemperature:{degrees:average(days.map(day=>day.maxTemperature?.degrees))},
       minTemperature:{degrees:average(days.map(day=>day.minTemperature?.degrees))},
       daytimeForecast:{
        weatherCondition:{type:mode(conditionTypes),description:{text:mode(descriptions)||"Regional forecast"}},
        precipitation:{probability:{percent:average(precipitation)}}
       }
      };
     });
     setWeather({current,daily:{forecastDays}});setLoading(false);
    }catch(x){setError(x?.message||"Unable to load Google Weather");setLoading(false);}
   };
   loadWeather();
   const id=window.setInterval(loadWeather,15*60*1000);
   return()=>window.clearInterval(id);
  },[apiKey]);
  const icon=type=>({CLEAR:"☀️",MOSTLY_CLEAR:"🌤️",PARTLY_CLOUDY:"⛅",MOSTLY_CLOUDY:"☁️",CLOUDY:"☁️",FOG:"🌫️",LIGHT_RAIN:"🌦️",RAIN:"🌧️",HEAVY_RAIN:"🌧️",LIGHT_SNOW:"🌨️",SNOW:"❄️",HEAVY_SNOW:"❄️",THUNDERSTORM:"⛈️"}[type]||"☁️");
  const current=weather?.current,daily=weather?.daily?.forecastDays||[];
  const description=current?.weatherCondition?.description?.text||error||(loading?"Loading Google Weather…":"Weather unavailable");
  const temp=current?.temperature?.degrees,feels=current?.feelsLikeTemperature?.degrees,rain=current?.precipitation?.probability?.percent;
  return <div className="live-weather-content" aria-live="polite">
   <div className="live-weather-location-bar">
    <span>LIVE WEATHER ☁️</span>
    <small className="live-weather-regional-label">GENERAL REGIONAL OUTLOOK · updates automatically</small>
   </div>
   <div className="live-weather-current">
    <div className="live-weather-current-main"><button type="button" className="live-weather-word-trigger live-weather-current-word" aria-label={"Weather condition: "+description} title={description}><span className="live-weather-icon" aria-hidden="true">{icon(current?.weatherCondition?.type)}</span><span className="live-weather-word-popup" role="tooltip">{description}</span></button><div><strong>{Number.isFinite(temp)?Math.round(temp)+"°C":"Live weather"}</strong><small>Regional average · feels like {Number.isFinite(feels)?Math.round(feels)+"°C":"—"}</small></div></div>
    <div className="live-weather-metrics"><span>💧 {Number.isFinite(current?.relativeHumidity)?Math.round(current.relativeHumidity):"—"}%</span><span>💨 {Number.isFinite(current?.wind?.speed?.value)?Math.round(current.wind.speed.value):"—"} km/h</span><span>🌧️ {Number.isFinite(rain)?Math.round(rain):"—"}% rain</span></div>
   </div>
   <div className="live-weather-days">{daily.map((day,index)=>{const forecast=day.daytimeForecast||day.nighttimeForecast||{};const high=day.maxTemperature?.degrees,low=day.minTemperature?.degrees,type=forecast.weatherCondition?.type,text=forecast.weatherCondition?.description?.text||"Regional forecast",p=forecast.precipitation?.probability?.percent;return <div className="live-weather-day" key={day.interval?.startTime||index}><strong>{index===0?"Today":new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"2-digit",month:"short",timeZone:"Africa/Nairobi"}).format(new Date(day.interval?.startTime||Date.now()))}</strong><button type="button" className="live-weather-day-condition live-weather-word-trigger" aria-label={"Regional forecast condition: "+text} title={text}><span className="live-weather-day-icon" aria-hidden="true">{icon(type)}</span><span className="live-weather-word-popup" role="tooltip">{text}</span></button><b>{high!=null?Math.round(high):"—"}° / {low!=null?Math.round(low):"—"}°</b><small>Rain {p!=null?Math.round(p):"—"}%</small></div>})}</div>
   <div className="live-weather-attribution"><span>GOOGLE WEATHER · LIVE REGIONAL OUTLOOK</span><small>{lastUpdated?`Google data updated ${new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Nairobi"}).format(new Date(lastUpdated))} · current conditions refresh approximately every 15 minutes.`:"Waiting for Google Weather data…"}</small></div>
  </div>;
}
const IRPA_SESSION_RECOVERY_KEY="irpaSessionRecovery";const IRPA_INACTIVITY_LIMIT_MS=10*60*1000;const IRPA_RECOVERY_MAX_AGE_MS=24*60*60*1000;function readIrpaRecovery(){try{const raw=window.localStorage.getItem(IRPA_SESSION_RECOVERY_KEY);if(!raw)return null;const value=JSON.parse(raw);if(!value||Date.now()-Number(value.savedAt||0)>IRPA_RECOVERY_MAX_AGE_MS){window.localStorage.removeItem(IRPA_SESSION_RECOVERY_KEY);return null}return value}catch{return null}}function writeIrpaRecovery(snapshot){try{window.localStorage.setItem(IRPA_SESSION_RECOVERY_KEY,JSON.stringify({...snapshot,savedAt:Date.now()}))}catch{}}\n\nfunction Shell({user,profile,admin,employee,inductionComplete,onInductionComplete}){const authorityCategories=resolveLoginCategories(profile,employee,admin);const[storedAuthority,setStoredAuthority]=useState(()=>{try{return window.sessionStorage.getItem("irpaActiveAccessAuthority")||window.sessionStorage.getItem("irpaPendingAccessAuthority")||""}catch{return""}});const selectedAuthority=admin?"ADMINISTRATOR":authorityCategories.includes(storedAuthority)?storedAuthority:(authorityCategories.length===1?authorityCategories[0]:"");const setSelectedAuthority=authority=>{if(admin||!authorityCategories.includes(authority)||authority===selectedAuthority)return;try{window.sessionStorage.setItem("irpaPendingAccessAuthority",authority);window.sessionStorage.removeItem("irpaActiveAccessAuthority")}catch{}setStoredAuthority("");setActiveAuthorityLoginRequired(true);setMobileNav("");setActive("Dashboard");void logout();};useEffect(()=>{if(admin||!selectedAuthority)return;try{window.sessionStorage.setItem("irpaActiveAccessAuthority",selectedAuthority);window.sessionStorage.removeItem("irpaPendingAccessAuthority")}catch{}},[admin,selectedAuthority]);const[activeAuthorityLoginRequired,setActiveAuthorityLoginRequired]=useState(false);const effectiveAuthority=admin?"ADMINISTRATOR":selectedAuthority;const authorityProfile=selectedAuthority?{roles:[selectedAuthority],role:selectedAuthority}:null;const authorityEmployee=selectedAuthority&&roleValues(employee?.roles||employee?.role).includes(selectedAuthority)?{roles:[selectedAuthority],role:selectedAuthority}:null;const financePortalAccess=admin||isFinancePortalMember(authorityProfile,authorityEmployee);const portalAccessFrozen=!admin&&!selectedAuthority;const[recoverySnapshot,setRecoverySnapshot]=useState(()=>readIrpaRecovery());const[recoveryMessage,setRecoveryMessage]=useState("");const[mobileNav,setMobileNav]=useState("");const[mobileTimeFormat,setMobileTimeFormat]=useState(()=>{try{return window.localStorage.getItem("irpa-mobile-time-format")==="12h"?"12h":"24h"}catch{return"24h"}});const[shellLiveNow,setShellLiveNow]=useState(()=>new Date());useEffect(()=>{const clockId=setInterval(()=>setShellLiveNow(new Date()),1000);return()=>clearInterval(clockId)},[]);const toggleMobileTimeFormat=()=>setMobileTimeFormat(previous=>{const next=previous==="24h"?"12h":"24h";try{window.localStorage.setItem("irpa-mobile-time-format",next)}catch{}return next});const liveDate=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",day:"2-digit",month:"long",year:"numeric"}).format(shellLiveNow);const liveDay=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",weekday:"long"}).format(shellLiveNow);const liveTime=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:mobileTimeFormat==="12h"}).format(shellLiveNow);const procurementPortalAccess=admin||isProcurementPortalMember(authorityProfile,authorityEmployee);const signatureProfileAccess=!admin&&(profile?.status==="Active"||employee?.status==="Active"||employee?.employmentStatus==="Active"||employee?.registrationStatus==="Activated");const meetingProfileAccess=!admin&&(profile?.status==="Active"||employee?.status==="Active"||employee?.employmentStatus==="Active"||employee?.registrationStatus==="Activated");const[active,setActive]=useState(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get("adminModule");const induction=params.get("induction")==="1";return admin&&requested&&ALL_MODULES.includes(requested)?requested:induction?"Induction and Orientation":"Dashboard"}),modules=admin?ALL_MODULES:(portalAccessFrozen?["Dashboard"]:memberModules(profile,employee,selectedAuthority));useEffect(()=>{\n  if(!user?.uid)return;\n  let lastActivity=Date.now();\n  let logoutInProgress=false;\n  const persist=()=>{lastActivity=Date.now();writeIrpaRecovery({uid:user.uid,email:user.email||"",active,authority:selectedAuthority,reason:"inactivity-or-interruption"});};\n  const activity=()=>{lastActivity=Date.now();};\n  const events=["pointerdown","keydown","touchstart","scroll","click","mousemove"];\n  events.forEach(type=>window.addEventListener(type,activity,{passive:true}));\n  const checkpoint=window.setInterval(()=>writeIrpaRecovery({uid:user.uid,email:user.email||"",active,authority:selectedAuthority,reason:"active-session-checkpoint"}),30000);\n  const interval=window.setInterval(async()=>{\n    if(logoutInProgress||Date.now()-lastActivity<IRPA_INACTIVITY_LIMIT_MS)return;\n    logoutInProgress=true;persist();\n    try{await logout({preserveRecovery:true});}catch(error){console.error("IRPA inactivity logout:",error);logoutInProgress=false;}\n  },15000);\n  const interruption=()=>writeIrpaRecovery({uid:user.uid,email:user.email||"",active,authority:selectedAuthority,reason:"browser-or-power-interruption"});\n  window.addEventListener("beforeunload",interruption);\n  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")interruption()});\n  return()=>{window.clearInterval(interval);window.clearInterval(checkpoint);events.forEach(type=>window.removeEventListener(type,activity));window.removeEventListener("beforeunload",interruption);};\n},[user?.uid,user?.email,active,selectedAuthority]);\nuseEffect(()=>{const handler=()=>onInductionComplete?.();window.addEventListener("irpa:induction-completed",handler);return()=>window.removeEventListener("irpa:induction-completed",handler)},[onInductionComplete]);useEffect(()=>{if(portalAccessFrozen&&active!=="Dashboard")setActive("Dashboard");else if(!modules.includes(active))setActive(modules[0]||"Dashboard")},[modules,active,portalAccessFrozen]);useEffect(()=>{const navigate=e=>{const detail=e?.detail;const target=typeof detail==="string"?detail:detail?.module;if(target&&modules.includes(target))setActive(target)};window.addEventListener("irpa:navigate",navigate);return()=>window.removeEventListener("irpa:navigate",navigate)},[modules]);const groups=Object.entries(NAV).map(([title,items])=>[title,items.filter(x=>modules.includes(x))]).filter(([,items])=>items.length);const NAV_ICONS={Dashboard:"home","Board Members Registration":"groups","Members & Personnel":"groups",Invitations:"mail",Meetings:"calendar",Resolutions:"check",Voting:"vote",Participants:"person-add","Authorization & Approvals":"check","Signature Platform":"signature","Induction and Orientation":"person-add","Induction Applications":"clipboard",Downloads:"download","Finance Portfolio":"finance",Procurement:"cart","Employee Payments":"finance",Reports:"analytics","Audit Trail":"audit",Settings:"settings","Add Administrator":"person-add",Documents:"document",Actions:"list","Risk Register":"risk"};
const NAV_ICON_PATHS={
home:<><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></>,
groups:<><circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3 20c.8-4 3-6 6-6s5.2 2 6 6"/><path d="M14 14c3.4.2 5.4 2.1 6 5"/></>,
mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
check:<><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/></>,
vote:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2"/></>,
"person-add":<><circle cx="9" cy="8" r="3.5"/><path d="M2.5 21c.8-4.5 3-6.5 6.5-6.5s5.7 2 6.5 6.5"/><path d="M18 8v6M15 11h6"/></>,
signature:<><path d="M3 17c3.5-5 5.5-6 7-4s2 3 4 1 3-5 6-5"/><path d="M4 21h16"/></>,
clipboard:<><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"/></>,
download:<><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/></>,
finance:<><path d="M4 6h16M4 18h16"/><path d="M7 6v12M17 6v12"/><circle cx="12" cy="12" r="2.5"/></>,
cart:<><path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/></>,
analytics:<><path d="M4 20V10M10 20V6M16 20V12M22 20V3"/></>,
audit:<><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5M8 17h8"/></>,
settings:<><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4"/></>,
document:<><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h6M9 16h6"/></>,
list:<><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
risk:<><path d="M12 3 21 7v5c0 5-3.5 8.5-9 10-5.5-1.5-9-5-9-10V7z"/><path d="m9 12 2 2 4-4"/></>
};
const navIcon=x=><svg className="nav-svg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{NAV_ICON_PATHS[NAV_ICONS[x]]||NAV_ICON_PATHS.document}</svg>;return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><img className="quote4-sidebar-logo" src="/irpa-logo.svg" alt="IRPA"/><div className="sidebar-brand-copy"><strong>IRPA</strong><span>Digital Governance</span><small>Improvement of Rangeland in Pastoral Areas</small></div></div><nav>{groups.map(([title,items])=><div className="nav-group"key={title}><div className="nav-group-title">{title}</div>{items.filter(x=>!PORTAL_CHILDREN_SET.has(x)).map(x=>{const children=PORTAL_CHILDREN[x]||[];const portalOpen=active===x||children.includes(active);return <React.Fragment key={x}><button className={active===x?"nav-item active":"nav-item"}onClick={()=>setActive(x)} aria-current={active===x?"page":undefined}><span className="nav-item-content"><b className="nav-item-icon" aria-hidden="true">{navIcon(x)}</b><span>{PORTAL_LABELS[x]||displayModuleName(x)}</span></span>{active===x&&<i/>}</button>{portalOpen&&children.map(child=><button key={child} className={active===child?"nav-item nav-child active":"nav-item nav-child"}onClick={()=>setActive(child)} aria-current={active===child?"page":undefined}><span className="nav-item-content"><b className="nav-item-icon" aria-hidden="true">{navIcon(child)}</b><span>{displayModuleName(child)}</span></span>{active===child&&<i/>}</button>)}</React.Fragment>})}</div>)}</nav><div className="sidebar-footer"><div className="secure-label">● Secure IRPA workspace</div><button className="logout-button"onClick={logout}>Sign Out</button></div></aside><section className="main-area"><header className={"topbar"+(active==="Dashboard"?" dashboard-topbar":"")}><div className="topbar-heading-row"><div className="topbar-title-block"><span className="topbar-kicker">IMPROVEMENT OF RANGELAND IN PASTORAL AREAS</span><div className="topbar-title-line"><h2>{displayModuleName(active)}</h2></div><p>Digital Board Governance Workspace</p></div><div className="topbar-access-category"><span>{admin?"IRPA PRIMARY ADMINISTRATOR":selectedAuthority?"ACTIVE ACCESS AUTHORITY · "+selectedAuthority:"IRPA AUTHORIZED USER"}</span><LoginCategoryBadges profile={profile} employee={employee} admin={admin} selectedAuthority={selectedAuthority}/>{!admin&&authorityCategories.length>1&&<div style={{marginTop:8}}><label style={{fontSize:9,fontWeight:800,letterSpacing:".08em",opacity:.75,display:"block"}}>OPERATING CAPACITY</label><select value={selectedAuthority} onChange={e=>setSelectedAuthority(e.target.value)} aria-label="Select current access authority" style={{marginTop:4,width:"100%",maxWidth:260}}><option value="">Select access authority</option>{authorityCategories.map(category=><option key={category} value={category}>{category}</option>)}</select><small style={{display:"block",marginTop:5,opacity:.72}}>Switching capacity ends this session and requires fresh authentication.</small></div>}<div className="mobile-access-live-date" aria-label="Live date and time"><strong>{liveDay}</strong><span>{liveDate}</span><b>{liveTime}</b><button type="button" onClick={toggleMobileTimeFormat} aria-label={"Change time format. Current format: "+mobileTimeFormat}>{mobileTimeFormat==="24h"?"24H":"12H"}</button></div></div><section className="open-portal-panel google-weather-panel" aria-label="Live Google Weather forecast"><span>LIVE WEATHER ☁️</span><LiveWeatherPanel/></section></div><div className="user-info"><div className="user-avatar">{(profile?.photoUrl||profile?.photoURL||profile?.avatarUrl||employee?.photoUrl||employee?.photoURL)?<img src={profile?.photoUrl||profile?.photoURL||profile?.avatarUrl||employee?.photoUrl||employee?.photoURL} alt={profile?.name||employee?.name||"IRPA User"}/>:((profile?.name||employee?.name||user.email||"I").slice(0,1).toUpperCase())}</div></div></header><main className={active==="Dashboard"?"content-area dashboard-content-area":"content-area"}><div className="operator-signout-slot"><button type="button" className="logout-button" onClick={logout} aria-label="Sign out of IRPA Digital Governance">Sign Out</button></div><WebAppNavigationRoller active={active} modules={modules} onNavigate={setActive}/>{portalAccessFrozen&&<div className="auth-message" role="alert" style={{marginBottom:16,border:"1px solid rgba(245,158,11,.55)",background:"rgba(245,158,11,.10)"}}><strong>{activeAuthorityLoginRequired?"FRESH LOGIN REQUIRED":"ACCESS AUTHORITY REQUIRED"}</strong><div style={{marginTop:6}}>{activeAuthorityLoginRequired?"Your previous access-authority session has ended. Sign in again to activate the newly selected operating capacity.":"Select your operating capacity above. The selected access authority will apply across all IRPA portals and role-specific functions remain frozen until a valid capacity is selected."}</div></div>}{recoverySnapshot&&recoverySnapshot.uid===user?.uid&&<div className="auth-message" role="status" style={{marginBottom:16}}><strong>SESSION RECOVERY AVAILABLE</strong><div style={{marginTop:6}}>{recoveryMessage||"A protected recovery record from your previous session is available. It stores your last portal and access-authority context, not passwords or authentication secrets."}</div><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}><button type="button" onClick={()=>{const canRecover=admin||!recoverySnapshot.authority||recoverySnapshot.authority===selectedAuthority;if(!canRecover){setRecoveryMessage("Select the same access authority category used by the interrupted session before recovery can continue.");return}if(recoverySnapshot.active&&modules.includes(recoverySnapshot.active))setActive(recoverySnapshot.active);setRecoveryMessage("Previous work context restored.");setRecoverySnapshot(null);try{window.localStorage.removeItem(IRPA_SESSION_RECOVERY_KEY)}catch{}}}>Recover previous work</button><button type="button" onClick={()=>{setRecoverySnapshot(null);try{window.localStorage.removeItem(IRPA_SESSION_RECOVERY_KEY)}catch{}}}>Discard recovery</button></div></div>}<PortalContentRoller active={active} modules={modules} onNavigate={setActive}/><ModuleInterlinkBar active={active} onNavigate={setActive} admin={admin} role={profile?.role} roles={resolveLoginCategories(profile,employee,admin)}/>{active==="Dashboard"&&<Dashboard user={user} admin={admin} employee={employee} profile={profile} onNavigate={setActive} selectedAuthority={effectiveAuthority} authorityCategories={authorityCategories}/>} {active==="Board Members Registration"&&<BoardMembers/>} {active==="Invitations"&&<Invitations/>} {active==="Members & Personnel"&&<Employees/>} {active==="Meetings"&&<Meetings onNavigate={setActive} admin={admin}/>} {active==="Resolutions"&&<Resolutions/>} {active==="Voting"&&<Voting/>} {active==="Participants"&&<OperationalGatewaysParticipants/>} {active==="Authorization & Approvals"&&<AuthorizationApprovals/>} {active==="Signature Platform"&&<SignaturePlatformWithUpload/>} {active==="Induction and Orientation"&&<InductionOrientation profile={profile} employee={employee}/>} {active==="Induction Applications"&&admin&&<InductionAdmin/>} {active==="Downloads"&&<Downloads/>} {active==="Finance Portfolio"&&(financePortalAccess?<FinancePortfolio profile={profile} employee={employee}/>:<AccessDenied user={user} reason="Finance Portal access is restricted to authorised Finance/Accounting personnel and designated approving officers."/>)} {active==="Procurement"&&(procurementPortalAccess?<ProcurementPortal profile={profile}/>:<AccessDenied user={user} reason="Procurement Portal access is restricted to authorised Procurement personnel and designated approving officers."/>)} {active==="External Auditor Portal"&&admin&&<ExternalAuditorPortal/>} {active==="Settings"&&<Settings admin={admin} section="settings"/>} {active==="Add Administrator"&&<AddAdministratorPortal/>} {CONFIGURED_MODULES.includes(active)&&<OperationalGateways module={active}/>} {active==="Employee Payments"&&<EmployeePayments profile={{...profile,...employee}}/>}</main><MobileGlobalNavigation mobileNav={mobileNav} setMobileNav={setMobileNav} active={active} setActive={setActive} modules={modules} groups={groups} admin={admin}/></section></div>}

function shortcut(){setMessage("");setBusy("shortcut");try{const blob=new Blob(["[InternetShortcut]\\r\\nURL="+window.location.origin+"\\r\\nIconIndex=0\\r\\n"],{type:"application/internet-shortcut"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="IRPA-Digital-Governance.url";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback("PC shortcut download started. Check your browser Downloads folder.");}catch(e){feedback("PC shortcut download failed: "+(e?.message||"Unknown error."))}finally{setBusy("")}}
function ExternalAuditorGateway(){const[email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[auditor,setAuditor]=useState(null);async function submit(e){e.preventDefault();setBusy(true);setMessage("");try{const clean=email.trim().toLowerCase();const u=await loginWithEmail(clean,password);const snap=await getDoc(doc(db,"auditorProfiles",clean));if(!snap.exists()||snap.data()?.active!==true)throw new Error("This email is not authorized as an active IRPA External Auditor. Contact the IRPA Administrator.");setAuditor({...snap.data(),uid:u.uid,email:clean});}catch(x){setMessage(x?.message||"External Auditor authentication failed.");}finally{setBusy(false)}}if(auditor)return <main className="content-area" style={{width:"100%"}}><ExternalAuditorPortal/></main>;return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>External Auditor Portal</h1><p>Read-only access to IRPA governance workflow evidence and reporting.</p></div><div className="auth-divider"><span>External Auditor Access</span></div><form onSubmit={submit}><label>Email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/><label>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/><button type="submit" disabled={busy}>{busy?"Authenticating…":"Enter External Auditor Portal"}</button></form>{message&&<div className="auth-message">{message}</div>}<div className="auth-links"><button className="text-button" type="button" onClick={()=>window.location.href=window.location.pathname}>Return to IRPA Sign In</button><button className="text-button" type="button" onClick={async()=>{if(!email.trim()){setMessage("Enter your auditor email address first.");return}try{await sendPasswordReset(email.trim());setMessage("Password reset email sent.");}catch(x){setMessage(x?.message||"Unable to send password reset email.")}}}>Forgot password?</button></div></section></main>}

export default function App(){
  const params=new URLSearchParams(window.location.search);
  const entryRoute=params.get("route")||"assistance";
  const adminGatewayMode=params.get("adminGateway")==="1"||entryRoute==="admin";
  const inductionMode=params.get("induction")==="1";
  const activationMode=inductionMode&&params.get("applicant")==="1"&&entryRoute==="subscription"&&Boolean(params.get("memberInvite"));
  const applicantInductionMode=inductionMode&&params.get("applicant")==="1"&&entryRoute==="assistance";
  const[user,setUser]=useState(undefined),
    [profile,setProfile]=useState(undefined),
    [employee,setEmployee]=useState(null),
    [inductionComplete,setInductionComplete]=useState(false),
    [error,setError]=useState(""),
    [signingEnvelopeId,setSigningEnvelopeId]=useState(
      ()=>window.sessionStorage.getItem("irpaSigningEnvelopeId")||
        new URLSearchParams(window.location.search).get("signEnvelope")||null
    );useEffect(()=>{
  const handler=e=>{
    const id=e?.detail?.envelopeId;
    if(id)setSigningEnvelopeId(id);
  };
  window.addEventListener("irpa:signing-invitation",handler);
  return()=>window.removeEventListener("irpa:signing-invitation",handler);
},[]);

useEffect(()=>{
  let disposed=false;

  // Resolve a Google redirect before relying on the auth-state callback.
  // This prevents Android/mobile browsers from returning to the gateway
  // without the application adopting the authenticated Firebase user.
  const resolveGoogleRedirect=async()=>{
    // Induction and Orientation is a parallel protocol. It must never adopt,
    // inspect, or mutate the primary login session.
    if(inductionMode&&!activationMode)return;
    // Always ask Firebase for a pending redirect result. Do not depend on
    // sessionStorage surviving the Google/Firebase cross-origin round trip.
    // Some Android browsers partition or clear sessionStorage during redirects.
    const expected=window.sessionStorage.getItem("irpaExpectedGoogleAdminEmail")||window.localStorage.getItem("irpaExpectedGoogleAdminEmail")||"irpa2412@gmail.com";
    try{
      const redirectedUser=await completeGoogleRedirect(expected);
      window.sessionStorage.removeItem("irpaAdminRedirectPending");
      window.localStorage.removeItem("irpaAdminRedirectPending");
      if(redirectedUser&&!disposed){
        setUser(redirectedUser);
        const actual=String(redirectedUser.email||"").trim().toLowerCase();
        if(actual==="irpa2412@gmail.com"){
          setProfile({
            uid:redirectedUser.uid,
            email:"irpa2412@gmail.com",
            name:"IRPA Primary Administrator",
            role:"Administrator",
            active:true,
            authorizationType:"administrator"
          });
          window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");
          window.localStorage.removeItem("irpaExpectedGoogleAdminEmail");
          if(new URLSearchParams(window.location.search).get("adminGateway")==="1"){
            window.history.replaceState({},document.title,window.location.pathname);
          }
        }
      }
    }catch(x){
      console.error("Google redirect completion:",x);
      window.sessionStorage.removeItem("irpaAdminRedirectPending");
      if(!disposed)setError(x.message||"Google administrator authentication could not be completed.");
    }
  };

  resolveGoogleRedirect();

  const unsubscribe=observeAuthState(async u=>{
    if(disposed)return;
    // The induction protocol is isolated from the primary authentication
    // observer. Its only destination is the Administrator review/LINK stage.
    if(inductionMode&&!activationMode)return;
    setUser(u);
    setProfile(undefined);
    setEmployee(null);
    setInductionComplete(false);
    setError("");
    if(!u){setProfile(null);return}
    try{
      // The designated primary administrator is resolved immediately after
      // Firebase authentication, independently of all member workflows.
      if(String(u.email||"").trim().toLowerCase()==="irpa2412@gmail.com"){
        setProfile({
          uid:u.uid,
          email:"irpa2412@gmail.com",
          name:"IRPA Primary Administrator",
          role:"Administrator",
          active:true,
          authorizationType:"administrator"
        });
        window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");
        window.sessionStorage.removeItem("irpaAdminRedirectPending");
        if(new URLSearchParams(window.location.search).get("adminGateway")==="1"){
          window.history.replaceState({},document.title,window.location.pathname);
        }
        return;
      }

      const adminDirect=await Promise.race([
        getAdminProfile(u.uid),
        new Promise((_,reject)=>window.setTimeout(()=>reject(new Error("Administrator authorization lookup timed out.")),3000))
      ]);
      if(adminDirect?.active===true){
        setProfile({...adminDirect,uid:u.uid,email:u.email||"",authorizationType:"administrator"});
        return;
      }

      const activeSigningId=
        window.sessionStorage.getItem("irpaSigningEnvelopeId")||
        new URLSearchParams(window.location.search).get("signEnvelope");

      if(activeSigningId){
        try{
          const envelope=await Promise.race([
            getSignatureEnvelope(activeSigningId),
            new Promise((_,reject)=>window.setTimeout(()=>reject(new Error("Signing invitation lookup timed out.")),3000))
          ]);
          const recipient=(envelope.recipients||[]).find(r=>r.uid===u.uid);
          if(!recipient)throw new Error("This account is not an invited signer for this document.");
          setSigningEnvelopeId(activeSigningId);
          setProfile({
            uid:u.uid,email:u.email||recipient.email||"",name:recipient.name||u.displayName||u.email||"Signing Participant",
            role:recipient.role||"Signer",roles:roleValues(recipient.roles||recipient.role||"Signer"),authorizationType:"signer",signingEnvelopeId:activeSigningId,signingRecipient:recipient
          });
          setEmployee(null);
          return;
        }catch(signingError){
          console.warn("Stale or unavailable signing invitation; continuing with normal IRPA authorization.",signingError);
          window.sessionStorage.removeItem("irpaSigningEnvelopeId");
          window.sessionStorage.removeItem("irpaSigningRecipient");
          setSigningEnvelopeId(null);
        }
      }

      // Member/employee authorization is resolved directly from Firebase.
      // The induction/tutorial workflow must never sit in the administrator
      // authentication path and must not depend on the external gateway.
      const loadMemberSession=async()=>{
        const withTimeout=(promise,ms,label)=>Promise.race([
          promise,new Promise((_,reject)=>window.setTimeout(()=>reject(new Error(label)),ms))
        ]);
        const [memberDirect,employeeDirect]=await Promise.all([
          withTimeout(getCurrentMemberProfile().catch(()=>null),5000,"Firebase member authorization lookup timed out."),
          withTimeout(getCurrentEmployeeProfile().catch(()=>null),5000,"Firebase employee authorization lookup timed out.")
        ]);
        if(!memberDirect&&!employeeDirect)throw new Error("No active IRPA authorization profile was found.");
        return {
          ok:true,
          uid:u.uid,
          email:u.email||memberDirect?.email||employeeDirect?.email||"",
          admin:null,
          member:memberDirect?.status==="Active"?memberDirect:null,
          employee:employeeDirect||null,
          authorizationSource:"firebase"
        };
      };

      const session=await loadMemberSession();
      let m=session.member;
      let activeEmployee=session.employee||null;
      const invitationId=new URLSearchParams(window.location.search).get("memberInvite");
      // An authenticated invitation activation must complete institutional
      // enrollment before the normal authorization gate is evaluated. Do this
      // for both Board Members and Employees; do not rely on the existence of
      // an unactivated register record as proof of enrollment.
      if(activationMode&&invitationId){
        await provisionCurrentMemberFromInvitationV2(invitationId);
        const refreshed=[await getCurrentMemberProfile().catch(()=>null),await getCurrentEmployeeProfile().catch(()=>null)];
        m=refreshed[0];
        activeEmployee=refreshed[1];
        window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
      }
      const activeMember = m?.status === "Active" ? m : null;
      if(!activeEmployee && session.employee) activeEmployee=session.employee;
      if(!activeMember && !activeEmployee){
        setError("This account has no active IRPA enrollment record.");
        setProfile(null);
        return;
      }
      // Employees are enrolled from the Employees Register and do not require
      // a duplicate members/{uid} authorization document. Use the employee
      // record as the canonical application profile when no member profile exists.
      const canonicalProfile = activeMember || activeEmployee;
      setProfile({...canonicalProfile, authorizationType:"member", enrollmentType:activeEmployee && !activeMember ? "employee" : "member"});
      setEmployee(activeEmployee);
      try{
        const induction=await Promise.race([
          getDoc(doc(db,"inductionRecords",u.uid)),
          new Promise((_,reject)=>window.setTimeout(()=>reject(new Error("Induction status check timed out.")),10000))
        ]);
        setInductionComplete(induction.exists()&&induction.data()?.status==="Completed");
      }catch(inductionError){
        console.warn("Induction status check unavailable",inductionError);
        setInductionComplete(false);
      }
    }catch(x){
      console.error(x);
      setError(x.message||"Unable to verify IRPA authorization.");
      setProfile(null);
    }
  });

  return()=>{disposed=true;unsubscribe()};
},[]);;

// Login watchdog: authorization must never leave the application permanently
// on the loading screen. The primary administrator is explicitly excluded:
// member/employee/induction authorization must never log out the administrator.
useEffect(()=>{
  const isPrimaryAdmin=String(user?.email||"").trim().toLowerCase()==="irpa2412@gmail.com";
  const isAdminGateway=new URLSearchParams(window.location.search).get("adminGateway")==="1";
  if(inductionMode||user===undefined||profile!==undefined||isPrimaryAdmin||isAdminGateway)return;
  const timer=window.setTimeout(async()=>{
    if(profile!==undefined)return;
    console.error("IRPA login watchdog: authorization did not complete.");
    try{await logout();}catch(_){}
    setEmployee(null);
    setProfile(null);
    setUser(null);
  },7000);
  return()=>window.clearTimeout(timer);
},[user,profile]);
useEffect(()=>{async function magic(){
  const adminGateway=new URLSearchParams(window.location.search).get("adminGateway")==="1";
  if(inductionMode)return;
  const invitationToken=new URL(window.location.href).searchParams.get("invitationToken");
  if(invitationToken){
    try{
      await completeInvitationToken(invitationToken);
      window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
    }catch(x){
      console.error(x);
      window.alert(x.message||"Unable to redeem the IRPA invitation.");
    }
    return;
  }
  if(!isMagicLink())return;

  let e=window.localStorage.getItem("irpaEmailForSignIn")||window.localStorage.getItem("irpaMemberEmailForSignIn");
  const url=new URL(window.location.href);
  const signingEnvelopeId=url.searchParams.get("signEnvelope");

  if(!e){
    const promptText=signingEnvelopeId
      ?"Enter the email address that received this IRPA signing invitation:"
      :"Enter the email address that received this IRPA sign-in link:";
    e=window.prompt(promptText);
    if(e){
      e=e.trim().toLowerCase();
      window.localStorage.setItem("irpaEmailForSignIn",e);
    }
  }

  if(!e)return;

  try{
    const result=await completeMagicLink(e);

    if(result?.signingEnvelopeId){
      window.sessionStorage.setItem("irpaSigningEnvelopeId",result.signingEnvelopeId);
      window.sessionStorage.setItem("irpaSigningRecipient",JSON.stringify(result.signingRecipient||{}));
      window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
      window.dispatchEvent(new CustomEvent("irpa:signing-invitation",{detail:{
        envelopeId:result.signingEnvelopeId,
        recipient:result.signingRecipient
      }}));
    }

    window.localStorage.removeItem("irpaEmailForSignIn");
    window.localStorage.removeItem("irpaMemberEmailForSignIn");
    if(adminGateway){
      window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
    }
  }catch(x){
    console.error(x);
    window.alert(x.message||"Unable to open the signing invitation.");
  }
}magic()},[]);const invitationId=params.get("memberInvite");if(adminGatewayMode&&!user)return <AuthScreen/>;if(applicantInductionMode)return <InductionOrientation/>;if(inductionMode&&params.get("applicant")==="1"&&entryRoute==="subscription"&&user===undefined)return <MemberActivationScreen invitationId={invitationId}/>;if(inductionMode&&user===undefined)return <AuthScreen/>;if(user===undefined)return <AuthScreen/>;if(profile===undefined)return <Loading/>;if(!user)return invitationId?<MemberActivationScreen invitationId={invitationId}/>:<AuthScreen/>;
if(!profile)return <AccessDenied user={user}reason={error}/>;
if(profile.authorizationType==="signer"){
  return <SignerShell user={user} profile={profile} signingEnvelopeId={signingEnvelopeId}/>;
}
return <Shell user={user} profile={profile} admin={profile.authorizationType==="administrator"} employee={employee} inductionComplete={inductionComplete} onInductionComplete={()=>setInductionComplete(true)}/>;
}