const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).toLowerCase().replace(/[._-]+/g," ").replace(/\\s+/g," ");
const inactive = new Set(["inactive","disabled","suspended","expired","revoked","removed","cancelled","canceled"]);
const active = (record, now = Date.now()) => {
  if (!record || record.active === false || record.revoked === true || record.revokedAt) return false;
  const statuses = [record.status,record.employmentStatus,record.registrationStatus,record.authorityStatus].filter(Boolean).map(normalize);
  if (statuses.some(status => inactive.has(status))) return false;
  const expiry = record.expiresAt || record.expiryDate || record.validUntil || record.endDate;
  if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= now) return false;
  const start = record.effectiveFrom || record.validFrom || record.startDate;
  if (start && Number.isFinite(Date.parse(start)) && Date.parse(start) > now) return false;
  return statuses.length === 0 || statuses.some(status => ["active","activated","approved","current","valid"].includes(status));
};
const values = value => Array.isArray(value) ? value : value == null ? [] : [value];
const recordRoles = record => [
  ...values(record.roles),record.role,...values(record.assignedRoles),...values(record.selectedRoles),
  ...values(record.roleAssignments),...values(record.authorities),...values(record.accessAuthorities),
  ...values(record.accessCategories),...values(record.authorityCategories),record.accessCategory,
  record.authorizedRole,record.boardPosition
].flatMap(value => typeof value === "string" ? value.split(",") : value && typeof value === "object" ? [value.role,value.title,value.authority,value.category] : [])
 .map(clean).filter(Boolean);
const identifiers = record => ({
  uids:[record.uid,record.authUid,record.userUid,record.firebaseUid,record.firebaseAuthUid,record.linkedUid,record.administratorUid,record.adminUid,record.linkedAdministratorUid].map(clean).filter(Boolean),
  emails:[record.email,record.emailAddress,record.contactEmail,record.firebaseAuthEmail,record.officialEmail].map(value=>clean(value).toLowerCase()).filter(Boolean),
  memberNumbers:[record.memberNumber,record.registrationNumber,record.membershipNumber].map(clean).filter(Boolean),
  employeeNumbers:[record.employeeNumber,record.employeeId,record.staffNumber].map(clean).filter(Boolean)
});
const headRole = role => ["head of department","department head","head of the department"].includes(normalize(role));
const grantRole = role => {
  const roleName=normalize(role);
  return roleName==="internal oversight director" || roleName==="director internal oversight" ||
    roleName==="executive director" || headRole(roleName);
};
export function resolveMeetingAuthority(identity={}, registers={}, now=Date.now()) {
  const members=Array.isArray(registers.members)?registers.members:[];
  const employees=Array.isArray(registers.employees)?registers.employees:[];
  const departments=Array.isArray(registers.departments)?registers.departments:[];
  const categories=Array.isArray(registers.accessCategories)?registers.accessCategories:[];
  const keys={uids:new Set([clean(identity.uid)].filter(Boolean)),emails:new Set([clean(identity.email).toLowerCase()].filter(Boolean)),memberNumbers:new Set(values(identity.memberNumbers||identity.memberNumber).map(clean).filter(Boolean)),employeeNumbers:new Set(values(identity.employeeNumbers||identity.employeeNumber).map(clean).filter(Boolean))};
  const matched=new Set(),sources=[];
  const rows=[...members.map(record=>({record,source:"Members"})),...employees.map(record=>({record,source:"Employees"}))];
  let changed=true;
  while(changed){
    changed=false;
    for(const item of rows){
      const {record,source}=item;
      if(matched.has(record)||!active(record,now))continue;
      const ids=identifiers(record);
      const matches=Object.entries(ids).some(([key,values])=>values.some(value=>keys[key].has(value)));
      if(!matches)continue;
      matched.add(record);sources.push({record,source});
      for(const [key,values] of Object.entries(ids))for(const value of values)if(!keys[key].has(value)){keys[key].add(value);changed=true;}
    }
  }
  const roles=[];
  for(const {record,source} of sources)for(const role of recordRoles(record))roles.push({role,source,recordId:clean(record.id||record.uid||record.memberNumber||record.employeeNumber)||null,active:true,department:clean(record.department)||null});
  for(const department of departments){
    if(!active(department,now))continue;
    const headIds=identifiers({
      uid:department.headUid||department.headOfDepartmentUid||department.departmentHeadUid||department.managerUid,
      email:department.headEmail||department.headOfDepartmentEmail||department.departmentHeadEmail||department.managerEmail,
      memberNumber:department.headMemberNumber||department.headOfDepartmentMemberNumber,
      employeeNumber:department.headEmployeeNumber||department.headOfDepartmentEmployeeNumber
    });
    const isHead=Object.entries(headIds).some(([key,values])=>values.some(value=>keys[key].has(value)));
    if(isHead)roles.push({role:"Head of Department",source:"Department Head Register",recordId:clean(department.id)||null,active:true,department:clean(department.name||department.departmentName||department.department)||null});
  }
  for(const category of categories){
    if(!active(category,now))continue;
    const ids=identifiers(category);
    if(!Object.entries(ids).some(([key,values])=>values.some(value=>keys[key].has(value))))continue;
    for(const role of recordRoles(category))roles.push({role,source:"Authorized User Access Categories",recordId:clean(category.id)||null,active:true,department:clean(category.department)||null});
  }
  const activeRoles=[...new Map(roles.map(item=>[normalize(item.role)+"|"+item.source+"|"+item.recordId, item])).values()];
  const grant=activeRoles.some(item=>grantRole(item.role));
  return {active: sources.length>0 || grant,fullMeetingAccess:grant,roles:activeRoles,registers:[...new Set(sources.map(item=>item.source))],identityKeys:{uid:keys.uids.size,email:keys.emails.size,memberNumber:keys.memberNumbers.size,employeeNumber:keys.employeeNumbers.size}};
}
