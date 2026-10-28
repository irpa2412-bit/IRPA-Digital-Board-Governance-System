import React,{useMemo,useState} from "react";

const panel={border:"1px solid var(--border-color,#d6dee8)",borderRadius:12,padding:14,background:"var(--surface,#fff)",color:"var(--text-primary,#172033)",minWidth:0};
const button={padding:"9px 12px",borderRadius:9,border:"1px solid var(--border-color,#cbd5e1)",background:"var(--surface-elevated,#f8fafc)",color:"var(--text-primary,#172033)",font:"inherit",fontWeight:650,cursor:"pointer"};
const primary={...button,background:"#1d4ed8",borderColor:"#1d4ed8",color:"#fff"};
const input={width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:9,border:"1px solid var(--border-color,#cbd5e1)",background:"var(--input-bg,#fff)",color:"var(--text-primary,#172033)",font:"inherit"};
const clean=value=>String(value??"").trim();
const plain=value=>String(value??"").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
const seoTitle=title=>clean(title).replace(/\s+/g," ").slice(0,60);
const description=(title,content)=>{const text=plain(content);return (text||clean(title)||"Improvement of Rangeland in Pastoral Areas (IRPA)").slice(0,157).replace(/[\s,;:.-]+$/,"")+".";};
const excerpt=(title,content)=>description(title,content).slice(0,600);

function auditContent(item){
 const issues=[];
 const title=clean(item.title);
 const body=String(item.content||"");
 const text=plain(body);
 const add=(field,severity,message,fixable=false)=>issues.push({id:String(item.type)+":"+item.id+":"+field,type:item.type,itemId:item.id,title:title||"(Untitled)",status:item.status||"unknown",field,severity,message,fixable});
 if(!title)add("title","high","Title is empty; edit manually before publishing.");
 else if(title.length>60)add("title","medium","Title is longer than the suggested 60-character SEO target.",false);
 if(Object.prototype.hasOwnProperty.call(item,"content")&&!text)add("content","high","Page/post content appears empty.",false);
 if(!clean(item.seoTitle))add("seoTitle","medium","SEO title is missing.",true);
 else if(clean(item.seoTitle).length>60)add("seoTitle","low","SEO title exceeds the suggested 60-character target.",true);
 if(!clean(item.seoDescription))add("seoDescription","medium","SEO meta description is missing.",true);
 else if(clean(item.seoDescription).length>160)add("seoDescription","low","SEO meta description exceeds the suggested 160-character target.",true);
 if(!clean(item.excerpt))add("excerpt","low","Excerpt is missing.",true);
 if(/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(body))add("imageAlt","medium","At least one image appears to have no alt attribute.",false);
 if(/<a\b[^>]*target\s*=\s*["']_blank["'](?![^>]*\brel\s*=)[^>]*>/i.test(body))add("externalLinkRel","low","A new-tab link may be missing rel protection.",false);
 return issues;
}

export default function CommunicationSiteHealthAssistant({gatewayRequest,onUseDraft}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[checkedAt,setCheckedAt]=useState(""),[site,setSite]=useState(null),[items,setItems]=useState([]),[issues,setIssues]=useState([]),[fixReport,setFixReport]=useState([]);
 const [topic,setTopic]=useState(""),[audience,setAudience]=useState("Pastoral and agro-pastoral communities"),[channel,setChannel]=useState("Facebook"),[keyFacts,setKeyFacts]=useState(""),[callToAction,setCallToAction]=useState("Learn more about IRPA's work"),[draft,setDraft]=useState("");
 const canFix=useMemo(()=>{const seen=new Set();return issues.filter(issue=>{const key=issue.type+":"+issue.itemId;if(!issue.fixable||issue.status!=="draft"||seen.has(key))return false;seen.add(key);return true;}).slice(0,10);},[issues]);
 async function runHealthCheck(){
  setBusy(true);setError("");setNotice("");setFixReport([]);
  try{
   const [status,posts,pages]=await Promise.all([
    gatewayRequest("/api/communications/site/status"),
    gatewayRequest("/api/communications/website/content?type=posts"),
    gatewayRequest("/api/communications/website/content?type=pages")
   ]);
   const connections=status?.connections;
   if(!connections||typeof connections!=="object")throw new Error("The gateway returned no valid website health report.");
   const all=[...(posts.items||[]),...(pages.items||[])];
   const sample=[...(posts.items||[]).slice(0,5),...(pages.items||[]).slice(0,5)];
   const inspectable=await Promise.all(sample.map(async item=>{
    try{const detail=await gatewayRequest("/api/communications/website/content/"+encodeURIComponent(item.type)+"/"+encodeURIComponent(item.id));return detail?.item||item;}
    catch{return item;}
   }));
   setSite(connections);setItems(all);
   const found=inspectable.flatMap(item=>auditContent(item));
   if(connections.websiteUp===false)found.unshift({id:"site:up",title:"Website availability",field:"availability",severity:"high",message:"The staging website could not be verified as available.",fixable:false});
   if(Array.isArray(connections.brokenLinks)&&connections.brokenLinks.length)found.unshift({id:"site:links",title:"Main navigation",field:"links",severity:"high",message:connections.brokenLinks.length+" main-menu link(s) failed the staging check.",fixable:false});
   setIssues(found);setCheckedAt(new Date().toISOString());
   setNotice("Health check completed: "+all.length+" staging content items listed; detailed content/SEO/accessibility checks ran on up to "+inspectable.length+" latest items. "+found.length+" issue(s) identified. Production was not accessed.");
  }catch(e){setError(e?.message||"The staging website health check failed.");}
  finally{setBusy(false);}
 }
 async function applySafeFixes(){
  if(!canFix.length||busy)return;
  const allowed=new Set(canFix.map(issue=>issue.type+":"+issue.itemId)).size;
  if(!window.confirm("Apply safe SEO/excerpt fixes to up to "+allowed+" DRAFT items on the isolated staging website? Each change is saved as a draft, creates a server-side snapshot/audit record, and is never published automatically."))return;
  setBusy(true);setError("");setNotice("");const report=[];
  try{
   for(const issue of canFix){
    if(report.some(row=>row.itemId===issue.itemId&&row.type===issue.type))continue;
    try{
     const response=await gatewayRequest("/api/communications/website/content/"+encodeURIComponent(issue.type)+"/"+encodeURIComponent(issue.itemId));
     const item=response?.item;
     if(!item||item.status!=="draft")throw new Error("Skipped because the item is no longer a draft.");
     const nextTitle=clean(item.title);
     if(!nextTitle)throw new Error("Skipped because the title is empty; a person must write it.");
     const nextExcerpt=clean(item.excerpt)||excerpt(nextTitle,item.content);
     const nextSeoTitle=clean(item.seoTitle)&&clean(item.seoTitle).length<=60?clean(item.seoTitle):seoTitle(nextTitle);
     const nextSeoDescription=clean(item.seoDescription)&&clean(item.seoDescription).length<=160?clean(item.seoDescription):description(nextTitle,item.content);
     const result=await gatewayRequest("/api/communications/website/content",{method:"PUT",body:JSON.stringify({type:item.type,id:item.id,title:item.title,content:item.content,excerpt:nextExcerpt,seoTitle:nextSeoTitle,seoDescription:nextSeoDescription,featuredMedia:Number(item.featuredMedia||0),workflow:"Draft"})});
     report.push({type:item.type,itemId:item.id,title:nextTitle,ok:true,message:result.message||"Draft updated and verified."});
    }catch(e){report.push({type:issue.type,itemId:issue.itemId,title:issue.title,ok:false,message:e?.message||"Fix failed."});}
   }
   setFixReport(report);
   const ok=report.filter(row=>row.ok).length;
   setNotice("Safe-fix run finished: "+ok+" draft(s) updated and verified; "+(report.length-ok)+" skipped or failed. Review the audit report below.");
   await runHealthCheck();
   setFixReport(report);
   setNotice("Safe-fix run finished: "+report.filter(row=>row.ok).length+" draft(s) updated and verified; "+report.filter(row=>!row.ok).length+" skipped or failed. Review the audit report below.");
  }finally{setBusy(false);}
 }
 function generateDraft(){
  const subject=clean(topic);if(!subject){setError("Enter a topic or campaign name first.");return;}
  const facts=clean(keyFacts);
  const lead=channel==="LinkedIn"?"IRPA is working with pastoral and agro-pastoral communities to strengthen resilient livelihoods and sustainable rangeland management.":channel==="Instagram"?"Healthy rangelands. Resilient livestock. Stronger pastoral livelihoods.":channel==="WhatsApp"?"IRPA update: "+subject+".":"At IRPA, sustainable rangelands and resilient pastoral livelihoods matter.";
  const text=[subject,lead,facts||"We support inclusive, community-led approaches to rangeland restoration, livestock development and sustainable economic opportunities.",clean(callToAction),channel==="X"?"#IRPA #Rangelands":"#IRPA #RangelandManagement #PastoralistLivelihoods"].filter(Boolean).join("\n\n");
  setDraft(text);setError("");setNotice("Draft prepared for review. Confirm every factual claim and date before use.");
 }
 const statusRows=site?[["Staging WordPress connection",site.website],["Staging cPanel connection",site.cpanel],["Staging website availability",site.websiteUp===true?"up":site.websiteUp===false?"down":"not verified"],["SSL certificate expiry",site.sslExpiry||"not available"],["Last backup",site.lastBackup||"not available"],["Broken main-menu links",Array.isArray(site.brokenLinks)?String(site.brokenLinks.length):"not available"],["WordPress updates",site.wordpressUpdates||"not available"],["Plugin updates",site.pluginUpdates||"not available"]]:[];
 return <div style={{display:"grid",gap:14,color:"var(--text-primary,#172033)"}}>
  <section style={panel}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}><div><h3 style={{margin:"0 0 6px"}}>Website health checker</h3><p style={{margin:0,lineHeight:1.5}}>Automated staging health checks run every two days. This panel also runs on demand. Checks are read-only; content/SEO draft changes require your explicit approval. Production is not accessed.</p></div><button type="button" style={primary} disabled={busy} onClick={runHealthCheck}>{busy?"Checking…":"Run health check"}</button></div>
  {checkedAt&&<p style={{fontSize:12,opacity:.8}}>Last checked: {new Date(checkedAt).toLocaleString()}</p>}
  {statusRows.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8}}>{statusRows.map(([label,value])=><div key={label} style={{border:"1px solid var(--border-color,#d6dee8)",borderRadius:9,padding:10,minWidth:0}}><div style={{fontSize:12,opacity:.75}}>{label}</div><strong style={{display:"block",marginTop:5,overflowWrap:"anywhere"}}>{value==null?"not available":String(value).replaceAll("_"," ")}</strong></div>)}</div>}
  {site&&Array.isArray(site.brokenLinks)&&site.brokenLinks.length>0&&<div><strong>Navigation links to review</strong>{site.brokenLinks.map((link,i)=><div key={i} style={{fontSize:13,overflowWrap:"anywhere"}}>{link.url} — HTTP {link.status}</div>)}</div>}
  {issues.length>0&&<div style={{display:"grid",gap:7}}><strong>{issues.length} finding(s)</strong>{issues.map(issue=><div key={issue.id} style={{border:"1px solid var(--border-color,#d6dee8)",borderRadius:8,padding:10}}><div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}><strong>{issue.title}</strong><span>{issue.severity}</span></div><div style={{fontSize:13,marginTop:4}}>{issue.message}</div>{issue.status&&<small>Status: {issue.status} · {issue.type} #{issue.itemId}</small>}</div>)}</div>}
  {issues.length===0&&checkedAt&&<p role="status">No content/SEO issues detected in the returned staging items. Technical checks that are unavailable remain unverified.</p>}
  {canFix.length>0&&<div style={{border:"1px solid #b45309",borderRadius:10,padding:12,display:"grid",gap:8}}><strong>Safe auto-fix · drafts only</strong><p style={{margin:0,fontSize:13,lineHeight:1.5}}>Can fix missing/overlong SEO titles, meta descriptions and excerpts for {new Set(canFix.map(issue=>issue.type+":"+issue.itemId)).size} draft item(s). Published and pending content is never auto-changed. Empty titles, broken links, accessibility markup and technical/hosting issues require a person.</p><button type="button" style={primary} disabled={busy} onClick={applySafeFixes}>{busy?"Applying…":"Apply safe fixes to draft items"}</button></div>}
  {fixReport.length>0&&<div style={{display:"grid",gap:6}}><strong>Auto-fix audit summary</strong>{fixReport.map((row,i)=><div key={row.type+row.itemId+i} style={{fontSize:13}}>{row.ok?"✓":"⚠"} {row.type} #{row.itemId} · {row.title}: {row.message}</div>)}</div>}
  </section>
  <section style={panel}><h3 style={{margin:"0 0 6px"}}>AI communications assistant</h3><p style={{margin:"0 0 12px",fontSize:13,lineHeight:1.5}}>Drafting helper for website and social content. This first version runs locally with structured templates; it does not send data to an AI provider. Review all facts and approve content before publishing.</p>
   <div style={{display:"grid",gap:10}}><label style={{display:"grid",gap:5,fontWeight:650}}>Topic or campaign<input style={input} value={topic} onChange={e=>setTopic(e.target.value)} maxLength={180} placeholder="e.g. Community-led rangeland restoration"/></label><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}><label style={{display:"grid",gap:5,fontWeight:650}}>Channel<select style={input} value={channel} onChange={e=>setChannel(e.target.value)}>{["Facebook","Instagram","LinkedIn","X","WhatsApp","IRPA Website"].map(value=><option key={value}>{value}</option>)}</select></label><label style={{display:"grid",gap:5,fontWeight:650}}>Audience<input style={input} value={audience} onChange={e=>setAudience(e.target.value)} maxLength={180}/></label></div><label style={{display:"grid",gap:5,fontWeight:650}}>Verified facts, dates or project details<textarea style={{...input,minHeight:90}} value={keyFacts} onChange={e=>setKeyFacts(e.target.value)} maxLength={1200} placeholder="Use only approved facts; do not enter private or confidential information."/></label><label style={{display:"grid",gap:5,fontWeight:650}}>Call to action<input style={input} value={callToAction} onChange={e=>setCallToAction(e.target.value)} maxLength={180}/></label><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={primary} onClick={generateDraft}>Generate draft</button><button type="button" style={button} disabled={!draft} onClick={()=>navigator.clipboard?.writeText(draft).then(()=>setNotice("Draft copied. Review before publishing.")).catch(()=>setError("Copy was blocked by the browser; select the draft text manually."))}>Copy draft</button></div>{draft&&<div style={{display:"grid",gap:8}}><strong>Draft preview · {channel} · for {audience||"your selected audience"}</strong><textarea aria-label="Generated draft preview" style={{...input,minHeight:160}} value={draft} onChange={e=>setDraft(e.target.value)}/><button type="button" style={primary} onClick={()=>onUseDraft?.({title:clean(topic),type:channel==="IRPA Website"?"Website Article":"Social Media",channel:channel==="IRPA Website"?"IRPA Website":channel,summary:description(topic,draft),body:draft,scheduledAt:"",tags:"rangeland, pastoral livelihoods",assetUrl:""})}>Open as an unsaved Workspace draft</button></div>}</div>
  </section>
  {error&&<div role="alert" style={{...panel,borderColor:"#dc2626"}}>{error}</div>}{notice&&<div role="status" style={{...panel,borderColor:"#16a34a"}}>{notice}</div>}
 </div>;
}
