import React,{useEffect,useMemo,useState} from "react";
import {addDoc,collection,onSnapshot,serverTimestamp,updateDoc,doc} from "firebase/firestore";
import {auth,db} from "../firebase/config";

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
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [queryText,setQueryText]=useState("");
 const [pillar,setPillar]=useState("all");
 const [theme,setTheme]=useState("all");
 const [status,setStatus]=useState("all");
 const [showForm,setShowForm]=useState(false);
 const [saving,setSaving]=useState(false);
 const [activeEnquiry,setActiveEnquiry]=useState(null);
 const [enquirySaving,setEnquirySaving]=useState(false);
 const [enquiryMessage,setEnquiryMessage]=useState("");
 const [enquiryDraft,setEnquiryDraft]=useState({contactName:"",contactEmail:"",contactRole:"",questions:"",notes:""});
 const [draft,setDraft]=useState({title:"",funder:"",url:"",deadline:"",country:"Tanzania",amount:"",summary:"",status:"Open",pillars:["rangeland"],themes:[],eligibleCountries:"",eligibleApplicantTypes:"",minimumOperatingYears:"",requiresPriorProjects:null,requiresAuditedAccounts:null,requiresCofunding:null,cofundingDetails:"",requiredDocuments:"",applicationRequirements:"",applicationMethod:"Not specified",funderContactEmail:"",eligibilityNotes:""});
 const uid=auth.currentUser?.uid||"";
 const roleList=[profile?.role,profile?.roles,employee?.role,employee?.roles].flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim().toLowerCase());
 const canManage=isAdmin||roleList.some(r=>["administrator","executive director","director outreach","director finance & administration","director research","research director","research manager","fundraising officer","research officer"].includes(r));
 useEffect(()=>onSnapshot(collection(db,"grantOpportunities"),snap=>{
   const next=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMillis(b.createdAt)-dateMillis(a.createdAt));
   setRecords(next);setLoading(false);setError("");
 },err=>{console.error("Grant opportunity subscription failed",err);setError("Grant records could not be loaded. Check your signed-in profile's Firestore access.");setLoading(false)}),[]);
 const filtered=useMemo(()=>records.filter(r=>{
   const hay=[r.title,r.funder,r.summary,r.country,r.amount].join(" ").toLowerCase();
   return (!queryText||hay.includes(queryText.toLowerCase()))&&(pillar==="all"||cleanArray(r.pillars).includes(pillar))&&(theme==="all"||cleanArray(r.themes).includes(theme))&&(status==="all"||r.status===status);
 }),[records,queryText,pillar,theme,status]);
 const counts=useMemo(()=>({open:records.filter(r=>r.status==="Open").length,review:records.filter(r=>["Under review","Application in progress"].includes(r.status)).length,submitted:records.filter(r=>["Submitted","Awarded"].includes(r.status)).length}),[records]);
 async function saveOpportunity(e){
   e.preventDefault();if(!canManage){setError("Only designated grant-management and executive roles may publish or update opportunities.");return;}
   if(!text(draft.title)||!text(draft.funder)||!text(draft.url)||!draft.pillars.length){setError("Enter the opportunity title, funder, official source URL and at least one strategic pillar.");return;}
   try{
     setSaving(true);setError("");
     const payload={...draft,title:text(draft.title),funder:text(draft.funder),url:text(draft.url),summary:text(draft.summary),country:text(draft.country)||"Not specified",amount:text(draft.amount)||"Not specified",deadline:draft.deadline||null,minimumOperatingYears:draft.minimumOperatingYears===""?null:Number(draft.minimumOperatingYears),eligibleCountries:splitList(draft.eligibleCountries),eligibleApplicantTypes:splitList(draft.eligibleApplicantTypes),requiredDocuments:splitList(draft.requiredDocuments),applicationRequirements:text(draft.applicationRequirements),applicationMethod:text(draft.applicationMethod)||"Not specified",funderContactEmail:text(draft.funderContactEmail),eligibilityNotes:text(draft.eligibilityNotes),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdByUid:uid,createdByEmail:auth.currentUser?.email||"",verificationStatus:"Pending verification",sourceType:"Official source URL",recordOrigin:"PRODUCTION"};
     await addDoc(collection(db,"grantOpportunities"),payload);
     setDraft({title:"",funder:"",url:"",deadline:"",country:"Tanzania",amount:"",summary:"",status:"Open",pillars:["rangeland"],themes:[],eligibleCountries:"",eligibleApplicantTypes:"",minimumOperatingYears:"",requiresPriorProjects:null,requiresAuditedAccounts:null,requiresCofunding:null,cofundingDetails:"",requiredDocuments:"",applicationRequirements:"",applicationMethod:"Not specified",funderContactEmail:"",eligibilityNotes:""});setShowForm(false);setNotice("Opportunity saved. It is marked Pending verification until checked against the donor's official call.");setTimeout(()=>setNotice(""),7000);
   }catch(err){console.error(err);setError(err?.message||"Could not save the opportunity. Check the deployed Firestore rules.");}
   finally{setSaving(false);}
 }
 function eligibilityFor(record){
   const checks=[];
   const applicantTypes=cleanArray(record.eligibleApplicantTypes);
   const typeText=applicantTypes.join(" ").toLowerCase();
   if(applicantTypes.length){
     const acceptsNgo=/ngo|non.?profit|civil society|cs[o]?|charit|not.?for.?profit|community.?based/.test(typeText);
     checks.push({label:"Applicant legal type",state:acceptsNgo?"pass":"unknown",detail:acceptsNgo?"Call lists applicant types compatible with an NGO; confirm the exact legal definition in the official guidelines.":"The listed applicant types do not clearly confirm that a Tanzanian NGO may apply."});
   }else checks.push({label:"Applicant legal type",state:"unknown",detail:"The call's eligible applicant types have not been recorded."});
   const countries=cleanArray(record.eligibleCountries);
   if(countries.length){
     const geography=countries.join(" ").toLowerCase();
     const acceptsTanzania=/tanzania|east africa|africa|global|worldwide|international|all countr/.test(geography);
     checks.push({label:"Geographic eligibility",state:acceptsTanzania?"pass":"fail",detail:acceptsTanzania?"Recorded eligible geography appears to include Tanzania; verify any district or target-population restrictions.":"Recorded eligible geography does not include Tanzania."});
   }else checks.push({label:"Geographic eligibility",state:"unknown",detail:"Eligible countries or regions have not been recorded."});
   if(Number.isFinite(Number(record.minimumOperatingYears))&&record.minimumOperatingYears!==null&&record.minimumOperatingYears!==""){
     const years=(Date.now()-new Date("2023-12-11T00:00:00Z").getTime())/(365.25*24*60*60*1000);
     const required=Number(record.minimumOperatingYears);
     checks.push({label:"Organizational operating history",state:years>=required?"pass":"fail",detail:"IRPA was registered on 11 December 2023 (approximately "+years.toFixed(1)+" years by today's date); the call records a minimum of "+required+" years."});
   }else checks.push({label:"Organizational operating history",state:"unknown",detail:"No minimum operating-history rule has been recorded."});
   if(record.requiresPriorProjects===true)checks.push({label:"Previous project implementation",state:"fail",detail:"IRPA has not yet implemented a project; this call is recorded as requiring prior project experience."});
   else if(record.requiresPriorProjects===false)checks.push({label:"Previous project implementation",state:"pass",detail:"No mandatory prior-project requirement is recorded; verify the full guidelines and scoring criteria."});
   else checks.push({label:"Previous project implementation",state:"unknown",detail:"Whether prior project implementation is mandatory has not been checked."});
   if(record.requiresAuditedAccounts===true)checks.push({label:"Audited accounts",state:"unknown",detail:"The call requires audited accounts. IRPA's available financial records must be checked before eligibility can be confirmed."});
   else if(record.requiresAuditedAccounts===false)checks.push({label:"Audited accounts",state:"pass",detail:"No mandatory audited-account requirement is recorded; verify the call's financial due-diligence rules."});
   else checks.push({label:"Audited accounts",state:"unknown",detail:"Financial-statement and audit requirements have not been confirmed."});
   if(record.requiresCofunding===true)checks.push({label:"Co-financing / matching funds",state:"fail",detail:"The call requires co-financing, while IRPA currently has no project funds confirmed. Ask whether in-kind contributions or a consortium route are permitted."});
   else if(record.requiresCofunding===false)checks.push({label:"Co-financing / matching funds",state:"pass",detail:"No mandatory co-financing requirement is recorded; check the official call."});
   else checks.push({label:"Co-financing / matching funds",state:"unknown",detail:"Co-financing requirements have not been confirmed."});
   const fails=checks.filter(c=>c.state==="fail"),unknowns=checks.filter(c=>c.state==="unknown");
   const verdict=fails.length?"Potentially ineligible":unknowns.length?"Needs verification":"Potentially eligible";
   return {checks,verdict,summary:fails.length?fails.length+" possible disqualifying condition(s) need review.":unknowns.length?unknowns.length+" eligibility item(s) remain unverified.":"Recorded criteria show a possible fit, subject to checking the official guidelines."};
 }
 function beginEnquiry(record){
   const assessment=eligibilityFor(record);
   const questions=[
     "Please confirm whether Improvement of Rangeland in Pastoral Areas (IRPA), a Tanzanian-registered NGO established on 11 December 2023, is eligible to apply under this call.",
     "Does the call require a minimum number of years of operation or previously completed projects? IRPA is newly established and has not yet implemented a funded project.",
     "Which financial statements, audits, bank documents and organizational policies are mandatory at application and award stages?",
     "Is cash co-financing mandatory, and can in-kind contributions or consortium applications satisfy any matching requirement?",
     "Please confirm the eligible project duration, funding range, eligible costs, geographic scope, required attachments, submission route and exact deadline/time zone."
   ];
   if(record.requiresPriorProjects===true)questions.splice(1,1,"The call appears to require previous project experience. Can a newly registered NGO apply as a consortium member or through an eligible lead partner?");
   if(record.requiresCofunding===true)questions.splice(3,1,"The call appears to require co-financing. Are in-kind contributions, a consortium arrangement or a waiver permitted for a newly established NGO?");
   setEnquiryDraft({contactName:profile?.name||employee?.name||"",contactEmail:auth.currentUser?.email||"",contactRole:profile?.role||employee?.role||"",questions:questions.join("\n\n"),notes:"Please refer to the official call: "+(record.url||"")});
   setActiveEnquiry({...record,assessment});setEnquiryMessage("");
 }
 async function submitEnquiry(e){
   e.preventDefault();if(!activeEnquiry||!uid)return;
   if(!text(enquiryDraft.contactName)||!text(enquiryDraft.contactEmail)||!text(enquiryDraft.questions)){setEnquiryMessage("Please enter your name, email and enquiry questions.");return;}
   try{
     setEnquirySaving(true);setEnquiryMessage("");
     await addDoc(collection(db,"grantEnquiries"),{opportunityId:activeEnquiry.id,opportunityTitle:activeEnquiry.title,funder:activeEnquiry.funder||"",officialCallUrl:activeEnquiry.url||"",eligibilityAssessment:activeEnquiry.assessment,contactName:text(enquiryDraft.contactName),contactEmail:text(enquiryDraft.contactEmail),contactRole:text(enquiryDraft.contactRole),questions:text(enquiryDraft.questions),notes:text(enquiryDraft.notes),createdByUid:uid,createdByEmail:auth.currentUser?.email||"",status:"Draft — not sent to funder",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
     setEnquiryMessage("Enquiry saved in IRPA-DBGS. It has not been emailed to the funder; review and send it through the call's official contact channel.");
   }catch(err){console.error(err);setEnquiryMessage(err?.message||"Could not save enquiry. Check your profile permissions.");}
   finally{setEnquirySaving(false);}
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
   <div style={{border:"1px solid #425064",borderRadius:10,padding:12,display:"grid",gap:10}}><h3 style={{margin:0,fontSize:15}}>Eligibility and application requirements (from official call)</h3><p style={styles.muted}>Enter only conditions confirmed in the donor's guidelines. Leave unknown criteria unconfirmed so the portal flags them for verification.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
     <label style={{fontSize:12}}>Eligible applicant types (separate with semicolons)<textarea rows="2" style={{...styles.input,marginTop:5}} value={draft.eligibleApplicantTypes} onChange={e=>setDraft(d=>({...d,eligibleApplicantTypes:e.target.value}))}/></label>
     <label style={{fontSize:12}}>Eligible countries / regions (separate with semicolons)<textarea rows="2" style={{...styles.input,marginTop:5}} value={draft.eligibleCountries} onChange={e=>setDraft(d=>({...d,eligibleCountries:e.target.value}))}/></label>
     <label style={{fontSize:12}}>Minimum operating years (blank if unknown)<input type="number" min="0" step="0.5" style={{...styles.input,marginTop:5}} value={draft.minimumOperatingYears} onChange={e=>setDraft(d=>({...d,minimumOperatingYears:e.target.value}))}/></label>
     <label style={{fontSize:12}}>Application method<input style={{...styles.input,marginTop:5}} value={draft.applicationMethod} onChange={e=>setDraft(d=>({...d,applicationMethod:e.target.value}))} placeholder="Portal / email / expression of interest"/></label>
     <label style={{fontSize:12}}>Funder enquiry email (if published)<input type="email" style={{...styles.input,marginTop:5}} value={draft.funderContactEmail} onChange={e=>setDraft(d=>({...d,funderContactEmail:e.target.value}))}/></label>
     <label style={{fontSize:12}}>Required documents (separate with semicolons)<textarea rows="3" style={{...styles.input,marginTop:5}} value={draft.requiredDocuments} onChange={e=>setDraft(d=>({...d,requiredDocuments:e.target.value}))}/></label>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>{[["requiresPriorProjects","Prior project experience"],["requiresAuditedAccounts","Audited accounts"],["requiresCofunding","Cash co-financing / matching funds"]].map(([key,label])=><label key={key} style={{fontSize:12}}>{label}<select style={{...styles.input,marginTop:5}} value={draft[key]===true?"yes":draft[key]===false?"no":""} onChange={e=>setDraft(d=>({...d,[key]:e.target.value===""?null:e.target.value==="yes"}))}><option value="">Not verified in call</option><option value="yes">Mandatory</option><option value="no">Not mandatory</option></select></label>)}</div>
    <label style={{fontSize:12}}>Co-financing notes<textarea rows="2" style={{...styles.input,marginTop:5}} value={draft.cofundingDetails} onChange={e=>setDraft(d=>({...d,cofundingDetails:e.target.value}))}/></label>
    <label style={{fontSize:12}}>Other application requirements<textarea rows="3" style={{...styles.input,marginTop:5}} value={draft.applicationRequirements} onChange={e=>setDraft(d=>({...d,applicationRequirements:e.target.value}))} placeholder="Project duration, page limits, eligible costs, partnership, language, submission deadline/time zone…"/></label>
    <label style={{fontSize:12}}>Eligibility caveats / source paragraph references<textarea rows="2" style={{...styles.input,marginTop:5}} value={draft.eligibilityNotes} onChange={e=>setDraft(d=>({...d,eligibilityNotes:e.target.value}))}/></label>
   </div>
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
    {(()=>{const a=eligibilityFor(r);return <div style={{margin:"10px 0",padding:12,border:"1px solid "+(a.verdict==="Potentially ineligible"?"#b65c5c":a.verdict==="Potentially eligible"?"#32846d":"#b78b3d"),borderRadius:10}}><div style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:"uppercase"}}>IRPA eligibility screening · {a.verdict}</div><p style={{...styles.muted,margin:"5px 0"}}>{a.summary} This is a preliminary rule-based screen, not a donor decision.</p><details><summary style={{cursor:"pointer",fontSize:12,fontWeight:700}}>View eligibility checks</summary><ul style={{paddingLeft:20,fontSize:12,lineHeight:1.6}}>{a.checks.map((c,i)=><li key={i}><strong>{c.state==="pass"?"Potential match":c.state==="fail"?"Potential blocker":"Needs checking"} — {c.label}:</strong> {c.detail}</li>)}</ul></details></div>})()}
    {(cleanArray(r.requiredDocuments).length>0||r.applicationRequirements)&&<details style={{margin:"8px 0"}}><summary style={{cursor:"pointer",fontSize:13,fontWeight:700}}>Application requirements and document checklist</summary><div style={{padding:10,fontSize:12,lineHeight:1.6}}>{r.applicationRequirements&&<p style={{whiteSpace:"pre-wrap"}}>{r.applicationRequirements}</p>}{r.applicationMethod&&<p><strong>Submission method:</strong> {r.applicationMethod}</p>}{r.funderContactEmail&&<p><strong>Funder contact:</strong> {r.funderContactEmail}</p>}{r.cofundingDetails&&<p><strong>Co-financing notes:</strong> {r.cofundingDetails}</p>}{cleanArray(r.requiredDocuments).length>0&&<ul>{r.requiredDocuments.map((d,i)=><li key={i}>{d}</li>)}</ul>}{r.eligibilityNotes&&<p><strong>Eligibility notes:</strong> {r.eligibilityNotes}</p>}</div></details>}
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}><span style={styles.muted}>Geography: {r.country||"Not specified"} · Funding: {r.amount||"Not specified"} · Updated: {dateLabel(r.updatedAt||r.createdAt)}</span><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a href={r.url} target="_blank" rel="noreferrer" style={{...styles.button,textDecoration:"none",display:"inline-block"}}>Open official call ↗</a><button type="button" style={{...styles.button,background:"#6a4b20"}} onClick={()=>beginEnquiry(r)}>Eligibility &amp; tailored enquiry</button>{canManage&&<select aria-label={"Update status for "+r.title} style={{...styles.input,width:"auto"}} value={r.status||"Open"} onChange={e=>changeStatus(r,e.target.value)}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select>}</div></div>
   </article>)}
  </section>
  {activeEnquiry&&<div role="dialog" aria-modal="true" aria-labelledby="grant-enquiry-title" style={{position:"fixed",zIndex:16000,inset:0,overflowY:"auto",background:"#000b",padding:16,display:"grid",placeItems:"center"}}>
   <form onSubmit={submitEnquiry} style={{...styles.card,width:"min(860px,100%)",maxHeight:"calc(100vh - 32px)",overflowY:"auto",boxSizing:"border-box",display:"grid",gap:13}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"}}><div><div style={styles.eyebrow}>IRPA-DBGS · CALL-SPECIFIC WORKSPACE</div><h2 id="grant-enquiry-title" style={{fontSize:21,margin:"6px 0"}}>Eligibility review &amp; tailored funder enquiry</h2><p style={styles.muted}>{activeEnquiry.funder} · {activeEnquiry.title}</p></div><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>setActiveEnquiry(null)}>Close</button></div>
    <div style={{...styles.card,display:"grid",gap:8}}><strong>Preliminary eligibility result: {activeEnquiry.assessment.verdict}</strong><p style={{...styles.muted,margin:0}}>{activeEnquiry.assessment.summary} Review every item and the original call before deciding to apply.</p>{activeEnquiry.assessment.checks.map((c,i)=><div key={i} style={{fontSize:12,lineHeight:1.5,borderTop:"1px solid #344255",paddingTop:7}}><strong>{c.state==="pass"?"Potential match":c.state==="fail"?"Potential blocker":"Needs verification"} · {c.label}</strong><div style={styles.muted}>{c.detail}</div></div>)}</div>
    <div style={{...styles.card,display:"grid",gap:8}}><strong>Application preparation checklist</strong><p style={styles.muted}>Use the official call to verify every item; this list is not a substitute for donor instructions.</p>{(cleanArray(activeEnquiry.requiredDocuments).length?activeEnquiry.requiredDocuments:["Registration certificate","Constitution / governing instrument","Board / governance details","Project concept note and results framework","Activity-based budget and budget narrative","Financial statements and audit information, if required","Safeguarding, procurement, finance and other required policies","Partnership / co-financing evidence, if required"]).map((d,i)=><label key={i} style={{display:"flex",gap:8,alignItems:"start",fontSize:12}}><input type="checkbox"/><span>{d}</span></label>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}><label style={{fontSize:12}}>Enquirer name<input required style={{...styles.input,marginTop:5}} value={enquiryDraft.contactName} onChange={e=>setEnquiryDraft(d=>({...d,contactName:e.target.value}))}/></label><label style={{fontSize:12}}>Reply email<input required type="email" style={{...styles.input,marginTop:5}} value={enquiryDraft.contactEmail} onChange={e=>setEnquiryDraft(d=>({...d,contactEmail:e.target.value}))}/></label><label style={{fontSize:12}}>Role / department<input style={{...styles.input,marginTop:5}} value={enquiryDraft.contactRole} onChange={e=>setEnquiryDraft(d=>({...d,contactRole:e.target.value}))}/></label></div>
    <label style={{fontSize:12}}>Customized questions for the funder<textarea required rows="8" style={{...styles.input,marginTop:5,resize:"vertical"}} value={enquiryDraft.questions} onChange={e=>setEnquiryDraft(d=>({...d,questions:e.target.value}))}/></label>
    <label style={{fontSize:12}}>Additional context / call references<textarea rows="3" style={{...styles.input,marginTop:5,resize:"vertical"}} value={enquiryDraft.notes} onChange={e=>setEnquiryDraft(d=>({...d,notes:e.target.value}))}/></label>
    {enquiryMessage&&<div role="status" style={{...styles.card,borderColor:enquiryMessage.startsWith("Could not")?"#b65c5c":"#32846d"}}>{enquiryMessage}</div>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="submit" disabled={enquirySaving} style={{...styles.button,opacity:enquirySaving?0.6:1}}>{enquirySaving?"Saving enquiry…":"Save enquiry to IRPA-DBGS"}</button><button type="button" style={{...styles.button,background:"transparent"}} onClick={()=>GenUICopy(enquiryDraft.questions)}>Copy enquiry text</button>{activeEnquiry.funderContactEmail&&<a href={"mailto:"+activeEnquiry.funderContactEmail+"?subject="+encodeURIComponent("Eligibility enquiry: "+activeEnquiry.title)+"&body="+encodeURIComponent(enquiryDraft.questions+"\n\n"+enquiryDraft.notes+"\n\nContact: "+enquiryDraft.contactName+" ("+enquiryDraft.contactEmail+")")} style={{...styles.button,textDecoration:"none"}}>Open email draft ↗</a>}</div>
    <p style={styles.muted}>Saving records a draft for internal coordination only. It does not submit a grant application or send an email automatically.</p>
   </form>
  </div>}

  <section style={styles.card}>
   <h2 style={{fontSize:18,marginTop:0}}>Official funding-source directory</h2><p style={styles.muted}>Open the source to verify the current call, eligible applicants, deadlines and original application documents. Source pages are not proof that a call is currently open.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:9}}>{SOURCES.map(s=><a key={s.name} href={s.url} target="_blank" rel="noreferrer" style={{border:"1px solid #425064",borderRadius:9,padding:12,color:"var(--text-primary, #e8edf5)",textDecoration:"none",fontSize:13,fontWeight:650}}>{s.name} ↗</a>)}</div>
  </section>
  <div style={{...styles.muted,borderLeft:"3px solid #b78b3d",padding:"8px 12px"}}><strong>Live-data status:</strong> this portal subscribes to the shared IRPA opportunity register in real time. The source directory supports official verification; automated multi-donor crawling and scheduled ingestion require a separately configured collector and approved source/API access. No sample or unverified record is represented as a confirmed live grant.</div>
 </div>;
}
function splitList(value){return String(value||"").split(";").flatMap(v=>v.split(String.fromCharCode(10))).map(v=>v.trim()).filter(Boolean);}
function GenUICopy(value){if(typeof navigator!=="undefined"&&navigator.clipboard?.writeText)navigator.clipboard.writeText(String(value||"")).catch(()=>{});}
function dateMillis(v){if(!v)return 0;const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();}
