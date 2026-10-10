import React,{useEffect,useState} from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";

const PUBLIC_ITEMS_LIMIT = 5;
const safePublicUrl = value => {
  const url = String(value || "").trim();
  return /^https:\/\//i.test(url) ? url : "";
};
const displayDate = value => {
  if (!value) return "Date to be announced";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
};

function PublicList({title,description,items,emptyText,kind}) {
  return <section className="public-info-section" aria-labelledby={"public-info-"+kind}>
    <div className="public-info-section-heading"><h3 id={"public-info-"+kind}>{title}</h3><p>{description}</p></div>
    {items.length ? <div className="public-info-list">{items.map(item=>{
      const link=safePublicUrl(item.publicUrl||item.documentUrl||item.url);
      return <article className="public-info-item" key={item.id}>
        <div className="public-info-item-icon" aria-hidden="true"><i className={"fa-solid "+(kind==="reports"?"fa-file-lines":"fa-calendar-days")}/></div>
        <div className="public-info-item-copy"><h4>{item.title|| (kind==="reports"?"Public report":"Public event")}</h4>
          <p>{item.summary||item.description||"Published by Improvement of Rangeland in Pastoral Areas (IRPA)."}</p>
          <small>{kind==="reports"?(item.reportDate?displayDate(item.reportDate):"Public publication"):[displayDate(item.date),item.venue].filter(Boolean).join(" · ")}</small>
        </div>
        {link ? <a className="public-info-open" href={link} target="_blank" rel="noopener noreferrer">{kind==="reports"?"Open report":"Event details"} <span aria-hidden="true">↗</span></a> : <span className="public-info-unavailable">Details coming soon</span>}
      </article>;
    })}</div> : <div className="public-info-empty">{emptyText}</div>}
  </section>;
}

export default function PublicInformationPanel(){
  const [memberStats,setMemberStats]=useState(null);
  const [reports,setReports]=useState([]);
  const [meetings,setMeetings]=useState([]);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState(false);

  useEffect(()=>{
    let active=true;
    async function loadPublicInformation(){
      setLoading(true);setLoadError(false);
      const results=await Promise.allSettled([
        getDoc(doc(db,"publicStats","memberCounters")),
        getDocs(query(collection(db,"publicReports"),where("published","==",true),where("visibility","==","PUBLIC"),orderBy("publishedAt","desc"),limit(PUBLIC_ITEMS_LIMIT))),
        getDocs(query(collection(db,"publicMeetings"),where("published","==",true),where("visibility","==","PUBLIC"),orderBy("publishedAt","desc"),limit(PUBLIC_ITEMS_LIMIT)))
      ]);
      if(!active)return;
      const [statsResult,reportsResult,meetingsResult]=results;
      if(statsResult.status==="fulfilled"&&statsResult.value.exists()){
        const data=statsResult.value.data();
        setMemberStats({activeMembers:Number.isInteger(data.activeMembers)&&data.activeMembers>=0?data.activeMembers:null,boardMembers:Number.isInteger(data.boardMembers)&&data.boardMembers>=0?data.boardMembers:null});
      }else setMemberStats(null);
      if(reportsResult.status==="fulfilled")setReports(reportsResult.value.docs.map(d=>({id:d.id,...d.data()})));
      else setReports([]);
      if(meetingsResult.status==="fulfilled")setMeetings(meetingsResult.value.docs.map(d=>({id:d.id,...d.data()})));
      else setMeetings([]);
      setLoadError(results.some(result=>result.status==="rejected"));
      setLoading(false);
    }
    loadPublicInformation();
    return ()=>{active=false};
  },[]);

  return <section className="public-information-panel" aria-labelledby="public-information-title">
    <div className="public-info-topline"><span>PUBLIC INFORMATION</span><span className="public-info-readonly"><i className="fa-solid fa-lock-open" aria-hidden="true"/> Public read-only access</span></div>
    <div className="public-info-intro"><div><h2 id="public-information-title">Explore IRPA</h2><p>Access approved public information from Improvement of Rangeland in Pastoral Areas. Private governance records remain protected.</p></div><div className="public-info-brand-mark" aria-hidden="true"><i className="fa-solid fa-earth-africa"/></div></div>
    <div className="public-info-counter-grid" aria-label="Public membership statistics">
      <article className="public-info-counter"><span className="public-info-counter-icon"><i className="fa-solid fa-people-group" aria-hidden="true"/></span><div><small>Active Members</small><strong>{loading?"—":memberStats?.activeMembers==null?"Not published":memberStats.activeMembers.toLocaleString()}</strong><p>Verified aggregate only</p></div></article>
      <article className="public-info-counter"><span className="public-info-counter-icon"><i className="fa-solid fa-landmark" aria-hidden="true"/></span><div><small>Board Members</small><strong>{loading?"—":memberStats?.boardMembers==null?"Not published":memberStats.boardMembers.toLocaleString()}</strong><p>Verified aggregate only</p></div></article>
    </div>
    {loadError&&<div className="public-info-notice" role="status">Some public information could not be loaded. Please retry later; restricted records are not displayed here.</div>}
    <div className="public-info-sections">
      <PublicList title="Public Reports & Publications" description="Reports approved for public release." items={reports} emptyText={loading?"Loading approved reports…":"No public reports have been published yet."} kind="reports"/>
      <PublicList title="Public Meetings & Events" description="Public notices and events approved for public viewing." items={meetings} emptyText={loading?"Loading public events…":"No public meetings or events have been published yet."} kind="meetings"/>
    </div>
    <p className="public-info-footer"><i className="fa-solid fa-shield-halved" aria-hidden="true"/> Public panel shows published information only. Member profiles, board proceedings, attendance, voting, transcripts, financial records and administrator controls are not available here.</p>
  </section>;
}
