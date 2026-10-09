import React,{useEffect,useState}from"react";
import{httpsCallable,getFunctions}from"firebase/functions";
import{auth}from"../firebase/config";
import{onAuthStateChanged}from"firebase/auth";

export default function MeetingEntryGateway({onEnter}){
 const params=new URL(window.location.href).searchParams;
 const[token]=useState(()=>params.get("meetingToken")||"");
 const[meetingId,setMeetingId]=useState(()=>params.get("meetingId")||"");
 const[meetingPassword,setMeetingPassword]=useState(()=>params.get("meetingPassword")||""),[passwordInput,setPasswordInput]=useState("");
 const[state,setState]=useState("checking"),[message,setMessage]=useState(""),[meeting,setMeeting]=useState(null);
 useEffect(()=>{const unsub=onAuthStateChanged(auth,async user=>{
  if(!user){setState("signin");setMessage("Sign in with the participant identity that received this meeting gate pass, then reopen this link.");return}
  if(!token){setState("error");setMessage("This meeting gate pass is incomplete.");return}
  if(!meetingPassword){setState("password");setMessage("Enter the meeting gate password from the invitation email.");return}
  try{
   const call=httpsCallable(getFunctions(undefined,"us-central1"),"authorizeMeetingEntry");
   const result=await call({accessToken:token,meetingId,meetingPassword});const data=result.data||{};
   setMeeting(data);sessionStorage.setItem("irpaMeetingEntryContext",JSON.stringify(data));setState("authorized");
  }catch(e){setState("error");setMessage(e?.message||"Meeting entry authorization failed.")}
 });return()=>unsub()},[token,meetingId,meetingPassword]);
 if(state==="checking")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Authorising Meeting Entry…</h1><p>Validating the tokenized meeting gate pass, meeting ID, password and participant identity.</p></div></section></div>;
 if(state==="signin")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Sign In Required</h1><p>{message}</p></div></section></div>;
 if(state==="error")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Entry Not Authorised</h1><p>{message}</p><p className="muted">The meeting itself has not been opened and no live-media session has been created.</p>{token&&<button className="secondary-button" onClick={()=>{setMeetingPassword("");setPasswordInput("");setState("password");setMessage("Enter the meeting gate password from the invitation email.")}}>Try Password Again</button>}</div></section></div>;
 if(state==="password")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Meeting Gate Password</h1><p>{message}</p><form onSubmit={e=>{e.preventDefault();const value=passwordInput.trim();if(value)setMeetingPassword(value)}} className="form-grid"><div className="form-field form-field-wide"><label htmlFor="meeting-gate-password">Meeting gate password</label><input id="meeting-gate-password" type="password" autoComplete="one-time-code" value={passwordInput} onChange={e=>setPasswordInput(e.target.value)} required/></div><div className="form-actions"><button type="submit">Verify Password & Continue</button></div></form></div></section></div>;
 return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY · AUTHORISED</span><h1>{meeting?.meetingReference||"IRPA Meeting"}</h1><p>Meeting ID: <strong>{meeting?.meetingId||meetingId}</strong> · {meeting?.meetingCategory||"General Meeting"}</p><p>Participant identity verified. Entry to the governed Meeting Room and its authorised meeting facilities is permitted.</p></div><button onClick={()=>onEnter?.(meeting?.meetingId)}>Enter Meeting Room</button></section></div>;
}