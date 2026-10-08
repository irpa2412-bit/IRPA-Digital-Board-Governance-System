import React from "react";

export const GOVERNANCE_FIELD_TYPES=[
  "Signature","Initials","Date","Name","Text","Number","Comment","Remarks","Checkbox"
];

export const GOVERNANCE_FIELD_LABELS={
  Signature:"Signature",
  Initials:"Initials",
  Date:"Date & Time",
  Name:"Name",
  Text:"Text",
  Number:"Number",
  Comment:"Comment",
  Remarks:"Remarks",
  Checkbox:"Checkbox"
};

const RESPONSIBILITY={
  Signature:"Signature",
  Initials:"Initial",
  Date:"Date",
  Name:"Identity",
  Text:"Text Entry",
  Number:"Number Entry",
  Comment:"Comment",
  Remarks:"Remarks",
  Checkbox:"Approval / Confirmation"
};

export default function GovernanceFieldPalette({onAddField,context="Governance workflow",disabled=false,compact=false}){
  return <section className="panel" data-governance-field-palette="true" style={{marginTop:16}}>
    <div className="panel-header">
      <div>
        <span className="eyebrow">UNIFIED FIELD PALETTE</span>
        <h2 style={{marginBottom:4}}>Signing &amp; Action Fields</h2>
        <p className="panel-description">Available through Meeting Room, Signature Portal, and Authorisation &amp; Approval. Authorisation and approval actions use the same signing field set.</p>
      </div>
      <span className="status-badge">{context}</span>
    </div>
    <div style={{display:"grid",gridTemplateColumns:compact?"repeat(3,minmax(0,1fr))":"repeat(3,minmax(120px,1fr))",gap:8}}>
      {GOVERNANCE_FIELD_TYPES.map(type=><button key={type} type="button" disabled={disabled} onClick={()=>onAddField?.(type)} title={"Add "+GOVERNANCE_FIELD_LABELS[type]} style={{textAlign:"left",padding:"10px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--surface)",color:"var(--text)",cursor:disabled?"not-allowed":"pointer",opacity:disabled?.55:1}}>
        <strong style={{display:"block"}}>{GOVERNANCE_FIELD_LABELS[type]}</strong>
        <small style={{display:"block",marginTop:3,opacity:.72}}>{RESPONSIBILITY[type]}</small>
      </button>)}
    </div>
  </section>;
}
