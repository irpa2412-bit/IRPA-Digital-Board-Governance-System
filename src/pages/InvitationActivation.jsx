import React,{useEffect,useRef,useState}from"react";
import {completeInvitationToken,configureInvitationPassword,logout}from"../firebase/auth";

export default function InvitationActivation(){
  const started=useRef(false);
  const[status,setStatus]=useState("loading");
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[confirm,setConfirm]=useState("");
  const[error,setError]=useState(""),[retrying,setRetrying]=useState(false),[errorKind,setErrorKind]=useState("");

  useEffect(()=>{
    if(started.current)return;
    started.current=true;
    const token=new URL(window.location.href).searchParams.get("invitationToken")||"";
    if(!token){setError("This invitation link is incomplete. Please open the invitation email again.");setStatus("error");return;}
    completeInvitationToken(token)
      .then(user=>{setEmail(String(user?.email||"").trim().toLowerCase());setErrorKind("");setStatus("ready");})
      .catch(err=>{const message=String(err?.message||"This invitation could not be opened.");setError(message);setErrorKind(/expired|cancelled|no longer available/i.test(message)?"renew":/already been used|already activated|already associated/i.test(message)?"used":"retry");setStatus("error");});
  },[]);

  async function activate(e){
    e.preventDefault();
    setError("");
    if(password.length<8){setError("Use a password with at least 8 characters.");return;}
    if(password!==confirm){setError("The passwords do not match.");return;}
    setStatus("activating");
    try{
      const result=await configureInvitationPassword(password);
      if(result?.state==="ACTIVATED"){
        setStatus("success");
        setTimeout(()=>window.location.replace(window.location.origin+"/"),500);
      }else{
        setError("The account could not be activated yet. Please submit the invitation again.");
        setStatus("ready");
      }
    }catch(err){
      const message=String(err?.message||"The account could not be activated.");
      setError(message);
      setErrorKind(/expired|cancelled|no longer available/i.test(message)?"renew":/already been used|already activated|already associated/i.test(message)?"used":"retry");
      setStatus("ready");
    }
  }

  async function retryInvitation(){
    const token=new URL(window.location.href).searchParams.get("invitationToken")||"";
    if(!token)return returnToLogin();
    setRetrying(true);setError("");
    try{const user=await completeInvitationToken(token);setEmail(String(user?.email||"").trim().toLowerCase());setErrorKind("");setStatus("ready");}
    catch(err){const message=String(err?.message||"This invitation could not be opened.");setError(message);setErrorKind(/expired|cancelled|no longer available/i.test(message)?"renew":/already been used|already activated|already associated/i.test(message)?"used":"retry");}
    finally{setRetrying(false);}
  }

  async function returnToLogin(){
    try{await logout();}catch(_){}
    window.location.replace(window.location.origin+"/");
  }

  if(status==="loading"){
    return <InvitationShell><div style={styles.center}><div style={styles.kicker}>IRPA DIGITAL BOARD GOVERNANCE SYSTEM</div><h1 style={styles.title}>Opening your invitation…</h1><p style={styles.text}>Please wait while your secure invitation is prepared.</p></div></InvitationShell>;
  }

  if(status==="error"){
    return <InvitationShell><div className="irpa-invitation-card"><div style={styles.kicker}>IRPA DIGITAL BOARD GOVERNANCE SYSTEM</div><h1 style={styles.title}>Invitation unavailable</h1><p style={styles.text}>{error}</p>{errorKind==="renew"&&<p style={styles.text}>Please request a new invitation link from an IRPA Administrator.</p>}
      {errorKind==="used"&&<p style={styles.text}>This invitation has already been used. Sign in with the email address that received the invitation.</p>}
      {errorKind==="retry"&&<button type="button" onClick={retryInvitation} disabled={retrying} style={styles.primary}>{retrying?"Trying again…":"Try Again"}</button>}
      <button type="button" onClick={returnToLogin} style={styles.secondary}>Return to Sign In</button></div></InvitationShell>;
  }

  if(status==="success"){
    return <InvitationShell><div style={styles.center}><div style={styles.kicker}>IRPA DIGITAL BOARD GOVERNANCE SYSTEM</div><h1 style={styles.title}>Account activated successfully</h1><p style={styles.text}>Opening your IRPA workspace…</p></div></InvitationShell>;
  }

  return <InvitationShell>
    <div className="irpa-invitation-card">
      <div style={styles.kicker}>IRPA DIGITAL BOARD GOVERNANCE SYSTEM</div>
      <h1 style={styles.title}>Welcome to the IRPA Digital Board Governance System</h1>
      <p style={styles.text}>You have been invited to access the IRPA workspace.</p>
      <form onSubmit={activate} style={{display:"grid",gap:16}}>
        <label style={styles.label}>Email
          <input value={email} readOnly type="email" style={styles.input}/>
        </label>
        <label style={styles.label}>Create Password
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="new-password" minLength={8} required placeholder="••••••••" style={styles.input}/>
        </label>
        <label style={styles.label}>Confirm Password
          <input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" autoComplete="new-password" minLength={8} required placeholder="••••••••" style={styles.input}/>
        </label>
        {error&&<div role="alert" style={styles.error}>{error}</div>}
        <button type="submit" disabled={status==="activating"} style={styles.primary}>{status==="activating"?"Activating…":"Activate My Account"}</button>
      </form>
    </div>
  </InvitationShell>;
}

function InvitationShell({children}){
  return <main style={styles.shell}><style>{css}</style>{children}</main>;
}

const styles={
  shell:{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,boxSizing:"border-box",background:"#07140f",color:"#edf5f1",fontFamily:"Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"},
  center:{width:"min(620px,100%)",textAlign:"center"},
  kicker:{fontSize:11,fontWeight:800,letterSpacing:".14em",color:"#d6a52c"},
  title:{margin:"12px 0 10px",fontSize:"clamp(26px,4vw,38px)",lineHeight:1.15},
  text:{margin:"0 0 24px",lineHeight:1.6,color:"#b9cbc4",fontSize:16},
  label:{display:"grid",gap:7,fontSize:13,fontWeight:800,color:"#dce9e4"},
  input:{width:"100%",boxSizing:"border-box",border:"1px solid #315a46",borderRadius:10,padding:"13px 14px",background:"#07140f",color:"#edf5f1",fontSize:16,outline:"none"},
  primary:{border:"1px solid #2f86cf",borderRadius:10,padding:"13px 16px",background:"#0b5fa8",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer"},
  secondary:{border:"1px solid #315a46",borderRadius:10,padding:"12px 16px",background:"transparent",color:"#edf5f1",fontSize:15,fontWeight:700,cursor:"pointer"},
  error:{padding:12,border:"1px solid #7f3d3d",borderRadius:10,background:"#291313",color:"#ffb7b7",fontSize:14,lineHeight:1.45}
};
const css=".irpa-invitation-card{width:min(520px,100%);box-sizing:border-box;padding:30px;border:1px solid #315a46;border-radius:18px;background:#0a1d16;box-shadow:0 20px 60px rgba(0,0,0,.35)}@media(max-width:600px){.irpa-invitation-card{padding:22px;border-radius:14px}}";
