import React,{useEffect,useState}from"react";
import{readWorkflowContext,navigateWorkflow,workflowLinkEntries}from"../firebase/workflowLinks";
import"../styles/interlinks.css";import{getProjectedPermissions,moduleHasProjectedAccess}from"../firebase/authorizationAccess";

const PORTAL_GROUPS=[
  {label:"Meeting Portal",target:"Meetings",children:[
    ["Meeting Room Portal","Meeting Room"],["Participants Portal","Participants"],["Resolutions Portal","Resolutions"],
    ["Voting Portal","Voting"],["Decisions Portal","Decisions"],["Actions Portal","Actions"]
  ]},
  {label:"Finance Portal",target:"Finance Portfolio",children:[["Procurement Portal","Procurement"]]}
];
const CORE=[
  ["Documents Portal","Documents"],["Signature Portal","Signature Platform"],["Authorization & Approvals Portal","Authorization & Approvals"],
  ["Employee Payments Portal","Employee Payments"],["Reports Portal","Reports"]
];
function contextLabel(c){if(!c)return"";return c.resolutionReference||c.meetingReference||c.documentReference||c.procurementReference||c.authorizationReference||c.employeeNumber||""}
export default function ModuleInterlinkBar({active,onNavigate,admin=false,role="",roles=[]}){
  const[context,setContext]=useState(null),[feedback,setFeedback]=useState("");
  const projectedPermissions=getProjectedPermissions({role,roles},null,admin);const finance=admin||moduleHasProjectedAccess("Finance Portfolio",projectedPermissions);const canModule=target=>admin||moduleHasProjectedAccess(target,projectedPermissions);
  useEffect(()=>{const sync=()=>setContext(readWorkflowContext());sync();const handler=e=>setContext(e?.detail?.context||readWorkflowContext());window.addEventListener("irpa:navigate",handler);return()=>window.removeEventListener("irpa:navigate",handler)},[active]);
  const go=target=>{
    if(target===active){setFeedback(target+" is already open.");return}
    setFeedback("Opening "+target+"…");
    const current=readWorkflowContext()||{};
    navigateWorkflow(target,current);
    if(onNavigate)onNavigate(target);
    window.setTimeout(()=>setFeedback(target+" opened."),120);
  };
  const label=contextLabel(context);
  const linked=workflowLinkEntries(context||{});
  return <section className="module-interlink-bar" aria-label="Related governance modules">{feedback&&<div className="action-feedback" role="status" aria-live="polite">{feedback}</div>}
    <div className="module-interlink-heading"><span>CONNECTED WORKFLOW</span><small>Move directly between linked institutional records</small>{label&&<strong className="workflow-context-chip">Linked record: {label}</strong>}</div>
    <div className="module-interlink-list">
      {PORTAL_GROUPS.filter(group=>group.target!=="Finance Portfolio"||finance).map(group=><div key={group.target} className={"workflow-portal-group"+(active===group.target||group.children.some(([,target])=>target===active)?" active-group":"")}>
        <button type="button" className={"workflow-portal-parent"+(active===group.target?" active":"")} onClick={()=>go(group.target)}>{group.label}</button>
        <div className="workflow-portal-children">
          {group.children.filter(([,target])=>canModule(target)).map(([itemLabel,target])=><button key={target} type="button" className={target===active?"active":""} onClick={()=>go(target)}>{itemLabel}</button>)}
        </div>
      </div>)}
      {CORE.filter(([,target])=>canModule(target)).map(([itemLabel,target])=><button key={target} type="button" className={target===active?"active":""} onClick={()=>go(target)}>{itemLabel}</button>)}
    </div>
    {linked.length>0&&<div className="workflow-linked-records"><span>ACTIVE LINKS</span>{linked.map(link=><button key={link.module+"-"+(link.id||link.reference)} type="button" className={link.module===active?"linked-active":""} onClick={()=>go(link.module)}>{link.module}: {link.reference}</button>)}</div>}
  </section>;
}