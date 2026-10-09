import React,{useEffect,useMemo,useRef,useState}from"react";
import{httpsCallable,getFunctions}from"firebase/functions";
import{auth}from"../firebase/config";
import{Room,RoomEvent}from"livekit-client";

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function safeJson(value){
  try{return JSON.parse(decoder.decode(value))}catch{return null}
}

export default function IRPADGBSMeetingRoomMedia({meeting,selectedAuthority="",controller=false}){
 const roomRef=useRef(null),remoteRef=useRef(null),localRef=useRef(null);
 const[status,setStatus]=useState("READY"),[error,setError]=useState(""),[muted,setMuted]=useState(true),[camera,setCamera]=useState(false),[screen,setScreen]=useState(false),[hand,setHand]=useState(false),[moderator,setModerator]=useState(false),[recordingAllowed,setRecordingAllowed]=useState(false);
 const[participants,setParticipants]=useState([]),[messages,setMessages]=useState([]),[chat,setChat]=useState(""),[deviceReady,setDeviceReady]=useState(false),[deviceCheck,setDeviceCheck]=useState("NOT CHECKED"),[sessionId,setSessionId]=useState("");

 const clear=node=>{if(node)while(node.firstChild)node.removeChild(node.firstChild)};
 const refreshParticipants=room=>{
   if(!room)return;
   const rows=[{
     identity:room.localParticipant.identity,
     name:room.localParticipant.name||"You",
     local:true,
     audio:room.localParticipant.isMicrophoneEnabled,
     video:room.localParticipant.isCameraEnabled,
     hand:false
   }];
   room.remoteParticipants.forEach(p=>rows.push({identity:p.identity,name:p.name||p.identity,local:false,audio:p.isMicrophoneEnabled,video:p.isCameraEnabled,hand:false}));
   setParticipants(rows);
 };
 const attach=(track,container)=>{
   if(!track||!container)return;
   const node=track.attach();
   node.style.width="100%";node.style.height="100%";node.style.objectFit="cover";node.style.borderRadius="12px";
   container.appendChild(node);
 };
 const detach=(track)=>track?.detach().forEach(node=>node.remove());

 useEffect(()=>()=>{roomRef.current?.disconnect();roomRef.current=null},[]);

 async function connect(){
   if(!meeting?.id)return setError("Select an IRPA meeting first.");
   if(!auth.currentUser)return setError("Sign in to IRPA before joining the Meeting Room.");
   if(!controller)return setError("Meeting control authority is required to join the live room.");
   if(roomRef.current)return;
   setError("");setStatus("AUTHORIZING");
   try{
     let gateParticipantId="";
     try{
       const gateContext=JSON.parse(sessionStorage.getItem("irpaMeetingEntryContext")||"null");
       if(gateContext?.meetingId===meeting.id)gateParticipantId=String(gateContext?.participantId||"");
     }catch{}
     const call=httpsCallable(getFunctions(undefined,"us-central1"),"issueLiveMeetingToken");
     const result=await call({meetingId:meeting.id,selectedAuthority:String(selectedAuthority||"").trim(),participantId:gateParticipantId});
     const data=result.data||{};
     if(!data.serverUrl||!data.participantToken)throw new Error("The IRPA live meeting authorization response was incomplete.");
     const room=new Room({adaptiveStream:true,dynacast:true});
     room.on(RoomEvent.TrackSubscribed,(track)=>attach(track,remoteRef.current));
     room.on(RoomEvent.TrackUnsubscribed,detach);
     room.on(RoomEvent.LocalTrackPublished,p=>attach(p.track,localRef.current));
     room.on(RoomEvent.LocalTrackUnpublished,p=>detach(p.track));
     room.on(RoomEvent.ParticipantConnected,()=>{refreshParticipants(room);setStatus("CONNECTED")});
     room.on(RoomEvent.ParticipantDisconnected,()=>refreshParticipants(room));
     room.on(RoomEvent.DataReceived,(payload,participant)=>{const msg=safeJson(payload);if(msg?.type==="chat")setMessages(v=>[...v,{from:participant?.name||participant?.identity||"Participant",text:String(msg.text||"")}].slice(-30));if(msg?.type==="hand")refreshParticipants(room)});
     room.on(RoomEvent.Reconnecting,()=>setStatus("RECONNECTING"));
     room.on(RoomEvent.Reconnected,()=>{setStatus("CONNECTED");refreshParticipants(room)});
     room.on(RoomEvent.Disconnected,()=>{setStatus("DISCONNECTED");setCamera(false);setMuted(true);setScreen(false);setHand(false);setModerator(false);setRecordingAllowed(false);clear(localRef.current);clear(remoteRef.current);setParticipants([]);roomRef.current=null});
     await room.connect(data.serverUrl,data.participantToken);
     roomRef.current=room;setSessionId(data.sessionId||"");setModerator(data.moderator===true);setRecordingAllowed(data.recordingAllowed===true);setStatus("CONNECTED");refreshParticipants(room);
     await room.localParticipant.setMicrophoneEnabled(true,{audioCaptureOptions:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});setMuted(false);
     await room.localParticipant.setCameraEnabled(false);setCamera(false);
     try{const devices=await navigator.mediaDevices?.enumerateDevices?.();setDeviceReady(Boolean(devices?.some(d=>d.kind==="audioinput")&&devices?.some(d=>d.kind==="videoinput")))}catch{setDeviceReady(false)}
   }catch(e){console.error("IRPA-DGBS Meeting Room media connection failed",e);setStatus("READY");setError(e?.message||"Unable to connect to the IRPA-DGBS Meeting Room.")}
 }
 async function checkDevices(){
   setError("");setDeviceCheck("CHECKING");
   if(!navigator.mediaDevices?.getUserMedia){setDeviceReady(false);setDeviceCheck("UNSUPPORTED");setError("This browser does not provide camera/microphone access. Use a current browser with HTTPS enabled.");return}
   let stream;
   try{
     stream=await navigator.mediaDevices.getUserMedia({
       audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
       video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}
     });
     const audio=stream.getAudioTracks()[0],video=stream.getVideoTracks()[0];
     if(!audio||!video)throw new Error("A microphone and camera are both required for the full readiness check.");
     const settings=video.getSettings?.()||{};
     const hd=Number(settings.width||0)>=1280&&Number(settings.height||0)>=720;
     setDeviceReady(true);
     setDeviceCheck(hd?"READY · 720p CAPABLE":"READY · CAMERA AVAILABLE");
   }catch(e){
     setDeviceReady(false);setDeviceCheck("NOT READY");
     setError(e?.message||"Camera/microphone permission or device check failed.");
   }finally{stream?.getTracks?.().forEach(track=>track.stop())}
 }
 async function disconnect(){roomRef.current?.disconnect()}
 async function toggleMic(){if(!roomRef.current)return;const enabled=!roomRef.current.localParticipant.isMicrophoneEnabled;await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);setMuted(!enabled);refreshParticipants(roomRef.current)}
 async function toggleCamera(){if(!roomRef.current)return;const enabled=!roomRef.current.localParticipant.isCameraEnabled;await roomRef.current.localParticipant.setCameraEnabled(enabled,{videoCaptureOptions:{resolution:{width:1280,height:720},frameRate:30}});setCamera(enabled);refreshParticipants(roomRef.current)}
 async function toggleScreen(){if(!roomRef.current)return;try{const enabled=!screen;await roomRef.current.localParticipant.setScreenShareEnabled(enabled);setScreen(enabled)}catch(e){setError(e?.message||"Screen sharing was not enabled by the device or browser.")}}
 async function toggleHand(){if(!roomRef.current)return;const next=!hand;setHand(next);try{await roomRef.current.localParticipant.publishData(encoder.encode(JSON.stringify({type:"hand",raised:next})),{reliable:true});refreshParticipants(roomRef.current)}catch(e){setError(e?.message||"Unable to signal hand raise.")}}
 async function sendChat(e){e?.preventDefault();const text=chat.trim();if(!text||!roomRef.current)return;try{await roomRef.current.localParticipant.publishData(encoder.encode(JSON.stringify({type:"chat",text})),{reliable:true});setMessages(v=>[...v,{from:"You",text}].slice(-30));setChat("")}catch(err){setError(err?.message||"Unable to send meeting message.")}}

 const participantCount=participants.length;
 const readiness=useMemo(()=>status==="CONNECTED"?(deviceReady?"READY":"CHECK DEVICE"):(controller?"READY TO JOIN":"READ ONLY"),[status,deviceReady,controller]);

 return <section className="panel" style={{marginTop:18}}>
  <div className="panel-header">
   <div><span className="eyebrow">IRPA-DBGS MEETING ROOM · LIVE MEDIA</span><h2>Secure Governance Meeting</h2><p className="panel-description">IRPA-DGBS controls identity, meeting authority and governance records. LiveKit provides the encrypted real-time media transport.</p></div>
   <span className="status-badge">{status}</span>
  </div>
  <div className="dashboard-grid" style={{marginBottom:14}}>
   <div className="stat-card"><span>Session</span><strong>{status==="CONNECTED"?"LIVE":"READY"}</strong><small>{sessionId||"Not connected"}</small></div>
   <div className="stat-card"><span>Participants</span><strong>{participantCount}</strong><small>Authenticated room members</small></div>
   <div className="stat-card"><span>Device</span><strong>{readiness}</strong><small>{deviceCheck==="NOT CHECKED"?"Run the microphone and camera check":deviceCheck}</small></div>
   <div className="stat-card"><span>Authority</span><strong style={{fontSize:14}}>{moderator?"Meeting Moderator":selectedAuthority||"IRPA meeting authority"}</strong><small>{recordingAllowed?"Recording permitted by meeting policy":"Recording not enabled"}</small></div>
  </div>
  <div className="irpa-live-media-columns" style={{display:"grid",gap:14}}>
   <div ref={remoteRef} style={{minHeight:300,border:"1px solid var(--border)",borderRadius:12,padding:8,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8,overflow:"auto"}}>
    {status!=="CONNECTED"&&<span className="muted">Live meeting media is not connected.</span>}
   </div>
   <div>
    <div ref={localRef} style={{minHeight:170,border:"1px solid var(--border)",borderRadius:12,padding:8,overflow:"hidden"}}><span className="muted">Your camera / screen preview</span></div>
    <div className="panel" style={{marginTop:10,padding:12}}>
     <strong>Participants</strong>
     <div style={{display:"grid",gap:7,marginTop:8}}>{participants.length?participants.map(p=><div key={p.identity} className="table-subtext"><strong>{p.local?"You":p.name}</strong> · {p.audio?"Mic on":"Mic off"} · {p.video?"Camera on":"Camera off"}</div>):<span className="muted">No connected participants.</span>}</div>
    </div>
   </div>
  </div>
  {error&&<div className="error-message action-feedback" style={{marginTop:12}}>{error}</div>}
  <div className="form-actions" style={{marginTop:14}}>
   {status!=="CONNECTED"&&<button onClick={connect} disabled={!controller||status==="AUTHORIZING"}>{status==="AUTHORIZING"?"Authorizing…":"Join IRPA-DGBS Meeting Room"}</button>}
   {status==="CONNECTED"&&<>
    <button className="secondary-button" onClick={toggleMic}>{muted?"Unmute microphone":"Mute microphone"}</button>
    <button className="secondary-button" onClick={toggleCamera}>{camera?"Stop camera":"Start camera"}</button>
    <button className="secondary-button" onClick={toggleScreen}>{screen?"Stop screen share":"Share screen"}</button>
    <button className={hand?"":"secondary-button"} onClick={toggleHand}>{hand?"Lower hand":"Raise hand"}</button>
    <button className="danger-button" onClick={disconnect}>Leave Meeting Room</button>
   </>}
  </div>
  {status==="CONNECTED"&&<form onSubmit={sendChat} className="form-grid" style={{marginTop:12}}>
   <div className="form-field form-field-wide"><label>Meeting Chat / Floor Message</label><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Send a short governance-session message"/></div>
   <div className="form-actions"><button type="submit">Send Message</button></div>
  </form>}
  {messages.length>0&&<div className="panel" style={{marginTop:12,padding:12}}><strong>Session Messages</strong><div style={{maxHeight:160,overflow:"auto",marginTop:8}}>{messages.map((m,i)=><div key={i} className="table-subtext"><strong>{m.from}:</strong> {m.text}</div>)}</div></div>}
  <small style={{display:"block",marginTop:10}}>Meeting: {meeting?.reference||meeting?.title||"—"} · Server-authorized token · 10-minute token lifetime · Camera target: 1280×720 at 30 fps (network/browser may adapt) · Session ID: {sessionId||"pending"}</small>
 </section>;
}
