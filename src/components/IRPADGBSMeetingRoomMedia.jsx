import React,{useEffect,useRef,useState}from"react";
import{httpsCallable,getFunctions}from"firebase/functions";
import{auth}from"../firebase/config";
import{Room,RoomEvent,Track}from"livekit-client";

export default function IRPADGBSMeetingRoomMedia({meeting,selectedAuthority="",controller=false}){
 const roomRef=useRef(null),localRef=useRef(null),remoteRef=useRef(null);
 const[status,setStatus]=useState("READY"),[error,setError]=useState(""),[muted,setMuted]=useState(false),[camera,setCamera]=useState(false),[screen,setScreen]=useState(false);

 useEffect(()=>()=>{roomRef.current?.disconnect();roomRef.current=null},[]);

 const attach=(track,container)=>{
   if(!track||!container)return;
   const element=track.attach();
   element.style.width="100%";element.style.height="100%";element.style.objectFit="cover";element.style.borderRadius="12px";
   container.appendChild(element);
 };
 const clearContainer=container=>{if(container)while(container.firstChild)container.removeChild(container.firstChild)};

 async function connect(){
   if(!meeting?.id)return setError("Select an IRPA meeting first.");
   if(!auth.currentUser)return setError("Sign in to IRPA before joining the Meeting Room.");
   if(roomRef.current)return;
   setError("");setStatus("AUTHORIZING");
   try{
     const call=httpsCallable(getFunctions(undefined,"us-central1"),"issueLiveMeetingToken");
     const result=await call({meetingId:meeting.id,selectedAuthority:String(selectedAuthority||"").trim()});
     const data=result.data||{};
     if(!data.serverUrl||!data.participantToken)throw new Error("The IRPA live meeting authorization response was incomplete.");
     const room=new Room({adaptiveStream:true,dynacast:true});
     room.on(RoomEvent.TrackSubscribed,(track)=>attach(track,remoteRef.current));
     room.on(RoomEvent.TrackUnsubscribed,(track)=>{track.detach().forEach(node=>node.remove())});
     room.on(RoomEvent.Disconnected,()=>{setStatus("DISCONNECTED");setCamera(false);setMuted(false);setScreen(false);clearContainer(localRef.current);clearContainer(remoteRef.current);roomRef.current=null});
     room.on(RoomEvent.ParticipantConnected,()=>setStatus("CONNECTED"));
     room.on(RoomEvent.ParticipantDisconnected,()=>setStatus("CONNECTED"));
     room.on(RoomEvent.LocalTrackPublished,p=>{if(p.track)attach(p.track,localRef.current)});
     room.on(RoomEvent.LocalTrackUnpublished,p=>{p.track?.detach().forEach(node=>node.remove())});
     await room.connect(data.serverUrl,data.participantToken);
     roomRef.current=room;
     setStatus("CONNECTED");
     await room.localParticipant.setMicrophoneEnabled(true);
     await room.localParticipant.setCameraEnabled(false);
   }catch(e){
     console.error("IRPA-DGBS Meeting Room media connection failed",e);
     setStatus("READY");
     setError(e?.message||"Unable to connect to the IRPA-DGBS Meeting Room.");
   }
 }
 async function disconnect(){roomRef.current?.disconnect()}
 async function toggleMic(){
   if(!roomRef.current)return;
   const enabled=!(roomRef.current.localParticipant.isMicrophoneEnabled);
   await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);setMuted(!enabled);
 }
 async function toggleCamera(){
   if(!roomRef.current)return;
   const enabled=!roomRef.current.localParticipant.isCameraEnabled;
   await roomRef.current.localParticipant.setCameraEnabled(enabled);setCamera(enabled);
 }
 async function toggleScreen(){
   if(!roomRef.current)return;
   try{
     const enabled=!screen;
     await roomRef.current.localParticipant.setScreenShareEnabled(enabled);
     setScreen(enabled);
   }catch(e){setError(e?.message||"Screen sharing was not enabled by the device/browser.")}
 }

 return <section className="panel" style={{marginTop:18}}>
   <div className="panel-header">
     <div><span className="eyebrow">IRPA-DGBS MEETING ROOM</span><h2>Secure Live Meeting</h2><p className="panel-description">Governance control remains in IRPA-DGBS. Live audio, video, data and screen sharing are provided by the secured meeting-media layer.</p></div>
     <span className="status-badge">{status}</span>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) minmax(220px,1fr)",gap:14}}>
     <div ref={remoteRef} style={{minHeight:260,borderRadius:12,background:"#07111f",padding:8,display:"grid",placeItems:"center",overflow:"hidden"}}>
       <span style={{color:"#94a3b8"}}>{status==="CONNECTED"?"Waiting for other participants…":"Live meeting media is not connected."}</span>
     </div>
     <div ref={localRef} style={{minHeight:160,borderRadius:12,background:"#0b1727",padding:8,overflow:"hidden"}}>
       <span style={{color:"#94a3b8"}}>Your camera preview</span>
     </div>
   </div>
   {error&&<div className="error-message action-feedback" style={{marginTop:12}}>{error}</div>}
   <div className="form-actions" style={{marginTop:14}}>
     {status!=="CONNECTED"&&<button onClick={connect} disabled={!controller||status==="AUTHORIZING"}>{status==="AUTHORIZING"?"Authorizing…":"Join IRPA-DGBS Meeting Room"}</button>}
     {status==="CONNECTED"&&<><button className="secondary-button" onClick={toggleMic}>{muted?"Unmute microphone":"Mute microphone"}</button><button className="secondary-button" onClick={toggleCamera}>{camera?"Stop camera":"Start camera"}</button><button className="secondary-button" onClick={toggleScreen}>{screen?"Stop screen share":"Share screen"}</button><button className="danger-button" onClick={disconnect}>Leave Meeting Room</button></>}
   </div>
   <small style={{display:"block",marginTop:10}}>Meeting: {meeting?.reference||meeting?.title||"—"} · Media authorization: server-controlled · Token lifetime: 10 minutes</small>
 </section>;
}
