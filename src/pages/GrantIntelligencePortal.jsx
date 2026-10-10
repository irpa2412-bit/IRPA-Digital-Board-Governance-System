import React,{useEffect,useMemo,useState} from "react";
import {addDoc,collection,onSnapshot,serverTimestamp,updateDoc,doc} from "firebase/firestore";
import app,{auth,db} from "../firebase/config";

const PILLARS=[
 {id:"rangeland",label:"Sustainable Rangeland Management",short:"Rangeland"},
 {id:"livestock",label:"Livestock Development",short:"Livestock"},
 {id:"market",label:"Market Development",short:"Markets"}
];
const THEMES=[
 {id:"climate",label:"Climate Change Adaptation and Resilience"},
 {id:"gender",label:"Gender Equality and Social Inclusion"},
 {id:"youth",label:"Youth Empowerment"},
 {id:"community",label:"Community Participation"},
 {id:"innovation",label:"Research, Innovation and Knowledge Management"},
 {id:"governance",label:"Governance and Institutional Capacity Strengthening"},
 {id:"environment",label:"Environmental Sustainability"}
];
const SOURCES=[
 {name:"UNDP Funding and Procurement",url:"https://www.undp.org/procurement"},
 {name:"FAO Calls and Opportunities",url:"https://www.fao.org"},
 {name:"Global Environment Facility",url:"https://www.thegef.org"},
 {name:"Green Climate Fund",url:"https://www.greenclimate.fund"},
 {name:"Adaptation Fund",url:"https://www.adaptation-fund.org"},
 {name:"African Development Bank",url:"https://www.afdb.org"},
 {name:"Tanzania Forest Services",url:"https://www.tfs.go.tz"},
 {name:"Grants.gov open opportunities",url:"https://www.grants.gov/search-grants"}
];
const statusOptions=["Open","Upcoming","Closed","Under review","Application in progress","Submitted","Awarded","Not pursuing"];
const styles={
 page:{color:"var(--text-primary, #e8edf5)",display:"grid",gap:18},
 hero:{padding:24,borderRadius:18,background:"linear-gradient(125deg,#102a43,#174d55)",color:"#fff",display:"flex",justifyContent:"space-between",gap:18,alignItems:"center",flexWrap:"wrap"},
 eyebrow:{fontSize:11,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",opacity:.8},
 title:{fontSize:28,fontWeight:800,margin:"7px 0"},
 muted:{color:"var(--text-secondary, #aab6c5)",fontSize:13,lineHeight:1.5},
 card:{border:"1px solid var(--border-color, #344255)",borderRadius:14,padding:16,background:"var(--panel-bg, #111c2b)"},
 input:{width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:9,border:"1px solid var(--border-color, #425064)",background:"var(--input-bg, #0b1420)",color:"var(--text-primary, #e8edf5)",fontSize:14},
 button:{padding:"10px 13px",borderRadius:9,border:"1px solid #50727b",background:"#174d55",color:"#fff",fontWeight:700,cursor:"pointer"},
 tag:{display:"inline-flex",padding:"4px 8px",borderRadius:999,border:"1px solid #42636d",fontSize:11,margin:"2px 4px 2px 0"}
};
const cleanArray=v=>Array.isArray(v)?v:[];
const dateLabel=v=>{if(!v)return "Not specified";const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?"Not specified":d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"Africa/Dar_es_Salaam"});};
const text=v=>String(v||"").trim();

export default function GrantIntelligencePortal({profile,employee,isAdmin=false}){
 const [records,setRecords]=useState([]);
 const [crawlerRecords,setCrawlerRecords]=useState([]);
 const [crawlerResultsBusy,setCrawlerResultsBusy]=useState(false);
 const [crawlerStatus,setCrawlerStatus]=useState(null);
 const [crawlerSources,setCrawlerSources]=useState([]);
 const [crawlerRunning,setCrawlerRunning]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [queryText,setQueryText]=useState("");
 const [pillar,setPillar]=useState("all");
 const [theme,setTheme]=useState("all");
 const [status,setStatus]=useState("all");
 const [showForm,setShowForm]=useState(false);
 const [saving,setSaving]=useState(false);
 const [draft,setDraft]=useState({title:"",funder:"",url:"",deadline:"",country:"Tanzania",amount:"",summary:"",status:"Open",pillars:["rangeland"],themes:[]});
 const uid=auth.currentUser?.uid||"";
 const roleList=[profile?.role,profile?.roles,employee?.role,employee?.roles].flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim().toLowerCase());
 const canManage=isAdmin||roleList.some(r=>["administrator","executive director","director outreach","director finance & administration","director research","research director","research manager","fundraising officer","research officer"].includes(r));
 async function loadCrawlerResults(showNotice=false){
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-staging.irpa-governance.workers.dev").replace(/\/+$/,"");
   const token=await auth.currentUser?.getIdToken();
   if(!token){if(showNotice)setError("Your session has expired. Sign in again to load crawler results.");return;}
   setCrawlerResultsBusy(true);
   try{
     const response=await fetch(workerUrl+"/opportunities",{headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(15000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Crawler results request failed ("+response.status+").");
     setCrawlerRecords((Array.isArray(data.items)?data.items:[]).map(item=>({
       id:"crawler-"+item.id,title:item.title||"Untitled opportunity",
       funder:(()=>{try{return new URL(item.source_url||item.url).hostname.replace(/^www\./,"")}catch{return "Official source"}})(),
       url:item.url||"",deadline:item.deadline_at||null,
       country:item.geography_assessment==="tanzania_mentioned"?"Tanzania":item.geography_assessment==="regional_or_lmic_scope"?"Regional / LMIC":"Not verified",
       amount:"Not stated",summary:item.description||"No description supplied in source feed.",
       status:["closed","expired"].includes(String(item.call_status||"").toLowerCase())?"Closed":item.call_status==="open"?"Open":"Under review",
       pillars:["livestock/agriculture"].includes(JSON.parse(item.fit_reasons||"[]")[0])?["livestock"]:["rangeland"],
       themes:[],verificationStatus:"Pending official-call verification",sourceType:"Cloudflare crawler",
       fitScore:Number(item.fit_score||0),fitReasons:item.fit_reasons||"[]",
       eligibilityStatus:item.eligibility_status||"unverified",triageAssessment:item.triage_assessment||"manual_eligibility_review",
       createdAt:item.first_seen_at||null
     })));
     if(data.lastRun)setCrawlerStatus({status:data.lastRun.status,created:data.lastRun.items_changed,candidatesFound:data.lastRun.items_seen,lastCompletedAt:data.lastRun.finished_at,lastStartedAt:data.lastRun.finished_at});
     if(showNotice)setNotice("Refreshed "+String(data.count||0)+" grant records from the Cloudflare crawler. Eligibility remains unverified.");
   }catch(err){console.error("Crawler result retrieval failed",err);if(showNotice)setError(err?.message||"Unable to load crawler results.");}
   finally{setCrawlerResultsBusy(false);}
 }
 useEffect(()=>{loadCrawlerResults(false)},[]);
 useEffect(()=>onSnapshot(collection(db,"grantOpportunities"),snap=>{
   const next=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMillis(b.createdAt)-dateMillis(a.createdAt));
   setRecords(next);setLoading(false);setError("");
 },err=>{console.error("Grant opportunity subscription failed",err);setError("Grant records could not be loaded. Check your signed-in profile's Firestore access.");setLoading(false)}),[]);
 useEffect(()=>onSnapshot(doc(db,"grantCrawlerStatus","current"),snap=>setCrawlerStatus(snap.exists()?snap.data():null),err=>console.warn("Grant crawler status unavailable",err)),[]);
 useEffect(()=>onSnapshot(collection(db,"grantCrawlerSources"),snap=>setCrawlerSources(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")))),err=>console.warn("Grant crawler source health unavailable",err)),[]);
 const filtered=useMemo(()=>records.filter(r=>{
   const hay=[r.title,r.funder,r.summary,r.country,r.amount].join(" ").toLowerCase();
   return (!queryText||hay.includes(queryText.toLowerCase()))&&(pillar==="all"||cleanArray(r.pillars).includes(pillar))&&(theme==="all"||cleanArray(r.themes).includes(theme))&&(status==="all"||r.status===status);
 }),[records,queryText,pillar,theme,status]);
 const counts=useMemo(()=>({open:records.filter(r=>r.status==="Open").length,review:records.filter(r=>["Under review","Application in progress"].includes(r.status)).length,submitted:records.filter(r=>["Submitted","Awarded"].includes(r.status)).length}),[records]);
 async function startCrawlerScan(){
   if(!isAdmin){setError("Only an administrator can trigger a manual full-source scan.");return;}
   try{
     setCrawlerRunning(true);setError("");setNotice("Manual donor-source scan requested. This can take several minutes.");
     const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-staging.irpa-governance.workers.dev").replace(/\/+$/, "");
     const idToken=await auth.currentUser?.getIdToken();
     if(!idToken) throw new Error("Your session has expired. Sign in again.");
     const response=await fetch(workerUrl.replace(/\/+$/, "")+"/run",{method:"POST",headers:{"Authorization":"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"});
     const data=await response.json().catch(()=>({}));
     if(!response.ok) throw new Error(data.error||"Cloudflare grant crawler request failed ("+response.status+").");
     setNotice("Grant crawler scan "+String(data.status||"finished")+". Sources checked: "+String(data.sourceCount||0)+", candidates found: "+String(data.candidatesFound||0)+", new records: "+String(data.created||0)+". Every discovered item remains pending verification.");
   }catch(err){console.error("Manual grant crawler scan failed",err);setError(err?.message||"Manual scan failed. Check Cloud Functions deployment and administrator access.");}
   finally{setCrawlerRunning(false);}
 }
 async function saveOpportunity(e){
   e.preventDefault();if(!canManage){setError("Only designated grant-management and executive roles may publish or update opportunities.");return;}
   if(!text(draft.title)||!text(draft.funder)||!text(draft.url)||!draft.pillars.length){setError("Enter the opportunity title, funder, official source URL and at least one strategic pillar.");return;}
   try{
     setSaving(true);setError("");
     const payload={...draft,title:text(draft.title),funder:text(draft.funder),url:text(draft.url),summary:text(draft.summary),country:text(draft.country)||"Not specified",amount:text(draft.amount)||"Not specified",deadline:draft.deadline||null,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdByUid:uid,createdByEmail:auth.currentUser?.email||"",verificationStatus:"Pending verification",sourceType:"Official source URL",recordOrigin:"PRODUCTION"};
     await addDoc(collection(db,"grantOpportunities"),payload);
     setDraft({title:"",funder:"",url:"",deadline:"",country:"Tanzania",amount:"",summary:"",status:"Open",pillars:["rangeland"],themes:[]});setShowForm(false);setNotice("Opportunity saved. It is marked Pending verification until checked against the donor's official call.");setTimeout(()=>setNotice(""),7000);
   }catch(err){console.error(err);setError(err?.message||"Could not save the opportunity. Check the deployed Firestore rules.");}
   finally{setSaving(false);}
 }
 async function changeStatus(record,nextStatus){
   if(!canManage)return;
   try{await updateDoc(doc(db,"grantOpportunities",record.id),{status:nextStatus,updatedAt:serverTimestamp(),lastUpdatedByUid:uid});setNotice("Opportunity status updated.");setTimeout(()=>setNotice(""),4000);}
   catch(err){setError(err?.message||"Status update failed.");}
 }
 function toggleDraftArray(key,value){setDraft(d=>({...d,[key]:d[key].includes(value)?d[key].filter(x=>x!==value):[...d[key],value]}));}
 return <div style={styles.page}>
  <section style={styles.hero}>
   <div style={{maxWidth:760}}>
    <div style={styles.eyebrow}>IRPA-DBGS · FUNDING INTELLIGENCE</div>
    <h1 style={styles.title}>Live Grants & Calls for Proposals</h1>
    <div style={{fontSize:14,lineHeight:1.6,color:"#e1edf2"}}>Discover, classify and manage funding opportunities against IRPA's three strategic pillars and seven cross-cutting themes. All authenticated profiles can access this portal at no additional cost.</div>
   </div>
   <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
    {canManage&&<button style={styles.button} onClick={()=>setShowForm(v=>!v)}>{showForm?"Close form":"+ Add opportunity"}</button>}
    <button style={{...styles.button,background:"transparent"}} onClick={()=>{setQueryText("");setPillar("all");setTheme("all");setStatus("all")}}>Reset filters</button>
   </div>
  </section>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
   {[["Tracked opportunities",records.length,"All records"],["Open calls",counts.open,"Status: Open"],["In preparation",counts.review,"Review / drafting"],["Submitted or awarded",counts.submitted,"Pipeline progress"]].map(([label,value,sub])=><div key={label} style={styles.card}><div style={styles.muted}>{label}</div><div style={{fontSize:28,fontWeight:800,margin:"7px 0"}}>{value}</div><div style={{fontSize:11,color:"#8ba2b8"}}>{sub}</div></div>)}
  </div>
  <section style={{...styles.card,display:"grid",gap:12}} aria-labelledby="crawler-status-heading">
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}>
    <div><div style={styles.eyebrow}>AUTOMATED SOURCE MONITOR</div><h2 id="crawler-status-heading" style={{fontSize:18,margin:"5px 0"}}>Multi-donor web crawler</h2><p style={{...styles.muted,margin:0}}>Checks public RSS/Atom feeds, public APIs and selected donor opportunity hubs every six hours. New records are unverified leads, not confirmed eligible grants.</p></div>
    {isAdmin&&<button type="button" disabled={crawlerRunning} style={{...styles.button,opacity:crawlerRunning?0.6:1}} onClick={startCrawlerScan}>{crawlerRunning?"Scanning sources…":"Run scan now"}</button>}
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10}}>
    {[[ "Crawler state",crawlerStatus?.status||"Awaiting first scan"],[ "Healthy sources",String(crawlerStatus?.healthySources??0)+" / "+String(crawlerStatus?.configuredSources??11)],[ "New records last run",String(crawlerStatus?.created??0)],[ "Candidates last run",String(crawlerStatus?.candidatesFound??0)]].map(([label,value])=><div key={label} style={{border:"1px solid #344255",borderRadius:10,padding:11}}><div style={styles.muted}>{label}</div><strong style={{display:"block",fontSize:17,marginTop:5}}>{value}</strong></div>)}
   </div>
   <div style={styles.muted}>Last scan started: {dateLabel(crawlerStatus?.lastStartedAt)} · Last completed: {dateLabel(crawlerStatus?.lastCompletedAt)} · Cadence: every 6 hours (Tanzania time)</div>
   <details><summary style={{cursor:"pointer",fontSize:13,fontWeight:700}}>Source health and crawl results ({crawlerSources.length})</summary><div style={{display:"grid",gap:7,marginTop:10}}>{crawlerSources.map(source=><div key={source.id} style={{borderTop:"1px solid #344255",paddingTop:8,display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}><div><strong style={{fontSize:13}}>{source.name||source.id}</strong><div style={styles.muted}>{source.url}</div>{source.error&&<div style={{fontSize:12,color:"#ffb8b8"}}>{source.error}</div>}</div><div style={{textAlign:"right",minWidth:100,fontSize:12}}><strong>{source.status||"Not checked"}</strong><div style={styles.muted}>{source.candidateCount??0} candidates</div></div></div>)}</div></details>
   <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Coverage limitation:</strong> source websites can change, block automated requests or publish calls outside feeds. The crawler records source failures, uses public endpoints only, and does not bypass access controls or submit applications. Official-call verification and IRPA eligibility screening remain necessary.</div>
  </section>
  {notice&&<div role="status" style={{...styles.card,borderColor:"#32846d",color:"#8de0b7"}}>{notice}</div>}
  {error&&<div role="alert" style={{...styles.card,borderColor:"#b65c5c",color:"#ffb8b8"}}>{error}</div>}
  {showForm&&canManage&&<form onSubmit={saveOpportunity} style={{...styles.card,display:"grid",gap:13}}>
   <div><h2 style={{margin:"0 0 5px"}}>Register funding opportunity</h2><div style={styles.muted}>Enter details from the donor's official announcement. New entries remain pending verification.</div></div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
    <label style={{fontSize:12}}>Opportunity title<input required style={{...styles.input,marginTop:5}} value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label>
    <label style={{fontSize:12}}>Funder / issuing organization<input required style={{...styles.input,marginTop:5}} value={draft.funder} onChange={e=>setDraft(d=>({...d,funder:e.target.value}))}/></label>
    <label style={{fontSize:12}}>Official call URL<input required type="url" style={{...styles.input,marginTop:5}} value={draft.url} onChange={e=>setDraft(d=>({...d,url:e.target.value}))} placeholder="https://..."/></label>
    <label style={{fontSize:12}}>Application deadline<input type="date" style={{...styles.input,marginTop:5}} value={draft.deadline} onChange={e=>setDraft(d=>({...d,deadline:e.target.value}))}/></label>
    <label style={{fontSize:12}}>Eligible geography<input style={{...styles.input,marginTop:5}} value={draft.country} onChange={e=>setDraft(d=>({...d,country:e.target.value}))}/></label>
    <label style={{fontSize:12}}>Funding amount / range<input style={{...styles.input,marginTop:5}} value={draft.amount} onChange={e=>setDraft(d=>({...d,amount:e.target.value}))} placeholder="As stated by donor"/></label>
    <label style={{fontSize:12}}>Pipeline status<select style={{...styles.input,marginTop:5}} value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value}))}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select></label>
   </div>
   <label style={{fontSize:12}}>Opportunity summary<textarea rows="3" style={{...styles.input,marginTop:5,resize:"vertical"}} value={draft.summary} onChange={e=>setDraft(d=>({...d,summary:e.target.value}))}/></label>
   <fieldset style={{border:"1px solid #425064",borderRadius:10,padding:12}}><legend style={{padding:"0 6px",fontSize:12}}>Strategic pillars — select one or more</legend><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>{PILLARS.map(p=><label key={p.id} style={{display:"flex",gap:8,alignItems:"center",fontSize:12}}><input type="checkbox" checked={draft.pillars.includes(p.id)} onChange={()=>toggleDraftArray("pillars",p.id)}/>{p.label}</label>)}</div></fieldset>
   <fieldset style={{border:"1px solid #425064",borderRadius:10,padding:12}}><legend style={{padding:"0 6px",fontSize:12}}>Cross-cutting themes</legend><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>{THEMES.map(t=><label key={t.id} style={{display:"flex",gap:8,alignItems:"center",fontSize:12}}><input type="checkbox" checked={draft.themes.includes(t.id)} onChange={()=>toggleDraftArray("themes",t.id)}/>{t.label}</label>)}</div></fieldset>
   <div><button disabled={saving} type="submit" style={{...styles.button,opacity:saving ? 0.6 : 1}}>{saving?"Saving…":"Save opportunity"}</button></div>
  </form>}
  <section style={{...styles.card,display:"grid",gap:12}}>
   <h2 style={{margin:0,fontSize:18}}>Find matching opportunities</h2>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
    <input aria-label="Search opportunities" style={styles.input} placeholder="Search title, funder, country…" value={queryText} onChange={e=>setQueryText(e.target.value)}/>
    <select aria-label="Filter by strategic pillar" style={styles.input} value={pillar} onChange={e=>setPillar(e.target.value)}><option value="all">All strategic pillars</option>{PILLARS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
    <select aria-label="Filter by cross-cutting theme" style={styles.input} value={theme} onChange={e=>setTheme(e.target.value)}><option value="all">All cross-cutting themes</option>{THEMES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
    <select aria-label="Filter by application status" style={styles.input} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option>{statusOptions.map(s=><option key={s}>{s}</option>)}</select>
   </div>
  </section>
  <section style={{display:"grid",gap:12}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}><h2 style={{fontSize:19,margin:0}}>Opportunity register</h2><span style={styles.muted}>{filtered.length} matching records</span></div>
   {loading?<div style={styles.card} role="status">Loading live opportunity records…</div>:filtered.length===0?<div style={styles.card}><strong>No matching opportunities yet</strong><p style={styles.muted}>The register is empty or no records match the selected filters. Use the official source links below to check current calls, then register relevant announcements through an authorized profile.</p></div>:filtered.map(r=><article key={r.id} style={styles.card}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
     <div style={{flex:"1 1 380px"}}><div style={styles.eyebrow}>{r.funder||"Funder not specified"} · {r.verificationStatus||"Verification status unavailable"}</div><h3 style={{fontSize:18,margin:"7px 0"}}>{r.title}</h3><p style={{...styles.muted,margin:"0 0 10px"}}>{r.summary||"No summary provided."}</p></div>
     <div style={{minWidth:150}}><div style={{fontSize:12,color:"#9fb0c3"}}>Deadline</div><strong>{dateLabel(r.deadline)}</strong><div style={{fontSize:12,marginTop:8,color:"#9fb0c3"}}>Status</div><strong>{r.status||"Unclassified"}</strong></div>
    </div>
    <div style={{display:"flex",gap:5,flexWrap:"wrap",margin:"8px 0"}}>{cleanArray(r.pillars).map(id=><span key={id} style={styles.tag}>{PILLARS.find(p=>p.id===id)?.label||id}</span>)}{cleanArray(r.themes).map(id=><span key={id} style={{...styles.tag,borderColor:"#6c5b8f"}}>{THEMES.find(t=>t.id===id)?.label||id}</span>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}><span style={styles.muted}>Geography: {r.country||"Not specified"} · Funding: {r.amount||"Not specified"} · Updated: {dateLabel(r.updatedAt||r.createdAt)}</span><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a href={r.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>Open official call ↗</a>{canManage&&<select aria-label={"Update status for "+r.title} style={{...styles.input,width:"auto"}} value={r.status||"Open"} onChange={e=>changeStatus(r,e.target.value)}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select>}</div></div>
   </article>)}
  </section>
  <section style={styles.card}>
   <h2 style={{fontSize:18,marginTop:0}}>Official funding-source directory</h2><p style={styles.muted}>Open the source to verify the current call, eligible applicants, deadlines and original application documents. Source pages are not proof that a call is currently open.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:9}}>{SOURCES.map(s=><a key={s.name} href={s.url} target="_blank" rel="noreferrer" style={{border:"1px solid #425064",borderRadius:9,padding:12,color:"var(--text-primary, #e8edf5)",textDecoration:"none",fontSize:13,fontWeight:650}}>{s.name} ↗</a>)}</div>
  </section>
  <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Live-data status:</strong> this portal subscribes to the shared IRPA opportunity register in real time. The source directory supports official verification; automated multi-donor crawling and scheduled ingestion require a separately configured collector and approved source/API access. No sample or unverified record is represented as a confirmed live grant.</div>
 </div>;
}
function dateMillis(v){if(!v)return 0;const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();}
