export async function closeVotingIssue(votingIssueId,result="Pending"){if(!votingIssueId)throw new Error("A voting issue is required.");const ref=doc(db,COLLECTIONS.votingIssues,votingIssueId);const resultValue=["Passed","Rejected","Pending"].includes(result)?result:"Pending";let issue;await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error("Voting issue not found.");issue=snap.data();if(issue.status!=="Open")throw new Error("This voting issue is already closed.");tx.update(ref,{status:"Closed",result:resultValue,closedAt:serverTimestamp(),updatedAt:serverTimestamp()});if(issue.resolutionId){const resolutionRef=doc(db,COLLECTIONS.resolutions,issue.resolutionId);const resolutionSnap=await tx.get(resolutionRef);if(!resolutionSnap.exists())throw new Error("The linked resolution no longer exists.");tx.update(resolutionRef,{status:resultValue,votingStatus:"Completed",votingResult:resultValue,votingIssueId,updatedAt:serverTimestamp()});}});await writeAudit("VOTING_ISSUE_CLOSED",COLLECTIONS.votingIssues,votingIssueId,{result:resultValue,resolutionId:issue?.resolutionId||null});return resultValue;}
export async function createVoteCorrection({voteId,reason,correctionNote}){if(!voteId||!reason?.trim()||!correctionNote?.trim())throw new Error("Vote, correction reason and correction note are required.");const ref=doc(collection(db,COLLECTIONS.voteCorrections));const auditRef=doc(collection(db,COLLECTIONS.audit));await runTransaction(db,async tx=>{const voteSnap=await tx.get(doc(db,COLLECTIONS.votes,voteId));if(!voteSnap.exists())throw new Error("The original vote could not be found.");tx.set(ref,{voteId,reason:reason.trim(),correctionNote:correctionNote.trim(),originalVotePreserved:true,auditRequired:true,requestedByUid:auth.currentUser?.uid||null,requestedAt:serverTimestamp(),status:"Administrative Review",createdAt:serverTimestamp()});tx.set(auditRef,auditData("VOTE_CORRECTION_REQUEST_CREATED",COLLECTIONS.voteCorrections,ref.id,{voteId,reason:reason.trim(),originalVotePreserved:true,auditRequired:true}));});return ref.id;}
export async function updateRecord(collectionName,id,data){await updateDoc(doc(db,collectionName,id),{...data,updatedAt:serverTimestamp()});await writeAudit("UPDATE",collectionName,id,data);}
export async function processPaymentRequest(id,changes){const actor=currentActor();await updateDoc(doc(db,COLLECTIONS.staffPaymentRequests,id),{...changes,actionByUid:actor.uid,actionByEmail:actor.email,actionAt:serverTimestamp(),updatedAt:serverTimestamp()});await writeAudit("PAYMENT_WORKFLOW_ACTION",COLLECTIONS.staffPaymentRequests,id,{...changes,actorUid:actor.uid,actorEmail:actor.email});}
export async function deleteRecord(collectionName,id){await deleteDoc(doc(db,collectionName,id));await writeAudit("DELETE",collectionName,id);}
export async function getAdminProfile(uid){return uid?getRecord(COLLECTIONS.adminProfiles,uid):null;}
export async function getCurrentMemberProfile(){const uid=auth.currentUser?.uid;return uid?getRecord(COLLECTIONS.members,uid):null;}
export async function getCurrentEmployeeProfile(){const uid=auth.currentUser?.uid;return uid?getRecord(COLLECTIONS.employees,uid):null;}

export async function getCurrentInductionContext(){
  const uid=auth.currentUser?.uid;
  const email=String(auth.currentUser?.email||"").trim().toLowerCase();
  if(!uid||!email) throw new Error("Authentication is required to load the induction form.");

  const [member,employee,existingRequest]=await Promise.all([
    getRecord(COLLECTIONS.members,uid),
    getRecord(COLLECTIONS.employees,uid),
    getRecord(COLLECTIONS.registrationRequests,uid)
  ]);

  const invitationSnap=await getDocs(query(
    collection(db,COLLECTIONS.invitations),
    where("email","==",email)
  ));
  const invitations=invitationSnap.docs.map(x=>({id:x.id,...x.data()}));
  const invitationId=String(member?.invitationId||employee?.invitationId||existingRequest?.invitationId||"").trim();
  const invitation=invitations.find(x=>x.id===invitationId)||invitations[0]||null;

  const roles=[...(Array.isArray(employee?.roles)?employee.roles:[]),...(Array.isArray(member?.roles)?member.roles:[]),employee?.role,member?.role,invitation?.role]
    .flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
  const uniqueRoles=[...new Set(roles)];
  const fullName=String(employee?.name||member?.name||invitation?.name||auth.currentUser?.displayName||"").trim();
  const department=String(employee?.department||member?.department||invitation?.department||"").trim();
  const unit=String(employee?.unit||member?.unit||invitation?.unit||"").trim();
  const registrationNumber=String(employee?.employeeNumber||member?.memberNumber||invitation?.registrationNumber||"").trim();
  const boardMember=Boolean(member?.boardMember||employee?.boardMember||uniqueRoles.some(r=>/board member/i.test(r)));
  const accountTypeOptions=[...(employee?["Employee"]:[]),...(member?["Member"]:[])];
  const accountType=accountTypeOptions.length===2?"Employee & Member":(accountTypeOptions[0]||"");
  if(!member&&!employee&&!invitation) throw new Error("No matching IRPA registration or invitation record could be retrieved for this account. The induction application is blocked.");

  return {
    uid,email,fullName,roles:uniqueRoles,role:uniqueRoles.join(" • "),department,unit,registrationNumber,accountType,accountTypeOptions,
    memberType:member?.memberType||invitation?.memberType||"",
    employmentType:employee?.employmentType||invitation?.employmentType||"",
    boardMember,
    member,employee,invitation,invitations,
    invitationId:invitation?.id||invitationId||null,
    existingRequest
  };
}

export async function submitInductionApplication(form,context){
  const uid=auth.currentUser?.uid;
  if(!uid||uid!==context?.uid) throw new Error("Authenticated registration identity could not be verified.");
  if(!context?.roles?.length) throw new Error("No registered role could be retrieved. The induction application is blocked.");
  if(context.existingRequest?.status==="Linked"||context.existingRequest?.roleAssignmentStatus==="Linked") {
    return {alreadyLinked:true,requestId:uid};
  }

  const submittedAt=serverTimestamp();
  const payload={
    uid,
    email:context.email,
    fullName:context.fullName,
    memberProfileUid:context.member?.uid||uid,
    employeeProfileUid:context.employee?.uid||uid,
    memberEmployeeNumber:null,
    registrationNumberStatus:"Issued after administrator LINK",
    invitationId:context.invitationId||null,
    invitationReference:context.invitation?.invitationReference||context.invitation?.reference||null,
    invitationStatus:context.invitation?"Registered invitation":"Registered account",
    systemRoles:context.roles,
    systemRole:context.role,
    systemDepartment:context.department||null,
    systemUnit:context.unit||null,
    boardMember:context.boardMember,
    accountType:String(form.accountType||context.accountType||"").trim(),
    requestedRole:String(form.primaryRole||context.role).trim(),
    requestedDepartment:String(form.department||context.department).trim(),
    requestedUnit:String(form.unit||context.unit).trim(),
    employmentType:String(form.employmentType||context.employmentType||"").trim(),
    orientationModules:Array.isArray(form.orientationModules)?form.orientationModules:[],
    answers:{
      identityConfirmation:form.identityConfirmation||"",
      accountType:form.accountType||"",
      primaryRole:form.primaryRole||"",
      department:form.department||"",
      unit:form.unit||"",
      employmentType:form.employmentType||"",
      orientationModules:Array.isArray(form.orientationModules)?form.orientationModules:[],
      q1:form.q1||"",
      q2:form.q2||"",
      q3:form.q3||"",
      comments:String(form.comments||"").trim()
    },
    completedSteps:Array.isArray(form.completedSteps)?form.completedSteps:[],
    declaration:form.declaration===true,
    status:"Pending Department & Unit Review",
    roleAssignmentStatus:"Pending",
    inductionStatus:"Submitted",