export const MEETING_POLICIES={
  BOARD:{id:"BOARD",label:"Board / Governance",meetingTypes:["Board Meeting","Board Committee Meeting","Annual General Meeting","Special Meeting"],quorumRequired:true,votingEnabled:true,resolutionsEnabled:true,boardPapersRequired:true,chairApprovalRequired:true,minutesApprovalRequired:true,aiReviewRequired:true,confidentiality:"BOARD_RESTRICTED",aiMode:"GOVERNANCE"},
  MANAGEMENT:{id:"MANAGEMENT",label:"Management",meetingTypes:["Management Meeting"],quorumRequired:false,votingEnabled:"OPTIONAL",resolutionsEnabled:"OPTIONAL",boardPapersRequired:false,chairApprovalRequired:false,minutesApprovalRequired:true,aiReviewRequired:true,confidentiality:"MANAGEMENT",aiMode:"OPERATIONAL"},
  STAFF:{id:"STAFF",label:"Staff / Operations",meetingTypes:["Staff Meeting"],quorumRequired:false,votingEnabled:false,resolutionsEnabled:false,boardPapersRequired:false,chairApprovalRequired:false,minutesApprovalRequired:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL"},
  OTHER:{id:"OTHER",label:"Other / Project",meetingTypes:["Other"],quorumRequired:false,votingEnabled:"OPTIONAL",resolutionsEnabled:"OPTIONAL",boardPapersRequired:false,chairApprovalRequired:false,minutesApprovalRequired:false,aiReviewRequired:false,confidentiality:"INTERNAL",aiMode:"OPERATIONAL"}
};

export const MEETING_TYPE_OPTIONS=["Board Meeting","Board Committee Meeting","Annual General Meeting","Special Meeting","Management Meeting","Staff Meeting","Other"];

export function inferMeetingPolicy(meetingType="Board Meeting"){
  return Object.values(MEETING_POLICIES).find(p=>p.meetingTypes.includes(meetingType))||MEETING_POLICIES.OTHER;
}

export function normalizeMeetingForV3(meeting={}){
  // Legacy records without an explicit meeting type must not inherit Board privileges.\n  const policy=inferMeetingPolicy(meeting.meetingType||"Other");
  return {
    ...meeting,
    meetingCategory:meeting.meetingCategory||policy.id,
    meetingPolicyId:meeting.meetingPolicyId||policy.id,
    meetingRecordVersion:meeting.meetingRecordVersion||"V3.0",
    aiRecordMode:meeting.aiRecordMode||policy.aiMode,
    confidentialityClass:meeting.confidentialityClass||policy.confidentiality
  };
}

export function meetingCapabilities(meeting={}){
  const policy=MEETING_POLICIES[meeting.meetingPolicyId]||inferMeetingPolicy(meeting.meetingType);
  return {policy,quorum:policy.quorumRequired,voting:policy.votingEnabled,resolutions:policy.resolutionsEnabled,boardPapers:policy.boardPapersRequired,minutesApproval:policy.minutesApprovalRequired,aiReview:policy.aiReviewRequired};
}

export function governanceLineage(meeting={},recordType="MEETING"){
  return {origin:"MEETING",meetingId:meeting.id||null,meetingType:meeting.meetingType||null,meetingCategory:meeting.meetingCategory||null,meetingPolicyId:meeting.meetingPolicyId||null,recordType,authorityClass:meeting.meetingCategory==="BOARD"?"BOARD_GOVERNANCE":"OPERATIONAL",confidentialityClass:meeting.confidentialityClass||"INTERNAL"};
}
