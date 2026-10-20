import React,{useEffect,useMemo,useState}from"react";
import{addDoc,collection,getDocs,serverTimestamp}from"firebase/firestore";
import{auth,db}from"../firebase/config";

const panel={border:"1px solid var(--border-color, #64748b)",borderRadius:14,padding:18,marginTop:18};
const field={display:"grid",gap:6,minWidth:0};
const input={width:"100%",boxSizing:"border-box",padding:"10px 12px",border:"1px solid #64748b",borderRadius:8,background:"var(--input-bg, #fff)",color:"var(--text-color, #111827)",minHeight:42};
const btn={padding:"10px 14px",borderRadius:8,border:"1px solid #64748b",cursor:"pointer",minHeight:42};
const clean=value=>String(value??"").trim();
const norm=value=>clean(value).toLocaleLowerCase("en").replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();

export default function DepartmentPortalBuilder({reservedNames=[],onCreated=()=>{}}){
 const[departments,setDepartments]=useState([]),[archives,setArchives]=useState([]),[portals,setPortals]=useState([]);
 const[name,setName]=useState(""),[departmentId,setDepartmentId]=useState(""),[description,setDescription]=useState("");
 const[roles,setRoles]=useState(""),[archiveId,setArchiveId]=useState("");
 const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 useEffect(()=>{let disposed=false;(async()=>{setLoading(true);setError("");try{
  const [departmentSnap,archiveSnap,portalSnap]=await Promise.all([
   getDocs(collection(db,"institutionalDepartments")),
   getDocs(collection(db,"departmentArchives")),
   getDocs(collection(db,"portalDefinitions"))
  ]);
  if(disposed)return;
  setDepartments(departmentSnap.docs.map(d=>({id:d.id,...d.data()})).filter(d=>String(d.status||"").toLowerCase()==="active").sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))));
  setArchives(archiveSnap.docs.map(d=>({id:d.id,...d.data()})).filter(a=>String(a.status||"").toLowerCase()==="active"));
  setPortals(portalSnap.docs.map(d=>({id:d.id,...d.data()})));
 }catch(e){if(!disposed)setError(e?.message||"Could not load department, archive and portal registries.");}finally{if(!disposed)setLoading(false);}})();return()=>{disposed=true}},[]);
 const selectedDepartment=departments.find(d=>d.id===departmentId);
 const departmentArchives=useMemo(()=>archives.filter(a=>a.departmentId===departmentId),[archives,departmentId]);
 const duplicate=useMemo(()=>{const candidate=norm(name);return Boolean(candidate&&(reservedNames.some(n=>norm(n)===candidate)||portals.some(p=>norm(p.name)===candidate)));},[name,reservedNames,portals]);
 async function createPortal(event){
  event.preventDefault();setError("");setMessage("");
  const portalName=clean(name),detail=clean(description);
  if(!portalName||!selectedDepartment){setError("Enter a portal name and select an active registered department.");return;}
  if(duplicate){setError("That portal name already exists. Choose a unique name that does not duplicate an existing module.");return;}
  if(!auth.currentUser){setError("Your authenticated administrator session is unavailable. Sign in again.");return;}
  setBusy(true);
  try{
   const selectedArchive=archives.find(a=>a.id===archiveId&&a.departmentId===departmentId);
   const allowedRoles=[...new Set(roles.split(",").map(clean).filter(Boolean))];
   const record={
    recordType:"Department Portal Definition",
    name:portalName,
    slug:norm(portalName).replace(/\s+/g,"-"),
    departmentId:selectedDepartment.id,
    departmentName:selectedDepartment.name,
    description:detail,
    allowedRoles,
    archiveId:selectedArchive?.id||"",
    archiveName:selectedArchive?.name||"",
    driveFolderId:selectedArchive?.driveProvisioningStatus==="VERIFIED"?String(selectedArchive.driveFolderId||""):"",
    driveProvisioningStatus:selectedArchive?.driveProvisioningStatus==="VERIFIED"&&selectedArchive.driveFolderId?"VERIFIED":"NOT_PROVISIONED",
    status:"Active",
    createdByUid:auth.currentUser.uid,
    createdByEmail:auth.currentUser.email||"",
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp(),
    recordOrigin:"PRODUCTION"
   };
   const ref=await addDoc(collection(db,"portalDefinitions"),record);
   const saved={...record,id:ref.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
   setPortals(current=>[...current,saved]);setName("");setDescription("");setRoles("");setArchiveId("");
   setMessage("Portal registered. Its navigation entry is now generated for the assigned department; specialized workflows and Drive access still require their own configuration and permissions.");
   onCreated(saved);
  }catch(e){setError(e?.message||"Portal creation failed. No portal success is being reported.");}
  finally{setBusy(false);}
 }
 return <div data-active-portal-content>
  <section style={panel} aria-labelledby="department-portal-builder-title">
   <div className="panel-header"><div><span className="eyebrow">ADMINISTRATOR · INSTITUTIONAL STRUCTURE</span><h2 id="department-portal-builder-title">Department Portal Builder</h2></div></div>
   <p>Create a navigation portal linked to an active department and, optionally, its registered archive. Creation registers the portal and its access metadata; it does not provision Google Drive folders, change Drive permissions, or create specialized workflow functionality.</p>
   {loading&&<p role="status">Loading department, archive and portal registries…</p>}
   {error&&<p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
   {message&&<p role="status">{message}</p>}
   <form onSubmit={createPortal} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))",gap:14}}>
    <label style={field}><span>Portal name *</span><input style={input} value={name} onChange={e=>setName(e.target.value)} maxLength={80} required placeholder="e.g. Monitoring and Evaluation Portal"/></label>
    <label style={field}><span>Owning department *</span><select style={input} value={departmentId} onChange={e=>{setDepartmentId(e.target.value);setArchiveId("");}} required><option value="">Select active department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}</select></label>
    <label style={field}><span>Linked department archive (optional)</span><select style={input} value={archiveId} onChange={e=>setArchiveId(e.target.value)}><option value="">No archive linked</option>{departmentArchives.map(a=><option key={a.id} value={a.id}>{a.name} · Drive: {a.driveProvisioningStatus||"NOT_PROVISIONED"}</option>)}</select></label>
    <label style={field}><span>Allowed roles (comma-separated, optional)</span><input style={input} value={roles} onChange={e=>setRoles(e.target.value)} maxLength={500} placeholder="e.g. Research Officer, Research Manager"/></label>
    <label style={{...field,gridColumn:"1 / -1"}}><span>Portal purpose / description</span><textarea style={{...input,minHeight:90,resize:"vertical"}} value={description} onChange={e=>setDescription(e.target.value)} maxLength={1500} placeholder="Describe the department work this portal will support."/></label>
    <div style={{gridColumn:"1 / -1",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><button type="submit" style={btn} disabled={loading||busy||!departments.length||duplicate}>{busy?"Creating portal…":"Create Department Portal"}</button>{duplicate&&<span role="status">That name is already registered or reserved.</span>}</div>
   </form>
  </section>
  <section style={panel} aria-labelledby="registered-department-portals-title">
   <div className="panel-header"><div><span className="eyebrow">PORTAL REGISTRY</span><h3 id="registered-department-portals-title">Registered department portals</h3></div></div>
   {!portals.length&&!loading&&<p>No department portals have been registered yet.</p>}
   <div style={{display:"grid",gap:10}}>{portals.map(p=><article className="stat-card" key={p.id}><strong>{p.name}</strong><p style={{margin:"5px 0"}}>Department: {p.departmentName||"Unassigned"} · Status: {p.status||"Unknown"}</p><small>Archive: {p.archiveName||"Not linked"} · Drive status: {p.driveProvisioningStatus||"NOT_PROVISIONED"}</small></article>)}</div>
  </section>
 </div>;
}

export function DepartmentPortalWorkspace({portal}){
 if(!portal)return null;
 const driveUrl=portal.driveProvisioningStatus==="VERIFIED"&&portal.driveFolderId? "https://drive.google.com/drive/folders/"+encodeURIComponent(portal.driveFolderId):"";
 return <section className="panel" data-active-portal-content aria-labelledby="registered-department-portal-title">
  <span className="eyebrow">DEPARTMENT WORKSPACE</span><h2 id="registered-department-portal-title">{portal.name}</h2>
  <p>{portal.description||"This portal has been registered for the owning department. Portal-specific workflow modules can be added as they are approved."}</p>
  <dl className="detail-grid"><div><dt>Owning department</dt><dd>{portal.departmentName||"Unassigned"}</dd></div><div><dt>Portal status</dt><dd>{portal.status||"Unknown"}</dd></div><div><dt>Archive registry</dt><dd>{portal.archiveName||"No archive linked"}</dd></div><div><dt>Google Drive provisioning</dt><dd>{portal.driveProvisioningStatus||"NOT_PROVISIONED"}</dd></div></dl>
  {driveUrl?<p><a href={driveUrl} target="_blank" rel="noreferrer">Open verified department Drive folder</a><br/><small>Drive access is still enforced by Google Drive's effective permissions.</small></p>:<p role="note">No verified Google Drive folder is linked to this portal yet. Use the Department and Archive Registry to provision and verify a supported archive before linking it.</p>}
 </section>;
}
