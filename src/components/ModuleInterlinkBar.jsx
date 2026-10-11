import React,{useEffect,useState}from"react";
import{readWorkflowContext,navigateWorkflow,workflowLinkEntries}from"../firebase/workflowLinks";
import"../styles/interlinks.css";
import ResearchEvidenceExchange from"./ResearchEvidenceExchange";

const PORTAL_GROUPS=[
  {label:"Meeting Portal",target:"Meetings",children:[
    ["Meeting Room Portal","Meeting Room"],["Participants Portal","Participants"],["Resolutions Portal","Resolutions"],
    ["Voting Portal","Voting"],["Decisions Portal","Decisions"]
  ]},
  {label:"Documents Portal",target:"Documents",children:[
    ["My Documents","Documents","MY_WORK"],["Department Documents","Documents","DEPARTMENT"],
    ["Shared With Me","Documents","SHARED"],["Signing Workspace","Documents","SIGNATURE"],
    ["Post-Signature Work","Documents","POST"],["Final Archive","Documents","FINAL"],["Upload Document","Documents","UPLOAD"],["Retrieve Archived Documents","Documents","RETRIEVAL"]
  ]}
];
const CORE=[
  ["Documents Portal","Documents"],["Signature Portal","Signature Platform"],["Authorization & Approvals Portal","Authorization & Approvals"],
  ["Employee Payments Portal","Employee Payments"],["Reports Portal","Reports"],["Actions Portal","Actions"]
];
/* Explicit cross-portal provisions for interactive sub-portals.
   These links appear only inside the in-portal workflow bar, never in global Back/Next navigation. */
const INTERACTIVE_PORTAL_CONNECTIONS={
  "Meeting Room":["Meetings","Participants","Documents","Actions","Decisions"],
  "Participants":["Meetings","Meeting Room","Documents","Actions","Decisions"],
  "Resolutions":["Meetings","Voting","Decisions","Actions","Documents"],
  "Voting":["Meetings","Resolutions","Decisions"],
  "Decisions":["Meetings","Resolutions","Actions","Documents","Reports","Authorization & Approvals"],
  "Actions":["Meetings","Decisions","Documents","Authorization & Approvals","Reports","Procurement"],
  "Procurement":["Finance Portfolio","Authorization & Approvals","Documents","Reports","Employee Payments"],
  "Induction Applications":["Induction and Orientation","Members & Personnel","Documents","Authorization & Approvals"]
};
const MODULE_LABELS={"Meetings":"Meeting Portal","Meeting Room":"Meeting Room Portal","Participants":"Participants Portal","Resolutions":"Resolutions Portal","Voting":"Voting Portal","Decisions":"Decisions Portal","Actions":"Actions Portal","Finance Portfolio":"Finance Portal","Procurement":"Procurement Portal","Induction and Orientation":"Induction & Orientation Portal","Induction Applications":"Induction Applications Portal","Members & Personnel":"Members & Personnel Portal","Documents":"Documents Portal","Authorization & Approvals":"Authorization & Approvals Portal","Reports":"Reports Portal","Employee Payments":"Employee Payments Portal"};

function contextLabel(c){if(!c)return"";return c.resolutionReference||c.meetingReference||c.documentReference||c.procurementReference||c.authorizationReference||c.employeeNumber||""}
export default function ModuleInterlinkBar({active,onNavigate,admin=false,role="",modules=[]}){
  const[context,setContext]=useState(null),[feedback,setFeedback]=useState(""),[activeBranch,setActiveBranch]=useState("");
  const finance=admin||["Executive Director","Finance Personnel","Finance Manager","Accountant","Finance Officer"].includes(role);
  useEffect(()=>{const sync=()=>setContext(readWorkflowContext());sync();const handler=e=>setContext(e?.detail?.context||readWorkflowContext());window.addEventListener("irpa:navigate",handler);return()=>window.removeEventListener("irpa:navigate",handler)},[active]);
  const go=(target,branch=null)=>{
    if(branch){setActiveBranch(branch);const openBranch=()=>window.dispatchEvent(new CustomEvent("irpa:portal-branch",{detail:{portal:target,branch}}));if(target!==active&&onNavigate){onNavigate(target);window.setTimeout(openBranch,180)}else openBranch();setFeedback(branch==="UPLOAD"?"Opening document upload…":"Opening "+branch.replaceAll("_"," ").toLowerCase()+"…");return}
    if(target===active){setFeedback(target+" is already open.");return}
    setFeedback("Opening "+target+"…");
    const current=readWorkflowContext()||{};
    navigateWorkflow(target,current);
    if(onNavigate)onNavigate(target);
    window.setTimeout(()=>setFeedback(target+" opened."),120);
  };
  const label=contextLabel(context);
  const linked=workflowLinkEntries(context||{});
  const connectedPortals=(INTERACTIVE_PORTAL_CONNECTIONS[active]||[]).filter(target=>target!==active&&modules.includes(target)&&((target!=="Finance Portfolio"&&target!=="Procurement")||finance));
  return <><ResearchEvidenceExchange active={active} onNavigate={onNavigate}/><section className="module-interlink-bar" aria-label="Related governance modules">{feedback&&<div className="action-feedback" role="status" aria-live="polite">{feedback}</div>}
    <div className="module-interlink-heading"><span>CONNECTED WORKFLOW</span><small>Move directly between linked institutional records</small>{label&&<strong className="workflow-context-chip">Linked record: {label}</strong>}</div>
    <div className="module-interlink-list">
      {PORTAL_GROUPS.filter(group=>group.target!=="Finance Portfolio"||finance).map(group=><div key={group.target} className={"workflow-portal-group"+(active===group.target||group.children.some(([,target])=>target===active)?" active-group":"")}>
        <button type="button" className={"workflow-portal-parent"+(active===group.target?" active":"")} onClick={()=>go(group.target)}>{group.label}</button>
        <div className="workflow-portal-children">
          {group.children.map(([itemLabel,target,branch])=><React.Fragment key={branch||target}>{target==="Actions"&&<span className="workflow-row-break" aria-hidden="true"/>}<button type="button" className={target===active&&(!branch||branch===activeBranch)?"active workflow-action-portal":"workflow-action-portal"} onClick={()=>go(target,branch||null)}>{itemLabel}</button></React.Fragment>)}
        </div>
      </div>)}
      {CORE.map(([itemLabel,target])=><button key={target} type="button" className={target===active?"active":""} onClick={()=>go(target)}>{itemLabel}</button>)}
    </div>
    {connectedPortals.length>0&&<div className="workflow-linked-records workflow-connected-portals"><span>CONNECTED PORTALS FOR THIS WORKFLOW</span>{connectedPortals.map(target=><button key={"connected-"+target} type="button" className={target===active?"linked-active":""} onClick={()=>go(target)}>{MODULE_LABELS[target]||target}</button>)}</div>}
    {linked.length>0&&<div className="workflow-linked-records"><span>ACTIVE RECORD LINKS</span>{linked.map(link=><button key={link.module+"-"+(link.id||link.reference)} type="button" className={link.module===active?"linked-active":""} onClick={()=>go(link.module)}>{link.module}: {link.reference}</button>)}</div>}
  </section></>;
}