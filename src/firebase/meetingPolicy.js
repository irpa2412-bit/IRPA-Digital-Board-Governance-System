export const MEETING_CATEGORIES={
  GOVERNANCE:{id:"GOVERNANCE",label:"Governance Meetings",meetingTypes:["Governance","Board","Board Meeting","Board Committee Meeting","Annual General Meeting","Special Meeting"],quorumRequired:true,votingEnabled:true,resolutionsEnabled:true,documentsLabel:"Governance Documents",documentsAccess:true,authorizationAccess:true,signatureAccess:true,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:true,aiReviewRequired:true,confidentiality:"BOARD_RESTRICTED",aiMode:"GOVERNANCE",accessScope:"BOARD_RESTRICTED",accessRoles:["Board Member","Board Chairperson","Board Secretary","Executive Director","Director Internal Oversight"],registrationRoles:["Board Secretary","Secretary to the Board","Meeting Secretary","Executive Director","Director Internal Oversight"],votingRoles:["Board Member","Board Chairperson"],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Board Chairperson","Board Secretary","Secretary to the Board"]},
  ADMINISTRATIVE:{id:"ADMINISTRATIVE",label:"Administrative Meetings",meetingTypes:["Administrative","Management","Management Meeting","Administration Meeting","Operations Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Administrative Documents",documentsAccess:true,authorizationAccess:true,signatureAccess:true,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:true,confidentiality:"MANAGEMENT",aiMode:"OPERATIONAL",accessScope:"MANAGEMENT_RESTRICTED",accessRoles:["Executive Director","Director Finance & Administration","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager","Director Outreach","Director Community Development","Director Livestock","Director Environment","Director Field Department"],registrationRoles:["Executive Director","Director Finance & Administration","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager","Director Outreach","Director Community Development","Director Livestock","Director Environment","Director Field Department"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Executive Director","Meeting Secretary"]},
  STAFF:{id:"STAFF",label:"Staff Meetings",meetingTypes:["Staff","Staff Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Staff Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL",accessScope:"INVITED_STAFF",accessRoles:["Executive Director","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager","Employee","Staff"],registrationRoles:["Executive Director","Director Human Resources","HR Director","Operations Manager","Departmental Director","Departmental Manager"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Meeting Secretary","Departmental Director"]},
  GENERAL:{id:"GENERAL",label:"General Meetings",meetingTypes:["General","General Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"General Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL",accessScope:"INSTITUTIONAL_OR_INVITED",accessRoles:["Executive Director","Departmental Director","Departmental Manager","Board Member","Employee","Staff","Member"],registrationRoles:["Executive Director","Departmental Director","Departmental Manager","Operations Manager","Meeting Secretary"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Meeting Secretary","Meeting Chairperson"]},
  OTHER:{id:"OTHER",label:"Other Meetings",meetingTypes:["Other","Other Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Other Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL",accessScope:"INVITATION_OR_EXPLICIT_ROLE",accessRoles:["Executive Director","Departmental Director","Departmental Manager","Operations Manager"],registrationRoles:["Executive Director","Departmental Director","Departmental Manager","Operations Manager","Meeting Secretary"],votingRoles:[],editAfterRelease:"ADMINISTRATOR_ONLY",minutesApprovalRoles:["Meeting Secretary","Meeting Chairperson"]}
};


const NORMALIZE_ROLE=value=>String(value||"").trim().toLowerCase().replace(/[._-]+/g," ").replace(/\\s+/g," ");
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
  if(identity.isAdmin===true||identity.admin===true)return true;
  if(identity.active!==true)return false;
  const roles=identityRoles(identity);
  return MEETING_REGISTRATION_ROLES.some(role=>roles.has(NORMALIZE_ROLE(role)));
}
export function canAccessMeetingCategory(meeting={},identity={},options={}){
  if(identity.isAdmin===true||identity.admin===true)return true;
  if(options.isInvited===true||options.isRegisteredParticipant===true)return true;
  if(identity.active!==true)return false;
  const policy=MEETING_CATEGORIES[meeting.meetingPolicyId]||resolveCategory(meeting.meetingCategory||meeting.category||meeting.meetingType);
  if(policy.id==="GENERAL"&&(identity.activeMember===true||identity.activeEmployee===true))return true;
  const roles=identityRoles(identity);
  return policy.accessRoles.some(role=>roles.has(NORMALIZE_ROLE(role)));
}
export function canEditMeeting(meeting={},identity={}){
  if(identity.isAdmin===true||identity.admin===true)return true;
  const released=Boolean(meeting.registeredAt||meeting.registerStatus==="Registered"||meeting.status==="Released");
  if(released)return false;
  if(identity.active!==true)return false;
  const roles=identityRoles(identity);
  const policy=MEETING_CATEGORIES[meeting.meetingPolicyId]||resolveCategory(meeting.meetingCategory||meeting.category||meeting.meetingType);
  return policy.registrationRoles.some(role=>roles.has(NORMALIZE_ROLE(role)))&&
    String(meeting.initiatorUid||"")===String(identity.uid||"");
}
export function canVoteInMeeting(meeting={},identity={}){
  const policy=MEETING_CATEGORIES[meeting.meetingPolicyId]||resolveCategory(meeting.meetingCategory||meeting.category||meeting.meetingType);
  if(!policy.votingEnabled||identity.active!==true)return false;
  const roles=identityRoles(identity);
  return policy.votingRoles.some(role=>roles.has(NORMALIZE_ROLE(role)))&&identity.isBoardMember===true;
}

export const MEETING_CATEGORY_OPTIONS=Object.values(MEETING_CATEGORIES).map(p=>({value:p.id,label:p.label}));

export const MEETING_TYPE_OPTIONS=Object.values(MEETING_CATEGORIES).flatMap(p=>p.meetingTypes);
export const MEETING_POLICIES=MEETING_CATEGORIES;

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
  const policy=MEETING_CATEGORIES[meeting.meetingPolicyId]||resolveCategory(meeting.meetingCategory||meeting.category||meeting.meetingType);
  return {
    policy,
    quorum:policy.quorumRequired,
    quorumRequired:policy.quorumRequired,
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
      quorum:policy.quorumAccess,
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
