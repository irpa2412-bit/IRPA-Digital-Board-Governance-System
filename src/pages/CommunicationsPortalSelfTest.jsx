import React,{useState} from "react";
import {auth} from "../firebase/config";
import {getGoogleDriveGatewayUrl} from "../firebase/gatewayUrl";
const GATEWAY=getGoogleDriveGatewayUrl();
const checks=[
 {name:"Editorial item list",path:"/api/communications/editorial/items",expected:[200]},
 {name:"Pause-all status",path:"/api/communications/publishing/pause",expected:[200]},
 {name:"Social adapter status",path:"/api/communications/social/status",expected:[200]},
 {name:"WordPress connection status",path:"/api/communications/site/status",expected:[200,503]},
 {name:"WordPress pages list",path:"/api/communications/website/content?type=pages",expected:[200,503]},
 {name:"WordPress posts list",path:"/api/communications/website/content?type=posts",expected:[200,503]},
 {name:"Media/story records",path:"/api/communications/records?collection=communicationMediaItems",expected:[200]},
 {name:"Editorial audit log (approver/admin only)",path:"/api/communications/editorial/audit",expected:[200,403]}
];
const style={panel:{border:"1px solid var(--border-color,#d5dce5)",borderRadius:12,padding:14,display:"grid",gap:10,background:"var(--surface,#fff)"},button:{padding:"10px 12px",borderRadius:8,border:"1px solid var(--border-color,#cbd5e1)",font:"inherit",fontWeight:700,background:"#1d4ed8",color:"#fff"}};
export default function CommunicationsPortalSelfTest(){
 const [results,setResults]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function run(){setBusy(true);setMessage("");const out=[];try{if(!auth.currentUser)throw Error("Sign in before running route checks.");const token=await auth.currentUser.getIdToken();for(const c of checks){try{const r=await fetch(GATEWAY+c.path,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}const pass=c.expected.includes(r.status);out.push({name:c.name,status:pass?"PASS":"FAIL",reason:"HTTP "+r.status+"; "+String(data.error||data.message||(r.status===200?"Route responded.":"Unexpected response.")).slice(0,240)});}catch(e){out.push({name:c.name,status:"FAIL",reason:String(e.message||e).slice(0,240)})}}}catch(e){out.push({name:"Authentication",status:"FAIL",reason:String(e.message||e)})}setResults(out);setMessage(out.every(x=>x.status==="PASS")?"All configured route probes matched expected HTTP responses. This does not prove provider publishing or Cron execution.":"One or more route probes failed. Review each reason below.");setBusy(false)}
 const passed=results.filter(r=>r.status==="PASS").length;
 return <section style={{display:"grid",gap:12,minWidth:0}}><section style={style.panel}><h3 style={{margin:0}}>Communication Portal Self-Test</h3><p style={{margin:0}}>Runs authenticated, non-mutating probes for the editorial routes, pause switch, social status, WordPress, media records and audit permissions. A route response is not proof that external publishing is connected.</p><button type="button" style={style.button} disabled={busy} onClick={run}>{busy?"Testing routes…":"Run Portal Self-Test"}</button>{results.length>0&&<strong>{passed}/{results.length} checks passed</strong>}</section>{results.map((r,i)=><article key={r.name} style={style.panel}><div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>{r.name}</strong><strong>{r.status}</strong></div><div>{r.reason}</div></article>)}{message&&<div role="status" style={style.panel}>{message}</div>}</section>
}
