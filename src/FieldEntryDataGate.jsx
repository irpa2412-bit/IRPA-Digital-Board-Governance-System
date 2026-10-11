import React,{useEffect,useRef,useState}from"react";

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
const IGNORE_HINT=/search|filter|find|weather|forecast|navigation|time format|quick access|global menu/i;
const isEntryControl=el=>{
  if(!(el instanceof HTMLElement)||el.closest("[data-irpa-field-gate]"))return false;
  if(el.closest('[role="search"],[data-irpa-ignore-field-gate="true"]'))return false;
  const type=String(el.type||"").toLowerCase();
  if(["button","submit","reset","hidden","image","password","search"].includes(type))return false;
  if(!el.matches("textarea,select,[contenteditable='true'],[role='textbox'],input"))return false;
  const hint=[el.getAttribute("aria-label"),el.getAttribute("placeholder"),el.getAttribute("name"),el.id,el.getAttribute("data-label")].join(" ");
  if(IGNORE_HINT.test(hint))return false;
  const label=el.id?document.querySelector('label[for="'+CSS.escape(el.id)+'"]'):null;
  if(IGNORE_HINT.test(label?.innerText||""))return false;
  return true;
};
const isDiscreteControl=el=>el instanceof HTMLElement&&(el.matches("select,input[type='checkbox'],input[type='radio'],input[type='file'],input[type='date'],input[type='datetime-local'],input[type='month'],input[type='time'],input[type='week'],input[type='color'],input[type='range'],input[type='number']"));
const describeField=el=>{
  const id=el.id;
  const label=id?document.querySelector('label[for="'+CSS.escape(id)+'"]'):null;
  return String(label?.innerText||el.getAttribute("aria-label")||el.getAttribute("placeholder")||el.getAttribute("name")||el.getAttribute("data-label")||el.tagName.toLowerCase()).trim().slice(0,140);
};
const describePortal=()=>{
  const active=document.querySelector(".nav-item.active,[aria-current='page']");
  return String(active?.innerText||"Current portal").trim().replace(/\s+/g," ").slice(0,100);
};
export default function FieldEntryDataGate(){
  const[field,setField]=useState(null);
  const[dataType,setDataType]=useState("");
  const[environment,setEnvironment]=useState("");
  const[confirmed,setConfirmed]=useState(false);
  const[storageError,setStorageError]=useState("");
  const verified=useRef(new WeakSet());
  const pending=useRef(null);
  useEffect(()=>{
    const openFor=el=>{
      if(!isEntryControl(el)||verified.current.has(el))return false;
      if(pending.current)return true;
      pending.current=el;
      setDataType("");
      setEnvironment("");
      setConfirmed(false);
      setStorageError("");
      setField({element:el,label:describeField(el),portal});
      return true;
    };
    const onPointerDown=e=>{
      const el=e.target?.closest?.("input,textarea,select,[contenteditable='true'],[role='textbox']");
      if(!isDiscreteControl(el))return;
      if(openFor(el))e.preventDefault();
    };
    const onBeforeInput=e=>{
      const el=e.target;
      if(isDiscreteControl(el)||!isEntryControl(el))return;
      if(openFor(el))e.preventDefault();
    };
    const onKeyDown=e=>{
      const el=e.target;
      if(!isDiscreteControl(el))return;
      const key=e.key;
      const isChoiceKey=el.matches("select")?["ArrowDown","ArrowUp","Home","End","Enter"," "].includes(key):el.matches("input[type='file']")?["Enter"," "].includes(key):[" ","ArrowDown","ArrowUp","Enter"].includes(key);
      if(isChoiceKey&&openFor(el))e.preventDefault();
    };
    document.addEventListener("pointerdown",onPointerDown,true);
    document.addEventListener("beforeinput",onBeforeInput,true);
    document.addEventListener("keydown",onKeyDown,true);
    return()=>{
      document.removeEventListener("pointerdown",onPointerDown,true);
      document.removeEventListener("beforeinput",onBeforeInput,true);
      document.removeEventListener("keydown",onKeyDown,true);
    };
  },[]);
  const actualOnly=ACTUAL_ONLY_TYPES.has(dataType)||portalRequiresActual(field?.portal);
  const proceed=()=>{
    const el=pending.current;
    if(!el||!dataType||!environment||(environment==="ACTUAL"&&!confirmed))return;
    if(actualOnly&&environment!=="ACTUAL")return;
    const selectedEnvironment=actualOnly?"ACTUAL":environment;
    const verifiedAt=new Date().toISOString();
    const record={dataType,environment:selectedEnvironment,portal:field?.portal||"Current portal",field:field?.label||"Data field",verifiedAt};
    try{
      const existing=JSON.parse(window.sessionStorage.getItem("irpaPortalDataEntryVerifications")||"{}");\n      window.sessionStorage.setItem("irpaPortalDataEntryVerifications",JSON.stringify({...existing,[record.portal]:record}));
      window.sessionStorage.setItem("irpaFieldEntryVerification",JSON.stringify(record));
      window.sessionStorage.setItem("irpaDataTypeVerified",dataType);
      window.sessionStorage.setItem("irpaDataEnvironment",selectedEnvironment);
      window.sessionStorage.setItem("irpaDataEnvironmentTarget",record.portal);
      window.sessionStorage.setItem("irpaDataEnvironmentSelectedAt",verifiedAt);
      window.sessionStorage.setItem("irpaIdentityDataEnvironment","ACTUAL");
    }catch{
      setStorageError("Verification could not be saved in this browser session. The field remains locked; enable session storage and retry.");
      return;
    }
    verified.current.add(el);
    setField(null);
    requestAnimationFrame(()=>{if(el?.isConnected)el.focus();});
    pending.current=null;
  };
  if(!field)return null;
  return <div data-irpa-field-gate role="dialog" aria-modal="true" aria-labelledby="irpa-field-gate-title" onKeyDown={e=>{if(e.key==="Escape")e.preventDefault();}} style={{position:"fixed",inset:0,zIndex:30000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"rgba(3,12,10,.78)",backdropFilter:"blur(5px)",overflowY:"auto"}}>
    <section style={{width:"min(100%,680px)",maxHeight:"92vh",overflowY:"auto",background:"var(--surface, #fff)",color:"var(--text, #14231f)",border:"1px solid var(--border, #cbd5d1)",borderRadius:18,padding:24,boxShadow:"0 24px 80px rgba(0,0,0,.35)"}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:1.4,textTransform:"uppercase",opacity:.75}}>IRPA · Data Control</div>
      <h2 id="irpa-field-gate-title" style={{margin:"8px 0 6px",fontSize:25}}>Verify before entering data</h2>
      <p style={{margin:"0 0 16px",lineHeight:1.5}}>Entry is paused only for the first attempted edit in this portal or sub-portal. Once you confirm, the verification authorises data entry throughout this portal for the current session; other portals are verified separately.</p>
      <div style={{padding:12,borderRadius:10,background:"var(--surface-muted, #f1f5f3)",marginBottom:18}}>
        <div><strong>Portal:</strong> {field.portal}</div>
        <div style={{marginTop:4,overflowWrap:"anywhere"}}><strong>Entry field:</strong> {field.label}</div>
      </div>
      <fieldset style={{border:0,padding:0,margin:"0 0 18px"}}>
        <legend style={{fontWeight:750,marginBottom:10}}>1. What type of data are you entering? (Required)</legend>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
          {DATA_TYPES.map(([value,label])=><label key={value} style={{display:"flex",alignItems:"flex-start",gap:9,padding:11,border:"1px solid var(--border, #cbd5d1)",borderRadius:9,cursor:"pointer"}}>
            <input type="radio" name="irpa-data-type" value={value} checked={dataType===value} onChange={()=>{setDataType(value);if(ACTUAL_ONLY_TYPES.has(value)||portalRequiresActual(field?.portal)){setEnvironment("ACTUAL");setConfirmed(false)}else if(environment==="ACTUAL"){setConfirmed(false)}}} style={{marginTop:3}}/>
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
      {actualOnly&&<p style={{padding:12,borderRadius:9,background:"var(--surface-muted, #f1f5f3)",lineHeight:1.45}}>This portal contains or is reserved for protected identity, personnel, signer/signature, auditor, authorization or system-security records. It must remain in ACTUAL DATA.</p>}
      {environment==="ACTUAL"&&<label style={{display:"flex",alignItems:"flex-start",gap:10,padding:12,border:"1px solid #b7791f",borderRadius:9,marginBottom:16}}>
        <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} style={{marginTop:3}}/>
        <span>I confirm this portal’s data-entry environment for this session. This selection authorises data entry throughout this portal/sub-portal. If ACTUAL DATA is selected, I understand changes may affect live institutional records.</span>
      </label>}
      {environment==="TRIAL"&&<p style={{padding:12,borderRadius:9,background:"var(--surface-muted, #f1f5f3)",lineHeight:1.45}}>Use test records only. Do not enter confidential live information into trial records. Identity and security configuration remain in ACTUAL DATA.</p>}
      {storageError&&<p role="alert" style={{padding:12,borderRadius:9,background:"#fff1f0",color:"#9b1c1c"}}>{storageError}</p>}
      <button type="button" disabled={!dataType||!environment||(environment==="ACTUAL"&&!confirmed)||(actualOnly&&environment!=="ACTUAL")} onClick={proceed} style={{width:"100%",minHeight:46,marginTop:8,border:0,borderRadius:9,fontWeight:800,cursor:!dataType||!environment||(environment==="ACTUAL"&&!confirmed)||(actualOnly&&environment!=="ACTUAL")?"not-allowed":"pointer",opacity:!dataType||!environment||(environment==="ACTUAL"&&!confirmed)||(actualOnly&&environment!=="ACTUAL")?.55:1}}>Verify data and continue to field</button>
    </section>
  </div>;
}
