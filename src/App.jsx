import React,{useEffect,useMemo,useState}from"react";import Invitations from"./pages/Invitations";import Employees from"./pages/Employees";import BoardMembers from"./pages/BoardMembers";import Members from"./pages/Members";import EmployeePayments from"./pages/EmployeePayments";import Meetings from"./pages/Meetings";import Resolutions from"./pages/Resolutions";import Voting from"./pages/Voting";import OperationalGateways from"./pages/OperationalGateways";import OperationalGatewaysParticipants from"./pages/OperationalGatewaysParticipants";import AuthorizationApprovals from"./pages/AuthorizationApprovals";import SignaturePlatformWithUpload from"./pages/SignaturePlatformWithUpload";import FinancePortfolio from"./pages/FinancePortfolio";import ProcurementPortal from"./pages/ProcurementPortal";import Settings from"./pages/Settings";import InductionOrientation from"./pages/InductionOrientation";import InductionAdmin from"./pages/InductionAdmin";import ModuleInterlinkBar from"./components/ModuleInterlinkBar";import{observeAuthState,loginWithEmail,loginWithGoogle,completeGoogleRedirect,registerWithEmail,sendPasswordReset,sendAdminMagicLink,isMagicLink,completeMagicLink,logout,ensureInductionAnonymousSession}from"./firebase/auth";import{getAdminProfile,getCurrentMemberProfile,getCurrentEmployeeProfile,getCurrentInductionContext,getRecords,COLLECTIONS}from"./firebase/data";import{getSignatureEnvelope}from"./firebase/signaturePlatform";import{provisionCurrentMemberFromInvitationV2}from"./firebase/invitationWorkflow";import{doc,getDoc}from"firebase/firestore";import{auth,db}from"./firebase/config";
const displayModuleName=m=>({"Finance Portfolio":"Finance Portal","Procurement":"Procurement Portal","Meetings":"Meeting Portal","Signature Platform":"Signature Portal"}[m]||m);const roleValues=v=>Array.isArray(v)?v.flatMap(roleValues):String(v||"").split(",").map(x=>x.trim()).filter(Boolean);const hasRole=(p,roles)=>roleValues(p?.roles||p?.role).some(r=>roles.includes(r));
const NAV={GOVERNANCE:["Dashboard","Induction and Orientation","Induction Applications","Board Members Registration","Members & Personnel","Invitations","Participants","Meetings","Meetings","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Risk Register","Authorization & Approvals","Employee Payments"],FINANCE:["Finance Portfolio","Procurement"],EVIDENCE:["Reports","Audit Trail"],SYSTEM:["Downloads","Settings","Add Administrator"]};const ALL_MODULES=Object.values(NAV).flat();const BASE_MEMBER_MODULES=["Dashboard","Meetings","Meeting Room","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Authorization & Approvals","Employee Payments","Induction and Orientation","Procurement","Reports","Downloads"];const FINANCE_ROLES=["Finance Personnel","Finance Manager","Accountant","Finance Officer","Executive Director","Director Finance & Administration"];const PROCUREMENT_ROLES=["Procurement Officer","Procurement Manager","Procurement Team Member"];const PROCUREMENT_APPROVAL_ROLES=["Executive Director","Director Livestock","Livestock Director","Director Internal Oversight","Internal Oversight Director","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Environment","Director Field","Director Operations","Operations Director","Outreach Director","Community Development Director","Environment Director","Field Director"];const HR_ROLES=["Executive Director","Director Human Resources","HR Manager"];const EXECUTIVE_DIRECTOR_MODULES=["Members & Personnel","Participants","Risk Register"];const CONFIGURED_MODULES=["Meeting Room","Actions","Documents","Decisions","Risk Register","Reports","Audit Trail"];const LOGIN_ROLE_OPTIONS=["Administrator","Board Chairperson","Board Vice Chairperson","Board Secretary","Board Treasurer","Board Member","Executive Director","Director Internal Oversight","Director Livestock","Director Environment","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Field Operations","HR Manager","HR Officer","Finance Manager","Finance Officer","Accountant","Internal Oversight Officer","Rangeland Officer","Livestock Officer","Environment Officer","Outreach Officer","Community Development Officer","Programme/Technical Officer","Procurement Officer","Operations Manager","IT Specialist","Information Technology Officer","Driver","Field Assistant","Administrative Assistant","Communications Officer","Monitoring & Evaluation Officer","Project Officer","Management","Employee"];
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
      const {registerWithEmail}=await import("./firebase/auth");
      await registerWithEmail(clean,password);
      await provisionCurrentMemberFromInvitationV2(invitationId);
      window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
      window.location.reload();
    }catch(x){if(x?.code==="auth/email-already-in-use"||String(x?.message||"").includes("email-already-in-use")){try{await sendPasswordReset(clean);setMessage("An IRPA account already exists for this email. A password-reset email has been sent. Set your password there, then return to the IRPA sign-in page.");}catch(resetError){setMessage(resetError.message||"An account already exists. Use Forgot password? on the sign-in page to set your password.");}}else setMessage(x.message||"Unable to activate the IRPA account.");}
    finally{setBusy(false)}
  }
  return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Activate Your IRPA Account</h1><p>Use the email address that received your invitation and create your permanent password for the IRPA Digital Board Governance System.</p></div><div className="auth-divider"><span>Invitation Activation</span></div><form onSubmit={activate}><label>Invited email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/><label>Create permanent password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8} autoComplete="new-password"/><label>Confirm password</label><input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={8} autoComplete="new-password"/><button type="submit" disabled={busy}>{busy?"Activating Account...":"Activate IRPA Account"}</button></form>{message&&<div className="auth-message">{message}</div>}<div className="auth-links"><button className="text-button" onClick={()=>window.location.href=window.location.origin} disabled={busy}>Return to Sign In</button></div></section></main>
}

function AuthScreen(){const params=new URLSearchParams(window.location.search);const adminGateway=params.get("adminGateway")==="1";const inductionMode=params.get("induction")==="1";
  const applicantInductionMode=params.get("applicant")==="1";const[mode,setMode]=useState("login"),[email,setEmail]=useState(()=>adminGateway?"irpa2412@gmail.com":(new URLSearchParams(window.location.search).get("adminEmail")||"")),[password,setPassword]=useState(""),[selectedRole,setSelectedRole]=useState(()=>adminGateway?"Administrator":""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[authCooldown,setAuthCooldown]=useState(0);useEffect(()=>{if(authCooldown<=0)return;const t=window.setInterval(()=>setAuthCooldown(v=>v>0?v-1:0),1000);return()=>window.clearInterval(t)},[authCooldown]);async function verifyRole(user){const emailValue=String(user?.email||"").trim().toLowerCase();if(adminGateway){const p=await getAdminProfile(user.uid);if(!(p?.active===true||emailValue==="irpa2412@gmail.com"))throw new Error("This account is not an active IRPA Administrator.");return;}if(inductionMode){await getCurrentInductionContext();return;}const [m,e]=await Promise.all([getCurrentMemberProfile().catch(()=>null),getCurrentEmployeeProfile().catch(()=>null)]);if(!(m?.status==="Active"||e))throw new Error("This account has no active IRPA registration. Complete Induction and Orientation or use your invitation activation link before signing in.");}async function submit(e){e.preventDefault();if(authCooldown>0){setMessage("Firebase has temporarily rate-limited password sign-in on this device. Do not keep retrying. Use Sign In with Google for an Administrator account, or wait for the Firebase block to clear and then use Forgot administrator password? if needed.");return}setBusy(true);setMessage("");try{if(adminGateway){const signedIn=await loginWithEmail(email,password);if(signedIn){await verifyRole(signedIn);window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");setMessage("Administrator authenticated. Opening the governance dashboard...");}}else if(mode==="register"){await registerWithEmail(email.trim(),password);setMessage("Account created. Please verify your email before continuing")}else {const signedIn=await loginWithEmail(email.trim(),password);await verifyRole(signedIn)}}catch(x){console.error("IRPA authentication failed:",x);const code=String(x?.code||"");const msg=String(x?.message||"Authentication failed.");if(code==="auth/too-many-requests"||msg.includes("auth/too-many-requests")){setAuthCooldown(60);setMessage("Firebase has temporarily blocked password sign-in from this device because of too many attempts. Stop retrying the password. For an Administrator account, use Sign In with Google now, or wait for the block to clear and then use Forgot administrator password? to establish a new password.");}else setMessage(msg)}finally{setBusy(false)}}async function reset(){if(!email.trim()){setMessage("Enter the administrator email address first.");return}setBusy(true);setMessage("");try{await sendPasswordReset(email.trim());setMessage("Password reset email sent. Open the newest reset email and create a new IRPA Administrator password.")}catch(x){const code=String(x?.code||"");if(code==="auth/too-many-requests")setMessage("Firebase is temporarily rate-limiting this device. Do not keep retrying. Wait for the block to clear before requesting another password reset.");else setMessage(x.message||"Unable to send password reset email.")}finally{setBusy(false)}}function openAdminGateway(){window.location.href=window.location.pathname+"?adminGateway=1"}function returnToSignIn(){window.location.href=window.location.pathname}return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Digital Board Governance</h1><p>Secure institutional governance, authorization, finance and employee management for Improvement of Rangeland in Pastoral Areas.</p></div><div className="auth-divider"><span>{adminGateway?"Administrator Gateway":inductionMode?"Induction and Orientation":mode==="login"?"Secure sign in":"Create account"}</span></div>{adminGateway&&<div className="auth-message" style={{marginBottom:16}}>Administrator accounts may sign in with their Google account. If password sign-in is temporarily blocked, use <strong>Sign In with Google</strong> instead of retrying the password.</div>}{inductionMode&&!adminGateway&&<div className="auth-message" style={{marginBottom:16}}><strong>Induction and Orientation</strong><br/>No IRPA account, password or prior credentials are required. New members and employees can complete this enrollment directly; the system creates the secure account record during submission and routes it for administrator LINK.</div>}<form onSubmit={submit}><label>Email address</label><input type="email"value={email}onChange={e=>setEmail(e.target.value)}required/><label>Password</label><input type="password"value={password}onChange={e=>setPassword(e.target.value)}required minLength={6}autoComplete="current-password"/><button type="submit"disabled={busy||authCooldown>0}>{busy?"Please wait...":authCooldown>0?"Password Sign In Temporarily Blocked ("+authCooldown+"s)":adminGateway?"Administrator Sign In":mode==="register"?"Create Account":"Sign In Securely"}</button></form><div className="auth-links">{adminGateway&&<><button type="button"className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{const signedIn=await loginWithGoogle("",{admin:true});await verifyRole(signedIn)}catch(x){setMessage(x.message||"Google administrator sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Sign In with Google</button><button type="button"className="text-button"onClick={reset}disabled={busy}>Forgot administrator password?</button><button type="button"className="text-button"onClick={returnToSignIn}disabled={busy}>Return to sign in</button></>}{!adminGateway&&<><button type="button"className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{const signedIn=await loginWithGoogle("");await verifyRole(signedIn)}catch(x){setMessage(x.message||"Google sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Continue with Google</button><button type="button"className="text-button"onClick={reset}disabled={busy}>Forgot password?</button><button type="button"className="text-button"onClick={()=>{window.location.href=window.location.pathname+"?induction=1&applicant=1"}}disabled={busy}>{inductionMode?"Induction and Orientation":"Induction and Orientation"}</button><button type="button"className="text-button"onClick={openAdminGateway}disabled={busy}>Administrator Gateway</button><button type="button"className="text-button"onClick={()=>{setMode(mode==="login"?"register":"login");setMessage("")}}disabled={busy}>{mode==="login"?"Create a member account":"Return to sign in"}</button></>}</div>{message&&<div className="auth-message">{message}</div>}</section></main>}
function Loading(){const[slow,setSlow]=useState(false);useEffect(()=>{const t=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(t)},[]);return <div className="loading-screen"><div><strong>IRPA Digital Governance</strong><div className="loading-sub">{slow?"Authorization check is taking longer than expected.":"Establishing secure IRPA session..."}</div>{slow&&<button onClick={()=>window.location.reload()}>Retry Secure Session</button>}</div></div>}
function AccessDenied({user,reason}){return <main className="auth-screen"><section className="auth-card"><h1>Access Not Authorised</h1><p>{reason||"No active IRPA authorization profile was found."}</p><p className="muted">{user?.email}</p><button onClick={logout}>Sign Out</button></section></main>}
function Dashboard({admin,employee}){const[stats,setStats]=useState({employees:0,members:0,meetings:0,authorizations:0,actions:0,risks:0,payments:0,signatures:0,reports:0});const[busy,setBusy]=useState(true);useEffect(()=>{let live=true;(async()=>{try{if(admin){const names=[COLLECTIONS.employees,COLLECTIONS.members,COLLECTIONS.meetings,COLLECTIONS.authorizationRequests,COLLECTIONS.actions,COLLECTIONS.risks];const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));if(live)setStats({employees:v[0].length,members:v[1].length,meetings:v[2].length,authorizations:v[3].filter(x=>["Submitted","Under Review"].includes(x.status)).length,actions:v[4].filter(x=>!["Completed","Cancelled"].includes(x.status)).length,risks:v[5].filter(x=>!["Closed","Mitigated"].includes(x.status)).length,payments:0,signatures:0,reports:0});}else{const uid=auth.currentUser?.uid;const names=[COLLECTIONS.meetings,COLLECTIONS.actions,COLLECTIONS.authorizationRequests,COLLECTIONS.staffPaymentRequests,COLLECTIONS.signatures,COLLECTIONS.reports];const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));const mine=x=>x.uid===uid||x.employeeUid===uid||x.ownerUid===uid||x.requesterUid===uid||x.createdByUid===uid||x.assignedToUid===uid||x.signerUid===uid||x.recipientUid===uid||(Array.isArray(x.participantUids)&&x.participantUids.includes(uid));if(live)setStats({employees:0,members:0,meetings:v[0].filter(x=>mine(x)||x.status==="Scheduled"||x.status==="In Progress").length,authorizations:v[2].filter(x=>mine(x)&&["Submitted","Under Review"].includes(x.status)).length,actions:v[1].filter(x=>mine(x)&&!["Completed","Cancelled"].includes(x.status)).length,risks:0,payments:v[3].filter(x=>mine(x)&&!["Paid","Rejected","Cancelled"].includes(x.status)).length,signatures:v[4].filter(x=>mine(x)&&!["Completed","Signed","Declined"].includes(x.status)).length,reports:v[5].filter(x=>mine(x)&&!["Published","Archived"].includes(x.status)).length})}}finally{if(live)setBusy(false)}})();return()=>{live=false}},[admin,employee?.employeeNumber]);const cards=admin?[["Employees",stats.employees,"Current register"],["Members",stats.members,"Governance register"],["Meetings",stats.meetings,"Authoritative meeting register"],["Pending Authorizations",stats.authorizations,"Awaiting action"],["Open Actions",stats.actions,"Implementation control"],["Active Risks",stats.risks,"Risk register"]]:[["My Meetings",stats.meetings,"Meeting register"],["Actions Assigned",stats.actions,"Implementation control"],["Pending Authorizations",stats.authorizations,"Awaiting action"],["My Payment Requests",stats.payments,"Payment workflow"],["Pending Signatures",stats.signatures,"Signature platform"],["Reports",stats.reports,"Evidence workspace"]];return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA DIGITAL GOVERNANCE</span><h1>{admin?"Governance Command Dashboard":"Employee & Governance Dashboard"}</h1><p>{admin?"Live institutional overview of people, meetings, authorizations, implementation actions and risks.":"Your authorized IRPA governance and employee workspace."}</p></div>{employee?.employeeNumber&&<div className="identity-card"><span>Employee Number</span><strong>{employee.employeeNumber}</strong></div>}</section><div className="dashboard-grid">{cards.map(([a,b,c])=><div className="stat-card"key={a}><span>{a}</span><strong>{busy?"—":b}</strong><small>{c}</small></div>)}</div><section className="panel"><div className="panel-header"><div><span className="eyebrow">GOVERNANCE CONTROL CENTRE</span><h2>Operational Status</h2><p className="panel-description">Live register indicators are read from Firestore. Controlled workflow modules perform the actual institutional actions.</p></div></div><div className="form-actions"><button onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Meetings"}))}>Open Meetings</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Resolutions"}))}>Resolutions</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Voting"}))}>Voting</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Authorization & Approvals"}))}>Authorizations</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Reports"}))}>Evidence & Reports</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Induction and Orientation"}))}>Induction and Orientation</button></div></section></div>}
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
            <span>{profile?.email||user.email}</span>
          </div>
        </div>
      </header>
      <main className="content-area">
        <SignaturePlatformWithUpload signerOnly={true} signingEnvelopeId={signingEnvelopeId}/>
      </main>
    </section>
  </div>
}


function Shell({user,profile,admin,employee,inductionComplete,onInductionComplete}){const financePortalAccess=admin||isFinancePortalMember(profile,employee);const procurementPortalAccess=admin||isProcurementPortalMember(profile,employee);const[active,setActive]=useState(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get("adminModule");const induction=params.get("induction")==="1";return admin&&requested&&ALL_MODULES.includes(requested)?requested:induction?"Induction and Orientation":"Dashboard"}),modules=admin?ALL_MODULES:(inductionComplete?memberModules(profile):["Induction and Orientation"]);useEffect(()=>{const handler=()=>onInductionComplete?.();window.addEventListener("irpa:induction-completed",handler);return()=>window.removeEventListener("irpa:induction-completed",handler)},[onInductionComplete]);useEffect(()=>{if(!modules.includes(active))setActive("Dashboard")},[profile?.role,admin]);useEffect(()=>{const navigate=e=>{const detail=e?.detail;const target=typeof detail==="string"?detail:detail?.module;if(target&&modules.includes(target))setActive(target)};window.addEventListener("irpa:navigate",navigate);return()=>window.removeEventListener("irpa:navigate",navigate)},[modules]);const groups=Object.entries(NAV).map(([title,items])=>[title,items.filter(x=>modules.includes(x))]).filter(([,items])=>items.length);return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><div className="sidebar-brand-copy"><strong>IRPA</strong><span>Digital Governance</span><small>Improvement of Rangeland in Pastoral Areas</small></div></div><div className="authority-card"><span>{admin?"ADMINISTRATOR":"AUTHORIZED USER"}</span><strong>{profile?.role}</strong>{employee?.employeeNumber&&<small>{employee.employeeNumber}</small>}</div><nav>{groups.map(([title,items])=><div className="nav-group"key={title}><div className="nav-group-title">{title}</div>{items.map(x=><button key={x}className={active===x?"nav-item active":"nav-item"}onClick={()=>setActive(x)}><span>{displayModuleName(x)}</span>{active===x&&<i/>}</button>)}</div>)}</nav><div className="sidebar-footer"><div className="secure-label">● Secure IRPA workspace</div><button className="logout-button"onClick={logout}>Sign Out</button></div></aside><section className="main-area"><header className="topbar"><div><span className="topbar-kicker">IMPROVEMENT OF RANGELAND IN PASTORAL AREAS</span><h2>{displayModuleName(active)}</h2><p>Digital Board Governance Workspace</p></div><div className="user-info"><div className="user-avatar">{(profile?.name||user.email||"I").slice(0,1).toUpperCase()}</div><div><strong>{profile?.name||"IRPA User"}</strong><span>{profile?.role||user.email}</span></div></div></header><main className="content-area"><ModuleInterlinkBar active={active} onNavigate={setActive} admin={admin} role={profile?.role}/>{active==="Dashboard"&&<Dashboard admin={admin}employee={employee}/>} {active==="Board Members Registration"&&<BoardMembers/>} {active==="Invitations"&&<Invitations/>} {active==="Members & Personnel"&&<Employees/>} {active==="Meetings"&&<Meetings onNavigate={setActive}/>} {active==="Resolutions"&&<Resolutions/>} {active==="Voting"&&<Voting/>} {active==="Participants"&&<OperationalGatewaysParticipants/>} {active==="Authorization & Approvals"&&<AuthorizationApprovals/>} {active==="Signature Platform"&&<SignaturePlatformWithUpload/>} {active==="Induction and Orientation"&&<InductionOrientation profile={profile} employee={employee}/>} {active==="Induction Applications"&&admin&&<InductionAdmin/>} {active==="Downloads"&&<Downloads/>} {active==="Finance Portfolio"&&(financePortalAccess?<FinancePortfolio profile={profile} employee={employee}/>:<AccessDenied user={user} reason="Finance Portal access is restricted to authorised Finance/Accounting personnel and designated approving officers."/>)} {active==="Procurement"&&(procurementPortalAccess?<ProcurementPortal profile={profile}/>:<AccessDenied user={user} reason="Procurement Portal access is restricted to authorised Procurement personnel and designated approving officers."/>)} {active==="Settings"&&<Settings admin={admin} section="settings"/>} {active==="Add Administrator"&&<Settings admin={admin} section="administrators"/>} {CONFIGURED_MODULES.includes(active)&&<OperationalGateways module={active}/>} {active==="Employee Payments"&&<EmployeePayments profile={{...profile,...employee}}/>}</main></section></div>}

function shortcut(){setMessage("");setBusy("shortcut");try{const blob=new Blob(["[InternetShortcut]\\r\\nURL="+window.location.origin+"\\r\\nIconIndex=0\\r\\n"],{type:"application/internet-shortcut"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="IRPA-Digital-Governance.url";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback("PC shortcut download started. Check your browser Downloads folder.");}catch(e){feedback("PC shortcut download failed: "+(e?.message||"Unknown error."))}finally{setBusy("")}}
export default function App(){
  const params=new URLSearchParams(window.location.search);
  const adminGatewayMode=params.get("adminGateway")==="1";
  const inductionMode=params.get("induction")==="1";
  const applicantInductionMode=params.get("applicant")==="1";
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
  if(!inductionMode)return;
  const openApplicantSession=async()=>{
    try{
      if(applicantInductionMode&&auth.currentUser&&!auth.currentUser.isAnonymous){
        await logout();
      }
      await ensureInductionAnonymousSession();
    }catch(x){setError(x.message||"Induction enrollment could not be opened.");}
  };
  openApplicantSession();
},[inductionMode,applicantInductionMode]);

useEffect(()=>{
  let disposed=false;

  // Resolve a Google redirect before relying on the auth-state callback.
  // This prevents Android/mobile browsers from returning to the gateway
  // without the application adopting the authenticated Firebase user.
  const resolveGoogleRedirect=async()=>{
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

      let session=null;
      try{session=await loadMemberSession();}
      catch(sessionError){
        if(inductionMode){
          const inductionContext=await getCurrentInductionContext();
          setProfile({uid:u.uid,email:inductionContext.email||u.email||"",name:inductionContext.fullName||u.displayName||u.email||"IRPA Induction Applicant",role:inductionContext.role||"Induction Applicant",roles:inductionContext.roles||[],department:inductionContext.department||"",unit:inductionContext.unit||"",status:"Active",active:true,authorizationType:"member",inductionApplicant:true,invitationId:inductionContext.invitationId||null});
          setEmployee(inductionContext.employee||null);
          return;
        }
        throw sessionError;
      }
      let m=session.member;
      const invitationId=new URLSearchParams(window.location.search).get("memberInvite");
      if(!m&&invitationId){
        await provisionCurrentMemberFromInvitationV2(invitationId);
        m=await getCurrentMemberProfile();
        if(m)window.history.replaceState({},document.title,window.location.pathname+window.location.hash);
      }
      if(!m){setError("This account has no active IRPA member profile.");setProfile(null);return}
      if(m.status!=="Active"){setError("The IRPA member profile exists but is not active.");setProfile(null);return}
      setProfile({...m,authorizationType:"member"});
      setEmployee(session.employee||null);
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
  if(user===undefined||profile!==undefined||isPrimaryAdmin||isAdminGateway)return;
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
}magic()},[]);const invitationId=params.get("memberInvite");if(adminGatewayMode)return <AuthScreen/>;if(applicantInductionMode&&inductionMode)return <InductionOrientation/>;if(inductionMode&&user===undefined)return <Loading/>;if(inductionMode)return <InductionOrientation/>;if(user===undefined)return <AuthScreen/>;if(profile===undefined)return <Loading/>;if(!user)return invitationId?<MemberActivationScreen invitationId={invitationId}/>:<AuthScreen/>;
if(!profile)return <AccessDenied user={user}reason={error}/>;
if(profile.authorizationType==="signer"){
  return <SignerShell user={user} profile={profile} signingEnvelopeId={signingEnvelopeId}/>;
}
return <Shell user={user} profile={profile} admin={profile.authorizationType==="administrator"} employee={employee} inductionComplete={inductionComplete} onInductionComplete={()=>setInductionComplete(true)}/>;
}