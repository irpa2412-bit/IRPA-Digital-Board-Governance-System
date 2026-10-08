import React,{useEffect,useState}from"react";
import{httpsCallable,getFunctions}from"firebase/functions";
import{auth}from"../firebase/config";
import{onAuthStateChanged}from"firebase/auth";

export default function MeetingEntryGateway({onEnter}){
 const[token]=useState(()=>new URL(window.location.href).searchParams.get("meetingToken")||"");
 const[state,setState]=useState("checking"),[message,setMessage]=useState(""),[meeting,setMeeting]=useState(null);
 useEffect(()=>{const unsub=onAuthStateChanged(auth,async user=>{
  if(!user){setState("signin");setMessage("Sign in with the participant identity that received this meeting invitation, then reopen this link.");return}
  if(!token){setState("error");setMessage("This meeting link is incomplete. Request a fresh meeting invitation.");return}
  try{
   const call=httpsCallable(getFunctions(undefined,"us-central1"),"authorizeMeetingEntry");
   const result=await call({accessToken:token});const data=result.data||{};
   setMeeting(data);sessionStorage.setItem("irpaMeetingEntryContext",JSON.stringify(data));setState("authorized");
  }catch(e){setState("error");setMessage(e?.message||"Meeting entry authorization failed.")}
 });return()=>unsub()},[token]);
 if(state==="checking")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Authorising Meeting Entry…</h1><p>Validating the secure meeting invitation and participant identity.</p></div></section></div>;
 if(state==="signin")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Sign In Required</h1><p>{message}</p></div></section></div>;
 if(state==="error")return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY</span><h1>Entry Not Authorised</h1><p>{message}</p><p className="muted">The meeting itself has not been opened and no live-media session has been created.</p></div></section></div>;
 return <div className="page"><section className="welcome-panel"><div><span className="eyebrow">IRPA MEETING ENTRY GATEWAY · AUTHORISED</span><h1>{meeting?.meetingReference||"IRPA Meeting"}</h1><p>Participant identity verified. Entry to the governed live Meeting Room is authorised.</p></div><button onClick={()=>onEnter?.(meeting?.meetingId)}>Enter Meeting Room</button></section></div>;
}
