import React from "react";

const CORE=[
  ["Meetings","Meetings"],["Participants","Participants"],["Meeting Room","Meeting Room"],
  ["Resolutions","Resolutions"],["Voting","Voting"],["Decisions","Decisions"],["Actions","Actions"],
  ["Documents","Documents"],["Signature Platform","Signature Platform"],["Authorization","Authorization & Approvals"],
  ["Employee Payments","Employee Payments"],["Reports","Reports"]
];
const FINANCE=[["Finance","Finance Portfolio"],["Procurement","Procurement"]];

export default function ModuleInterlinkBar({active,onNavigate,admin=false,role=""}){
  const finance=admin||["Executive Director","Finance Personnel","Finance Manager","Accountant","Finance Officer"].includes(role);
  const items=finance?[...CORE,...FINANCE]:CORE;
  const go=target=>{
    if(target===active)return;
    if(onNavigate)onNavigate(target);
    else window.dispatchEvent(new CustomEvent("irpa:navigate",{detail:target}));
  };
  return <section className="module-interlink-bar" aria-label="Related governance modules">
    <div className="module-interlink-heading"><span>CONNECTED WORKFLOW</span><small>Move directly between linked institutional records</small></div>
    <div className="module-interlink-list">
      {items.map(([label,target])=><button key={target} type="button" className={target===active?"active":""} onClick={()=>go(target)}>{label}</button>)}
    </div>
  </section>;
}
