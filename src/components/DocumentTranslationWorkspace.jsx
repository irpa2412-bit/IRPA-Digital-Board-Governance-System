import React,{useEffect,useMemo,useState}from"react";
import{collection,deleteField,doc,onSnapshot,query,serverTimestamp,updateDoc,where}from"firebase/firestore";
import{db,auth}from"../firebase/config";
import{COLLECTIONS}from"../firebase/data";
import{downloadLifecycleDocument,uploadLifecycleDocument}from"../firebase/documentLifecycle";
import{translateDocumentChunk}from"../firebase/documentTranslation";
import*as pdfjsLib from"pdfjs-dist";
import mammoth from"mammoth";
import*as XLSX from"xlsx";
import JSZip from"jszip";

pdfjsLib.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.mjs",import.meta.url).toString();
const REVIEWER_ROLES=new Set(["Executive Director","Director Outreach","Director Community Development","Director Research","Research Director","Research Officer","Director Human Resources","HR Director"]);
const roleValues=profile=>[profile?.role,...(Array.isArray(profile?.roles)?profile.roles:[]),...(Array.isArray(profile?.assignedRoles)?profile.assignedRoles:[]),...(Array.isArray(profile?.selectedRoles)?profile.selectedRoles:[])].map(x=>String(x||"").trim());
const fmt=v=>{try{const x=v?.toDate?.()||v;return x?new Date(x).toLocaleString():"—"}catch{return"—"}};
const fileExtension=name=>String(name||"").split(".").pop().toLowerCase();
function bytesToArrayBuffer(bytes){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}
function decodeXml(value){return new DOMParser().parseFromString("<root>"+value+"</root>","application/xml").documentElement.textContent||"";}
async function extractOfficeZipText(bytes,ext){
 const zip=await JSZip.loadAsync(bytes);
 const names=Object.keys(zip.files).filter(name=>!zip.files[name].dir);
 if(ext==="pptx"){
  const slides=names.filter(name=>/^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/i)?.[1]||0)-Number(b.match(/slide(\d+)/i)?.[1]||0));
  const parts=[];
  for(const name of slides){const xml=await zip.file(name).async("string");const text=[...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(match=>decodeXml(match[1])).join("");if(text.trim())parts.push(text.trim());}
  return parts.join("\n\n");
 }
 if(ext==="odt"||ext==="odp"){
  const xmlFile=zip.file("content.xml");if(!xmlFile)throw new Error("The OpenDocument package has no content.xml file.");
  const xml=await xmlFile.async("string");
  const parts=[...xml.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map(match=>decodeXml(match[1].replace(/<[^>]+>/g," "))).filter(Boolean);
  return parts.join("\n");
 }
 if(ext==="epub"){
  const pages=names.filter(name=>/\.(xhtml|html?)$/i.test(name)).sort();const parts=[];
  for(const name of pages){const html=await zip.file(name).async("string");const parsed=new DOMParser().parseFromString(html,"text/html");parsed.querySelectorAll("script,style,noscript").forEach(node=>node.remove());const text=parsed.body.textContent||"";if(text.trim())parts.push(text.trim());}
  return parts.join("\n\n");
 }
 return "";
}
async function extractDocumentText(bytes,fileName){
 const ext=fileExtension(fileName);
 let text="";
 if(ext==="pdf"){
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  const pages=[];
  for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();pages.push(content.items.map(item=>item.str||"").join(" "));}
  text=pages.join("\n\n");
 }else if(ext==="docx"){
  const result=await mammoth.extractRawText({arrayBuffer:bytesToArrayBuffer(bytes)});
  text=result.value||"";
 }else if(["xlsx","xls","ods","csv","tsv"].includes(ext)){
  const workbook=XLSX.read(bytes,{type:"array",cellDates:true});
  text=workbook.SheetNames.map(name=>"## "+name+"\n"+XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join("\n\n");
 }else if(["pptx","odt","odp","epub"].includes(ext)){
  text=await extractOfficeZipText(bytes,ext);
 }else if(["txt","md","json","xml","xhtml","html","csv","tsv"].includes(ext)){
  text=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
  if(["html","xhtml"].includes(ext))text=new DOMParser().parseFromString(text,"text/html").body.textContent||"";
 }else if(ext==="rtf"){
  text=new TextDecoder("utf-8",{fatal:false}).decode(bytes).replace(/\\'[0-9a-f]{2}/gi," ").replace(/\\[a-z]+-?\d* ?/gi," ").replace(/[{}]/g," ").replace(/\s+/g," ");
 }else{
  throw new Error("Automatic text extraction currently supports PDF, DOCX, PPTX, XLSX/XLS/ODS, ODT/ODP/EPUB, CSV/TSV, TXT, Markdown, HTML, XML, JSON and RTF. This file format ("+ext.toUpperCase()+") must be converted to a supported text format before translation; the original is unchanged.");
 }
 text=String(text||"").replace(/\u0000/g,"").replace(/[ \t]+\n/g,"\n").trim();
 if(!text)throw new Error("No selectable text was extracted. This may be a scanned/image-only PDF or a file without readable text; OCR is not enabled, so no translation was submitted.");
 if(text.length>200000)throw new Error("Extracted text exceeds the 200,000-character safety limit. Split the document into smaller sections and submit separate requests.");
 return text;
}
function splitIntoChunks(text,max=2300){
 const chunks=[];let remaining=String(text||"").trim();
 while(remaining.length>max){
  let cut=Math.max(remaining.lastIndexOf("\n",max),remaining.lastIndexOf(". ",max),remaining.lastIndexOf("! ",max),remaining.lastIndexOf("? ",max),remaining.lastIndexOf(" ",max));
  if(cut<Math.floor(max*.55))cut=max;
  chunks.push(remaining.slice(0,cut).trim());remaining=remaining.slice(cut).trim();
 }
 if(remaining)chunks.push(remaining);
 return chunks;
}
async function sha256(text){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
 return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
function downloadText(text,name){
 const blob=new Blob([String(text||"")],{type:"text/plain;charset=utf-8"});
 const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name||"IRPA-translated-document.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function requestStatusLabel(status){return String(status||"REQUESTED").replaceAll("_"," ")}

export default function DocumentTranslationWorkspace({profile,employee,admin=false,currentUid,documents=[]}){
 const[requests,setRequests]=useState([]),[selectedId,setSelectedId]=useState(""),[sourceLanguage,setSourceLanguage]=useState("en-TZ"),[consent,setConsent]=useState(false),[restrictedApproval,setRestrictedApproval]=useState(false),[processing,setProcessing]=useState(false),[progress,setProgress]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState(""),[draft,setDraft]=useState(""),[reviewConfirmed,setReviewConfirmed]=useState(false),[reviewNotes,setReviewNotes]=useState(""),[maaSpeakerName,setMaaSpeakerName]=useState(""),[maaDialect,setMaaDialect]=useState("Kisonko / Ilkisonko (confirm with speaker)");
 const roles=[...roleValues(profile),...roleValues(employee)];
 const isReviewer=Boolean(admin||profile?.active===true&&profile?.isAdmin===true||roles.some(r=>REVIEWER_ROLES.has(r)));
 const selected=useMemo(()=>requests.find(r=>r.id===selectedId)||null,[requests,selectedId]);
 const isOwner=Boolean(selected&&selected.documentOwnerUid===currentUid);
 const canProcess=Boolean(isReviewer||isOwner);
 const visibleRequests=useMemo(()=>requests.filter(r=>isReviewer||r.documentOwnerUid===currentUid),[requests,isReviewer,currentUid]);
 useEffect(()=>{
  if(!currentUid){setRequests([]);return}
  const base=collection(db,COLLECTIONS.documentTranslationRequests);
  const q=isReviewer?base:query(base,where("documentOwnerUid","==",currentUid));
  return onSnapshot(q,snapshot=>{
   const rows=snapshot.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>{
    const time=x=>{const d=x?.toDate?.()||x;return d?new Date(d).getTime():0};
    return time(b.createdAt)-time(a.createdAt);
   });
   setRequests(rows);
   setSelectedId(old=>rows.some(r=>r.id===old)?old:(rows[0]?.id||""));
  },e=>setError(e.message||"Unable to retrieve translation requests."));
 },[currentUid,isReviewer]);
 useEffect(()=>{
  setSourceLanguage(selected?.sourceLanguage==="sw"?"sw-TZ":selected?.sourceLanguage==="maa"?"maa":selected?.sourceLanguage==="en"?"en-TZ":"en-TZ");
  setReviewConfirmed(false);setReviewNotes("");setMaaSpeakerName("");setMaaDialect("Kisonko / Ilkisonko (confirm with speaker)");setConsent(false);setRestrictedApproval(false);setError("");setMessage("");setProgress("");
 },[selectedId]);
 useEffect(()=>{setDraft(selected?.translationDraftText||selected?.translatedText||"")},[selectedId,selected?.translationDraftText,selected?.translatedText]);
 async function processRequest(){
  if(!selected||!canProcess)throw new Error("The document owner or an authorised translation reviewer is required to process this request.");
  if(!consent)throw new Error("Confirm that extracted document content may be sent to the IRPA translation service before processing.");
  if(["Confidential","Restricted"].includes(String(selected.documentClassification||""))&&!restrictedApproval)throw new Error("This document is Confidential or Restricted. Confirm separate institutional authorization before transferring its content.");
  if(!["REQUESTED","IN_REVIEW"].includes(String(selected.status||"")))throw new Error("Only open translation requests can be processed.");
  const target=String(selected.targetLanguage||"");
  if(target==="maa"&&!["en-TZ","sw-TZ"].includes(sourceLanguage))throw new Error("Maa dictionary-assisted output currently requires English or Kiswahili source text.");
  if(sourceLanguage==="maa"&&target==="maa")throw new Error("Choose English or Kiswahili as the target when the source is Maa.");
  const document=documents.find(d=>String(d.documentId)===String(selected.documentId));
  const fileId=selected.documentFileId||document?.fileId;
  if(!fileId)throw new Error("The controlled document's file ID is unavailable. Refresh the Documents Workspace and confirm the document is accessible.");
  setProcessing(true);setError("");setMessage("");setDraft("");
  try{
   await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),{status:"IN_REVIEW",contentTransferAuthorized:true,contentTransferred:false,translationStartedAt:serverTimestamp(),sourceLanguageResolved:sourceLanguage,processingError:deleteField(),updatedAt:serverTimestamp()});
   setProgress("Retrieving the original document from the controlled archive…");
   const downloaded=await downloadLifecycleDocument(selected.documentId,fileId);
   const text=await extractDocumentText(downloaded.bytes,selected.documentFileName||document?.fileName||selected.documentTitle||"document.txt");
   const sourceHash=await sha256(text);
   const chunks=splitIntoChunks(text);
   if(chunks.length>150)throw new Error("This document requires more than 150 translation chunks. Split it into smaller sections before processing.");
   let output="",provider="",matchedTerms=0,coverage="none";
   for(let i=0;i<chunks.length;i++){
    setProgress("Translating section "+(i+1)+" of "+chunks.length+"…");
    const result=await translateDocumentChunk({requestId:selected.id,content:chunks[i],targetLanguage:target,sourceLanguage});
    output+=(output?"\n\n":"")+String(result.translatedText||"");
    if(i===0)await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),{contentTransferred:true,updatedAt:serverTimestamp()});
    provider=result.provider||provider;matchedTerms+=Number(result.matchedTerms||0);
    if(result.coverage==="partial")coverage="partial";
   }
   if(output.length>450000)throw new Error("Translated output exceeds the 450,000-character storage limit. Split the document and submit separate translation requests.");
   setDraft(output);
   await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),{
    status:"IN_REVIEW",translationDraftText:output,translationProvider:provider,sourceTextSha256:sourceHash,
    extractedCharacterCount:text.length,translationChunks:chunks.length,translationCoverage:coverage,
    dictionaryMatchedTerms:matchedTerms,sourceLanguageResolved:sourceLanguage,contentTransferred:true,
    translationStartedAt:serverTimestamp(),updatedAt:serverTimestamp(),processingError:deleteField()
   });
   setMessage("Translation draft generated and saved for review. The original document has not been modified. Review the draft before marking it complete.");
   setProgress("");
  }catch(e){
   setError(e.message||"Document extraction or translation failed.");
   setProgress("");
   try{await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),{status:"IN_REVIEW",processingError:String(e.message||"Translation failed.").slice(0,500),translationFailedAt:serverTimestamp(),updatedAt:serverTimestamp()})}catch{}
  }finally{setProcessing(false)}
 }
 async function finalizeTranslation(){
  if(!selected||!isReviewer)throw new Error("An authorised reviewer is required.");
  const text=String(draft||selected.translationDraftText||"");
  if(!text.trim())throw new Error("Generate a translation draft before final review.");
  if(!reviewConfirmed)throw new Error("Confirm that the translated output has been reviewed.");
  if(!reviewNotes.trim())throw new Error("Enter review notes or confirm any corrections before completing the translation.");
  if(selected.targetLanguage==="maa"&&(!maaSpeakerName.trim()||!reviewNotes.trim()))throw new Error("Maa output cannot be finalised without the local Maa speaker's name and documented review notes/corrections.");
  setProcessing(true);setError("");setMessage("");
  try{
   const patch={status:"COMPLETED",translatedText:text,translationDraftText:deleteField(),translationReviewedByUid:auth.currentUser?.uid||currentUid,
    translationReviewedAt:serverTimestamp(),reviewNotes:reviewNotes.trim(),humanReviewRequired:true,
    completedAt:serverTimestamp(),updatedAt:serverTimestamp(),translationOutputFileName:String(selected.documentFileName||selected.documentTitle||"document").replace(/\.[^.]+$/,"")+"."+selected.targetLanguage+".translated.txt"};
   if(selected.targetLanguage==="maa")patch.maaSpeakerReview={speakerName:maaSpeakerName.trim(),dialect:maaDialect.trim(),reviewNotes:reviewNotes.trim(),verifiedByUid:auth.currentUser?.uid||currentUid,verifiedAt:new Date().toISOString()};
   await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),patch);
   setMessage("Translation marked complete after reviewer confirmation. Download the translated text and retain it with the controlled source record according to IRPA records policy.");
  }catch(e){setError(e.message||"Unable to finalise the translation.")}
  finally{setProcessing(false)}
 }
 async function archiveCompletedTranslation(){
  if(!selected||selected.status!=="COMPLETED"||!selected.translatedText)throw new Error("Only a completed translation can be archived.");
  if(selected.documentOwnerUid!==currentUid)throw new Error("Only the document owner can archive the translated output through their Documents Portal.");
  setArchiving(true);setError("");setMessage("");
  try{
   const sourceDocument=documents.find(d=>String(d.documentId)===String(selected.documentId));
   const safeTarget=String(selected.targetLanguage||"translated").toUpperCase();
   const fileName="IRPA-Translation-"+String(selected.documentReference||selected.documentId).replace(/[^A-Za-z0-9_-]/g,"-")+"-"+safeTarget+".txt";
   const file=new File([selected.translatedText],fileName,{type:"text/plain"});
   const uploaded=await uploadLifecycleDocument({
    file,title:"Translation of "+String(selected.documentTitle||selected.documentId)+" ("+safeTarget+") — request "+selected.id,
    documentType:"Other",archiveCategory:sourceDocument?.archiveCategory||"Administrative Documents",
    classification:selected.documentClassification||sourceDocument?.classification||"Internal",version:"1.0"
   });
   if(!uploaded?.documentId||!uploaded?.fileId)throw new Error("The archive service did not return both the translated document registry ID and Drive file ID.");
   await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),{
    translatedFileId:uploaded.fileId,translatedDocumentId:uploaded.documentId,translationOutputFileName:fileName,updatedAt:serverTimestamp()
   });
   const archivedReference=String(uploaded.reference||uploaded.documentId);setMessage("Translated text has been uploaded as a separate controlled document ("+archivedReference+"). The original source document was not changed.");
  }catch(e){setError(e.message||"Unable to archive the translated output. You can still download the completed text file.");}
  finally{setArchiving(false)}
 }
 async function rejectRequest(){
  if(!selected||!isReviewer)return;
  const reason=reviewNotes.trim();if(!reason)return setError("Enter the reason for rejecting this translation request.");
  setProcessing(true);setError("");try{await updateDoc(doc(db,COLLECTIONS.documentTranslationRequests,selected.id),{status:"REJECTED",reviewNotes:reason,translationReviewedByUid:auth.currentUser?.uid||currentUid,translationReviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});setMessage("Translation request rejected with a recorded reason.");}catch(e){setError(e.message||"Unable to reject request.")}finally{setProcessing(false)}
 }
 return <section className="panel" style={{marginTop:14}}>
  <div className="panel-header"><div><span className="eyebrow">IRPA AI INTERPRETER & TRANSLATOR</span><h3 style={{margin:"5px 0"}}>Document Translation Fulfilment Workspace</h3><p className="panel-description">Owner requests → controlled extraction → chunked translation → reviewer approval → downloadable output. Source files remain unchanged.</p></div><span className="status-badge">{isReviewer?"Reviewer queue":"Owner request history"}</span></div>
  {message&&<div className="success-message action-feedback" role="status">{message}</div>}{error&&<div className="error-message action-feedback" role="alert">{error}</div>}
  <div style={{display:"grid",gridTemplateColumns:"minmax(250px,.85fr) minmax(320px,1.4fr)",gap:14}}>
   <div><strong>{visibleRequests.length} request{visibleRequests.length===1?"":"s"}</strong><div style={{display:"grid",gap:8,marginTop:10}}>{visibleRequests.map(r=><button key={r.id} type="button" className="secondary-button" onClick={()=>setSelectedId(r.id)} style={{textAlign:"left",border:selectedId===r.id?"2px solid var(--accent)":"1px solid var(--border)",padding:10}}><strong>{r.documentTitle||r.documentId}</strong><small style={{display:"block",marginTop:4}}>{r.targetLanguageLabel||r.targetLanguage} · {requestStatusLabel(r.status)}</small><small style={{display:"block",marginTop:3}}>{fmt(r.createdAt)}</small></button>)}{!visibleRequests.length&&<div className="auth-message">No translation requests are available under your current access.</div>}</div></div>
   <div>
    {!selected?<div className="auth-message">Select a translation request to review its details.</div>:<div className="auth-message">
     <h4 style={{marginTop:0}}>{selected.documentTitle||selected.documentId}</h4>
     <dl style={{display:"grid",gridTemplateColumns:"max-content 1fr",gap:"5px 10px"}}><dt>Status</dt><dd>{requestStatusLabel(selected.status)}</dd><dt>Requested target</dt><dd>{selected.targetLanguageLabel||selected.targetLanguage}</dd><dt>Source</dt><dd>{selected.sourceLanguage||"Detect / not specified"}</dd><dt>Classification</dt><dd>{selected.documentClassification||"Internal"}</dd><dt>Owner UID</dt><dd style={{wordBreak:"break-all"}}>{selected.documentOwnerUid}</dd><dt>Requested</dt><dd>{fmt(selected.createdAt)}</dd><dt>Instructions</dt><dd>{selected.requestNotes||"—"}</dd></dl>
     {canProcess&&["REQUESTED","IN_REVIEW"].includes(String(selected.status||""))&&<div style={{borderTop:"1px solid var(--border)",paddingTop:12,marginTop:12}}>
      <div className="form-field"><label>Source language used for extraction</label><select value={sourceLanguage} onChange={e=>setSourceLanguage(e.target.value)}><option value="en-TZ">English</option><option value="sw-TZ">Kiswahili</option><option value="maa">Maa (Maasai)</option><option value="fr-FR">French</option><option value="es-ES">Spanish</option><option value="pt-PT">Portuguese</option><option value="ar-SA">Arabic</option></select></div>
      <div style={{marginTop:10}}><label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> <span>I confirm that this owner-requested document may be extracted and its text sent to the IRPA translation service for processing. This action transfers content; submitting the request alone does not. The owner can generate a draft, but only an authorised reviewer can approve it as complete.</span></label></div>
      {["Confidential","Restricted"].includes(String(selected.documentClassification||""))&&<div style={{marginTop:10}}><label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input type="checkbox" checked={restrictedApproval} onChange={e=>setRestrictedApproval(e.target.checked)}/> <span>I have verified the separate institutional authorization required to transfer Confidential/Restricted document content.</span></label></div>}
      <button type="button" disabled={processing||!consent} onClick={processRequest} style={{marginTop:12}}>{processing?"Processing…":"Extract and Translate Document"}</button>
      {progress&&<p role="status" aria-live="polite">{progress}</p>}
     </div>}
     {(draft||selected.translationDraftText||selected.translatedText)&&<div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:12}}>
      <div className="panel-header"><div><strong>{selected.status==="COMPLETED"?"Completed Translation":"Translation Draft — Human Review Required"}</strong><small style={{display:"block",marginTop:4}}>{selected.translationProvider||"IRPA translation service"}{selected.targetLanguage==="maa"?" · provisional Maa dictionary assistance":""}</small></div><button type="button" className="secondary-button" onClick={()=>downloadText(selected.translatedText||draft||selected.translationDraftText,selected.translationOutputFileName||"IRPA-translated-document.txt")}>Download TXT</button></div>
      <div style={{maxHeight:360,overflow:"auto",whiteSpace:"pre-wrap",overflowWrap:"anywhere",border:"1px solid var(--border)",borderRadius:8,padding:12,marginTop:10}}>{selected.translatedText||draft||selected.translationDraftText}</div>
      {selected.targetLanguage==="maa"&&<p className="muted">Maa dictionary output is not grammar-complete. It must not be used in official governance records until a local competent Maa speaker has reviewed and corrected it.</p>}
      {isReviewer&&selected.status!=="COMPLETED"&&<div style={{marginTop:12}}>
       <div className="form-field"><label>Reviewer notes and corrections</label><textarea rows={3} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} placeholder={selected.targetLanguage==="maa"?"Record corrections and the local speaker's review observations.":"Record material corrections or review notes."}/></div>
       {selected.targetLanguage==="maa"&&<><div className="form-field" style={{marginTop:8}}><label>Local Maa speaker who verified the draft</label><input value={maaSpeakerName} onChange={e=>setMaaSpeakerName(e.target.value)} placeholder="Enter actual reviewer name"/></div><div className="form-field" style={{marginTop:8}}><label>Dialect / variety</label><input value={maaDialect} onChange={e=>setMaaDialect(e.target.value)}/></div></>}
       <label style={{display:"flex",gap:8,alignItems:"flex-start",marginTop:10}}><input type="checkbox" checked={reviewConfirmed} onChange={e=>setReviewConfirmed(e.target.checked)}/> <span>I have reviewed the translation and its terminology; any required specialist review is complete.</span></label>
       <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button type="button" disabled={processing||!reviewConfirmed||!reviewNotes.trim()||(selected.targetLanguage==="maa"&&(!maaSpeakerName.trim()||!reviewNotes.trim()))} onClick={finalizeTranslation}>{processing?"Saving…":"Approve and Complete Translation"}</button><button type="button" className="secondary-button" disabled={processing||!reviewNotes.trim()} onClick={rejectRequest}>Reject Request</button></div>
      </div>}
     </div>}
     {selected.status==="COMPLETED"&&<div className="success-message"><p>Completed {fmt(selected.completedAt)}. Reviewer confirmation is recorded{selected.targetLanguage==="maa"?" with the Maa speaker review details.":"."}</p>{selected.translatedFileId&&<p>Archived document ID: <strong>{selected.translatedDocumentId||selected.translatedFileId}</strong></p>}{selected.documentOwnerUid===currentUid&&!selected.translatedFileId&&<button type="button" disabled={archiving} onClick={archiveCompletedTranslation}>{archiving?"Archiving…":"Save Translation to Controlled Documents"}</button>}</div>}
     {selected.contentTransferred&&<small style={{display:"block",marginTop:10}}>Content transfer recorded for this request. Do not place Confidential/Restricted records into processing without institutional authorization.</small>}
    </div>}
   </div>
  </div>
 </section>
}
