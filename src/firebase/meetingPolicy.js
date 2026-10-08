export const MEETING_CATEGORIES={
  GOVERNANCE:{id:"GOVERNANCE",label:"Governance Meetings",meetingTypes:["Governance","Board","Board Meeting","Board Committee Meeting","Annual General Meeting","Special Meeting"],quorumRequired:true,votingEnabled:true,resolutionsEnabled:true,documentsLabel:"Governance Documents",documentsAccess:true,authorizationAccess:true,signatureAccess:true,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:true,aiReviewRequired:true,confidentiality:"BOARD_RESTRICTED",aiMode:"GOVERNANCE"},
  ADMINISTRATIVE:{id:"ADMINISTRATIVE",label:"Administrative Meetings",meetingTypes:["Administrative","Management","Management Meeting","Administration Meeting","Operations Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Administrative Documents",documentsAccess:true,authorizationAccess:true,signatureAccess:true,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:true,confidentiality:"MANAGEMENT",aiMode:"OPERATIONAL"},
  STAFF:{id:"STAFF",label:"Staff Meetings",meetingTypes:["Staff","Staff Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Staff Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL"},
  GENERAL:{id:"GENERAL",label:"General Meetings",meetingTypes:["General","General Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"General Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL"},
  OTHER:{id:"OTHER",label:"Other Meetings",meetingTypes:["Other","Other Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,documentsLabel:"Other Meeting Documents",documentsAccess:true,authorizationAccess:false,signatureAccess:false,decisionsAccess:true,actionsAccess:true,transcriptAccess:true,mediaAccess:true,attendanceAccess:true,autoRegistration:true,quorumAccess:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL"}
};

export const MEETING_CATEGORY_OPTIONS=Object.values(MEETING_CATEGORIES).map(p=>({value:p.id,label:p.label}));

export const MEETING_TYPE_OPTIONS=Object.values(MEETING_CATEGORIES).flatMap(p=>p.meetingTypes);\nexport const MEETING_POLICIES=MEETING_CATEGORIES;

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
