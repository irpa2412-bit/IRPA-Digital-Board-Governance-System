import React,{useEffect,useMemo,useState}from"react";import Invitations from"./pages/Invitations";import Employees from"./pages/Employees";import BoardMembers from"./pages/BoardMembers";import Members from"./pages/Members";import EmployeePayments from"./pages/EmployeePayments";import Meetings from"./pages/Meetings";import Resolutions from"./pages/Resolutions";import Voting from"./pages/Voting";import OperationalGateways from"./pages/OperationalGateways";import OperationalGatewaysParticipants from"./pages/OperationalGatewaysParticipants";import AuthorizationApprovals from"./pages/AuthorizationApprovals";import SignaturePlatformWithUpload from"./pages/SignaturePlatformWithUpload";import FinancePortfolio from"./pages/FinancePortfolio";import ProcurementPortal from"./pages/ProcurementPortal";import Settings from"./pages/Settings";import InductionOrientation from"./pages/InductionOrientation";import InductionAdmin from"./pages/InductionAdmin";import ModuleInterlinkBar from"./components/ModuleInterlinkBar";import{observeAuthState,loginWithEmail,loginWithGoogle,completeGoogleRedirect,registerWithEmail,sendPasswordReset,sendAdminMagicLink,isMagicLink,completeMagicLink,logout}from"./firebase/auth";import{getAdminProfile,getCurrentMemberProfile,getCurrentEmployeeProfile,getCurrentInductionContext,getRecords,COLLECTIONS}from"./firebase/data";import{getSignatureEnvelope}from"./firebase/signaturePlatform";import{provisionCurrentMemberFromInvitationV2}from"./firebase/invitationWorkflow";import{doc,getDoc}from"firebase/firestore";import{auth,db}from"./firebase/config";
const displayModuleName=m=>({"Dashboard":"Dashboard","Induction and Orientation":"Induction & Orientation Portal","Induction Applications":"Induction Applications Portal","Board Members Registration":"Board Members Registration Portal","Members & Personnel":"Members & Personnel Portal","Invitations":"Invitations Portal","Meetings":"Meeting Portal","Meeting Room":"Meeting Room Portal","Participants":"Participants Portal","Resolutions":"Resolutions Portal","Voting":"Voting Portal","Actions":"Actions Portal","Documents":"Documents Portal","Signature Platform":"Signature Portal","Decisions":"Decisions Portal","Risk Register":"Risk Register Portal","Authorization & Approvals":"Authorization & Approvals Portal","Employee Payments":"Employee Payments Portal","Finance Portfolio":"Finance Portal","Procurement":"Procurement Portal","Reports":"Reports Portal","Audit Trail":"Audit Trail Portal","Downloads":"Downloads Portal","Settings":"Settings Portal","Add Administrator":"Add Administrator Portal"}[m]||m);const roleValues=v=>Array.isArray(v)?v.flatMap(roleValues):String(v||"").split(",").map(x=>x.trim()).filter(Boolean);const hasRole=(p,roles)=>roleValues(p?.roles||p?.role).some(r=>roles.includes(r));
const NAV={GOVERNANCE:["Dashboard","Induction and Orientation","Induction Applications","Board Members Registration","Members & Personnel","Invitations","Meetings","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Risk Register","Authorization & Approvals","Employee Payments"],FINANCE:["Finance Portfolio","Procurement"],EVIDENCE:["Reports","Audit Trail"],SYSTEM:["Downloads","Settings","Add Administrator"]};const PORTAL_CHILDREN={Meetings:["Meeting Room","Participants","Resolutions","Voting","Actions","Decisions"],"Induction and Orientation":["Induction Applications"]};const PORTAL_CHILDREN_SET=new Set(Object.values(PORTAL_CHILDREN).flat());const PORTAL_LABELS={Meetings:"Meeting Portal","Induction and Orientation":"Induction & Orientation Portal"};const ALL_MODULES=[...new Set([...Object.values(NAV).flat(),...Object.values(PORTAL_CHILDREN).flat()])];const BASE_MEMBER_MODULES=["Dashboard","Meetings","Meeting Room","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Authorization & Approvals","Employee Payments","Induction and Orientation","Procurement","Reports","Downloads"];const FINANCE_ROLES=["Finance Personnel","Finance Manager","Accountant","Finance Officer","Executive Director","Director Finance & Administration"];const PROCUREMENT_ROLES=["Procurement Officer","Procurement Manager","Procurement Team Member"];const PROCUREMENT_APPROVAL_ROLES=["Executive Director","Director Livestock","Livestock Director","Director Internal Oversight","Internal Oversight Director","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Environment","Director Field","Director Operations","Operations Director","Outreach Director","Community Development Director","Environment Director","Field Director"];const HR_ROLES=["Executive Director","Director Human Resources","HR Manager"];const EXECUTIVE_DIRECTOR_MODULES=["Members & Personnel","Participants","Risk Register"];const CONFIGURED_MODULES=["Meeting Room","Actions","Documents","Decisions","Risk Register","Reports","Audit Trail"];const LOGIN_ROLE_OPTIONS=["Administrator","Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member","Executive Director","Director Internal Oversight","Director Livestock","Director Environment","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Field Operations","HR Manager","HR Officer","Finance Manager","Finance Officer","Accountant","Internal Oversight Officer","Rangeland Officer","Livestock Officer","Environment Officer","Outreach Officer","Community Development Officer","Programme/Technical Officer","Procurement Officer","Operations Manager","IT Specialist","Information Technology Officer","Driver","Field Assistant","Administrative Assistant","Communications Officer","Monitoring & Evaluation Officer","Project Officer","Management","Employee"];
function isFinancePortalMember(p,e){return hasRole(p,FINANCE_ROLES)||hasRole(e,FINANCE_ROLES)||(p?.department==="Finance & Administration"&&["Finance Unit","Accounting Unit"].includes(p?.unit))||(e?.department==="Finance & Administration"&&["Finance Unit","Accounting Unit"].includes(e?.unit));}function isProcurementPortalMember(p,e){return hasRole(p,PROCUREMENT_ROLES)||hasRole(p,PROCUREMENT_APPROVAL_ROLES)||hasRole(e,PROCUREMENT_ROLES)||hasRole(e,PROCUREMENT_APPROVAL_ROLES)||(p?.department==="Finance & Administration"&&p?.unit==="Procurement Unit")||(e?.department==="Finance & Administration"&&e?.unit==="Procurement Unit");}function memberModules(p,e){const roles=roleValues(p?.roles||p?.role).concat(roleValues(e?.roles||e?.role)),m=[...BASE_MEMBER_MODULES.filter(x=>x!=="Procurement")];if(isFinancePortalMember(p,e))m.splice(m.indexOf("Reports"),0,"Finance Portfolio");if(isProcurementPortalMember(p,e))m.splice(m.indexOf("Reports"),0,"Procurement");if(roles.some(r=>HR_ROLES.includes(r)))m.splice(m.indexOf("Reports"),0,"Members & Personnel");if(roles.includes("Executive Director"))m.push(...EXECUTIVE_DIRECTOR_MODULES);return[...new Set(m)]}
function MemberActivationScreen({invitationId}) {
  const[email,setEmail]=useState(""),[password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
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
  return <main className="auth-screen"><section className="auth-card"><div className="auth-logo-wrap"><img className="auth-logo" src="/irpa-logo-pitch.svg" alt="IRPA" /></div><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Activate Your IRPA Account</h1><p>Use the email address that received your invitation and create your permanent password for the IRPA Digital Board Governance System.</p></div><div className="auth-divider"><span>Invitation Activation</span></div><form onSubmit={activate}><label>Invited email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/><label>Create permanent password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8} autoComplete="new-password"/><label>Confirm password</label><input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={8} autoComplete="new-password"/><button type="submit" disabled={busy}>{busy?"Activating Account...":"Activate IRPA Account"}</button></form>{message&&<div className="auth-message">{message}</div>}<div className="auth-links"><button className="text-button" onClick={()=>window.location.href=window.location.origin} disabled={busy}>Return to Sign In</button></div></section></main>
}

function AuthScreen(){const params=new URLSearchParams(window.location.search);const adminGateway=params.get("adminGateway")==="1";const inductionMode=params.get("induction")==="1";const[mode,setMode]=useState("login"),[email,setEmail]=useState(()=>adminGateway?"irpa2412@gmail.com":(new URLSearchParams(window.location.search).get("adminEmail")||"")),[password,setPassword]=useState(""),[selectedRole,setSelectedRole]=useState(()=>adminGateway?"Administrator":""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[authCooldown,setAuthCooldown]=useState(0);useEffect(()=>{if(authCooldown<=0)return;const t=window.setInterval(()=>setAuthCooldown(v=>v>0?v-1:0),1000);return()=>window.clearInterval(t)},[authCooldown]);async function verifyRole(user){const emailValue=String(user?.email||"").trim().toLowerCase();if(adminGateway){const p=await getAdminProfile(user.uid);if(!(p?.active===true||emailValue==="irpa2412@gmail.com"))throw new Error("This account is not an active IRPA Administrator.");return;}if(inductionMode){await getCurrentInductionContext();return;}const [m,e]=await Promise.all([getCurrentMemberProfile().catch(()=>null),getCurrentEmployeeProfile().catch(()=>null)]);if(!(m?.status==="Active"||e))throw new Error("This account has no active IRPA registration. Complete Induction and Orientation or use your invitation activation link before signing in.");}async function submit(e){e.preventDefault();if(authCooldown>0){setMessage("Firebase has temporarily rate-limited password sign-in on this device. Do not keep retrying. Use Sign In with Google for an Administrator account, or wait for the Firebase block to clear and then use Forgot administrator password? if needed.");return}setBusy(true);setMessage("");try{if(adminGateway){const signedIn=await loginWithEmail(email,password);if(signedIn){await verifyRole(signedIn);window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");setMessage("Administrator authenticated. Opening the governance dashboard...");}}else if(mode==="register"){await registerWithEmail(email.trim(),password);setMessage("Account created. Please verify your email before continuing")}else {const signedIn=await loginWithEmail(email.trim(),password);await verifyRole(signedIn)}}catch(x){console.error("IRPA authentication failed:",x);const code=String(x?.code||"");const msg=String(x?.message||"Authentication failed.");if(code==="auth/too-many-requests"||msg.includes("auth/too-many-requests")){setAuthCooldown(60);setMessage("Firebase has temporarily blocked password sign-in from this device because of too many attempts. Stop retrying the password. For an Administrator account, use Sign In with Google now, or wait for the block to clear and then use Forgot administrator password? to establish a new password.");}else setMessage(msg)}finally{setBusy(false)}}async function reset(){if(!email.trim()){setMessage(adminGateway?"Enter the administrator email address first.":"Enter your registered IRPA email address first.");return}setBusy(true);setMessage("");try{await sendPasswordReset(email.trim());setMessage(adminGateway?"Password reset email sent. Open the newest reset email and create a new IRPA Administrator password.":"Credential assistance email sent. Open the newest reset email, create your password, then return to this IRPA sign-in page and sign in normally. Your existing administrator-registered identity remains unchanged.")}catch(x){const code=String(x?.code||"");if(code==="auth/too-many-requests")setMessage("Firebase is temporarily rate-limiting this device. Do not keep retrying. Wait for the block to clear before requesting another password reset.");else setMessage(x.message||"Unable to send password reset email.")}finally{setBusy(false)}}function openAdminGateway(){window.location.href=window.location.pathname+"?adminGateway=1"}function returnToSignIn(){window.location.href=window.location.pathname}return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Digital Board Governance</h1><p>Secure institutional governance, authorization, finance and employee management for Improvement of Rangeland in Pastoral Areas.</p></div><div className="auth-divider"><span>{adminGateway?"Administrator Gateway":inductionMode?"Induction and Orientation":mode==="login"?"Secure sign in":"Create account"}</span></div>{adminGateway&&<div className="auth-message" style={{marginBottom:16}}>Administrator accounts may sign in with their Google account. If password sign-in is temporarily blocked, use <strong>Sign In with Google</strong> instead of retrying the password.</div>}{inductionMode&&!adminGateway&&<div className="auth-message" style={{marginBottom:16}}><strong>Induction and Orientation — Login Assistance</strong><br/>This is a parallel assistance pathway for IRPA Members and Employees who are already registered by the Administrator. It does not create a new account or replace the normal sign-in gateway. If a password or other sign-in blocker prevents access, use <strong>Forgot password?</strong> below, then return here to complete your registered induction and orientation.</div>}<form onSubmit={submit}><label>Email address</label><input type="email"value={email}onChange={e=>setEmail(e.target.value)}required/><label>Password</label><input type="password"value={password}onChange={e=>setPassword(e.target.value)}required minLength={6}autoComplete="current-password"/><button type="submit"disabled={busy||authCooldown>0}>{busy?"Please wait...":authCooldown>0?"Password Sign In Temporarily Blocked ("+authCooldown+"s)":adminGateway?"Administrator Sign In":mode==="register"?"Create Account":"Sign In Securely"}</button></form><div className="auth-links">{adminGateway&&<><button type="button"className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{const signedIn=await loginWithGoogle("",{admin:true});await verifyRole(signedIn)}catch(x){setMessage(x.message||"Google administrator sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Sign In with Google</button><button type="button"className="text-button"onClick={reset}disabled={busy}>Forgot administrator password?</button><button type="button"className="text-button"onClick={returnToSignIn}disabled={busy}>Return to sign in</button></>}{!adminGateway&&<><button type="button"className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{const signedIn=await loginWithGoogle("");await verifyRole(signedIn)}catch(x){setMessage(x.message||"Google sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Continue with Google</button><button type="button"className="text-button"onClick={reset}disabled={busy}>Forgot password?</button><button type="button"className="secondary-button"onClick={()=>{window.location.href=window.location.pathname+"?induction=1&applicant=1&route=assistance"}}disabled={busy}>Induction & Orientation — Start Application</button><button type="button"className="text-button"onClick={openAdminGateway}disabled={busy}>Administrator Gateway</button><button type="button"className="text-button"onClick={()=>{setMode(mode==="login"?"register":"login");setMessage("")}}disabled={busy}>{mode==="login"?"Create a member account":"Return to sign in"}</button></>}</div>{message&&<div className="auth-message">{message}</div>}</section></main>}
function Loading(){const[slow,setSlow]=useState(false);useEffect(()=>{const t=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(t)},[]);return <div className="loading-screen"><div><strong>IRPA Digital Governance</strong><div className="loading-sub">{slow?"Authorization check is taking longer than expected.":"Establishing secure IRPA session..."}</div>{slow&&<button onClick={()=>window.location.reload()}>Retry Secure Session</button>}</div></div>}
function AccessDenied({user,reason}){return <main className="auth-screen"><section className="auth-card"><h1>Access Not Authorised</h1><p>{reason||"No active IRPA authorization profile was found."}</p><p className="muted">{user?.email}</p><button type="button" className="logout-button" onClick={logout} aria-label="Sign out of IRPA Digital Governance">Sign Out</button></section></main>}
function profileLabel(admin,employee){return admin?"Administrator":employee?.employeeNumber?("Authorized employee • "+employee.employeeNumber):"Authorized IRPA user"}
function resolveLoginCategories(profile,employee,admin){if(admin)return["ADMINISTRATOR"];const boardPosition=String(profile?.boardPosition||employee?.boardPosition||"").trim();const boardRoles=["Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member"];const normalize=v=>String(v||"").trim();const values=[...(Array.isArray(profile?.roles)?profile.roles:[]),...(Array.isArray(profile?.assignedRoles)?profile.assignedRoles:[]),...(Array.isArray(profile?.selectedRoles)?profile.selectedRoles:[]),...(Array.isArray(profile?.roleAssignments)?profile.roleAssignments:[]),profile?.role,employee?.role,...(Array.isArray(employee?.roles)?employee.roles:[]),...(Array.isArray(employee?.assignedRoles)?employee.assignedRoles:[]),...(Array.isArray(employee?.selectedRoles)?employee.selectedRoles:[]),...(Array.isArray(employee?.roleAssignments)?employee.roleAssignments:[])].map(normalize).filter(Boolean);const filtered=values.filter(v=>!(boardPosition&&boardRoles.includes(v)&&v!==boardPosition));if(boardPosition)filtered.unshift(boardPosition);return [...new Set(filtered)];}
function LoginCategoryBadges({profile,employee,admin}){const categories=resolveLoginCategories(profile,employee,admin);return <div aria-label="Login category" style={{marginTop:4}}><span style={{fontSize:10,fontWeight:800,letterSpacing:".08em",opacity:.72,display:"block"}}>LOGIN CATEGORY</span><div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>{categories.length?categories.map(category=><span key={category} style={{display:"inline-flex",alignItems:"center",padding:"3px 7px",borderRadius:999,fontSize:11,fontWeight:700,border:"1px solid currentColor",lineHeight:1.2}}>{category}</span>):<span style={{fontSize:11,opacity:.72}}>Authorized IRPA User</span>}</div></div>}
function Dashboard({admin,employee,profile,onNavigate}){const[stats,setStats]=useState({employees:0,members:0,meetings:0,authorizations:0,actions:0,risks:0,payments:0,signatures:0,reports:0});const[busy,setBusy]=useState(true);const role=String(profile?.role||"").toLowerCase();const isMember=!admin&&!employee?.employeeNumber&&/member|board/.test(role);useEffect(()=>{let live=true;(async()=>{try{if(admin){const names=[COLLECTIONS.employees,COLLECTIONS.members,COLLECTIONS.meetings,COLLECTIONS.authorizationRequests,COLLECTIONS.actions,COLLECTIONS.risks];const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));if(live)setStats({employees:v[0].length,members:v[1].length,meetings:v[2].length,authorizations:v[3].filter(x=>["Submitted","Under Review"].includes(x.status)).length,actions:v[4].filter(x=>!["Completed","Cancelled"].includes(x.status)).length,risks:v[5].filter(x=>!["Closed","Mitigated"].includes(x.status)).length,payments:0,signatures:0,reports:0});}else{const uid=auth.currentUser?.uid;const names=[COLLECTIONS.meetings,COLLECTIONS.actions,COLLECTIONS.authorizationRequests,COLLECTIONS.staffPaymentRequests,COLLECTIONS.signatures,COLLECTIONS.reports];const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));const mine=x=>x.uid===uid||x.employeeUid===uid||x.ownerUid===uid||x.requesterUid===uid||x.createdByUid===uid||x.assignedToUid===uid||x.signerUid===uid||x.recipientUid===uid||(Array.isArray(x.participantUids)&&x.participantUids.includes(uid));if(live)setStats({employees:0,members:0,meetings:v[0].filter(x=>mine(x)||x.status==="Scheduled"||x.status==="In Progress").length,authorizations:v[2].filter(x=>mine(x)&&["Submitted","Under Review"].includes(x.status)).length,actions:v[1].filter(x=>mine(x)&&!["Completed","Cancelled"].includes(x.status)).length,risks:0,payments:v[3].filter(x=>mine(x)&&!["Paid","Rejected","Cancelled"].includes(x.status)).length,signatures:v[4].filter(x=>mine(x)&&!["Completed","Signed","Declined"].includes(x.status)).length,reports:v[5].filter(x=>mine(x)&&!["Published","Archived"].includes(x.status)).length})}}finally{if(live)setBusy(false)}})();return()=>{live=false}},[admin,employee?.employeeNumber,profile?.role]);const go=target=>onNavigate?.(target);const cards=admin?[["Employees",stats.employees,"Current register","Members & Personnel"],["Members",stats.members,"Governance register","Members & Personnel"],["Meetings",stats.meetings,"Authoritative meeting register","Meetings"],["Induction & Orientation",0,"Applications received","Induction Applications"],["Pending Authorizations",stats.authorizations,"Awaiting action","Authorization & Approvals"],["Open Actions",stats.actions,"Implementation control","Actions"],["Active Risks",stats.risks,"Risk register","Risk Register"],["Reports",stats.reports,"Available reports","Reports"]]:isMember?[["My Meetings",stats.meetings,"Meeting register","Meetings"],["My Actions",stats.actions,"Implementation control","Actions"],["Pending Authorizations",stats.authorizations,"Awaiting action","Authorization & Approvals"],["Pending Signatures",stats.signatures,"Signature platform","Signature Platform"],["Reports",stats.reports,"Evidence workspace","Reports"],["Documents",0,"Governance documents","Documents"],["Resolutions",0,"Meeting decisions","Resolutions"],["Voting",0,"Active governance votes","Voting"]]:[["My Meetings",stats.meetings,"Meeting register","Meetings"],["Actions Assigned",stats.actions,"Implementation control","Actions"],["Pending Authorizations",stats.authorizations,"Awaiting action","Authorization & Approvals"],["My Payment Requests",stats.payments,"Payment workflow","Employee Payments"],["Pending Signatures",stats.signatures,"Signature platform","Signature Platform"],["Reports",stats.reports,"Evidence workspace","Reports"],["Documents",0,"Governance documents","Documents"],["Risk Register",0,"Assigned risk records","Risk Register"]];const iconFor=label=>({Employees:"👥",Members:"👥",Meetings:"▣","Induction & Orientation":"♟","Pending Authorizations":"✓","Open Actions":"☷","Active Risks":"⚠",Reports:"▥","People & Membership":"👥",Authorizations:"✓","Action Tracking":"☷","Risk Management":"⚠","Documents Portal":"▤","Finance Portal":"¤","Procurement Portal":"🛒","Reports & Analytics":"▥","Signature Portal":"✎","Employee Payments":"¤",Documents:"▤",Resolutions:"✓",Voting:"◉"}[label]||"•");const quick=admin?[["People & Membership","Members & Personnel","Manage members, staff and committees"],["Meetings","Meetings","Schedule, manage and record meetings"],["Induction & Orientation","Induction and Orientation","Application reception, review and onboarding"],["Authorizations","Authorization & Approvals","Approve and track pending items"],["Action Tracking","Actions","Monitor implementation progress"],["Risk Management","Risk Register","Identify and manage institutional risks"],["Documents Portal","Documents","Access and manage organisational documents"],["Finance Portal","Finance Portfolio","Budgets, transactions and financial reports"],["Procurement Portal","Procurement","Manage procurement processes"],["Reports & Analytics","Reports","View reports and governance analytics"]]:isMember?[["People & Membership","Members & Personnel","View people and governance records"],["Meetings","Meetings","Access meetings and connected branches"],["Induction & Orientation","Induction and Orientation","Complete induction and orientation"],["Documents Portal","Documents","Access authorised governance documents"],["Signature Portal","Signature Platform","Review and complete signatures"],["Reports & Analytics","Reports","View authorised reports"],["Resolutions","Resolutions","Review meeting resolutions"],["Voting","Voting","Participate in authorised votes"]]:[["People & Membership","Members & Personnel","Access authorised personnel records"],["Meetings","Meetings","Schedule and manage assigned meetings"],["Documents Portal","Documents","Access authorised governance documents"],["Finance Portal","Finance Portfolio","Access authorised finance workflows"],["Signature Portal","Signature Platform","Complete assigned signatures"],["Employee Payments","Employee Payments","Track payment requests"],["Reports & Analytics","Reports","View authorised reports"],["Risk Management","Risk Register","Review assigned risk records"]];return <div className="page dashboard-command"><section className="welcome-panel dashboard-hero"><div><span className="eyebrow">IRPA DIGITAL GOVERNANCE</span><h1>{admin?"Governance Command Dashboard":isMember?"Member Governance Dashboard":"Employee Governance Dashboard"}</h1><p>{admin?"Live institutional overview of people, meetings, authorizations, implementation actions and risks.":isMember?"Your authorised member governance workspace.":"Your authorised employee and governance workspace."}</p></div>{employee?.employeeNumber&&<div className="identity-card"><span>Employee Number</span><strong>{employee.employeeNumber}</strong></div>}</section><section className="dashboard-metrics"><div className="dashboard-section-heading"><span>{admin?"GOVERNANCE AT A GLANCE":"WORKSPACE AT A GLANCE"}</span></div><div className="dashboard-gauge-grid">{cards.map(([label,value,sub,target])=><button key={label} type="button" className={"dashboard-gauge "+(busy?"zero-value-card":value>0?"value-card":"zero-value-card")} onClick={()=>go(target)}><span className="dashboard-gauge-icon">{iconFor(label)}</span><span>{label}</span><strong>{busy?"—":value}</strong><small>{sub}</small><b>›</b></button>)}</div></section><section className="dashboard-quick-access"><div className="dashboard-section-heading"><span>QUICK ACCESS TO KEY GOVERNANCE FUNCTIONS</span><button type="button" onClick={()=>go(admin?"Meetings":"Meetings")}>VIEW PORTALS ›</button></div><div className="dashboard-function-grid">{quick.map(([label,target,desc])=><button key={target} type="button" className={"dashboard-function-button function-category-"+({["People & Membership"]:"people",["Induction & Orientation"]:"people",Meetings:"process",["Action Tracking"]:"process",Authorizations:"risk",["Risk Management"]:"risk",["Documents Portal"]:"information",["Reports & Analytics"]:"information",["Finance Portal"]:"finance",["Procurement Portal"]:"finance"}[label]||"process")} onClick={()=>go(target)}><span><i className="dashboard-function-icon">{iconFor(label)}</i>{label}</span><small>{desc}</small><b>›</b></button>)}</div></section><div className="dashboard-lower-grid"><section className="dashboard-feed"><div className="dashboard-feed-title"><span>RECENT ACTIVITY</span><button type="button" onClick={()=>go("Reports")}>VIEW ALL ›</button></div><div className="dashboard-empty">Live activity records will appear here as governance transactions are recorded.</div></section><section className="dashboard-feed"><div className="dashboard-feed-title"><span>SYSTEM NOTIFICATIONS</span><button type="button" onClick={()=>go(admin?"Audit Trail":"Reports")}>VIEW ALL ›</button></div><div className="dashboard-empty">Notifications and workflow alerts will appear here.</div></section></div></div>}
function Downloads(){const[installEvent,setInstallEvent]=useState(null);const[message,setMessage]=useState("");useEffect(()=>{const handler=e=>{e.preventDefault();setInstallEvent(e)};window.addEventListener("beforeinstallprompt",handler);return()=>window.removeEventListener("beforeinstallprompt",handler)},[]);async function install(){if(installEvent){await installEvent.prompt();const choice=await installEvent.userChoice;setMessage(choice?.outcome==="accepted"?"IRPA Digital Governance was added to your PC.":"Installation was cancelled.");setInstallEvent(null);return}setMessage("Your browser does not expose the automatic install prompt. Use the browser menu and choose “Install this site as an app” or “Apps → Install this site as an app”.")}function shortcut(){const blob=new Blob(["[InternetShortcut]\\r\\nURL="+window.location.origin+"\\r\\nIconIndex=0\\r\\n"],{type:"application/internet-shortcut"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="IRPA-Digital-Governance.url";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA DIGITAL GOVERNANCE</span><h1>Downloads & PC Access</h1><p>Install or download access resources for the IRPA Digital Board Governance System.</p></div><div className="identity-card"><span>Application</span><strong>Live</strong></div></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">DOWNLOAD CENTRE</span><h2>IRPA Application Downloads</h2><p className="muted">Choose the option you need. The live application remains securely hosted online.</p></div></div><div className="dashboard-grid" style={{marginTop:18}}><div className="stat-card"><span>INSTALL ON PC</span><strong>App</strong><small>Desktop-style browser installation</small><button type="button" style={{marginTop:12}} onClick={install}>{installEvent?"Install IRPA App":"Install / Add to PC"}</button></div><div className="stat-card"><span>PC SHORTCUT</span><strong>.URL</strong><small>Download a Windows Internet Shortcut</small><button type="button" className="secondary-button" style={{marginTop:12}} onClick={shortcut}>Download PC Shortcut</button></div><div className="stat-card"><span>ANDROID APP</span><strong>.APK</strong><small>Download and install IRPA Digital Governance on Android</small><a className="secondary-button" style={{display:"inline-block",marginTop:12,textDecoration:"none"}} href="https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/35520435278" target="_blank" rel="noreferrer">Download Android APK</a></div><div className="stat-card"><span>SOURCE PACKAGE</span><strong>.ZIP</strong><small>Download the current GitHub source package</small><a className="secondary-button" style={{display:"inline-block",marginTop:12,textDecoration:"none"}} href="https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/archive/refs/heads/main.zip" target="_blank" rel="noreferrer">Download Source ZIP</a></div></div>{message&&<div className="auth-message" style={{marginTop:18}}>{message}</div>}<div className="form-actions" style={{marginTop:18}}><button type="button" onClick={()=>window.open(window.location.origin,"_blank","noopener,noreferrer")}>Open Live Application</button><button type="button" className="secondary-button" onClick={()=>{window.location.href=window.location.origin}}>Return to Application</button></div></section></div>}
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


function MobileGlobalNavigation({mobileNav,setMobileNav,active,setActive,modules,groups,admin}){const go=target=>{setMobileNav("");setActive(target)};const portalItems=[["Meeting Portal","Meetings"],["Members & Personnel Portal","Members & Personnel"],["Invitations Portal","Invitations"],["Documents Portal","Documents"],["Finance Portal","Finance Portfolio"],["Signature Portal","Signature Platform"],["Authorization & Approvals Portal","Authorization & Approvals"],["Employee Payments Portal","Employee Payments"],["Reports Portal","Reports"],["Audit Trail Portal","Audit Trail"],["Induction & Orientation Portal","Induction and Orientation"]].filter(([,target])=>modules.includes(target));const menuItems=groups.flatMap(([,items])=>items.filter(x=>!PORTAL_CHILDREN_SET.has(x)));return <><div className="mobile-global-nav"><button className={active==="Dashboard"&&!mobileNav?"active":""} type="button" onClick={()=>go("Dashboard")}>Home</button><button className={mobileNav==="portals"?"active":""} type="button" onClick={()=>setMobileNav(mobileNav==="portals"?"":"portals")}>Portals</button><button className={mobileNav==="alerts"?"active":""} type="button" onClick={()=>setMobileNav(mobileNav==="alerts"?"":"alerts")}>Alerts</button><button className={mobileNav==="menu"?"active":""} type="button" onClick={()=>setMobileNav(mobileNav==="menu"?"":"menu")}>☰ Menu</button></div>{mobileNav&&<div className="mobile-nav-sheet" role="dialog" aria-label="Mobile navigation"><div className="mobile-nav-sheet-header"><strong>{mobileNav==="portals"?"Portals":mobileNav==="alerts"?"Attention Required":"Navigation"}</strong><div style={{display:"flex",gap:8}}><button type="button" className="logout-button" onClick={logout}>Sign Out</button><button type="button" onClick={()=>setMobileNav("")}>Close</button></div></div>{mobileNav==="portals"&&<div className="mobile-nav-sheet-list">{portalItems.map(([label,target])=><button key={target} type="button" onClick={()=>go(target)}><span>{label}</span><b>›</b></button>)}</div>}{mobileNav==="alerts"&&<div className="mobile-nav-sheet-list"><button type="button" onClick={()=>go("Authorization & Approvals")}><span>Pending Authorizations</span><b>›</b></button><button type="button" onClick={()=>go("Actions")}><span>Open Actions</span><b>›</b></button>{admin&&<button type="button" onClick={()=>go("Induction Applications")}><span>Induction Applications</span><b>›</b></button>}</div>}{mobileNav==="menu"&&<div className="mobile-nav-sheet-list">{menuItems.map(x=><button key={x} type="button" onClick={()=>go(x)}><span>{PORTAL_LABELS[x]||displayModuleName(x)}</span><b>›</b></button>)}</div>}</div>}</>}

function Shell({user,profile,admin,employee,inductionComplete,onInductionComplete}){const financePortalAccess=admin||isFinancePortalMember(profile,employee);const[mobileNav,setMobileNav]=useState("");const procurementPortalAccess=admin||isProcurementPortalMember(profile,employee);const boardSignatureAccess=!admin&&Boolean((profile?.boardMember||employee?.boardMember)&&profile?.status==="Active");const[active,setActive]=useState(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get("adminModule");const induction=params.get("induction")==="1";return admin&&requested&&ALL_MODULES.includes(requested)?requested:induction?"Induction and Orientation":"Dashboard"}),modules=admin?ALL_MODULES:(inductionComplete?memberModules(profile,employee):["Induction and Orientation",...(boardSignatureAccess?["Signature Platform"]:[])]);useEffect(()=>{const handler=()=>onInductionComplete?.();window.addEventListener("irpa:induction-completed",handler);return()=>window.removeEventListener("irpa:induction-completed",handler)},[onInductionComplete]);useEffect(()=>{if(!modules.includes(active))setActive("Dashboard")},[profile?.role,profile?.boardMember,employee?.boardMember,inductionComplete,admin,active]);useEffect(()=>{const navigate=e=>{const detail=e?.detail;const target=typeof detail==="string"?detail:detail?.module;if(target&&modules.includes(target))setActive(target)};window.addEventListener("irpa:navigate",navigate);return()=>window.removeEventListener("irpa:navigate",navigate)},[modules]);const groups=Object.entries(NAV).map(([title,items])=>[title,items.filter(x=>modules.includes(x))]).filter(([,items])=>items.length);const NAV_ICONS={Dashboard:"home","Board Members Registration":"groups","Members & Personnel":"groups",Invitations:"mail",Meetings:"calendar",Resolutions:"check",Voting:"vote",Participants:"person-add","Authorization & Approvals":"check","Signature Platform":"signature","Induction and Orientation":"person-add","Induction Applications":"clipboard",Downloads:"download","Finance Portfolio":"finance",Procurement:"cart","Employee Payments":"finance",Reports:"analytics","Audit Trail":"audit",Settings:"settings","Add Administrator":"person-add",Documents:"document",Actions:"list","Risk Register":"risk"};
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
const navIcon=x=><svg className="nav-svg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{NAV_ICON_PATHS[NAV_ICONS[x]]||NAV_ICON_PATHS.document}</svg>;return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><div className="sidebar-brand-copy"><strong>IRPA</strong><span>Digital Governance</span><small>Improvement of Rangeland in Pastoral Areas</small></div></div><div className="authority-card"><span>{admin?"ADMINISTRATOR":"AUTHORIZED USER"}</span><LoginCategoryBadges profile={profile} employee={employee} admin={admin}/>{employee?.employeeNumber&&<small>{employee.employeeNumber}</small>}</div><nav>{groups.map(([title,items])=><div className="nav-group"key={title}><div className="nav-group-title">{title}</div>{items.filter(x=>!PORTAL_CHILDREN_SET.has(x)).map(x=>{const children=PORTAL_CHILDREN[x]||[];const portalOpen=active===x||children.includes(active);return <React.Fragment key={x}><button className={active===x?"nav-item active":"nav-item"}onClick={()=>setActive(x)}><span className="nav-item-content"><b className="nav-item-icon" aria-hidden="true">{navIcon(x)}</b><span>{PORTAL_LABELS[x]||displayModuleName(x)}</span></span>{active===x&&<i/>}</button>{portalOpen&&children.map(child=><button key={child} className={active===child?"nav-item nav-child active":"nav-item nav-child"}onClick={()=>setActive(child)}><span className="nav-item-content"><b className="nav-item-icon" aria-hidden="true">{navIcon(child)}</b><span>{displayModuleName(child)}</span></span>{active===child&&<i/>}</button>)}</React.Fragment>})}</div>)}</nav><div className="sidebar-footer"><div className="secure-label">● Secure IRPA workspace</div><button className="logout-button"onClick={logout}>Sign Out</button></div></aside><section className="main-area"><header className="topbar"><div className="topbar-heading-row"><button type="button" className="global-home-button" disabled={active==="Dashboard"} onClick={()=>{setMobileNav("");setActive("Dashboard")}} aria-label="Return to Home">⌂ Home</button><div><span className="topbar-kicker">IMPROVEMENT OF RANGELAND IN PASTORAL AREAS</span><h2>{displayModuleName(active)}</h2><p>Digital Board Governance Workspace</p></div></div><div className="user-info"><div className="user-avatar">{(profile?.name||user.email||"I").slice(0,1).toUpperCase()}</div><div><strong>{profile?.name||"IRPA User"}</strong><LoginCategoryBadges profile={profile} employee={employee} admin={admin}/></div><button type="button" className="logout-button" onClick={logout} aria-label="Sign out of IRPA Digital Governance">Sign Out</button></div></header><main className={active==="Dashboard"?"content-area dashboard-content-area":"content-area"}><ModuleInterlinkBar active={active} onNavigate={setActive} admin={admin} role={profile?.role} roles={resolveLoginCategories(profile,employee,admin)}/>{active==="Dashboard"&&<Dashboard admin={admin} employee={employee} profile={profile} onNavigate={setActive}/>} {active==="Board Members Registration"&&<BoardMembers/>} {active==="Invitations"&&<Invitations/>} {active==="Members & Personnel"&&<Employees/>} {active==="Meetings"&&<Meetings onNavigate={setActive}/>} {active==="Resolutions"&&<Resolutions/>} {active==="Voting"&&<Voting/>} {active==="Participants"&&<OperationalGatewaysParticipants/>} {active==="Authorization & Approvals"&&<AuthorizationApprovals/>} {active==="Signature Platform"&&<SignaturePlatformWithUpload/>} {active==="Induction and Orientation"&&<InductionOrientation profile={profile} employee={employee}/>} {active==="Induction Applications"&&admin&&<InductionAdmin/>} {active==="Downloads"&&<Downloads/>} {active==="Finance Portfolio"&&(financePortalAccess?<FinancePortfolio profile={profile} employee={employee}/>:<AccessDenied user={user} reason="Finance Portal access is restricted to authorised Finance/Accounting personnel and designated approving officers."/>)} {active==="Procurement"&&(procurementPortalAccess?<ProcurementPortal profile={profile}/>:<AccessDenied user={user} reason="Procurement Portal access is restricted to authorised Procurement personnel and designated approving officers."/>)} {active==="Settings"&&<Settings admin={admin} section="settings"/>} {active==="Add Administrator"&&<Settings admin={admin} section="administrators"/>} {CONFIGURED_MODULES.includes(active)&&<OperationalGateways module={active}/>} {active==="Employee Payments"&&<EmployeePayments profile={{...profile,...employee}}/>}</main><MobileGlobalNavigation mobileNav={mobileNav} setMobileNav={setMobileNav} active={active} setActive={setActive} modules={modules} groups={groups} admin={admin}/></section></div>}

function shortcut(){setMessage("");setBusy("shortcut");try{const blob=new Blob(["[InternetShortcut]\\r\\nURL="+window.location.origin+"\\r\\nIconIndex=0\\r\\n"],{type:"application/internet-shortcut"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="IRPA-Digital-Governance.url";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback("PC shortcut download started. Check your browser Downloads folder.");}catch(e){feedback("PC shortcut download failed: "+(e?.message||"Unknown error."))}finally{setBusy("")}}
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
  if(adminGateway)return;
  if(inductionMode)return;
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
  }catch(x){
    console.error(x);
    window.alert(x.message||"Unable to open the signing invitation.");
  }
}magic()},[]);const invitationId=params.get("memberInvite");if(adminGatewayMode)return <AuthScreen/>;if(applicantInductionMode)return <InductionOrientation/>;if(inductionMode&&params.get("applicant")==="1"&&entryRoute==="subscription"&&user===undefined)return <MemberActivationScreen invitationId={invitationId}/>;if(inductionMode&&user===undefined)return <AuthScreen/>;if(user===undefined)return <AuthScreen/>;if(profile===undefined)return <Loading/>;if(!user)return invitationId?<MemberActivationScreen invitationId={invitationId}/>:<AuthScreen/>;
if(!profile)return <AccessDenied user={user}reason={error}/>;
if(profile.authorizationType==="signer"){
  return <SignerShell user={user} profile={profile} signingEnvelopeId={signingEnvelopeId}/>;
}
return <Shell user={user} profile={profile} admin={profile.authorizationType==="administrator"} employee={employee} inductionComplete={inductionComplete} onInductionComplete={()=>setInductionComplete(true)}/>;
}