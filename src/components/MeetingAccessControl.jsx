import React,{useEffect,useState}from"react";
import{httpsCallable,getFunctions}from"firebase/functions";
import{getRecords,COLLECTIONS}from"../firebase/data";

export default function MeetingAccessControl({meeting,controller=false}){
 const[rows,setRows]=useState([]),[selected,setSelected]=useState(""),[link,setLink]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{let live=true;(async()=>{try{const all=await getRecords(COLLECTIONS.participants);if(live)setRows(all.filter(x=>x.meetingId===meeting?.id))}catch(e){if(live)setError(e.message||"Unable to load meeting participants.")}})();return()=>{live=false}},[meeting?.id]);
 async function issue(){if(!meeting?.id||!selected)return setError("Select a registered meeting participant first.");setBusy(true);setError("");setMessage("");try{const call=httpsCallable(getFunctions(undefined,"us-central1"),"createMeetingAccessInvitation");const r=await call({meetingId:meeting.id,participantId:selected});const data=r.data||{};const url=new URL(window.location.origin+window.location.pathname);url.searchParams.set("meetingToken",data.accessToken);setLink(url.toString());setMessage("Secure participant-specific meeting link issued. Share it only with the named participant.");}catch(e){setError(e?.message||"Unable to issue the meeting access link.")}finally{setBusy(false)}}
 async function copy(){if(!link)return;await navigator.clipboard?.writeText(link);setMessage("Meeting link copied to the clipboard.");}
 return <section className="panel" style={{marginTop:18}}>
  <div className="panel-header"><div><span className="eyebrow">MEETING ENTRY GATEWAY</span><h2>Invitation Token & Meeting Link</h2><p className="panel-description">Issue a participant-specific bearer token through the server gateway. The token does not replace authentication or meeting-entry authorization.</p></div></div>
  {error&&<div className="error-message action-feedback">{error}</div>}{message&&<div className="success-message action-feedback">{message}</div>}
  <div className="form-grid"><div className="form-field form-field-wide"><label>Registered Participant</label><select value={selected} onChange={e=>setSelected(e.target.value)} disabled={!controller||busy}><option value="">Select participant…</option>{rows.map(p=><option key={p.id} value={p.id}>{p.participantName||p.name||"Participant"} · {p.participantEmail||p.email||"No email"}</option>)}</select></div></div>
  <div className="form-actions"><button type="button" onClick={issue} disabled={!controller||busy||!selected}>{busy?"Issuing secure link…":"Issue Secure Meeting Link"}</button>{link&&<button type="button" className="secondary-button" onClick={copy}>Copy Meeting Link</button>}</div>
  {link&&<div className="form-field form-field-wide" style={{marginTop:12}}><label>Issued Meeting Link</label><input readOnly value={link}/><small className="muted">Token validity: 7 days unless the gateway record is revoked. Entry remains identity-bound.</small></div>}
 </section>;
}
