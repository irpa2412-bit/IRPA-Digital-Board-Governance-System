import React,{useEffect,useState} from "react";
import {auth} from "../firebase/config";
import {getGoogleDriveGatewayUrl} from "../firebase/gatewayUrl";
const GATEWAY=getGoogleDriveGatewayUrl();
const SECRETS=["WORDPRESS_BASE_URL","WORDPRESS_USERNAME","WORDPRESS_APPLICATION_PASSWORD"];
const styles={panel:{border:"1px solid var(--border-color,#d5dce5)",borderRadius:12,padding:14,display:"grid",gap:10,background:"var(--surface,#fff)"},field:{width:"100%",boxSizing:"border-box",padding:10,border:"1px solid var(--border-color,#cbd5e1)",borderRadius:8,font:"inherit",background:"var(--input-bg,#fff)",color:"var(--text-primary,#172033)"},button:{padding:"10px 12px",borderRadius:8,border:"1px solid var(--border-color,#cbd5e1)",font:"inherit",fontWeight:650,background:"var(--surface-elevated,#f8fafc)",color:"var(--text-primary,#172033)"},primary:{padding:"10px 12px",borderRadius:8,border:"1px solid #1d4ed8",font:"inherit",fontWeight:700,background:"#1d4ed8",color:"#fff"}};
export default function CommunicationsWebsiteStudio({initialTab="pages"}){
 const [status,setStatus]=useState(null),[type,setType]=useState("pages"),[items,setItems]=useState([]),[edit,setEdit]=useState(null),[newPost,setNewPost]=useState(null),[taxonomies,setTaxonomies]=useState({categories:[],tags:[]}),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[uploadProgress,setUploadProgress]=useState([]),[approvalReady,setApprovalReady]=useState(null),[seoCapabilities,setSeoCapabilities]=useState(null),[mediaDestination,setMediaDestination]=useState("media-library"),[mediaParentId,setMediaParentId]=useState(""),[mediaParentType,setMediaParentType]=useState("posts"),[mediaFolder,setMediaFolder]=useState("uploads/irpa-media"),[mediaResults,setMediaResults]=useState([]),[acceptanceReport,setAcceptanceReport]=useState(null),[activeTab,setActiveTab]=useState(initialTab);
 async function call(path,method="GET",payload,withStatus=false){if(!auth.currentUser)throw Error("Sign in to use Website Studio.");let tokenTimer;const token=await Promise.race([auth.currentUser.getIdToken(),new Promise((_,reject)=>{tokenTimer=setTimeout(()=>reject(new Error("Sign-in token request timed out. Please sign in again.")),8000)})]).finally(()=>clearTimeout(tokenTimer));let r;try{r=await fetch(GATEWAY+path,{method,headers:{Authorization:"Bearer "+token,Accept:"application/json",...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(32000)})}catch(e){if(e?.name==="TimeoutError"||e?.name==="AbortError")throw Error("The gateway did not respond within 32 seconds. The request was stopped; retry once and inspect the gateway health if it repeats.");throw Error("Could not reach the Cloudflare gateway: "+(e?.message||"network error"))}const data=await r.json().catch(()=>({}));if(withStatus)return {httpStatus:r.status,data,error:r.ok?"":data.error||"Request failed ("+r.status+")."};if(!r.ok)throw Error(data.error||"Request failed ("+r.status+").");return data}
 async function connect(){setBusy(true);setMessage("");try{const d=await call("/api/communications/site/status");const connections=d.connections||{};let cpanelDiagnostics=null;if(connections.cpanel==="connected"){try{cpanelDiagnostics=await call("/api/communications/cpanel/diagnostics?domain="+encodeURIComponent(connections.configuredWordPressHost||"irpa.or.tz"));}catch(error){cpanelDiagnostics={readOnly:true,error:error.message||"cPanel diagnostics unavailable."};}}setStatus({...connections,cpanelDiagnostics});const website=String(connections.website||"unavailable");const cpanel=String(connections.cpanel||"unavailable");setMessage("Connection diagnostics received. WordPress: "+website.replace(/_/g," ")+". cPanel: "+cpanel.replace(/_/g," ")+".");}catch(e){setStatus(null);setMessage(e.message||"Connection check failed.")}finally{setBusy(false)}}
 useEffect(()=>{void connect()},[]);
 async function runProductionAcceptance(){
  setBusy(true);setMessage("");setAcceptanceReport(null);
  const rows=[];
  const add=(label,status,httpStatus,error="")=>rows.push({label,status,httpStatus,error});
  let connections=null;
  try{
   const health=await call("/health","GET",undefined,true);
   add("TEST Worker health",health.httpStatus>=200&&health.httpStatus<300?"PASS":"FAIL",health.httpStatus,health.error||health.data?.status||"");
   const reads=[
    ["TEST WordPress connection and capability read","/api/communications/site/status"],
    ["TEST WordPress pages read","/api/communications/website/content?type=pages"],
    ["TEST WordPress posts read","/api/communications/website/content?type=posts"],
    ["TEST WordPress categories and tags read","/api/communications/website/taxonomies"],
    ["TEST WordPress SEO capability read","/api/communications/website/seo-capabilities"],
    ["TEST cPanel root directory read","/api/communications/cpanel/files"]
   ];
   let cpanelEntries=[];
   for(const [label,path] of reads){
    try{
     const result=await call(path,"GET",undefined,true);
     add(label,result.httpStatus>=200&&result.httpStatus<300?"PASS":"FAIL",result.httpStatus,result.error||result.data?.error||"");
     if(path.endsWith("/site/status")){
      connections=result.data?.connections||null;
      const capability=connections?.websiteAccount?.uploadFilesCapability;
      add("TEST WordPress upload_files capability",capability==="granted"?"PASS":"FAIL",connections?.websiteHttpStatus??result.httpStatus,capability==="granted"?"":"upload_files is missing or unverified; media uploads must be blocked.");
     }
     if(path.endsWith("/cpanel/files"))cpanelEntries=result.data?.entries||[];
    }catch(error){add(label,"FAIL",error.httpStatus||0,error.message||"Read route failed.");}
   }
   const readableFile=cpanelEntries.find(entry=>entry.type==="file");
   if(readableFile){
    try{const result=await call("/api/communications/cpanel/files?path="+encodeURIComponent(readableFile.name),"GET",undefined,true);add("TEST cPanel website file content read",result.httpStatus>=200&&result.httpStatus<300?"PASS":"FAIL",result.httpStatus,result.error||result.data?.error||"");}
    catch(error){add("TEST cPanel website file content read","FAIL",error.httpStatus||0,error.message||"File read failed.");}
   }else add("TEST cPanel website file content read","FAIL",null,"No safe HTML/CSS/TXT/JSON file was returned by the read-only directory listing.");
   try{
    const domain=connections?.configuredWordPressHost||"irpa.or.tz";
    const probe=await call("/api/communications/cpanel/diagnostics?domain="+encodeURIComponent(domain),"GET",undefined,true);
    add("TEST cPanel diagnostics route",probe.httpStatus>=200&&probe.httpStatus<300?"PASS":"FAIL",probe.httpStatus,probe.error||probe.data?.error||"");
    const diag=probe.data||{};
    add("TEST cPanel email accounts list",diag.emailAccounts?.status==="PASS"?"PASS":"FAIL",diag.emailAccounts?.httpStatus??probe.httpStatus,diag.emailAccounts?.error||"");
    add("TEST cPanel SSL status",diag.ssl?.status==="PASS"?"PASS":"FAIL",diag.ssl?.httpStatus??probe.httpStatus,diag.ssl?.error||diag.ssl?.status||"");
    add("TEST PHP upload_max_filesize and post_max_size",diag.phpLimits?.status==="PASS"?"PASS":"FAIL",diag.phpLimits?.httpStatus??probe.httpStatus,diag.phpLimits?.error||diag.phpLimits?.diagnostic||"The configured cPanel UAPI did not expose both PHP upload limits.");
   }catch(error){add("TEST cPanel diagnostics route","FAIL",error.httpStatus||0,error.message||"cPanel diagnostics failed.");}
   let acceptance=null;
   try{
    const result=await call("/api/communications/website/production-acceptance","POST",{},true);
    add("TEST draft lifecycle and destination upload suite",result.httpStatus>=200&&result.httpStatus<300?"PASS":"FAIL",result.httpStatus,result.error||"");
    acceptance=result.data||null;
    for(const row of acceptance?.report||[])rows.push(row);
   }catch(error){add("TEST draft lifecycle and destination upload suite","FAIL",error.httpStatus||0,error.message||"Acceptance run failed.");}
   for(const [type,id] of [["pages",acceptance?.createdDrafts?.pageId],["posts",acceptance?.createdDrafts?.postId]]){
    if(!id)continue;
    try{const result=await call("/api/communications/website/content/"+type+"/"+id,"GET",undefined,true);add("TEST WordPress "+type+" single-item read",result.httpStatus>=200&&result.httpStatus<300?"PASS":"FAIL",result.httpStatus,result.error||result.data?.error||"");}
    catch(error){add("TEST WordPress "+type+" single-item read","FAIL",error.httpStatus||0,error.message||"Single-item read failed.");}
    try{const result=await call("/api/communications/website/revisions?type="+type+"&id="+id,"GET",undefined,true);add("TEST WordPress "+type+" revision-route read",result.httpStatus>=200&&result.httpStatus<300?"PASS":"FAIL",result.httpStatus,result.error||result.data?.error||"");}
    catch(error){add("TEST WordPress "+type+" revision-route read","FAIL",error.httpStatus||0,error.message||"Revision read failed.");}
   }
   setAcceptanceReport(rows);setMessage("Production acceptance finished: "+rows.filter(x=>x.status==="PASS").length+" PASS, "+rows.filter(x=>x.status==="FAIL").length+" FAIL. TEST drafts and uploaded files are retained; nothing was published or deleted.");
  }catch(error){add("TEST production acceptance runner","FAIL",0,error.message);setAcceptanceReport(rows);setMessage(error.message||"Production acceptance failed.");}
  finally{setBusy(false)}
 }
 async function createSiteStructure(){setBusy(true);setMessage("");try{const data=await call("/api/communications/website/structure","POST",{});const r=data.result||{};setMessage("Draft site structure complete. Pages: "+(r.pages||[]).filter(x=>x.status==="CREATED_DRAFT").length+" created, "+(r.pages||[]).filter(x=>x.status==="SKIPPED_EXISTS").length+" skipped; categories: "+(r.categories||[]).length+" checked; tags: "+(r.tags||[]).length+" checked; menu: "+(r.menu?.status||"not reported")+". Live menu unchanged.");}catch(error){setMessage(error.message||"Draft site structure could not be created.")}finally{setBusy(false)}}
 async function load(nextType=type){setBusy(true);setMessage("");try{const d=await call("/api/communications/website/content?type="+nextType);setItems(d.items||[]);setType(nextType);setMessage("Loaded "+(d.items||[]).length+" WordPress "+nextType+".")}catch(e){setMessage(e.message||"WordPress content could not be loaded.")}finally{setBusy(false)}}
 async function loadTaxonomies(){
  const data=await call("/api/communications/website/taxonomies");
  setTaxonomies({categories:data.categories||[],tags:data.tags||[]});
 }
 async function loadSeoCapabilities(){
  const data=await call("/api/communications/website/seo-capabilities");
  setSeoCapabilities(data.yoast||{metaDescription:false,focusKeyphrase:false,verified:false});
 }
 async function openNewPost(){
  setBusy(true);setMessage("");
  try{await loadTaxonomies();await loadSeoCapabilities().catch(()=>setSeoCapabilities({verified:false,metaDescription:false,focusKeyphrase:false}));setApprovalReady(null);setNewPost({title:"",content:"",excerpt:"",language:"English",categories:[],tags:[],featuredMedia:0,uploadedImages:[],videoUrl:"",seoMetaDescription:"",seoFocusKeyphrase:""});setType("posts");}
  catch(e){setMessage(e.message||"WordPress categories and tags could not be loaded.");}
  finally{setBusy(false)}
 }
 async function uploadPhoto(file,target,altText,caption){
  const dataBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Could not read the selected image."));reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");reader.readAsDataURL(file)});
  const result=await call("/api/communications/website/media","POST",{filename:file.name,contentType:file.type,dataBase64,altText,caption});
  const media=result.media;
  const escape=value=>String(value||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const figure='<figure class="wp-block-image"><img src="'+escape(media.url)+'" alt="'+escape(altText)+'" />'+(caption?'<figcaption>'+escape(caption)+'</figcaption>':"")+'</figure>';
  if(target==="new")setNewPost(current=>({...current,content:String(current?.content||"")+(current?.content?"\\n\\n":"")+figure,featuredMedia:Number(current?.featuredMedia||media.id),uploadedImages:[...(current?.uploadedImages||[]),{id:Number(media.id),url:media.url,altText}]}));
  else setEdit(current=>({...current,content:String(current?.content||"")+(current?.content?"\\n\\n":"")+figure,featuredMedia:Number(current?.featuredMedia||media.id),uploadedImages:[...(current?.uploadedImages||[]),{id:Number(media.id),url:media.url,altText}]}));
 }
 async function uploadPhotos(files,target){
  const selected=Array.from(files||[]);
  if(!selected.length)return;
  const rows=selected.map((file,index)=>({key:target+"-"+Date.now()+"-"+index,name:file.name,status:"Queued"}));
  setUploadProgress(rows);setBusy(true);setMessage("");
  const update=(index,status)=>setUploadProgress(current=>current.map((row,i)=>i===index?{...row,status}:row));
  const errors=[];let uploaded=0,skipped=0;
  try{
   for(let index=0;index<selected.length;index++){
    const file=selected[index];
    if(file.size<1){update(index,"Rejected · empty file");errors.push(file.name+": file is empty.");continue;}
    if(!["image/jpeg","image/png","image/webp"].includes(String(file.type||"").toLowerCase())){update(index,"Rejected · unsupported type");errors.push(file.name+": only JPEG, PNG and WebP are accepted.");continue;}
    const altText=window.prompt("Required descriptive alt text for: "+file.name,"");
    if(altText===null){update(index,"Skipped · alt text cancelled");skipped++;continue;}
    if(!String(altText).trim()){update(index,"Rejected · alt text required");errors.push(file.name+": descriptive alt text is required.");continue;}
    const caption=window.prompt("Optional image caption for: "+file.name,"");
    if(caption===null){update(index,"Skipped · caption cancelled");skipped++;continue;}
    try{update(index,"Uploading");await uploadPhoto(file,target,String(altText).trim(),String(caption||"").trim());update(index,"Uploaded");uploaded++;}
    catch(error){update(index,"Failed");errors.push(file.name+": "+(error.message||"upload failed"));}
   }
   setMessage("Image batch complete: "+uploaded+" uploaded, "+skipped+" skipped, "+errors.length+" failed."+ (errors.length?" "+errors.join(" | "):" Review the inserted figures and save the update as a draft."));
  }finally{setBusy(false)}
 }
 async function uploadGeneralFiles(fileList){
  const selected=Array.from(fileList||[]);if(!selected.length)return;
  const cpanelLimit=50*1024*1024; if(mediaDestination==="cpanel-folder"&&selected.some(file=>file.size>cpanelLimit)){setMessage("cPanel uploads are limited to 50 MB per file. Upload larger videos to YouTube or Vimeo and insert the HTTPS link into the draft.");return;}
  setBusy(true);setMessage("");setMediaResults([]);
  const rows=selected.map((file,index)=>({key:"asset-"+Date.now()+"-"+index,name:file.name,status:"Queued",file}));
  setUploadProgress(rows);
  const update=(index,status)=>setUploadProgress(current=>current.map((row,i)=>i===index?{...row,status}:row));
  const results=[];
  try{
   for(let index=0;index<selected.length;index++){
    const file=selected[index];
    try{
     if(!file.size)throw Error("Empty files are not accepted.");
     const title=window.prompt("File title:",file.name);if(title===null){update(index,"Skipped");continue;}
     const altText=window.prompt("Alt text (required for images):","");if(altText===null){update(index,"Skipped");continue;}
     const caption=window.prompt("Caption (optional):","");if(caption===null){update(index,"Skipped");continue;}
     const category=window.prompt("Media category:","General");if(category===null){update(index,"Skipped");continue;}
     const tags=window.prompt("Comma-separated tags:","");if(tags===null){update(index,"Skipped");continue;}
     const common={filename:file.name,title,altText,caption,category,tags:tags.split(",").map(x=>x.trim()).filter(Boolean),contentType:file.type||"application/octet-stream"};
     update(index,"Reading");
     const buffer=await file.arrayBuffer();
     let result;
     if(mediaDestination==="cpanel-folder"){
      const uploadId=crypto.randomUUID(),chunkSize=240*1024,total=Math.ceil(buffer.byteLength/chunkSize);
      if(total>512)throw Error("File exceeds the chunked upload limit.");
      for(let part=0;part<total;part++){
       const bytes=new Uint8Array(buffer,part*chunkSize,Math.min(chunkSize,buffer.byteLength-part*chunkSize));
       let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
       await call("/api/communications/cpanel/media/chunk","POST",{uploadId,index:part,total,dataBase64:btoa(binary)});
       update(index,"Uploading "+Math.round((part+1)/total*90)+"%");
      }
      result=await call("/api/communications/cpanel/media/complete","POST",{...common,uploadId,total,path:mediaFolder.replace(/\/$/,"")+"/"+file.name});
      result.url=result.url||"";
     }else{
      let binary="";const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
      update(index,"Uploading");
      result=await call("/api/communications/website/media","POST",{...common,dataBase64:btoa(binary),destination:mediaDestination,parentId:Number(mediaParentId),parentType:mediaParentType});
      result=result.media||result;
     }
     update(index,"Uploaded");
     results.push({name:file.name,status:"PASS",url:result.url||"",sha256:result.sha256||"",size:result.size||file.size});
    }catch(error){update(index,"Failed");results.push({name:file.name,file,status:"FAIL",error:error.message||"Upload failed."});}
   }
   setMediaResults(results);
   setMessage("Media batch finished: "+results.filter(x=>x.status==="PASS").length+" uploaded; "+results.filter(x=>x.status==="FAIL").length+" failed. Uploads remain in the selected media destination.");
  }finally{setBusy(false)}
 }
 async function createNewPost(){
  if(!newPost)return;
  setBusy(true);setMessage("");
  const editorialId=crypto.randomUUID();
  const editorialSlug="irpa-"+editorialId.toLowerCase();
  try{
   const selectedTagNames=taxonomies.tags.filter(term=>newPost.tags.includes(term.id)).map(term=>term.name);
   await call("/api/communications/records","POST",{
    collection:"communicationMediaItems",action:"create",id:editorialId,
    data:{title:newPost.title,type:"Website Article",channel:"IRPA Website",summary:newPost.excerpt||"",body:newPost.content,slug:editorialSlug,language:newPost.language,tags:selectedTagNames.join(", ")}
   });
   try{
    const data=await call("/api/communications/website/posts","POST",{
     title:newPost.title,content:newPost.content,excerpt:newPost.excerpt,
     categories:newPost.categories,tags:newPost.tags,featuredMedia:Number(newPost.featuredMedia||0),slug:editorialSlug+(newPost.language==="Kiswahili"?"-sw":"-en"),seoMetaDescription:newPost.seoMetaDescription||"",seoFocusKeyphrase:newPost.seoFocusKeyphrase||""
    });
    const item=data.item;
    setItems(current=>[item,...current.filter(existing=>existing.id!==item.id)]);
    setType("posts");setNewPost(null);
    setMessage("WordPress draft created and linked to editorial draft "+editorialId+". Submit that item from the Communications Library for independent approval before publication.");
   }catch(error){
    setMessage("Editorial draft "+editorialId+" was saved, but the WordPress draft could not be created: "+(error.message||"unknown error")+". The editorial draft remains available for the existing approval workflow.");
   }
  }catch(e){setMessage(e.message||"The editorial draft could not be created. No WordPress post was created.")}
  finally{setBusy(false)}
 }
 async function submitForApproval(){
  if(!approvalReady||approvalReady.status!=="Draft")return;
  setBusy(true);setMessage("");
  try{
   await call("/api/communications/records","POST",{collection:"communicationMediaItems",action:"submit",id:approvalReady.editorialId});
   setApprovalReady(current=>({...current,status:"Pending Approval"}));
   setMessage("Submitted to the existing independent approval workflow. Publication remains blocked until a separate authorised reviewer approves it.");
  }catch(error){setMessage(error.message||"The editorial draft could not be submitted for approval.");}
  finally{setBusy(false)}
 }
 async function save(){if(!edit)return;setBusy(true);setMessage("");try{const d=await call("/api/communications/website/content","PUT",{type,id:edit.id,title:edit.title,content:edit.content,excerpt:edit.excerpt||"",featuredMedia:Number(edit.featuredMedia||0),status:"draft"});setEdit(d.item||null);await load(type);setMessage("Draft saved to WordPress. Submit the matching item for independent approval before any publication.");}catch(e){setMessage(e.message||"Draft save failed.")}finally{setBusy(false)}}
 const connected=status?.website==="connected";
 const connectionLabel=value=>({not_checked:"Not checked",connected:"Connected",authentication_failed:"Authentication failed",wrong_account_role:"Wrong account role",not_configured:"Not configured",unavailable:"Unavailable",credentials_missing:"Credentials missing",authentication_rejected:"Authentication rejected",permission_denied:"Permission denied",unavailable_or_denied:"Unavailable or denied"})[String(value||"not_checked")]||String(value||"Not checked").replace(/_/g," ");
 return <section style={{display:"grid",gap:12,minWidth:0}}>
  <nav aria-label="Website Studio sections" style={{display:"flex",gap:8,flexWrap:"wrap",padding:4,borderBottom:"1px solid var(--border-color,#d5dce5)"}}>
   {[["pages","Pages and Posts"],["media","Upload Media"],["structure","Site Structure"],["acceptance","Production Acceptance"]].map(([id,label])=><button key={id} type="button" aria-pressed={activeTab===id} style={activeTab===id?styles.primary:styles.button} onClick={()=>setActiveTab(id)}>{label}</button>)}
  </nav>
  {activeTab==="media"&&<>
  <section style={styles.panel}><h3 style={{margin:0}}>Media upload and register</h3><p style={{margin:0}}>WordPress upload_files capability: {status?.websiteAccount?.uploadFilesCapability||"not yet checked"} · PHP upload_max_filesize: {status?.cpanelDiagnostics?.phpLimits?.upload_max_filesize||"not readable"} · post_max_size: {status?.cpanelDiagnostics?.phpLimits?.post_max_size||"not readable"}</p><p style={{margin:0}}>Permitted: JPG, PNG, WebP, GIF, sanitised SVG, MP4, MOV, WebM, MP3, PDF, DOCX, XLSX and PPTX. cPanel limit: 50 MB per file; larger videos must use a YouTube/Vimeo HTTPS link. Executables are rejected. Large files are sent in chunks to the cPanel upload route.</p><label>Required destination<select style={styles.field} value={mediaDestination} onChange={e=>setMediaDestination(e.target.value)}><option value="media-library">WordPress Media Library</option><option value="attach">Attach to selected page/post</option><option value="featured">Set as featured image</option><option value="cpanel-folder">cPanel folder</option></select></label>{mediaDestination==="attach"||mediaDestination==="featured"? <><label>Target type<select style={styles.field} value={mediaParentType} onChange={e=>setMediaParentType(e.target.value)}><option value="posts">Post</option><option value="pages">Page</option></select></label><label>Existing WordPress page/post ID<input style={styles.field} inputMode="numeric" value={mediaParentId} onChange={e=>setMediaParentId(e.target.value)} placeholder="Enter existing ID"/></label></>:null}{mediaDestination==="cpanel-folder"?<label>Relative cPanel folder and filename parent<input style={styles.field} value={mediaFolder} onChange={e=>setMediaFolder(e.target.value)} placeholder="uploads/irpa-media"/></label>:null}<label>Select multiple files<input style={styles.field} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.mp4,.mov,.webm,.mp3,.pdf,.docx,.xlsx,.pptx" disabled={busy} onChange={e=>{void uploadGeneralFiles(e.target.files);e.target.value=""}}/></label>{uploadProgress.map(row=><div key={row.key} role="status" style={{fontSize:12}}>{row.name}: {row.status}</div>)}{mediaResults.map((row,i)=><div key={row.name+"-"+i} style={{borderTop:"1px solid var(--border-color,#d5dce5)",paddingTop:6,display:"grid",gap:4}}><strong>{row.name} · {row.status}</strong>{row.url?<><a href={row.url} target="_blank" rel="noreferrer">{row.url}</a><button style={styles.button} type="button" onClick={()=>navigator.clipboard.writeText(row.url)}>Copy link</button></>:null}{row.sha256?<small>SHA-256: {row.sha256} · {row.size} bytes</small>:null}{row.error?<><span>{row.error}</span><button style={styles.button} type="button" disabled={busy} onClick={()=>void uploadGeneralFiles([row.file])}>Retry upload</button></>:null}</div>)}</section>
  </>}
  {activeTab==="acceptance"&&<>
  <section style={styles.panel}><h3 style={{margin:0}}>Production acceptance · TEST only</h3><p style={{margin:0}}>Runs Worker health, WordPress/cPanel read routes, upload_files verification, TEST draft create/edit/revision checks, and small image, MP4, PDF and DOCX uploads to each configured destination. Every created item is labelled TEST and retained. Nothing is published or deleted.</p><button style={styles.primary} type="button" disabled={busy} onClick={runProductionAcceptance}>{busy?"Running acceptance checks…":"Run production acceptance"}</button><button style={styles.button} type="button" disabled={!acceptanceReport} onClick={()=>navigator.clipboard.writeText(["TEST\tResult\tHTTP\tError",...acceptanceReport.map(row=>[row.label,row.status,row.httpStatus??"N/A",row.error||""].join("\t"))].join("\n"))}>Copy Report</button>{acceptanceReport&&<><div role="status"><strong>{acceptanceReport.filter(row=>row.status==="PASS").length} PASS · {acceptanceReport.filter(row=>row.status==="FAIL").length} FAIL</strong></div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr><th style={{textAlign:"left",padding:6}}>TEST</th><th style={{textAlign:"left",padding:6}}>Result</th><th style={{textAlign:"left",padding:6}}>HTTP</th><th style={{textAlign:"left",padding:6}}>Error / detail</th></tr></thead><tbody>{acceptanceReport.map((row,index)=><tr key={row.label+"-"+index}><td style={{padding:6,borderTop:"1px solid var(--border-color,#d5dce5)"}}>{row.label}</td><td style={{padding:6,borderTop:"1px solid var(--border-color,#d5dce5)"}}>{row.status}</td><td style={{padding:6,borderTop:"1px solid var(--border-color,#d5dce5)"}}>{row.httpStatus??"N/A"}</td><td style={{padding:6,borderTop:"1px solid var(--border-color,#d5dce5)"}}>{row.error||"—"}</td></tr>)}</tbody></table></div></>}</section>
  </>}
  {activeTab==="structure"&&<>
  <section style={styles.panel}><h3 style={{margin:0}}>Draft site structure creator</h3><p style={{margin:0}}>Creates only missing WordPress draft pages, categories, tags and a separate draft navigation record. Existing content is skipped; the live menu is never changed.</p><button style={styles.primary} type="button" disabled={busy||!connected} onClick={createSiteStructure}>Create missing draft site structure</button></section>
  </>}
  {activeTab==="pages"&&<>
  <section style={styles.panel}><h3 style={{margin:0}}>Website Studio</h3><p style={{margin:0}}>Edit existing WordPress pages and posts as drafts, preview on a phone, and inspect revision history. Public publishing remains gated by independent approval.</p><div role="status" aria-live="polite"><strong>{status?.website==="connected"?"Connected":status?.website?"WordPress "+connectionLabel(status.website).toLowerCase():busy?"Checking WordPress connection…":"WordPress not checked"}</strong></div><p style={{margin:0}}>If WordPress is not configured, an authorised administrator should verify these existing Worker secrets (do not share their values):</p><ul>{SECRETS.map(x=><li key={x}><code>{x}</code></li>)}</ul><button style={styles.primary} type="button" disabled={busy} onClick={connect}>{busy?"Checking connection…":"Check WordPress connection"}</button>{status&&<section style={{display:"grid",gap:10,border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:12}}><h4 style={{margin:0}}>Connection diagnostics</h4><div><strong>Worker environment: {status.workerEnvironment||"unknown"} · {status.workerName||"unknown"}</strong><ul style={{marginTop:4}}><li>Configured WordPress host: {status.configuredWordPressHost||"not supplied"}</li><li>Diagnostic classification: {status.websiteHostGuardBlocked?"Blocked by IRPA host guard":status.websiteDiagnosticCategory==="wordpress_http_response"?"Response received from WordPress/HTTP intermediary":status.websiteDiagnosticCategory||"not checked"}</li><li>Secrets bound to this Worker: {String(status.secretChecks?.boundToServingWorkerEnvironment??"not verified")}</li>{status.secretChecks?.format&&<><li>Base URL: HTTPS {String(status.secretChecks.format.baseUrl.https)}; trailing /wp-json: {String(status.secretChecks.format.baseUrl.hasWpJsonSuffix)}; origin-only after normalization: {String(status.secretChecks.format.baseUrl.canonicalOriginOnly)}</li><li>Username: {status.secretChecks.format.username.present?"set":"missing"}, {status.secretChecks.format.username.length} characters</li><li>Application Password: {status.secretChecks.format.applicationPassword.present?"set":"missing"}, {status.secretChecks.format.applicationPassword.length} characters after whitespace removal; contains spaces: {String(status.secretChecks.format.applicationPassword.containsSpaces)}; expected 24 characters: {String(status.secretChecks.format.applicationPassword.expectedLength)}</li></>}</ul></div><div><strong>WordPress: {connectionLabel(status.website)}</strong><ul style={{marginTop:4}}><li>HTTP status: {status.websiteHttpStatus??"Not available"}</li><li>Final URL: {status.websiteFinalUrl||"Not available"}</li><li>Redirect count: {status.websiteRedirectCount??"Not available"}</li>{status.websiteRedirectTarget&&<li>Redirect target: {status.websiteRedirectTarget}</li>}{status.websiteRedirectFinding&&<li>Redirect finding: {status.websiteRedirectFinding}</li>}<li>WordPress error code: {status.websiteErrorCode||"Not supplied"}</li><li>WordPress error message: {status.websiteErrorMessage||"Not supplied"}</li>{status.websiteDiagnosticMessage&&<li>Finding: {status.websiteDiagnosticMessage}</li>}<li>Response type: {status.websiteResponseType||"Not supplied"}</li><li>WWW-Authenticate present: {String(status.websiteWwwAuthenticatePresent??"unknown")}</li><li>Cloudflare auth-bridge diagnostic: {status.websiteAuthBridgeDiagnostic||"Not supplied"}</li><li>Cloudflare Ray ID: {status.websiteCloudflareRay||"Not supplied"}</li>{status.websiteAccount&&<li>Account role: {status.websiteAccount.role||"unverified"}; can edit posts: {String(status.websiteAccount.canEditPosts??"unknown")}; can edit pages: {String(status.websiteAccount.canEditPages??"unknown")}; upload_files: {status.websiteAccount.uploadFilesCapability||"unknown"}</li>}</ul></div>{status.websitePublicRest&&<div><strong>Unauthenticated GET /wp-json/</strong><ul style={{marginTop:4}}><li>HTTP status: {status.websitePublicRest.status??status.websitePublicRest.error??"Not available"}</li><li>Final URL: {status.websitePublicRest.finalUrl||"Not available"}</li><li>Redirect count: {status.websitePublicRest.redirectCount??"Not available"}</li><li>Content type: {status.websitePublicRest.contentType||"Not supplied"}</li><li>WWW-Authenticate present: {String(status.websitePublicRest.wwwAuthenticatePresent??"unknown")}</li><li>WordPress error: {status.websitePublicRest.errorCode||"none"} {status.websitePublicRest.errorMessage||""}</li></ul></div>}{status.cpanelDiagnostics&&<div><strong>Read-only cPanel probes</strong><ul style={{marginTop:4}}><li>Email accounts: {status.cpanelDiagnostics.emailAccounts?.status||"not available"} · {status.cpanelDiagnostics.emailAccounts?.count??"—"} listed · {status.cpanelDiagnostics.emailAccounts?.accounts?.join(", ")||"no account names returned"}</li><li>SSL: {status.cpanelDiagnostics.ssl?.status||"not available"} · {status.cpanelDiagnostics.ssl?.hosts?.map(host=>host.domain+" ("+host.status+")").join(", ")||"no matching host record"}</li><li>upload_max_filesize: {status.cpanelDiagnostics.phpLimits?.upload_max_filesize||"not readable"}</li><li>post_max_size: {status.cpanelDiagnostics.phpLimits?.post_max_size||"not readable"}</li>{status.cpanelDiagnostics.error&&<li>{status.cpanelDiagnostics.error}</li>}</ul></div>}<div><strong>cPanel: {connectionLabel(status.cpanel)}</strong><ul style={{marginTop:4}}><li>Diagnostic code: {status.cpanelDiagnostic||"Not supplied"}</li><li>HTTP status: {status.cpanelHttpStatus??"Not available"}</li>{status.cpanelUapiStatus!==undefined&&<li>cPanel API status: {String(status.cpanelUapiStatus)}</li>}{status.cpanelApiErrorCount!==undefined&&<li>API error count: {status.cpanelApiErrorCount}</li>}{status.cpanelDiagnosticMessage&&<li>Finding: {status.cpanelDiagnosticMessage}</li>}</ul></div><details><summary>Raw connection response (sanitized, maximum 1 KB per response)</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12}}>{status.websiteRawResponse||"(no authenticated response body captured)"}{status.websitePublicRest?.rawResponse?"\n\nUnauthenticated /wp-json/ response:\n"+status.websitePublicRest.rawResponse:""}</pre></details></section>}</section>
  <section style={styles.panel}><h3 style={{margin:0}}>Pages and posts</h3><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button style={type==="pages"?styles.primary:styles.button} type="button" onClick={()=>load("pages")} disabled={busy}>Pages</button><button style={type==="posts"?styles.primary:styles.button} type="button" onClick={()=>load("posts")} disabled={busy}>Posts</button><button style={styles.button} type="button" onClick={()=>load(type)} disabled={busy}>Refresh</button><button style={styles.primary} type="button" onClick={openNewPost} disabled={busy}>New update</button></div>{items.map(item=><article key={item.id} style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10,display:"grid",gap:6}}><strong>{item.title||"(Untitled)"} · #{item.id}</strong><span>{item.status||"draft"}{item.link?" · "+item.link:""}</span><button style={styles.button} type="button" onClick={()=>setEdit({...item,content:item.content||"",excerpt:item.excerpt||"",featuredMedia:item.featuredMedia||0,uploadedImages:[]})}>Edit draft</button></article>)}</section>
  {newPost&&<section style={styles.panel}><h3 style={{margin:0}}>New website update · WordPress draft</h3><p style={{margin:0}}>This creates a new post with status fixed to Draft by the gateway. It does not publish or approve the update.</p><label>Title<input style={styles.field} maxLength={180} value={newPost.title} onChange={e=>setNewPost({...newPost,title:e.target.value})}/></label><label>Publication language<select style={styles.field} value={newPost.language||"English"} onChange={e=>setNewPost({...newPost,language:e.target.value})}><option value="English">English</option><option value="Kiswahili">Kiswahili</option></select></label><label>Body (HTML; headings, paragraphs, lists and image figures supported)<textarea style={{...styles.field,minHeight:220}} maxLength={30000} value={newPost.content} onChange={e=>setNewPost({...newPost,content:e.target.value})}/></label><label>Excerpt<textarea style={styles.field} maxLength={600} value={newPost.excerpt} onChange={e=>setNewPost({...newPost,excerpt:e.target.value})}/></label><section style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10,display:"grid",gap:8}}><strong>Yoast SEO metadata</strong>{seoCapabilities?.metaDescription?<label>Meta description<input style={styles.field} maxLength={160} value={newPost.seoMetaDescription||""} onChange={e=>setNewPost({...newPost,seoMetaDescription:e.target.value})}/></label>:<p style={{margin:0,fontSize:13}}>{seoCapabilities?.verified===false?"The WordPress REST schema could not be checked. Add the meta description in the WordPress editor after draft creation; Website Studio will not guess or bypass the REST API.":"Meta description is not exposed as writable WordPress REST meta on this site. Add it in the WordPress editor after draft creation; Website Studio will not bypass the REST API."}</p>}{seoCapabilities?.focusKeyphrase?<label>Focus keyphrase<input style={styles.field} maxLength={100} value={newPost.seoFocusKeyphrase||""} onChange={e=>setNewPost({...newPost,seoFocusKeyphrase:e.target.value})}/></label>:<p style={{margin:0,fontSize:13}}>{seoCapabilities?.verified===false?"The WordPress REST schema could not be checked. Add the focus keyphrase in the WordPress editor after draft creation; Website Studio will not guess or bypass the REST API.":"Focus keyphrase is not exposed as writable WordPress REST meta on this site. Add it in the WordPress editor after draft creation; no plugin or configuration change is made."}</p>}</section><label>Categories<select multiple size={Math.min(8,Math.max(3,taxonomies.categories.length))} style={{...styles.field,minHeight:100}} value={newPost.categories.map(String)} onChange={e=>setNewPost({...newPost,categories:Array.from(e.target.selectedOptions).map(option=>Number(option.value))})}>{taxonomies.categories.map(term=><option key={term.id} value={term.id}>{term.name}</option>)}</select></label><label>Tags<select multiple size={Math.min(8,Math.max(3,taxonomies.tags.length))} style={{...styles.field,minHeight:100}} value={newPost.tags.map(String)} onChange={e=>setNewPost({...newPost,tags:Array.from(e.target.selectedOptions).map(option=>Number(option.value))})}>{taxonomies.tags.map(term=><option key={term.id} value={term.id}>{term.name}</option>)}</select></label><section style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10,display:"grid",gap:8}}><strong>Featured image and article photos</strong><p style={{margin:0,fontSize:13}}>Select multiple JPEG, PNG or WebP images (gateway-enforced per-file limit; default 5 MiB). You will be asked for required alt text and an optional caption for each image. The first uploaded image becomes the featured image unless you select another attachment in the editor.</p><label>Upload images<input style={styles.field} type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{void uploadPhotos(e.target.files,"new");e.target.value=""}}/></label>{uploadProgress.map(row=><div key={row.key} role="status" style={{fontSize:12}}>{row.name}: {row.status}</div>)}<label>Featured image<select style={styles.field} value={String(newPost.featuredMedia||0)} onChange={e=>setNewPost({...newPost,featuredMedia:Number(e.target.value||0)})}><option value="0">No featured image</option>{(newPost.uploadedImages||[]).map(image=><option key={image.id} value={image.id}>#{image.id} · {image.altText}</option>)}</select></label></section><section style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10,display:"grid",gap:8}}><strong>Video embed</strong><label>YouTube or Vimeo URL<input style={styles.field} type="url" placeholder="https://www.youtube.com/watch?v=…" value={newPost.videoUrl||""} onChange={e=>setNewPost({...newPost,videoUrl:e.target.value})}/></label><button type="button" style={styles.button} onClick={()=>{try{const url=new URL(newPost.videoUrl);if(url.protocol!=="https:"||url.username||url.password||url.port||!["youtube.com","www.youtube.com","youtu.be","vimeo.com","www.vimeo.com","player.vimeo.com"].includes(url.hostname.toLowerCase()))throw new Error();setNewPost({...newPost,content:String(newPost.content||"")+(newPost.content?"\\n\\n":"")+"<p>"+url.href+"</p>",videoUrl:""})}catch{setMessage("Enter a valid HTTPS YouTube or Vimeo URL.")}}}>Insert video embed link</button><p style={{margin:0,fontSize:12}}>The standalone URL is saved for WordPress oEmbed rendering. Large video files are not uploaded to WordPress.</p></section><section style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10,display:"grid",gap:8}}><strong>Phone preview · unsaved</strong><div style={{width:"100%",maxWidth:390,margin:"0 auto",border:"8px solid #1f2937",borderRadius:24,overflow:"hidden",background:"#fff"}}><iframe title="New update phone preview" sandbox="" referrerPolicy="no-referrer" style={{width:"100%",height:560,border:0,background:"#fff"}} srcDoc={"<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font:16px/1.55 system-ui,sans-serif;margin:16px;color:#172033}img{max-width:100%;height:auto}h1,h2,h3{line-height:1.2}</style></head><body><h1>"+String(newPost.title||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</h1>"+String(newPost.content||"")+"</body></html>"}/></div></section><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button style={styles.primary} type="button" disabled={busy||!newPost.title.trim()||!newPost.content.trim()} onClick={createNewPost}>{busy?"Saving…":"Create WordPress draft"}</button><button style={styles.button} type="button" disabled={busy} onClick={()=>setNewPost(null)}>Cancel</button></div></section>}
  {approvalReady&&<section style={styles.panel}><h3 style={{margin:0}}>Approval-ready website draft</h3><p><strong>Status:</strong> {approvalReady.status}</p><p><strong>WordPress post:</strong> #{approvalReady.postId} · <strong>Editorial record:</strong> {approvalReady.editorialId}</p><h4 style={{margin:"4px 0"}}>Change summary</h4><ul style={{marginTop:0}}><li>Title: {approvalReady.title}</li><li>Excerpt: {approvalReady.excerpt||"Not supplied"}</li><li>Language: {approvalReady.language}</li><li>Selected categories: {approvalReady.categoryCount}; tags: {approvalReady.tagCount}</li><li>Images: {approvalReady.imageCount}; featured media ID: {approvalReady.featuredMedia||"None"}</li></ul><strong>Mobile preview</strong><div style={{width:"100%",maxWidth:390,margin:"0 auto",border:"8px solid #1f2937",borderRadius:24,overflow:"hidden",background:"#fff"}}><iframe title="Approval-ready update preview" sandbox="" referrerPolicy="no-referrer" style={{width:"100%",height:560,border:0,background:"#fff"}} srcDoc={"<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font:16px/1.55 system-ui,sans-serif;margin:16px;color:#172033}img{max-width:100%;height:auto}</style></head><body><h1>"+String(approvalReady.title||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</h1>"+String(approvalReady.content||"")+"</body></html>"}/></div>{approvalReady.status==="Draft"?<button style={styles.primary} type="button" disabled={busy} onClick={submitForApproval}>{busy?"Submitting…":"Submit for approval"}</button>:<p role="status">This item is in the existing independent approval queue. Website Studio cannot publish it.</p>}</section>}
  {edit&&<section style={styles.panel}><h3 style={{margin:0}}>Edit {type==="pages"?"page":"post"} #{edit.id}</h3><label>Title<input style={styles.field} value={edit.title||""} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><section style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10,display:"grid",gap:8}}><strong>Article photos</strong><p style={{margin:0,fontSize:13}}>Upload multiple JPEG, PNG or WebP images (gateway-enforced per-file limit; default 5 MiB). Each image requires alt text and can have a caption.</p><label>Choose photos<input style={styles.field} type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{void uploadPhotos(e.target.files,"edit");e.target.value=""}}/></label>{uploadProgress.map(row=><div key={row.key} role="status" style={{fontSize:12}}>{row.name}: {row.status}</div>)}</section><label>Content<textarea style={{...styles.field,minHeight:170}} value={edit.content||""} onChange={e=>setEdit({...edit,content:e.target.value})}/></label><label>Excerpt<textarea style={styles.field} value={edit.excerpt||""} onChange={e=>setEdit({...edit,excerpt:e.target.value})}/></label><div style={{border:"1px solid var(--border-color,#d5dce5)",borderRadius:8,padding:10}}><strong>Phone preview</strong><h4>{edit.title}</h4><div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{String(edit.content||"").replace(/<[^>]*>/g," ")}</div></div><button style={styles.primary} type="button" disabled={busy} onClick={save}>Save as draft</button><button style={styles.button} type="button" onClick={()=>setEdit(null)}>Close editor</button></section>}
  </>}
  {message&&<div role="status" style={styles.panel} aria-live="polite">{message}</div>}
 </section>
}
