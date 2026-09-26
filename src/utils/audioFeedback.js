let audioContext=null;
let masterGain=null;
let installed=false;
let muted=false;
let lastPlayedAt=0;

const SOUND_PROFILES={
  success:{
    tones:[
      {frequency:660,duration:0.09,delay:0,type:"sine",gain:0.055},
      {frequency:880,duration:0.14,delay:0.08,type:"sine",gain:0.065}
    ]
  },
  warning:{
    tones:[
      {frequency:520,duration:0.13,delay:0,type:"triangle",gain:0.055},
      {frequency:390,duration:0.16,delay:0.13,type:"triangle",gain:0.06}
    ]
  },
  alert:{
    tones:[
      {frequency:760,duration:0.11,delay:0,type:"square",gain:0.045},
      {frequency:520,duration:0.11,delay:0.12,type:"square",gain:0.05},
      {frequency:760,duration:0.14,delay:0.24,type:"square",gain:0.045}
    ]
  }
};

function getAudioContext(){
  if(typeof window==="undefined")return null;
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)return null;
  if(!audioContext){
    try{
      audioContext=new Context();
      masterGain=audioContext.createGain();
      masterGain.gain.value=0.72;
      masterGain.connect(audioContext.destination);
    }catch{
      audioContext=null;
      masterGain=null;
    }
  }
  return audioContext;
}

async function unlockAudio(){
  const ctx=getAudioContext();
  if(!ctx)return false;
  try{
    if(ctx.state==="suspended")await ctx.resume();
    return ctx.state==="running";
  }catch{
    return false;
  }
}

function scheduleTone(ctx,profile,tone,baseTime){
  const oscillator=ctx.createOscillator();
  const gain=ctx.createGain();
  const start=baseTime+tone.delay;
  const end=start+tone.duration;
  oscillator.type=tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency,start);
  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.exponentialRampToValueAtTime(tone.gain,start+0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001,Math.max(start+0.02,end-0.018));
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(start);
  oscillator.stop(end);
}

export async function playIRPAAudio(type="success"){
  if(muted)return false;
  const profile=SOUND_PROFILES[type];
  if(!profile)return false;
  const ctx=await unlockAudio();
  if(!ctx||!masterGain)return false;
  const now=performance.now();
  if(now-lastPlayedAt<65)return false;
  lastPlayedAt=now;
  const base=ctx.currentTime+0.004;
  profile.tones.forEach(tone=>scheduleTone(ctx,profile,tone,base));
  return true;
}

export const playIRPASuccess=()=>playIRPAAudio("success");
export const playIRPAWarning=()=>playIRPAAudio("warning");
export const playIRPAAlert=()=>playIRPAAudio("alert");

export function setIRPAAudioMuted(value){
  muted=Boolean(value);
  try{window.localStorage.setItem("irpa-audio-muted",muted?"1":"0")}catch{}
  if(masterGain)masterGain.gain.value=muted?0:0.72;
}

export function isIRPAAudioMuted(){return muted;}

export function installIRPAAudioFeedback(){
  if(installed||typeof window==="undefined"||typeof document==="undefined")return()=>{};
  installed=true;
  try{muted=window.localStorage.getItem("irpa-audio-muted")==="1"}catch{}
  const unlock=()=>{void unlockAudio();};
  const blockedInteraction=event=>{
    const target=event.target instanceof Element?event.target:null;
    const blocked=target?.closest?.("button[disabled],[aria-disabled=\"true\"],[data-irpa-blocked=\"true\"]");
    if(!blocked)return;
    void playIRPAAlert();
  };
  const audioEvent=event=>{
    const type=String(event?.detail?.type||"").toLowerCase();
    if(type==="success")void playIRPASuccess();
    else if(type==="warning")void playIRPAWarning();
    else if(type==="alert")void playIRPAAlert();
  };
  const events=["pointerdown","keydown","touchstart"];
  events.forEach(name=>window.addEventListener(name,unlock,{capture:true,passive:true}));
  window.addEventListener("pointerdown",blockedInteraction,{capture:true,passive:true});
  window.addEventListener("click",blockedInteraction,{capture:true,passive:true});
  window.addEventListener("irpa:audio",audioEvent);
  window.irpaAudio={
    success:playIRPASuccess,
    warning:playIRPAWarning,
    alert:playIRPAAlert,
    setMuted:setIRPAAudioMuted,
    isMuted:isIRPAAudioMuted
  };
  return()=>{
    events.forEach(name=>window.removeEventListener(name,unlock,{capture:true}));
    window.removeEventListener("pointerdown",blockedInteraction,{capture:true});
    window.removeEventListener("click",blockedInteraction,{capture:true});
    window.removeEventListener("irpa:audio",audioEvent);
    try{delete window.irpaAudio}catch{}
    installed=false;
  };
}
