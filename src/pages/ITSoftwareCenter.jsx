import React,{useEffect,useState}from"react";
import{db}from"../firebase/config";
import{doc,getDoc}from"firebase/firestore";

const SOFTWARE=[
 {name:"IT Service Desk / ITSM",scope:"Requests, incidents, maintenance, security events, website work and change requests.",state:"Operational",entry:"IT Operations"},
 {name:"Identity & Access Management",scope:"Authentication, role-based access, departmental authorization and Firestore security rules.",state:"Operational",entry:"Authentication / Access Control"},
 {name:"Document & Records System",scope:"Controlled documents, PDF processing, reference numbers, records and audit evidence.",state:"Operational",entry:"Documents"},
 {name:"Reporting & Spreadsheet Engine",scope:"Operational reports, Excel/XLSX data handling and management outputs.",state:"Operational",entry:"Reports"},
 {name:"Meeting & Collaboration",scope:"Meeting room, LiveKit video infrastructure, subscriptions and transcription services.",state:"Operational",entry:"Meetings"},
 {name:"Website Communications Bridge",scope:"Controlled IT-to-website notices with explicit publication status and boundary controls.",state:"Operational",entry:"Website Bridge"},
 {name:"Security & Audit Controls",scope:"Audit trail, security-event handling, access review and controlled change evidence.",state:"Operational",entry:"Audit Trail"},
 {name:"Backup & Recovery Controls",scope:"Data continuity, backup/recovery governance and restoration evidence.",state:"Control Framework",entry:"Governance & QA"},
 {name:"IT Asset & Vendor Register",scope:"Devices, software licences, subscriptions, warranties, ownership and vendor lifecycle.",state:"Control Framework",entry:"IT Asset & Vendor Management"},
 {name:"Monitoring & Availability",scope:"Production hosting verification, application checks and Cloudflare gateway operations.",state:"Operational",entry:"Operations Verification"},
 {name:"Release & Deployment Toolchain",scope:"GitHub Actions, Firebase deployment tooling, Vite build and Cloudflare Wrangler.",state:"Operational",entry:"DevOps / Release"},
 {name:"Mobile Application Toolchain",scope:"Capacitor Android runtime and Android build/deployment support.",state:"Operational",entry:"Android / Mobile"}
];

export default function ITSoftwareCenter(){
 const[firebase,setFirebase]=useState("Checking…");
 const[time,setTime]=useState(new Date());
 useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t)},[]);
 useEffect(()=>{let alive=true;(async()=>{try{await getDoc(doc(db,"systemSettings","softwareReadiness"));if(alive)setFirebase("Connected")}catch(e){if(alive)setFirebase(e?.code==="permission-denied"?"Protected / reachable":"Check required")}})();return()=>{alive=false}},[]);
 return <section className="panel" style={{marginTop:18}}>
  <div className="panel-heading"><div><span className="eyebrow">IT SOFTWARE & OPERATIONS CENTER</span><h2>Installed Software & Operational Systems</h2><p className="muted">The IT Department uses the DBGS core stack plus native operational modules. This inventory separates software that is operational now from controls that still require departmental records and configuration.</p></div><div className="identity-card"><span>Runtime connectivity</span><strong>{firebase}</strong><small>Browser check · {time.toLocaleTimeString()}</small></div></div>
  <div className="dashboard-grid" style={{marginTop:16}}>{SOFTWARE.map(s=><div className="stat-card" key={s.name}><span>{s.state.toUpperCase()}</span><strong>{s.name}</strong><small>{s.scope}</small><small style={{marginTop:8}}>System: <b>{s.entry}</b></small></div>)}</div>
  <div className="auth-message" style={{marginTop:16}}><strong>Core installed technology</strong><br/>React/Vite application runtime · Firebase/Firestore · Firebase CLI deployment tooling · Cloudflare Wrangler gateway tooling · PDF/PDF.js processing · XLSX spreadsheet engine · LiveKit collaboration client · Capacitor Android runtime/build tooling · TypeScript · automated CI/CD and production verification.</div>
  <div className="auth-message" style={{marginTop:12}}><strong>Operational completion status</strong><br/>The software foundation is installed. The remaining departmental work is configuration and population of operational registers—especially IT assets, backup schedules/recovery evidence and monitoring thresholds—not installation of another application stack.</div>
 </section>;
}
