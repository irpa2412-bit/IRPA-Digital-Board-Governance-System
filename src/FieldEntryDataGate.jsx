import React,{useEffect,useState}from"react";

const DATA_TYPES=[
  ["governance","Governance, meetings and resolutions"],
  ["finance","Finance, payments and accounting"],
  ["procurement","Procurement, quotations and contracts"],
  ["personnel","Members, employees and personnel"],
  ["signatures","Signatures, approvals and audit records"],
  ["system","System settings and security configuration"],
  ["documents","Documents, correspondence and files"],
  ["operations","Field operations, projects and assets"],
  ["other","Other / not listed"]
];
const ENVIRONMENTS=[["TRIAL","Trial data — testing and demonstrations"],["ACTUAL","Actual data — official institutional records"]];
const ACTUAL_ONLY_TYPES=new Set(["personnel","signatures","system"]);
const ACTUAL_ONLY_PORTAL_HINT=/member|personnel|employee|signature|signer|auditor|security|system settings|administrator|authorization|approval/i;
const portalRequiresActual=portal=>ACTUAL_ONLY_PORTAL_HINT.test(String(portal||""));
const verificationMapKey="irpaPortalDataEntryVerifications";

export default function FieldEntryDataGate({portal}){
  const currentPortal=String(portal||"Dashboard").trim().replace(/\s+/g," ").slice(0,100)||"Dashboard";
  const[field,setField]=useState(null);
  const[dataType,setDataType]=useState("");
  const[environment,setEnvironment]=useState("");
  const[confirmed,setConfirmed]=useState(false);
  const[storageError,setStorageError]=useState("");
  const actualOnly=ACTUAL_ONLY_TYPES.has(dataType)||portalRequiresActual(currentPortal);

  useEffect(()=>{
    setStorageError("");
    let verified=false;
    try{
      const records=JSON.parse(window.sessionStorage.getItem(verificationMapKey)||"{}");
      verified=Boolean(records&&records[currentPortal]);
    }catch{
      setStorageError("This browser session could not read the verification record. Enable session storage and retry.");
    }
    setDataType("");
    setEnvironment("");
    setConfirmed(false);
    if(verified){
      setField(null);
      return;
    }
    setField({portal:currentPortal});
  },[currentPortal]);

  const proceed=()=>{
    if(!field||!dataType||!environment||(environment==="ACTUAL"&&!confirmed))return;
    if(actualOnly&&environment!=="ACTUAL")return;
    const selectedEnvironment=actualOnly?"ACTUAL":environment;
    const verifiedAt=new Date().toISOString();
    const record={dataType,environment:selectedEnvironment,portal:currentPortal,verifiedAt};
    try{
      const existing=JSON.parse(window.sessionStorage.getItem(verificationMapKey)||"{}");
      window.sessionStorage.setItem(verificationMapKey,JSON.stringify({...existing,[currentPortal]:record}));
      window.sessionStorage.setItem("irpaFieldEntryVerification",JSON.stringify(record));
      window.sessionStorage.setItem("irpaDataTypeVerified",dataType);
      window.sessionStorage.setItem("irpaDataEnvironment",selectedEnvironment);
      window.sessionStorage.setItem("irpaDataEnvironmentTarget",currentPortal);
      window.sessionStorage.setItem("irpaDataEnvironmentSelectedAt",verifiedAt);
      window.sessionStorage.setItem("irpaIdentityDataEnvironment","ACTUAL");
    }catch{
      setStorageError("Verification could not be saved in this browser session. The gate remains locked; enable session storage and retry.");
      return;
    }
    setField(null);
  };

  if(!field)return null;
  const disabled=!dataType||!environment||(environment==="ACTUAL"&&!confirmed)||(actualOnly&&environment!=="ACTUAL");
  return <div data-irpa-field-gate role="dialog" aria-modal="true" aria-labelledby="irpa-field-gate-title" onKeyDown={e=>{if(e.key==="Escape")e.preventDefault();}} style={{position:"fixed",inset:0,zIndex:30000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"rgba(3,12,10,.78)",backdropFilter:"blur(5px)",overflowY:"auto"}}>
    <section style={{width:"min(100%,680px)",maxHeight:"92vh",overflowY:"auto",background:"var(--surface, #fff)",color:"var(--text, #14231f)",border:"1px solid var(--border, #cbd5d1)",borderRadius:18,padding:24,boxShadow:"0 24px 80px rgba(0,0,0,.35)"}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:1.4,textTransform:"uppercase",opacity:.75}}>IRPA · Data Control</div>
      <h2 id="irpa-field-gate-title" style={{margin:"8px 0 6px",fontSize:25}}>Confirm this portal’s data environment</h2>
      <p style={{margin:"0 0 16px",lineHeight:1.5}}>This gate opens when a portal or sub-portal is selected. Confirm its data environment once to enable data entry throughout this portal for the current browser session. Each different portal or sub-portal is verified separately.</p>
      <div style={{padding:12,borderRadius:10,background:"var(--surface-muted, #f1f5f3)",marginBottom:18}}>
        <strong>Selected portal / sub-portal:</strong> {currentPortal}
      </div>
      <fieldset style={{border:0,padding:0,margin:"0 0 18px"}}>
        <legend style={{fontWeight:750,marginBottom:10}}>1. What type of data will this portal handle? (Required)</legend>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
          {DATA_TYPES.map(([value,label])=><label key={value} style={{display:"flex",alignItems:"flex-start",gap:9,padding:11,border:"1px solid var(--border, #cbd5d1)",borderRadius:9,cursor:"pointer"}}>
            <input type="radio" name="irpa-data-type" value={value} checked={dataType===value} onChange={()=>{setDataType(value);if(ACTUAL_ONLY_TYPES.has(value)||portalRequiresActual(currentPortal)){setEnvironment("ACTUAL");setConfirmed(false)}else if(environment==="ACTUAL"){setConfirmed(false)}}} style={{marginTop:3}}/>
            <span>{label}</span>
          </label>)}
        </div>
      </fieldset>
      <fieldset style={{border:0,padding:0,margin:"0 0 16px"}}>
        <legend style={{fontWeight:750,marginBottom:10}}>2. Select the data environment (Required)</legend>
        {ENVIRONMENTS.map(([value,label])=><label key={value} style={{display:"flex",alignItems:"flex-start",gap:9,padding:"10px 0",cursor:actualOnly&&value==="TRIAL"?"not-allowed":"pointer",opacity:actualOnly&&value==="TRIAL"?.5:1}}>
          <input type="radio" name="irpa-data-environment" value={value} disabled={actualOnly&&value==="TRIAL"} checked={environment===value} onChange={()=>{setEnvironment(value);setConfirmed(false)}} style={{marginTop:3}}/>
          <span>{label}{actualOnly&&value==="TRIAL"?" — unavailable for protected identity/security records":""}</span>
        </label>)}
      </fieldset>
      {actualOnly&&<p style={{padding:12,borderRadius:9,background:"var(--surface-muted, #f1f5f3)",lineHeight:1.45}}>This portal or data category is reserved for protected identity, personnel, signer/signature, auditor, authorization or system-security records. It must remain in ACTUAL DATA.</p>}
      {environment==="ACTUAL"&&<label style={{display:"flex",alignItems:"flex-start",gap:10,padding:12,border:"1px solid #b7791f",borderRadius:9,marginBottom:16}}>
        <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} style={{marginTop:3}}/>
        <span>I confirm this portal’s data-entry environment for this session. This selection authorises data entry throughout this portal/sub-portal. If ACTUAL DATA is selected, I understand changes may affect live institutional records.</span>
      </label>}
      {environment==="TRIAL"&&<p style={{padding:12,borderRadius:9,background:"var(--surface-muted, #f1f5f3)",lineHeight:1.45}}>Use test records only. Do not enter confidential live information into trial records. Identity and security configuration remain in ACTUAL DATA.</p>}
      {storageError&&<p role="alert" style={{padding:12,borderRadius:9,background:"#fff1f0",color:"#9b1c1c"}}>{storageError}</p>}
      <button type="button" disabled={disabled} onClick={proceed} style={{width:"100%",minHeight:46,marginTop:8,border:0,borderRadius:9,fontWeight:800,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.55:1}}>Confirm environment and enter portal</button>
    </section>
  </div>;
}
