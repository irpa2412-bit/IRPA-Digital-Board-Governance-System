import React,{useState}from"react";
import OrganisationalWorkingRelationships from "../pages/OrganisationalWorkingRelationships";
export default function OrganisationalRelationshipSupport({user,isAdmin=false,activePortal="",onNavigate}){
 const[open,setOpen]=useState(false);
 return <section className="organisational-relationship-support" aria-label="Organisational working relationship support" style={{margin:"12px 0 16px",border:"1px solid var(--border-color,#cbd5e1)",borderRadius:12,background:"var(--surface,#fff)",color:"var(--text-primary,#172033)",overflow:"hidden"}}>
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 14px",flexWrap:"wrap"}}>
   <div><strong>Organisational Working Relationships</strong><div style={{fontSize:12,marginTop:3,opacity:.85}}>Authenticated supervisory context · responsibilities · progress reporting · {activePortal||"IRPA portal"}</div></div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" onClick={()=>onNavigate?.("Authorization & Approvals")} style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--border-color,#94a3b8)",background:"var(--surface-elevated,#f8fafc)",color:"inherit",font:"inherit",fontWeight:650}}>Open Authorisation & Approval</button><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--border-color,#94a3b8)",background:"var(--surface-elevated,#f8fafc)",color:"inherit",font:"inherit",fontWeight:650}}>{open?"Close relationship support":"Open relationship support"}</button></div>
  </div>
  {open&&<div style={{borderTop:"1px solid var(--border-color,#cbd5e1)",padding:"8px 12px 12px"}}><OrganisationalWorkingRelationships user={user} profile={profile} employee={employee} isAdmin={isAdmin}/></div>}
 </section>;
}
