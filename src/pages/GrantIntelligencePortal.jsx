import React,{useEffect,useMemo,useState} from "react";
import {addDoc,collection,onSnapshot,serverTimestamp,updateDoc,doc,query,where} from "firebase/firestore";
import app,{auth,db} from "../firebase/config";
import FundraisingSourceRegistry from "./grant-fundraising/FundraisingSourceRegistry.jsx";

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
const isNotCurrentOpportunity=record=>["closed","expired"].includes(getOpportunityCurrentStatusIssue(record));
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
 const [fundraisingQuery,setFundraisingQuery]=useState("");
 const [fundraisingMode,setFundraisingMode]=useState("all");
 const [fundraisingResults,setFundraisingResults]=useState([]);
 const [fundraisingSearchBusy,setFundraisingSearchBusy]=useState(false);
 const [fundraisingSearchError,setFundraisingSearchError]=useState("");
 const [fundraisingSearchMeta,setFundraisingSearchMeta]=useState(null);
 const [assistantFormat,setAssistantFormat]=useState("Partnership request message");
 const [assistantTone,setAssistantTone]=useState("Professional and persuasive");
 const [assistantLength,setAssistantLength]=useState("Concise");
 const [assistantInstructions,setAssistantInstructions]=useState("");
 const [assistantContext,setAssistantContext]=useState("");
 const [assistantDraft,setAssistantDraft]=useState("");
 const [assistantDocumentId,setAssistantDocumentId]=useState("");
 const [assistantDocuments,setAssistantDocuments]=useState([]);
 const [assistantDocumentsBusy,setAssistantDocumentsBusy]=useState(true);
 const [assistantSaving,setAssistantSaving]=useState(false);
 const [assistantBusy,setAssistantBusy]=useState(false);
 const [assistantError,setAssistantError]=useState("");
 const [assistantNotice,setAssistantNotice]=useState("");
 const [pillar,setPillar]=useState("all");
 const [theme,setTheme]=useState("all");
 const [status,setStatus]=useState("all");
 const [showForm,setShowForm]=useState(false);
 const [saving,setSaving]=useState(false);
 const [pipelineFormOpen,setPipelineFormOpen]=useState(false);
 const [pipelineSaving,setPipelineSaving]=useState(false);
 const [pipelineEntry,setPipelineEntry]=useState({title:"",funder:"",status:"Submitted",submissionDate:"",awardDate:"",amount:"",url:"",project:"",notes:""});
 const [draft,setDraft]=useState({title:"",funder:"",url:"",deadline:"",country:"Tanzania",amount:"",summary:"",status:"Open",pillars:["rangeland"],themes:[]});
 const uid=auth.currentUser?.uid||"";
 const roleList=[profile?.role,profile?.roles,employee?.role,employee?.roles].flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim().toLowerCase());
 const canManage=isAdmin||roleList.some(r=>["administrator","executive director","director outreach","director finance & administration","director research","research director","research manager","fundraising officer","research officer"].includes(r));
 async function generateAssistantDraft(){
   const request=text(assistantInstructions);
   if(!request){setAssistantError("Describe what you want the AI Assistant to prepare.");return;}
   // Keep AI drafting on its established assistant-capable Worker; crawler scans use the isolated production D1 Worker.
   const workerUrl=String(import.meta.env.VITE_GRANT_ASSISTANT_WORKER_URL||"https://irpa-dbgs-grant-crawler.irpa-governance.workers.dev").replace(/\/+$/,"");
   const token=await auth.currentUser?.getIdToken(true);
   if(!token){setAssistantError("Your session has expired. Sign in again.");return;}
   setAssistantBusy(true);setAssistantError("");setAssistantNotice("Preparing your requested format…");
   try{
     const response=await fetch(workerUrl+"/assistant/analyze",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({task:"draft_message",format:assistantFormat,tone:assistantTone,length:assistantLength,instructions:request,context:text(assistantContext),organization:"Improvement of Rangeland in Pastoral Areas (IRPA)",strategicContext:"Tanzania-based NGO focused on sustainable rangeland management, livestock development and market development; early-stage organization with limited resources. Do not claim prior project implementation or secured funding unless supplied by the user."}),signal:AbortSignal.timeout(90000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"The AI Assistant request failed ("+response.status+").");
     const generated=text(data.draft||data.message||data.assessment?.draft||data.assessment?.concept_note?.draft);
     if(!generated)throw new Error("The AI service returned no draft. Please retry.");
     const documentPayload={title:request.slice(0,180),format:assistantFormat,tone:assistantTone,length:assistantLength,instructions:request,context:text(assistantContext),draft:generated,createdByUid:uid,createdByEmail:auth.currentUser?.email||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),recordOrigin:"PRODUCTION"};
     const saved=await addDoc(collection(db,"grantAssistantDocuments"),documentPayload);
     setAssistantDocumentId(saved.id);setAssistantDraft(generated);
     setAssistantNotice("Draft generated and saved to your private AI document history. It remains available after you sign out or turn off your computer.");
   }catch(err){setAssistantError(err?.name==="TimeoutError"?"The AI Assistant took longer than 90 seconds. Please retry.":err?.message||"The AI Assistant could not generate a draft.");setAssistantNotice("");}
   finally{setAssistantBusy(false);}
 }
 function downloadAssistantDraft(){
   if(!text(assistantDraft)){setAssistantError("Generate or enter a draft first.");return;}
   const blob=new Blob([assistantDraft],{type:"text/plain;charset=utf-8"});
   const href=URL.createObjectURL(blob);const a=document.createElement("a");a.href=href;a.download="irpa-ai-assistant-draft.txt";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);
 }

 async function loadCrawlerResults(showNotice=false){
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/,"");
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
       funder:item.funder||item.source_name||(()=>{try{return new URL(item.source_url||item.url).hostname.replace(/^www\./,"")}catch{return "Funder not verified"}})(),
       url:item.url||item.source_url||"",source_url:item.source_url||"",deadline:item.deadline_at||null,
       country:item.country||(item.geography_assessment==="tanzania_mentioned"?"Tanzania":item.geography_assessment==="regional_or_lmic_scope"?"Regional / LMIC":"Not verified"),
       amount:item.amount||"Not stated",summary:item.description||"No description supplied by source.",
       status:["closed","expired","closed_do_not_prioritize"].includes(String(item.call_status||"").toLowerCase())?"Closed":String(item.call_status||"").toLowerCase()==="open"?"Open":"Under review",
       callStatus:item.call_status||"unknown",
       pillars:Array.isArray(item.pillars)?item.pillars:(()=>{try{return JSON.parse(item.pillars||"[]")}catch{return []}})(),
       themes:Array.isArray(item.themes)?item.themes:(()=>{try{return JSON.parse(item.themes||"[]")}catch{return []}})(),
       verificationStatus:item.verification_status||"Pending official-call verification",sourceType:"Cloudflare crawler",
       discoveryEngine:item.discovery_engine||"unknown",sourceUrl:item.source_url||"",discoveryEvidence:item.discovery_evidence||"",
       fitScore:Number(item.fit_score||0),fitReasons:item.fit_reasons||"[]",
       eligibilityStatus:item.eligibility_status||"unverified",triageAssessment:item.triage_assessment||"manual_eligibility_review",
       createdAt:item.first_seen_at||null
     })));
     if(data.lastRun)setCrawlerStatus({status:data.lastRun.status,created:data.lastRun.created??data.lastRun.items_changed,candidatesFound:data.lastRun.candidatesFound??data.lastRun.items_seen,lastCompletedAt:data.lastRun.finished_at,lastStartedAt:data.lastRun.started_at,configuredSources:data.lastRun.configuredSources??data.sourceCount??data.feedsConfigured,healthySources:data.lastRun.healthySources??uniqueSources.length,failedSources:data.lastRun.failedSources??0});
     if(showNotice)setNotice("Refreshed "+String(data.count||0)+" grant records from the Cloudflare crawler. Eligibility remains unverified.");
   }catch(err){console.error("Crawler result retrieval failed",err);if(showNotice)setError(err?.message||"Unable to load crawler results.");}
   finally{setCrawlerResultsBusy(false);}
 }
 useEffect(()=>{loadCrawlerResults(false)},[]);
 useEffect(()=>{
   if(!uid){setAssistantDocuments([]);setAssistantDocumentsBusy(false);return;}
   setAssistantDocumentsBusy(true);
   const ownedDocuments=query(collection(db,"grantAssistantDocuments"),where("createdByUid","==",uid));
   return onSnapshot(ownedDocuments,snap=>{
     const items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMillis(b.updatedAt||b.createdAt)-dateMillis(a.updatedAt||a.createdAt));
     setAssistantDocuments(items);setAssistantDocumentsBusy(false);
     if(assistantDocumentId&&!items.some(item=>item.id===assistantDocumentId))setAssistantDocumentId("");
   },err=>{console.error("Grant AI document history subscription failed",err);setAssistantDocumentsBusy(false);setAssistantError("Saved AI documents could not be loaded. Check your authenticated Firestore access.");});
 },[uid]);
 useEffect(()=>onSnapshot(collection(db,"grantOpportunities"),snap=>{
   const next=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMillis(b.createdAt)-dateMillis(a.createdAt));
   setRecords(next);setLoading(false);setError("");
 },err=>{console.error("Grant opportunity subscription failed",err);setError("Grant records could not be loaded. Check your signed-in profile's Firestore access.");setLoading(false)}),[]);
 useEffect(()=>onSnapshot(doc(db,"grantCrawlerStatus","current"),snap=>{if(snap.exists())setCrawlerStatus(snap.data())},err=>console.warn("Legacy Firestore crawler status unavailable",err)),[]);
 useEffect(()=>onSnapshot(collection(db,"grantCrawlerSources"),snap=>setCrawlerSources(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")))),err=>console.warn("Grant crawler source health unavailable",err)),[]);
 const combinedRecords=useMemo(()=>{const seen=new Set(records.map(r=>String(r.url||"").trim()).filter(Boolean));return [...records,...crawlerRecords.filter(r=>r.url&&!seen.has(String(r.url).trim()))]},[records,crawlerRecords]);
 const currentOpportunityRecords=useMemo(()=>combinedRecords.filter(r=>!isNotCurrentOpportunity(r)),[combinedRecords]);
 const expiredExclusionCount=combinedRecords.length-currentOpportunityRecords.length;
 const crawlerDiscoveryActive=crawlerRunning||crawlerRecords.length>0;
 const filtered=useMemo(()=>currentOpportunityRecords.filter(r=>{
   const hay=[r.title,r.funder,r.summary,r.country,r.amount].join(" ").toLowerCase();
   return (!queryText||hay.includes(queryText.toLowerCase()))&&(pillar==="all"||cleanArray(r.pillars).includes(pillar))&&(theme==="all"||cleanArray(r.themes).includes(theme))&&(status==="all"||r.status===status);
 }),[currentOpportunityRecords,queryText,pillar,theme,status]);
 const counts=useMemo(()=>({open:currentOpportunityRecords.filter(r=>r.status==="Open").length,review:currentOpportunityRecords.filter(r=>["Under review","Application in progress"].includes(r.status)).length,submitted:currentOpportunityRecords.filter(r=>["Submitted","Awarded"].includes(r.status)).length}),[currentOpportunityRecords]);
 const smartKeywordSuggestions=["rangeland restoration","pastoral livelihoods","livestock health","climate resilience","women and youth","digital governance","market access","biodiversity conservation","water security","community grants"];
 const smartAssistantResults=useMemo(()=>{
   // Comma/semicolon/newline separates keyword phrases; a space-only query is treated as individual keywords.
   const raw=smartKeywords.toLowerCase().split(/[,;\n]+/).map(term=>term.trim()).filter(Boolean);
   const terms=[...new Set((raw.length?raw:smartKeywords.toLowerCase().split(/\s+/)).flatMap(term=>[term,...term.split(/\s+/).filter(token=>token.length>2)]))].filter(term=>term.length>1).slice(0,20);
   if(!terms.length)return [];
   const aliases={
     pastoralism:["pastoralist","pastoral","rangeland","nomadic"],
     pastoral:["pastoralism","pastoralist","rangeland"],
     rangeland:["pastoral","dryland","grazing","range land","grassland"],
     funding:["grant","grants","call for proposals","open call"],
     fodder:["forage","feed","livestock","pasture"],
     livelihoods:["income generation","economic empowerment","pastoral livelihoods"],
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
 async function runFundraisingSearch(searchQuery=fundraisingQuery, searchMode=fundraisingMode){
   const query=text(searchQuery);
   if(query.length<2){setFundraisingSearchError("Enter at least two characters, such as rangeland restoration, livestock markets, women-led enterprises, CSR or digital governance.");return;}
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/,"");
   const token=await auth.currentUser?.getIdToken(true);
   if(!token){setFundraisingSearchError("Sign in to search fundraising sources.");return;}
   setFundraisingSearchBusy(true);setFundraisingSearchError("");setFundraisingSearchMeta(null);
   try{
     const response=await fetch(workerUrl+"/fundraising/search",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({query,mode:searchMode,pillar:pillar==="all"?"":pillar,theme:theme==="all"?"":theme}),signal:AbortSignal.timeout(35000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Fundraising research search failed ("+response.status+").");
     setFundraisingResults(Array.isArray(data.items)?data.items:[]);
     setFundraisingSearchMeta({providers:data.providers||[],resultCount:Number(data.resultCount||0),errors:Array.isArray(data.errors)?data.errors:[]});
   }catch(err){setFundraisingSearchError(err?.name==="TimeoutError"?"The live search exceeded 35 seconds. Try a more specific query.":err?.message||"Fundraising search failed.");}
   finally{setFundraisingSearchBusy(false);}
 }
 function useFundraisingLeadInAssistant(lead){
   const contextBlock=[
     "LIVE FUNDRAISING RESEARCH LEAD (unverified; do not present as a confirmed open call)",
     "Title: "+text(lead.title),"Lead type: "+text(lead.fundraisingType),
     "Search result date: "+text(lead.publishedAt||"Not supplied"),"Deadline signal: "+text(lead.deadlineSignal||"Not established"),
     "Publisher: "+text(lead.sourceName),"Lead URL: "+text(lead.url),"Publisher/source URL: "+text(lead.sourceUrl||lead.url),
     "Search snippet: "+text(lead.description),"Discovery engine: "+text(lead.discoveryEngine),
     "Required validation: open the issuer's original page; confirm the funder, applicant eligibility for a Tanzania-registered NGO, deadline or rolling status, funding range, eligible costs, co-funding, required track record and application route before recommending an application."
   ].join("\n");
   setAssistantContext(previous=>[text(previous),contextBlock].filter(Boolean).join("\n\n"));
   if(!text(assistantInstructions))setAssistantInstructions("Assess this fundraising lead for the Improvement of Rangeland in Pastoral Areas (IRPA). Verify the original issuer, Tanzania applicant eligibility, funding mechanism, deadline or rolling status, grant size and restrictions. Separate confirmed facts from unknowns, assess fit against IRPA's three strategic pillars and cross-cutting themes, and recommend practical next steps. Do not invent facts or claim this lead is confirmed open.");
   setAssistantNotice("Research lead added to the AI Assistant context. Validate the source before using it in a fundraising approach.");
 }
 async function startCrawlerScan(){
   if(!auth.currentUser){setError("Sign in to IRPA to start a grant scan.");return;}
   try{
     setCrawlerRunning(true);setError("");setNotice("Manual donor-source scan requested. This can take several minutes.");
     const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/, "");
     const idToken=await auth.currentUser?.getIdToken();
     if(!idToken) throw new Error("Your session has expired. Sign in again.");
     const response=await fetch(workerUrl+"/run",{method:"POST",headers:{"Authorization":"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({mode:"full_catalog"}),signal:AbortSignal.timeout(90000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok) throw new Error(data.error||"Cloudflare grant crawler request failed ("+response.status+").");
     setNotice("Authorised full-catalogue scan "+String(data.status||"finished")+". Search queries requested: "+String(data.searchCatalog?.webQueriesRequested||0)+"/"+String(data.searchCatalog?.webQueryCatalogSize||0)+" web and "+String(data.searchCatalog?.gdeltQueriesRequested||0)+"/"+String(data.searchCatalog?.gdeltQueryCatalogSize||0)+" GDELT. Sources checked: "+String(data.sourceCount||data.configuredSources||0)+", candidates found: "+String(data.candidatesFound||data.itemsSeen||0)+", records created or updated: "+String(Number(data.created||0)+Number(data.updated||0)||data.recordsChanged||0)+". Provider history limits apply; new leads remain pending official-call verification.");
     await loadCrawlerResults(false);
   }catch(err){console.error("Manual grant crawler scan failed",err);setError(err?.name==="TimeoutError"?"The scan exceeded 90 seconds. Refresh results and inspect crawler health before retrying.":err?.message||"Manual scan failed. Check crawler authorization and Worker health.");}
   finally{setCrawlerRunning(false);}
 }
 async function loadSavedDrafts(){
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/,"");
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
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/,"");
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
   if(currentStatusIssue&&currentStatusIssue!=="unverified"){
     setAnalysisResult({geographic_eligibility:{status:"unclear",reason:"The application deadline has passed or the call is explicitly closed/expired.",evidence:["Deterministic expiry gate applied before AI analysis."]},eligibility:{status:"ineligible",confidence:"high",evidence:["Expired or closed call"],unknowns:["Select a current call with a future deadline or verify that the donor has formally reopened it."]}});
     setConceptDraft("");
     setError("This call is expired or closed. AI analysis and concept-note drafting are blocked.");
     setWorkspaceNotice("Closed/expired-call gate blocked this call before AI analysis.");
     return;
   }
   const statusUnverified=currentStatusIssue==="unverified";
   // Geographic eligibility no longer blocks opportunity analysis; show and assess all calls.
   if(!text(opportunityDescription)&&!text(donorRequirements)){setError("Provide the opportunity description or paste the official donor eligibility and application criteria.");return;}
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/,"");
   const idToken=await auth.currentUser?.getIdToken();
   if(!idToken){setError("Your session has expired. Sign in again.");return;}
   setAnalysisBusy(true);setError("");setWorkspaceNotice(task==="concept_note"?(statusUnverified?"Preparing a review-only draft; current call status still needs verification…":"Checking eligibility and preparing the concept-note draft…"):"Checking geographic, organizational and donor eligibility criteria…");
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
       setWorkspaceNotice(generated?(statusUnverified?"Concept-note draft generated. Current call status is unverified; verify the official donor page before submission.":"Eligibility screening completed and a concept-note draft was generated. Edit it before saving."):"Eligibility screening completed, but the model did not return a concept-note draft. Review the assessment and retry.");
     }else{
       setWorkspaceNotice("Eligibility screening completed. Geographic status: "+String(data.assessment?.geographic_eligibility?.status||"unclear")+"."+(statusUnverified?" Current call status is unverified; confirm it before submission.":" Review every requirement before drafting."));
     }
   }catch(err){setError(err?.name==="TimeoutError"?"The AI analysis exceeded 90 seconds. Retry after checking production Worker health.":err?.message||"The AI eligibility analysis failed.");}
   finally{setAnalysisBusy(false);}
 }
 async function saveConceptDraft(){
   if(!selectedOpportunity?.title||!text(conceptDraft)){setError("Select an opportunity and enter a concept-note draft before saving.");return;}
   const currentStatusIssue=getOpportunityCurrentStatusIssue({...selectedOpportunity,summary:[selectedOpportunity.summary,opportunityDescription].filter(Boolean).join(" "),applicationRequirements:donorRequirements});
   if(currentStatusIssue&&currentStatusIssue!=="unverified"){
     setError("This call is expired or closed. A concept note cannot be saved for an active application.");
     return;
   }
   const statusUnverified=currentStatusIssue==="unverified";
   // Geographic eligibility no longer blocks saving a reviewed draft.
   const workerUrl=String(import.meta.env.VITE_GRANT_CRAWLER_WORKER_URL||"https://irpa-grant-crawler-production.irpa-governance.workers.dev").replace(/\/+$/,"");
   const idToken=await auth.currentUser?.getIdToken();
   if(!idToken){setError("Your session has expired. Sign in again.");return;}
   const id=draftId||crypto.randomUUID();
   setDraftSaving(true);setError("");
   try{
     const response=await fetch(workerUrl+"/application/drafts",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({id,name:text(selectedOpportunity.title)+" — IRPA concept note",opportunity:{title:text(selectedOpportunity.title),url:text(selectedOpportunity.url),description:text(opportunityDescription),donorRequirements:text(donorRequirements),deadline:dateKeyInTanzania(selectedOpportunity.deadline||selectedOpportunity.deadline_at)||"",callStatus:text(selectedOpportunity.callStatus||selectedOpportunity.call_status||"")},applicationFields:{conceptNoteDraft:conceptDraft,strategicAlignment:analysisResult?.strategic_alignment||{},geographicEligibility:analysisResult?.geographic_eligibility||null},assessment:analysisResult||null,finalNotes:"Draft saved in the IRPA-DBGS grant concept-note workspace. Official call eligibility and internal approvals remain to be verified."}),signal:AbortSignal.timeout(20000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Concept-note draft could not be saved.");
     setDraftId(id);
     setWorkspaceNotice(statusUnverified?"Concept-note draft saved to the IRPA workspace with an audit event. The call status remains unverified; confirm the official donor page before submission.":"Concept-note draft saved to the IRPA workspace; an audit event was recorded.");
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
 async function savePipelineEntry(e){
    e.preventDefault();
    if(!canManage){setError("Only designated grant-management and executive roles may record submitted or awarded grants.");return;}
    if(!text(pipelineEntry.title)||!text(pipelineEntry.funder)){setError("Enter the grant or project title and funder.");return;}
    if(pipelineEntry.status==="Submitted"&&!pipelineEntry.submissionDate){setError("Enter the submission date for a submitted grant.");return;}
    if(pipelineEntry.status==="Awarded"&&!pipelineEntry.awardDate){setError("Enter the award date for an awarded grant.");return;}
    if(pipelineEntry.url&&!/^https:\/\//i.test(pipelineEntry.url)){setError("The source or application URL must start with https://.");return;}
    try{
      setPipelineSaving(true);setError("");
      await addDoc(collection(db,"grantOpportunities"),{
        title:text(pipelineEntry.title),funder:text(pipelineEntry.funder),status:pipelineEntry.status,
        url:text(pipelineEntry.url),deadline:null,country:"Tanzania",amount:text(pipelineEntry.amount)||"Not specified",
        summary:text(pipelineEntry.project)+(text(pipelineEntry.notes)?" — "+text(pipelineEntry.notes):""),
        pillars:[],themes:[],submissionDate:pipelineEntry.status==="Submitted"?pipelineEntry.submissionDate:null,
        awardDate:pipelineEntry.status==="Awarded"?pipelineEntry.awardDate:null,
        project:text(pipelineEntry.project),pipelineNotes:text(pipelineEntry.notes),
        createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdByUid:uid,
        createdByEmail:auth.currentUser?.email||"",lastUpdatedByUid:uid,
        verificationStatus:"Manually recorded by IRPA",sourceType:"Grant pipeline entry",recordOrigin:"PRODUCTION"
      });
      setPipelineEntry({title:"",funder:"",status:"Submitted",submissionDate:"",awardDate:"",amount:"",url:"",project:"",notes:""});
      setPipelineFormOpen(false);setNotice("Grant pipeline entry saved. The submitted/awarded dashboard total has been updated.");setTimeout(()=>setNotice(""),7000);
    }catch(err){setError(err?.message||"Could not save the grant pipeline entry. Check your designated grant-management access.");}
    finally{setPipelineSaving(false);}
  }
  function toggleDraftArray(key,value){setDraft(d=>({...d,[key]:d[key].includes(value)?d[key].filter(x=>x!==value):[...d[key],value]}));}
 return <div className="grant-intelligence-portal" style={{...styles.page,width:"100%",minWidth:0,maxWidth:"100%",boxSizing:"border-box"}}>
  <section style={styles.hero}>
   <div style={{maxWidth:760}}>
    <div style={styles.eyebrow}>IRPA-DBGS · FUNDING INTELLIGENCE</div>
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
     <h1 style={{...styles.title,margin:"7px 0"}}>Live Grants & Calls for Proposals</h1>
     <span role="status" aria-live="polite" title={crawlerRunning?"A grant-source scan is running.":crawlerRecords.length?"Crawler results are loaded.":"No crawler results are currently loaded."} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"6px 10px",borderRadius:999,border:"1px solid "+(crawlerDiscoveryActive?"#32846d":"#b65c5c"),background:crawlerDiscoveryActive?"#123b32":"#3b2228",color:crawlerDiscoveryActive?"#8de0b7":"#ffb8b8",fontSize:12,fontWeight:800,whiteSpace:"nowrap"}}>
      <span aria-hidden="true" style={{width:7,height:7,borderRadius:"50%",background:crawlerDiscoveryActive?"#54d6a4":"#ff8585",display:"inline-block"}}/>
      {crawlerRunning?"Scanning":crawlerRecords.length?"Results loaded":"Awaiting results"}
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
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={assistantBusy} style={{...styles.button,opacity:assistantBusy?0.6:1}} onClick={generateAssistantDraft}>{assistantBusy?"Generating draft…":"Generate requested output"}</button><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>{setAssistantInstructions("");setAssistantContext("");setAssistantDraft("");setAssistantDocumentId("");setAssistantError("");setAssistantNotice("");}}>Clear workspace</button></div>
   <section aria-labelledby="grant-ai-saved-documents-heading" style={{border:"1px solid #344255",borderRadius:10,padding:12,display:"grid",gap:8}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap"}}><strong id="grant-ai-saved-documents-heading">Saved AI documents</strong><span style={styles.muted}>Private to your signed-in account · cloud-saved</span></div>
    {assistantDocumentsBusy?<div style={styles.muted}>Loading saved documents…</div>:assistantDocuments.length===0?<div style={styles.muted}>No saved AI documents yet. Newly generated outputs will be saved here automatically.</div>:<div style={{display:"grid",gap:7}}>{assistantDocuments.map(item=><div key={item.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",borderTop:"1px solid #344255",paddingTop:8}}><div style={{minWidth:0,flex:"1 1 240px"}}><strong style={{fontSize:13,overflowWrap:"anywhere"}}>{item.title||item.format||"Saved AI document"}</strong><div style={styles.muted}>{item.format||"AI output"} · Updated {dateLabel(item.updatedAt||item.createdAt)}</div></div><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>{setAssistantDocumentId(item.id);setAssistantDraft(text(item.draft));setAssistantInstructions(text(item.instructions));setAssistantContext(text(item.context));if(item.format)setAssistantFormat(item.format);if(item.tone)setAssistantTone(item.tone);if(item.length)setAssistantLength(item.length);setAssistantError("");setAssistantNotice("Saved document opened. Changes can be saved back to this record.");}}>Open</button></div>)}</div>}
   </section>
   {assistantNotice&&<div role="status" style={{...styles.card,borderColor:"#32846d",color:"#8de0b7"}}>{assistantNotice}</div>}
   {assistantError&&<div role="alert" style={{...styles.card,borderColor:"#b65c5c",color:"#ffb8b8"}}>{assistantError}</div>}
   {assistantDraft&&<div style={{display:"grid",gap:8}}><label style={{fontSize:13,fontWeight:800}} htmlFor="grant-ai-draft-output">Editable AI output</label><textarea id="grant-ai-draft-output" aria-label="Editable AI output" rows="14" style={{...styles.input,resize:"vertical",fontFamily:"inherit",lineHeight:1.65}} value={assistantDraft} onChange={e=>setAssistantDraft(e.target.value)}/><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={styles.button} onClick={()=>{if(!navigator.clipboard?.writeText){setAssistantError("Clipboard access is unavailable in this browser.");return;}navigator.clipboard.writeText(assistantDraft).then(()=>setAssistantNotice("Draft copied to clipboard.")).catch(()=>setAssistantError("Clipboard access was blocked by the browser."));}}>Copy draft</button><button type="button" disabled={assistantSaving} style={{...styles.button,opacity:assistantSaving?0.6:1}} onClick={async()=>{if(!uid||!assistantDocumentId){setAssistantError("Generate a document or open a saved record before saving edits.");return;}setAssistantSaving(true);setAssistantError("");try{await updateDoc(doc(db,"grantAssistantDocuments",assistantDocumentId),{draft:assistantDraft,updatedAt:serverTimestamp(),title:text(assistantInstructions).slice(0,180)||"Saved AI document",format:assistantFormat,tone:assistantTone,length:assistantLength,instructions:assistantInstructions,context:assistantContext});setAssistantNotice("Edits saved to your private AI document history.");}catch(err){setAssistantError(err?.message||"Could not save edits to the cloud.");}finally{setAssistantSaving(false);}}}>{assistantSaving?"Saving…":"Save edits"}</button><button type="button" style={{...styles.button,background:"transparent"}} onClick={downloadAssistantDraft}>Download .txt</button></div><p style={{...styles.muted,margin:0}}>Check facts, eligibility, dates, budgets and donor instructions before sending or submitting.</p></div>}
  </section>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
   {[["Discovered opportunities",combinedRecords.length,"All geographic eligibility categories included"],["Open calls",counts.open,"Status: Open"],["In preparation",counts.review,"Review / drafting"],["Submitted or awarded",counts.submitted,"Pipeline progress"],["Expired / closed / unverified calls suppressed",expiredExclusionCount,"Past deadlines, explicit closure, or no verified current deadline/status"]].map(([label,value,sub])=><div key={label} style={styles.card}><div style={styles.muted}>{label}</div><div style={{fontSize:28,fontWeight:800,margin:"7px 0"}}>{value}</div><div style={{fontSize:11,color:"#8ba2b8"}}>{sub}</div></div>)}
  </div>
  <section style={{...styles.card,display:"grid",gap:12,borderColor:"#4e8b91"}} aria-labelledby="grant-pipeline-entry-heading">
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:12,flexWrap:"wrap"}}>
    <div><div style={styles.eyebrow}>GRANT APPLICATION PIPELINE</div><h2 id="grant-pipeline-entry-heading" style={{fontSize:19,margin:"5px 0"}}>Record submitted and awarded grants</h2><p style={{...styles.muted,margin:0}}>Enter grants that IRPA has actually submitted or been formally awarded. Entries are saved in the existing grant register and counted in the dashboard. Saving a record does not submit an application or certify an award.</p></div>
    {canManage&&<button type="button" style={styles.button} onClick={()=>setPipelineFormOpen(v=>!v)}>{pipelineFormOpen?"Close entry form":"＋ Add grant entry"}</button>}
   </div>
   {!canManage&&<p style={styles.muted}>Entry is restricted to designated grant-management and executive roles.</p>}
   {pipelineFormOpen&&canManage&&<form onSubmit={savePipelineEntry} style={{display:"grid",gap:11}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
     <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Grant / project title *<input required maxLength={180} style={styles.input} value={pipelineEntry.title} onChange={e=>setPipelineEntry(v=>({...v,title:e.target.value}))} placeholder="Grant or project title"/></label>
     <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Funder *<input required maxLength={180} style={styles.input} value={pipelineEntry.funder} onChange={e=>setPipelineEntry(v=>({...v,funder:e.target.value}))} placeholder="Funding organisation"/></label>
     <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Pipeline status *<select style={styles.input} value={pipelineEntry.status} onChange={e=>setPipelineEntry(v=>({...v,status:e.target.value}))}><option>Submitted</option><option>Awarded</option></select></label>
     {pipelineEntry.status==="Submitted"&&<label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Submission date *<input required type="date" style={styles.input} value={pipelineEntry.submissionDate} onChange={e=>setPipelineEntry(v=>({...v,submissionDate:e.target.value}))}/></label>}
     {pipelineEntry.status==="Awarded"&&<label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Award date *<input required type="date" style={styles.input} value={pipelineEntry.awardDate} onChange={e=>setPipelineEntry(v=>({...v,awardDate:e.target.value}))}/></label>}
     <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Amount / grant value (optional)<input maxLength={100} style={styles.input} value={pipelineEntry.amount} onChange={e=>setPipelineEntry(v=>({...v,amount:e.target.value}))} placeholder="Amount and currency, if confirmed"/></label>
     <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Official call / award URL (optional)<input type="url" maxLength={1000} style={styles.input} value={pipelineEntry.url} onChange={e=>setPipelineEntry(v=>({...v,url:e.target.value}))} placeholder="https://…"/></label>
     <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>IRPA project / programme (optional)<input maxLength={180} style={styles.input} value={pipelineEntry.project} onChange={e=>setPipelineEntry(v=>({...v,project:e.target.value}))} placeholder="Project linked to this grant"/></label>
    </div>
    <label style={{display:"grid",gap:5,fontSize:13,fontWeight:700}}>Notes / reference number (optional)<textarea rows={3} maxLength={3000} style={styles.input} value={pipelineEntry.notes} onChange={e=>setPipelineEntry(v=>({...v,notes:e.target.value}))} placeholder="Submission reference, award conditions, next action, or notes"/></label>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="submit" disabled={pipelineSaving} style={{...styles.button,opacity:pipelineSaving?0.65:1}}>{pipelineSaving?"Saving entry…":"Save grant entry"}</button><span style={styles.muted}>Only record a grant as Awarded after formal award confirmation.</span></div>
   </form>}
   <div style={{display:"grid",gap:8}}>
    <h3 style={{fontSize:15,margin:0}}>Submitted / awarded register ({records.filter(r=>["Submitted","Awarded"].includes(r.status)).length})</h3>
    {records.filter(r=>["Submitted","Awarded"].includes(r.status)).length===0?<p style={styles.muted}>No submitted or awarded grants have been entered yet.</p>:records.filter(r=>["Submitted","Awarded"].includes(r.status)).map(r=><article key={r.id} style={{border:"1px solid #344255",borderRadius:10,padding:12,display:"grid",gap:5}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><strong>{r.title}</strong><span style={styles.tag}>{r.status}</span></div>
     <div style={styles.muted}>{r.funder||"Funder not specified"} · {r.status==="Submitted"?"Submitted: "+dateLabel(r.submissionDate||r.updatedAt):"Awarded: "+dateLabel(r.awardDate||r.updatedAt)} · Amount: {r.amount||"Not specified"}</div>
     {r.project&&<div style={styles.muted}>Project: {r.project}</div>}
     {r.pipelineNotes&&<div style={styles.muted}>Notes: {r.pipelineNotes}</div>}
     {r.url&&<a href={r.url} target="_blank" rel="noreferrer" style={{color:"#8fd3df",fontSize:13}}>Open official record ↗</a>}
    </article>)}
   </div>
  </section>
  <section style={{...styles.card,display:"grid",gap:12}} aria-labelledby="crawler-status-heading">
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}>
    <div><div style={styles.eyebrow}>AUTOMATED SOURCE MONITOR</div><h2 id="crawler-status-heading" style={{fontSize:18,margin:"5px 0"}}>Multi-donor web crawler</h2><p style={{...styles.muted,margin:0}}>Checks public RSS/Atom feeds, public APIs and selected donor opportunity hubs every six hours. New records are unverified leads, not confirmed eligible grants.</p></div>
    {<div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={crawlerResultsBusy} style={{...styles.button,background:"transparent",opacity:crawlerResultsBusy?0.6:1}} onClick={()=>loadCrawlerResults(true)}>{crawlerResultsBusy?"Refreshing results…":"Refresh results"}</button><button type="button" disabled={crawlerRunning} title="Run a full-catalogue scan (available to authenticated IRPA-DBGS users)" style={{...styles.button,opacity:crawlerRunning?0.6:1}} onClick={startCrawlerScan}>{crawlerRunning?"Scanning sources…":"Run scan now"}</button></div>}
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10}}>
    {[[ "Crawler state",crawlerStatus?.status||"Awaiting first scan"],[ "Sources with results",String(crawlerStatus?.healthySources??0)+" / "+String(crawlerStatus?.configuredSources??15)],[ "New records last run",String(crawlerStatus?.created??0)],[ "Candidates last run",String(crawlerStatus?.candidatesFound??0)]].map(([label,value])=><div key={label} style={{border:"1px solid #344255",borderRadius:10,padding:11}}><div style={styles.muted}>{label}</div><strong style={{display:"block",fontSize:17,marginTop:5}}>{value}</strong></div>)}
   </div>
   <div style={styles.muted}>Last scan started: {dateLabel(crawlerStatus?.lastStartedAt)} · Last completed: {dateLabel(crawlerStatus?.lastCompletedAt)} · Cadence: every 6 hours (Tanzania time)</div>
   <details><summary style={{cursor:"pointer",fontSize:13,fontWeight:700}}>Source health and crawl results ({crawlerSources.length})</summary><div style={{display:"grid",gap:7,marginTop:10}}>{crawlerSources.map(source=><div key={source.id} style={{borderTop:"1px solid #344255",paddingTop:8,display:"flex",justifyContent:"space-between",gap:10,alignItems:"start"}}><div><strong style={{fontSize:13}}>{source.name||source.id}</strong><div style={styles.muted}>{source.url}</div>{source.error&&<div style={{fontSize:12,color:"#ffb8b8"}}>{source.error}</div>}</div><div style={{textAlign:"right",minWidth:100,fontSize:12}}><strong>{source.status||"Not checked"}</strong><div style={styles.muted}>{source.candidateCount??0} candidates</div></div></div>)}</div></details>
   <details><summary style={{cursor:"pointer",fontSize:13,fontWeight:800}}>Crawler source-engine health ({crawlerEngines.length})</summary><div style={{display:"grid",gap:7,marginTop:10}}>{crawlerEngines.map(engine=><div key={engine.engine} style={{borderTop:"1px solid #344255",paddingTop:8,display:"grid",gridTemplateColumns:"minmax(140px,1fr) auto",gap:10,alignItems:"start"}}><div><strong style={{fontSize:13}}>{(crawlerProvision.find(item=>item.engine===engine.engine)||{}).label||engine.engine}</strong><div style={styles.muted}>Last checked: {dateLabel(engine.finished_at)}</div>{engine.error_message&&<div style={{fontSize:12,color:"#ffcf88"}}>{engine.error_message}</div>}</div><div style={{textAlign:"right",fontSize:12}}><strong style={{color:engine.status==="success"?"#8de0b7":engine.status==="partial"?"#ffcf88":"#ffb8b8"}}>{engine.status==="success"?"Completed":engine.status==="partial"?"Partial":"Failed"}</strong><div style={styles.muted}>{engine.configured} configured · {engine.items_seen} found</div></div></div>)}</div></details>
   <details>
    <summary style={{cursor:"pointer",fontSize:14,fontWeight:800}}>Engine provision panel — funding resources ({crawlerProvision.length} engines)</summary>
    <div style={{...styles.muted,marginTop:8}}>Configured public-source registry. Each entry shows the discovery source and latest recorded health. A source listing is not proof that it has an active call or that IRPA is eligible; verify every lead against the official call.</div>
    <div style={{display:"grid",gap:8,marginTop:10}}>
     {crawlerProvision.map(provision=>{
      const run=crawlerEngines.find(item=>item.engine===provision.engine);
      const status=run?.status||"not_run";
      const statusLabel=status==="success"?"Completed":status==="partial"?"Partial":status==="failed"?"Failed":Number(provision.configured??(provision.sources||[]).length)>0?"Configured":"Not configured";
      const statusColor=status==="success"?"#8de0b7":status==="partial"?"#ffcf88":status==="failed"?"#ffb8b8":Number(provision.configured??(provision.sources||[]).length)>0?"#8bd3e6":"#aab6c5";
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
    <div><div style={styles.eyebrow}>IRPA-DBGS · APPLICATION PREPARATION</div><h2 id="concept-workspace-heading" style={{fontSize:21,margin:"5px 0"}}>AI eligibility & concept-note workspace</h2><p style={{...styles.muted,margin:0}}>Eligibility findings are advisory and do not block drafting. Closed or expired calls are blocked; an unverified current status is flagged for review before submission.</p></div>
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
     <button type="button" disabled={draftSaving||!text(conceptDraft||analysisResult?.concept_note?.draft)} style={{...styles.button,opacity:draftSaving?0.6:1}} onClick={saveConceptDraft}>{draftSaving?"Saving draft…":"Save draft to IRPA workspace"}</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={downloadConceptDraft}>Download .txt for DBGS Documents</button>
     <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>{if(!navigator.clipboard?.writeText){setError("Clipboard access is unavailable in this browser.");return;}navigator.clipboard.writeText(conceptDraft||analysisResult?.concept_note?.draft||"").then(()=>setWorkspaceNotice("Concept-note text copied to clipboard.")).catch(()=>setError("Clipboard access was blocked by the browser."));}}>Copy concept-note text</button>
    </div>
   </section>}
   <section style={{display:"grid",gap:8}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}><h3 style={{fontSize:16,margin:0}}>My saved concept-note drafts</h3><span style={styles.muted}>{savedDrafts.length} saved</span></div>
    {draftsBusy&&<div style={styles.muted}>Loading drafts from the IRPA workspace…</div>}
    {!draftsBusy&&!savedDrafts.length&&<div style={styles.muted}>No saved drafts yet. Screen a grant, generate a concept note and save the draft here.</div>}
    {savedDrafts.map(draft=><div key={draft.id} style={{border:"1px solid #344255",borderRadius:10,padding:11,display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}><div><strong style={{fontSize:13}}>{draft.name||draft.opportunity?.title||"Untitled concept note"}</strong><div style={styles.muted}>Status: {draft.status||"draft"} · Updated: {dateLabel(draft.updated_at||draft.updatedAt||draft.created_at)}</div></div><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>openSavedConceptDraft(draft)}>Open draft</button></div>)}
   </section>
   <section style={{...styles.card,display:"grid",gap:9}}>
    <div><strong style={{fontSize:14}}>Draft audit trail</strong><p style={{...styles.muted,margin:"4px 0"}}>Append-only audit events record when this draft was created or updated, without copying the full concept-note text into the event log.</p></div>
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
   <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Governance control:</strong> saved drafts remain drafts in the IRPA workspace. Saving does not submit an application, approve expenditure, authorize a commitment, or replace IRPA's formal internal review and approval procedures.</div>
  </section>}

  <FundraisingSourceRegistry onResearchSource={(source)=>{const query=source.name+" CSR ESG funding partnership";setFundraisingQuery(query);setFundraisingMode("corporate_support");runFundraisingSearch(query,"corporate_support");}} />
  <section style={{...styles.card,display:"grid",gap:12,borderColor:"#4e8b91"}} aria-labelledby="grant-fundraising-search-heading">
   <div><div style={styles.eyebrow}>FUNDRAISING INTELLIGENCE · LIVE PUBLIC-WEB SEARCH</div><h2 id="grant-fundraising-search-heading" style={{margin:"5px 0",fontSize:20}}>Research funding, donors and partnership leads</h2><p style={{...styles.muted,margin:0}}>Search live public indexes for grants, rolling opportunities, deadline-based calls, corporate social responsibility (CSR), sponsorship, philanthropy, partnerships, fellowships and in-kind support. Results are research leads—not verified offers or proof of eligibility.</p></div>
   <form onSubmit={e=>{e.preventDefault();runFundraisingSearch();}} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:9}}>
    <input aria-label="Fundraising research keywords" style={styles.input} value={fundraisingQuery} onChange={e=>setFundraisingQuery(e.target.value)} placeholder="e.g. seed funding, rolling grants, rangeland restoration, livestock markets, women and youth"/>
    <select aria-label="Fundraising opportunity type" style={styles.input} value={fundraisingMode} onChange={e=>setFundraisingMode(e.target.value)}><option value="all">All fundraising leads</option><option value="rolling">Rolling / year-round</option><option value="deadlines">Calls with deadlines</option><option value="corporate_support">CSR / corporate / in-kind</option></select>
    <button type="submit" style={styles.button} disabled={fundraisingSearchBusy}>{fundraisingSearchBusy?"Searching…":"Search public web"}</button>
   </form>
   <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{["sustainable rangeland restoration Tanzania","pastoral livelihoods climate resilience","livestock health veterinary fodder banks","livestock market access value addition","women youth green enterprises","CSR sponsorship water solar","digital governance nonprofit technology","rolling grants Tanzania NGOs"].map(q=><button key={q} type="button" style={{...styles.button,background:"transparent",fontSize:12,padding:"7px 10px"}} onClick={()=>setFundraisingQuery(q)}>{q}</button>)}</div>
   {fundraisingSearchError&&<div role="alert" style={{...styles.card,borderColor:"#b65c5c",color:"#ffb8b8"}}>{fundraisingSearchError}</div>}
   {fundraisingSearchMeta&&<div aria-live="polite" style={styles.muted}>Found {fundraisingSearchMeta.resultCount} research lead{fundraisingSearchMeta.resultCount===1?"":"s"} using {(fundraisingSearchMeta.providers||[]).join(" and ")||"public search sources"}. Each lead requires source and eligibility verification.</div>}
   {fundraisingSearchMeta?.errors?.length>0&&<div style={{...styles.card,borderStyle:"dashed"}}><strong>Some search sources did not respond</strong><p style={{...styles.muted,margin:"5px 0 0"}}>{fundraisingSearchMeta.errors.map(e=>e.provider+": "+e.error).join(" · ")}</p></div>}
   {fundraisingResults.map((lead,index)=><article key={lead.url||lead.title+index} style={{...styles.card,display:"grid",gap:8}}><details><summary style={{cursor:"pointer",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:10,alignItems:"start"}}><div style={{minWidth:0}}><div style={styles.eyebrow}>{text(lead.fundraisingType)} · {text(lead.sourceName||lead.discoveryEngine)}</div><strong style={{display:"block",fontSize:15,marginTop:4}}>{lead.title}</strong><p style={{...styles.muted,margin:"5px 0"}}>{text(lead.description).slice(0,180)||"Open to review source details."}</p><span style={{...styles.muted,fontSize:12}}>Expand for full details and actions</span></div><div style={{fontSize:12,minWidth:0,textAlign:"right"}}><div style={styles.muted}>Indexed</div><strong>{dateLabel(lead.publishedAt)}</strong><div style={{...styles.muted,marginTop:5}}>Status</div><strong>Unverified</strong></div></summary><div style={{display:"grid",gap:8,marginTop:12,borderTop:"1px solid var(--border-color, #344255)",paddingTop:12}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"start"}}><div style={{flex:"1 1 300px"}}><div style={styles.eyebrow}>{text(lead.fundraisingType)} · {text(lead.sourceName||lead.discoveryEngine)}</div><strong style={{display:"block",fontSize:15,marginTop:4}}>{lead.title}</strong><p style={{...styles.muted,margin:"5px 0"}}>{text(lead.description).slice(0,420)||"The search result contains limited detail; open the source to inspect the original information."}</p></div><div style={{fontSize:12,minWidth:150}}><div style={styles.muted}>Date indexed</div><strong>{dateLabel(lead.publishedAt)}</strong><div style={{...styles.muted,marginTop:5}}>Status</div><strong>Unverified research lead</strong></div></div>
    <div style={{...styles.muted,fontSize:12}}>{text(lead.deadlineSignal)} · Relevance score: {Number(lead.relevanceScore||0)}</div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={styles.button} onClick={()=>useFundraisingLeadInAssistant(lead)}>Analyse with AI Assistant</button>{lead.url&&<a href={lead.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>Open result ↗</a>}{lead.sourceUrl&&lead.sourceUrl!==lead.url&&<a href={lead.sourceUrl} target="_blank" rel="noreferrer" style={{...styles.button,background:"transparent",textDecoration:"none",display:"inline-block"}}>Open publisher ↗</a>}</div>
   </div></details></article>)}
  </section>
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
    {smartAssistantResults.map(r=><article key={r.id} style={{...styles.card,display:"grid",gap:7}}><details><summary style={{cursor:"pointer",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:10,alignItems:"start"}}><div style={{minWidth:0}}><div style={styles.eyebrow}>{r.funder||"Funder not verified"} · Open call</div><strong style={{display:"block",fontSize:15,marginTop:4}}>{r.title}</strong><p style={{...styles.muted,margin:"5px 0"}}>{text(r.summary||r.description).slice(0,180)||"No description supplied."}</p><span style={{...styles.muted,fontSize:12}}>Expand for full details and actions</span></div><div style={{fontSize:12,minWidth:0,textAlign:"right"}}><div style={styles.muted}>Deadline</div><strong>{dateLabel(r.deadline||r.deadline_at)}</strong><div style={{...styles.muted,marginTop:5}}>Keyword score</div><strong>{r._smartScore}</strong></div></summary><div style={{display:"grid",gap:8,marginTop:12,borderTop:"1px solid var(--border-color, #344255)",paddingTop:12}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"start"}}>
      <div style={{flex:"1 1 300px"}}><div style={styles.eyebrow}>{r.funder||"Funder not verified"} · Open call</div><strong style={{display:"block",fontSize:15,marginTop:4}}>{r.title}</strong><p style={{...styles.muted,margin:"5px 0"}}>{text(r.summary||r.description).slice(0,320)||"No description supplied."}</p></div>
      <div style={{fontSize:12,minWidth:105}}><div style={styles.muted}>Deadline</div><strong>{dateLabel(r.deadline||r.deadline_at)}</strong><div style={{...styles.muted,marginTop:5}}>Keyword score: {r._smartScore}</div></div>
     </div>
     <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{r._matchedKeywords.map(term=><span key={term} style={styles.tag}>{term}</span>)}</div>
     <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>openConceptWorkspace(r)}>Screen call with AI Assistant</button>
      {r.url&&<a href={r.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>Open original call ↗</a>}
     </div>
    </div></details></article>)}
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
   {loading&&crawlerResultsBusy?<div style={styles.card} role="status">Loading live opportunity records and Cloudflare crawler results…</div>:filtered.length===0?<div style={styles.card}><strong>No matching opportunities yet</strong><p style={styles.muted}>No records currently match these filters. The dashboard checks both manually registered opportunities and Cloudflare crawler results. Refresh results or run a scan if authorized, then verify each call against the donor’s official guidance.</p></div>:filtered.map(r=><article key={r.id} style={styles.card}><details><summary style={{cursor:"pointer",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:10,alignItems:"start"}}><div style={{minWidth:0}}><div style={styles.eyebrow}>{r.funder||"Funder not specified"} · {r.verificationStatus||"Verification status unavailable"}{r.discoveryEngine&&r.discoveryEngine!=="unknown"?" · Found by "+r.discoveryEngine.replace(/_/g," "):""}{r.fitScore!==undefined?" · IRPA topic fit "+r.fitScore+"/100":""}</div><strong style={{display:"block",fontSize:17,margin:"7px 0"}}>{r.title}</strong><p style={{...styles.muted,margin:"0 0 5px"}}>{text(r.summary||"No summary provided.").slice(0,200)}</p><span style={{...styles.muted,fontSize:12}}>Expand for full record, eligibility screening and source links</span></div><div style={{fontSize:12,textAlign:"right"}}><div style={{color:"#9fb0c3"}}>Deadline</div><strong>{dateLabel(r.deadline)}</strong><div style={{marginTop:8,color:"#9fb0c3"}}>Status</div><strong>{r.status||"Unclassified"}</strong></div></summary><div style={{display:"grid",gap:9,marginTop:12,borderTop:"1px solid var(--border-color, #344255)",paddingTop:12}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
     <div style={{flex:"1 1 380px"}}><div style={styles.eyebrow}>{r.funder||"Funder not specified"} · {r.verificationStatus||"Verification status unavailable"}{r.discoveryEngine&&r.discoveryEngine!=="unknown"?" · Found by "+r.discoveryEngine.replace(/_/g," "):""}{r.fitScore!==undefined?" · IRPA topic fit "+r.fitScore+"/100":""}</div><h3 style={{fontSize:18,margin:"7px 0"}}>{r.title}</h3><p style={{...styles.muted,margin:"0 0 10px"}}>{r.summary||"No summary provided."}</p></div>
     <div style={{minWidth:150}}><div style={{fontSize:12,color:"#9fb0c3"}}>Deadline</div><strong>{dateLabel(r.deadline)}</strong><div style={{fontSize:12,marginTop:8,color:"#9fb0c3"}}>Status</div><strong>{r.status||"Unclassified"}</strong></div>
    </div>
    <div style={{display:"flex",gap:5,flexWrap:"wrap",margin:"8px 0"}}>{cleanArray(r.pillars).map(id=><span key={id} style={styles.tag}>{PILLARS.find(p=>p.id===id)?.label||id}</span>)}{cleanArray(r.themes).map(id=><span key={id} style={{...styles.tag,borderColor:"#6c5b8f"}}>{THEMES.find(t=>t.id===id)?.label||id}</span>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}><span style={styles.muted}>Geography: {r.country||"Not specified"} · Funding: {r.amount||"Not specified"} · Updated: {dateLabel(r.updatedAt||r.createdAt)}{r.sourceUrl&&r.sourceUrl!==r.url?" · Discovery source recorded":""}</span><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>openConceptWorkspace(r)}>Screen eligibility / draft</button><a href={r.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>{r.sourceType==="Cloudflare crawler"?"Open discovered call/source ↗":"Open official call ↗"}</a>{r.sourceUrl&&r.sourceUrl!==r.url&&<a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{...styles.button,background:"transparent",textDecoration:"none",display:"inline-block"}}>Discovery source ↗</a>}{canManage&&r.sourceType!=="Cloudflare crawler"&&<select aria-label={"Update status for "+r.title} style={{...styles.input,width:"auto"}} value={r.status||"Open"} onChange={e=>changeStatus(r,e.target.value)}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select>}</div></div>
   </div></details></article>)}
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
  <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Live-data status:</strong> manually registered opportunities continue to come from the IRPA register; crawler-discovered records are retrieved from the canonical Cloudflare Worker and its existing Firestore register. Crawler leads are marked pending verification and do not establish legal eligibility or donor approval.</div>
 </div>;
}
function dateMillis(v){if(!v)return 0;const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();}
