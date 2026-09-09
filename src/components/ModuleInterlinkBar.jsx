import React,{useEffect,useState}from"react";
import{readWorkflowContext,navigateWorkflow,workflowLinkEntries}from"../firebase/workflowLinks";
import"../styles/interlinks.css";

const CORE=[
  ["Meetings","Meetings"],["Participants","Participants"],["Meeting Room","Meeting Room"],
  ["Resolutions","Resolutions"],["Voting","Voting"],["Decisions","Decisions"],["Actions","Actions"],
  ["Documents","Documents"],["Signature Platform","Signature Platform"],["Authorization","Authorization & Approvals"],
  ["Employee Payments","Employee Payments"],["Reports","Reports"]
];
const FINANCE=[["Finance","Finance Portfolio"],["Procurement","Procurement"]];
function contextLabel(c){if(!c)return"";return c.resolutionReference||c.meetingReference||c.documentReference||c.procurementReference||c.authorizationReference||c.employeeNumber||""}
export default function ModuleInterlinkBar({active,onNavigate,admin=false,role=""}){
  const[context,setContext]=useState(null);
  const finance=admin||["Executive Director","Finance Personnel","Finance Manager","Accountant","Finance Officer"].includes(role);
  const items=finance?[...CORE,...FINANCE]:CORE;
  useEffect(()=>{const sync=()=>setContext(readWorkflowContext());sync();const handler=e=>setContext(e?.detail?.context||readWorkflowContext());window.addEventListener("irpa:navigate",handler);return()=>window.removeEventListener("irpa:navigate",handler)},[active]);
  const go=target=>{
    if(target===active)return;
    const current=readWorkflowContext()||{};
    navigateWorkflow(target,current);
    if(onNavigate)onNavigate(target);
  };
  const label=contextLabel(context);
  const linked=workflowLinkEntries(context||{});
  return <section className="module-interlink-bar" aria-label="Related governance modules">
    <div className="module-interlink-heading"><span>CONNECTED WORKFLOW</span><small>Move directly between linked institutional records</small>{label&&<strong className="workflow-context-chip">Linked record: {label}</strong>}</div>
    <div className="module-interlink-list">
      {items.map(([itemLabel,target])=><button key={target} type="button" className={target===active?"active":""} onClick={()=>go(target)}>{itemLabel}</button>)}
    </div>
    {linked.length>0&&<div className="workflow-linked-records"><span>ACTIVE LINKS</span>{linked.map(link=><button key={`${link.module}-${link.id||link.reference}`} type="button" className={link.module===active?"linked-active":""} onClick={()=>go(link.module)}>{link.module}: {link.reference}</button>)}</div>}
  </section>;
}
