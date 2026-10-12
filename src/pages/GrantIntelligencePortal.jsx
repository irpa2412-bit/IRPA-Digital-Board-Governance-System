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
 {name:"AfricanNGOs — funding calls for African NGOs",category:"African NGO funding directories",url:"https://africanngos.org/"},
 {name:"Grant Catalyst Africa — grant discovery",category:"African NGO funding directories",url:"https://grantcatalyst.africa/"},
 {name:"Africa Training Institute — funding finder",category:"African NGO funding directories",url:"https://africatraininginstitute.org/grants-funding/"},
 {name:"NGO Jobs Africa — grants and funding",category:"African NGO funding directories",url:"https://jobs.ngoportal.africa/grants-funding/"},
 {name:"TrustAfrica — grants and calls",category:"African foundations and civil society",url:"https://trustafrica.org/?Itemid=75&id=24&lang=en&option=com_grants&task=view"},
 {name:"Foundation for Civil Society Tanzania",category:"African foundations and civil society",url:"https://www.thefoundation.or.tz/what-we-do/grantmaking"},
 {name:"African Women's Development Fund (AWDF)",category:"African foundations and civil society",url:"https://awdf.org/grants/"},
 {name:"Urgent Action Fund-Africa",category:"African foundations and civil society",url:"https://uaf-africa.org/"},
 {name:"African Climate Foundation",category:"African foundations and civil society",url:"https://africanclimatefoundation.org/"},
 {name:"Global Fund for Community Foundations",category:"African foundations and civil society",url:"https://globalfundcommunityfoundations.org/"},
 {name:"African Philanthropy Forum",category:"African foundations and civil society",url:"https://africanpf.org/"},
 {name:"UNDP Tanzania — news and opportunities",category:"UN and multilateral institutions",url:"https://www.undp.org/tanzania/news"},
 {name:"UN Partner Portal — CSO partnerships",category:"UN and multilateral institutions",url:"https://www.unpartnerportal.org/landing/opportunities/"},
 {name:"FAO — funding opportunities",category:"UN and multilateral institutions",url:"https://www.fao.org/partnerships/funding-opportunities/en"},
 {name:"GEF Small Grants Programme",category:"UN and multilateral institutions",url:"https://www.thegef.org/what-we-do/topics/gef-small-grants-programme"},
 {name:"African Development Bank — procurement and calls",category:"African and regional institutions",url:"https://www.afdb.org/en/projects-and-operations/procurement"},
 {name:"AUDA-NEPAD",category:"African and regional institutions",url:"https://www.nepad.org/"},
 {name:"African Enterprise Challenge Fund (AECF)",category:"African and regional institutions",url:"https://www.aecfafrica.org/"},
 {name:"U.S. African Development Foundation (USADF)",category:"Embassies and bilateral funders",url:"https://www.usadf.gov/"},
 {name:"Canada Fund for Local Initiatives (CFLI)",category:"Embassies and bilateral funders",url:"https://www.international.gc.ca/world-monde/funding-financement/cfli-fcil/index.aspx?lang=eng"},
 {name:"EU Delegation to Tanzania",category:"Embassies and bilateral funders",url:"https://www.eeas.europa.eu/tanzania_en"},
 {name:"U.S. Embassy Tanzania — grants and announcements",category:"Embassies and bilateral funders",url:"https://tz.usembassy.gov/"},
 {name:"UK Government — international development funding",category:"Embassies and bilateral funders",url:"https://www.gov.uk/international-development-funding"},
 {name:"Tanzania Forest Fund",category:"Tanzania and East Africa",url:"https://www.mfukowamisitu.go.tz/download-center"},
 {name:"Tanzania Forest Services Agency",category:"Tanzania and East Africa",url:"https://www.tfs.go.tz/"},
 {name:"World Bank — grants and project opportunities",category:"International foundations and programmes",url:"https://www.worldbank.org/en/projects-operations/products-and-services/grants"},
 {name:"Global Greengrants Fund",category:"International foundations and programmes",url:"https://www.greengrants.org/"},
 {name:"IUCN — conservation funding and initiatives",category:"International foundations and programmes",url:"https://www.iucn.org/our-work/regions/africa"},
 {name:"Global Innovation Fund",category:"International foundations and programmes",url:"https://www.globalinnovation.fund/"},
 {name:"Darwin Initiative — biodiversity and livelihoods",category:"International foundations and programmes",url:"https://www.darwininitiative.org.uk/"},
 {name:"Green Climate Fund",category:"Climate, land and conservation",url:"https://www.greenclimate.fund/"},
 {name:"Adaptation Fund",category:"Climate, land and conservation",url:"https://www.adaptation-fund.org/"},
 {name:"Global Environment Facility",category:"Climate, land and conservation",url:"https://www.thegef.org/"},
 {name:"AfricanNGOs October–November 2026 opportunity roundup",category:"Current opportunity roundups",url:"https://africanngos.org/2026/10/06/african-ngo-funding-opportunities-october-november-2026/"},
 {name:"NGO Portal Africa — funding listings",category:"Current opportunity roundups",url:"https://jobs.ngoportal.africa/grants-funding/"},
 {name:"Africa Climate Change Fund — call portal",category:"African climate and resilience funding",url:"https://accf.afdb.org/"},
 {name:"Global EbA Fund — small-size grant calls",category:"African climate and resilience funding",url:"https://globalebafund.org/small-size-grants/"},
 {name:"Climate Justice Resilience Fund — grants and East Africa",category:"African climate and resilience funding",url:"https://cjrfund.org/our-grants/"},
 {name:"Whitley Fund for Nature — conservation funding applications",category:"Conservation and biodiversity funding",url:"https://whitleyaward.org/apply-for-conservation-funding/"},
 {name:"Critical Ecosystem Partnership Fund — grant opportunities",category:"Conservation and biodiversity funding",url:"https://www.cepf.net/grants"},
 {name:"Segal Family Foundation — grantmaking information (referral-based)",category:"African foundations and civil society",url:"https://www.segalfamilyfoundation.org/what-we-do/invest/grantmaking/"},
 {name:"Africa No Filter — grants and eligibility information",category:"African foundations and civil society",url:"https://africanofilter.org/what-we-do/community/faqs/"},
 {name:"The Pollination Project — grant application information",category:"International foundations and programmes",url:"https://thepollinationproject.org/apply/"},
 {name:"Africa Climate Change Fund — official information",category:"African and regional institutions",url:"https://www.afdb.org/en/topics-and-sectors/initiatives-partnerships/africa-climate-change-fund"},
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
const dateKeyInTanzania=value=>{
 if(value===undefined||value===null||value==="")return null;
 if(typeof value==="string"){
  const dateOnly=value.trim().match(/^(\d{4}-\d{2}-\d{2})$/);
  if(dateOnly)return dateOnly[1];
 }
 const parsed=value?.toDate?value.toDate():new Date(value);
 if(Number.isNaN(parsed.getTime()))return null;
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Dar_es_Salaam",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(parsed);
 const values=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
 return values.year+"-"+values.month+"-"+values.day;
};
const getOpportunityCurrentStatusIssue=record=>{
 const pipelineStatus=text(record?.status).toLowerCase();
 if(["submitted","awarded"].includes(pipelineStatus))return null;
 const callStatus=text(record?.callStatus||record?.call_status).toLowerCase();
 if(["expired","closed","closed_do_not_prioritize"].includes(callStatus)||(!callStatus&&["closed","expired"].includes(pipelineStatus)))return "closed";
 const deadline=dateKeyInTanzania(record?.deadline??record?.deadline_at??record?.closingDate??record?.closeDate??record?.dueDate);
 const today=dateKeyInTanzania(new Date());
 if(deadline&&deadline<today)return "expired";
 if(deadline)return null;
 const opportunityText=[record?.title,record?.summary,record?.applicationRequirements,record?.donorRequirements].filter(Boolean).join(" ");
 const rollingIntake=/\b(?:rolling basis|rolling applications?|year[- ]round|open throughout the year|no fixed deadline|no application deadline)\b/i.test(opportunityText);
 if(callStatus==="open"||rollingIntake)return null;
 if(pipelineStatus==="open"&&/\bverified\b|\bconfirmed\b/i.test(text(record?.verificationStatus)))return null;
 return "unverified";
};
const isNotCurrentOpportunity=record=>Boolean(getOpportunityCurrentStatusIssue(record));
export default function GrantIntelligencePortal({profile,employee,isAdmin=false,onNavigate}){
 const [records,setRecords]=useState([]);
 const [crawlerRecords,setCrawlerRecords]=useState([]);
 const [crawlerResultsBusy,setCrawlerResultsBusy]=useState(false);
 const [crawlerStatus,setCrawlerStatus]=useState(null);
 const [crawlerSources,setCrawlerSources]=useState([]);
 const [crawlerEngines,setCrawlerEngines]=useState([]);
 const [crawlerProvision,setCrawlerProvision]=useState([]);
 const [crawlerRunning,setCrawlerRunning]=useState(false);
 const [workspaceOpen,setWorkspaceOpen]=useState(false);
 const [selectedOpportunity,setSelectedOpportunity]=useState(null);
 const [opportunityDescription,setOpportunityDescription]=useState("");
 const [donorRequirements,setDonorRequirements]=useState("");
 const [analysisBusy,setAnalysisBusy]=useState(false);
 const [analysisResult,setAnalysisResult]=useState(null);
 const [conceptDraft,setConceptDraft]=useState("");
 const [draftId,setDraftId]=useState("");
 const [savedDrafts,setSavedDrafts]=useState([]);
 const [draftAuditEvents,setDraftAuditEvents]=useState([]);
 const [auditBusy,setAuditBusy]=useState(false);
 const [draftsBusy,setDraftsBusy]=useState(false);
 const [draftSaving,setDraftSaving]=useState(false);
 const [workspaceNotice,setWorkspaceNotice]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [queryText,setQueryText]=useState("");
 const [smartKeywords,setSmartKeywords]=useState("");
 const [assistantFormat,setAssistantFormat]=useState("Partnership request message");
 const [assistantTone,setAssistantTone]=useState("Professional and persuasive");
 const [assistantLength,setAssistantLength]=useState("Concise");
 const [assistantInstructions,setAssistantInstructions]=useState("");
 const [assistantContext,setAssistantContext]=useState("");
 const [assistantDraft,setAssistantDraft]=useState("");
 const [assistantBusy,setAssistantBusy]=useState(false);
 const [assistantError,setAssistantError]=useState("");
 const [assistantNotice,setAssistantNotice]=useState("");
 const [pillar,setPillar]=useState("all");
 const [theme,setTheme]=useState("all");
 const [status,setStatus]=useState("all");
 const [showForm,setShowForm]=useState(false);
 const [saving,setSaving]=useState(false);
 const [draft,setDraft]=useState({title:"",funder:"",url:"",deadline:"",country:"Tanzania",amount:"",summary:"",status:"Open",pillars:["rangeland"],themes:[]});
 const uid=auth.currentUser?.uid||"";
 const roleList=[profile?.role,profile?.roles,employee?.role,employee?.roles].flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim().toLowerCase());
 const canManage=isAdmin||roleList.some(r=>["administrator","executive director","director outreach","director finance & administration","director research","research director","research manager","fundraising officer","research officer"].includes(r));
 async function generateAssistantDraft(){
   const request=text(assistantInstructions);
   if(!request){setAssistantError("Describe what you want the AI Assistant to prepare.");return;}
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const token=await auth.currentUser?.getIdToken();
   if(!token){setAssistantError("Your session has expired. Sign in again.");return;}
   setAssistantBusy(true);setAssistantError("");setAssistantNotice("Preparing your requested format…");
   try{
     const response=await fetch(workerUrl+"/assistant/analyze",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({task:"draft_message",format:assistantFormat,tone:assistantTone,length:assistantLength,instructions:request,context:text(assistantContext),organization:"Improvement of Rangeland in Pastoral Areas (IRPA)",strategicContext:"Tanzania-based NGO focused on sustainable rangeland management, livestock development and market development; early-stage organization with limited resources. Do not claim prior project implementation or secured funding unless supplied by the user."}),signal:AbortSignal.timeout(90000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"The AI Assistant request failed ("+response.status+").");
     const generated=text(data.draft||data.message||data.assessment?.draft||data.assessment?.concept_note?.draft);
     if(!generated)throw new Error("The AI service returned no draft. Please retry.");
     setAssistantDraft(generated);setAssistantNotice("Draft generated. Review and edit it before use.");
   }catch(err){setAssistantError(err?.name==="TimeoutError"?"The AI Assistant took longer than 90 seconds. Please retry.":err?.message||"The AI Assistant could not generate a draft.");setAssistantNotice("");}
   finally{setAssistantBusy(false);}
 }
 function downloadAssistantDraft(){
   if(!text(assistantDraft)){setAssistantError("Generate or enter a draft first.");return;}
   const blob=new Blob([assistantDraft],{type:"text/plain;charset=utf-8"});
   const href=URL.createObjectURL(blob);const a=document.createElement("a");a.href=href;a.download="irpa-ai-assistant-draft.txt";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);
 }

 async function loadCrawlerResults(showNotice=false){
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const token=await auth.currentUser?.getIdToken();
   if(!token){if(showNotice)setError("Your session has expired. Sign in again to load crawler results.");return;}
   setCrawlerResultsBusy(true);
   try{
     const response=await fetch(workerUrl+"/opportunities",{headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(15000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Crawler results request failed ("+response.status+").");
     const items=Array.isArray(data.items)?data.items:[];
     setCrawlerEngines(Array.isArray(data.engineRuns)?data.engineRuns:[]);
     setCrawlerProvision(Array.isArray(data.engineProvision)?data.engineProvision:[]);
     const uniqueSources=[...new Set(items.map(item=>item.source_url).filter(Boolean))];
     setCrawlerSources(uniqueSources.map(sourceUrl=>({id:sourceUrl,name:(()=>{try{return new URL(sourceUrl).hostname}catch{return sourceUrl}})(),url:sourceUrl,status:"Fetched",candidateCount:items.filter(item=>item.source_url===sourceUrl).length})));
     setCrawlerRecords(items.map(item=>({
       id:"crawler-"+item.id,title:item.title||"Untitled opportunity",
       funder:(()=>{try{return new URL(item.source_url||item.url).hostname.replace(/^www\./,"")}catch{return "Official source"}})(),
       url:item.url||item.source_url||"",source_url:item.source_url||"",deadline:item.deadline_at||null,
       country:item.geography_assessment==="tanzania_mentioned"?"Tanzania":item.geography_assessment==="regional_or_lmic_scope"?"Regional / LMIC":"Not verified",
       amount:"Not stated",summary:item.description||"No description supplied in source feed.",
       status:["closed","expired"].includes(String(item.call_status||"").toLowerCase())?"Closed":item.call_status==="open"?"Open":"Under review",
       callStatus:item.call_status||"unknown",
       pillars:["livestock/agriculture"].includes(JSON.parse(item.fit_reasons||"[]")[0])?["livestock"]:["rangeland"],
       themes:[],verificationStatus:"Pending official-call verification",sourceType:"Cloudflare crawler",
       fitScore:Number(item.fit_score||0),fitReasons:item.fit_reasons||"[]",
       eligibilityStatus:item.eligibility_status||"unverified",triageAssessment:item.triage_assessment||"manual_eligibility_review",
       createdAt:item.first_seen_at||null
     })));
     if(data.lastRun)setCrawlerStatus({status:data.lastRun.status,created:data.lastRun.items_changed,candidatesFound:data.lastRun.items_seen,lastCompletedAt:data.lastRun.finished_at,lastStartedAt:data.lastRun.finished_at,configuredSources:data.feedsConfigured,healthySources:uniqueSources.length});
     if(showNotice)setNotice("Refreshed "+String(data.count||0)+" grant records from the Cloudflare crawler. Eligibility remains unverified.");
   }catch(err){console.error("Crawler result retrieval failed",err);if(showNotice)setError(err?.message||"Unable to load crawler results.");}
   finally{setCrawlerResultsBusy(false);}
 }
 useEffect(()=>{loadCrawlerResults(false)},[]);
 useEffect(()=>onSnapshot(collection(db,"grantOpportunities"),snap=>{
   const next=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMillis(b.createdAt)-dateMillis(a.createdAt));
   setRecords(next);setLoading(false);setError("");
 },err=>{console.error("Grant opportunity subscription failed",err);setError("Grant records could not be loaded. Check your signed-in profile's Firestore access.");setLoading(false)}),[]);
 useEffect(()=>onSnapshot(doc(db,"grantCrawlerStatus","current"),snap=>{if(snap.exists())setCrawlerStatus(snap.data())},err=>console.warn("Legacy Firestore crawler status unavailable",err)),[]);
 useEffect(()=>onSnapshot(collection(db,"grantCrawlerSources"),snap=>setCrawlerSources(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")))),err=>console.warn("Grant crawler source health unavailable",err)),[]);
 const combinedRecords=useMemo(()=>{const seen=new Set(records.map(r=>String(r.url||"").trim()).filter(Boolean));return [...records,...crawlerRecords.filter(r=>r.url&&!seen.has(String(r.url).trim()))]},[records,crawlerRecords]);
 const currentOpportunityRecords=useMemo(()=>combinedRecords.filter(r=>!isNotCurrentOpportunity(r)),[combinedRecords]);
 const expiredExclusionCount=combinedRecords.length-currentOpportunityRecords.length;
 const crawlerDiscoveryActive=crawlerRecords.length>0;
 const filtered=useMemo(()=>currentOpportunityRecords.filter(r=>{
   const hay=[r.title,r.funder,r.summary,r.country,r.amount].join(" ").toLowerCase();
   return (!queryText||hay.includes(queryText.toLowerCase()))&&(pillar==="all"||cleanArray(r.pillars).includes(pillar))&&(theme==="all"||cleanArray(r.themes).includes(theme))&&(status==="all"||r.status===status);
 }),[currentOpportunityRecords,queryText,pillar,theme,status]);
 const counts=useMemo(()=>({open:currentOpportunityRecords.filter(r=>r.status==="Open").length,review:currentOpportunityRecords.filter(r=>["Under review","Application in progress"].includes(r.status)).length,submitted:currentOpportunityRecords.filter(r=>["Submitted","Awarded"].includes(r.status)).length}),[currentOpportunityRecords]);
 const smartKeywordSuggestions=["rangeland restoration","pastoral livelihoods","livestock health","climate resilience","women and youth","digital governance","market access","biodiversity conservation","water security","community grants"];
 const smartAssistantResults=useMemo(()=>{
   // Comma/semicolon/newline separates keyword phrases; a space-only query is treated as individual keywords.
   const raw=smartKeywords.toLowerCase().split(/[,;\n]+/).map(term=>term.trim()).filter(Boolean);
   const terms=(raw.length?raw:smartKeywords.toLowerCase().split(/\s+/)).filter(term=>term.length>1).slice(0,20);
   if(!terms.length)return [];
   const aliases={
     pastoralism:["pastoralist","pastoral","rangeland","nomadic"],
     pastoral:["pastoralism","pastoralist","rangeland"],
     livestock:["animal health","veterinary","herd","cattle","goat","sheep"],
     climate:["drought","adaptation","resilience","climate change"],
     women:["gender","female","women-led","girls"],
     youth:["young people","youth-led","young entrepreneurs"],
     digital:["technology","software","cybersecurity","cloud","AI","artificial intelligence"],
     governance:["board management","institutional capacity","nonprofit governance"],
     restoration:["rehabilitation","land recovery","ecosystem recovery","reforestation"],
     biodiversity:["conservation","ecosystem","wildlife","habitat"],
     water:["borehole","water access","water security","irrigation"],
     market:["value chain","market access","value addition","trade"],
     grants:["funding","grant","call for proposals","open call"]
   };
   const openCalls=currentOpportunityRecords.filter(r=>{
     const callStatus=text(r.callStatus||r.call_status).toLowerCase();
     const pipelineStatus=text(r.status).toLowerCase();
     return callStatus==="open"||pipelineStatus==="open"||/\b(?:rolling basis|rolling applications?|year[- ]round|no fixed deadline)\b/i.test([r.title,r.summary,r.description].filter(Boolean).join(" "));
   });
   return openCalls.map(r=>{
       const title=text(r.title).toLowerCase();
       const funder=text(r.funder).toLowerCase();
       const summary=text(r.summary||r.description).toLowerCase();
       const requirements=text(r.donorRequirements||r.applicationRequirements||r.donor_requirements).toLowerCase();
       const fitReasons=text(r.fitReasons||r.fit_reasons).toLowerCase();
       const full=[title,funder,summary,requirements,fitReasons,text(r.country).toLowerCase(),text(r.amount).toLowerCase(),text(r.url).toLowerCase()].join(" ");
       const matched=[];
       let score=0;
       for(const term of terms){
         const candidates=[term,...(aliases[term]||[])];
         const hit=candidates.some(candidate=>full.includes(candidate));
         if(!hit)continue;
         matched.push(term);
         score+=candidates.some(candidate=>title.includes(candidate))?5:candidates.some(candidate=>summary.includes(candidate)||requirements.includes(candidate))?3:candidates.some(candidate=>funder.includes(candidate))?2:1;
       }
       return {...r,_smartScore:score,_matchedKeywords:matched};
     })
     .filter(r=>r._smartScore>0)
     .sort((a,b)=>b._smartScore-a._smartScore||dateMillis(a.deadline||a.deadline_at)-dateMillis(b.deadline||b.deadline_at))
     .slice(0,8);
 },[currentOpportunityRecords,smartKeywords]);
 async function startCrawlerScan(){
   if(!auth.currentUser){setError("Sign in to IRPA to start a grant scan.");return;}
   try{
     setCrawlerRunning(true);setError("");setNotice("Manual donor-source scan requested. This can take several minutes.");
     const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/, "");
     const idToken=await auth.currentUser?.getIdToken();
     if(!idToken) throw new Error("Your session has expired. Sign in again.");
     const response=await fetch(workerUrl+"/run",{method:"POST",headers:{"Authorization":"Bearer "+idToken,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(90000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok) throw new Error(data.error||"Cloudflare grant crawler request failed ("+response.status+").");
     setNotice("Grant crawler scan "+String(data.status||"finished")+". Feeds configured: "+String(data.feedsConfigured||0)+", source entries found: "+String(data.itemsSeen||0)+", records changed: "+String(data.recordsChanged||0)+". Legal eligibility remains unverified.");
     await loadCrawlerResults(false);
   }catch(err){console.error("Manual grant crawler scan failed",err);setError(err?.name==="TimeoutError"?"The scan exceeded 90 seconds. Refresh results and inspect crawler health before retrying.":err?.message||"Manual scan failed. Check crawler authorization and Worker health.");}
   finally{setCrawlerRunning(false);}
 }
 async function loadSavedDrafts(){
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const idToken=await auth.currentUser?.getIdToken();
   if(!idToken)return;
   setDraftsBusy(true);
   try{
     const response=await fetch(workerUrl+"/application/drafts",{headers:{Authorization:"Bearer "+idToken,Accept:"application/json"},signal:AbortSignal.timeout(15000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Saved concept notes could not be loaded.");
     setSavedDrafts(Array.isArray(data.drafts)?data.drafts:[]);
   }catch(err){setError(err?.message||"Saved concept notes could not be loaded.");}
   finally{setDraftsBusy(false);}
 }
 function openConceptWorkspace(record=null){
   setSelectedOpportunity(record);
   setOpportunityDescription(text(record?.summary||record?.description||""));
   setDonorRequirements(text(record?.applicationRequirements||record?.donorRequirements||""));
   setAnalysisResult(null);
   setConceptDraft("");
   setDraftId("");
   setWorkspaceNotice("");
   setWorkspaceOpen(true);
 }
 async function loadDraftAuditEvents(id){
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const idToken=await auth.currentUser?.getIdToken();
   if(!idToken||!id)return;
   setAuditBusy(true);
   try{
     const response=await fetch(workerUrl+"/application/drafts/"+encodeURIComponent(id)+"/events",{headers:{Authorization:"Bearer "+idToken,Accept:"application/json"},signal:AbortSignal.timeout(15000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Draft audit trail could not be loaded.");
     setDraftAuditEvents(Array.isArray(data.events)?data.events:[]);
   }catch(err){setError(err?.message||"Draft audit trail could not be loaded.");}
   finally{setAuditBusy(false);}
 }
 function downloadConceptDraft(){
   const draft=text(conceptDraft||analysisResult?.concept_note?.draft);
   if(!draft){setError("Generate or enter a concept note before downloading.");return;}
   const blob=new Blob([draft],{type:"text/plain;charset=utf-8"});
   const href=URL.createObjectURL(blob);
   const link=document.createElement("a");
   link.href=href;
   link.download="IRPA-Concept-Note-"+String(selectedOpportunity?.title||"Draft").replace(/[^A-Za-z0-9-]+/g,"-").slice(0,80)+".txt";
   document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(href);
   setWorkspaceNotice("Concept-note text downloaded. Upload the reviewed document through the existing DBGS Documents portal when ready.");
 }
 function openSavedConceptDraft(draft){
   setDraftAuditEvents([]);
   setSelectedOpportunity({
     id:draft.id,
     title:draft.opportunity?.title||draft.name||"Saved concept note",
     url:draft.opportunity?.url||"",
     summary:draft.opportunity?.description||"",
     funder:"Saved concept-note draft",
     applicationRequirements:draft.opportunity?.donorRequirements||"",
     status:"Under review",
     deadline:draft.opportunity?.deadline||null,
     callStatus:draft.opportunity?.callStatus||""
   });
   setOpportunityDescription(text(draft.opportunity?.description||""));
   setDonorRequirements(text(draft.opportunity?.donorRequirements||""));
   setAnalysisResult(draft.assessment||null);
   setConceptDraft(text(draft.applicationFields?.conceptNoteDraft||""));
   setDraftId(draft.id);
   setWorkspaceNotice("Loaded saved draft. Review eligibility and official call criteria before reuse.");
   setWorkspaceOpen(true);
   loadDraftAuditEvents(draft.id);
 }
 async function runWorkspaceAnalysis(task="eligibility"){
   if(!selectedOpportunity?.title){setError("Select a grant opportunity before screening eligibility.");return;}
   const currentStatusIssue=getOpportunityCurrentStatusIssue({...selectedOpportunity,summary:[selectedOpportunity.summary,opportunityDescription].filter(Boolean).join(" "),applicationRequirements:donorRequirements});
   if(currentStatusIssue){
     const stale=currentStatusIssue!=="unverified";
     setAnalysisResult({geographic_eligibility:{status:"unclear",reason:stale?"The application deadline has passed or the call is explicitly closed/expired.":"The official deadline or current open/rolling status is not established by the supplied opportunity record.",evidence:["Deterministic deadline/status gate applied before AI analysis."]},eligibility:{status:stale?"ineligible":"insufficient_information",confidence:"high",evidence:[stale?"Expired or closed call":"Current deadline/status not verified"],unknowns:[stale?"Select a current call with a future deadline or verify that the donor has formally reopened it.":"Paste the official deadline or verify the donor's current open/rolling-intake status."]}});
     setConceptDraft("");
     setError(stale?"This call is expired or closed. AI analysis and concept-note drafting are blocked.":"The call's deadline/current status is unverified. Add the official deadline or confirm rolling/open status before AI analysis.");
     setWorkspaceNotice("Deadline/current-status gate blocked this call before AI analysis.");
     return;
   }
   // Geographic eligibility no longer blocks opportunity analysis; show and assess all calls.
   if(!text(opportunityDescription)&&!text(donorRequirements)){setError("Provide the opportunity description or paste the official donor eligibility and application criteria.");return;}
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const idToken=await auth.currentUser?.getIdToken();
   if(!idToken){setError("Your session has expired. Sign in again.");return;}
   setAnalysisBusy(true);setError("");setWorkspaceNotice(task==="concept_note"?"Checking eligibility and preparing the concept-note draft…":"Checking geographic, organizational and donor eligibility criteria…");
   try{
     const response=await fetch(workerUrl+"/assistant/analyze",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({task,title:selectedOpportunity.title,description:text(opportunityDescription),donorRequirements:text(donorRequirements),url:text(selectedOpportunity.url),deadline:dateKeyInTanzania(selectedOpportunity.deadline||selectedOpportunity.deadline_at)||"",callStatus:text(selectedOpportunity.callStatus||selectedOpportunity.call_status||"")}),signal:AbortSignal.timeout(90000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok){
       if(data.geographic_eligibility||data.eligibility_gate)setAnalysisResult({geographic_eligibility:data.geographic_eligibility||null,eligibility_gate:data.eligibility_gate||null,eligibility:{status:data.eligibility_gate?.status==="ineligible"||data.geographic_eligibility?.status==="ineligible"?"ineligible":"insufficient_information",confidence:"high",evidence:data.geographic_eligibility?.evidence||[],unknowns:[data.geographic_eligibility?.reason||data.next_step||"Verify official eligibility criteria.",...(data.eligibility_gate?.warnings||[])]}});
       throw new Error(data.error||"The AI eligibility analysis failed ("+response.status+").");
     }
     setAnalysisResult(data.assessment?{...data.assessment,eligibility_gate:data.assessment.known_eligibility_gaps||null}:null);
     if(task==="concept_note"){
       const generated=text(data.assessment?.concept_note?.draft);
       setConceptDraft(generated);
       setDraftId(id=>id||crypto.randomUUID());
       setWorkspaceNotice(generated?"Eligibility screening completed and a concept-note draft was generated. Edit it before saving.":"Eligibility screening completed, but the model did not return a concept-note draft. Review the assessment and retry.");
     }else{
       setWorkspaceNotice("Eligibility screening completed. Geographic status: "+String(data.assessment?.geographic_eligibility?.status||"unclear")+". Review every requirement before drafting.");
     }
   }catch(err){setError(err?.name==="TimeoutError"?"The AI analysis exceeded 90 seconds. Retry after checking the staging Worker.":err?.message||"The AI eligibility analysis failed.");}
   finally{setAnalysisBusy(false);}
 }
 async function saveConceptDraft(){
   if(!selectedOpportunity?.title||!text(conceptDraft)){setError("Select an opportunity and enter a concept-note draft before saving.");return;}
   const currentStatusIssue=getOpportunityCurrentStatusIssue({...selectedOpportunity,summary:[selectedOpportunity.summary,opportunityDescription].filter(Boolean).join(" "),applicationRequirements:donorRequirements});
   if(currentStatusIssue){
     setError(currentStatusIssue==="unverified"?"The official deadline/current status is unverified. A concept note cannot be saved as an active application until verified.":"This call is expired or closed. A concept note cannot be saved as an active application.");
     return;
   }
   // Geographic eligibility no longer blocks saving a reviewed draft.
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const idToken=await auth.currentUser?.getIdToken();
   if(!idToken){setError("Your session has expired. Sign in again.");return;}
   const id=draftId||crypto.randomUUID();
   setDraftSaving(true);setError("");
   try{
     const response=await fetch(workerUrl+"/application/drafts",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({id,name:text(selectedOpportunity.title)+" — IRPA concept note",opportunity:{title:text(selectedOpportunity.title),url:text(selectedOpportunity.url),description:text(opportunityDescription),donorRequirements:text(donorRequirements),deadline:dateKeyInTanzania(selectedOpportunity.deadline||selectedOpportunity.deadline_at)||"",callStatus:text(selectedOpportunity.callStatus||selectedOpportunity.call_status||"")},applicationFields:{conceptNoteDraft:conceptDraft,strategicAlignment:analysisResult?.strategic_alignment||{},geographicEligibility:analysisResult?.geographic_eligibility||null},assessment:analysisResult||null,finalNotes:"Draft saved in the IRPA-DBGS grant concept-note workspace. Official call eligibility and internal approvals remain to be verified."}),signal:AbortSignal.timeout(20000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Concept-note draft could not be saved.");
     setDraftId(id);
     setWorkspaceNotice("Concept-note draft saved to the isolated Cloudflare D1 workspace; an audit event was recorded.");
     await loadSavedDrafts();
     await loadDraftAuditEvents(id);
   }catch(err){setError(err?.message||"Concept-note draft could not be saved.");}
   finally{setDraftSaving(false);}
 }
 useEffect(()=>{if(workspaceOpen)loadSavedDrafts()},[workspaceOpen]);
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
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
     <h1 style={{...styles.title,margin:"7px 0"}}>Live Grants & Calls for Proposals</h1>
     <span role="status" aria-live="polite" title={crawlerDiscoveryActive?"The crawler has returned one or more funding opportunities.":"The crawler has not returned any funding opportunities."} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"6px 10px",borderRadius:999,border:"1px solid "+(crawlerDiscoveryActive?"#32846d":"#b65c5c"),background:crawlerDiscoveryActive?"#123b32":"#3b2228",color:crawlerDiscoveryActive?"#8de0b7":"#ffb8b8",fontSize:12,fontWeight:800,whiteSpace:"nowrap"}}>
      <span aria-hidden="true" style={{width:7,height:7,borderRadius:"50%",background:crawlerDiscoveryActive?"#54d6a4":"#ff8585",display:"inline-block"}}/>
      {crawlerDiscoveryActive?"Active":"In Active"}
     </span>
    </div>
    <div style={{fontSize:14,lineHeight:1.6,color:"#e1edf2"}}>Discover, classify and manage funding opportunities against IRPA's three strategic pillars and seven cross-cutting themes. All authenticated profiles can access this portal at no additional cost.</div>
   </div>
   <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
    {canManage&&<button style={styles.button} onClick={()=>setShowForm(v=>!v)}>{showForm?"Close form":"+ Add opportunity"}</button>}
    <button style={styles.button} onClick={()=>openConceptWorkspace(null)}>Concept-note workspace</button>
    <button style={{...styles.button,background:"transparent"}} onClick={()=>{setQueryText("");setPillar("all");setTheme("all");setStatus("all")}}>Reset filters</button>
   </div>
  </section>

  <section style={{...styles.card,display:"grid",gap:12,borderColor:"#4e8b91"}} aria-labelledby="grant-writing-assistant-heading">
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}>
    <div><div style={styles.eyebrow}>AI ASSISTANT · FLEXIBLE WRITING STUDIO</div><h2 id="grant-writing-assistant-heading" style={{fontSize:21,margin:"5px 0"}}>AI Writing & Funding Assistant</h2><p style={{...styles.muted,margin:0}}>Request the format you need. The assistant adapts structure, length and tone to your instructions and keeps the result editable. It does not submit messages or applications.</p></div>
    <span style={{...styles.tag,borderColor:"#4e8b91"}}>User-directed formats</span>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
    <label style={{fontSize:12}}>Output format<select aria-label="AI Assistant output format" style={{...styles.input,marginTop:5}} value={assistantFormat} onChange={e=>setAssistantFormat(e.target.value)}>{["Partnership request message","Email","Formal letter","Expression of interest","Concept note","Full project proposal","Executive summary","Briefing note","Donor enquiry","Proposal narrative","Budget narrative","Meeting talking points","Social media post","Report","Other / follow my instructions"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label style={{fontSize:12}}>Tone<select aria-label="AI Assistant tone" style={{...styles.input,marginTop:5}} value={assistantTone} onChange={e=>setAssistantTone(e.target.value)}>{["Professional and persuasive","Formal and diplomatic","Concise and direct","Warm and collaborative","Technical and evidence-led","Compelling and donor-focused","Plain language","Follow my instructions"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label style={{fontSize:12}}>Length<select aria-label="AI Assistant output length" style={{...styles.input,marginTop:5}} value={assistantLength} onChange={e=>setAssistantLength(e.target.value)}>{["Very short","Concise","Standard","Detailed","Comprehensive","Follow my instructions"].map(v=><option key={v}>{v}</option>)}</select></label>
   </div>
   <label style={{fontSize:12}}>What should the assistant prepare? <span style={styles.muted}>Required</span><textarea aria-label="AI Assistant request" rows="4" style={{...styles.input,marginTop:5,resize:"vertical"}} value={assistantInstructions} onChange={e=>setAssistantInstructions(e.target.value)} placeholder="Example: Draft a first-contact message to the Climate Justice Resilience Fund asking about suitable funding pathways for IRPA's community-led climate resilience work in Longido. Do not assume a call is open or claim we have implemented projects." /></label>
   <label style={{fontSize:12}}>Additional context, source text or required points <span style={styles.muted}>(optional)</span><textarea aria-label="AI Assistant additional context" rows="3" style={{...styles.input,marginTop:5,resize:"vertical"}} value={assistantContext} onChange={e=>setAssistantContext(e.target.value)} placeholder="Paste donor guidelines, recipient details, required facts, word limits, language or formatting instructions." /></label>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={assistantBusy} style={{...styles.button,opacity:assistantBusy?0.6:1}} onClick={generateAssistantDraft}>{assistantBusy?"Generating draft…":"Generate requested output"}</button><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>{setAssistantInstructions("");setAssistantContext("");setAssistantDraft("");setAssistantError("");setAssistantNotice("");}}>Clear workspace</button></div>
   {assistantNotice&&<div role="status" style={{...styles.card,borderColor:"#32846d",color:"#8de0b7"}}>{assistantNotice}</div>}
   {assistantError&&<div role="alert" style={{...styles.card,borderColor:"#b65c5c",color:"#ffb8b8"}}>{assistantError}</div>}
   {assistantDraft&&<div style={{display:"grid",gap:8}}><label style={{fontSize:13,fontWeight:800}} htmlFor="grant-ai-draft-output">Editable AI output</label><textarea id="grant-ai-draft-output" aria-label="Editable AI output" rows="14" style={{...styles.input,resize:"vertical",fontFamily:"inherit",lineHeight:1.65}} value={assistantDraft} onChange={e=>setAssistantDraft(e.target.value)}/><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={styles.button} onClick={()=>{if(!navigator.clipboard?.writeText){setAssistantError("Clipboard access is unavailable in this browser.");return;}navigator.clipboard.writeText(assistantDraft).then(()=>setAssistantNotice("Draft copied to clipboard.")).catch(()=>setAssistantError("Clipboard access was blocked by the browser."));}}>Copy draft</button><button type="button" style={{...styles.button,background:"transparent"}} onClick={downloadAssistantDraft}>Download .txt</button></div><p style={{...styles.muted,margin:0}}>Check facts, eligibility, dates, budgets and donor instructions before sending or submitting.</p></div>}
  </section>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
   {[["Discovered opportunities",combinedRecords.length,"All geographic eligibility categories included"],["Open calls",counts.open,"Status: Open"],["In preparation",counts.review,"Review / drafting"],["Submitted or awarded",counts.submitted,"Pipeline progress"],["Expired / closed / unverified calls suppressed",expiredExclusionCount,"Past deadlines, explicit closure, or no verified current deadline/status"]].map(([label,value,sub])=><div key={label} style={styles.card}><div style={styles.muted}>{label}</div><div style={{fontSize:28,fontWeight:800,margin:"7px 0"}}>{value}</div><div style={{fontSize:11,color:"#8ba2b8"}}>{sub}</div></div>)}
  </div>
  <section style={{...styles.card,display:"grid",gap:12}} aria-labelledby="crawler-status-heading">
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}>
    <div><div style={styles.eyebrow}>AUTOMATED SOURCE MONITOR</div><h2 id="crawler-status-heading" style={{fontSize:18,margin:"5px 0"}}>Multi-donor web crawler</h2><p style={{...styles.muted,margin:0}}>Checks public RSS/Atom feeds, public APIs and selected donor opportunity hubs every six hours. New records are unverified leads, not confirmed eligible grants.</p></div>
    {<div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={crawlerResultsBusy} style={{...styles.button,background:"transparent",opacity:crawlerResultsBusy?0.6:1}} onClick={()=>loadCrawlerResults(true)}>{crawlerResultsBusy?"Refreshing results…":"Refresh results"}</button><button type="button" disabled={crawlerRunning||(!isAdmin&&!canManage)} title="Run a full scan of configured donor sources" style={{...styles.button,opacity:crawlerRunning?0.6:1}} onClick={startCrawlerScan}>{crawlerRunning?"Scanning sources…":"Run scan now"}</button></div>}
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10}}>
    {[[ "Crawler state",crawlerStatus?.status||"Awaiting first scan"],[ "Sources with results",String(crawlerStatus?.healthySources??0)+" / "+String(crawlerStatus?.configuredSources??11)],[ "New records last run",String(crawlerStatus?.created??0)],[ "Candidates last run",String(crawlerStatus?.candidatesFound??0)]].map(([label,value])=><div key={label} style={{border:"1px solid #344255",borderRadius:10,padding:11}}><div style={styles.muted}>{label}</div><strong style={{display:"block",fontSize:17,marginTop:5}}>{value}</strong></div>)}
   </div>
   <div style={styles.muted}>Last scan started: {dateLabel(crawlerStatus?.lastStartedAt)} · Last completed: {dateLabel(crawlerStatus?.lastCompletedAt)} · Cadence: every 6 hours (Tanzania time)</div>
   <details><summary style={{cursor:"pointer",fontSize:13,fontWeight:700}}>Source health and crawl results ({crawlerSources.length})</summary><div style={{display:"grid",gap:7,marginTop:10}}>{crawlerSources.map(source=><div key={source.id} style={{borderTop:"1px solid #344255",paddingTop:8,display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}><div><strong style={{fontSize:13}}>{source.name||source.id}</strong><div style={styles.muted}>{source.url}</div>{source.error&&<div style={{fontSize:12,color:"#ffb8b8"}}>{source.error}</div>}</div><div style={{textAlign:"right",minWidth:100,fontSize:12}}><strong>{source.status||"Not checked"}</strong><div style={styles.muted}>{source.candidateCount??0} candidates</div></div></div>)}</div></details>
   <details><summary style={{cursor:"pointer",fontSize:13,fontWeight:800}}>Parallel scanning engine health ({crawlerEngines.length})</summary><div style={{display:"grid",gap:7,marginTop:10}}>{crawlerEngines.map(engine=><div key={engine.engine} style={{borderTop:"1px solid #344255",paddingTop:8,display:"grid",gridTemplateColumns:"minmax(140px,1fr) auto",gap:10,alignItems:"start"}}><div><strong style={{fontSize:13}}>{(crawlerProvision.find(item=>item.engine===engine.engine)||{}).label||engine.engine}</strong><div style={styles.muted}>Last checked: {dateLabel(engine.finished_at)}</div>{engine.error_message&&<div style={{fontSize:12,color:"#ffcf88"}}>{engine.error_message}</div>}</div><div style={{textAlign:"right",fontSize:12}}><strong style={{color:engine.status==="success"?"#8de0b7":engine.status==="partial"?"#ffcf88":"#ffb8b8"}}>{engine.status==="success"?"Completed":engine.status==="partial"?"Partial":"Failed"}</strong><div style={styles.muted}>{engine.configured} configured · {engine.items_seen} found</div></div></div>)}</div></details>
   <details>
    <summary style={{cursor:"pointer",fontSize:14,fontWeight:800}}>Engine provision panel — funding resources ({crawlerProvision.length} engines)</summary>
    <div style={{...styles.muted,marginTop:8}}>Indicative resource registry. Open an engine to inspect its purpose, source endpoints, search queries and latest run status. All engines feed the same deduplicated opportunity register and the same IRPA fit, deadline, geography and eligibility formula.</div>
    <div style={{display:"grid",gap:8,marginTop:10}}>
     {crawlerProvision.map(provision=>{
      const run=crawlerEngines.find(item=>item.engine===provision.engine);
      const status=run?.status||"not_run";
      const statusLabel=status==="success"?"Completed":status==="partial"?"Partial":status==="failed"?"Failed":provision.provisionStatus==="configured"?"Provisioned":Number(provision.configured??(provision.sources||[]).length)>0?"Configured · rotation":"Not configured";
      const statusColor=status==="success"?"#8de0b7":status==="partial"?"#ffcf88":status==="failed"?"#ffb8b8":provision.provisionStatus==="configured"?"#8bd3e6":"#aab6c5";
      return <details key={provision.engine} style={{border:"1px solid #344255",borderRadius:10,padding:"9px 11px",background:"rgba(255,255,255,0.015)"}}>
       <summary style={{cursor:"pointer",display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <strong style={{fontSize:13}}>{provision.label||provision.engine}</strong>
        <span style={{fontSize:11,color:statusColor,fontWeight:800}}>{statusLabel} · {run?(run.items_seen??run.found??0)+" found":provision.engine==="ai_eligibility"?"AI tool":"Awaiting scan"}</span>
       </summary>
       <div style={{display:"grid",gap:8,marginTop:10}}>
        <div style={styles.muted}>{provision.description||"Parallel funding-opportunity discovery engine."}</div>
        <div style={{fontSize:12}}>Configured resources: <strong>{provision.configured??(provision.sources||[]).length}</strong>{run?.finished_at&&<> · Last run: <strong>{dateLabel(run.finished_at)}</strong></>}</div>
        {run?.error_message&&<div style={{fontSize:12,color:"#ffcf88"}}>Source report: {run.error_message}</div>}
        {!!(provision.sources||[]).length&&<div><strong style={{fontSize:12}}>Resource links / source endpoints</strong><div style={{display:"grid",gap:5,marginTop:5}}>{provision.sources.map((source,index)=>{
          const url=typeof source==="string"?source:source.url;
          const label=typeof source==="string"?source:(source.label||source.name||source.url);
          return <div key={url||label||index} style={{fontSize:12,overflowWrap:"anywhere"}}>{url&&/^https:\/\//i.test(url)?<a href={url} target="_blank" rel="noreferrer" style={{color:"#8bd3e6",textDecoration:"underline"}}>{label}</a>:<span>{label}</span>}</div>;
        })}</div></div>}
        {!!(provision.queries||[]).length&&<div><strong style={{fontSize:12}}>Parallel search queries</strong><ul style={{margin:"5px 0 0",paddingLeft:20}}>{provision.queries.map(query=><li key={query} style={{fontSize:12,marginBottom:3}}>{query}</li>)}</ul></div>}
       </div>
      </details>;
     })}
    </div>
   </details>
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
  {workspaceOpen&&<section style={{...styles.card,display:"grid",gap:13,borderColor:"#4e8b91"}} aria-labelledby="concept-workspace-heading">
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}>
    <div><div style={styles.eyebrow}>IRPA-DBGS · APPLICATION PREPARATION</div><h2 id="concept-workspace-heading" style={{fontSize:21,margin:"5px 0"}}>AI eligibility & concept-note workspace</h2><p style={{...styles.muted,margin:0}}>Screen geography and donor requirements first. Drafting is blocked unless Tanzania or eligible regional/global coverage is established by the supplied call text.</p></div>
    <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>setWorkspaceOpen(false)}>Close workspace</button>
   </div>
   <label style={{fontSize:12}}>Funding opportunity
    <select style={{...styles.input,marginTop:5}} value={selectedOpportunity?.id||""} onChange={e=>{const next=combinedRecords.find(r=>r.id===e.target.value);setSelectedOpportunity(next||null);setOpportunityDescription(text(next?.summary||""));setDonorRequirements(text(next?.applicationRequirements||""));setAnalysisResult(null);setConceptDraft("");setDraftId("");setWorkspaceNotice("");}}>
     <option value="">Select an opportunity from the register…</option>
     {selectedOpportunity?.id&&!combinedRecords.some(r=>r.id===selectedOpportunity.id)&&<option value={selectedOpportunity.id}>{selectedOpportunity.title} (saved draft)</option>}
     {currentOpportunityRecords.map(r=><option key={r.id} value={r.id}>{r.title} — {r.country||"Geography unverified"}</option>)}
    </select>
   </label>
   {selectedOpportunity&&<div style={{...styles.card,display:"grid",gap:5}}>
    <strong>{selectedOpportunity.title}</strong>
    <div style={styles.muted}>Funder: {selectedOpportunity.funder||"Not verified"} · Geography on record: {selectedOpportunity.country||"Not verified"}</div>
    {selectedOpportunity.url&&<a href={selectedOpportunity.url} target="_blank" rel="noreferrer" style={{color:"#8ecad1",fontSize:13}}>Open official announcement ↗</a>}
   </div>}
   <label style={{fontSize:12}}>Opportunity description / call summary
    <textarea rows="4" style={{...styles.input,marginTop:5,resize:"vertical"}} value={opportunityDescription} onChange={e=>setOpportunityDescription(e.target.value)} placeholder="Paste the official call summary, geographic scope, purpose, eligible activities and funding conditions."/>
   </label>
   <label style={{fontSize:12}}>Official eligibility criteria and application requirements (required for reliable screening)
    <textarea rows="5" style={{...styles.input,marginTop:5,resize:"vertical"}} value={donorRequirements} onChange={e=>setDonorRequirements(e.target.value)} placeholder="Paste eligible countries, applicant legal status, organization age, track-record, audit/turnover, co-financing, consortium, deadline and eligible-cost rules from the official call."/>
   </label>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
    <button type="button" disabled={analysisBusy||!selectedOpportunity} style={{...styles.button,opacity:analysisBusy||!selectedOpportunity?0.6:1}} onClick={()=>runWorkspaceAnalysis("eligibility")}>{analysisBusy?"Analyzing…":"1. Screen eligibility"}</button>
    <button type="button" disabled={analysisBusy||!selectedOpportunity} style={{...styles.button,background:"#285d45",opacity:analysisBusy||!selectedOpportunity?0.55:1}} onClick={()=>runWorkspaceAnalysis("concept_note")}>2. Generate concept note</button>
    <button type="button" disabled={draftsBusy} style={{...styles.button,background:"transparent",opacity:draftsBusy?0.6:1}} onClick={loadSavedDrafts}>{draftsBusy?"Loading drafts…":"Refresh saved drafts"}</button>
   </div>
   {workspaceNotice&&<div role="status" style={{...styles.card,borderColor:"#32846d",color:"#8de0b7"}}>{workspaceNotice}</div>}
   {analysisResult&&<section style={{...styles.card,display:"grid",gap:10}}>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><h3 style={{fontSize:17,margin:0}}>Eligibility assessment</h3><span style={{...styles.tag,borderColor:analysisResult.geographic_eligibility?.status==="eligible"?"#32846d":analysisResult.geographic_eligibility?.status==="ineligible"?"#b65c5c":"#b78b3d"}}>Geography: {analysisResult.geographic_eligibility?.status||"not assessed"}</span>{analysisResult.eligibility?.status&&<span style={styles.tag}>Overall: {analysisResult.eligibility.status.replaceAll("_"," ")}</span>}</div>
    {analysisResult.geographic_eligibility?.reason&&<p style={{...styles.muted,margin:0}}>{analysisResult.geographic_eligibility.reason}</p>}
    {analysisResult.geographic_eligibility?.evidence?.length>0&&<ul style={{...styles.muted,margin:"0 0 0 18px"}}>{analysisResult.geographic_eligibility.evidence.map((item,i)=><li key={i}>{item}</li>)}</ul>}
    {analysisResult.eligibility?.evidence?.length>0&&<div><strong style={{fontSize:13}}>Evidence</strong><ul style={{...styles.muted,margin:"5px 0 0 18px"}}>{analysisResult.eligibility.evidence.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    {analysisResult.eligibility?.unknowns?.length>0&&<div><strong style={{fontSize:13}}>Unresolved eligibility questions</strong><ul style={{...styles.muted,margin:"5px 0 0 18px"}}>{analysisResult.eligibility.unknowns.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    {analysisResult.donor_requirements?.length>0&&<div><strong style={{fontSize:13}}>Donor requirement matrix</strong><div style={{display:"grid",gap:7,marginTop:7}}>{analysisResult.donor_requirements.map((item,i)=><div key={i} style={{borderTop:"1px solid #344255",paddingTop:7}}><div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}><strong style={{fontSize:12}}>{item.requirement}</strong><span style={styles.tag}>{String(item.status||"unknown").replaceAll("_"," ")}</span></div><p style={{...styles.muted,margin:"4px 0"}}>{item.evidence||"Evidence not supplied."}</p>{item.action&&<p style={{...styles.muted,margin:0}}>Next action: {item.action}</p>}</div>)}</div></div>}
    {analysisResult.strategic_alignment&&<div><strong style={{fontSize:13}}>IRPA Strategic Plan alignment</strong><p style={{...styles.muted,margin:"5px 0"}}>{analysisResult.strategic_alignment.rationale}</p><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{(analysisResult.strategic_alignment.relevant_pillars||[]).map((item,i)=><span key={i} style={styles.tag}>{item}</span>)}{(analysisResult.strategic_alignment.relevant_cross_cutting_themes||[]).map((item,i)=><span key={"t"+i} style={{...styles.tag,borderColor:"#6c5b8f"}}>{item}</span>)}</div></div>}
    {analysisResult.application_checklist?.length>0&&<div><strong style={{fontSize:13}}>Application checklist</strong><ul style={{...styles.muted,margin:"5px 0 0 18px"}}>{analysisResult.application_checklist.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
    {analysisResult.risks_and_gaps?.length>0&&<div><strong style={{fontSize:13}}>Risks and evidence gaps</strong><ul style={{...styles.muted,margin:"5px 0 0 18px"}}>{analysisResult.risks_and_gaps.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
   </section>}
   {(conceptDraft||analysisResult?.concept_note?.draft)&&<section style={{...styles.card,display:"grid",gap:8}}>
    <h3 style={{fontSize:17,margin:0}}>Editable concept-note draft</h3>
    <p style={{...styles.muted,margin:0}}>This is a working draft, not an approved IRPA submission. Verify figures, evidence, eligibility, budgets and donor instructions before circulation.</p>
    <textarea aria-label="Editable concept-note draft" rows="16" style={{...styles.input,resize:"vertical",fontFamily:"inherit",lineHeight:1.6}} value={conceptDraft||analysisResult?.concept_note?.draft||""} onChange={e=>setConceptDraft(e.target.value)}/>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button type="button" disabled={draftSaving||!text(conceptDraft||analysisResult?.concept_note?.draft)} style={{...styles.button,opacity:draftSaving?0.6:1}} onClick={saveConceptDraft}>{draftSaving?"Saving draft…":"Save draft to Cloudflare workspace"}</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={downloadConceptDraft}>Download .txt for DBGS Documents</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>{if(!navigator.clipboard?.writeText){setError("Clipboard access is unavailable in this browser.");return;}navigator.clipboard.writeText(conceptDraft||analysisResult?.concept_note?.draft||"").then(()=>setWorkspaceNotice("Concept-note text copied to clipboard.")).catch(()=>setError("Clipboard access was blocked by the browser."));}}>Copy concept-note text</button>
    </div>
   </section>}
   <section style={{display:"grid",gap:8}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}><h3 style={{fontSize:16,margin:0}}>My saved concept-note drafts</h3><span style={styles.muted}>{savedDrafts.length} saved</span></div>
    {draftsBusy&&<div style={styles.muted}>Loading drafts from the Cloudflare workspace…</div>}
    {!draftsBusy&&!savedDrafts.length&&<div style={styles.muted}>No saved drafts yet. Screen a grant, generate a concept note and save the draft here.</div>}
    {savedDrafts.map(draft=><div key={draft.id} style={{border:"1px solid #344255",borderRadius:10,padding:11,display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}><div><strong style={{fontSize:13}}>{draft.name||draft.opportunity?.title||"Untitled concept note"}</strong><div style={styles.muted}>Status: {draft.status||"draft"} · Updated: {dateLabel(draft.updated_at||draft.updatedAt||draft.created_at)}</div></div><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>openSavedConceptDraft(draft)}>Open draft</button></div>)}
   </section>
   <section style={{...styles.card,display:"grid",gap:9}}>
    <div><strong style={{fontSize:14}}>Draft audit trail</strong><p style={{...styles.muted,margin:"4px 0"}}>Append-only Cloudflare D1 events record when this draft was created or updated, without copying the full concept-note text into the event log.</p></div>
    {auditBusy&&<div style={styles.muted}>Loading draft audit events…</div>}
    {!auditBusy&&draftId&&!draftAuditEvents.length&&<div style={styles.muted}>No audit events loaded yet. Save the draft or reopen it to retrieve the event history.</div>}
    {!draftId&&<div style={styles.muted}>Save the draft to create its first audit event.</div>}
    {draftAuditEvents.map((event,i)=><div key={event.createdAt+"-"+i} style={{borderTop:"1px solid #344255",paddingTop:7}}><strong style={{fontSize:12}}>{String(event.eventType||"draft_event").replaceAll("_"," ")}</strong><div style={styles.muted}>{dateLabel(event.createdAt)} · Eligibility: {event.eligibilityStatus||"not assessed"} · Geography: {event.geographicEligibility||"not assessed"}</div></div>)}
   </section>
   <section style={{...styles.card,display:"grid",gap:9}}>
    <strong style={{fontSize:14}}>Related DBGS governance modules</strong>
    <p style={{...styles.muted,margin:0}}>Use the existing modules to file supporting documents, prepare budget details and route the draft for formal internal review. These navigation links do not automatically submit or approve the concept note.</p>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>onNavigate?.("Documents")}>Open Documents</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>onNavigate?.("Finance Portfolio")}>Open Finance Portfolio</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>onNavigate?.("Authorization & Approvals")}>Open Authorization & Approvals</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>onNavigate?.("Meetings")}>Open Meetings</button>
    </div>
   </section>
   <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Governance control:</strong> saved drafts remain drafts in the isolated Cloudflare D1 workspace. Saving does not submit an application, approve expenditure, authorize a commitment, or replace IRPA's formal internal review and approval procedures.</div>
  </section>}

  <section style={{...styles.card,display:"grid",gap:12,borderColor:"#4e8b91"}} aria-labelledby="grant-smart-assistant-heading">
   <div>
    <div style={styles.eyebrow}>AI SMART ASSISTANT · KEYWORD ROUTING</div>
    <h2 id="grant-smart-assistant-heading" style={{margin:"5px 0",fontSize:19}}>Find open calls quickly</h2>
    <p style={{...styles.muted,margin:0}}>Enter keywords or select a topic. Results are ranked against currently listed open calls; use the original official-call link to confirm details. Keyword search works without waiting for generative-AI analysis.</p>
   </div>
   <form onSubmit={e=>e.preventDefault()} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:9}}>
    <input aria-label="Smart Assistant keywords" style={styles.input} value={smartKeywords} onChange={e=>setSmartKeywords(e.target.value)} placeholder="Keywords: pastoralism, climate, livestock, women, digital governance…"/>
    <button type="button" style={styles.button} onClick={()=>setSmartKeywords(smartKeywords.trim())}>Find open calls</button>
   </form>
   <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{smartKeywordSuggestions.map(keyword=><button key={keyword} type="button" style={{...styles.button,background:"transparent",fontSize:12,padding:"7px 10px"}} onClick={()=>setSmartKeywords(keyword)}>{keyword}</button>)}</div>
   {smartKeywords.trim()&&<div aria-live="polite" style={{display:"grid",gap:9}}>
    <div style={styles.muted}>{smartAssistantResults.length} ranked open call{smartAssistantResults.length===1?"":"s"} match these keywords.</div>
    {!smartAssistantResults.length&&<div style={{...styles.card,borderStyle:"dashed"}}><strong>No matching open calls found</strong><p style={{...styles.muted,margin:"5px 0 0"}}>Try a broader keyword such as climate, community, livestock, restoration or grants, or refresh crawler results.</p></div>}
    {smartAssistantResults.map(r=><article key={r.id} style={{...styles.card,display:"grid",gap:7}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"start"}}>
      <div style={{flex:"1 1 300px"}}><div style={styles.eyebrow}>{r.funder||"Funder not verified"} · Open call</div><strong style={{display:"block",fontSize:15,marginTop:4}}>{r.title}</strong><p style={{...styles.muted,margin:"5px 0"}}>{text(r.summary||r.description).slice(0,320)||"No description supplied."}</p></div>
      <div style={{fontSize:12,minWidth:105}}><div style={styles.muted}>Deadline</div><strong>{dateLabel(r.deadline||r.deadline_at)}</strong><div style={{...styles.muted,marginTop:5}}>Keyword score: {r._smartScore}</div></div>
     </div>
     <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{r._matchedKeywords.map(term=><span key={term} style={styles.tag}>{term}</span>)}</div>
     <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>openConceptWorkspace(r)}>Screen call with AI Assistant</button>
      {r.url&&<a href={r.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>Open original call ↗</a>}
     </div>
    </article>)}
   </div>}
  </section>
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
   {loading&&crawlerResultsBusy?<div style={styles.card} role="status">Loading live opportunity records and Cloudflare crawler results…</div>:filtered.length===0?<div style={styles.card}><strong>No matching opportunities yet</strong><p style={styles.muted}>No records currently match these filters. The dashboard checks both manually registered opportunities and Cloudflare crawler results. Refresh results or run a scan if authorized, then verify each call against the donor’s official guidance.</p></div>:filtered.map(r=><article key={r.id} style={styles.card}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
     <div style={{flex:"1 1 380px"}}><div style={styles.eyebrow}>{r.funder||"Funder not specified"} · {r.verificationStatus||"Verification status unavailable"}{r.fitScore!==undefined?" · IRPA topic fit "+r.fitScore+"/100":""}</div><h3 style={{fontSize:18,margin:"7px 0"}}>{r.title}</h3><p style={{...styles.muted,margin:"0 0 10px"}}>{r.summary||"No summary provided."}</p></div>
     <div style={{minWidth:150}}><div style={{fontSize:12,color:"#9fb0c3"}}>Deadline</div><strong>{dateLabel(r.deadline)}</strong><div style={{fontSize:12,marginTop:8,color:"#9fb0c3"}}>Status</div><strong>{r.status||"Unclassified"}</strong></div>
    </div>
    <div style={{display:"flex",gap:5,flexWrap:"wrap",margin:"8px 0"}}>{cleanArray(r.pillars).map(id=><span key={id} style={styles.tag}>{PILLARS.find(p=>p.id===id)?.label||id}</span>)}{cleanArray(r.themes).map(id=><span key={id} style={{...styles.tag,borderColor:"#6c5b8f"}}>{THEMES.find(t=>t.id===id)?.label||id}</span>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}><span style={styles.muted}>Geography: {r.country||"Not specified"} · Funding: {r.amount||"Not specified"} · Updated: {dateLabel(r.updatedAt||r.createdAt)}</span><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>openConceptWorkspace(r)}>Screen eligibility / draft</button><a href={r.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>Open official call ↗</a>{canManage&&r.sourceType!=="Cloudflare crawler"&&<select aria-label={"Update status for "+r.title} style={{...styles.input,width:"auto"}} value={r.status||"Open"} onChange={e=>changeStatus(r,e.target.value)}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select>}</div></div>
   </article>)}
  </section>
  <section style={styles.card}>
   <details><summary style={{cursor:"pointer",fontSize:17,fontWeight:800}}>Funding resource directory ({SOURCES.length} resources · click to expand)</summary>
    <p style={{...styles.muted,marginTop:9}}>Indicative discovery directory spanning African NGOs, foundations, UN and multilateral agencies, regional institutions, embassies and climate/conservation funders. The directory stays collapsed to preserve dashboard space. Click a source to open its original website and verify the actual call, deadline, geography and applicant requirements.</p>
    {Array.from(new Set(SOURCES.map(source=>source.category))).map(category=><div key={category} style={{marginTop:14}}>
     <h3 style={{fontSize:13,margin:"0 0 7px",color:"var(--text-secondary, #aab6c5)"}}>{category}</h3>
     <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:7}}>{SOURCES.filter(source=>source.category===category).map(source=><a key={source.name} href={source.url} target="_blank" rel="noreferrer" style={{border:"1px solid #425064",borderRadius:8,padding:"10px 11px",color:"var(--text-primary, #e8edf5)",textDecoration:"none",fontSize:12,fontWeight:650,display:"flex",justifyContent:"space-between",gap:8}}><span>{source.name}</span><span aria-hidden="true">↗</span></a>)}</div>
    </div>)}
    <p style={styles.muted}>Directory entries are discovery resources, not a claim that each organisation has an open call or that IRPA is eligible. The crawler and AI-assisted review must check each individual opportunity against the same IRPA criteria.</p>
   </details>
  </section>
  <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Live-data status:</strong> manually registered opportunities continue to come from the IRPA register; crawler-discovered records are retrieved from the isolated Cloudflare D1 crawler. Crawler leads are marked pending verification and do not establish legal eligibility or donor approval.</div>
 </div>;
}
function dateMillis(v){if(!v)return 0;const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();}
