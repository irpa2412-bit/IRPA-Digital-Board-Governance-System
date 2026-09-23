import React,{useEffect,useMemo,useRef,useState}from"react";
import{getCurrentInductionContext,submitInductionApplication}from"../firebase/data";
import{ensureInvitationApplicantSession}from"../firebase/auth";

const unique=(values)=>[...new Set(values.flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim()).filter(Boolean))];
const uniqueValues=unique;

const DEPARTMENT_UNITS={
"Executive Office":["Executive Director's Office","Management Coordination Unit"],
"Internal Oversight":["Internal Oversight Unit","Compliance & Assurance Unit"],
"Livestock Development":["Livestock Production Unit","Veterinary Services Unit","Breeding & Genetics Unit","Livestock Infrastructure Unit"],
"Environment & Sustainable Rangeland Management":["Rangeland Management Unit","Rangeland Restoration Unit","Invasive Species Control Unit","Climate Change & Resilience Unit","Environmental Conservation & Education Unit"],
"Finance & Administration":["Finance Unit","Accounting Unit","Administration Unit","Procurement Unit"],
"Human Resources":["Human Resources & Staff Welfare Unit","Training & Capacity Development Unit","Personnel & Records Unit"],
"Outreach":["Communications & Outreach Unit","Partnerships & Resource Mobilization Unit","ICT & Digital Engagement Unit"],
"Community Development":["Community Mobilization Unit","Women & Youth Empowerment Unit","Gender & Social Inclusion Unit"],
"Field Department":["Field Implementation Unit","Monitoring, Evaluation, Accountability & Learning Unit","Community-Based Monitoring Unit"],
"Operations":["Logistics & Transport Unit","Infrastructure & Facilities Unit","General Operations Unit"]
};

const ROLE_MODULES={
"Board Member":["Dashboard","Meetings","Resolutions","Voting","Documents","Decisions","Reports","Signature Platform"],
"Executive Director":["Dashboard","Meetings","Resolutions","Authorization & Approvals","Finance Portfolio","Procurement","Reports","Risk Register","Signature Platform"],
"Finance":["Dashboard","Finance Portfolio","Procurement","Documents","Reports","Authorization & Approvals"],
"Procurement":["Dashboard","Procurement","Finance Portfolio","Documents","Reports","Authorization & Approvals"],
"Human Resources":["Dashboard","Members & Personnel","Invitations","Documents","Reports","Signature Platform"],
"Programme & Technical":["Dashboard","Meetings","Actions","Documents","Reports"],
"Operations":["Dashboard","Meetings","Actions","Documents","Reports","Authorization & Approvals"],
"Field":["Dashboard","Actions","Documents","Reports"],
"Director":["Dashboard","Meetings","Actions","Reports","Risk Register","Authorization & Approvals","Signature Platform"],
"General Employee":["Dashboard","Meetings","Actions","Documents","Signature Platform","Employee Payments"]
};

function roleFamily(role){
 const r=String(role||"").toLowerCase();
 if(/board member/.test(r))return"Board Member";
 if(/executive director/.test(r))return"Executive Director";
 if(/finance|accountant|accounts/.test(r))return"Finance";
 if(/procurement/.test(r))return"Procurement";
 if(/human resources|hr manager|hr officer/.test(r))return"Human Resources";
 if(/programme|technical/.test(r))return"Programme & Technical";
 if(/operations/.test(r))return"Operations";
 if(/field/.test(r))return"Field";
 if(/director/.test(r))return"Director";
 return"General Employee";
}

function orientationModules(role){
 const base=ROLE_MODULES[roleFamily(role)]||ROLE_MODULES["General Employee"];
 return unique(base);
}

function questionSet(role,department,q1,context,form){
 const employees=Array.isArray(context?.registerMatches?.employees)?context.registerMatches.employees:[];
 const members=Array.isArray(context?.registerMatches?.members)?context.registerMatches.members:[];
 const invitations=Array.isArray(context?.invitations)?context.invitations:[];
 const invitation=context?.invitation||invitations[0]||{};
 const accountOptions=unique([context?.accountType,...(context?.accountTypeOptions||[]),employees.length?"Employee":"",members.length?"Member":""]);
 const nameOptions=unique([context?.fullName,invitation.name,...employees.map(x=>x.name),...members.map(x=>x.name)]);
 const emailOptions=unique([context?.email,invitation.email,...employees.map(x=>x.email),...members.map(x=>x.email)]);
 const numberOptions=unique([
  ...employees.map(x=>x.employeeNumber),
  ...members.map(x=>x.memberNumber),
  context?.employeeNumber,context?.memberNumber
 ]);
 const roleOptions=unique([role,invitation.role,...employees.flatMap(x=>[x.role,...(x.roles||[])]),...members.flatMap(x=>[x.role,...(x.roles||[])])]);
 const organisationOptions=unique([
  department?department:"",
  ...employees.map(x=>x.department),...members.map(x=>x.department),
  invitation.department,
  form?.unit,...employees.map(x=>x.unit),...members.map(x=>x.unit),invitation.unit
 ].filter(Boolean));
 const statusOptions=unique([
  ...employees.map(x=>x.employmentType),...members.map(x=>x.memberType),
  invitation.employmentType,invitation.memberType,
  context?.employmentType
 ]);
 const invitationOptions=unique([
  invitation.invitationReference,invitation.reference,context?.invitationId
 ]);
 return{
  q1:{label:"1. Which name in the IRPA records corresponds to you?",options:nameOptions.length?nameOptions:["Enter the applicant name shown above"]},
  q2:{label:"2. Which email address is recorded for this applicant?",options:emailOptions.length?emailOptions:["Use the email address supplied for this application"]},
  q3:{label:"3. Which IRPA registration number is associated with you, if one is already issued?",options:numberOptions.length?numberOptions:["No registration number is currently shown"]},
  q4:{label:"4. Which role or position is recorded for this applicant?",options:roleOptions.length?roleOptions:[role||"No role shown"]},
  q5:{label:"5. Which department and/or unit is recorded for this applicant?",options:organisationOptions.length?organisationOptions:["No department or unit is currently shown"]},
  q6:{label:"6. Which membership/employment detail or invitation reference matches this application?",options:unique([...statusOptions,...invitationOptions].filter(Boolean)).length?unique([...statusOptions,...invitationOptions].filter(Boolean)):["No additional matching detail is currently shown"]}
 };
}
function ChoiceField({label,value,onChange,options,help,disabled=false,required=true}){
 const [query,setQuery]=useState(String(value||""));
 const suggestions=useMemo(()=>{const q=String(query||"").trim().toLowerCase();const pool=unique(options||[]);return q?pool.filter(x=>String(x).toLowerCase().includes(q)).slice(0,8):pool.slice(0,8)},[query,options]);
 useEffect(()=>{setQuery(String(value||""))},[value]);
 function choose(option){setQuery(option);onChange(option)}
 const listId=options?.length?"suggestions-"+label.replace(/[^a-z0-9]+/gi,"-").toLowerCase():undefined;
 return <div className="form-field"><label>{label}</label><input type="text" value={query} onChange={e=>{setQuery(e.target.value);onChange(e.target.value)}} onFocus={()=>setQuery("")} list={listId} disabled={disabled} required={required} autoComplete="off" placeholder="Start typing — suggestions will appear"/>{options?.length>0&&<><datalist id={listId}>{options.map(x=><option key={x} value={x}/>)}</datalist>{suggestions.length>0&&<div className="field-suggestion-list" style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:8}} aria-label="Suggested answers">{suggestions.map(option=><button type="button" key={option} className="secondary-button" onMouseDown={e=>e.preventDefault()} onClick={e=>{e.preventDefault();e.stopPropagation();choose(option)}} style={{pointerEvents:"auto",position:"relative",zIndex:20,cursor:"pointer"}}>{option}</button>)}</div>}</>}{help&&<small className="field-help">{help}</small>}</div>;
}

export default function InductionOrientation(){
 const[context,setContext]=useState(null),[busy,setBusy]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");const feedbackRef=useRef(null);
 const[form,setForm]=useState({identityConfirmation:"",accountType:"",primaryRole:"",department:"",unit:"",employmentType:"",orientationModules:[],q1:"",q2:"",q3:"",q4:"",q5:"",q6:"",comments:"",declaration:false,verifiedEmail:"",verifiedFullName:"",credentialCapacity:"",credentialRole:"",credentialInvitationReference:""});

 useEffect(()=>{let live=true;(async()=>{
  const params=new URLSearchParams(window.location.search);
  const applicantMode=params.get("applicant")==="1";
  if(applicantMode){
   try{await ensureInvitationApplicantSession();}catch(e){if(live){setError(e.message||"The invitation login-assistance session could not be opened.");setBusy(false);}return;}
  }
  try{
   const c=await getCurrentInductionContext();
   if(!live)return;
   setContext(c);
   const prior=c.existingRequest?.answers||{};
   const priorModules=Array.isArray(c.existingRequest?.orientationModules)?c.existingRequest.orientationModules:[];
   setForm({
    identityConfirmation:prior.identityConfirmation||"",
    accountType:prior.accountType||c.accountType||"",
    primaryRole:prior.primaryRole||c.roles[0]||"",
    department:prior.department||c.department||"",
    unit:prior.unit||c.unit||"",
    employmentType:prior.employmentType||c.employmentType||"",
    orientationModules:priorModules.length?priorModules:orientationModules(c.roles[0]||""),
    q1:prior.q1||"",q2:prior.q2||"",q3:prior.q3||"",q4:prior.q4||"",q5:prior.q5||"",q6:prior.q6||"",verifiedEmail:prior.verifiedEmail||c.invitation?.email||c.email||"",verifiedFullName:prior.verifiedFullName||c.invitation?.name||c.fullName||"",
    credentialCapacity:prior.credentialCapacity||"",credentialRole:prior.credentialRole||prior.primaryRole||"",credentialInvitationReference:prior.credentialInvitationReference||c.invitation?.invitationReference||c.invitation?.reference||"",
    comments:prior.comments||"",declaration:Boolean(c.existingRequest?.declaration)
   });
  }catch(e){if(live)setError(e.message||"Unable to retrieve the IRPA registration and invitation information.");}
  finally{if(live)setBusy(false);}
 })();return()=>{live=false}},[]);

 const invitationOptions=useMemo(()=>context?.invitations||[],[context]);const registerEmployees=useMemo(()=>context?.registerMatches?.employees||[],[context]);const registerMembers=useMemo(()=>context?.registerMatches?.members||[],[context]);const isNewApplicant=Boolean(context?.anonymous);const allEmailOptions=useMemo(()=>unique([context?.email,...invitationOptions.map(x=>x.email),...registerEmployees.map(x=>x.email),...registerMembers.map(x=>x.email)]),[context,invitationOptions,registerEmployees,registerMembers]);const allNameOptions=useMemo(()=>unique([context?.fullName,...invitationOptions.map(x=>x.name),...registerEmployees.map(x=>x.name),...registerMembers.map(x=>x.name)]),[context,invitationOptions,registerEmployees,registerMembers]);const [nameQuery,setNameQuery]=useState("");const [emailQuery,setEmailQuery]=useState("");const nameOptions=useMemo(()=>{const q=String(nameQuery||"").trim().toLowerCase();return q?allNameOptions.filter(n=>String(n).toLowerCase().startsWith(q)).slice(0,8):allNameOptions.slice(0,8)},[nameQuery,allNameOptions]);const emailOptions=useMemo(()=>{const q=String(emailQuery||"").trim().toLowerCase();return q?allEmailOptions.filter(e=>String(e).toLowerCase().startsWith(q)).slice(0,8):allEmailOptions.slice(0,8)},[emailQuery,allEmailOptions]);const accountTypeOptions=useMemo(()=>unique([...(context?.accountTypeOptions||[]),...(registerEmployees.length?["Employee"]:[]),...(registerMembers.length?["Member"]:[]),"Employee","Member","Employee & Member"]),[context,registerEmployees,registerMembers]);
 const roleOptions=useMemo(()=>unique([...(context?.roles||[]),...(context?.invitations||[]).map(x=>x.role),...registerEmployees.flatMap(x=>[x.role,...(x.roles||[])]),...registerMembers.flatMap(x=>[x.role,...(x.roles||[])]),...Object.keys(ROLE_MODULES)]),[context,registerEmployees,registerMembers]);
 const departmentOptions=useMemo(()=>unique([context?.department,...(context?.invitations||[]).map(x=>x.department),...registerEmployees.map(x=>x.department),...registerMembers.map(x=>x.department),...Object.keys(DEPARTMENT_UNITS)]),[context,registerEmployees,registerMembers]);
 const unitOptions=useMemo(()=>{
  const selected=form.department;
  return unique([context?.unit,...(context?.invitations||[]).filter(x=>x.department===selected).map(x=>x.unit),...registerEmployees.filter(x=>x.department===selected).map(x=>x.unit),...registerMembers.filter(x=>x.department===selected).map(x=>x.unit),...(DEPARTMENT_UNITS[selected]||[])]);
 },[context,form.department]);
 const employmentOptions=useMemo(()=>unique([context?.employmentType,...(context?.invitations||[]).map(x=>x.employmentType),"Full-time","Part-time","Contract","Consultancy","Internship"]),[context]);
 const moduleOptions=useMemo(()=>orientationModules(form.primaryRole||context?.role||""),[form.primaryRole,context]);
 const questions=useMemo(()=>questionSet(form.primaryRole||context?.role||"",form.department,form.q1,context,form),[form.primaryRole,form.department,form.q1,context,form.accountType,form.unit,form.employmentType]);
 const linked=String(context?.existingRequest?.status||"")==="Linked"||String(context?.existingRequest?.roleAssignmentStatus||"")==="Linked";
 const pending=Boolean(context?.existingRequest&&!linked);const completedFields=[form.accountType,form.identityConfirmation,form.verifiedEmail,form.verifiedFullName,form.primaryRole,form.department,form.unit,form.employmentType,form.orientationModules.length,form.q1,form.q2,form.q3,form.q4,form.q5,form.q6,form.declaration].filter(Boolean).length;const progress=Math.round((completedFields/17)*100);

 function patch(name,value){
  setForm(x=>{
   const next={...x,[name]:value};
   if(name==="primaryRole"){next.q1="";next.q2="";next.q3="";next.orientationModules=orientationModules(value);}
   if(name==="department"){next.unit="";next.q3="";}
   if(name==="verifiedEmail"||name==="verifiedFullName"){const invitationMatch=(context?.invitations||[]).find(x=>String(x.email||"").toLowerCase()===String(next.verifiedEmail||"").toLowerCase()&&String(x.name||"").trim().toLowerCase()===String(next.verifiedFullName||"").trim().toLowerCase());const registerMatch=[...registerEmployees,...registerMembers].find(x=>String(x.email||"").toLowerCase()===String(next.verifiedEmail||"").toLowerCase()&&(String(x.name||"").trim().toLowerCase()===String(next.verifiedFullName||"").trim().toLowerCase()||!next.verifiedFullName));const match=registerMatch||invitationMatch;if(match){next.primaryRole=match.role||next.primaryRole;next.department=match.department||next.department;next.unit=match.unit||next.unit;next.employmentType=match.employmentType||next.employmentType;}}if(name==="q1")next.q2="";
   return next;
  });
 }
 function toggleModule(value){setForm(x=>({...x,orientationModules:x.orientationModules.includes(value)?x.orientationModules.filter(v=>v!==value):[...x.orientationModules,value]}));}

 async function submit(e){
  e.preventDefault();setError("");setMessage("");if(feedbackRef.current)feedbackRef.current.scrollIntoView({behavior:"smooth",block:"nearest"});
  if(!context){setError("The IRPA induction enrollment session could not be established.");return}if(pending){setMessage("Your induction application is already awaiting administrator LINK. No duplicate submission is required.");return}
  if(!form.accountType){setError("Please confirm whether you are applying in your registered Employee or Member capacity.");return}
if(form.identityConfirmation!=="Yes"){setError(context.anonymous?"Please confirm that the new enrollment information you entered is accurate.":"You must confirm that the displayed registration and invitation information belongs to you.");return}
  if(!form.verifiedEmail||!form.verifiedFullName||!form.primaryRole||!form.department||!form.unit||!form.employmentType||!form.q1||!form.q2||!form.q3||!form.q4||!form.q5||!form.q6||!form.orientationModules.length||!form.declaration){setError("Please complete all required selections before submitting.");return}
  setSaving(true);setMessage("Submitting your Induction and Orientation application… Please wait for the administrator-routing confirmation.");
  try{
   const submissionContext={...context,email:String(form.verifiedEmail||context.email||"").trim().toLowerCase(),fullName:String(form.verifiedFullName||context.fullName||"").trim(),role:form.primaryRole,roles:form.primaryRole?[form.primaryRole]:[],department:form.department,unit:form.unit,employmentType:form.employmentType,accountType:form.accountType,boardMember:roleFamily(form.primaryRole)==="Board Member"};const result=await submitInductionApplication(form,submissionContext);
   if(result.alreadyLinked){setMessage("Your induction has already been approved and linked by an administrator.");return}
   setMessage(context.anonymous?"Application submitted to the Administrator for approval. No login authorisation or Firebase account has been issued at this stage. The Administrator LINK action will command Firebase Authentication and Firestore to subscribe the approved applicant.":"Induction and Orientation submitted successfully. Your application is now awaiting administrator LINK. Your registered role(s), department/unit and Board Member status remain system-controlled.");
  }catch(x){setError(x.message||"The induction application could not be submitted.");}
  finally{setSaving(false);}
 }



 if(busy)return <div className="page induction-page"><section className="panel induction-loading" aria-live="polite"><div className="induction-spinner" aria-hidden="true"/><h2>Induction and Orientation</h2><p className="muted">Retrieving your registered IRPA information and invitation details…</p><small className="field-help">The registered IRPA identity is being retrieved securely. Use the parallel login-assistance pathway if your normal credentials are blocked.</small></section></div>;
 if(error&&!context)return <div className="page induction-page"><section className="panel"><h2>Induction and Orientation — Access Check</h2><div ref={feedbackRef} className="error-message action-feedback" role="alert">{error}</div><p className="panel-description">The system could not retrieve a matching IRPA registration/invitation record, so the application remains blocked.</p><button type="button" className="secondary-button" onClick={()=>window.location.reload()}>RETRY REGISTRATION CHECK</button></section></div>;

 return <div className="page induction-page" aria-busy={saving?"true":"false"}>
  <section className="welcome-panel">
   <div><span className="eyebrow">IRPA INDUCTION & ORIENTATION</span><h1>{isNewApplicant?"New Member / Employee Enrollment":"Registration-Linked Induction Application"}</h1><p>{isNewApplicant?"This pathway is an application and orientation protocol. It does not authorise login and does not issue credentials. Complete the guided application; the Administrator reviews it and the LINK action commands Firebase Authentication and Firestore to subscribe an approved applicant.":"The form is pre-filled from your authenticated IRPA Member/Employee registration and invitation records. Choices are generated from the information already registered in the system."}</p></div>
   <div className="identity-card"><span>APPLICATION STATUS</span><strong>{linked?"LINKED":pending?"PENDING LINK":"READY"}</strong><small>{linked?"Administrator approval completed":pending?"Awaiting administrator LINK":"Complete the guided form below"}</small></div>
  </section>

  {(message||error)&&<div ref={feedbackRef} className="induction-feedback" aria-live="polite">{message&&<div className="success-message action-feedback" role="status">{message}</div>}{error&&<div className="error-message action-feedback" role="alert">{error}</div>}</div>}

  <section className="panel induction-progress-panel"><div className="induction-progress-head"><div><span className="eyebrow">APPLICATION PROGRESS</span><strong>{progress}% complete</strong></div><span>{pending?"Pending administrator LINK":linked?"Administrator LINK completed":"Complete the required fields below"}</span></div><div className="induction-progress-track" aria-label={`Application ${progress}% complete`}><span style={{width:`${progress}%`}}/></div><div className="induction-steps" aria-label="Induction steps">{["Identity","Position","Modules","Orientation Check","Declaration"].map((x,i)=><span key={x} className={completedFields>=[2,4,5,8,11][i]?"complete":""}>{i+1}. {x}</span>)}</div></section>

  <section className="panel applicant-entry-panel" id="applicant-entry">
   <div className="panel-header"><div><span className="eyebrow">{isNewApplicant?"APPLICANT ENTRY":"INDUCTION ENTRY"}</span><h2>{isNewApplicant?"Applicant Entry — Enrollment & Approval Stage":"Induction Entry — Registration & Orientation"}</h2><p className="panel-description">{isNewApplicant?"This is a filtered application entry point. The protocol first compares the applicant with the registered invitation and existing Member/Employee register. Only a verified application is routed to the Administrator Induction & Orientation review queue. No applicant is given access to the administrator gateway, and no login credentials are authorised before LINK.":"Continue your registration-linked induction here. Your application status is shown above and the Administrator LINK stage remains system-controlled."}</p></div></div><div className="detail-grid"><div><span>APPLICANT ACCESS</span><strong>{isNewApplicant?"Open — no prior credentials required":"Authenticated IRPA account"}</strong></div><div><span>APPROVAL STAGE</span><strong>{linked?"LINKED":pending?"PENDING ADMINISTRATOR LINK":"NOT YET SUBMITTED"}</strong></div><div><span>NEXT ACTION</span><strong>{linked?"Use your issued IRPA credentials":pending?"Wait for administrator LINK":"Complete the entries below and submit"}</strong></div></div>
  </section>

  <section className="panel">
   <div className="panel-header"><div><span className="eyebrow">SYSTEM-RETRIEVED IDENTITY</span><h2>Your Registered Information</h2><p className="panel-description">These fields are retrieved from IRPA registration/invitation records. Your registration number and role remain controlled by the administrator registration record.</p></div></div>
   <div className="detail-grid">
    <div><span>FULL NAME</span><strong>{context.fullName||"Applicant enters below"}</strong></div>
    <div><span>REGISTERED CAPACITY</span><strong>{context.accountType||"New applicant selects below"}</strong></div>
    <div><span>REGISTERED ROLE(S)</span><strong>{context.role||"Applicant selects below"}</strong></div>
    <div><span>DEPARTMENT</span><strong>{context.department||"Applicant selects below"}</strong></div>
    <div><span>UNIT</span><strong>{context.unit||"Applicant selects below"}</strong></div>
    <div><span>BOARD MEMBER</span><strong>{context.boardMember?"Yes":"No"}</strong></div>
    <div><span>REGISTRATION NUMBER</span><strong>Issued by email after administrator LINK</strong></div>
    <div><span>INVITATION</span><strong>{context.invitation?"Matched":isNewApplicant?"Not required for new enrollment":"No separate invitation found"}</strong></div>
    <div><span>INVITATION REFERENCE</span><strong>{context.invitation?.invitationReference||context.invitation?.reference||context.invitationId||"Not applicable"}</strong></div><div><span>APPLICATION FILTER</span><strong>{isNewApplicant?((registerEmployees.length||registerMembers.length)?"PASSED — READY FOR ADMINISTRATOR REVIEW":"BLOCKED — VERIFICATION REQUIRED"):"REGISTERED ACCOUNT"}</strong></div>
   </div>
  </section>

  <form onSubmit={submit}>
   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 1</span><h2>Applicant Capacity & Identity</h2><p className="panel-description">Your registered Member/Employee capacity is retrieved from the administrator-controlled IRPA record.</p></div></div>
    {isNewApplicant?<><div className="form-field"><label>Email address for IRPA enrollment</label><input type="email" value={form.verifiedEmail} onChange={e=>patch("verifiedEmail",e.target.value)} placeholder="Enter the email address you will use for IRPA access" required/><small className="field-help">This address receives the credential setup/password-reset message after enrollment is submitted.</small></div><div className="form-field"><label>Full name</label><input type="text" value={form.verifiedFullName} onChange={e=>patch("verifiedFullName",e.target.value)} placeholder="Enter your full name" required/></div></>:<><div className="form-field"><label>Full name — find your registered profile</label><input type="text" value={form.verifiedFullName} onFocus={()=>setNameQuery("")} onChange={e=>{setNameQuery(e.target.value);patch("verifiedFullName",e.target.value)}} placeholder="Tap here to see registered name suggestions or type to filter" required autoComplete="off"/><small className="field-help">Enter the first letter. The system will prompt only matching names from existing IRPA invitation/registration records. Select your own registered profile to continue.</small>{nameOptions.length>0&&<div className="name-suggestion-list" style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:8}}>{nameOptions.map(name=><button type="button" key={name} className="secondary-button" onMouseDown={e=>e.preventDefault()} onClick={e=>{e.preventDefault();e.stopPropagation();setNameQuery(name);patch("verifiedFullName",name)}}>{name}</button>)}</div>}{nameQuery&&nameOptions.length===0&&<small className="field-help">No matching registered name was found yet. Check the first letter or continue typing.</small>}</div><div className="form-field"><label>Email — find your registered invitation</label><input type="email" value={form.verifiedEmail} onFocus={()=>setEmailQuery("")} onChange={e=>{setEmailQuery(e.target.value);patch("verifiedEmail",e.target.value)}} placeholder="Tap here to see registered email suggestions or type to filter" required autoComplete="off"/><small className="field-help">Enter the first letter. Matching registered invitation emails will be prompted so you do not have to remember or reproduce the stored address exactly.</small>{emailOptions.length>0&&<div className="name-suggestion-list" style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:8}}>{emailOptions.map(email=><button type="button" key={email} className="secondary-button" onMouseDown={e=>e.preventDefault()} onClick={e=>{e.preventDefault();e.stopPropagation();setEmailQuery(email);patch("verifiedEmail",email)}}>{email}</button>)}</div>}{emailQuery&&emailOptions.length===0&&<small className="field-help">No matching registered email was found yet. Check the first letter or continue typing.</small>}</div></>}<ChoiceField label="I am applying in my registered capacity as" value={form.accountType} onChange={v=>patch("accountType",v)} options={accountTypeOptions} help="Only capacities already found in your IRPA registration records are offered."/>
    <ChoiceField label={isNewApplicant?"Do you confirm that the information you entered is accurate?":"Does the system-retrieved identity above belong to you?"} value={form.identityConfirmation} onChange={v=>patch("identityConfirmation",v)} options={["Yes","No"]} help={isNewApplicant?"Selecting No blocks submission until you correct the entries.":"Selecting No blocks submission so the registration/invitation record can be corrected before induction."}/>
   </section>

   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 2</span><h2>Position, Department & Unit</h2><p className="panel-description">The choices below are generated by comparing the invitation with the existing Member and Employee registers. Matching records are used to prompt the applicant and reduce administrator editorial work; the applicant can still correct their name spelling.</p></div></div>
    <div className="form-grid">
     <ChoiceField label="Role for this orientation" value={form.primaryRole} onChange={v=>patch("primaryRole",v)} options={roleOptions} help={context.role?"All registered roles remain recorded: "+context.role:""}/>
     <ChoiceField label="Department" value={form.department} onChange={v=>patch("department",v)} options={departmentOptions}/>
     <ChoiceField label="Unit" value={form.unit} onChange={v=>patch("unit",v)} options={unitOptions} help="Unit choices change automatically when the department changes."/>
     <ChoiceField label="Employment / membership type" value={form.employmentType} onChange={v=>patch("employmentType",v)} options={employmentOptions}/>
    </div>
   </section>

   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 3</span><h2>Orientation Modules</h2><p className="panel-description">Modules are suggested from your selected role. You may select multiple modules where your registered roles require them.</p></div></div>
    <div className="dashboard-grid">{moduleOptions.map(m=><label key={m} className="stat-card" style={{cursor:"pointer"}}><input type="checkbox" checked={form.orientationModules.includes(m)} onChange={()=>toggleModule(m)} style={{marginRight:10}}/><strong style={{display:"inline"}}>{m}</strong></label>)}</div>
   </section>

   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 4</span><h2>Adaptive Orientation Check</h2><p className="panel-description">The questions below use particulars already available in the IRPA Member, Employee and Invitation registers. Confirm the record that corresponds to you; they are used to support administrator verification and LINK.</p></div></div>
    <div className="form-grid">
     <ChoiceField label={questions.q1.label} value={form.q1} onChange={v=>patch("q1",v)} options={questions.q1.options}/>
     <ChoiceField label={questions.q2.label} value={form.q2} onChange={v=>patch("q2",v)} options={questions.q2.options} disabled={false}/>
     <ChoiceField label={questions.q3.label} value={form.q3} onChange={v=>patch("q3",v)} options={questions.q3.options}/><ChoiceField label={questions.q4.label} value={form.q4} onChange={v=>patch("q4",v)} options={questions.q4.options}/><ChoiceField label={questions.q5.label} value={form.q5} onChange={v=>patch("q5",v)} options={questions.q5.options}/><ChoiceField label={questions.q6.label} value={form.q6} onChange={v=>patch("q6",v)} options={questions.q6.options}/>
    </div>
    <div className="form-field" style={{marginTop:16}}><label>Additional orientation comments</label><textarea value={form.comments} onChange={e=>patch("comments",e.target.value)} rows="4" placeholder="Optional comments, questions or support required during induction…"/></div>
   </section>


   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">ACCESS & REGISTRATION DETAILS</span><h2>Registration and Access Details</h2><p className="panel-description">These details are completed within Induction and Orientation. They are reviewed by the Administrator before the application is LINKED and governance access is activated.</p></div></div>
    <div className="form-grid">
     <ChoiceField label="What is your registered capacity with IRPA?" value={form.credentialCapacity} onChange={v=>patch("credentialCapacity",v)} options={accountTypeOptions.length?accountTypeOptions:["Employee","Member","Employee & Member"]}/>
     <ChoiceField label="What role / position are you registered or invited for?" value={form.credentialRole} onChange={v=>patch("credentialRole",v)} options={roleOptions.length?roleOptions:[form.primaryRole||context?.role||""]}/>
     <div className="form-field"><label>What is your invitation reference, if available?</label><input value={form.credentialInvitationReference} onChange={e=>patch("credentialInvitationReference",e.target.value)} placeholder="Enter invitation reference if available"/></div>
    </div>
   </section>

   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 5</span><h2>Declaration & Submission</h2><p className="panel-description">Submission creates/updates your induction application and routes it to the administrator for the required <strong>LINK</strong> action.</p></div></div>
    <label style={{display:"flex",gap:10,alignItems:"flex-start"}}><input type="checkbox" checked={form.declaration} onChange={e=>patch("declaration",e.target.checked)} required/><span>I confirm that I have reviewed the system-retrieved registration/invitation information, completed the orientation selections truthfully, and understand that my final role, department/unit and Board Member status are validated from the IRPA system.</span></label>
    <div className="form-actions induction-submit-actions" style={{marginTop:18}}><button type="submit" disabled={saving||linked||pending}>{saving?"SUBMITTING…":linked?"ALREADY LINKED":pending?"APPLICATION ALREADY SUBMITTED":"SUBMIT INDUCTION APPLICATION"}</button><small className="submit-status">{saving?"Saving and routing your application securely…":linked?"No further submission is required.":pending?"Administrator LINK is pending.":"Your submission will be routed to the administrator for LINK."}</small></div>
   </section>
  </form>
 </div>;
}