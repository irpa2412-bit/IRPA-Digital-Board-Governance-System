import React,{useEffect,useMemo,useState}from"react";
import{getCurrentInductionContext,submitInductionApplication}from"../firebase/data";

const unique=(values)=>[...new Set(values.flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim()).filter(Boolean))];

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

function questionSet(role,department,q1){
 const family=roleFamily(role);
 const q1Options={
  "Board Member":["Confirm the Board/member identity and delegated authority","Open a formal vote immediately","Change my registered role","Bypass the meeting and resolution records"],
  "Executive Director":["Confirm delegated authority and review pending approvals/actions","Edit another employee's registration","Bypass the approval workflow","Open restricted records without authorization"],
  "Finance":["Confirm Finance access and review the relevant financial record/workflow","Approve every transaction automatically","Delete supporting evidence","Move a procurement record to payment without the required handoff"],
  "Procurement":["Confirm the procurement request, evidence and workflow stage","Skip quotations and approval controls","Send an unapproved request directly to payment","Delete supplier evidence"],
  "Human Resources":["Confirm the employee/member record and controlled HR workflow","Share personnel records with all users","Change another user's password","Bypass registration controls"],
  "Programme & Technical":["Confirm the assigned programme/technical role and implementation workspace","Approve restricted finance records without authority","Delete implementation evidence","Bypass reporting"],
  "Operations":["Confirm the operational assignment and active workflow","Approve every departmental request","Delete operational records","Bypass authorization"],
  "Field":["Confirm the field assignment and reporting workspace","Change the registered department without approval","Delete field evidence","Bypass reporting"],
  "Director":["Confirm the directorate, delegated authority and pending actions","Approve all requests regardless of authority","Delete audit records","Bypass governance workflow"],
  "General Employee":["Confirm my registered role, department and assigned workspace","Access restricted portals without authorization","Change another user's registration","Bypass assigned workflows"]
 }[family]||[];
 const q2ByQ1={
  "Confirm the Board/member identity and delegated authority":["Review Meetings, Resolutions and authorised Voting","Open Finance Portfolio regardless of authority","Change the Board register","Delete governance records"],
  "Confirm delegated authority and review pending approvals/actions":["Review Authorization & Approvals, Actions, Reports and delegated workspaces","Bypass all approvals","Change another person's role","Delete audit records"],
  "Confirm Finance access and review the relevant financial record/workflow":["Use Finance Portfolio and the designated Documents evidence trail","Send every record directly to payment","Delete financial evidence","Approve records outside delegated authority"],
  "Confirm the procurement request, evidence and workflow stage":["Review the procurement stage, quotations/evidence and authorised Finance handoff","Skip quotation requirements","Send directly to payment","Delete vendor evidence"],
  "Confirm the employee/member record and controlled HR workflow":["Use Members & Personnel, Invitations and authorised HR documents","Share personnel files broadly","Delete employee records","Bypass HR controls"],
  "Confirm the assigned programme/technical role and implementation workspace":["Use assigned Meetings, Actions, Documents and Reports","Open restricted Finance records","Delete implementation evidence","Bypass reporting"],
  "Confirm the operational assignment and active workflow":["Track operational Actions, Meetings, Documents and authorised approvals","Approve every request","Delete records","Bypass workflow"],
  "Confirm the field assignment and reporting workspace":["Use assigned Actions, Documents and Reports for field evidence","Change another user's role","Delete evidence","Bypass reporting"],
  "Confirm the directorate, delegated authority and pending actions":["Review departmental Actions, Reports, Risks and Authorization & Approvals","Approve everything automatically","Delete audit records","Bypass delegated authority"],
  "Confirm my registered role, department and assigned workspace":["Use the modules assigned to my registered role","Open restricted portals without authorization","Change another user's role","Bypass assigned workflows"]
 };
 const q2Options=q2ByQ1[q1]||orientationModules(role).map(x=>"Use "+x+" according to my registered authority");
 const q3Options=department?[
  "Follow the registered department/unit workflow and escalate approvals through the formal system",
  "Ignore the department/unit assignment and use any portal",
  "Change the department/unit directly without administrator approval",
  "Share restricted records outside the authorised workflow"
 ]:[
  "Follow the assigned role workflow and request administrator assistance where an assignment is missing",
  "Use every portal regardless of authorization",
  "Bypass registration controls",
  "Share restricted records with other users"
 ];
 return{
  q1:{label:"1. What is the correct first action for your registered role?",options:q1Options},
  q2:{label:"2. Based on your first answer, which system action follows?",options:q2Options},
  q3:{label:"3. What should you do when the workflow reaches a department, unit, approval or signature boundary?",options:q3Options}
 };
}

function ChoiceField({label,value,onChange,options,help,disabled=false,required=true}){
 return <div className="form-field"><label>{label}</label><select value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled} required={required}><option value="">Select an answer</option>{options.map(x=><option key={x} value={x}>{x}</option>)}</select>{help&&<small className="field-help">{help}</small>}</div>;
}

export default function InductionOrientation(){
 const[context,setContext]=useState(null),[busy,setBusy]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const[form,setForm]=useState({identityConfirmation:"",primaryRole:"",department:"",unit:"",employmentType:"",orientationModules:[],q1:"",q2:"",q3:"",comments:"",declaration:false});

 useEffect(()=>{let live=true;(async()=>{
  try{
   const c=await getCurrentInductionContext();
   if(!live)return;
   setContext(c);
   const prior=c.existingRequest?.answers||{};
   const priorModules=Array.isArray(c.existingRequest?.orientationModules)?c.existingRequest.orientationModules:[];
   setForm({
    identityConfirmation:prior.identityConfirmation||"",
    primaryRole:prior.primaryRole||c.roles[0]||"",
    department:prior.department||c.department||"",
    unit:prior.unit||c.unit||"",
    employmentType:prior.employmentType||c.employmentType||"",
    orientationModules:priorModules.length?priorModules:orientationModules(c.roles[0]||""),
    q1:prior.q1||"",q2:prior.q2||"",q3:prior.q3||"",
    comments:prior.comments||"",declaration:Boolean(c.existingRequest?.declaration)
   });
  }catch(e){if(live)setError(e.message||"Unable to retrieve the IRPA registration and invitation information.");}
  finally{if(live)setBusy(false);}
 })();return()=>{live=false}},[]);

 const roleOptions=useMemo(()=>unique(context?.roles||[]),[context]);
 const departmentOptions=useMemo(()=>unique([context?.department,...(context?.invitations||[]).map(x=>x.department)]),[context]);
 const unitOptions=useMemo(()=>{
  const selected=form.department;
  return unique([context?.unit,...(context?.invitations||[]).filter(x=>x.department===selected).map(x=>x.unit),...(DEPARTMENT_UNITS[selected]||[])]);
 },[context,form.department]);
 const employmentOptions=useMemo(()=>unique([context?.employmentType,...(context?.invitations||[]).map(x=>x.employmentType),"Full-time","Part-time","Contract","Consultancy","Internship"]),[context]);
 const moduleOptions=useMemo(()=>orientationModules(form.primaryRole||context?.role||""),[form.primaryRole,context]);
 const questions=useMemo(()=>questionSet(form.primaryRole||context?.role||"",form.department,form.q1),[form.primaryRole,form.department,form.q1]);
 const linked=String(context?.existingRequest?.status||"")==="Linked"||String(context?.existingRequest?.roleAssignmentStatus||"")==="Linked";
 const pending=Boolean(context?.existingRequest&&!linked);

 function patch(name,value){
  setForm(x=>{
   const next={...x,[name]:value};
   if(name==="primaryRole"){next.q1="";next.q2="";next.q3="";next.orientationModules=orientationModules(value);}
   if(name==="department"){next.unit="";next.q3="";}
   if(name==="q1")next.q2="";
   return next;
  });
 }
 function toggleModule(value){setForm(x=>({...x,orientationModules:x.orientationModules.includes(value)?x.orientationModules.filter(v=>v!==value):[...x.orientationModules,value]}));}

 async function submit(e){
  e.preventDefault();setError("");setMessage("");
  if(!context){setError("The IRPA registration could not be retrieved. The application is blocked.");return}
  if(form.identityConfirmation!=="Yes"){setError("You must confirm that the displayed registration and invitation information belongs to you.");return}
  if(!form.primaryRole||!form.department||!form.unit||!form.employmentType||!form.q1||!form.q2||!form.q3||!form.orientationModules.length||!form.declaration){setError("Please complete all required selections before submitting.");return}
  setSaving(true);
  try{
   const result=await submitInductionApplication(form,context);
   if(result.alreadyLinked){setMessage("Your induction has already been approved and linked by an administrator.");return}
   setMessage("Induction and Orientation submitted successfully. Your application is now awaiting administrator LINK. Your registered role(s), department/unit and Board Member status remain system-controlled.");
  }catch(x){setError(x.message||"The induction application could not be submitted.");}
  finally{setSaving(false);}
 }

 if(busy)return <div className="page"><section className="panel"><h2>Induction and Orientation</h2><p className="muted">Retrieving your registered IRPA information and invitation details…</p></section></div>;
 if(error&&!context)return <div className="page"><section className="panel"><h2>Induction and Orientation — Access Check</h2><div className="error-message action-feedback">{error}</div><p className="panel-description">The system could not retrieve a matching IRPA registration/invitation record, so the application remains blocked.</p></section></div>;

 return <div className="page">
  <section className="welcome-panel">
   <div><span className="eyebrow">IRPA INDUCTION & ORIENTATION</span><h1>Registration-Linked Induction Application</h1><p>The form is pre-filled from your authenticated IRPA Member/Employee registration and invitation records. Choices are generated from the information already registered in the system.</p></div>
   <div className="identity-card"><span>APPLICATION STATUS</span><strong>{linked?"LINKED":pending?"PENDING LINK":"READY"}</strong><small>{linked?"Administrator approval completed":pending?"Awaiting administrator LINK":"Complete the guided form below"}</small></div>
  </section>

  {message&&<div className="success-message action-feedback" role="status">{message}</div>}
  {error&&<div className="error-message action-feedback" role="alert">{error}</div>}

  <section className="panel">
   <div className="panel-header"><div><span className="eyebrow">SYSTEM-RETRIEVED IDENTITY</span><h2>Your Registered Information</h2><p className="panel-description">These fields are retrieved from IRPA registration/invitation records. The registration number is intentionally withheld during induction and is issued to you by email after the administrator completes LINK.</p></div></div>
   <div className="detail-grid">
    <div><span>FULL NAME</span><strong>{context.fullName||"—"}</strong></div>
    <div><span>REGISTERED ROLE(S)</span><strong>{context.role||"—"}</strong></div>
    <div><span>DEPARTMENT</span><strong>{context.department||"—"}</strong></div>
    <div><span>UNIT</span><strong>{context.unit||"—"}</strong></div>
    <div><span>BOARD MEMBER</span><strong>{context.boardMember?"Yes":"No"}</strong></div>
    <div><span>REGISTRATION NUMBER</span><strong>Issued by email after administrator LINK</strong></div>
    <div><span>INVITATION</span><strong>{context.invitation?"Matched":"No separate invitation found"}</strong></div>
    <div><span>INVITATION REFERENCE</span><strong>{context.invitation?.invitationReference||context.invitation?.reference||context.invitationId||"—"}</strong></div>
   </div>
  </section>

  <form onSubmit={submit}>
   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 1</span><h2>Identity Confirmation</h2></div></div>
    <ChoiceField label="Does the system-retrieved identity above belong to you?" value={form.identityConfirmation} onChange={v=>patch("identityConfirmation",v)} options={["Yes","No"]} help="Selecting No blocks submission so the registration/invitation record can be corrected before induction."/>
   </section>

   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 2</span><h2>Role, Department & Unit</h2><p className="panel-description">The choices below are constrained by your registered information and the department/unit structure.</p></div></div>
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
    <div className="panel-header"><div><span className="eyebrow">STEP 4</span><h2>Adaptive Orientation Check</h2><p className="panel-description">The available answers change according to your selected role, department and previous answer.</p></div></div>
    <div className="form-grid">
     <ChoiceField label={questions.q1.label} value={form.q1} onChange={v=>patch("q1",v)} options={questions.q1.options}/>
     <ChoiceField label={questions.q2.label} value={form.q2} onChange={v=>patch("q2",v)} options={questions.q2.options} disabled={!form.q1}/>
     <ChoiceField label={questions.q3.label} value={form.q3} onChange={v=>patch("q3",v)} options={questions.q3.options}/>
    </div>
    <div className="form-field" style={{marginTop:16}}><label>Additional orientation comments</label><textarea value={form.comments} onChange={e=>patch("comments",e.target.value)} rows="4" placeholder="Optional comments, questions or support required during induction…"/></div>
   </section>

   <section className="panel">
    <div className="panel-header"><div><span className="eyebrow">STEP 5</span><h2>Declaration & Submission</h2><p className="panel-description">Submission creates/updates your induction application and routes it to the administrator for the required <strong>LINK</strong> action.</p></div></div>
    <label style={{display:"flex",gap:10,alignItems:"flex-start"}}><input type="checkbox" checked={form.declaration} onChange={e=>patch("declaration",e.target.checked)} required/><span>I confirm that I have reviewed the system-retrieved registration/invitation information, completed the orientation selections truthfully, and understand that my final role, department/unit and Board Member status are validated from the IRPA system.</span></label>
    <div className="form-actions" style={{marginTop:18}}><button type="submit" disabled={saving||linked}>{saving?"SUBMITTING…":linked?"ALREADY LINKED":"SUBMIT INDUCTION APPLICATION"}</button></div>
   </section>
  </form>
 </div>;
}