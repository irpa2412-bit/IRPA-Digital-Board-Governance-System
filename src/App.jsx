import React,{useEffect,useMemo,useState}from"react";import Invitations from"./pages/Invitations";import Employees from"./pages/Employees";import BoardMembers from"./pages/BoardMembers";import Members from"./pages/Members";import EmployeePayments from"./pages/EmployeePayments";import Meetings from"./pages/Meetings";import Resolutions from"./pages/Resolutions";import Voting from"./pages/Voting";import OperationalGateways from"./pages/OperationalGateways";import OperationalGatewaysParticipants from"./pages/OperationalGatewaysParticipants";import AuthorizationApprovals from"./pages/AuthorizationApprovals";import SignaturePlatformWithUpload from"./pages/SignaturePlatformWithUpload";import FinancePortfolio from"./pages/FinancePortfolio";import ProcurementPortal from"./pages/ProcurementPortal";import Settings from"./pages/Settings";import InductionOrientation from"./pages/InductionOrientation";import ModuleInterlinkBar from"./components/ModuleInterlinkBar";import{observeAuthState,loginWithEmail,loginWithGoogle,completeGoogleRedirect,registerWithEmail,sendPasswordReset,sendAdminMagicLink,isMagicLink,completeMagicLink,logout}from"./firebase/auth";import{getAdminProfile,getCurrentMemberProfile,getCurrentEmployeeProfile,getRecords,COLLECTIONS}from"./firebase/data";import{getSignatureEnvelope}from"./firebase/signaturePlatform";import{provisionCurrentMemberFromInvitationV2}from"./firebase/invitationWorkflow";import{auth}from"./firebase/config";
const NAV={GOVERNANCE:["Dashboard","Induction & Orientation","Board Members Registration","Members & Personnel","Invitations","Participants","Meetings","Meeting Room","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Risk Register","Authorization & Approvals","Employee Payments"],FINANCE:["Finance Portfolio","Procurement"],EVIDENCE:["Reports","Audit Trail"],SYSTEM:["Downloads","Settings","Add Administrator"]};const ALL_MODULES=Object.values(NAV).flat();const BASE_MEMBER_MODULES=["Dashboard","Meetings","Meeting Room","Resolutions","Voting","Actions","Documents","Signature Platform","Decisions","Authorization & Approvals","Employee Payments","Induction & Orientation","Procurement","Reports","Downloads"];const FINANCE_ROLES=["Finance Personnel","Finance Manager","Accountant","Finance Officer","Executive Director","Director Finance & Administration"];const PROCUREMENT_ROLES=["Procurement Officer","Procurement Manager","Procurement Team Member"];const PROCUREMENT_APPROVAL_ROLES=["Executive Director","Director Livestock","Livestock Director","Director Internal Oversight","Internal Oversight Director","Director Finance & Administration","Director Human Resources","Director Outreach","Director Community Development","Director Environment","Director Field","Director Operations","Operations Director","Outreach Director","Community Development Director","Environment Director","Field Director"];const HR_ROLES=["Executive Director","Director Human Resources","HR Manager"];const EXECUTIVE_DIRECTOR_MODULES=["Members & Personnel","Participants","Risk Register"];const CONFIGURED_MODULES=["Meeting Room","Actions","Documents","Decisions","Risk Register","Reports","Audit Trail"];
function isFinancePortalMember(p,e){const r=p?.role||"";return FINANCE_ROLES.includes(r)||(p?.department==="Finance & Administration"&&["Finance Unit","Accounting Unit"].includes(p?.unit))||(e?.department==="Finance & Administration"&&["Finance Unit","Accounting Unit"].includes(e?.unit));}function isProcurementPortalMember(p,e){const r=p?.role||"";return PROCUREMENT_ROLES.includes(r)||PROCUREMENT_APPROVAL_ROLES.includes(r)||(p?.department==="Finance & Administration"&&p?.unit==="Procurement Unit")||(e?.department==="Finance & Administration"&&e?.unit==="Procurement Unit");}function memberModules(p,e){const r=p?.role||"",m=[...BASE_MEMBER_MODULES.filter(x=>x!=="Procurement")];if(isFinancePortalMember(p,e))m.splice(m.indexOf("Reports"),0,"Finance Portfolio");if(isProcurementPortalMember(p,e))m.splice(m.indexOf("Reports"),0,"Procurement");if(HR_ROLES.includes(r))m.splice(m.indexOf("Reports"),0,"Members & Personnel");if(r==="Executive Director")m.push(...EXECUTIVE_DIRECTOR_MODULES);return[...new Set(m)]}
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

function AuthScreen(){const adminGateway=new URLSearchParams(window.location.search).get("adminGateway")==="1";const[mode,setMode]=useState("login"),[email,setEmail]=useState(()=>adminGateway?"irpa2412@gmail.com":(new URLSearchParams(window.location.search).get("adminEmail")||"")),[password,setPassword]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);async function submit(e){e.preventDefault();setBusy(true);setMessage("");try{if(adminGateway){const signedIn=await loginWithGoogle("irpa2412@gmail.com",{admin:true});if(signedIn){window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");setMessage("Administrator authenticated. Opening the governance dashboard...");}}else if(mode==="register"){await registerWithEmail(email.trim(),password);setMessage("Account created. Please verify your email before continuing")}else await loginWithEmail(email.trim(),password)}catch(x){setMessage(x.message||"Authentication failed.");setBusy(false)}}async function reset(){if(!email.trim()){setMessage("Enter your email address first.");return}setBusy(true);try{await sendPasswordReset(email.trim());setMessage("Password reset email sent")}catch(x){setMessage(x.message||"Unable to send password reset email.")}finally{setBusy(false)}}async function adminLink(){if(!email.trim()){setMessage("Enter the authorised administrator email address.");return}setBusy(true);try{await sendAdminMagicLink(email.trim());setMessage("Administrator sign-in link sent")}catch(x){setMessage(x.message||"Unable to send administrator sign-in link.")}finally{setBusy(false)}}return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><div className="brand-kicker">IRPA</div><h1>Digital Board Governance</h1><p>Secure institutional governance, authorization, finance and employee management for Improvement of Rangeland in Pastoral Areas.</p></div><div className="auth-divider"><span>{adminGateway?"Administrator Gateway":mode==="login"?"Secure sign in":"Create account"}</span></div><form onSubmit={submit}><label>Email address</label><input type="email"value={email}onChange={e=>setEmail(e.target.value)}required readOnly={adminGateway}/>{adminGateway?null:<><label>Password</label><input type="password"value={password}onChange={e=>setPassword(e.target.value)}required minLength={6}/></>}<button type="submit"disabled={busy}>{busy?"Please wait...":adminGateway?"Sign In with Google":"Sign In Securely"}</button></form><div className="auth-links">{!adminGateway&&<button className="secondary-button"onClick={async()=>{setBusy(true);setMessage("");try{await loginWithGoogle("")}catch(x){setMessage(x.message||"Google sign-in failed")}finally{setBusy(false)}}}disabled={busy}>Continue with Google</button>}<button className="text-button"onClick={()=>{setMode(mode==="login"?"register":"login");setMessage("")}}disabled={busy}>{mode==="login"?"Create a member account":"Return to sign in"}</button></div>{message&&<div className="auth-message">{message}</div>}</section></main>}
function Loading(){const[slow,setSlow]=useState(false);useEffect(()=>{const t=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(t)},[]);return <div className="loading-screen"><div><strong>IRPA Digital Governance</strong><div className="loading-sub">{slow?"Authorization check is taking longer than expected.":"Establishing secure IRPA session..."}</div>{slow&&<button onClick={()=>window.location.reload()}>Retry Secure Session</button>}</div></div>}
function AccessDenied({user,reason}){return <main className="auth-screen"><section className="auth-card"><h1>Access Not Authorised</h1><p>{reason||"No active IRPA authorization profile was found."}</p><p className="muted">{user?.email}</p><button onClick={logout}>Sign Out</button></section></main>}
function Dashboard({admin,employee}){const[stats,setStats]=useState({employees:0,members:0,meetings:0,authorizations:0,actions:0,risks:0,payments:0,signatures:0,reports:0});const[busy,setBusy]=useState(true);useEffect(()=>{let live=true;(async()=>{try{if(admin){const names=[COLLECTIONS.employees,COLLECTIONS.members,COLLECTIONS.meetings,COLLECTIONS.authorizationRequests,COLLECTIONS.actions,COLLECTIONS.risks];const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));if(live)setStats({employees:v[0].length,members:v[1].length,meetings:v[2].length,authorizations:v[3].filter(x=>["Submitted","Under Review"].includes(x.status)).length,actions:v[4].filter(x=>!["Completed","Cancelled"].includes(x.status)).length,risks:v[5].filter(x=>!["Closed","Mitigated"].includes(x.status)).length,payments:0,signatures:0,reports:0});}else{const uid=auth.currentUser?.uid;const names=[COLLECTIONS.meetings,COLLECTIONS.actions,COLLECTIONS.authorizationRequests,COLLECTIONS.staffPaymentRequests,COLLECTIONS.signatures,COLLECTIONS.reports];const v=await Promise.all(names.map(n=>getRecords(n).catch(()=>[])));const mine=x=>x.uid===uid||x.employeeUid===uid||x.ownerUid===uid||x.requesterUid===uid||x.createdByUid===uid||x.assignedToUid===uid||x.signerUid===uid||x.recipientUid===uid||(Array.isArray(x.participantUids)&&x.participantUids.includes(uid));if(live)setStats({employees:0,members:0,meetings:v[0].filter(x=>mine(x)||x.status==="Scheduled"||x.status==="In Progress").length,authorizations:v[2].filter(x=>mine(x)&&["Submitted","Under Review"].includes(x.status)).length,actions:v[1].filter(x=>mine(x)&&!["Completed","Cancelled"].includes(x.status)).length,risks:0,payments:v[3].filter(x=>mine(x)&&!["Paid","Rejected","Cancelled"].includes(x.status)).length,signatures:v[4].filter(x=>mine(x)&&!["Completed","Signed","Declined"].includes(x.status)).length,reports:v[5].filter(x=>mine(x)&&!["Published","Archived"].includes(x.status)).length})}}finally{if(live)setBusy(false)}})();return()=>{live=false}},[admin,employee?.employeeNumber]);const cards=admin?[["Employees",stats.employees,"Current register"],["Members",stats.members,"Governance register"],["Meetings",stats.meetings,"Authoritative meeting register"],["Pending Authorizations",stats.authorizations,"Awaiting action"],["Open Actions",stats.actions,"Implementation control"],["Active Risks",stats.risks,"Risk register"]]:[["My Meetings",stats.meetings,"Meeting register"],["Actions Assigned",stats.actions,"Implementation control"],["Pending Authorizations",stats.authorizations,"Awaiting action"],["My Payment Requests",stats.payments,"Payment workflow"],["Pending Signatures",stats.signatures,"Signature platform"],["Reports",stats.reports,"Evidence workspace"]];return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA DIGITAL GOVERNANCE</span><h1>{admin?"Governance Command Dashboard":"Employee & Governance Dashboard"}</h1><p>{admin?"Live institutional overview of people, meetings, authorizations, implementation actions and risks.":"Your authorized IRPA governance and employee workspace."}</p></div>{employee?.employeeNumber&&<div className="identity-card"><span>Employee Number</span><strong>{employee.employeeNumber}</strong></div>}</section><div className="dashboard-grid">{cards.map(([a,b,c])=><div className="stat-card"key={a}><span>{a}</span><strong>{busy?"—":b}</strong><small>{c}</small></div>)}</div><section className="panel"><div className="panel-header"><div><span className="eyebrow">GOVERNANCE CONTROL CENTRE</span><h2>Operational Status</h2><p className="panel-description">Live register indicators are read from Firestore. Controlled workflow modules perform the actual institutional actions.</p></div></div><div className="form-actions"><button onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Meetings"}))}>Open Meetings</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Resolutions"}))}>Resolutions</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Voting"}))}>Voting</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Authorization & Approvals"}))}>Authorizations</button><button className="secondary-button"onClick={()=>window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:"Reports"}))}>Evidence & Reports</button></div></section></div>}
function shortcut(){setMessage("");setBusy("shortcut");try{const blob=new Blob(["[InternetShortcut]\\r\\nURL="+window.location.origin+"\\r\\nIconIndex=0\\r\\n"],{type:"application/internet-shortcut"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="IRPA-Digital-Governance.url";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback("PC shortcut download started. Check your browser Downloads folder.");}catch(e){feedback("PC shortcut download failed: "+(e?.message||"Unknown error."))}finally{setBusy("")}}
export default function App(){
  const[user,setUser]=useState(undefined),
    [profile,setProfile]=useState(undefined),
    [employee,setEmployee]=useState(null),
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
    const expected=window.sessionStorage.getItem("irpaExpectedGoogleAdminEmail");
    if(!expected)return;
    try{
      const redirectedUser=await completeGoogleRedirect(expected);
      window.sessionStorage.removeItem("irpaAdminRedirectPending");
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
          window.history.replaceState({},document.title,window.location.pathname);
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
            role:recipient.role||"Signer",authorizationType:"signer",signingEnvelopeId:activeSigningId,signingRecipient:recipient
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

      const gateway=String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL||"https://irpa-google-drive-gateway.irpa-governance.workers.dev").replace(/\/$/,"");
      const loadMemberSession=async()=>{
        const withTimeout=(promise,ms,label)=>Promise.race([
          promise,new Promise((_,reject)=>window.setTimeout(()=>reject(new Error(label)),ms))
        ]);
        const firebaseProfile=withTimeout((async()=>{
          const [memberDirect,employeeDirect]=await Promise.all([
            getCurrentMemberProfile().catch(()=>null),
            getCurrentEmployeeProfile().catch(()=>null)
          ]);
          if(!memberDirect&&!employeeDirect)return null;
          return {ok:true,uid:u.uid,email:u.email||memberDirect?.email||employeeDirect?.email||"",admin:null,member:memberDirect?.status==="Active"?memberDirect:null,employee:employeeDirect||null,authorizationSource:"firebase"};
        })(),3000,"Firebase member authorization lookup timed out.");

        const gatewayProfile=withTimeout((async()=>{
          const token=await u.getIdToken();
          const response=await fetch(gateway+"/api/session/profile",{
            method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},cache:"no-store"
          });
          const result=await response.json().catch(()=>({}));
          if(!response.ok||!result.ok)throw new Error(result.error||"Unable to verify IRPA authorization.");
          return result;
        })(),3000,"Authorization gateway timed out.");

        const results=await Promise.allSettled([firebaseProfile,gatewayProfile]);
        const session=results.filter(result=>result.status==="fulfilled"&&result.value).map(result=>result.value).find(value=>value.ok||value.member||value.employee);
        if(session)return session;
        throw new Error("No active IRPA authorization profile was found.");
      };

      const session=await loadMemberSession();
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
// on the loading screen. This is limited to authentication/session state only.
useEffect(()=>{
  if(user===undefined||profile!==undefined)return;
  const timer=window.setTimeout(async()=>{
    if(profile!==undefined)return;
    console.error("IRPA login watchdog: authorization did not complete.");
    try{await logout();}catch(_){}
    setError("");
    setEmployee(null);
    setProfile(null);
    setUser(null);
  },7000);
  return()=>window.clearTimeout(timer);
},[user,profile]);

useEffect(()=>{async function magic(){
  const adminGateway=new URLSearchParams(window.location.search).get("adminGateway")==="1";
  if(adminGateway)return;
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
}magic()},[]);const invitationId=new URLSearchParams(window.location.search).get("memberInvite");if(user===undefined||profile===undefined)return <Loading/>;if(!user)return invitationId?<MemberActivationScreen invitationId={invitationId}/>:<AuthScreen/>;
if(!profile)return <AccessDenied user={user}reason={error}/>;
if(profile.authorizationType==="signer"){
  return <SignerShell user={user} profile={profile} signingEnvelopeId={signingEnvelopeId}/>;
}
return <Shell user={user} profile={profile} admin={profile.authorizationType==="administrator"} employee={employee} inductionComplete={inductionComplete} onInductionComplete={()=>setInductionComplete(true)}/>;
}
