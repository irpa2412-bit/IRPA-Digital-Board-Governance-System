import React,{useCallback,useEffect,useRef,useState}from"react";

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

/* Portals that must read environment-specific storage as soon as they open (their gateway needs the
   environment even before any data is typed). The gate still opens only once per portal. Empty this list
   to make every portal wait for a real data-entry attempt. */
const OPEN_ON_SELECTION=new Set(["Documents"]);

/* Controls that never count as data entry. Add data-irpa-no-gate to any element or container to opt it out. */
const NEVER_GATE='[data-irpa-field-gate],[data-irpa-no-gate],.sidebar,.topbar,nav,[role="navigation"],[role="search"],[role="searchbox"],.desktop-webapp-navigation-roller,.page-back-next-navigation,[aria-label="Navigate to a sub-portal within the current portal"]';
const NON_ENTRY_INPUT=/^(hidden|button|submit|reset|image|search|range)$/i;
const SEARCH_HINT=/^\s*(search|filter|find)\b/i;
/* Buttons count as data entry when their label starts with one of these actions. */
const ENTRY_BUTTON=/^\s*(?:\+\s*)?(add|create|new|save|submit|register|upload|send|invite|approve|reject|issue|record|import|publish|post|vote|cast|sign(?!\s*(in|out)\b)|delete|remove)\b/i;

const readMap=()=>{try{const v=JSON.parse(window.sessionStorage.getItem(verificationMapKey)||"{}");return v&&typeof v==="object"?v:{}}catch{return null}};
const applyRecord=record=>{
  try{
    window.sessionStorage.setItem("irpaFieldEntryVerification",JSON.stringify(record));
    window.sessionStorage.setItem("irpaDataTypeVerified",record.dataType);
    window.sessionStorage.setItem("irpaDataEnvironment",record.environment);
    window.sessionStorage.setItem("irpaDataEnvironmentTarget",record.portal);
    window.sessionStorage.setItem("irpaDataEnvironmentSelectedAt",record.verifiedAt);
    window.sessionStorage.setItem("irpaIdentityDataEnvironment","ACTUAL");
    return true;
  }catch{return false}
};
const labelOf=el=>String(el.getAttribute("aria-label")||el.value||el.textContent||"").trim();
const isEntryField=el=>{
  if(!el||!el.matches||el.closest(NEVER_GATE))return false;
  if(el.matches("textarea,select,[contenteditable=''],[contenteditable='true']"))return !SEARCH_HINT.test(String(el.getAttribute("aria-label")||el.getAttribute("placeholder")||""));
  if(el.matches("input")){
    const type=el.getAttribute("type")||"text";
    if(NON_ENTRY_INPUT.test(type))return false;
    return !SEARCH_HINT.test(String(el.getAttribute("aria-label")||el.getAttribute("placeholder")||""));
  }
  return false;
};
function replayFieldAttempt(resume){
  const el=resume&&resume.el;
  if(!el||!document.contains(el))return;
  if(resume.kind!=="field"){el.focus?.();return}
  el.focus?.();
  const key=resume.key;
  let inputType=resume.inputType||"";
  let data=resume.data;
  if(key==="Enter"){
    if(el.matches("textarea,[contenteditable='true']")){
      if(el.matches("[contenteditable='true']")){document.execCommand("insertLineBreak");return}
      inputType="insertLineBreak";data="\n";
    }else{
      if(el.form&&el.form.requestSubmit)el.form.requestSubmit();
      return;
    }
  }else if(key==="Backspace")inputType="deleteContentBackward";
  else if(key==="Delete")inputType="deleteContentForward";
  else if(typeof key==="string"&&key.length===1){inputType="insertText";data=key}
  if(el.matches("[contenteditable='true']")){
    if(inputType==="insertText"&&data!=null)document.execCommand("insertText",false,String(data));
    else if(inputType==="deleteContentBackward")document.execCommand("delete",false);
    else if(inputType==="insertLineBreak")document.execCommand("insertLineBreak",false);
    return;
  }
  if(!el.matches("input,textarea"))return;
  const value=String(el.value||"");
  let start=Number.isInteger(resume.selectionStart)?resume.selectionStart:value.length;
  let end=Number.isInteger(resume.selectionEnd)?resume.selectionEnd:start;
  if(inputType==="deleteContentBackward"&&start===end&&start>0)start-=1;
  else if(inputType==="deleteContentForward"&&start===end&&end<value.length)end+=1;
  let replacement="";
  if(inputType==="insertText"||inputType==="insertCompositionText")replacement=String(data??"");
  else if(inputType==="insertLineBreak"||inputType==="insertParagraph")replacement="\n";
  else if(!/^delete/.test(inputType))return;
  const nextValue=value.slice(0,start)+replacement+value.slice(end);
  const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
  if(setter)setter.call(el,nextValue);else el.value=nextValue;
  const caret=start+replacement.length;
  try{el.setSelectionRange(caret,caret)}catch{}
  el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:inputType||"insertText",data:replacement||null}));
}
const isEntryClick=el=>{
  if(!el||!el.matches||el.closest(NEVER_GATE))return false;
  if(el.matches('input[type="checkbox"],input[type="radio"],input[type="file"],input[type="submit"]'))return !SEARCH_HINT.test(String(el.getAttribute("aria-label")||""));
  if(el.matches('button[type="submit"]'))return true;
  if(el.matches('button,[role="button"]'))return ENTRY_BUTTON.test(labelOf(el));
  return false;
};

export default function FieldEntryDataGate({portal}){
  const currentPortal=String(portal||"Dashboard").trim().replace(/\s+/g," ").slice(0,100)||"Dashboard";
  const[field,setField]=useState(null);
  const[dataType,setDataType]=useState("");
  const[environment,setEnvironment]=useState("");
  const[confirmed,setConfirmed]=useState(false);
  const[storageError,setStorageError]=useState("");
  const pending=useRef(null);
  const openRef=useRef(false);
  const replaying=useRef(false);
  const portalRef=useRef(currentPortal);
  portalRef.current=currentPortal;
  const actualOnly=ACTUAL_ONLY_TYPES.has(dataType)||portalRequiresActual(field?field.portal:currentPortal);

  const isVerified=useCallback(name=>{const map=readMap();return Boolean(map&&map[name])},[]);
  const openGate=useCallback((name,attempt)=>{
    pending.current=attempt||null;
    setStorageError("");setDataType("");setEnvironment("");setConfirmed(false);
    openRef.current=true;
    setField({portal:name});
  },[]);

  /* Selecting a portal never opens the gate. It re-applies that portal's earlier choice, so the session always matches the portal in view. */
  useEffect(()=>{
    const map=readMap();
    if(map===null){setStorageError("This browser session could not read the verification record. Enable session storage and retry.");return}
    const record=map[currentPortal];
    if(record)applyRecord(record);
    else if(OPEN_ON_SELECTION.has(currentPortal)){openGate(currentPortal,null);return}
    setField(null);openRef.current=false;pending.current=null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentPortal]);

  /* The gate opens only when the user attempts to enter data in a portal that has not been verified yet. */
  useEffect(()=>{
    const attempt=(event,el,kind)=>{
      if(replaying.current||openRef.current)return false;
      const scope=el.closest("[data-irpa-portal]");
      const name=String((scope&&scope.getAttribute("data-irpa-portal"))||portalRef.current).trim().replace(/\s+/g," ").slice(0,100)||"Dashboard";
      if(isVerified(name))return false;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      if(kind==="field"&&typeof el.blur==="function")el.blur();
      openGate(name,{el,kind,key:event.type==="keydown"?event.key:null,inputType:event.inputType||"",data:event.data??null,selectionStart:Number.isInteger(el.selectionStart)?el.selectionStart:null,selectionEnd:Number.isInteger(el.selectionEnd)?el.selectionEnd:null});
      return true;
    };
    const onMouseDown=e=>{const el=e.target&&e.target.closest?e.target.closest("select"):null;if(el&&isEntryField(el))attempt(e,el,"field")};
    const onKeyDown=e=>{
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      const printable=e.key&&(e.key.length===1||e.key==="Backspace"||e.key==="Delete"||e.key==="Enter");
      if(!printable)return;
      const el=e.target;
      if(el&&el.matches&&el.matches("input,textarea,select,[contenteditable]")&&isEntryField(el))attempt(e,el,"field");
    };
    const onBeforeInput=e=>{const el=e.target;if(el&&el.matches&&isEntryField(el))attempt(e,el,"field")};
    const onClick=e=>{const el=e.target&&e.target.closest?e.target.closest('button,[role="button"],input'):null;if(el&&isEntryClick(el))attempt(e,el,"click")};
    const onSubmit=e=>{const form=e.target;if(form&&form.matches&&form.matches("form")&&!form.closest(NEVER_GATE))attempt(e,form,"submit")};
    document.addEventListener("mousedown",onMouseDown,true);
    document.addEventListener("keydown",onKeyDown,true);
    document.addEventListener("beforeinput",onBeforeInput,true);
    document.addEventListener("click",onClick,true);
    document.addEventListener("submit",onSubmit,true);
    return()=>{
      document.removeEventListener("mousedown",onMouseDown,true);
      document.removeEventListener("keydown",onKeyDown,true);
      document.removeEventListener("beforeinput",onBeforeInput,true);
      document.removeEventListener("click",onClick,true);
      document.removeEventListener("submit",onSubmit,true);
    };
  },[isVerified,openGate]);

  const close=()=>{setField(null);openRef.current=false;pending.current=null};
  const proceed=()=>{
    if(!field||!dataType||!environment||(environment==="ACTUAL"&&!confirmed))return;
    if(actualOnly&&environment!=="ACTUAL")return;
    const selectedEnvironment=actualOnly?"ACTUAL":environment;
    const record={dataType,environment:selectedEnvironment,portal:field.portal,verifiedAt:new Date().toISOString()};
    const existing=readMap();
    if(existing===null||!applyRecord(record)){
      setStorageError("Verification could not be saved in this browser session. The gate remains locked; enable session storage and retry.");
      return;
    }
    try{window.sessionStorage.setItem(verificationMapKey,JSON.stringify({...existing,[field.portal]:record}))}catch{
      setStorageError("Verification could not be saved in this browser session. The gate remains locked; enable session storage and retry.");
      return;
    }
    const resume=pending.current;
    close();
    /* Give the person back what they were doing: refocus the field, or repeat the click/submit once the gate has closed. */
    if(resume&&resume.el&&document.contains(resume.el)){
      replaying.current=true;
      setTimeout(()=>{
        try{
          if(resume.kind==="field")replayFieldAttempt(resume);
          else if(resume.kind==="click"&&resume.el.click)resume.el.click();
          else if(resume.kind==="submit"&&resume.el.requestSubmit)resume.el.requestSubmit();
        }finally{replaying.current=false}
      },0);
    }
  };

  if(!field)return null;
  const disabled=!dataType||!environment||(environment==="ACTUAL"&&!confirmed)||(actualOnly&&environment!=="ACTUAL");
  return <div data-irpa-field-gate role="dialog" aria-modal="true" aria-labelledby="irpa-field-gate-title" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();close()}}} style={{position:"fixed",inset:0,zIndex:30000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"rgba(3,12,10,.78)",backdropFilter:"blur(5px)",overflowY:"auto"}}>
    <section style={{width:"min(100%,680px)",maxHeight:"92vh",overflowY:"auto",background:"var(--surface, #fff)",color:"var(--text, #14231f)",border:"1px solid var(--border, #cbd5d1)",borderRadius:18,padding:24,boxShadow:"0 24px 80px rgba(0,0,0,.35)"}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:1.4,textTransform:"uppercase",opacity:.75}}>IRPA · Data Control</div>
      <h2 id="irpa-field-gate-title" style={{margin:"8px 0 6px",fontSize:25}}>Confirm this portal’s data environment</h2>
      <p style={{margin:"0 0 16px",lineHeight:1.5}}>You are about to enter data. Confirm this portal’s data environment once to continue. It then stays closed throughout this portal for the current browser session, and opens again only when you first try to enter data in a different portal or sub-portal. Each different portal or sub-portal is verified separately.</p>
      <div style={{padding:12,borderRadius:10,background:"var(--surface-muted, #f1f5f3)",marginBottom:18}}>
        <strong>Selected portal / sub-portal:</strong> {field.portal}
      </div>
      <fieldset style={{border:0,padding:0,margin:"0 0 18px"}}>
        <legend style={{fontWeight:750,marginBottom:10}}>1. What type of data will this portal handle? (Required)</legend>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
          {DATA_TYPES.map(([value,label])=><label key={value} style={{display:"flex",alignItems:"flex-start",gap:9,padding:11,border:"1px solid var(--border, #cbd5d1)",borderRadius:9,cursor:"pointer"}}>
            <input type="radio" name="irpa-data-type" value={value} checked={dataType===value} onChange={()=>{setDataType(value);if(ACTUAL_ONLY_TYPES.has(value)||portalRequiresActual(field.portal)){setEnvironment("ACTUAL");setConfirmed(false)}else if(environment==="ACTUAL"){setConfirmed(false)}}} style={{marginTop:3}}/>
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
      <button type="button" disabled={disabled} onClick={proceed} style={{width:"100%",minHeight:46,marginTop:8,border:0,borderRadius:9,fontWeight:800,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.55:1}}>Confirm environment and continue</button><button type="button" onClick={close} style={{width:"100%",minHeight:42,marginTop:8,border:"1px solid var(--border, #cbd5d1)",borderRadius:9,background:"transparent",fontWeight:700,cursor:"pointer"}}>Cancel — I am not entering data</button>
    </section>
  </div>;
}
