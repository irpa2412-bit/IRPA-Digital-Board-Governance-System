import React,{useEffect,useMemo,useState}from"react";
import{doc,getDoc,setDoc,serverTimestamp}from"firebase/firestore";
import{auth,db}from"../firebase/config";

const uniqueNonEmpty=(values)=>[...new Set(values.map(v=>String(v||"").trim()).filter(Boolean))];
const assignedOptions=(primary,secondary,fallbacks)=>uniqueNonEmpty([primary,secondary,...fallbacks]);
const SelectField=({label,value,onChange,options,placeholder,disabled=false})=><label>{label}<select value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled}><option value="">{placeholder}</option>{options.map(v=><option key={v} value={v}>{v}</option>)}</select></label>;

const ROLE_GUIDES={
"Board Member":{title:"Board Member Orientation",focus:"Governance oversight, fiduciary responsibility, meetings, resolutions, voting, records and signatures.",steps:["Sign in and confirm your member profile and contact details.","Review the Dashboard, Meetings and Meeting Room modules.","Learn how agendas, papers, resolutions and actions are handled.","Use Voting only when a formal voting session is opened for you.","Use Signature Platform for documents requiring your authorised signature.","Review Documents, Decisions, Reports and the Audit Trail relevant to your authority.","Protect your password, device and confidential IRPA information."]},
"Executive Director":{title:"Executive Director Orientation",focus:"Institutional leadership, approvals, delegation, oversight and executive workflow.",steps:["Confirm your executive profile and delegated authorities.","Review Meetings, Resolutions, Authorization & Approvals and Actions.","Review Finance Portfolio and Procurement where authorised.","Use Signature Platform for documents within your signing authority.","Review Reports, Decisions and Risk Register for management oversight.","Confirm that approvals are supported by the required records and evidence."]},
"Finance":{title:"Finance & Accounting Orientation",focus:"Financial records, budgets, transactions, approvals, reconciliations and procurement-to-finance handoffs.",steps:["Confirm your Finance/Accounting role and unit.","Open Finance Portfolio and review your permitted functions.","Review authorised payment and procurement handoff records.","Understand review, approval, posting and reconciliation status controls.","Use Documents for finance evidence and the designated archive categories.","Only approve or advance records within your assigned approving authority."]},
"Procurement":{title:"Procurement Orientation",focus:"Procurement requests, quotations, evidence, vendor records, review, authorisation and Finance handoff.",steps:["Confirm your Procurement role and Procurement Unit assignment.","Review procurement requests and the supplier/vendor register.","Learn quotation and evidence upload requirements.","Review procurement workflow stages and approval handoffs.","Use the Finance handoff register when an authorised procurement record moves to Finance.","Only review or approve records within your designated authority."]},
"Human Resources":{title:"Human Resources Orientation",focus:"People records, employee administration, invitations, member/employee support and controlled HR workflows.",steps:["Confirm your HR role and department.","Review Members & Personnel and Invitations according to your access.","Understand employee registration, profile and status controls.","Use Documents and Signature Platform for authorised HR records.","Protect personal and employment information and follow access restrictions."]},
"General Employee":{title:"Employee Orientation",focus:"Secure access, personal workspace, meetings, assigned actions, documents, signatures and employee services.",steps:["Confirm your registered role, department and unit.","Review Dashboard, Meetings, Actions, Documents and Signature Platform.","Use Authorization & Approvals only for requests assigned to you.","Use Employee Payments for your authorised staff payment workflows.","Complete assigned actions and keep your profile information current.","Do not attempt to access Finance, Procurement or other restricted portals unless your role authorises them."]},
"Programme & Technical":{title:"Programme & Technical Orientation",focus:"Programme/technical workspaces, meetings, actions, documents, evidence and assigned implementation duties.",steps:["Confirm your role and department.","Review Meetings, Actions, Documents and Reports available to you.","Record implementation evidence in the designated governance workflow.","Use Signature Platform only within your signing authority.","Maintain accurate records and respect confidential information."]},
"Operations":{title:"Operations Orientation",focus:"Operational coordination, implementation actions, records, meetings and institutional workflows.",steps:["Confirm your Operations role and department.","Review Meetings, Actions, Documents and Reports.","Track operational actions through their assigned workflow.","Use Signature Platform only for authorised documents.","Escalate approvals through the formal Authorization & Approvals workflow."]},
"Field":{title:"Field Department Orientation",focus:"Field implementation, assigned actions, reporting, evidence and operational coordination.",steps:["Confirm your Field role and assignment.","Review Meetings, Actions, Documents and Reports.","Record field evidence through the authorised workflow.","Keep implementation records complete and timely.","Use only the modules assigned to your role."]},
"Director":{title:"Directorate Orientation",focus:"Director-level oversight, departmental workflow, approvals, reports, risks and institutional accountability.",steps:["Confirm your directorate and delegated authority.","Review Dashboard, Meetings, Actions, Reports and Risk Register.","Review authorization requests within your delegated authority.","Use Documents and Signature Platform for authorised records.","Coordinate departmental actions through the formal governance workflow."]}
};

function guideFor(profile,employee){
 const role=String(profile?.role||employee?.role||"").trim();
 const dept=String(profile?.department||employee?.department||"").trim();
 const unit=String(profile?.unit||employee?.unit||"").trim();
 if(/board member/i.test(role)||profile?.boardMember)return ROLE_GUIDES["Board Member"];
 if(role==="Executive Director")return ROLE_GUIDES["Executive Director"];
 if(/finance|accountant|accounts/i.test(role+" "+dept+" "+unit))return ROLE_GUIDES["Finance"];
 if(/procurement/i.test(role+" "+dept+" "+unit))return ROLE_GUIDES["Procurement"];
 if(/human resources|hr manager|hr officer/i.test(role+" "+dept+" "+unit))return ROLE_GUIDES["Human Resources"];
 if(/programme|technical/i.test(role+" "+dept))return ROLE_GUIDES["Programme & Technical"];
 if(/operations/i.test(role+" "+dept))return ROLE_GUIDES["Operations"];
 if(/field/i.test(role+" "+dept))return ROLE_GUIDES["Field"];
 if(/^director|director /i.test(role))return ROLE_GUIDES["Director"];
 return ROLE_GUIDES["General Employee"];
}

export default function InductionOrientation({profile,employee}){
 const user=auth.currentUser;
 const systemIdentity=useMemo(()=>({fullName:String(employee?.name||profile?.name||user?.displayName||"").trim(),role:String(employee?.role||profile?.role||"").trim(),department:String(employee?.department||profile?.department||"").trim(),unit:String(employee?.unit||profile?.unit||"").trim()}),[profile,employee,user?.displayName]);
 const [registration,setRegistration]=useState(null),[lookupBusy,setLookupBusy]=useState(false),[lookupMessage,setLookupMessage]=useState("");
 const nameChoices=useMemo(()=>[...new Map([employee?.name,profile?.name,user?.displayName].filter(Boolean).map(name=>[String(name).trim().toLowerCase(),String(name).trim()])).values()], [employee?.name,profile?.name,user?.displayName]);
 const roleChoices=useMemo(()=>assignedOptions(registration?.role,systemIdentity.role,[]),[registration?.role,systemIdentity.role]);
 const departmentChoices=useMemo(()=>assignedOptions(registration?.department,systemIdentity.department,[]),[registration?.department,systemIdentity.department]);
 const unitChoices=useMemo(()=>assignedOptions(registration?.unit,systemIdentity.unit,[]),[registration?.unit,systemIdentity.unit]);
 const [form,setForm]=useState({fullName:systemIdentity.fullName,role:systemIdentity.role,department:systemIdentity.department,unit:systemIdentity.unit,completedSteps:[],q1:"",q2:"",q3:"",comments:"",declaration:false});
 const guide=useMemo(()=>guideFor({...profile,role:form.role||profile?.role,department:form.department||profile?.department,unit:form.unit||profile?.unit},employee),[profile,employee,form.role,form.department,form.unit]);
 const [busy,setBusy]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState("");
 const steps=guide.steps;
 useEffect(()=>{let live=true;(async()=>{if(!user){setBusy(false);return}try{const s=await getDoc(doc(db,"inductionRecords",user.uid));if(live&&s.exists())setForm(x=>({...x,...s.data(),fullName:systemIdentity.fullName,role:systemIdentity.role,department:systemIdentity.department,unit:systemIdentity.unit}));}catch(e){if(live)setMessage("Unable to load your induction record: "+(e.message||"Unknown error"));}finally{if(live)setBusy(false)}})();return()=>{live=false}},[user?.uid,systemIdentity]);
 async function lookupRegistration(fullName) {
  const value=String(fullName||"").trim();
  if(!user){setRegistration(null);setLookupMessage("Please sign in to retrieve your IRPA registration information.");return}
  const matchedName=nameChoices.find(n=>n.toLowerCase()===value.toLowerCase());
  if(!matchedName){setRegistration(null);setLookupMessage("This name is not present in the authenticated IRPA registration profile. The induction application is blocked.");return}
  setLookupBusy(true);setLookupMessage("");
  try{
    const sourceMember=profile||{};
    const sourceEmployee=employee||{};
    const role=String(sourceEmployee.role||sourceMember.role||"").trim();
    const department=String(sourceEmployee.department||sourceMember.department||"").trim();
    const unit=String(sourceEmployee.unit||sourceMember.unit||"").trim();
    const registrationNumber=String(sourceEmployee.employeeNumber||sourceMember.memberNumber||"").trim();
    if(!role && !registrationNumber) throw new Error("No registered role or registration number could be retrieved from the IRPA system. The induction application is blocked.");
    if(!department && !sourceMember.boardMember && !/board member/i.test(role)) throw new Error("No registered department could be retrieved from the IRPA system. The induction application is blocked.");
    const registration={fullName:matchedName,role,department,unit,registrationNumber,sources:[sourceEmployee.uid?"Employees":"Members"].filter(Boolean),memberType:sourceMember.memberType||"—",employmentType:sourceEmployee.employmentType||"—",invitationStatus:sourceMember.invitationId||sourceEmployee.invitationId?"Registered invitation":"Registered account"};
    setRegistration(registration);
    setForm(x=>({...x,fullName:matchedName,role,department,unit}));
    setLookupMessage("System registration retrieved successfully. The application may proceed.");
  }catch(error){setRegistration(null);setLookupMessage(error.message||"Unable to retrieve registration information.");}
  finally{setLookupBusy(false)}
}

useEffect(()=>{
  if(!form.fullName){setRegistration(null);setLookupMessage("");return}
  const timer=setTimeout(()=>lookupRegistration(form.fullName),200);
  return()=>clearTimeout(timer);
},[form.fullName,user?.uid,nameChoices.join("|")]);
}