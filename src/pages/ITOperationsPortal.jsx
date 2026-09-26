import React,{useMemo}from"react";

export default function ITOperationsPortal({user,profile,employee,selectedAuthority,onNavigate}){
  const identity=useMemo(()=>({
    name:employee?.name||profile?.name||user?.displayName||user?.email||"IRPA User",
    employeeNumber:employee?.employeeNumber||"",
    department:employee?.department||profile?.department||"",
    unit:employee?.unit||employee?.unitName||profile?.unit||"",
    role:selectedAuthority||"IT Specialist"
  }),[employee,profile,user,selectedAuthority]);

  const cards=[
    ["Document Operations","Documents","Access controlled document workflows available to an authorised employee session.","document"],
    ["Meeting Support","Meetings","Open the meeting workspace used for technical and operational support.","calendar"],
    ["System Resources","Downloads","Access the current IRPA application and release resources.","download"]
  ];

  return <div className="page">
    <section className="welcome-panel">
      <div>
        <span className="eyebrow">IT OPERATIONS WORKSPACE</span>
        <h1>{identity.role}</h1>
        <p>Technical and digital operations workspace for the declared IRPA IT capacity.</p>
      </div>
      <div className="identity-card">
        <span>Authenticated capacity</span>
        <strong>{identity.role}</strong>
        <small>{identity.name}{identity.employeeNumber?" · "+identity.employeeNumber:""}</small>
      </div>
    </section>

    <section className="panel" style={{marginTop:18}}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INSTITUTIONAL IDENTITY</span>
          <h2>Current IT Assignment</h2>
          <p className="muted">This workspace is opened only after the authenticated user explicitly declares an IT capacity. It does not convert Administrator privileges into IT privileges.</p>
        </div>
      </div>
      <div className="detail-grid" style={{marginTop:16}}>
        <div><span>Name</span><strong>{identity.name}</strong></div>
        <div><span>Employee Number</span><strong>{identity.employeeNumber||"Not recorded"}</strong></div>
        <div><span>Department</span><strong>{identity.department||"Not recorded"}</strong></div>
        <div><span>Unit</span><strong>{identity.unit||"Not recorded"}</strong></div>
        <div><span>Declared Role</span><strong>{identity.role}</strong></div>
        <div><span>Session Boundary</span><strong>IT capacity only</strong></div>
      </div>
    </section>

    <section className="panel" style={{marginTop:18}}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">IT WORK QUEUE</span>
          <h2>Operational Access</h2>
          <p className="muted">These entry points are routed through the normal server-side authorization controls. No Administrator-only control is exposed by this workspace.</p>
        </div>
      </div>
      <div className="dashboard-grid" style={{marginTop:16}}>
        {cards.map(([title,target,description,icon])=><button key={target} type="button" className="stat-card" onClick={()=>onNavigate?.(target)} style={{textAlign:"left",cursor:"pointer"}}>
          <span>{icon.toUpperCase()}</span>
          <strong>{title}</strong>
          <small>{description}</small>
          <b style={{display:"block",marginTop:10}}>Open {target} →</b>
        </button>)}
      </div>
    </section>

    <section className="panel" style={{marginTop:18}}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SECURITY BOUNDARY</span>
          <h2>Role Isolation</h2>
          <p className="muted">The selected IT capacity is a session operating context. Administrator, Finance, Board and other institutional capacities are not inherited merely because the same person may hold them elsewhere.</p>
        </div>
      </div>
    </section>
  </div>;
}
