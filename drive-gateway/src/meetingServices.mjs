import { isTrialMeeting, meetingEnvironment } from "./meetingEnvironment.mjs";
import { MEETING_CHILD_COLLECTIONS, buildMeetingDeletionPreview, validateMeetingDeletion, validateMeetingRecordPurge } from "./meetingDeletion.mjs";
const clean = v => String(v ?? "").trim();
const lower = v => clean(v).toLowerCase();
const denied = new Set(["cancelled","canceled","revoked","removed","inactive","closed"]);
const terminal = new Set(["completed","closed","cancelled","canceled","archived"]);
const retention = { GOVERNANCE:7, ADMINISTRATIVE:5, STAFF:3, GENERAL:3, OTHER:3 };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))))].map(x=>x.toString(16).padStart(2,"0")).join("");
const yearsFrom = (date, years) => { const d = new Date(date); d.setUTCFullYear(d.getUTCFullYear()+years); return d; };
const categoryOf = m => { const raw=clean(m.meetingCategory||m.meetingPolicyId||m.category||m.meetingType).toUpperCase(); if(["GOVERNANCE","BOARD","BOARD MEETING","BOARD COMMITTEE MEETING","ANNUAL GENERAL MEETING","SPECIAL MEETING"].includes(raw))return "GOVERNANCE"; if(["ADMINISTRATIVE","MANAGEMENT","MANAGEMENT MEETING","ADMINISTRATION MEETING","OPERATIONS MEETING"].includes(raw))return "ADMINISTRATIVE"; if(["STAFF","STAFF MEETING"].includes(raw))return "STAFF"; if(["GENERAL","GENERAL MEETING"].includes(raw))return "GENERAL"; return "OTHER"; };
const isBoardMeeting = meeting => {
 return [meeting.meetingType,meeting.meetingTitle,meeting.title,meeting.category].some(value=>["board","board meeting"].includes(lower(value)));
};
const boardMemberRole = participant => {
 const role=lower(participant.participantRole||participant.role||participant.boardPosition);
 const authoritativeBoardRecord=lower(participant.sourceType)==="board member register"&&Boolean(clean(participant.boardMemberId||participant.sourceRecordId));
 return (["board member","board chairperson","board treasurer","board vice chairperson","chairperson","vice chairperson","treasurer"].includes(role)||authoritativeBoardRecord)
   && lower(participant.sourceType)!=="manual invitee"
   && !/external|guest|observer|non.?voting|committee|secretary/.test(role+" "+lower(participant.participantType||""));
};
const participantCategory = participant => {
 const role=lower(participant.participantRole||participant.role||"");
 const type=lower(participant.participantType||"");
 if(boardMemberRole(participant))return "BOARD_MEMBER";
 if(role==="board committee member"||type.includes("board committee"))return "BOARD_COMMITTEE_MEMBER";
 if(/management|executive director|director|manager/.test(role)||type.includes("management"))return "MANAGEMENT";
 if(/staff|employee|personnel|board secretary|secretary to the board|meeting secretary/.test(role)||type.includes("staff")||type.includes("personnel"))return "STAFF";
 if(type.includes("member")||lower(participant.sourceType)==="member register")return "IRPA_MEMBER";
 if(/external|guest|partner|donor|consultant|technical expert|government representative|observer/.test(role)||type.includes("external"))return "EXTERNAL_INVITEE";
 return "OTHER";
};
async function buildQuorumAssessment(ctx,env,token,meeting,attendanceDate=null,claims=null){
 const meetingId=clean(meeting.id);
 const [participants,passes,queue,signatures,memberRecords,dailyRows,dispatchRows]=await Promise.all([
  listByField(ctx,env,token,"participants","meetingId",meetingId),
  listByField(ctx,env,token,"meetingAccessTokens","meetingId",meetingId),
  listByField(ctx,env,token,"meetingEntryRequests","meetingId",meetingId),
  listByField(ctx,env,token,"meetingAttendanceSignatures","meetingId",meetingId),
  listCollection(ctx,env,token,"members"),
  listByField(ctx,env,token,"meetingDailyAttendance","meetingId",meetingId),
  listByField(ctx,env,token,"meetingAttendanceDispatches","meetingId",meetingId)
 ]);
 const active=participants.filter(p=>!denied.has(lower(p.status||p.registrationStatus)));
 const activeBoardRecords=memberRecords.filter(m=>{
  const statuses=[m.status,m.employmentStatus,m.registrationStatus].map(lower).filter(Boolean);
  const activeStatus=statuses.some(v=>["active","activated"].includes(v));
  const isBoard=m.boardMember===true||lower(m.role)==="board member"||Boolean(clean(m.boardPosition))||clean(m.department)==="Board of Directors";
  return activeStatus&&isBoard;
 });
 const missingRegisterUid=activeBoardRecords.filter(m=>!clean(m.uid||m.authUid||m.userUid)).length;
 const registerByUid=new Map(),duplicateRegisterUids=new Set();
 for(const member of activeBoardRecords){
  const uid=clean(member.uid||member.authUid||member.userUid);
  if(!uid)continue;
  if(registerByUid.has(uid)){duplicateRegisterUids.add(uid);continue;}
  registerByUid.set(uid,{uid,id:clean(member.id),name:clean(member.name||member.fullName||member.memberName||member.displayName)||"Board Member",email:lower(member.email||member.emailAddress||member.contactEmail),memberNumber:clean(member.memberNumber||member.registrationNumber),boardPosition:clean(member.boardPosition)});
 }
 const boardMembers=[...registerByUid.values()];
 const signatureByParticipant=new Map(signatures.map(s=>[clean(s.participantId),s]));
 const dailyByParticipant=new Map(dailyRows.filter(r=>!attendanceDate||clean(r.attendanceDate)===attendanceDate).map(r=>[clean(r.participantId),r]));
 const dailyDispatch=dispatchRows.find(r=>!attendanceDate||clean(r.attendanceDate)===attendanceDate);
 let dailyGatewayStatus=null;
 if(dailyDispatch?.status==="DISPATCHED"&&dailyDispatch?.gatewayEnvelopeId&&dailyDispatch?.ownerUid&&typeof ctx.getGatewayEnvelopeStatus==="function")dailyGatewayStatus=await ctx.getGatewayEnvelopeStatus(clean(dailyDispatch.ownerUid),env,clean(dailyDispatch.gatewayEnvelopeId)).catch(()=>null);
 const verifiedGatewaySigners=dailyDispatch?.gatewayAuditChainValid===true&&dailyGatewayStatus?.auditChainValid===true&&clean(dailyGatewayStatus?.envelopeId)===clean(dailyDispatch?.gatewayEnvelopeId)?dailyGatewayStatus.signers:[];
 const gatewaySignersById=new Map((Array.isArray(verifiedGatewaySigners)?verifiedGatewaySigners:[]).map(s=>[clean(s.id),s]));
 const dailySignerByUid=new Map((Array.isArray(dailyDispatch?.gatewaySignerMap)?dailyDispatch.gatewaySignerMap:[]).map(binding=>[clean(binding.participantUid),gatewaySignersById.get(clean(binding.signerId))]).filter(([uid,signer])=>uid&&signer?.status==="Signed"));
 const queueByParticipant=new Map();
 for(const q of queue){const key=clean(q.participantId),previous=queueByParticipant.get(key);if(key&&(!previous||new Date(q.requestedAt||0)>=new Date(previous.requestedAt||0)))queueByParticipant.set(key,q);}
 const passByParticipant=new Map();
 for(const p of passes){const key=clean(p.participantId);if(key){const previous=passByParticipant.get(key);if(!previous||new Date(p.createdAt||0)>new Date(previous.createdAt||0))passByParticipant.set(key,p);}}
 const uidOf=p=>clean(p.participantUid||p.uid||p.userId);
 const rows=active.map(p=>{
  const id=clean(p.id),signature=signatureByParticipant.get(id),entry=queueByParticipant.get(id),pass=passByParticipant.get(id);
  const uid=uidOf(p),daily=dailyByParticipant.get(id),dailySigner=dailySignerByUid.get(uid),registerMatch=Boolean(uid&&registerByUid.has(uid)&&lower(p.sourceType)!=="manual invitee");
  const explicitCommittee=lower(p.participantRole||p.role)==="board committee member"||lower(p.participantType).includes("board committee");
  const category=explicitCommittee?"BOARD_COMMITTEE_MEMBER":registerMatch?"BOARD_MEMBER":boardMemberRole(p)?"UNMATCHED_BOARD_REGISTRATION":participantCategory(p);
  const attendanceStatus=attendanceDate?(clean(daily?.attendanceStatus)||"N/A"):clean(p.attendanceStatus)||"Unmarked";
  const signed=Boolean(dailySigner||(!attendanceDate&&signature&&clean(signature.signatureMethod)&&signature.signedAt));
  const invitationDispatched=p.meetingAccessDispatched===true||["sent","accepted","confirmed","dispatched"].includes(lower(p.meetingAccessDispatchStatus));
  const accessPassStatus=clean(pass?.status)||"Not issued";
  const queueStatus=clean(entry?.status)||"Not queued";
  const present=lower(attendanceStatus)==="present"&&signed;
  return {participantId:id,participantUid:uid||null,name:clean(p.participantName||p.name),email:lower(p.participantEmail||p.email||p.invitedEmail),role:clean(p.participantRole||p.role),title:clean(p.title||p.position||p.jobTitle||p.boardPosition),occupation:clean(p.occupation||p.capacity||p.profession||p.jobTitle||p.position),capacity:clean(p.capacity),department:clean(p.department||p.departmentName||p.unit||p.unitName),institution:clean(p.institution||p.organization||p.organisation),participantType:clean(p.participantType),sourceType:clean(p.sourceType),registrationCategory:category,meetingParticipantRegistered:true,invitationDispatched,accessPassStatus,accessPassExpiresAt:iso(pass?.expiresAt),invitationStatus:clean(p.meetingAccessDispatchStatus||p.invitationStatus)||"Not sent",queueStatus,attendanceStatus,signed,signedAt:iso(dailySigner?.completedAt||dailySigner?.signedAt||signature?.signedAt),countsTowardQuorum:category==="BOARD_MEMBER"&&present};
 });
 const boardRows=[];
 for(const member of boardMembers){
  const matches=rows.filter(row=>row.registrationCategory==="BOARD_MEMBER"&&row.participantUid===member.uid);
  if(matches.length===1){
   const row=matches[0];
   row.boardRegisterUid=member.uid;
   row.boardRegisterRecordId=member.id;
   row.boardMemberName=member.name;
   row.countsTowardQuorum=lower(row.attendanceStatus)==="present"&&row.signed;
   boardRows.push(row);
  }else{
   for(const row of matches){row.duplicateBoardMemberRegistration=true;row.countsTowardQuorum=false;}
   const row={participantId:null,participantUid:member.uid,boardRegisterUid:member.uid,boardRegisterRecordId:member.id,name:member.name,email:lower(member.email||member.emailAddress),role:member.boardPosition||"Board Member",title:clean(member.title||member.boardPosition),occupation:clean(member.occupation||member.capacity||member.boardPosition),department:clean(member.department||member.unit),institution:clean(member.institution||member.organization),registrationCategory:"BOARD_MEMBER",meetingParticipantRegistered:false,invitationDispatched:false,invitationStatus:"Not registered for this meeting",accessPassStatus:"Not issued",queueStatus:"Not queued",attendanceStatus:attendanceDate?"N/A":"Unmarked",signed:false,signedAt:null,countsTowardQuorum:false,...(matches.length>1?{duplicateBoardMemberRegistration:true,duplicateParticipantCount:matches.length}:{})};
   boardRows.push(row);
  }
 }
 const registeredBoardRows=rows.filter(r=>r.registrationCategory==="BOARD_MEMBER");
 const unmatchedBoardRows=rows.filter(r=>r.registrationCategory==="UNMATCHED_BOARD_REGISTRATION");
 const boardPresent=boardRows.filter(r=>r.meetingParticipantRegistered&&r.countsTowardQuorum&&!r.duplicateBoardMemberRegistration).length;
 const boardMeeting=isBoardMeeting(meeting);
 const denominator=boardMembers.length;
 const required=boardMeeting?(denominator?Math.ceil(denominator/3):null):0;
 const quorumMet=boardMeeting?Boolean(required&&boardPresent>=required):false;
 const displayRows=[...rows,...boardRows.filter(r=>!r.meetingParticipantRegistered)];
 const counts={
  registered:rows.length,boardRegisterMembers:denominator,boardMembers:denominator,registeredBoardMembers:boardRows.filter(r=>r.meetingParticipantRegistered).length,
  boardMembersNotRegistered:boardRows.filter(r=>!r.meetingParticipantRegistered).length,boardRegisterRecordsMissingUid:missingRegisterUid,
  duplicateBoardRegisterUids:duplicateRegisterUids.size,unmatchedBoardRegistrations:unmatchedBoardRows.length,
  duplicateBoardMemberRegistrations:rows.filter(r=>r.duplicateBoardMemberRegistration).length+boardRows.filter(r=>r.duplicateParticipantCount).length,
  boardCommitteeMembers:rows.filter(r=>r.registrationCategory==="BOARD_COMMITTEE_MEMBER").length,
  management:rows.filter(r=>r.registrationCategory==="MANAGEMENT").length,staff:rows.filter(r=>r.registrationCategory==="STAFF").length,
  irpaMembers:rows.filter(r=>r.registrationCategory==="IRPA_MEMBER").length,externalInvitees:rows.filter(r=>r.registrationCategory==="EXTERNAL_INVITEE").length,
  other:rows.filter(r=>r.registrationCategory==="OTHER").length,
  invitationsDispatched:displayRows.filter(r=>r.invitationDispatched).length,activeAccessPasses:displayRows.filter(r=>lower(r.accessPassStatus)==="active").length,
  queued:displayRows.filter(r=>lower(r.queueStatus)==="pending").length,admitted:displayRows.filter(r=>lower(r.queueStatus)==="admitted").length,
  signedAttendance:displayRows.filter(r=>r.signed).length,present:displayRows.filter(r=>lower(r.attendanceStatus)==="present").length,
  boardMembersPresent:boardPresent
 };
 const registerUsable=denominator>0;
 return {meetingId,attendanceDate:attendanceDate||null,meetingCategory:clean(meeting.meetingCategory||meeting.category||meeting.meetingType),meetingType:clean(meeting.meetingType||meeting.title),boardMeeting,rule:boardMeeting?"One-third of the active UID-verified Board Members Register (rounded up)":"No Board quorum requirement",required,present:boardPresent,quorumMet,status:!boardMeeting?"NOT_REQUIRED":!registerUsable?"NOT_ASSESSABLE":quorumMet?"MET":"NOT_MET",counts,rows:displayRows,assessedAt:new Date().toISOString(),sources:{boardRegister:"active members collection; UID-only; deduplicated by UID",participantRegistration:"participants",invitations:"meetingAccessTokens + participant dispatch status",entryQueue:"meetingEntryRequests",attendance:attendanceDate?"meetingDailyAttendance + Signature Portal envelope evidence":"meetingAttendanceSignatures"},reconciliation:{boardRegisterMembers:denominator,meetingParticipantRegistrations:registeredBoardRows.length,boardMembersNotRegistered:counts.boardMembersNotRegistered,unmatchedBoardRegistrations:unmatchedBoardRows.length,missingRegisterUid,duplicateRegisterUids:[...duplicateRegisterUids]}};
};
const recordLabel = type => ({TRANSCRIPT:"Meeting Transcript",MINUTES_DRAFT:"Draft Minutes",MINUTES_FINAL:"Approved / Final Minutes",AI_MINUTES_DRAFT:"AI-Assisted Draft Minutes",AI_SUMMARY_DRAFT:"AI-Assisted Meeting Summary Draft",SUBSCRIBER_TRANSCRIPT_DRAFT:"Subscriber Proceedings Draft",DECISION_REGISTER:"Decision Register",ATTENDANCE_REGISTER:"Attendance Register",MEETING_REPORT:"Compiled Meeting Report",OTHER:"Other Meeting Record"})[type]||"Meeting Record";
function toFs(v) { if(v===null||v===undefined)return {nullValue:null}; if(v instanceof Date)return {timestampValue:v.toISOString()}; if(typeof v==="boolean")return {booleanValue:v}; if(typeof v==="number")return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}; if(Array.isArray(v))return {arrayValue:{values:v.map(toFs)}}; if(typeof v==="object")return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,toFs(x)]))}}; return {stringValue:String(v)}; }
const fields = o => Object.fromEntries(Object.entries(o).map(([k,v])=>[k,toFs(v)]));
function fromFs(v) { if(!v)return null; if("stringValue"in v)return v.stringValue; if("booleanValue"in v)return v.booleanValue; if("integerValue"in v)return Number(v.integerValue); if("doubleValue"in v)return v.doubleValue; if("timestampValue"in v)return v.timestampValue; if("nullValue"in v)return null; if("arrayValue"in v)return (v.arrayValue.values||[]).map(fromFs); if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,fromFs(x)])); return null; }
function plain(doc) { return doc?.fields?{id:String(doc.name||"").split("/").pop(),updateTime:doc.updateTime||null,...Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,fromFs(v)]))}:null; }
function iso(v) { if(!v)return null; const d=new Date(v); return Number.isNaN(d.getTime())?null:d.toISOString(); }
function response(ctx,request,payload,status=200){return ctx.json(payload,status,ctx.corsHeaders(request));}
function fail(ctx,request,error,status=400){return response(ctx,request,{ok:false,error},status);}
async function requestFs(ctx,env,token,path,init={}) { const suffix=path.startsWith(":")?`/documents${path}`:`/documents/${path}`; const url=`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)${suffix}`; const r=await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(init.headers||{})}}); const data=await r.json().catch(()=>({})); if(!r.ok){const e=new Error(`Firestore request failed (${r.status}).`);e.status=r.status;throw e;} return data; }
async function getDoc(ctx,env,token,col,id){try{return plain(await requestFs(ctx,env,token,`${col}/${encodeURIComponent(id)}`));}catch(e){if(e.status===404)return null;throw e;}}
async function listCollection(ctx,env,token,col){const r=await requestFs(ctx,env,token,":runQuery",{method:"POST",body:JSON.stringify({structuredQuery:{from:[{collectionId:col}]}})});return (Array.isArray(r)?r:[]).filter(x=>x.document).map(x=>plain(x.document));}
async function listByField(ctx,env,token,col,field,value){const r=await requestFs(ctx,env,token,":runQuery",{method:"POST",body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op:"EQUAL",value:toFs(value)}}}})});return (Array.isArray(r)?r:[]).filter(x=>x.document).map(x=>plain(x.document));}
async function writeDoc(ctx,env,token,col,id,data,merge=true){const query=id?`?documentId=${encodeURIComponent(id)}`:"";const url=`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents/${col}${query}`;const r=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({fields:fields(data)})});const b=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(`Firestore create failed (${r.status}).`);e.status=r.status;throw e;}return plain(b);}
async function commitWrites(ctx,env,token,writes){const url=`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents:commit`;const r=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({writes})});const b=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(`Firestore atomic commit failed (${r.status}).`);e.status=r.status;throw e;}return b;}
async function patchDoc(ctx,env,token,col,id,data){const mask=Object.keys(data).map(k=>"updateMask.fieldPaths="+encodeURIComponent(k)).join("&");const url=`https://firestore.googleapis.com/v1/projects/${ctx.getFirebaseProjectId(env)}/databases/(default)/documents/${col}/${encodeURIComponent(id)}?${mask}`;const r=await fetch(url,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({fields:fields(data)})});const b=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(`Firestore update failed (${r.status}).`);e.status=r.status;throw e;}return plain(b);}
async function audit(ctx,env,token,claims,action,meeting,recordId,details={}){const collection=action.startsWith("MEETING_REGISTER_")||action.startsWith("MEETING_QUORUM_")?"meetings":action.startsWith("MEETING_PARTICIPANT_")?"participants":action.startsWith("MEETING_INVITATION_")?"meetingInvitations":action.startsWith("MEETING_DECISION_")?"decisions":action.startsWith("MEETING_ACTION_")?"actions":action.includes("VOTING")?"votingIssues":action.includes("RECORDING")?"meetingMediaRecordings":action==="LIVE_MEETING_TOKEN_ISSUED"?"liveMeetingSessions":"meetingRecords";await writeDoc(ctx,env,token,"audit",null,{action,collection,recordId:recordId||null,details:{meetingId:meeting.id,meetingCategory:categoryOf(meeting),confidentialityClass:clean(meeting.confidentialityClass)||(categoryOf(meeting)==="GOVERNANCE"?"BOARD_RESTRICTED":"INTERNAL"),...details},actorUid:claims.user_id,actorEmail:claims.email||null,createdAt:new Date()},false);}
async function context(ctx,env,token,claims,meetingId){const uid=clean(claims.user_id),email=lower(claims.email);if(!uid)throw Object.assign(new Error("Sign in to access meeting records."),{status:401});if(!meetingId)throw Object.assign(new Error("Meeting ID is required."),{status:400});const meeting=await getDoc(ctx,env,token,"meetings",meetingId);if(!meeting)throw Object.assign(new Error("Meeting record not found."),{status:404});const [adminProfile,member,employee,subscriptions,participants]=await Promise.all([getDoc(ctx,env,token,"adminProfiles",uid),getDoc(ctx,env,token,"members",uid),getDoc(ctx,env,token,"employees",uid),listByField(ctx,env,token,"meetingSubscriptions","meetingId",meetingId),listByField(ctx,env,token,"participants","meetingId",meetingId)]);const isAdmin=claims.admin===true||email==="irpa2412@gmail.com"||adminProfile?.active===true;const active= r=>r&&["active","activated"].includes(lower(r.status||r.registrationStatus||r.employmentStatus));const listed=[...(meeting.participantUids||[]),...(meeting.attendeeUids||[]),...(meeting.memberUids||[]),...(meeting.invitedUids||[]),...(meeting.subscriberUids||[])].includes(uid);const subscribed=subscriptions.some(s=>!denied.has(lower(s.status))&&([s.uid,s.subscriberUid,s.userId,s.memberUid,s.participantUid].map(clean).includes(uid)||email&&[s.email,s.subscriberEmail,s.participantEmail].some(x=>lower(x)===email)));const participantRecord=participants.some(p=>!denied.has(lower(p.status||p.registrationStatus))&&([p.uid,p.userId,p.participantUid,p.memberUid,p.invitedUid].map(clean).includes(uid)||email&&[p.email,p.participantEmail,p.invitedEmail].some(x=>lower(x)===email)));const appointed=[meeting.meetingChairpersonUid,meeting.meetingSecretaryUid,meeting.meetingAdministratorUid].map(clean);const transitionAssigned=transitionCommitteeActive(meeting)&&[meeting.transitionChairpersonUid,meeting.transitionSecretaryUid,meeting.transitionAdministratorUid].map(clean).includes(uid);const participant=listed||subscribed||participantRecord||appointed.includes(uid)||transitionAssigned;const chair=meetingRoleAssigned(meeting,uid,"chair"),secretary=meetingRoleAssigned(meeting,uid,"secretary"),meetingAdministrator=meetingRoleAssigned(meeting,uid,"administrator"),transitionOfficer=transitionCommitteeActive(meeting)&&(meetingRoleAssigned(meeting,uid,"transitionChair")||meetingRoleAssigned(meeting,uid,"transitionSecretary")||meetingRoleAssigned(meeting,uid,"transitionAdministrator"));const canManage=clean(meeting.initiatorUid)===uid||chair||secretary||meetingAdministrator||transitionOfficer;if(!isAdmin&&!active(member)&&!active(employee)&&!participant)throw Object.assign(new Error("An active IRPA identity or authorised meeting participant is required."),{status:403});return {uid,email,meeting,participant,canManage,canRead:canManage||participant||isAdmin,isAdmin,category:categoryOf(meeting),confidentiality:clean(meeting.confidentialityClass)||(categoryOf(meeting)==="GOVERNANCE"?"BOARD_RESTRICTED":"INTERNAL")};}
const MEETING_APPOINTMENT_FIELDS = {
  meetingChairpersonUid: "meetingChairpersonName",
  meetingSecretaryUid: "meetingSecretaryName",
  meetingAdministratorUid: "meetingAdministratorName",
  transitionChairpersonUid: "transitionChairpersonName",
  transitionSecretaryUid: "transitionSecretaryName",
  transitionAdministratorUid: "transitionAdministratorName"
};
const MEETING_APPOINTMENT_KEYS = new Set(Object.keys(MEETING_APPOINTMENT_FIELDS));
const activeInstitutionalRecord = record => !!record && ["active","activated"].includes(lower(record.status||record.registrationStatus||record.employmentStatus));
async function resolveActiveMeetingPerson(ctx,env,token,uid){
  const id=clean(uid); if(!id)return null;
  const [member,employee]=await Promise.all([getDoc(ctx,env,token,"members",id),getDoc(ctx,env,token,"employees",id)]);
  const profile=activeInstitutionalRecord(member)?member:activeInstitutionalRecord(employee)?employee:null;
  if(!profile)return null;
  return {uid:id,name:clean(profile.name||profile.fullName||profile.memberName||profile.employeeName||profile.displayName)||"IRPA member",email:lower(profile.email||profile.emailAddress||profile.contactEmail)||null};
}
async function validateMeetingAppointments(ctx,env,token,incoming,current=null){
  const patch={};
  for(const [uidField,nameField] of Object.entries(MEETING_APPOINTMENT_FIELDS)){
    if(!Object.prototype.hasOwnProperty.call(incoming,uidField))continue;
    const uid=clean(incoming[uidField]);
    if(!uid){patch[uidField]="";patch[nameField]="";continue;}
    const person=await resolveActiveMeetingPerson(ctx,env,token,uid);
    if(!person)return {error:"Each meeting appointment must identify an active registered IRPA member or employee. Invalid appointment: "+uidField+"."};
    patch[uidField]=person.uid;patch[nameField]=person.name;
  }
  return {patch};
}
function meetingRoleAssigned(meeting,uid,role){
  const id=clean(uid);if(!id)return false;
  const fields=role==="chair"?["meetingChairpersonUid","chairpersonUid"]:role==="secretary"?["meetingSecretaryUid","secretaryUid"]:role==="administrator"?["meetingAdministratorUid"]:role==="transitionChair"?["transitionChairpersonUid"]:role==="transitionSecretary"?["transitionSecretaryUid"]:role==="transitionAdministrator"?["transitionAdministratorUid"]:[];
  if(fields.some(field=>clean(meeting[field])===id))return true;
  return false;
}
function transitionCommitteeActive(meeting){return meeting?.transitionCommitteeActive===true&&lower(meeting.status)!=="in progress"&&lower(meeting.proceedingsStatus)!=="in progress";}
function meetingSecretariatAuthority(meeting,uid){return meetingRoleAssigned(meeting,uid,"chair")||meetingRoleAssigned(meeting,uid,"secretary")||(transitionCommitteeActive(meeting)&&(meetingRoleAssigned(meeting,uid,"transitionChair")||meetingRoleAssigned(meeting,uid,"transitionSecretary")));}
function meetingAdministratorAuthority(meeting,uid){return meetingRoleAssigned(meeting,uid,"administrator")||(transitionCommitteeActive(meeting)&&meetingRoleAssigned(meeting,uid,"transitionAdministrator"));}

function jwtBase64(value){const bytes=new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(value));let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
async function signedJwt(key,secret,claims){const head=jwtBase64({alg:"HS256",typ:"JWT"}),body=jwtBase64(claims),input=head+"."+body;const cryptoKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(input));let raw="";for(const b of new Uint8Array(sig))raw+=String.fromCharCode(b);return input+"."+btoa(raw).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
async function roomName(meetingId){return "irpa-meeting-"+(await hash(`${meetingId}:shared-live-room`)).slice(0,32);}
async function liveContext(ctx,env,token,claims,meetingId,data={}){const c=await context(ctx,env,token,claims,meetingId);if(terminal.has(lower(c.meeting.status)))throw Object.assign(new Error("This meeting is closed."),{status:409});if(!c.participant)throw Object.assign(new Error("Live meeting admission is restricted to invited participants and leaders appointed to this specific meeting."),{status:403});const participantId=clean(data.participantId);let invited=null;if(participantId){invited=await getDoc(ctx,env,token,"participants",participantId);if(!invited||invited.meetingId!==meetingId||denied.has(lower(invited.status||invited.registrationStatus)))throw Object.assign(new Error("The invitation participant is not active for this meeting."),{status:403});const pUid=clean(invited.participantUid||invited.uid||invited.userId),pEmail=lower(invited.participantEmail||invited.email);if(pUid&&pUid!==c.uid||pEmail&&pEmail!==c.email||!pUid&&!pEmail)throw Object.assign(new Error("The participant identity does not match this account."),{status:403});}const [member,employee]=await Promise.all([getDoc(ctx,env,token,"members",c.uid),getDoc(ctx,env,token,"employees",c.uid)]);const roleList=r=>[r?.role,r?.boardPosition,r?.unit,r?.unitName,...(Array.isArray(r?.roles)?r.roles:[]),...(Array.isArray(r?.assignedRoles)?r.assignedRoles:[]),...(Array.isArray(r?.selectedRoles)?r.selectedRoles:[]),...(Array.isArray(r?.roleAssignments)?r.roleAssignments:[])].flatMap(x=>clean(x).split(",")).map(x=>x.trim()).filter(Boolean);const roles=[...roleList(member),...roleList(employee)],invitedRoles=[invited?.role,invited?.participantRole,invited?.authority,...(Array.isArray(invited?.roles)?invited.roles:[])].map(clean).filter(Boolean);const authority=clean(data.selectedAuthority);if(!c.isAdmin&&authority&&!roles.includes(authority)&&!invitedRoles.includes(authority))throw Object.assign(new Error("The selected access authority is not registered to this account."),{status:403});return {...c,roles,invitedRoles};}
export function createR2RecordingOutput(env, filepath, meeting = {}) {
  const endpoint = clean(env.LIVEKIT_EGRESS_R2_ENDPOINT).replace(/\/$/, "");
  const bucket = clean(env.LIVEKIT_EGRESS_R2_BUCKET);
  const accessKey = clean(env.LIVEKIT_EGRESS_R2_ACCESS_KEY_ID);
  const secret = clean(env.LIVEKIT_EGRESS_R2_SECRET_ACCESS_KEY);
  const region = clean(env.LIVEKIT_EGRESS_R2_REGION) || "auto";
  let parsed;
  try { parsed = new URL(endpoint); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== "https:" || !/\.r2\.cloudflarestorage\.com$/i.test(parsed.hostname) || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw Object.assign(new Error("Cloudflare R2 endpoint is missing or invalid."), { status: 503 });
  }
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      !accessKey || !secret || region !== "auto") {
    throw Object.assign(new Error("Cloudflare R2 recording storage is not configured."), { status: 503 });
  }
  const objectKey = clean(filepath);
  if (!objectKey || objectKey.startsWith("/") || objectKey.split("/").some(part => !part || part === "." || part === "..")) {
    throw Object.assign(new Error("Recording object path is invalid."), { status: 400 });
  }
  return {
    filepath: objectKey,
    file_type: "MP4",
    s3: {
      access_key: accessKey,
      secret,
      region,
      endpoint: parsed.origin,
      bucket,
      force_path_style: true,
      content_disposition: "attachment",
      metadata: {
        service: "IRPA-DBGS",
        meeting_id: clean(meeting.id || meeting.meetingId).slice(0, 128),
        meeting_category: categoryOf(meeting)
      }
    }
  };
}
async function liveKitRequest(env,endpoint,body,method="POST"){const host=clean(env.LIVEKIT_URL).replace(/^wss:/i,"https:").replace(/^ws:/i,"http:").replace(/\/$/,""),key=clean(env.LIVEKIT_API_KEY),secret=clean(env.LIVEKIT_API_SECRET);if(!host||!key||!secret)throw Object.assign(new Error("Live meeting infrastructure is not configured in Cloudflare secrets."),{status:503});const now=Math.floor(Date.now()/1000),auth=await signedJwt(key,secret,{iss:key,sub:key,nbf:now-5,exp:now+60,video:{roomRecord:true,roomAdmin:true,roomCreate:true}});const r=await fetch(host+endpoint,{method,headers:{Authorization:"Bearer "+auth,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await r.json().catch(()=>({}));if(!r.ok){const e=new Error("LiveKit request failed ("+r.status+").");e.status=r.status;throw e;}return result;}
export function createMeetingServicesRouter(ctx){return async (request,env,pathname)=>{const paths=new Set(["/api/meeting-register/create","/api/meeting-register/update","/api/meeting-register/delete","/api/meeting-register/delete-preview","/api/meeting-voting/open","/api/meeting-voting/close","/api/meeting-decisions/create","/api/meeting-actions/create","/api/meeting-participants/create","/api/meeting-participants/update","/api/meeting-participants/delete","/api/meeting-room/activity","/api/meeting-room/event","/api/meeting-subscriptions/mine","/api/meeting-entry-requests/list","/api/meeting-entry-requests/resolve","/api/meeting-attendance/register","/api/meeting-attendance/mark","/api/meeting-attendance/daily/register","/api/meeting-attendance/daily/mark","/api/meeting-attendance/daily/dispatch","/api/meeting-quorum/assess","/api/meeting-board-register/list","/api/meeting-invitee-directory/list","/api/meeting-working-documents/register","/api/meeting-working-documents/list","/api/meeting-working-documents/review","/api/meeting-records/capture","/api/meeting-records/draft","/api/meeting-records/list","/api/meeting-records/retrieve","/api/meeting-records/protection","/api/meeting-records/dispose","/api/meeting-proceedings/save","/api/meeting-transcripts/translate","/api/meeting-reports/compile-email","/api/meeting-media/token","/api/meeting-media/moderate","/api/meeting-media/recording/start","/api/meeting-media/recording/stop","/api/meeting-media/recording/status"]);if(!paths.has(pathname)||request.method!=="POST")return null;let claims,data;try{claims=await ctx.authenticateFirebaseRequest(request,env);}catch{return fail(ctx,request,"A valid IRPA sign-in is required.",401);}try{data=await request.json();}catch{return fail(ctx,request,"A valid JSON request is required.",400);}const token=await ctx.getFirestoreAdminAccessToken(env).catch(()=>null);if(!token)return fail(ctx,request,"Meeting services are temporarily unavailable because the server identity is not configured.",503);try{
if(pathname==="/api/meeting-invitee-directory/list"){
 const [memberRecords,employeeRecords]=await Promise.all([listCollection(ctx,env,token,"members"),listCollection(ctx,env,token,"employees")]);
 const activeRecord=row=>[row.status,row.employmentStatus,row.registrationStatus].map(lower).some(v=>["active","activated"].includes(v));
 const isBoard=row=>row.boardMember===true||lower(row.role)==="board member"||Boolean(clean(row.boardPosition))||clean(row.department)==="Board of Directors";
 const project=(row,kind)=>({id:clean(row.id),uid:clean(row.uid||row.authUid||row.userUid),name:clean(row.name||row.fullName||row.memberName||row.employeeName||row.displayName),email:lower(row.email||row.emailAddress||row.contactEmail),memberNumber:clean(row.memberNumber||row.registrationNumber),employeeNumber:clean(row.employeeNumber),role:clean(row.role||kind),roles:Array.isArray(row.roles)?row.roles:[],memberType:clean(row.memberType||row.employeeType||kind),department:clean(row.department),status:clean(row.status||row.employmentStatus||row.registrationStatus),boardMember:row.boardMember===true,boardPosition:clean(row.boardPosition),title:clean(row.title),position:clean(row.position),departmentalRole:clean(row.departmentalRole)});
 const activeMembers=memberRecords.filter(activeRecord),activeEmployees=employeeRecords.filter(activeRecord);
 const boardByUid=new Map(),duplicateUids=new Set();let missingUid=0;
 for(const row of activeMembers.filter(isBoard)){
  const uid=clean(row.uid||row.authUid||row.userUid);
  if(!uid){missingUid++;continue;}
  if(boardByUid.has(uid)){duplicateUids.add(uid);continue;}
  boardByUid.set(uid,{...project(row,"Member"),uid});
 }
 const members=activeMembers.filter(row=>!isBoard(row)).map(row=>project(row,"Member"));
 const employees=activeEmployees.map(row=>project(row,"Employee"));
 return response(ctx,request,{ok:true,boardMembers:[...boardByUid.values()],members,employees,source:"ACTIVE_REGISTERS_BOARD_UID_ONLY",counts:{boardMembers:boardByUid.size,members:members.length,employees:employees.length,boardRecordsMissingUid:missingUid,duplicateBoardUids:duplicateUids.size},duplicateBoardUids:[...duplicateUids]});
}
if(pathname==="/api/meeting-board-register/list"){
 const records=await listCollection(ctx,env,token,"members");
 const active=records.filter(m=>{
  const statuses=[m.status,m.employmentStatus,m.registrationStatus].map(lower).filter(Boolean);
  const isActive=statuses.some(v=>["active","activated"].includes(v));
  const isBoard=m.boardMember===true||lower(m.role)==="board member"||Boolean(clean(m.boardPosition))||clean(m.department)==="Board of Directors";
  return isActive&&isBoard;
 });
 const byUid=new Map(),duplicateUids=new Set();let missingUid=0;
 for(const member of active){
  const uid=clean(member.uid||member.authUid||member.userUid);
  if(!uid){missingUid++;continue;}
  if(byUid.has(uid)){duplicateUids.add(uid);continue;}
  byUid.set(uid,{id:clean(member.id),uid,name:clean(member.name||member.fullName||member.memberName||member.displayName)||"Board Member",email:lower(member.email||member.emailAddress||member.contactEmail),memberNumber:clean(member.memberNumber||member.registrationNumber),role:clean(member.role),boardPosition:clean(member.boardPosition),department:clean(member.department),status:"Active"});
 }
 return response(ctx,request,{ok:true,boardMembers:[...byUid.values()],source:"ACTIVE_BOARD_MEMBERS_REGISTER_UID_ONLY",counts:{activeBoardRegisterRecords:active.length,eligibleUniqueUids:byUid.size,missingUid,duplicateUids:duplicateUids.size},duplicateUids:[...duplicateUids]});
}
if(pathname==="/api/meeting-quorum/assess"){
 const meetingId=clean(data.meetingId);if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
 const c=await context(ctx,env,token,claims,meetingId);if(!c.canRead)return fail(ctx,request,"Meeting participant access is required.",403);
 const attendanceDate=clean(data.date)||null;if(attendanceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate))return fail(ctx,request,"A valid attendance date is required.",400);const assessment=await buildQuorumAssessment(ctx,env,token,c.meeting,attendanceDate,claims);
 if(data.save===true){
  if(!meetingSecretariatAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the appointed Chairperson or Secretary may save a quorum assessment.",403);
  const snapshot={...assessment,rows:assessment.rows.map(r=>({...r,email:undefined}))};
  const patch={quorumAssessment:snapshot,quorumRequired:assessment.required||0,quorumVerified:assessment.boardMeeting?assessment.quorumMet:false,quorumVerifiedAt:assessment.boardMeeting&&assessment.quorumMet?new Date():null,quorumAssessmentStatus:assessment.status,quorumAssessmentAt:new Date()};
  await patchDoc(ctx,env,token,"meetings",meetingId,patch);
  await audit(ctx,env,token,claims,"MEETING_QUORUM_ASSESSED",c.meeting,meetingId,{status:assessment.status,boardMeeting:assessment.boardMeeting,required:assessment.required,present:assessment.present,counts:assessment.counts});
 }
 return response(ctx,request,{ok:true,assessment,saved:data.save===true});
}
if(pathname==="/api/meeting-working-documents/register"){
const meetingId=clean(data.meetingId),documentId=clean(data.documentId);
if(!meetingId||!documentId)return fail(ctx,request,"Meeting and controlled document IDs are required.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!meetingSecretariatAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the appointed Chairperson or Secretary may register meeting working documents.",403);
const source=await getDoc(ctx,env,token,"documents",documentId);
if(!source)return fail(ctx,request,"The controlled document was not found.",404);
if(clean(source.meetingId)!==meetingId)return fail(ctx,request,"The controlled document must be explicitly linked to this meeting before registration.",409);
const workingDocumentId=await hash(meetingId+":"+documentId).then(v=>v.slice(0,40));
const prior=await getDoc(ctx,env,token,"meetingWorkingDocuments",workingDocumentId),now=new Date();
const record={meetingId,documentId,title:clean(source.title||source.fileName||"Meeting document"),reference:clean(source.reference||source.documentReference),fileName:clean(source.fileName),webViewLink:clean(source.webViewLink||source.archiveFileWebViewLink),classification:clean(source.classification||"INTERNAL"),status:"ACTIVE",registeredByUid:c.uid,registeredByEmail:c.email||null,updatedAt:now};
if(prior)await patchDoc(ctx,env,token,"meetingWorkingDocuments",workingDocumentId,record);else await writeDoc(ctx,env,token,"meetingWorkingDocuments",workingDocumentId,{...record,registeredAt:now},false);
await audit(ctx,env,token,claims,"MEETING_WORKING_DOCUMENT_REGISTERED",c.meeting,workingDocumentId,{documentId,documentReference:record.reference});
return response(ctx,request,{ok:true,workingDocumentId});
}
if(pathname==="/api/meeting-working-documents/list"){
const meetingId=clean(data.meetingId);if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
const c=await context(ctx,env,token,claims,meetingId);if(!c.canRead)return fail(ctx,request,"Meeting participant access is required.",403);
const [documents,reviews]=await Promise.all([
 listByField(ctx,env,token,"meetingWorkingDocuments","meetingId",meetingId),
 listByField(ctx,env,token,"meetingDocumentReviews","meetingId",meetingId)
]);
const activeDocuments=documents.filter(d=>d.status==="ACTIVE").map(d=>({id:d.id,documentId:clean(d.documentId),title:clean(d.title),reference:clean(d.reference),fileName:clean(d.fileName),webViewLink:clean(d.webViewLink),classification:clean(d.classification||"INTERNAL"),reviews:reviews.filter(review=>review.workingDocumentId===d.id).map(review=>({id:review.id,reviewType:clean(review.reviewType),comment:clean(review.comment),status:clean(review.status),reviewerName:clean(review.reviewerName),createdAt:iso(review.createdAt)}))}));
return response(ctx,request,{ok:true,documents:activeDocuments});
}
if(pathname==="/api/meeting-working-documents/review"){
const meetingId=clean(data.meetingId),workingDocumentId=clean(data.workingDocumentId),reviewType=clean(data.reviewType).toUpperCase(),comment=clean(data.comment);
if(!meetingId||!workingDocumentId||!["ASSESSMENT","COMMENT","SIGNATURE_REQUEST"].includes(reviewType))return fail(ctx,request,"A meeting, working document and supported review type are required.",400);
if(!comment||comment.length>5000)return fail(ctx,request,"Enter a comment or assessment of up to 5,000 characters.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!c.canRead||!c.participant&&!c.canManage)return fail(ctx,request,"Only an authorised meeting participant may review working documents.",403);
const document=await getDoc(ctx,env,token,"meetingWorkingDocuments",workingDocumentId);
if(!document||clean(document.meetingId)!==meetingId||clean(document.status)!=="ACTIVE")return fail(ctx,request,"Active working document not found for this meeting.",404);
const [member,employee,participants]=await Promise.all([
 getDoc(ctx,env,token,"members",c.uid),getDoc(ctx,env,token,"employees",c.uid),listByField(ctx,env,token,"participants","meetingId",meetingId)
]);
const participant=participants.find(p=>[p.uid,p.userId,p.participantUid,p.memberUid,p.invitedUid].map(clean).includes(c.uid)||c.email&&[p.email,p.participantEmail,p.invitedEmail].some(v=>lower(v)===c.email));
const reviewerName=clean(participant?.participantName||participant?.name||member?.name||employee?.name||c.email||c.uid);
const reviewId=crypto.randomUUID(),now=new Date();
await writeDoc(ctx,env,token,"meetingDocumentReviews",reviewId,{meetingId,workingDocumentId,documentId:clean(document.documentId),reviewType,comment,reviewerUid:c.uid,reviewerEmail:c.email||null,reviewerName,status:"SUBMITTED",createdAt:now,updatedAt:now},false);
await audit(ctx,env,token,claims,"MEETING_WORKING_DOCUMENT_REVIEW_SUBMITTED",c.meeting,reviewId,{workingDocumentId,reviewType,commentLength:comment.length});
return response(ctx,request,{ok:true,reviewId,status:"SUBMITTED"});
}
if(pathname==="/api/meeting-attendance/daily/register"){
const meetingId=clean(data.meetingId),date=clean(data.date),uid=clean(claims.user_id);
if(!meetingId||!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail(ctx,request,"Meeting ID and a valid attendance date are required.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!meetingAdministratorAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may compile the daily attendance sheet.",403);
const [participants,memberRecords,employeeRecords,dailyRows,dispatchRows]=await Promise.all([
 listByField(ctx,env,token,"participants","meetingId",meetingId),
 listCollection(ctx,env,token,"members"),
 listCollection(ctx,env,token,"employees"),
 listByField(ctx,env,token,"meetingDailyAttendance","meetingId",meetingId),
 listByField(ctx,env,token,"meetingAttendanceDispatches","meetingId",meetingId)
]);
const activeRegisterRecord=row=>[row.status,row.employmentStatus,row.registrationStatus].map(lower).some(value=>["active","activated"].includes(value));
const registerByUid=new Map();
for(const record of [...memberRecords,...employeeRecords]){
 const recordUid=clean(record.uid||record.authUid||record.userUid);
 if(!recordUid||!activeRegisterRecord(record)||registerByUid.has(recordUid))continue;
 registerByUid.set(recordUid,record);
}
const registeredName=record=>clean(record?.name||record?.fullName||record?.memberName||record?.employeeName||record?.displayName);
const registeredEmail=record=>lower(record?.email||record?.emailAddress||record?.contactEmail);
const boardUids=new Set(memberRecords.filter(m=>{
 const active=[m.status,m.employmentStatus,m.registrationStatus].map(lower).some(value=>["active","activated"].includes(value));
 const isBoard=m.boardMember===true||lower(m.role)==="board member"||Boolean(clean(m.boardPosition))||clean(m.department)==="Board of Directors";
 return active&&isBoard;
}).map(m=>clean(m.uid||m.authUid||m.userUid)).filter(Boolean));
const dayByParticipant=new Map(dailyRows.filter(r=>clean(r.attendanceDate)===date).map(r=>[clean(r.participantId),r]));
const active=participants.filter(p=>!denied.has(lower(p.status||p.registrationStatus)));
for(const participant of active){if(dayByParticipant.has(clean(participant.id)))continue;const participantId=clean(participant.id),entryId=await hash(meetingId+"\\0"+date+"\\0"+participantId),now=new Date(),entry={meetingId,attendanceDate:date,participantId,participantUid:clean(participant.participantUid||participant.uid||participant.userId)||null,attendanceStatus:"N/A",recordedByUid:null,recordedAt:null,createdAt:now,updatedAt:now};await writeDoc(ctx,env,token,"meetingDailyAttendance",entryId,entry,false);dayByParticipant.set(participantId,entry);}
const rows=active.map(p=>{
 const role=clean(p.participantRole||p.role||p.participantType),uid=clean(p.participantUid||p.uid||p.userId),registerRecord=registerByUid.get(uid);
 const committee=lower(role)==="board committee member"||lower(p.participantType).includes("board committee");
 const registrationCategory=committee?"BOARD_COMMITTEE_MEMBER":boardUids.has(uid)&&lower(p.sourceType)!=="manual invitee"?"BOARD_MEMBER":boardMemberRole(p)?"UNMATCHED_BOARD_REGISTRATION":/management|executive director|director|manager/i.test(role)?"MANAGEMENT":/staff|employee|personnel|secretary|secretariat|officer/i.test(role)||lower(p.sourceType)==="employee register"?"STAFF":lower(p.sourceType)==="member register"||lower(p.participantType).includes("member")?"IRPA_MEMBER":/external|guest|partner|donor|consultant|technical expert|government representative|observer/i.test(role)||lower(p.participantType).includes("external")?"EXTERNAL_INVITEE":"OTHER";
 const day=dayByParticipant.get(p.id),participantName=clean(p.participantName||p.name||p.fullName||p.displayName),name=participantName||registeredName(registerRecord);
 return {participantId:p.id,participantUid:uid||null,name:name||"NAME NOT FOUND — VERIFY REGISTER",email:lower(p.participantEmail||p.email||p.invitedEmail||p.subscriberEmail)||registeredEmail(registerRecord),role:role||clean(registerRecord?.role||registerRecord?.boardPosition||registerRecord?.position),title:clean(p.title||p.position||p.jobTitle||p.boardPosition||registerRecord?.title||registerRecord?.position||registerRecord?.boardPosition),occupation:clean(p.occupation||p.capacity||p.profession||p.jobTitle||p.position||registerRecord?.occupation||registerRecord?.capacity||registerRecord?.profession),department:clean(p.department||p.departmentName||p.unit||p.unitName||registerRecord?.department||registerRecord?.unit),institution:clean(p.institution||p.organization||p.organisation||registerRecord?.institution||registerRecord?.organization||registerRecord?.organisation),sourceType:clean(p.sourceType)||null,registrationCategory,dailyAttendanceStatus:clean(day?.attendanceStatus)||"N/A",attendanceStatus:clean(day?.attendanceStatus)||"N/A",dailyAttendanceRecordedAt:iso(day?.recordedAt),signed:false,nameResolved:Boolean(name),nameSource:participantName?"MEETING_PARTICIPANT":registeredName(registerRecord)?"AUTHORITATIVE_REGISTER":"UNRESOLVED"};
});
const registeredBoardUids=new Set(rows.filter(r=>r.registrationCategory==="BOARD_MEMBER"&&r.participantUid).map(r=>r.participantUid));
const representedBoardUids=new Set();
for(const member of memberRecords){
 const activeMember=[member.status,member.employmentStatus,member.registrationStatus].map(lower).some(value=>["active","activated"].includes(value));
 const isBoard=member.boardMember===true||lower(member.role)==="board member"||Boolean(clean(member.boardPosition))||clean(member.department)==="Board of Directors";
 const memberUid=clean(member.uid||member.authUid||member.userUid);
 if(!activeMember||!isBoard||!memberUid||registeredBoardUids.has(memberUid)||representedBoardUids.has(memberUid))continue;
 representedBoardUids.add(memberUid);
 rows.push({participantId:null,participantUid:memberUid,name:clean(member.name||member.fullName||member.memberName||member.displayName)||"Board Member",email:lower(member.email||member.emailAddress||member.contactEmail),role:clean(member.boardPosition)||"Board Member",registrationCategory:"BOARD_MEMBER",meetingParticipantRegistered:false,dailyAttendanceStatus:"N/A",attendanceStatus:"N/A",dailyAttendanceRecordedAt:null,signed:false,registrationNote:"Not registered for this meeting"});
}
const dispatch=dispatchRows.find(r=>clean(r.attendanceDate)===date)||null;
let gatewayStatus=null;if(dispatch?.status==="DISPATCHED"&&dispatch?.gatewayEnvelopeId&&dispatch?.ownerUid&&typeof ctx.getGatewayEnvelopeStatus==="function")gatewayStatus=await ctx.getGatewayEnvelopeStatus(clean(dispatch.ownerUid),env,clean(dispatch.gatewayEnvelopeId)).catch(()=>null);
const verifiedGatewaySigners=dispatch?.gatewayAuditChainValid===true&&gatewayStatus?.auditChainValid===true&&clean(gatewayStatus?.envelopeId)===clean(dispatch?.gatewayEnvelopeId)?gatewayStatus.signers:[];
const gatewaySignersById=new Map((Array.isArray(verifiedGatewaySigners)?verifiedGatewaySigners:[]).map(signer=>[clean(signer.id),signer]));
const signedByUid=new Map((Array.isArray(dispatch?.gatewaySignerMap)?dispatch.gatewaySignerMap:[]).map(binding=>[clean(binding.participantUid),gatewaySignersById.get(clean(binding.signerId))]).filter(([participantUid,signer])=>participantUid&&signer?.status==="Signed"));
for(const row of rows){const signer=signedByUid.get(clean(row.participantUid));if(signer){row.signed=true;row.signedAt=iso(signer.signedAt);}}
const hostUid=clean(c.meeting.meetingAdministratorUid||(transitionCommitteeActive(c.meeting)?c.meeting.transitionAdministratorUid:""));
return response(ctx,request,{ok:true,meetingId,date,hostUid:hostUid||null,hostName:clean(c.meeting.meetingAdministratorName||c.meeting.transitionAdministratorName),meetingTitle:clean(c.meeting.title),meetingReference:clean(c.meeting.reference||c.meeting.meetingReference),rows,dispatch:dispatch?{status:dispatch.status,envelopeId:dispatch.envelopeId,documentId:dispatch.documentId,ownerUid:dispatch.ownerUid||null,dispatchedAt:iso(dispatch.dispatchedAt),gatewayInvitationStatus:dispatch.gatewayInvitationStatus||null,gatewayEnvelopeId:dispatch.gatewayEnvelopeId||null,gatewaySignerMap:Array.isArray(dispatch.gatewaySignerMap)?dispatch.gatewaySignerMap:[]}:null});
}
if(pathname==="/api/meeting-attendance/daily/mark"){
const meetingId=clean(data.meetingId),date=clean(data.date),participantId=clean(data.participantId),attendanceStatus=clean(data.attendanceStatus);
if(!meetingId||!participantId||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!["Present","Absent","Excused","N/A"].includes(attendanceStatus))return fail(ctx,request,"Meeting, date, participant and valid daily attendance status are required.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!meetingRoleAssigned(c.meeting,c.uid,"administrator")&&!(transitionCommitteeActive(c.meeting)&&meetingRoleAssigned(c.meeting,c.uid,"transitionAdministrator")))return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may update the daily attendance sheet.",403);
const participant=await getDoc(ctx,env,token,"participants",participantId);
if(!participant||participant.meetingId!==meetingId||denied.has(lower(participant.status||participant.registrationStatus)))return fail(ctx,request,"An active registered participant for this meeting is required.",404);
const priorDispatch=(await listByField(ctx,env,token,"meetingAttendanceDispatches","meetingId",meetingId)).find(r=>clean(r.attendanceDate)===date);
if(priorDispatch&&["PREPARING","DISPATCHED"].includes(clean(priorDispatch.status)))return fail(ctx,request,"Daily attendance is locked because its signing request has been prepared or dispatched.",409);
const id=await hash(meetingId+"\\0"+date+"\\0"+participantId),now=new Date(),existing=await getDoc(ctx,env,token,"meetingDailyAttendance",id);
const record={meetingId,attendanceDate:date,participantId,participantUid:clean(participant.participantUid||participant.uid||participant.userId)||null,attendanceStatus,recordedByUid:clean(claims.user_id),recordedAt:now,updatedAt:now};
if(existing)await patchDoc(ctx,env,token,"meetingDailyAttendance",id,record);else await writeDoc(ctx,env,token,"meetingDailyAttendance",id,{...record,createdAt:now},false);
await audit(ctx,env,token,claims,"MEETING_DAILY_ATTENDANCE_MARKED",c.meeting,id,{date,participantId,attendanceStatus});
return response(ctx,request,{ok:true,attendanceDate:date,participantId,attendanceStatus,recordedAt:now.toISOString()});
}
if(pathname==="/api/meeting-attendance/daily/dispatch"){
const meetingId=clean(data.meetingId),date=clean(data.date),phase=clean(data.phase).toUpperCase(),envelopeId=clean(data.envelopeId),documentId=clean(data.documentId),ownerUid=clean(data.ownerUid),uid=clean(claims.user_id);
if(!meetingId||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!["PREPARE","SENT","FAILED"].includes(phase)||!envelopeId||!documentId)return fail(ctx,request,"Meeting, date, phase, envelope and controlled document are required.",400);
const c=await context(ctx,env,token,claims,meetingId);
const hostUid=clean(c.meeting.meetingAdministratorUid||(transitionCommitteeActive(c.meeting)?c.meeting.transitionAdministratorUid:""));
if(!meetingAdministratorAuthority(c.meeting,uid)||!hostUid||ownerUid!==uid||hostUid!==uid)return fail(ctx,request,"The appointed Meeting Administrator must own the attendance document and dispatch the signing request.",403);
const id=await hash(meetingId+"\\0"+date),existing=await getDoc(ctx,env,token,"meetingAttendanceDispatches",id),now=new Date();
if(phase==="PREPARE"){
 if(existing&&["PREPARING","DISPATCHED"].includes(clean(existing.status)))return fail(ctx,request,"A daily attendance signing request has already been prepared or dispatched.",409);
 const [participants,dailyRows]=await Promise.all([listByField(ctx,env,token,"participants","meetingId",meetingId),listByField(ctx,env,token,"meetingDailyAttendance","meetingId",meetingId)]);
 const dayRows=dailyRows.filter(r=>clean(r.attendanceDate)===date&&clean(r.attendanceStatus)==="Present");
 const presentUids=new Set(dayRows.map(r=>clean(r.participantUid)).filter(Boolean));
 const supplied=new Set(Array.isArray(data.signerUids)?data.signerUids.map(clean):[]);
 const gatewaySignerMap=Array.isArray(data.gatewaySignerMap)?data.gatewaySignerMap:[];
 const mappedUids=new Set(gatewaySignerMap.map(item=>clean(item.participantUid)).filter(Boolean));
 const signerIds=new Set(gatewaySignerMap.map(item=>clean(item.signerId)).filter(Boolean));
 if(!presentUids.size||presentUids.size!==supplied.size||[...presentUids].some(value=>!supplied.has(value))||mappedUids.size!==presentUids.size||[...presentUids].some(value=>!mappedUids.has(value))||signerIds.size!==gatewaySignerMap.length||gatewaySignerMap.length!==presentUids.size)return fail(ctx,request,"The email-link signer mapping must exactly and uniquely bind every UID-identified participant marked Present.",409);
 const record={meetingId,attendanceDate:date,status:"PREPARING",envelopeId,documentId,ownerUid:uid,signerUids:[...presentUids],gatewaySignerMap,preparedAt:now,updatedAt:now};
 if(existing)await patchDoc(ctx,env,token,"meetingAttendanceDispatches",id,record);else await writeDoc(ctx,env,token,"meetingAttendanceDispatches",id,{...record,createdAt:now},false);
}else{
 if(!existing||clean(existing.envelopeId)!==envelopeId||clean(existing.ownerUid)!==uid)return fail(ctx,request,"No matching host-owned prepared signing request exists for this date.",409);
 if(phase==="SENT"){
  const gatewayEnvelopeId=clean(data.gatewayEnvelopeId);
  if(!gatewayEnvelopeId||typeof ctx.getGatewayEnvelopeStatus!=="function")return fail(ctx,request,"The existing Signature Portal Gateway status verifier is unavailable.",503);
  const gatewayStatus=await ctx.getGatewayEnvelopeStatus(uid,env,gatewayEnvelopeId).catch(()=>null);
  const actualSigners=new Map((Array.isArray(gatewayStatus?.signers)?gatewayStatus.signers:[]).map(signer=>[clean(signer.id),signer]));
  const expectedMap=Array.isArray(existing.gatewaySignerMap)?existing.gatewaySignerMap:[];
  const mappingValid=gatewayStatus?.auditChainValid===true&&clean(gatewayStatus?.envelopeId)===gatewayEnvelopeId&&actualSigners.size===expectedMap.length&&expectedMap.length===Number(existing.signerUids?.length||0)&&expectedMap.every(binding=>{
   const signer=actualSigners.get(clean(binding.signerId));
   return signer&&lower(signer.email)===lower(binding.participantEmail)&&lower(signer.name)===lower(binding.participantName);
  });
  if(!mappingValid)return fail(ctx,request,"The Gateway signer identities did not verify against the prepared participant register and audit chain. The request remains pending reconciliation.",409);
  await patchDoc(ctx,env,token,"meetingAttendanceDispatches",id,{status:"DISPATCHED",dispatchedAt:now,gatewayEnvelopeId,gatewayInvitationStatus:clean(data.gatewayInvitationStatus)||"Sent",gatewayAuditChainValid:true,updatedAt:now});
 }else{
  await patchDoc(ctx,env,token,"meetingAttendanceDispatches",id,{status:"FAILED",dispatchError:clean(data.error).slice(0,500),failedAt:now,updatedAt:now});
 }
}
await audit(ctx,env,token,claims,"MEETING_DAILY_ATTENDANCE_SIGNING_"+phase,c.meeting,id,{date,envelopeId,documentId,ownerUid:uid});
return response(ctx,request,{ok:true,date,status:phase==="PREPARE"?"PREPARING":phase==="SENT"?"DISPATCHED":"FAILED",envelopeId});
}
if(pathname==="/api/meeting-attendance/mark"){
const meetingId=clean(data.meetingId),participantId=clean(data.participantId),attendanceStatus=clean(data.attendanceStatus);
if(!meetingId||!participantId||!["Present","Absent","Excused"].includes(attendanceStatus))return fail(ctx,request,"Meeting, participant and valid attendance status are required.",400);
const c=await context(ctx,env,token,claims,meetingId),participant=await getDoc(ctx,env,token,"participants",participantId);
if(!participant||participant.meetingId!==meetingId)return fail(ctx,request,"Participant record does not belong to this meeting.",404);
const own=[participant.uid,participant.userId,participant.participantUid,participant.memberUid,participant.invitedUid].map(clean).includes(c.uid)||c.email&&[participant.email,participant.participantEmail,participant.invitedEmail,participant.subscriberEmail].some(v=>lower(v)===c.email);
if(data.self===true){if(!own||attendanceStatus!=="Present")return fail(ctx,request,"Self-registration is limited to the authenticated participant marking their own attendance as Present.",403);}
else if(!meetingRoleAssigned(c.meeting,c.uid,"administrator")&&!(transitionCommitteeActive(c.meeting)&&meetingRoleAssigned(c.meeting,c.uid,"transitionAdministrator")))return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may update another participant's attendance.",403);
if(denied.has(lower(participant.status||participant.registrationStatus)))return fail(ctx,request,"Inactive participant records cannot be marked for attendance.",409);
const now=new Date(),patch={attendanceStatus,attendanceRecordedAt:now,attendanceRecordedByUid:c.uid,updatedAt:now};
await patchDoc(ctx,env,token,"participants",participantId,patch);
await audit(ctx,env,token,claims,"MEETING_ATTENDANCE_MARKED",c.meeting,participantId,{attendanceStatus,selfRegistration:data.self===true});
return response(ctx,request,{ok:true,meetingId,participantId,attendanceStatus,recordedAt:now.toISOString()});
}
if(pathname==="/api/meeting-attendance/register"){
const meetingId=clean(data.meetingId);if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
const c=await context(ctx,env,token,claims,meetingId),manager=meetingAdministratorAuthority(c.meeting,c.uid);
const [participants,signatures,memberRecords]=await Promise.all([
 listByField(ctx,env,token,"participants","meetingId",meetingId),
 listByField(ctx,env,token,"meetingAttendanceSignatures","meetingId",meetingId),
 listCollection(ctx,env,token,"members")
]);
const boardUids=new Set(memberRecords.filter(m=>{
 const statuses=[m.status,m.employmentStatus,m.registrationStatus].map(lower);
 const active=statuses.some(v=>["active","activated"].includes(v));
 const isBoard=m.boardMember===true||lower(m.role)==="board member"||Boolean(clean(m.boardPosition))||clean(m.department)==="Board of Directors";
 return active&&isBoard;
}).map(m=>clean(m.uid||m.authUid||m.userUid)).filter(Boolean));
const uid=clean(claims.user_id),email=lower(claims.email);
const own=p=>[p.uid,p.userId,p.participantUid,p.memberUid,p.invitedUid].map(clean).includes(uid)||email&&[p.email,p.participantEmail,p.invitedEmail,p.subscriberEmail].some(v=>lower(v)===email);
if(!manager&&!participants.some(own))return fail(ctx,request,"You are not registered as a participant in this meeting.",403);
const byParticipant=new Map(signatures.map(row=>[clean(row.participantId),row]));
const records=participants.filter(p=>manager||own(p)).map(p=>{
 const sig=byParticipant.get(p.id);
 const uid=clean(p.participantUid||p.uid||p.userId);
 const role=clean(p.participantRole||p.role||p.participantType);
 const committee=lower(role)==="board committee member"||lower(p.participantType).includes("board committee");
 const registrationCategory=committee?"BOARD_COMMITTEE_MEMBER":boardUids.has(uid)&&lower(p.sourceType)!=="manual invitee"?"BOARD_MEMBER":boardMemberRole(p)?"UNMATCHED_BOARD_REGISTRATION":/management|executive director|director|manager/i.test(role)?"MANAGEMENT":/staff|employee|personnel|secretary|secretariat|officer/i.test(role)||lower(p.sourceType)==="employee register"?"STAFF":lower(p.sourceType)==="member register"||lower(p.participantType).includes("member")?"IRPA_MEMBER":/external|guest|partner|donor|consultant|technical expert|government representative|observer/i.test(role)||lower(p.participantType).includes("external")?"EXTERNAL_INVITEE":"OTHER";
 return {participantId:p.id,name:clean(p.name||p.participantName||p.fullName||p.displayName),role,sourceType:clean(p.sourceType)||null,registrationCategory,email:lower(p.email||p.participantEmail||p.invitedEmail||p.subscriberEmail),attendanceStatus:clean(p.attendanceStatus||p.status)||"Unmarked",signed:Boolean(sig),signatureMethod:sig?.signatureMethod||null,typedName:sig?.typedName||null,signedAt:iso(sig?.signedAt),signatureId:sig?.id||null};
});
return response(ctx,request,{ok:true,meetingId,meetingReference:clean(c.meeting.meetingReference||c.meeting.reference||c.meeting.title),meetingTitle:clean(c.meeting.title),meetingDate:clean(c.meeting.date),retrievedAt:new Date().toISOString(),canManage:manager,records});
}
if(pathname==="/api/meeting-entry-requests/list"){
const meetingId=clean(data.meetingId);if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
const meeting=await getDoc(ctx,env,token,"meetings",meetingId);if(!meeting)return fail(ctx,request,"Meeting was not found.",404);
const uid=clean(claims.user_id);
const authorised=meetingRoleAssigned(meeting,uid,"administrator")||(transitionCommitteeActive(meeting)&&meetingRoleAssigned(meeting,uid,"transitionAdministrator"));
if(!authorised)return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may view entry requests.",403);
if(terminal.has(lower(meeting.status)))return fail(ctx,request,"Closed meetings cannot load pending entry requests.",409);
const rows=await listByField(ctx,env,token,"meetingEntryRequests","meetingId",meetingId);
const requests=rows.filter(row=>row.status==="PENDING"&&new Date(row.expiresAt||0).getTime()>Date.now()).map(row=>({id:row.id,participantId:clean(row.participantId),participantName:clean(row.participantName||row.participantEmail),participantEmail:clean(row.participantEmail),requestedAt:iso(row.requestedAt)}));
return response(ctx,request,{ok:true,requests});
}
if(pathname==="/api/meeting-entry-requests/resolve"){
const requestId=clean(data.requestId),decision=clean(data.decision).toUpperCase();
if(!requestId||!["ADMIT","DENY"].includes(decision))return fail(ctx,request,"An entry request ID and ADMIT or DENY decision are required.",400);
const entry=await getDoc(ctx,env,token,"meetingEntryRequests",requestId);if(!entry)return fail(ctx,request,"Entry request was not found.",404);
const meeting=await getDoc(ctx,env,token,"meetings",clean(entry.meetingId));if(!meeting)return fail(ctx,request,"Meeting was not found.",404);if(terminal.has(lower(meeting.status)))return fail(ctx,request,"Closed meetings cannot admit or decline new entry requests.",409);
const uid=clean(claims.user_id),email=lower(claims.email);
const authorised=meetingRoleAssigned(meeting,uid,"administrator")||(transitionCommitteeActive(meeting)&&meetingRoleAssigned(meeting,uid,"transitionAdministrator"));
if(!authorised)return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may resolve entry requests.",403);
if(entry.status!=="PENDING")return fail(ctx,request,"This entry request has already been resolved.",409);
const access=await getDoc(ctx,env,token,"meetingAccessTokens",clean(entry.accessId));
if(!access||access.status!=="Active"||new Date(access.expiresAt||0).getTime()<=Date.now())return fail(ctx,request,"The invitation pass is expired, revoked or no longer active.",409);
const next=decision==="ADMIT"?"ADMITTED":"DENIED",now=new Date(),patch={status:next,resolvedByUid:uid,resolvedByEmail:email||null,resolvedAt:now};
const project=ctx.getFirebaseProjectId(env),base="projects/"+project+"/databases/(default)/documents/";
const auditId=crypto.randomUUID();
await commitWrites(ctx,env,token,[
 {update:{name:base+"meetingEntryRequests/"+requestId,fields:fields(patch)},updateMask:{fieldPaths:Object.keys(patch)},currentDocument:{updateTime:entry.updateTime}},
 {update:{name:base+"audit/"+auditId,fields:fields({action:decision==="ADMIT"?"MEETING_ENTRY_ADMITTED":"MEETING_ENTRY_DENIED",collection:"meetingEntryRequests",recordId:requestId,details:{meetingId:entry.meetingId,participantId:entry.participantId,accessId:entry.accessId},actorUid:uid,actorEmail:email||null,createdAt:now})},currentDocument:{exists:false}}
]);
return response(ctx,request,{ok:true,requestId,status:next});
}
if(pathname==="/api/meeting-register/create"){
const incoming=data.data&&typeof data.data==="object"?data.data:{};
const uid=clean(claims.user_id),email=lower(claims.email);
if(!uid)return fail(ctx,request,"A valid IRPA sign-in is required.",401);
const [adminProfile,member,employee]=await Promise.all([getDoc(ctx,env,token,"adminProfiles",uid),getDoc(ctx,env,token,"members",uid),getDoc(ctx,env,token,"employees",uid)]);
const isAdmin=claims.admin===true||email==="irpa2412@gmail.com"||adminProfile?.active===true;
const active=r=>r&&["active","activated"].includes(lower(r.status||r.registrationStatus||r.employmentStatus));
if(!isAdmin&&!(active(member)||active(employee)))return fail(ctx,request,"An active registered IRPA member or employee identity is required to initiate a meeting.",403);
const category=clean(incoming.meetingCategory||incoming.meetingPolicyId||"OTHER").toUpperCase();
if(!["GOVERNANCE","ADMINISTRATIVE","STAFF","GENERAL","OTHER"].includes(category))return fail(ctx,request,"Choose a valid meeting category.",400);
const appointmentValidation=await validateMeetingAppointments(ctx,env,token,incoming);
if(appointmentValidation.error)return fail(ctx,request,appointmentValidation.error,400);
if(incoming.leadershipElectionRequired===true){
 const transitionUids=["transitionChairpersonUid","transitionSecretaryUid","transitionAdministratorUid"];
 if(transitionUids.some(key=>!clean(appointmentValidation.patch[key]??incoming[key])))return fail(ctx,request,"A leadership-election meeting requires all three temporary Transition Committee appointments before election voting can open.",409);
}
// Meeting initiation is open to every active registered member and employee.
// Category-specific access, participant admission, Board voting, quorum and
// formal approval remain enforced by their separate policies and routes.
if(clean(incoming.initiatorUid)!==uid)return fail(ctx,request,"The meeting initiator must match the authenticated account.",403);
const id=crypto.randomUUID(),now=new Date(),year=clean(incoming.date).slice(0,4)||String(now.getUTCFullYear()),record={...incoming,...appointmentValidation.patch,transitionCommitteeActive:incoming.leadershipElectionRequired===true,leadershipElectionStatus:incoming.leadershipElectionRequired===true?"PENDING":"NOT_REQUIRED",transitionCommitteeDeclaredAt:incoming.leadershipElectionRequired===true?now:null,environment:isAdmin&&meetingEnvironment(incoming.environment)==="TRIAL"?"TRIAL":"REAL",meetingCategory:category,meetingPolicyId:category,meetingIdentity:clean(incoming.meetingIdentity)||"IRPA-MEET-"+id.toUpperCase(),meetingReference:clean(incoming.meetingReference)||"IRPA-MTG-"+year+"-"+id.slice(0,8).toUpperCase(),registerStatus:"Registered",registeredAt:now,createdByUid:uid,createdAt:now,updatedAt:now};
await writeDoc(ctx,env,token,"meetings",id,record,false);
await audit(ctx,env,token,claims,"MEETING_REGISTER_CREATED",{id,...record},id,{meetingCategory:category});
return response(ctx,request,{ok:true,id});
}
if(pathname==="/api/meeting-register/update"){
const meetingId=clean(data.meetingId),incoming=data.data&&typeof data.data==="object"?data.data:{};
const c=await context(ctx,env,token,claims,meetingId);
const current=c.meeting;
const changed={};
for(const [key,value] of Object.entries(incoming)){if(["id","updateTime","createdAt","environment"].includes(key)||(!c.isAdmin&&key==="registeredAt"))continue;
if(JSON.stringify(value)!==JSON.stringify(current[key]))changed[key]=value;}
if(!Object.keys(changed).length)return response(ctx,request,{ok:true,meetingId,changedFields:[]});
const controller=clean(current.initiatorUid)===c.uid||meetingRoleAssigned(current,c.uid,"chair")||meetingRoleAssigned(current,c.uid,"secretary")||meetingRoleAssigned(current,c.uid,"administrator")||(transitionCommitteeActive(current)&&(meetingRoleAssigned(current,c.uid,"transitionChair")||meetingRoleAssigned(current,c.uid,"transitionSecretary")||meetingRoleAssigned(current,c.uid,"transitionAdministrator")));
if(!controller)return fail(ctx,request,"Only an authority appointed to this specific meeting or its registered initiator may update this meeting.",403);
if(Object.keys(changed).some(key=>MEETING_APPOINTMENT_KEYS.has(key))&&lower(current.status)==="in progress")return fail(ctx,request,"Meeting appointments are locked once formal proceedings begin.",409);
const appointmentValidation=await validateMeetingAppointments(ctx,env,token,incoming,current);
if(appointmentValidation.error)return fail(ctx,request,appointmentValidation.error,400);
Object.assign(changed,appointmentValidation.patch);
const newlyAppointed=[...MEETING_APPOINTMENT_KEYS].map(key=>clean(changed[key]??current[key])).filter(Boolean);
if(newlyAppointed.length){const participantUids=[...new Set([...(Array.isArray(current.participantUids)?current.participantUids:[]),...(Array.isArray(current.attendeeUids)?current.attendeeUids:[]),...newlyAppointed])];changed.participantUids=participantUids;changed.attendeeUids=participantUids;changed.memberUids=[...new Set([...(Array.isArray(current.memberUids)?current.memberUids:[]),...newlyAppointed])];changed.invitedUids=[...new Set([...(Array.isArray(current.invitedUids)?current.invitedUids:[]),...newlyAppointed])];}
if(changed.leadershipElectionRequired===false&&current.leadershipElectionRequired===true)return fail(ctx,request,"Once declared, the leadership-election workflow cannot be switched off; complete the election and record the new leadership first.",409);
if(changed.leadershipElectionRequired===true||current.leadershipElectionRequired===true){
 const transitionUids=["transitionChairpersonUid","transitionSecretaryUid","transitionAdministratorUid"];
 const proposed={...current,...changed};
 if(transitionUids.some(key=>!clean(proposed[key])))return fail(ctx,request,"The Transition Committee requires a Chairperson, Secretary and Administrator before leadership election voting can be opened.",409);
 if(lower(current.status)==="in progress")return fail(ctx,request,"A Transition Committee cannot be reactivated after formal proceedings begin.",409);
 changed.transitionCommitteeActive=true;
 if(current.leadershipElectionRequired!==true)changed.transitionCommitteeDeclaredAt=new Date();
 changed.leadershipElectionStatus=clean(changed.leadershipElectionStatus||current.leadershipElectionStatus||"PENDING");
}
if(changed.status&&!["Scheduled","In Progress","Completed","Cancelled"].includes(clean(changed.status)))return fail(ctx,request,"Unsupported meeting status transition.",400);
if(changed.status&&clean(current.meetingChairpersonUid)!==c.uid&&lower(changed.status)!=="in progress")return fail(ctx,request,"Only the appointed meeting Chairperson may pause or close formal proceedings.",403);
if(lower(changed.status)==="in progress"||lower(changed.proceedingsStatus)==="in progress"){
 const proposed={...current,...changed};
 if(clean(proposed.meetingChairpersonUid)!==c.uid)return fail(ctx,request,"Only the Chairperson appointed to this meeting may open formal proceedings.",403);
 const required=["meetingChairpersonUid","meetingSecretaryUid","meetingAdministratorUid"];
 if(required.some(key=>!clean(proposed[key])))return fail(ctx,request,"Formal proceedings cannot begin until the meeting-specific Chairperson, Secretary and Meeting Administrator have all been declared.",409);
 for(const key of required){if(!await resolveActiveMeetingPerson(ctx,env,token,proposed[key]))return fail(ctx,request,"Formal proceedings are blocked because one or more appointed leaders are no longer active IRPA members or employees.",409);}
 if(proposed.transitionCommitteeActive===true){
  const electionIssues=await listByField(ctx,env,token,"votingIssues","meetingId",meetingId);
  const leadershipIssues=electionIssues.filter(issue=>issue.leadershipElection===true);
  if(!leadershipIssues.length||leadershipIssues.some(issue=>lower(issue.status)!=="closed"))return fail(ctx,request,"The leadership election must be completed and every leadership ballot closed before formal proceedings can begin.",409);
  changed.transitionCommitteeActive=false;
  changed.transitionCommitteeMandateEndedAt=new Date();
  changed.transitionCommitteeMandateEndedAtProceedings=true;
  changed.leadershipElectionStatus="LEADERSHIP_RECORDED";
 }
}
if(lower(changed.status)==="in progress"&&isBoardMeeting(current)){
 const quorumDate=clean(changed.quorumAttendanceDate||current.quorumAttendanceDate||current.quorumAssessment?.attendanceDate||current.date||current.meetingDate)||null;const assessment=await buildQuorumAssessment(ctx,env,token,current,quorumDate,claims);
 if(!assessment.quorumMet)return fail(ctx,request,assessment.status==="NOT_ASSESSABLE"?"A Board meeting cannot start: no eligible registered Board members are recorded for quorum.":`A Board meeting cannot start without quorum: ${assessment.present} of ${assessment.counts.boardMembers} registered Board members present; ${assessment.required} required.`,409);
 changed.quorumRequired=assessment.required;changed.quorumVerified=true;changed.quorumVerifiedAt=new Date();changed.quorumAssessment={...assessment,rows:assessment.rows.map(r=>({...r,email:undefined}))};changed.quorumAssessmentStatus=assessment.status;changed.quorumAssessmentAt=new Date();
}

if(terminal.has(lower(current.status))&&changed.status&&lower(changed.status)!==lower(current.status))return fail(ctx,request,"A terminal meeting status cannot be changed through the meeting portal.",409);
const sessionFields=new Set(["status","proceedingsStatus","quorumRequired","quorumAttendanceDate","quorumVerified","quorumVerifiedAt","quorumAssessment","quorumAssessmentStatus","quorumAssessmentAt","closedAt","currentAgendaItem","currentAgendaItemIndex","currentAgendaItemStatus","currentMotion","transcript","transcriptAutoSavedAt","transcriptCaptureStartedAt","transcriptCaptureLimitHours","currentDecision","votingRequired","votingReference","votingIssueId","votingStatus","votingResult","actionItems","actionId","actionReference","decisionId","decisionReference","signingFields","signingFieldSetVersion","updatedAt","updatedByUid","updatedByEmail","recordingStatus","recordingEgressId","recordingStartedAt","recordingStartedByUid","recordingStoppedAt","recordingStoppedByUid","recordingStorage","participantUids","attendeeUids","memberUids","invitedUids"]);
if(Object.keys(changed).some(key=>!sessionFields.has(key)&&!MEETING_APPOINTMENT_KEYS.has(key)&&!["leadershipElectionRequired","leadershipElectionStatus","transitionCommitteeActive","transitionCommitteeDeclaredAt"].includes(key)))return fail(ctx,request,"This meeting is registered. Updates are limited to authorised meeting-session fields and meeting-specific appointment records.",403);
if(current.registerStatus!=="Registered"&&!c.isAdmin)return fail(ctx,request,"Only an administrator may update an unregistered meeting.",403);
changed.updatedAt=new Date();
await patchDoc(ctx,env,token,"meetings",meetingId,changed);
await audit(ctx,env,token,claims,"MEETING_REGISTER_UPDATED",current,meetingId,{changedFields:Object.keys(changed)});
return response(ctx,request,{ok:true,meetingId,changedFields:Object.keys(changed)});
}
const loadMeetingChildren = async meetingId => (await Promise.all(
  MEETING_CHILD_COLLECTIONS.map(async collection =>
    (await listByField(ctx,env,token,collection,"meetingId",meetingId))
      .map(record => ({ collection, record }))
  )
)).flat();

if(pathname==="/api/meeting-register/delete-preview"){
const meetingId=clean(data.meetingId);
if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!c.isAdmin)return fail(ctx,request,"Only an authorised administrator may preview meeting deletion.",403);
if(!c.meeting)return fail(ctx,request,"Meeting not found.",404);
if(!isTrialMeeting(c.meeting))return fail(ctx,request,"Only an explicitly TRIAL meeting may be previewed for deletion. Missing or invalid environment is treated as REAL.",409);
const childRecords=await loadMeetingChildren(meetingId);
const preview=await buildMeetingDeletionPreview(meetingId,c.meeting,childRecords);
return response(ctx,request,{
  ok:true,
  environment:"TRIAL",
  meetingId,
  title:clean(c.meeting.title),
  childCount:preview.childCount,
  collectionCounts:preview.collectionCounts,
  previewDigest:preview.previewDigest,
  externalArtifactsNotice:preview.externalArtifactsNotice,
  exportData:preview.exportData
});
}

if(pathname==="/api/meeting-register/delete"){
const meetingId=clean(data.meetingId);
if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!c.isAdmin)return fail(ctx,request,"Only an authorised administrator may delete a registered meeting.",403);
if(!c.meeting)return fail(ctx,request,"Meeting not found.",404);
if(!isTrialMeeting(c.meeting))return fail(ctx,request,"Only an explicitly TRIAL meeting may be deleted. Missing or invalid environment is treated as REAL.",409);
const childRecords=await loadMeetingChildren(meetingId);
const preview=await buildMeetingDeletionPreview(meetingId,c.meeting,childRecords);
const validation=validateMeetingDeletion({
  meeting:c.meeting,
  reason:data.reason,
  confirmationTitle:data.confirmationTitle,
  previewDigest:data.previewDigest,
  currentDigest:preview.previewDigest,
  childRecords
});
if(!validation.ok)return fail(ctx,request,validation.message,validation.status);
const base="projects/"+ctx.getFirebaseProjectId(env)+"/databases/(default)/documents/";
const writes=childRecords.map(({collection,record})=>({
  delete:base+collection+"/"+encodeURIComponent(record.id),
  currentDocument:{updateTime:record.updateTime}
}));
writes.push({delete:base+"meetings/"+encodeURIComponent(meetingId),currentDocument:{updateTime:c.meeting.updateTime}});
const auditId=crypto.randomUUID();
writes.push({
  update:{
    name:base+"audit/"+auditId,
    fields:fields({
      action:"TRIAL_MEETING_DELETED",
      collection:"meetings",
      recordId:meetingId,
      details:{
        title:clean(c.meeting.title),
        meetingReference:clean(c.meeting.meetingReference||c.meeting.reference),
        reason:validation.reason,
        confirmationTitle:validation.confirmationTitle,
        previewDigest:preview.previewDigest,
        deletedChildCount:validation.childCount,
        deletedChildCollections:validation.collectionCounts,
        externalArtifactsNotice:preview.externalArtifactsNotice
      },
      actorUid:c.uid,
      actorEmail:c.email||null,
      createdAt:new Date()
    })
  },
  currentDocument:{exists:false}
});
await commitWrites(ctx,env,token,writes);
return response(ctx,request,{
  ok:true,
  meetingId,
  deleted:true,
  deletedChildCount:validation.childCount,
  deletedChildCollections:validation.collectionCounts,
  auditId
});
}
if(pathname==="/api/meeting-voting/open"){
const meetingId=clean(data.meetingId),reference=clean(data.votingReference),resolutionId=clean(data.resolutionId);
if(!meetingId||!reference)return fail(ctx,request,"Meeting ID and voting reference are required.",400);
const c=await context(ctx,env,token,claims,meetingId);
const controller=meetingRoleAssigned(c.meeting,c.uid,"chair")||meetingRoleAssigned(c.meeting,c.uid,"secretary")||(transitionCommitteeActive(c.meeting)&&(meetingRoleAssigned(c.meeting,c.uid,"transitionChair")||meetingRoleAssigned(c.meeting,c.uid,"transitionSecretary")));
if(!controller)return fail(ctx,request,"Only the Chairperson or Secretary appointed to this meeting (or its active Transition Committee during the leadership election) may open voting.",403);
const electionMode=transitionCommitteeActive(c.meeting)&&c.meeting.leadershipElectionRequired===true;
if(!electionMode&&categoryOf(c.meeting)!=="GOVERNANCE")return fail(ctx,request,"This meeting category does not permit ordinary voting. Only an active Transition Committee may open a pre-proceedings leadership election.",409);
if(terminal.has(lower(c.meeting.status)))return fail(ctx,request,"Voting cannot be opened for a closed meeting.",409);
if(resolutionId){const resolution=await getDoc(ctx,env,token,"resolutions",resolutionId);if(!resolution||resolution.meetingId!==meetingId)return fail(ctx,request,"The linked resolution must belong to the selected meeting.",409);}
const id=await hash(meetingId+"|"+resolutionId+"|"+reference.toLowerCase());
const prior=await getDoc(ctx,env,token,"votingIssues",id);
if(prior&&lower(prior.status)!=="cancelled")return response(ctx,request,{ok:true,issue:{...prior,id},alreadyOpen:true});
const now=new Date(),issue={meetingId,meetingReference:clean(data.meetingReference||c.meeting.title||meetingId),resolutionId:resolutionId||null,resolutionReference:clean(data.resolutionReference)||null,votingReference:reference,leadershipElection:transitionCommitteeActive(c.meeting)&&c.meeting.leadershipElectionRequired===true,status:"Open",result:"Pending",anonymous:true,openedAt:now,openedByUid:c.uid,createdAt:prior?.createdAt||now,updatedAt:now};
if(prior)await patchDoc(ctx,env,token,"votingIssues",id,issue);else await writeDoc(ctx,env,token,"votingIssues",id,issue,false);
await audit(ctx,env,token,claims,"MEETING_VOTING_ISSUE_OPENED",c.meeting,id,{votingReference:reference,resolutionId:resolutionId||null,anonymous:true});
return response(ctx,request,{ok:true,issue:{...issue,id},alreadyOpen:false});
}

if(pathname==="/api/meeting-actions/create"){
const incoming=data.data&&typeof data.data==="object"?data.data:{},meetingId=clean(incoming.meetingId);
if(!meetingId)return fail(ctx,request,"Meeting ID is required for a meeting-linked action.",400);
const c=await context(ctx,env,token,claims,meetingId);
const controller=meetingRoleAssigned(c.meeting,c.uid,"chair")||meetingRoleAssigned(c.meeting,c.uid,"secretary")||(transitionCommitteeActive(c.meeting)&&(meetingRoleAssigned(c.meeting,c.uid,"transitionChair")||meetingRoleAssigned(c.meeting,c.uid,"transitionSecretary")));
if(!controller)return fail(ctx,request,"Only the authorised meeting initiator, chairperson, secretary or administrator may record a meeting action.",403);
if(terminal.has(lower(c.meeting.status)))return fail(ctx,request,"An action cannot be added to a closed meeting.",409);
const title=clean(incoming.title||incoming.description);
if(!title)return fail(ctx,request,"Action description is required.",400);
const id=crypto.randomUUID(),now=new Date(),record={...incoming,meetingId,createdByUid:c.uid,createdAt:now,updatedAt:now};
delete record.id;
await writeDoc(ctx,env,token,"actions",id,record,false);
await audit(ctx,env,token,claims,"MEETING_ACTION_RECORDED",c.meeting,id,{actionReference:clean(record.actionReference),originatingAgendaItem:clean(record.originatingAgendaItem)});
return response(ctx,request,{ok:true,id,actionReference:clean(record.actionReference)});
}
if(pathname==="/api/meeting-decisions/create"){
const incoming=data.data&&typeof data.data==="object"?data.data:{},meetingId=clean(incoming.meetingId);
if(!meetingId)return fail(ctx,request,"Meeting ID is required for a meeting-linked decision.",400);
const c=await context(ctx,env,token,claims,meetingId);
const controller=meetingRoleAssigned(c.meeting,c.uid,"chair")||meetingRoleAssigned(c.meeting,c.uid,"secretary")||(transitionCommitteeActive(c.meeting)&&(meetingRoleAssigned(c.meeting,c.uid,"transitionChair")||meetingRoleAssigned(c.meeting,c.uid,"transitionSecretary")));
if(!controller)return fail(ctx,request,"Only the authorised meeting initiator, chairperson, secretary or administrator may record a meeting decision.",403);
if(terminal.has(lower(c.meeting.status)))return fail(ctx,request,"A decision cannot be added to a closed meeting.",409);
const title=clean(incoming.title||incoming.description);
if(!title)return fail(ctx,request,"Decision text is required.",400);
const id=crypto.randomUUID(),now=new Date(),record={...incoming,id:undefined,meetingId,createdByUid:c.uid,createdAt:now,updatedAt:now};
delete record.id;
await writeDoc(ctx,env,token,"decisions",id,record,false);
await audit(ctx,env,token,claims,"MEETING_DECISION_RECORDED",c.meeting,id,{decisionReference:clean(record.decisionReference),originatingAgendaItem:clean(record.originatingAgendaItem)});
return response(ctx,request,{ok:true,id,decisionReference:clean(record.decisionReference)});
}
if(pathname==="/api/meeting-voting/close"){
const issueId=clean(data.votingIssueId),resultValue=["Passed","Rejected","Pending"].includes(clean(data.result))?clean(data.result):"Pending";
if(!issueId)return fail(ctx,request,"A voting issue is required.",400);
const issue=await getDoc(ctx,env,token,"votingIssues",issueId);
if(!issue)return fail(ctx,request,"Voting issue not found.",404);
const c=await context(ctx,env,token,claims,issue.meetingId);
const controller=meetingRoleAssigned(c.meeting,c.uid,"chair")||meetingRoleAssigned(c.meeting,c.uid,"secretary")||(transitionCommitteeActive(c.meeting)&&(meetingRoleAssigned(c.meeting,c.uid,"transitionChair")||meetingRoleAssigned(c.meeting,c.uid,"transitionSecretary")));
if(!controller)return fail(ctx,request,"Only the Chairperson or Secretary appointed to this meeting (or its active Transition Committee during the leadership election) may close voting.",403);
if(issue.status!=="Open")return fail(ctx,request,"This voting issue is already closed.",409);
const now=new Date(),base="projects/"+ctx.getFirebaseProjectId(env)+"/databases/(default)/documents/",writes=[];
writes.push({update:{name:base+"votingIssues/"+issueId,fields:fields({status:"Closed",result:resultValue,closedAt:now,updatedAt:now})},updateMask:{fieldPaths:["status","result","closedAt","updatedAt"]},currentDocument:{updateTime:issue.updateTime}});
if(issue.resolutionId){
const resolution=await getDoc(ctx,env,token,"resolutions",issue.resolutionId);
if(!resolution||resolution.meetingId!==issue.meetingId)return fail(ctx,request,"The linked resolution no longer exists in this meeting; voting closure was blocked.",409);
writes.push({update:{name:base+"resolutions/"+issue.resolutionId,fields:fields({status:resultValue,votingStatus:"Completed",votingResult:resultValue,votingIssueId:issueId,updatedAt:now})},updateMask:{fieldPaths:["status","votingStatus","votingResult","votingIssueId","updatedAt"]},currentDocument:{updateTime:resolution.updateTime}});
}
const auditId=crypto.randomUUID();
writes.push({update:{name:base+"audit/"+auditId,fields:fields({action:"VOTING_ISSUE_CLOSED",collection:"votingIssues",recordId:issueId,details:{result:resultValue,resolutionId:issue.resolutionId||null},actorUid:c.uid,actorEmail:c.email||null,createdAt:now})},currentDocument:{exists:false}});
await commitWrites(ctx,env,token,writes);
return response(ctx,request,{ok:true,result:resultValue,votingIssueId:issueId});
}

if(pathname==="/api/meeting-participants/create"){
const incoming=data.data&&typeof data.data==="object"?data.data:{},meetingId=clean(incoming.meetingId);
if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);
const c=await context(ctx,env,token,claims,meetingId);
if(!c.canManage)return fail(ctx,request,"Only the authorised meeting initiator, chairperson, secretary or administrator may register participants.",403);
if(terminal.has(lower(c.meeting.status)))return fail(ctx,request,"Participants cannot be added to a closed meeting.",409);
const participantName=clean(incoming.participantName),participantEmail=lower(incoming.participantEmail||incoming.email);
if(!participantName||!participantEmail||!/^\S+@\S+\.\S+$/.test(participantEmail))return fail(ctx,request,"A participant name and valid email address are required.",400);
const existing=await listByField(ctx,env,token,"participants","meetingId",meetingId);
if(existing.some(p=>lower(p.participantEmail||p.email)===participantEmail&&!denied.has(lower(p.status||p.registrationStatus))))return fail(ctx,request,"This email address is already registered for the selected meeting.",409);
const authoritativeRoles=new Set(["board member","board committee member","board chairperson","board secretary","board treasurer","board vice chairperson"]);
if(clean(incoming.sourceType)==="Manual Invitee"&&(authoritativeRoles.has(lower(incoming.participantRole))||clean(incoming.boardMemberId)||clean(incoming.employeeId)||clean(incoming.memberId)))return fail(ctx,request,"A manual invitee cannot be assigned an authoritative institutional role or register identity.",403);
const participantId=crypto.randomUUID(),now=new Date(),record={...incoming,participantName,participantEmail,meetingId,meetingIdentity:clean(incoming.meetingIdentity)||clean(c.meeting.meetingIdentity),meetingReference:clean(incoming.meetingReference)||clean(c.meeting.meetingReference||c.meeting.reference),meetingAccessDispatched:false,meetingAccessDispatchStatus:"Pending",invitationStatus:"Not Sent",attendanceStatus:clean(incoming.attendanceStatus)||"Invited",createdByUid:c.uid,createdAt:now,updatedAt:now};
delete record.id;delete record.updateTime;
await writeDoc(ctx,env,token,"participants",participantId,record,false);
const registeredUid=clean(record.participantUid||record.uid||record.userId),registeredEmail=lower(record.participantEmail||record.email);
const meetingPatch={};
if(registeredUid){for(const key of ["participantUids","attendeeUids","memberUids","invitedUids"])meetingPatch[key]=[...new Set([...(Array.isArray(c.meeting[key])?c.meeting[key]:[]),registeredUid])];}
if(registeredEmail){for(const key of ["participantEmails","attendeeEmails","invitedEmails"])meetingPatch[key]=[...new Set([...(Array.isArray(c.meeting[key])?c.meeting[key]:[]),registeredEmail])];}
if(Object.keys(meetingPatch).length)await patchDoc(ctx,env,token,"meetings",meetingId,meetingPatch);
await audit(ctx,env,token,claims,"MEETING_PARTICIPANT_CREATED",c.meeting,participantId,{participantEmail,participantUid:registeredUid||null,participantRole:clean(record.participantRole)});
return response(ctx,request,{ok:true,participantId});
}
if(pathname==="/api/meeting-participants/update"){
const participantId=clean(data.participantId),incoming=data.data&&typeof data.data==="object"?data.data:{};
if(!participantId)return fail(ctx,request,"Participant record ID is required.",400);
const participant=await getDoc(ctx,env,token,"participants",participantId);
if(!participant)return fail(ctx,request,"Meeting participant was not found.",404);
const meetingId=clean(participant.meetingId);
if(!meetingId||incoming.meetingId&&clean(incoming.meetingId)!==meetingId)return fail(ctx,request,"A participant cannot be moved to a different meeting through this update.",409);
const c=await context(ctx,env,token,claims,meetingId);
if(!c.canManage)return fail(ctx,request,"Only the authorised meeting initiator, chairperson, secretary or administrator may update participant registration and dispatch status.",403);
const allowed=new Set(["participantName","participantEmail","participantRole","participantType","sourceType","sourceRecordId","employeeId","boardMemberId","memberId","memberType","status","registrationStatus","notes","meetingIdentity","meetingReference","meetingTitle","meetingDate","meetingStartTime","meetingEndTime","meetingPlatform","platformAccessUrl","platformMeetingId","platformPasscode","meetingVenue","meetingChairperson","meetingAgenda","invitationId","invitationStatus","invitationRole","meetingAccessDispatched","meetingAccessDispatchStatus","meetingAccessId","meetingAccessDispatchedAt","meetingAccessExpiresAt","meetingAccessDispatchFailedAt","meetingAccessDeliveryStatus","meetingAccessDispatchError","meetingAccessDispatchStage","attendanceStatus","attendanceRecordedAt","attendanceRecordedByUid"]);
const patch={};
for(const [key,value] of Object.entries(incoming)){if(allowed.has(key)&&JSON.stringify(value)!==JSON.stringify(participant[key]))patch[key]=value;}
if(!Object.keys(patch).length)return response(ctx,request,{ok:true,participantId,changedFields:[]});
patch.updatedAt=new Date();
await patchDoc(ctx,env,token,"participants",participantId,patch);
await audit(ctx,env,token,claims,"MEETING_PARTICIPANT_UPDATED",c.meeting,participantId,{changedFields:Object.keys(patch)});
return response(ctx,request,{ok:true,participantId,changedFields:Object.keys(patch)});
}
if(pathname==="/api/meeting-participants/delete"){
const participantId=clean(data.participantId);
if(!participantId)return fail(ctx,request,"Participant record ID is required.",400);
const participant=await getDoc(ctx,env,token,"participants",participantId);
if(!participant)return fail(ctx,request,"Meeting participant was not found.",404);
const c=await context(ctx,env,token,claims,clean(participant.meetingId));
if(!meetingAdministratorAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may remove a participant.",403);
if(["removed","cancelled","revoked"].includes(lower(participant.status)))return response(ctx,request,{ok:true,participantId,status:"Removed",alreadyRemoved:true});
await patchDoc(ctx,env,token,"participants",participantId,{status:"Removed",registrationStatus:"Removed",invitationStatus:"Removed",meetingAccessDispatched:false,meetingAccessDispatchStatus:"Revoked",removedByUid:c.uid,removedAt:new Date(),updatedAt:new Date()});const participantAccessPasses=await listByField(ctx,env,token,"meetingAccessTokens","participantId",participantId);for(const pass of participantAccessPasses.filter(row=>row.status==="Active"))await patchDoc(ctx,env,token,"meetingAccessTokens",pass.id,{status:"Revoked",revokedByUid:c.uid,revokedAt:new Date(),revocationReason:"Participant registration removed"});const pendingEntryRequests=await listByField(ctx,env,token,"meetingEntryRequests","participantId",participantId);for(const entryRequest of pendingEntryRequests.filter(row=>row.status==="PENDING"))await patchDoc(ctx,env,token,"meetingEntryRequests",entryRequest.id,{status:"DENIED",resolvedByUid:c.uid,resolvedAt:new Date(),resolutionReason:"Participant registration removed"});/* Legacy general-invitation documents are retained as historical evidence and are not mutated by Meeting Portal removal. */
await audit(ctx,env,token,claims,"MEETING_PARTICIPANT_REMOVED",c.meeting,participantId,{participantEmail:lower(participant.participantEmail||participant.email)||null,softRemoval:true});
return response(ctx,request,{ok:true,participantId,status:"Removed",softRemoval:true});
}
if(pathname==="/api/meeting-subscriptions/mine"){
const uid=clean(claims.user_id),email=lower(claims.email);
if(!uid)return fail(ctx,request,"A valid IRPA sign-in is required.",401);
const fieldsToCheck=["uid","subscriberUid","userId","memberUid","participantUid"];
const results=await Promise.all([...fieldsToCheck.map(field=>listByField(ctx,env,token,"meetingSubscriptions",field,uid).catch(()=>[])),...["email","subscriberEmail","participantEmail"].filter(()=>Boolean(email)).map(field=>listByField(ctx,env,token,"meetingSubscriptions",field,email).catch(()=>[]))]);
const unique=new Map();
for(const row of results.flat()){const key=clean(row.id)||JSON.stringify([row.meetingId,row.uid,row.email,row.status]);if(!unique.has(key))unique.set(key,row);}
const allowed=new Set(["","active","activated","subscribed","registered","confirmed","pending"]);
const subscriptions=[...unique.values()].filter(row=>!denied.has(lower(row.status))&&allowed.has(lower(row.status))&&clean(row.meetingId)).map(row=>({id:row.id,meetingId:clean(row.meetingId),status:clean(row.status)||"Active"}));
return response(ctx,request,{ok:true,subscriptions});
}
if(pathname==="/api/meeting-room/event"){
const meetingId=clean(data.meetingId),incoming=data.event&&typeof data.event==="object"?data.event:{};
const eventType=clean(incoming.eventType);
if(!meetingId||!eventType)return fail(ctx,request,"Meeting ID and event type are required.",400);
const c=await context(ctx,env,token,claims,meetingId);
const controller=meetingRoleAssigned(c.meeting,c.uid,"chair")||meetingRoleAssigned(c.meeting,c.uid,"secretary")||(transitionCommitteeActive(c.meeting)&&(meetingRoleAssigned(c.meeting,c.uid,"transitionChair")||meetingRoleAssigned(c.meeting,c.uid,"transitionSecretary")));
if(!controller)return fail(ctx,request,"Only the authorised meeting administrator, initiator, chairperson or secretary may record meeting-room events.",403);
if(terminal.has(lower(c.meeting.status))&&eventType!=="LIVE_SESSION_ENDED")return fail(ctx,request,"No new activity can be recorded after the meeting is closed.",409);
const allowed=["LIVE_SESSION_STARTED","LIVE_SESSION_PAUSED","LIVE_SESSION_ENDED","AGENDA_ITEM_OPENED","AGENDA_ITEM_STATUS_CHANGED","MOTION_RECORDED","VOTE_OPENED","DECISION_RECORDED","ACTION_RECORDED","TRANSCRIPT_SAVED"];
if(!allowed.includes(eventType))return fail(ctx,request,"Unsupported meeting-room event type.",400);
const eventId=crypto.randomUUID(),now=new Date();
const record={meetingId,meetingReference:clean(c.meeting.reference||c.meeting.title),...Object.fromEntries(["status","agendaItem","agendaItemIndex","motion","movedBy","secondedBy","votingReference","votingIssueId","decision","decisionId","decisionReference","action","actionId","actionReference","transcript"].filter(key=>incoming[key]!==undefined).map(key=>[key,incoming[key]])),eventType,actorUid:c.uid,actorEmail:c.email||null,createdAt:now};
await writeDoc(ctx,env,token,"meetingRoomEvents",eventId,record,false);
await audit(ctx,env,token,claims,"MEETING_ROOM_EVENT_RECORDED",c.meeting,eventId,{eventType,status:clean(incoming.status)||null});
return response(ctx,request,{ok:true,eventId,createdAt:now.toISOString()});
}
if(pathname==="/api/meeting-room/activity"){
const meetingId=clean(data.meetingId),c=await context(ctx,env,token,claims,meetingId);
if(!c.canRead)return fail(ctx,request,"You are not authorised to view this meeting's activity.",403);
const [events,votes]=await Promise.all([listByField(ctx,env,token,"meetingRoomEvents","meetingId",meetingId),listByField(ctx,env,token,"votes","meetingId",meetingId)]);
const recentEvents=events.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,30);
const activeIssue=clean(c.meeting.votingIssueId)?await getDoc(ctx,env,token,"votingIssues",clean(c.meeting.votingIssueId)):null;const voteClosed=["completed","closed"].includes(lower(c.meeting.votingStatus))||["completed","closed"].includes(lower(c.meeting.status))||lower(activeIssue?.status)==="closed";
const visibleVotes=voteClosed?votes.map(v=>({id:v.id,votingIssueId:v.votingIssueId,meetingId:v.meetingId,meetingReference:v.meetingReference,resolutionId:v.resolutionId||null,resolutionReference:v.resolutionReference||null,votingReference:v.votingReference,outcome:v.outcome,result:v.result,status:v.status,votingMethod:v.votingMethod,anonymous:true,votedAt:iso(v.votedAt)})):[];
return response(ctx,request,{ok:true,events:recentEvents,votes:visibleVotes,voteTallyAvailable:voteClosed});
}

if(pathname==="/api/meeting-records/list"){const c=await context(ctx,env,token,claims,clean(data.meetingId));if(!c.canRead)return fail(ctx,request,"You are not authorised to list records for this meeting.",403);const rows=(await listByField(ctx,env,token,"meetingRecords","meetingId",c.meeting.id)).filter(r=>r.status==="Active").sort((a,b)=>String(b.capturedAt||"").localeCompare(String(a.capturedAt||"")));await audit(ctx,env,token,claims,"MEETING_RECORD_REGISTER_VIEWED",c.meeting,null,{recordCount:rows.length});return response(ctx,request,{ok:true,records:rows.map(r=>({id:r.id,title:r.title,recordType:r.recordType,recordLabel:r.recordLabel,contentHash:r.contentHash,integrityStatus:r.integrityStatus,confidentialityClass:r.confidentialityClass,version:r.version,capturedAt:iso(r.capturedAt),retainUntil:iso(r.retainUntil),retentionYears:r.retentionYears,legalHold:r.legalHold===true,deletionStatus:r.deletionStatus||"NOT_ELIGIBLE",storageDestination:r.storageDestination}))});}
if(pathname==="/api/meeting-records/retrieve"){const record=await getDoc(ctx,env,token,"meetingRecords",clean(data.recordId));if(!record)return fail(ctx,request,"Meeting record not found.",404);const c=await context(ctx,env,token,claims,record.meetingId);if(!c.canRead||record.status!=="Active")return fail(ctx,request,"This record is not available to this identity or is no longer active.",403);const actual=await hash(record.content||"");if(actual!==record.contentHash){await audit(ctx,env,token,claims,"MEETING_RECORD_INTEGRITY_FAILURE",c.meeting,record.id,{expectedHash:record.contentHash||null,actualHash:actual});return fail(ctx,request,"Record integrity verification failed. Access is blocked and an audit event was recorded.",409);}await audit(ctx,env,token,claims,"MEETING_RECORD_RETRIEVED",c.meeting,record.id,{recordType:record.recordType,contentHash:actual});return response(ctx,request,{ok:true,record:{...record,contentHash:actual,integrityStatus:"VERIFIED"}});}
if(pathname==="/api/meeting-records/capture"||pathname==="/api/meeting-records/draft"||pathname==="/api/meeting-proceedings/save"){const meetingId=clean(data.meetingId),content=clean(data.content),type=clean(data.recordType).toUpperCase(),c=await context(ctx,env,token,claims,meetingId);const draft=pathname.endsWith("/draft"),proceedings=pathname==="/api/meeting-proceedings/save";if(proceedings&&lower(c.meeting.status)!=="in progress")return fail(ctx,request,"Live proceedings auto-save is only available while the meeting status is In Progress.",409);if(!c.canRead)return fail(ctx,request,"You are not authorised to save this meeting record.",403);if(!draft&&!proceedings&&!meetingSecretariatAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the appointed Chairperson or Secretary may capture an authoritative meeting record.",403);const allowed=draft?["AI_MINUTES_DRAFT","AI_SUMMARY_DRAFT","SUBSCRIBER_TRANSCRIPT_DRAFT"]:["TRANSCRIPT","MINUTES_DRAFT","MINUTES_FINAL","DECISION_REGISTER","ATTENDANCE_REGISTER","OTHER"];if(!proceedings&&!allowed.includes(type))return fail(ctx,request,"Unsupported meeting record type.",400);if(!content)return fail(ctx,request,"Record content is empty.",400);if(content.length>900000)return fail(ctx,request,"Text record exceeds the 900,000 character limit.",400);if(type==="MINUTES_FINAL"){const approval=await getDoc(ctx,env,token,"authorizationRequests",clean(data.approvalReference));if(!approval||!["approved","authorized","completed"].includes(lower(approval.status))||approval.meetingId!==meetingId)return fail(ctx,request,"Final minutes require an approved authorization record linked to this meeting.",409);}const now=new Date(),retentionYears=retention[c.category]||3,retainUntil=yearsFrom(now,retentionYears),digest=await hash(content);let id=proceedings?"live-transcript-"+(await hash(meetingId+":"+c.uid)).slice(0,32):crypto.randomUUID();let prior=proceedings?await getDoc(ctx,env,token,"meetingRecords",id):null;const recordType=proceedings?"SUBSCRIBER_TRANSCRIPT_DRAFT":type;const record={meetingId,meetingReference:clean(c.meeting.meetingReference||c.meeting.reference||c.meeting.title),meetingTitle:clean(c.meeting.title),meetingCategory:c.category,meetingPolicyId:c.category,recordType,recordLabel:proceedings?"Live Proceedings Transcript Draft":recordLabel(recordType),title:clean(data.title)||(proceedings?"Live Proceedings — "+clean(c.meeting.title||"IRPA Meeting"):recordLabel(recordType)),content,contentHash:digest,sourceTranscriptHash:clean(data.sourceTranscriptHash)||null,integrityAlgorithm:"SHA-256",integrityStatus:"VERIFIED_AT_CAPTURE",version:Number(prior?.version||0)+1,status:"Active",confidentialityClass:c.confidentiality,storageDestination:data.driveArchive?.provider==="Google Drive"?"GOOGLE_DRIVE_AND_FIRESTORE_METADATA":"FIRESTORE_MEETING_RECORDS",storagePath:clean(data.driveArchive?.storagePath)||null,driveArchive:data.driveArchive&&typeof data.driveArchive==="object"?data.driveArchive:null,documentPortalRequiredForBinary:true,draftOnly:draft||proceedings,approved:false,approvalStatus:"NOT_SUBMITTED",requiresHumanReview:draft||proceedings,createdFrom:proceedings?"IRPA_LIVE_PROCEEDINGS_AUTO_CAPTURE":draft?"IRPA_AI_MEETING_ASSISTANT":null,legalHold:prior?.legalHold===true,retentionYears,retainUntil:prior?.retainUntil||retainUntil,retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:c.uid,capturedByEmail:c.email||null,capturedAt:now,createdAt:prior?.createdAt||now,updatedAt:now,deletedAt:null,deletionStatus:"NOT_ELIGIBLE"};if(proceedings&&prior)await patchDoc(ctx,env,token,"meetingRecords",id,record);else await writeDoc(ctx,env,token,"meetingRecords",id,record,false);await audit(ctx,env,token,claims,proceedings?"LIVE_MEETING_PROCEEDINGS_AUTOSAVED":draft?"MEETING_ASSISTANT_DRAFT_SAVED":"MEETING_RECORD_CAPTURED",c.meeting,id,{recordType,contentHash:digest,version:record.version,requiresHumanReview:record.requiresHumanReview,retentionYears});return response(ctx,request,{ok:true,recordId:id,recordType,contentHash:digest,integrityStatus:record.integrityStatus,version:record.version,retentionYears,retainUntil:retainUntil.toISOString(),draftOnly:record.draftOnly,requiresHumanReview:record.requiresHumanReview,driveArchive:record.driveArchive});}
if(pathname==="/api/meeting-records/protection"||pathname==="/api/meeting-records/dispose"){const id=clean(data.recordId),record=await getDoc(ctx,env,token,"meetingRecords",id);if(!record)return fail(ctx,request,"Meeting record not found.",404);const c=await context(ctx,env,token,claims,record.meetingId);if(!c.isAdmin&&!meetingSecretariatAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the primary system administrator or the appointed Chairperson/Secretary may change meeting-record protection.",403);const op=clean(data.operation).toUpperCase();if(pathname.endsWith("/protection")){if(record.status!=="Active")return fail(ctx,request,"Only active records can change protection.",409);if(op==="LEGAL_HOLD"){const held=data.enabled===true;await patchDoc(ctx,env,token,"meetingRecords",id,{legalHold:held,legalHoldReason:held?clean(data.reason)||"Legal or governance preservation hold":null,legalHoldByUid:c.uid,legalHoldAt:new Date(),updatedAt:new Date()});await audit(ctx,env,token,claims,held?"MEETING_RECORD_LEGAL_HOLD_APPLIED":"MEETING_RECORD_LEGAL_HOLD_RELEASED",c.meeting,id,{reason:clean(data.reason)||null});return response(ctx,request,{ok:true,legalHold:held});}if(op==="EXTEND_RETENTION"){const n=Number(data.retentionYears);if(!Number.isInteger(n)||n<1||n>30)return fail(ctx,request,"Retention extension must be an integer from 1 to 30 years.",400);const until=yearsFrom(new Date(),n);await patchDoc(ctx,env,token,"meetingRecords",id,{retentionYears:n,retainUntil:until,retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0-EXTENDED",retentionExtendedByUid:c.uid,retentionExtendedAt:new Date(),updatedAt:new Date()});await audit(ctx,env,token,claims,"MEETING_RECORD_RETENTION_EXTENDED",c.meeting,id,{retentionYears:n,retainUntil:until.toISOString()});return response(ctx,request,{ok:true,retentionYears:n,retainUntil:until.toISOString()});}return fail(ctx,request,"Unsupported record protection operation.",400);}
if(op==="REQUEST_DELETE"){await patchDoc(ctx,env,token,"meetingRecords",id,{deletionStatus:"PENDING_REVIEW",deletionRequestedByUid:c.uid,deletionRequestedAt:new Date(),deletionReason:clean(data.reason)||"Retention/disposition review",updatedAt:new Date()});await audit(ctx,env,token,claims,"MEETING_RECORD_DELETE_REQUESTED",c.meeting,id,{reason:clean(data.reason)||null});return response(ctx,request,{ok:true,deletionStatus:"PENDING_REVIEW",message:"Record is preserved. Final deletion requires administrator disposition after retention and legal-hold checks."});}if(op==="PURGE"){if(!c.isAdmin)return fail(ctx,request,"Only the primary administrator may execute a final purge.",403);
// The final record purge shares the same immutable, fail-closed environment boundary
// and preserves every pre-existing legal-hold, retention, review and version gate.
const purgeValidation=validateMeetingRecordPurge({meeting:c.meeting,record});
if(!purgeValidation.ok)return fail(ctx,request,purgeValidation.message,purgeValidation.status);const project=ctx.getFirebaseProjectId(env),base=`projects/${project}/databases/(default)/documents/`,auditId=crypto.randomUUID();await commitWrites(ctx,env,token,[{delete:base+`meetingRecords/${id}`,currentDocument:{updateTime:record.updateTime}},{update:{name:base+`audit/${auditId}`,fields:fields({action:"MEETING_RECORD_PURGED",collection:"meetingRecords",recordId:id,details:{meetingId:record.meetingId,recordType:record.recordType,contentHash:record.contentHash,retentionYears:record.retentionYears,retentionPolicyVersion:record.retentionPolicyVersion},actorUid:c.uid,actorEmail:c.email||null,createdAt:new Date()})},currentDocument:{exists:false}}]);return response(ctx,request,{ok:true,deletionStatus:"PURGED",auditId});}return fail(ctx,request,"Unsupported disposition operation.",400);}
if(pathname==="/api/meeting-transcripts/translate"){const c=await context(ctx,env,token,claims,clean(data.meetingId));if(!c.canRead)return fail(ctx,request,"Only an authorised meeting participant or subscriber may translate these proceedings.",403);const content=clean(data.content),target=lower(data.targetLanguage);if(!content||content.length>30000)return fail(ctx,request,"Transcript text must contain 1–30,000 characters.",400);if(!new Set(["sw","en","fr","es","pt","ar","hi","zh","de","it","ja"]).has(target))return fail(ctx,request,"The requested translation language is not supported.",400);const r=await fetch("https://translation.googleapis.com/language/translate/v2",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({q:content,target,format:"text"})});const b=await r.json().catch(()=>({}));const translatedText=clean(b?.data?.translations?.[0]?.translatedText);if(!r.ok||!translatedText)return fail(ctx,request,"Translation service is unavailable. Confirm Google Cloud Translation API enablement, billing and service-account permissions.",503);await audit(ctx,env,token,claims,"MEETING_TRANSCRIPT_TRANSLATED",c.meeting,null,{targetLanguage:target,sourceCharacters:content.length,translatedCharacters:translatedText.length,translationProvider:"Google Cloud Translation",sourceTranscriptStoredSeparately:true});return response(ctx,request,{ok:true,translatedText,targetLanguage:target,provider:"Google Cloud Translation",requiresHumanReview:true});}
if(pathname==="/api/meeting-reports/compile-email"){const meetingId=clean(data.meetingId),minutesText=clean(data.minutesText);if(!meetingId)return fail(ctx,request,"Meeting ID is required.",400);if(minutesText.length>150000)return fail(ctx,request,"Compiled minutes exceed the 150,000 character limit.",400);const c=await context(ctx,env,token,claims,meetingId);if(!meetingSecretariatAuthority(c.meeting,c.uid))return fail(ctx,request,"Only the appointed Chairperson or Secretary may compile and distribute the meeting report.",403);if(!clean(c.meeting.registerStatus))return fail(ctx,request,"The meeting is not registered and cannot be reported.",409);const [resolutions,decisions,votes,subscriptions,participants,records]=await Promise.all([listByField(ctx,env,token,"resolutions","meetingId",meetingId),listByField(ctx,env,token,"decisions","meetingId",meetingId),listByField(ctx,env,token,"votes","meetingId",meetingId),listByField(ctx,env,token,"meetingSubscriptions","meetingId",meetingId),listByField(ctx,env,token,"participants","meetingId",meetingId),listByField(ctx,env,token,"meetingRecords","meetingId",meetingId)]);const recipients=new Map();const add=(raw,name="",status="")=>{const email=lower(raw);if(/^[^\\s@]+@[^\\s@]+\.[^\\s@]+$/.test(email)&&!denied.has(lower(status)))recipients.set(email,recipients.get(email)||clean(name)||email);};participants.forEach(p=>add(p.participantEmail||p.email||p.invitedEmail,p.participantName||p.name,p.status));subscriptions.forEach(p=>add(p.email||p.subscriberEmail||p.participantEmail,p.subscriberName||p.participantName||p.name,p.status));for(const key of ["invitedEmails","participantEmails","attendeeEmails","subscriberEmails"])if(Array.isArray(c.meeting[key]))c.meeting[key].forEach(x=>add(x));for(const key of ["participants","attendees"])if(Array.isArray(c.meeting[key]))c.meeting[key].forEach(p=>p&&typeof p==="object"&&add(p.email||p.participantEmail||p.subscriberEmail,p.name||p.participantName,p.status));const recipientRows=[...recipients.entries()].map(([email,name])=>({email,name}));if(!recipientRows.length)return fail(ctx,request,"No valid participant email addresses were found. No email was sent.",409);const count=outcome=>votes.filter(v=>lower(v.outcome||v.vote||v.choice)===lower(outcome)).length;const voteCounts={For:count("For"),Against:count("Against"),Abstain:count("Abstain")};const attendance=records.find(r=>lower(r.recordType)==="attendance_register"&&r.status==="Active");const reference=clean(c.meeting.meetingReference||c.meeting.reference||c.meeting.meetingIdentity||meetingId);const reportStatus=["Final","Approved","Reviewed"].includes(clean(c.meeting.proceedingsStatus))||lower(c.meeting.reportStatus)==="approved"?"Compiled report — approval status recorded":"Compiled report — draft / approval status not verified";const lines=(rows,keys)=>rows.length?rows.map((r,i)=>(i+1)+". "+(keys.map(k=>clean(r[k])).filter(Boolean).join(" — ")||clean(r.title||r.name||r.description)||"Recorded item")).join("\n"):"No entries recorded in the register at compilation time.";const report=["IMPROVEMENT OF RANGELAND IN PASTORAL AREAS (IRPA)","STANDARD MEETING REPORT","============================================================","Report status: "+reportStatus,"Meeting title: "+(clean(c.meeting.title)||"Not recorded"),"Meeting reference: "+reference,"Meeting category: "+c.category,"Meeting type: "+(clean(c.meeting.meetingType)||"Not recorded"),"Date: "+(clean(c.meeting.date)||"Not recorded"),"Time: "+(clean(c.meeting.startTime)||"Not recorded")+(clean(c.meeting.endTime)?" – "+clean(c.meeting.endTime):""),"Venue / platform: "+(clean(c.meeting.venue||c.meeting.meetingPlatform)||"Not recorded"),"Chairperson: "+(clean(c.meeting.chairperson)||"Not recorded"),"","1. PURPOSE AND AGENDA",clean(c.meeting.agenda)||"No agenda recorded.","","2. MEETING STATUS, ATTENDANCE AND QUORUM","Meeting status: "+(clean(c.meeting.status)||"Not recorded"),"Quorum verification: "+(c.meeting.quorumVerified===true?"Verified":c.meeting.quorumVerified===false?"Not verified / not met":clean(c.meeting.quorumStatus||c.meeting.quorumResult)||"Not recorded"),attendance?.content||clean(c.meeting.attendanceSummary||c.meeting.attendanceRegisterSummary)||"Attendance register not found in linked records.","","3. SUMMARY / COMPILED MINUTES",minutesText||clean(c.meeting.minutes)||clean(c.meeting.summary)||"No minutes or summary were supplied at compilation.","","4. DECISIONS REGISTER",lines(decisions,["reference","title","decision","description","status","responsiblePerson","deadline"]),"","5. RESOLUTIONS REGISTER",lines(resolutions,["reference","title","resolution","description","status"]),"","6. VOTING STATISTICS (AGGREGATED; NO INDIVIDUAL VOTES DISCLOSED)","Votes for: "+voteCounts.For,"Votes against: "+voteCounts.Against,"Abstentions: "+voteCounts.Abstain,"Recorded votes counted: "+(voteCounts.For+voteCounts.Against+voteCounts.Abstain),"Voting status: "+(clean(c.meeting.votingStatus)||"Not recorded"),"Voting result: "+(clean(c.meeting.votingResult)||"Not recorded"),"","7. ACTION ITEMS AND FOLLOW-UP",clean(c.meeting.actionItems)||lines(decisions.filter(d=>d.action||d.actionItems||d.responsiblePerson),["action","actionItems","responsiblePerson","deadline","status"]),"","8. RECORD STATUS AND CONTROL","Compiled from registered meeting records. Missing source information is marked as not recorded; no absent attendance, quorum, decision or voting data has been inferred.","Compiled by authorised account: "+(c.email||c.uid),"Report generated (UTC): "+new Date().toISOString(),"IRPA Digital Board Governance System"].join("\n");const reportHash=await hash(report.replace(/Report generated \(UTC\): .+\n/,""));const dispatchId=(await hash(meetingId+":"+reportHash)).slice(0,40);const prior=await getDoc(ctx,env,token,"meetingReportDispatches",dispatchId);if(prior?.status==="Sent")return response(ctx,request,{ok:true,alreadySent:true,reportHash,recipientCount:prior.recipientCount||0,sentCount:prior.sentCount||0,failedCount:0,dispatchId});if(prior?.status==="In Progress")return fail(ctx,request,"This report is already being distributed. Check the dispatch register before retrying.",409);const statusByEmail=new Map((prior?.recipients||[]).map(r=>[lower(r.email),r]));const dispatch={meetingId,meetingReference:reference,reportHash,reportContent:report,reportStatus,recipientCount:recipientRows.length,status:"In Progress",initiatedByUid:c.uid,initiatedByEmail:c.email||null,createdAt:prior?.createdAt||new Date(),updatedAt:new Date(),recipients:prior?.recipients||[]};if(prior)await patchDoc(ctx,env,token,"meetingReportDispatches",dispatchId,dispatch);else await writeDoc(ctx,env,token,"meetingReportDispatches",dispatchId,dispatch,false);const subject="IRPA Meeting Report | "+reference+" | "+(clean(c.meeting.title)||"Meeting");const html='<div style="font-family:Arial,sans-serif;max-width:800px;margin:auto;color:#202124"><h2>Improvement of Rangeland in Pastoral Areas (IRPA)</h2><h3>Standard Meeting Report</h3><p><strong>'+reportStatus.replace(/[&<>"]/g,"")+'</strong></p><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">'+report.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</pre><p>Aggregated voting statistics only; individual votes are not disclosed.</p></div>';const results=[...(prior?.recipients||[])];for(const recipient of recipientRows){const old=statusByEmail.get(recipient.email);if(old?.status==="Sent")continue;let row;try{if(typeof ctx.sendEmail!=="function")throw new Error("The existing IRPA mail delivery adapter is not available.");const sent=await ctx.sendEmail(env,{to:recipient.email,subject,text:report,html});row={email:recipient.email,name:recipient.name,status:sent?.status||"Sent",messageId:typeof sent==="string"?sent:(sent?.messageId||null)};}catch(e){row={email:recipient.email,name:recipient.name,status:"Failed",error:clean(e?.message||e).slice(0,200)};}const index=results.findIndex(x=>lower(x.email)===recipient.email);if(index>=0)results[index]=row;else results.push(row);await patchDoc(ctx,env,token,"meetingReportDispatches",dispatchId,{recipients:results,updatedAt:new Date()});}const sentCount=results.filter(r=>r.status==="Sent").length,failedCount=results.filter(r=>r.status!=="Sent").length;await patchDoc(ctx,env,token,"meetingReportDispatches",dispatchId,{status:failedCount?"Partially Failed":"Sent",sentCount,failedCount,recipientCount:recipientRows.length,recipients:results,completedAt:new Date(),updatedAt:new Date()});const years=retention[c.category]||3;const recordId=crypto.randomUUID();await writeDoc(ctx,env,token,"meetingRecords",recordId,{meetingId,meetingReference:reference,meetingTitle:clean(c.meeting.title),meetingCategory:c.category,meetingPolicyId:c.category,recordType:"MEETING_REPORT",recordLabel:recordLabel("MEETING_REPORT"),title:"Standard Meeting Report — "+(clean(c.meeting.title)||reference),content:report,contentHash:await hash(report),integrityAlgorithm:"SHA-256",integrityStatus:"VERIFIED_AT_CAPTURE",version:1,status:"Active",confidentialityClass:c.confidentiality,storageDestination:"FIRESTORE_MEETING_RECORDS",approvalStatus:reportStatus,draftOnly:!reportStatus.startsWith("Compiled report — approval status recorded"),requiresHumanReview:true,retentionYears:years,retainUntil:yearsFrom(new Date(),years),retentionPolicyVersion:"IRPA-MEETING-RETENTION-1.0",capturedByUid:c.uid,capturedByEmail:c.email||null,capturedAt:new Date(),createdAt:new Date(),updatedAt:new Date(),deletedAt:null,deletionStatus:"NOT_ELIGIBLE"},false);await audit(ctx,env,token,claims,"MEETING_REPORT_COMPILED_AND_DISTRIBUTED",c.meeting,recordId,{reportHash,dispatchId,recipientCount:recipientRows.length,sentCount,failedCount,aggregatedVoteCounts:voteCounts});return response(ctx,request,{ok:failedCount===0,reportRecordId:recordId,dispatchId,reportHash,recipientCount:recipientRows.length,sentCount,failedCount,status:failedCount?"Partially Failed":"Sent"});}
if(pathname==="/api/meeting-media/token"){const c=await liveContext(ctx,env,token,claims,clean(data.meetingId),data);const key=clean(env.LIVEKIT_API_KEY),secret=clean(env.LIVEKIT_API_SECRET),url=clean(env.LIVEKIT_URL);if(!key||!secret||!url)return fail(ctx,request,"Live meeting infrastructure is not configured in Cloudflare secrets.",503);const authority=clean(data.selectedAuthority),room=await roomName(c.meeting.id),identity="uid-"+c.uid,now=Math.floor(Date.now()/1000),moderator=meetingRoleAssigned(c.meeting,c.uid,"administrator")||(transitionCommitteeActive(c.meeting)&&meetingRoleAssigned(c.meeting,c.uid,"transitionAdministrator"));const jwt=await signedJwt(key,secret,{iss:key,sub:identity,name:clean(c.meeting.displayName||c.meeting.title||"IRPA participant"),nbf:now-5,exp:now+600,video:{roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true,roomAdmin:false}});const sessionId=crypto.randomUUID();await writeDoc(ctx,env,token,"liveMeetingSessions",sessionId,{meetingId:c.meeting.id,meetingReference:clean(c.meeting.reference||c.meeting.title),roomName:room,participantUid:c.uid,participantIdentity:identity,participantAuthority:moderator?"Meeting Administrator":authority||"Meeting Participant",moderator,recordingPolicy:c.meeting.recordingAllowed===true?"Allowed by meeting record":"Not enabled",createdByUid:c.uid,createdAt:new Date(),status:"Token Issued",tokenTtl:"10m",mediaEngine:"LiveKit",mediaEndpoint:url,governanceAuthorityRemainsIRPA:true},false);await audit(ctx,env,token,claims,"LIVE_MEETING_TOKEN_ISSUED",c.meeting,sessionId,{roomName,participantAuthority:moderator?"Meeting Administrator":authority||"Meeting Participant",moderator,tokenTtl:"10m",mediaEngine:"LiveKit"});return response(ctx,request,{ok:true,sessionId,serverUrl:url,participantToken:jwt,moderator,recordingAllowed:c.meeting.recordingAllowed===true,expiresInSeconds:600});}
if(pathname==="/api/meeting-media/moderate"){const c=await liveContext(ctx,env,token,claims,clean(data.meetingId),data);const authorised=meetingRoleAssigned(c.meeting,c.uid,"administrator")||(transitionCommitteeActive(c.meeting)&&meetingRoleAssigned(c.meeting,c.uid,"transitionAdministrator"));if(!authorised)return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may moderate live participants.",403);const action=clean(data.action).toUpperCase(),target=clean(data.identity);if(!["MUTE_MICROPHONE","REMOVE_PARTICIPANT"].includes(action)||!target.startsWith("uid-")||target==="uid-"+c.uid)return fail(ctx,request,"Choose a valid participant moderation action and target.",400);const room=await roomName(c.meeting.id);const roster=await liveKitRequest(env,"/twirp/livekit.RoomService/ListParticipants",{room});const participant=(Array.isArray(roster.participants)?roster.participants:[]).find(row=>clean(row.identity)===target);if(!participant)return fail(ctx,request,"The selected participant is not currently connected to this meeting room.",404);if(action==="REMOVE_PARTICIPANT"){await liveKitRequest(env,"/twirp/livekit.RoomService/RemoveParticipant",{room,identity:target});}else{const audioTrack=(Array.isArray(participant.tracks)?participant.tracks:[]).find(track=>String(track.type||"").toUpperCase()==="AUDIO");if(!audioTrack?.sid)return fail(ctx,request,"The selected participant has no active microphone track to mute.",409);await liveKitRequest(env,"/twirp/livekit.RoomService/MutePublishedTrack",{room,identity:target,track_sid:audioTrack.sid,muted:true});}await audit(ctx,env,token,claims,"MEETING_LIVE_PARTICIPANT_"+action,c.meeting,target,{action,targetIdentity:target,meetingAdministratorUid:c.uid});return response(ctx,request,{ok:true,action,identity:target});}
if(pathname==="/api/meeting-media/recording/start"||pathname==="/api/meeting-media/recording/stop"||pathname==="/api/meeting-media/recording/status"){const c=await liveContext(ctx,env,token,claims,clean(data.meetingId),data);const controller=meetingRoleAssigned(c.meeting,c.uid,"administrator")||(transitionCommitteeActive(c.meeting)&&meetingRoleAssigned(c.meeting,c.uid,"transitionAdministrator"));if(!controller)return fail(ctx,request,"Only the Meeting Administrator appointed to this meeting may control recording.",403);if(c.meeting.recordingAllowed!==true)return fail(ctx,request,"Recording is not enabled in the authoritative meeting record.",403);const rows=await listByField(ctx,env,token,"meetingMediaRecordings","meetingId",c.meeting.id);if(pathname.endsWith("/status")){const current=rows.filter(r=>["STARTING","RECORDING","STOPPING"].includes(clean(r.recordingStatus))).sort((a,b)=>String(b.startedAt||"").localeCompare(String(a.startedAt||"")))[0]||rows.sort((a,b)=>String(b.startedAt||"").localeCompare(String(a.startedAt||"")))[0]||null;return response(ctx,request,{ok:true,recordingAllowed:c.meeting.recordingAllowed===true,recordingStatus:clean(c.meeting.recordingStatus)||(current?.recordingStatus)||"NOT_STARTED",recording:current?{...current,files:current.fileResults||[]}:null,recordings:rows});}if(pathname.endsWith("/start")){if(rows.some(r=>["STARTING","RECORDING","STOPPING"].includes(clean(r.recordingStatus))))return fail(ctx,request,"A recording is already active or stopping for this meeting.",409);const room=await roomName(c.meeting.id),stamp=new Date().toISOString().replace(/[:.]/g,"-"),filepath="irpa-governance-recordings/"+c.meeting.id.replace(/[^a-zA-Z0-9_-]/g,"_")+"/"+stamp+".mp4";const output=createR2RecordingOutput(env,filepath,c.meeting);const e=await liveKitRequest(env,"/twirp/livekit.Egress/StartRoomCompositeEgress",{room_name:room,file_outputs:[output],layout:"grid",audio_only:false});const id=clean(e.egress_id||e.egressId);if(!id)return fail(ctx,request,"LiveKit did not return a recording identifier.",502);await writeDoc(ctx,env,token,"meetingMediaRecordings",id,{meetingId:c.meeting.id,meetingReference:clean(c.meeting.meetingReference||c.meeting.reference||c.meeting.title),meetingTitle:clean(c.meeting.title),meetingCategory:c.category,roomName:room,egressId:id,outputPath:filepath,recordingStatus:"RECORDING",egressStatus:clean(e.status)||"EGRESS_STARTING",recordingProvider:"LIVEKIT_EGRESS",storageDestination:"CLOUDFLARE_R2",startedByUid:c.uid,startedByEmail:c.email||null,startedAt:new Date(),createdAt:new Date(),updatedAt:new Date()},false);await patchDoc(ctx,env,token,"meetings",c.meeting.id,{recordingStatus:"RECORDING",recordingEgressId:id,recordingStartedAt:new Date(),recordingStartedByUid:c.uid,recordingStorage:"LIVEKIT_EGRESS_CONFIGURED_STORAGE"});await audit(ctx,env,token,claims,"LIVE_MEETING_RECORDING_STARTED",c.meeting,id,{egressId:id,outputPath:filepath,storageDestination:"CLOUDFLARE_R2"});return response(ctx,request,{ok:true,recordingId:id,egressId:id,recordingStatus:"RECORDING",outputPath:filepath,storageDestination:"CLOUDFLARE_R2"});}
const recordingId=clean(data.recordingId||data.egressId),row=await getDoc(ctx,env,token,"meetingMediaRecordings",recordingId);if(!row||row.meetingId!==c.meeting.id)return fail(ctx,request,"Recording does not belong to this meeting.",404);if(!["RECORDING","STARTING","STOPPING"].includes(clean(row.recordingStatus)))return fail(ctx,request,"This recording is not active.",409);const e=await liveKitRequest(env,"/twirp/livekit.Egress/StopEgress",{egress_id:recordingId});const status=Number(e.status)===3?"COMPLETED":Number(e.status)>=4?"FAILED":Number(e.status)===2?"STOPPING":"STOPPING";const files=(e.file_results||[]).map(f=>({filename:clean(f.filename),location:clean(f.location),size:Number(f.size||0)}));await patchDoc(ctx,env,token,"meetingMediaRecordings",recordingId,{recordingStatus:status,egressStatus:clean(e.status),fileResults:files,stoppedByUid:c.uid,stoppedByEmail:c.email||null,stopRequestedAt:new Date(),updatedAt:new Date()});await patchDoc(ctx,env,token,"meetings",c.meeting.id,{recordingStatus:status,recordingStoppedAt:new Date(),recordingStoppedByUid:c.uid});await audit(ctx,env,token,claims,"LIVE_MEETING_RECORDING_STOP_REQUESTED",c.meeting,recordingId,{recordingStatus:status,fileCount:files.length});return response(ctx,request,{ok:true,recordingId,recordingStatus:status,egressStatus:clean(e.status),fileResults:files});}
return fail(ctx,request,"Meeting service is not supported.",404);
}catch(error){const status=Number(error?.status)||500;console.error("MEETING_SERVICE_FAILURE",{path:pathname,uid:clean(claims?.user_id),status,message:clean(error?.message).slice(0,180)});return fail(ctx,request,status===401?"A valid IRPA sign-in is required.":status===403?"You are not authorised to perform this meeting operation.":status===404?"The requested meeting record was not found.":status===409?clean(error.message):"The meeting service could not complete this request. Verify service configuration and retry.",status>=400&&status<600?status:503);}
};}
