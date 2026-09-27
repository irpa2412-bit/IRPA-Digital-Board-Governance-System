import React,{useEffect,useState}from"react";
import{createRecord,getRecords,updateRecord}from"../firebase/data";
import{uploadCommunicationMediaAsset}from"../firebase/signatureStorage";
const ROLES=["Communications Officer","Director Outreach","Outreach Director","Director Community Development","Community Development Director","Executive Director"];
const box={background:"rgba(255,255,255,.045)",border:"1px solid rgba(255,255,255,.12)",borderRadius:16,padding:18};
export default function CommunicationMediaPortal({profile,employee,selectedAuthority,admin=false,onNavigate}){
 const role=String(selectedAuthority||profile?.role||"").trim(),ok=admin||ROLES.includes(role);
 const[content,setContent]=useState([]),[requests,setRequests]=useState([]),[assets,setAssets]=useState([]),[events,setEvents]=useState([]),[msg,setMsg]=useState(""),[uploadBusy,setUploadBusy]=useState(false),[assetType,setAssetType]=useState("Photo");
 const[form,setForm]=useState({title:"",type:"News",summary:"",body:"",audience:"Internal",priority:"Normal"});
 useEffect(()=>{let live=true;(async()=>{const r=await Promise.all(["communicationContent","mediaRequests","mediaAssets","communicationEvents"].map(k=>getRecords(k).catch(()=>[])));if(live){setContent(r[0]);setRequests(r[1]);setAssets(r[2]);setEvents(r[3])}})();return()=>{live=false}},[]);
 if(!ok)return <div className="page"><section className="panel"><h1>Communication & Media</h1><p>Access is restricted to authorized communication and management capacities.</p></section></div>;
 async function save(e){e.preventDefault();try{await createRecord("communicationContent",{...form,title:form.title.trim(),summary:form.summary.trim(),body:form.body.trim(),createdByUid:profile?.uid||employee?.uid||null,createdByRole:role,status:"Draft",recordOrigin:"PRODUCTION"});setContent(await getRecords("communicationContent"));setForm({title:"",type:"News",summary:"",body:"",audience:"Internal",priority:"Normal"});setMsg("Draft saved to the controlled editorial pipeline.");}catch(x){setMsg(x.message||"Unable to save draft.");}}
 async function uploadMedia(e){
  const file=e.target.files?.[0];
  e.target.value="";
  if(!file)return;
  setUploadBusy(true);setMsg("");
  try{
    const title=window.prompt("Media asset title",file.name)||file.name;
    const assetId=await createRecord("mediaAssets",{
      title:String(title).trim(),fileName:file.name,assetType,
      mimeType:file.type,fileSize:file.size,status:"Uploading",
      createdByUid:profile?.uid||employee?.uid||null,createdByRole:role,
      recordOrigin:"PRODUCTION"
    });
    try{
      const uploaded=await uploadCommunicationMediaAsset({assetId,title,assetType,file});
      await updateRecord("mediaAssets",assetId,{
        status:"Available",fileId:uploaded.fileId,storageProvider:uploaded.storageProvider||"Google Drive",
        fileSize:uploaded.fileSize||file.size,webViewLink:uploaded.webViewLink||"",
        storagePath:`communication-media/${assetId}/${file.name}`,uploadedAt:new Date().toISOString()
      });
      setMsg("Media asset uploaded to the controlled Communication & Media archive.");
    }catch(uploadError){
      await updateRecord("mediaAssets",assetId,{status:"Upload Failed",uploadError:String(uploadError?.message||"Media upload failed.")});
      throw uploadError;
    }
    setAssets(await getRecords("mediaAssets"));
  }catch(x){setMsg(x.message||"Unable to upload media asset.");}
  finally{setUploadBusy(false);}
}

 async function mediaRequest(){try{const title=window.prompt("Media request title");if(!title)return;await createRecord("mediaRequests",{title:title.trim(),status:"New",priority:"Normal",createdByUid:profile?.uid||employee?.uid||null,createdByRole:role,recordOrigin:"PRODUCTION"});setRequests(await getRecords("mediaRequests"));setMsg("Media request registered.");}catch(x){setMsg(x.message||"Unable to register request.");}}
 return <div className="page" style={{maxWidth:1500,margin:"0 auto"}}>
  <section className="welcome-panel"><div><span className="eyebrow">COMMUNICATION & MEDIA COMMAND CENTRE</span><h1>Communication & Media</h1><p>Newsroom, content production, media relations, events, assets and communication intelligence.</p></div><div className="identity-card"><span>ACTIVE AUTHORITY</span><strong>{admin?"Administrator":role}</strong></div></section>
  <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginTop:14}}>{[["Content",content.length],["Media assets",assets.length],["Media requests",requests.length],["Events",events.length]].map(x=><div key={x[0]} style={box}><strong style={{fontSize:24,display:"block"}}>{x[1]}</strong><small>{x[0]}</small></div>)}</section>
  <section style={{display:"grid",gridTemplateColumns:"minmax(340px,1.15fr) minmax(300px,.85fr)",gap:14,marginTop:14}}>
   <section style={box}><b>CONTENT STUDIO</b><form onSubmit={save} style={{display:"grid",gap:10,marginTop:12}}>
    <input required placeholder="Content title" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
    <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}><option>News</option><option>Press Release</option><option>Field Story</option><option>Publication</option><option>Event Notice</option><option>Campaign</option><option>Internal Notice</option></select>
    <input placeholder="Summary / standfirst" value={form.summary} onChange={e=>setForm(f=>({...f,summary:e.target.value}))}/>
    <textarea required rows="7" placeholder="Draft content" value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))}/>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><select value={form.audience} onChange={e=>setForm(f=>({...f,audience:e.target.value}))}><option>Internal</option><option>Public</option><option>Partners</option><option>Media</option></select><select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}><option>Normal</option><option>High</option><option>Urgent</option></select></div>
    <button type="submit">Save Draft</button>{msg&&<div className="auth-message">{msg}</div>}</form></section>
   <section style={box}><b>MEDIA OPERATIONS</b><div style={{display:"grid",gap:8,marginTop:12}}><button className="secondary-button" onClick={mediaRequest}>Register Media Request</button><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><select value={assetType} onChange={e=>setAssetType(e.target.value)} aria-label="Media asset type"><option>Photo</option><option>Graphic</option><option>Publication PDF</option><option>Press Material</option><option>Other</option></select><label className="secondary-button" style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:uploadBusy?"wait":"pointer",opacity:uploadBusy?.6:1}}>{uploadBusy?"Uploading…":"Upload Media Asset"}<input type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={uploadMedia} disabled={uploadBusy} style={{display:"none"}}/></label></div><button className="secondary-button" onClick={()=>onNavigate?.("Documents")}>Documents & Records ›</button><button className="secondary-button" onClick={()=>onNavigate?.("Reports")}>Reports ›</button><button className="secondary-button" onClick={()=>onNavigate?.("Actions")}>Actions ›</button></div><p style={{marginTop:18,fontSize:13,opacity:.7}}>Controlled media assets are stored through the existing Google Drive gateway. Supported uploads: PDF, PNG, JPEG and WEBP up to 10 MB. Draft content is never silently published.</p></section>
  </section>
  <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14,marginTop:14}}>
   <section style={box}><b>EDITORIAL PIPELINE</b><div style={{display:"grid",gap:8,marginTop:12}}>{content.slice(-10).reverse().map((x,i)=><div key={x.id||i}><strong>{x.title}</strong><small style={{display:"block",opacity:.65}}>{x.type} · {x.status} · {x.audience}</small></div>)}{!content.length&&<p className="muted">No content in pipeline.</p>}</div></section>
   <section style={box}><b>MEDIA REQUESTS</b><div style={{display:"grid",gap:8,marginTop:12}}>{requests.slice(-10).reverse().map((x,i)=><div key={x.id||i}><strong>{x.title}</strong><small style={{display:"block",opacity:.65}}>{x.status}</small></div>)}{!requests.length&&<p className="muted">No media requests.</p>}</div></section>
   <section style={box}><b>MEDIA ASSET REGISTER</b><div style={{display:"grid",gap:8,marginTop:12}}>{assets.slice(-10).reverse().map((x,i)=><div key={x.id||i}><strong>{x.title||x.fileName||"Asset"}</strong><small style={{display:"block",opacity:.65}}>{x.assetType||x.type||"Media"} · {x.status||"Recorded"}</small></div>)}{!assets.length&&<p className="muted">No media assets registered.</p>}</div></section>
  </section>
 </div>;
}