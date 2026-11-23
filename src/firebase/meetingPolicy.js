const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).toLowerCase().replace(/[._-]+/g," ").replace(/\s+/g," ");
const inactive = new Set(["inactive","disabled","suspended","expired","revoked","removed","cancelled","canceled"]);
const active = (record, now = Date.now()) => {
  if (!record || record.active === false || record.revoked === true || record.revokedAt) return false;
  const statuses = [record.status,record.employmentStatus,record.registrationStatus,record.authorityStatus].filter(Boolean).map(normalize);
  if (statuses.some(status => inactive.has(status))) return false;
  const expiry = record.expiresAt || record.expiryDate || record.validUntil || record.endDate;
  if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= now) return false;
  const start = record.effectiveFrom || record.validFrom || record.startDate;
  if (start && Number.isFinite(Date.parse(start)) && Date.parse(start) > now) return false;
  return record.active === true || statuses.some(status => ["active","activated","approved","current","valid"].includes(status));
};
const values = value => Array.isArray(value) ? value : value == null ? [] : [value];
const recordRoles = (record, now=Date.now()) => {
  const candidates=[
    ...values(record.roles),record.role,...values(record.assignedRoles),...values(record.selectedRoles),
    ...values(record.roleAssignments),...values(record.authorities),...values(record.accessAuthorities),
    ...values(record.accessCategories),...values(record.authorityCategories),...values(record.categories),record.accessCategory,
    record.authorizedRole,record.boardPosition,record.jobTitle,record.position,record.title,record.designation,
    ...values(record.authorizedUserAccessCategories),...values(record.authorizedAccessCategories),
    ...(record.isHeadOfDepartment===true||record.isDepartmentHead===true||record.headOfDepartment===true?["Head of Department"]:[])
  ];
  return candidates.flatMap(value => {
    if(typeof value==="string")return value.split(",");
    if(value&&typeof value==="object"){const hasOwnStatus=["active","status","employmentStatus","registrationStatus","authorityStatus","revoked","revokedAt","expiresAt","expiryDate","validUntil","endDate","effectiveFrom","validFrom","startDate"].some(key=>value[key]!==undefined);if((hasOwnStatus?active(value,now):active(record,now)))return [value.role,value.title,value.authority,value.category];}
    return [];
  }).map(clean).filter(Boolean);
};
const identifiers = record => ({
  uids:[record.uid,record.authUid,record.userUid,record.firebaseUid,record.firebaseAuthUid,record.linkedUid,record.administratorUid,record.adminUid,record.linkedAdministratorUid,...(!/^IRPA-(?:MEM|EMP)-/i.test(clean(record.id))?[record.id]:[])].map(clean).filter(Boolean),
  emails:[record.email,record.emailAddress,record.contactEmail,record.firebaseAuthEmail,record.officialEmail].map(value=>clean(value).toLowerCase()).filter(Boolean),
  memberNumbers:[record.memberNumber,record.registrationNumber,record.membershipNumber,...(/^IRPA-MEM-/i.test(clean(record.id))?[record.id]:[])].map(clean).filter(Boolean),
  employeeNumbers:[record.employeeNumber,record.employeeId,record.staffNumber,...(/^IRPA-EMP-/i.test(clean(record.id))?[record.id]:[])].map(clean).filter(Boolean)
});
const headRole = role => {const value=normalize(role);return ["head of department","department head","head of the department"].includes(value)||/^head of .+ department$/.test(value)||/^department head of .+$/.test(value);};
const grantRole = role => {
  const roleName=normalize(role);
  return ["internal oversight director","director internal oversight","director of internal oversight","director of international oversight"].includes(roleName) ||
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
  for(const {record,source} of sources)for(const role of recordRoles(record,now))roles.push({role,source,recordId:clean(record.id||record.uid||record.memberNumber||record.employeeNumber)||null,active:true,department:clean(record.department)||null});
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
    for(const role of recordRoles(category,now))roles.push({role,source:"Authorized User Access Categories",recordId:clean(category.id)||null,active:true,department:clean(category.department)||null});
  }
  const activeRoles=[...new Map(roles.map(item=>[normalize(item.role)+"|"+item.source+"|"+item.recordId, item])).values()];
  const grant=activeRoles.some(item=>grantRole(item.role));
  return {active: sources.length>0 || grant,fullMeetingAccess:grant,roles:activeRoles,registers:[...new Set(sources.map(item=>item.source))],identityKeys:{uid:keys.uids.size,email:keys.emails.size,memberNumber:keys.memberNumbers.size,employeeNumber:keys.employeeNumbers.size}};
}

export const MEETING_CATEGORIES={
  GOVERNANCE:{id:"GOVERNANCE",label:"Governance Meetings",meetingTypes:["Governance","Board","Board Meeting","Board Committee Meeting","Annual General Meeting","Special Meeting"],quorumRequired:false,votingEnabled:true,resolutionsEnabled:true,documentsLabel:"Governance Documents",documentsAccess:true,authorizationAccess:true,signatureAccess:true,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:true,confidentiality:"BOARD_RESTRICTED",aiMode:"GOVERNANCE",accessScope:"BOARD_RESTRICTED",accessRoles:["Board Member","Board Chairperson","Board Secretary","Executive Director","Director Internal Oversight"],registrationRoles:["Board Secretary","Secretary to the Board","Meeting Secretary","Executive Director","Director Internal Oversight"],votingRoles:["Board Member","Board Chairperson"],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Board Chairperson","Board Secretary","Secretary to the Board"]},
  ADMINISTRATIVE:{id:"ADMINISTRATIVE",label:"Administrative Meetings",meetingTypes:["Administrative","Management","Management Meeting","Administration Meeting","Operations Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Administrative Documents",documentsAccess:true,authorizationAccess:true,signatureAccess:true,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:true,confidentiality:"MANAGEMENT",aiMode:"OPERATIONAL",accessScope:"MANAGEMENT_RESTRICTED",accessRoles:["Executive Director","Director Finance & Administration","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager","Director Outreach","Director Community Development","Director Livestock","Director Environment","Director Field Department"],registrationRoles:["Executive Director","Director Finance & Administration","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager","Director Outreach","Director Community Development","Director Livestock","Director Environment","Director Field Department"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Executive Director","Meeting Secretary"]},
  STAFF:{id:"STAFF",label:"Staff Meetings",meetingTypes:["Staff","Staff Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Staff Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL",accessScope:"INVITED_STAFF",accessRoles:["Executive Director","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager","Employee","Staff"],registrationRoles:["Executive Director","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Meeting Secretary","Departmental Director"]},
  GENERAL:{id:"GENERAL",label:"General Meetings",meetingTypes:["General","General Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"General Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL",accessScope:"INSTITUTIONAL_OR_INVITED",accessRoles:["Executive Director","Departmental Director","Departmental Manager","Board Member","Employee","Staff","Member"],registrationRoles:["Executive Director","Departmental Director","Departmental Manager","Operations Manager","Meeting Secretary"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Meeting Secretary","Meeting Chairperson"]},
  OTHER:{id:"OTHER",label:"Other Meetings",meetingTypes:["Other","Other Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Other Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL",accessScope:"INVITATION_OR_EXPLICIT_ROLE",accessRoles:["Executive Director","Departmental Director","Departmental Manager","Operations Manager"],registrationRoles:["Executive Director","Departmental Director","Departmental Manager","Operations Manager","Meeting Secretary"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Meeting Secretary","Meeting Chairperson"]}
};


const NORMALIZE_ROLE=value=>String(value||"").trim().toLowerCase().replace(/[._-]+/g," ").replace(/\s+/g," ");
export const MEETING_REGISTRATION_ROLES=[
  "Executive Director","Director Internal Oversight","Director Finance & Administration",
  "Director Human Resources","HR Director","Operations Manager","Departmental Director",
  "Departmental Manager","Director Outreach","Director Community Development",
  "Director Livestock","Director Environment","Director Field Department",
  "Board Secretary","Secretary to the Board","Meeting Secretary"
];
function identityRoles(identity={}){
  const values=[identity.role,identity.title,identity.position,identity.departmentalRole,
    ...(Array.isArray(identity.roles)?identity.roles:[]),
    ...(Array.isArray(identity.assignedRoles)?identity.assignedRoles:[]),
    ...(Array.isArray(identity.selectedRoles)?identity.selectedRoles:[])];
  return new Set(values.map(NORMALIZE_ROLE).filter(Boolean));
}
export function canRegisterMeeting(identity={}){
  if(identity.isAdmin===true||identity.admin===true||identity.fullMeetingAccess===true)return true;
  if(identity.active!==true)return false;
  const roles=identityRoles(identity);
  return MEETING_REGISTRATION_ROLES.some(role=>roles.has(NORMALIZE_ROLE(role)));
}
export function canAccessMeetingCategory(meeting={},identity={},options={}){
  if(identity.isAdmin===true||identity.admin===true||identity.fullMeetingAccess===true)return true;
  if(options.isInvited===true||options.isRegisteredParticipant===true||options.isInitiator===true)return true;
  if(identity.active!==true)return false;
  const policy=resolveCategory(meeting.meetingCategory||meeting.meetingPolicyId||meeting.category||meeting.meetingType);
  if(policy.id==="GENERAL"&&(identity.activeMember===true||identity.activeEmployee===true))return true;
  const roles=identityRoles(identity);
  return policy.accessRoles.some(role=>roles.has(NORMALIZE_ROLE(role)));
}
export function canEditMeeting(meeting={},identity={}){
  if(identity.isAdmin===true||identity.admin===true||identity.fullMeetingAccess===true)return true;
  const released=Boolean(meeting.registeredAt||meeting.registerStatus==="Registered"||meeting.status==="Released");
  if(released)return false;
  if(identity.active!==true)return false;
  const roles=identityRoles(identity);
  const policy=resolveCategory(meeting.meetingCategory||meeting.meetingPolicyId||meeting.category||meeting.meetingType);
  return policy.registrationRoles.some(role=>roles.has(NORMALIZE_ROLE(role)))&&
    String(meeting.initiatorUid||"")===String(identity.uid||"");
}
export function canVoteInMeeting(meeting={},identity={}){
  const policy=resolveCategory(meeting.meetingCategory||meeting.meetingPolicyId||meeting.category||meeting.meetingType);
  if(!policy.votingEnabled||identity.active!==true)return false;
  if(identity.fullMeetingAccess===true)return true;
  const roles=identityRoles(identity);
  return policy.votingRoles.some(role=>roles.has(NORMALIZE_ROLE(role)))&&identity.isBoardMember===true;
}

export const MEETING_CATEGORY_OPTIONS=Object.values(MEETING_CATEGORIES).map(p=>({value:p.id,label:p.label}));

export const MEETING_TYPE_OPTIONS=Object.values(MEETING_CATEGORIES).flatMap(p=>p.meetingTypes);
export const MEETING_POLICIES=MEETING_CATEGORIES;

export function isBoardMeeting(meeting={}) {
  const values=[meeting.meetingType,meeting.meetingTitle,meeting.title,meeting.category];
  return values.some(value=>["board","board meeting"].includes(String(value||"").trim().toLowerCase()));
}
function resolveCategory(value){
  const v=String(value||"").trim().toLowerCase();
  if(!v)return MEETING_CATEGORIES.OTHER;
  return Object.values(MEETING_CATEGORIES).find(p=>p.id.toLowerCase()===v||p.label.toLowerCase()===v||p.meetingTypes.some(a=>a.toLowerCase()===v))||MEETING_CATEGORIES.OTHER;
}

export function inferMeetingPolicy(meetingType="Other Meeting"){
  return resolveCategory(meetingType);
}

export function normalizeMeetingForV3(meeting={}){
  const policy=resolveCategory(meeting.meetingCategory||meeting.category||meeting.meetingType);
  return {
    ...meeting,
    meetingCategory:policy.id,
    meetingPolicyId:meeting.meetingPolicyId||policy.id,
    meetingCategoryLabel:policy.label,
    meetingRecordVersion:meeting.meetingRecordVersion||"V3.0",
    aiRecordMode:meeting.aiRecordMode||policy.aiMode,
    confidentialityClass:meeting.confidentialityClass||policy.confidentiality
  };
}

export function meetingCapabilities(meeting={}){
  const policy=resolveCategory(meeting.meetingCategory||meeting.meetingPolicyId||meeting.category||meeting.meetingType);
  const boardMeeting=isBoardMeeting(meeting);
  return {
    policy,
    quorum:boardMeeting,
    quorumRequired:boardMeeting,
    voting:policy.votingEnabled,
    resolutions:policy.resolutionsEnabled,
    boardPapers:policy.id==="GOVERNANCE",
    minutesApproval:policy.id==="GOVERNANCE"||policy.id==="ADMINISTRATIVE",
    aiReview:policy.aiReviewRequired,
    accessScope:policy.accessScope,
    accessRoles:policy.accessRoles,
    registrationRoles:policy.registrationRoles,
    votingRoles:policy.votingRoles,
    editAfterRelease:policy.editAfterRelease,
    minutesApprovalRoles:policy.minutesApprovalRoles,
    facilities:{
      autoRegistration:policy.autoRegistration,
      quorum:boardMeeting,
      attendance:policy.attendanceAccess,
      signature:policy.signatureAccess,
      documents:policy.documentsAccess,
      authorization:policy.authorizationAccess,
      resolutions:policy.resolutionsEnabled,
      decisions:policy.decisionsAccess,
      actions:policy.actionsAccess,
      transcript:policy.transcriptAccess,
      media:policy.mediaAccess
    }
  };
}

export function governanceLineage(meeting={},recordType="MEETING"){
  return {origin:"MEETING",meetingId:meeting.id||null,meetingType:meeting.meetingType||null,meetingCategory:meeting.meetingCategory||null,meetingPolicyId:meeting.meetingPolicyId||null,recordType,authorityClass:meeting.meetingCategory==="GOVERNANCE"?"BOARD_GOVERNANCE":"OPERATIONAL",confidentialityClass:meeting.confidentialityClass||"INTERNAL"};
}

export function resolveMeetingAuthorityForIdentity(identity={},registers={}){return resolveMeetingAuthority(identity,registers);}
