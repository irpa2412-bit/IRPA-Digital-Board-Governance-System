import React,{useEffect,useState} from "react";
import {collection,onSnapshot} from "firebase/firestore";
import {auth,db} from "../firebase/config";

export default function GrantOpportunityNotifications(){
 const [current,setCurrent]=useState(null);
 const [queue,setQueue]=useState([]);
 const uid=auth.currentUser?.uid||"";
 useEffect(()=>{
  if(!uid)return;
  let active=true;
  const key="irpa-grant-notifications-seen:"+uid;
  const readSeen=()=>{try{return new Set(JSON.parse(localStorage.getItem(key)||"[]"))}catch{return new Set()}};
  const unsubscribe=onSnapshot(collection(db,"grantOpportunities"),snapshot=>{
   if(!active)return;
   const seen=readSeen();
   const recent=snapshot.docs.map(d=>({id:d.id,...d.data()})).filter(item=>{
    const raw=item.createdAt?.toDate?item.createdAt.toDate():new Date(item.createdAt||0);
    return item.id&&!seen.has(item.id)&&Number.isFinite(raw.getTime())&&(Date.now()-raw.getTime())<14*24*60*60*1000;
   }).sort((a,b)=>millis(b.createdAt)-millis(a.createdAt));
   setQueue(recent);
   setCurrent(recent[0]||null);
  },err=>console.warn("Grant update notification feed unavailable",err));
  return()=>{active=false;unsubscribe()};
 },[uid]);
 function dismiss(){
  if(!current)return;
  const key="irpa-grant-notifications-seen:"+uid;
  try{const seen=new Set(JSON.parse(localStorage.getItem(key)||"[]"));seen.add(current.id);localStorage.setItem(key,JSON.stringify([...seen].slice(-300)));}catch{}
  const next=queue.filter(x=>x.id!==current.id);setQueue(next);setCurrent(next[0]||null);
 }
 if(!current)return null;
 return <div role="dialog" aria-modal="true" aria-labelledby="grant-update-title" style={{position:"fixed",zIndex:18000,right:18,bottom:18,width:"min(440px,calc(100vw - 36px))",boxSizing:"border-box",padding:18,borderRadius:16,background:"var(--panel-bg,#101b2a)",color:"var(--text-primary,#f2f6fb)",border:"1px solid #3f7d77",boxShadow:"0 18px 55px #0008"}}>
  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><span aria-hidden="true" style={{fontSize:23}}>◉</span><div style={{flex:1}}><div style={{fontSize:10,fontWeight:800,letterSpacing:1.3,color:"#76d7bc"}}>IRPA-DBGS FUNDING UPDATE</div><h2 id="grant-update-title" style={{fontSize:17,margin:"4px 0 0"}}>New funding opportunity</h2></div><button type="button" onClick={dismiss} aria-label="Dismiss funding update" style={{background:"transparent",color:"inherit",border:0,fontSize:22,cursor:"pointer"}}>×</button></div>
  <strong style={{display:"block",fontSize:15,marginBottom:6}}>{current.title||"New opportunity added"}</strong>
  <div style={{fontSize:12,color:"#aebed0",lineHeight:1.5,marginBottom:12}}>{current.funder||"Funder not specified"} · {current.verificationStatus||"Pending verification"}{current.deadline?" · Deadline: "+String(current.deadline):""}</div>
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{current.url&&<a href={current.url} target="_blank" rel="noreferrer" style={{background:"#174d55",borderRadius:8,padding:"8px 11px",color:"#fff",fontSize:12,fontWeight:700,textDecoration:"none"}}>Review opportunity ↗</a>}<button type="button" onClick={()=>{try{window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:{module:"Grant Intelligence & Funding Opportunities"}}))}catch{}dismiss()}} style={{background:"transparent",border:"1px solid #526579",borderRadius:8,padding:"8px 11px",color:"inherit",fontSize:12,cursor:"pointer"}}>Open portal</button><button type="button" onClick={dismiss} style={{background:"transparent",border:"1px solid #526579",borderRadius:8,padding:"8px 11px",color:"inherit",fontSize:12,cursor:"pointer"}}>Dismiss</button></div>
  {queue.length>1&&<div style={{fontSize:11,color:"#aebed0",marginTop:10}}>{queue.length-1} more new update{queue.length-1===1?"":"s"} in this session</div>}
 </div>;
}
function millis(value){if(!value)return 0;const date=value?.toDate?value.toDate():new Date(value);return Number.isNaN(date.getTime())?0:date.getTime();}
