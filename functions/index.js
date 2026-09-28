exports.resolveAuthenticatedLoginContext = onCall({region:"us-central1",timeoutSeconds:30}, async request => {
  const uid=String(request.auth?.uid||"").trim();
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required to resolve the IRPA login context.");

  const clean=snap=>snap?.exists?{id:snap.id,...snap.data()}:null;
  const activeRecord=record=>{
    if(!record)return false;
    const status=String(record.status||record.employmentStatus||record.registrationStatus||"Active").trim().toLowerCase();
    return !["inactive","disabled","suspended","expired","revoked"].includes(status);
  };
  const normalized=v=>String(v||"").toLowerCase().replace(/\s+/g," ").trim();
  // Gateway entry is configuration-driven. Authentication claims are the
  // configured entry authority; institutional registers are enrichment only.
  const configuredRoles=[...(Array.isArray(request.auth?.token?.irpaRoles)?request.auth.token.irpaRoles:[])]
    .flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
  if(request.auth?.token?.admin===true&&!configuredRoles.includes("Administrator"))configuredRoles.unshift("Administrator");
  const configuredAuthorityMap=new Map();
  const configuredPathwayFor=role=>{
    const n=normalized(role);
    if(n==="administrator"||n==="executive director")return "Executive Office Department";
    if(n.includes("internal oversight"))return "Internal Oversight Department";
    if(n.includes("finance"))return "Finance & Administration Department";
    if(n.includes("human resources")||n.startsWith("hr "))return "Human Resources Department";
    if(n.includes("livestock"))return "Livestock Department";
    if(n.includes("environment")||n.includes("rangeland"))return "Environment & Rangeland Department";
    if(n.includes("outreach")||n.includes("community development"))return "Outreach & Community Development Department";
    if(n.includes("field"))return "Field Operations Department";
    if(n.includes("procurement"))return "Finance & Administration Department · Procurement Unit";
    if(n.includes("it")||n.includes("information technology"))return "Information Technology Department";
    return "Institutional Governance Workspace";
  };
  configuredRoles.forEach(role=>{
    const cleanRole=String(role||"").trim();
    if(!cleanRole)return;
    const authorityId="IRPA-AUTH-"+String(cleanRole).toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48);
    configuredAuthorityMap.set(authorityId,{id:authorityId,authorityId,role:cleanRole,pathway:configuredPathwayFor(cleanRole),source:"Gateway Configuration",active:true});
  });

  // Resolve the direct UID records first. Email/linked-identity lookups are
  // fallback paths only; the previous implementation performed six Firestore
  // queries on every login even when the UID records already existed.
  const [adminSnap,memberDirect,employeeDirect]=await Promise.all([
    db.collection("adminProfiles").doc(uid).get(),
    db.collection("members").doc(uid).get(),
    db.collection("employees").doc(uid).get()
  ]);
  const admin=clean(adminSnap);
  const memberRecords=[];
  const employeeRecords=[];
  if(memberDirect.exists) memberRecords.push(clean(memberDirect));
  if(employeeDirect.exists) employeeRecords.push(clean(employeeDirect));

  const fallbackQueries=[];
  if(email&&!memberDirect.exists){
    fallbackQueries.push(
      ["member",db.collection("members").where("email","==",email).limit(10).get()],
      ["member",db.collection("members").where("firebaseAuthEmail","==",email).limit(10).get()]
    );
  }
  if(email&&!employeeDirect.exists){
    fallbackQueries.push(
      ["employee",db.collection("employees").where("email","==",email).limit(10).get()],
      ["employee",db.collection("employees").where("firebaseAuthEmail","==",email).limit(10).get()]
    );
  }
  if(fallbackQueries.length){
    const fallbackResults=await Promise.all(fallbackQueries.map(async ([kind,promise])=>[kind,await promise]));
    fallbackResults.forEach(([kind,snap])=>{
      snap.forEach(docSnap=>{
        const record=clean(docSnap);
        if(record)(kind==="employee"?employeeRecords:memberRecords).push(record);
      });
    });
  }

  if(admin?.active===true&&!employeeRecords.length){
    const linkedFields=["administratorUid","adminUid","linkedAdministratorUid"];
    const linkedSnaps=await Promise.all(
      linkedFields.map(field=>db.collection("employees").where(field,"==",uid).limit(10).get())
    );
    for(const snap of linkedSnaps){
      snap.forEach(s=>employeeRecords.push(clean(s)));
      if(snap.size)break;
    }

    if(!employeeRecords.length){
      const identityName=String(admin.name||admin.details?.name||request.auth?.token?.name||"").trim();
      if(identityName){
        // Exact-name lookup is a bounded fallback. Avoid scanning the entire
        // Employees Register during login.
        const snap=await db.collection("employees").where("name","==",identityName).limit(2).get();
        const matches=snap.docs.map(clean).filter(record=>activeRecord(record)&&normalized(record.name)===normalized(identityName));
        if(matches.length===1)employeeRecords.push(matches[0]);
      }
    }
  }

  const uniqueById=list=>[...new Map(list.filter(Boolean).map(x=>[String(x.id||x.uid||x.employeeNumber||x.email),x])).values()];
  const members=uniqueById(memberRecords).filter(activeRecord);
  const employees=uniqueById(employeeRecords).filter(activeRecord);
  const employee=employees[0]||null;
  const employeeRoles=[...new Set(employees.flatMap(record=>[
    ...(Array.isArray(record?.roles)?record.roles:[]),record?.role,
    ...(Array.isArray(record?.assignedRoles)?record.assignedRoles:[]),
    ...(Array.isArray(record?.selectedRoles)?record.selectedRoles:[]),
    ...(Array.isArray(record?.roleAssignments)?record.roleAssignments:[])
  ]).flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean)))];
  const contextValues=employees.flatMap(record=>[
    record?.department,record?.unit,record?.jobTitle,record?.position,record?.title,record?.designation
  ]).map(normalized).filter(Boolean);
  if(
    contextValues.some(v=>v==="it"||v==="it unit"||v.includes("information technology")||v.includes("it specialist")||v.includes("information technology officer")) &&
    !employeeRoles.some(r=>["IT Specialist","Information Technology Officer"].includes(r))
  ) employeeRoles.push("IT Specialist");

  const slug=v=>String(v||"").toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48);
  const pathwayFor=(role,record)=>{
    const n=normalized(role);
    const d=normalized(record?.department);
    if(n==="administrator")return "Executive Office Department";
    if(n==="executive director")return "Executive Office Department";
    if(n.includes("internal oversight"))return "Internal Oversight Department";
    if(n.includes("finance"))return "Finance & Administration Department";
    if(n.includes("human resources")||n.startsWith("hr "))return "Human Resources Department";
    if(n.includes("livestock"))return "Livestock Department";
    if(n.includes("environment")||n.includes("rangeland"))return "Environment & Rangeland Department";
    if(n.includes("outreach")||n.includes("community development"))return "Outreach & Community Development Department";
    if(n.includes("field"))return "Field Operations Department";
    if(n.includes("procurement"))return "Finance & Administration Department · Procurement Unit";
    if(n.includes("it")||n.includes("information technology"))return "Information Technology Department";
    if(d)return String(record?.department||"").trim()+" Department";
    return "Institutional Governance Workspace";
  };
  const authorityMap=new Map();
  const addAuthority=(role,record,source)=>{
    const cleanRole=String(role||"").trim();
    if(!cleanRole)return;
    const suppliedId=String(record?.accessAuthorityId||record?.authorityId||"").trim();
    const authorityId=suppliedId||"IRPA-AUTH-"+slug(cleanRole)+(record?.unit?"-"+slug(record.unit):"");
    const existing=authorityMap.get(authorityId);
    const authority={
      id:authorityId,
      authorityId,
      role:cleanRole,
      pathway:pathwayFor(cleanRole,record),
      department:record?.department||null,
      unit:record?.unit||null,
      source,
      active:true
    };
    authorityMap.set(authorityId,existing?{...existing,...authority}:authority);
  };
  if(admin?.active===true)addAuthority("Administrator",admin,"Administrator Registry");
  members.forEach(record=>{
    const values=[...(Array.isArray(record?.roles)?record.roles:[]),record?.role,record?.boardPosition].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
    const guaranteed=values.length?values:[String(record?.boardPosition||"Board Member").trim()];
    guaranteed.filter(Boolean).forEach(role=>addAuthority(role,record,"Member Register"));
  });
  employees.forEach(record=>{
    const values=[...(Array.isArray(record?.roles)?record.roles:[]),record?.role,...(Array.isArray(record?.assignedRoles)?record.assignedRoles:[]),...(Array.isArray(record?.selectedRoles)?record.selectedRoles:[]),...(Array.isArray(record?.roleAssignments)?record.roleAssignments:[])].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
    const institutionalFallback=String(record?.jobTitle||record?.position||record?.designation||record?.title||record?.department||"Employee").trim();
    const guaranteed=values.length?values:[institutionalFallback];
    guaranteed.filter(Boolean).forEach(role=>addAuthority(role,record,"Employee Register"));
  });
  employeeRoles.forEach(role=>addAuthority(role,employee,"Employee Register"));
  // Configured authorities are authoritative for Gateway entry. Register-derived
  // authorities are retained only as contextual enrichment when configuration
  // has not supplied the corresponding authority.
  const authorities=[...configuredAuthorityMap.values(),...authorityMap.values()]
    .filter((authority,index,list)=>list.findIndex(x=>String(x.authorityId)===String(authority.authorityId))===index);

  return {
    ok:true,
    uid,
    email,
    administrator:request.auth?.token?.admin===true
      ? {id:uid,email,name:String(request.auth?.token?.name||email).trim(),active:true,source:"Gateway Configuration"}
      : (admin?.active===true?{id:admin.id||uid,...admin}:null),
    member:members[0]||null,
    employee,
    roles:configuredRoles.length?configuredRoles:employeeRoles,
    authorities,
    identityResolution:employee
      ? (String(employee.uid||"")===uid
          ?"UID"
          :String(employee.email||"").trim().toLowerCase()===email
            ?"EMAIL"
            :employee.administratorUid===uid||employee.adminUid===uid||employee.linkedAdministratorUid===uid
              ?"ADMINISTRATOR_LINK"