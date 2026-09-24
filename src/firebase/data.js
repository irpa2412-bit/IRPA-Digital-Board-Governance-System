import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, serverTimestamp, updateDoc, setDoc, where, } from "firebase/firestore";
import { auth, db, applicantAuth, applicantDb, applicantApp } from "./config";
import { sendEmployeeRegistrationEmail } from "./auth";
import { getFunctions, httpsCallable } from "firebase/functions";

const uniqueInductionValues=(values)=>[...new Set(values.flatMap(v=>Array.isArray(v)?v:String(v||"").split(",")).map(v=>String(v||"").trim()).filter(Boolean))];

export const COLLECTIONS={members:"members",employees:"employees",employeeCounters:"employeeCounters",memberCounters:"memberCounters",participants:"participants",meetings:"meetings",meetingSubscriptions:"meetingSubscriptions",meetingRoomEvents:"meetingRoomEvents",transcriptions:"transcriptions",resolutions:"resolutions",votes:"votes",voteLocks:"voteLocks",voteCorrections:"voteCorrections",votingIssues:"votingIssues",actions:"actions",documents:"documents",signatures:"signatures",decisions:"decisions",risks:"risks",audit:"audit",reports:"reports",authorizationRequests:"authorizationRequests",workflowActions:"workflowActions",staffPaymentRequests:"staffPaymentRequests",financeBudgets:"financeBudgets",financeTransactions:"financeTransactions",financeFunding:"financeFunding",financeApprovals:"financeApprovals",financeCommitments:"financeCommitments",financeGrants:"financeGrants",financeBankAccounts:"financeBankAccounts",financeReconciliations:"financeReconciliations",financeAssets:"financeAssets",financeRisks:"financeRisks",financeReports:"financeReports",financePaymentTrace:"financePaymentTrace",procurementVendors:"procurementVendors",procurementRequests:"procurementRequests",procurementVendorScores:"procurementVendorScores",procurementVendorBlacklist:"procurementVendorBlacklist",procurementVendorProbation:"procurementVendorProbation",invitations:"invitations",registrationRequests:"registrationRequests",inductionRecords:"inductionRecords",adminProfiles:"adminProfiles",systemSettings:"systemSettings",mail:"mail"};
function currentActor(){return{uid:auth.currentUser?.uid||null,email:auth.currentUser?.email||null};}
async function writeAudit(action,collectionName,recordId,details={}){const a=currentActor();const anonymous=action.startsWith("ANONYMOUS_VOTE_");await addDoc(collection(db,COLLECTIONS.audit),{action,collection:collectionName,recordId,details,actorUid:anonymous?null:a.uid,actorEmail:anonymous?null:a.email,createdAt:serverTimestamp()});}
function auditData(action,collectionName,recordId,details={}){const a=currentActor();const anonymous=action.startsWith("ANONYMOUS_VOTE_");return{action,collection:collectionName,recordId,details,actorUid:anonymous?null:a.uid,actorEmail:anonymous?null:a.email,createdAt:serverTimestamp()};}
export async function createRecord(collectionName,data){const protectedData=collectionName===COLLECTIONS.documents?{...data,recordOrigin:data.recordOrigin||"PRODUCTION"}:data;const ref=await addDoc(collection(db,collectionName),{...protectedData,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await writeAudit("CREATE",collectionName,ref.id,protectedData);return ref.id;}
export async function upsertFinancePaymentTrace(traceId,data={}){if(!auth.currentUser)throw new Error("Authentication is required.");if(!traceId)throw new Error("A finance trace ID is required.");const ref=doc(db,COLLECTIONS.financePaymentTrace,traceId);const existing=await getDoc(ref);const actor=currentActor();const payload={...data,lastUpdatedByUid:actor.uid,lastUpdatedByEmail:actor.email,updatedAt:serverTimestamp()};if(!existing.exists()){payload.createdAt=serverTimestamp();payload.createdByUid=actor.uid;payload.createdByEmail=actor.email;await setDoc(ref,payload);await writeAudit("CREATE_FINANCE_PAYMENT_TRACE",COLLECTIONS.financePaymentTrace,traceId,data);}else{await updateDoc(ref,payload);await writeAudit("UPDATE_FINANCE_PAYMENT_TRACE",COLLECTIONS.financePaymentTrace,traceId,data);}return traceId;}
async function getHighestRegistrationNumber(collectionName,fieldName){const snap=await getDocs(collection(db,collectionName));let highest=0;for(const item of snap.docs){const value=Number(String(item.data()?.[fieldName]||"").split("-").pop());if(Number.isInteger(value)&&value>highest)highest=value;}return highest;}
async function requireActiveAdmin(){const user=auth.currentUser;if(!user?.uid)throw new Error("Authentication is required.");const email=String(user.email||"").trim().toLowerCase();if(email==="irpa2412@gmail.com")return user.uid;const snap=await getDoc(doc(db,COLLECTIONS.adminProfiles,user.uid));if(!snap.exists()||snap.data()?.active!==true)throw new Error("Administrator authorization is required.");return user.uid;}
async function deleteCollectionRecords(collectionName,predicate=()=>true){const snap=await getDocs(collection(db,collectionName));let deleted=0;for(const item of snap.docs){if(predicate(item.data())){await deleteDoc(item.ref);deleted++;}}return deleted;}
export async function createExternalAuditorProfile(data={}){await requireActiveAdmin();const email=String(data.email||"").trim().toLowerCase();const name=String(data.name||"").trim();if(!email||!email.includes("@"))throw new Error("A valid external auditor email is required.");if(!name)throw new Error("External auditor name is required.");const ref=doc(db,"auditorProfiles",email);await setDoc(ref,{email,name,role:"External Auditor",active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdByUid:auth.currentUser?.uid||null},{merge:true});await writeAudit("CREATE_EXTERNAL_AUDITOR_PROFILE","auditorProfiles",email,{email,name,active:true});return{email,name};}
export async function resetDocumentTrialData(){const uid=await requireActiveAdmin();const recordsDeleted=await deleteCollectionRecords(COLLECTIONS.documents,(data)=>String(data?.recordOrigin||"").toUpperCase()==="TRIAL"||data?.trialData===true||data?.isTrial===true);await writeAudit("ADMIN_RESET_DOCUMENT_TRIAL_DATA",COLLECTIONS.documents,"TRIAL_RESET",{recordsDeleted,trialOnly:true,signatureProfilesUntouched:true,adminUid:uid});return{recordsDeleted,trialOnly:true,signatureProfilesUntouched:true};}
export async function resetEmployeeTrialData(){const uid=await requireActiveAdmin();const recordsDeleted=await deleteCollectionRecords(COLLECTIONS.employees,(data)=>String(data?.recordOrigin||"").toUpperCase()==="TRIAL"||data?.trialData===true||data?.isTrial===true);await writeAudit("ADMIN_RESET_EMPLOYEE_TRIAL_DATA",COLLECTIONS.employees,"TRIAL_RESET",{recordsDeleted,counterReset:false,trialOnly:true,adminUid:uid});return{recordsDeleted,trialOnly:true};}
export async function resetMemberTrialData(){const uid=await requireActiveAdmin();const recordsDeleted=await deleteCollectionRecords(COLLECTIONS.members,(data)=>(String(data?.recordOrigin||"").toUpperCase()==="TRIAL"||data?.trialData===true||data?.isTrial===true)&&!(data?.boardMember===true||data?.role==="Board Member"||data?.boardPosition));await writeAudit("ADMIN_RESET_MEMBER_TRIAL_DATA",COLLECTIONS.members,"TRIAL_RESET",{recordsDeleted,counterReset:false,boardMembersPreserved:true,trialOnly:true,adminUid:uid});return{recordsDeleted,boardMembersPreserved:true,trialOnly:true};}
export async function resetSignatureEnvelopeTrialData(){const uid=await requireActiveAdmin();const envelopeSnap=await getDocs(collection(db,"signatureEnvelopes"));const trialEnvelopeIds=envelopeSnap.docs.filter(item=>{const data=item.data()||{};return String(data?.recordOrigin||"").toUpperCase()==="TRIAL"||data?.trialData===true||data?.isTrial===true;}).map(item=>item.id);const trialDocumentIds=new Set();for(const item of envelopeSnap.docs){if(trialEnvelopeIds.includes(item.id)&&item.data()?.documentId)trialDocumentIds.add(String(item.data().documentId));}const signatureSnap=await getDocs(collection(db,COLLECTIONS.signatures));let signaturesDeleted=0;for(const item of signatureSnap.docs){if(trialEnvelopeIds.includes(String(item.data()?.envelopeId||""))){await deleteDoc(item.ref);signaturesDeleted++;}}const eventSnap=await getDocs(collection(db,"signatureEvents"));let eventsDeleted=0;for(const item of eventSnap.docs){if(trialEnvelopeIds.includes(String(item.data()?.envelopeId||""))){await deleteDoc(item.ref);eventsDeleted++;}}let envelopesDeleted=0;for(const id of trialEnvelopeIds){await deleteDoc(doc(db,"signatureEnvelopes",id));envelopesDeleted++;}const documentSnap=await getDocs(collection(db,COLLECTIONS.documents));let documentsDeleted=0;for(const item of documentSnap.docs){const data=item.data()||{};const isTrialDocument=String(data?.recordOrigin||"").toUpperCase()==="TRIAL"||data?.trialData===true||data?.isTrial===true;const linkedToTrialEnvelope=trialDocumentIds.has(item.id)||trialEnvelopeIds.includes(String(data?.signatureEnvelopeId||""));if(isTrialDocument||linkedToTrialEnvelope){await deleteDoc(item.ref);documentsDeleted++;}}await writeAudit("ADMIN_RESET_SIGNATURE_ENVELOPE_TRIAL_DATA","TRIAL_ENVELOPE_RESET","TRIAL_RESET",{envelopesDeleted,signaturesDeleted,eventsDeleted,documentsDeleted,pendingSigningCleared:envelopesDeleted>0,controlledDocumentsCleared:documentsDeleted>0,trialOnly:true,adminUid:uid});return{envelopesDeleted,signaturesDeleted,eventsDeleted,documentsDeleted,pendingSigningCleared:true,controlledDocumentsCleared:true,trialOnly:true};}
export async function generateMemberNumber(){const highestExisting=await getHighestRegistrationNumber(COLLECTIONS.members,"memberNumber");const ref=doc(db,COLLECTIONS.memberCounters,"members");return runTransaction(db,async tx=>{const snap=await tx.get(ref);const counterNext=snap.exists()?Number(snap.data().nextNumber||1):1;const next=Math.max(counterNext,highestExisting+1);tx.set(ref,{nextNumber:next+1,currentNumber:next,updatedAt:serverTimestamp(),source:"automatic-from-existing-member-numbers"},{merge:true});return`IRPA-MEM-${String(next).padStart(5,"0")}`;});}
export async function createMemberRegistration(data){const memberNumber=await generateMemberNumber();const ref=await addDoc(collection(db,COLLECTIONS.members),{...data,memberNumber,recordOrigin:String(data.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION",trialData:String(data.recordOrigin||"").toUpperCase()==="TRIAL"||data.trialData===true,memberType:data.memberType||"Governance Member",registrationStatus:data.registrationStatus||"Registered",registrationDate:serverTimestamp(),registeredByUid:auth.currentUser?.uid||null,registeredByEmail:auth.currentUser?.email||null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await writeAudit("MEMBER_REGISTRATION_SUCCESS",COLLECTIONS.members,ref.id,{memberNumber,name:data.name||"",email:data.email||"",numberAssignment:"automatic"});return{memberNumber,id:ref.id};}
export async function repairBoardMemberRegistration(id){if(!id)throw new Error("A Board Member record ID is required.");const uid=auth.currentUser?.uid;if(!uid)throw new Error("Authentication is required.");const adminSnap=await getDoc(doc(db,COLLECTIONS.adminProfiles,uid));if(!adminSnap.exists()||adminSnap.data()?.active!==true)throw new Error("Administrator authorization is required.");const ref=doc(db,COLLECTIONS.members,id);const snap=await getDoc(ref);if(!snap.exists())throw new Error("The Board Member record could not be found.");const data=snap.data();if(data.memberNumber)return data.memberNumber;const memberNumber=await generateMemberNumber();await updateDoc(ref,{memberNumber,memberType:data.memberType||"Board Member",boardMember:true,registrationStatus:data.registrationStatus||"Registered — Account Pending",updatedAt:serverTimestamp()});await writeAudit("REPAIR_BOARD_MEMBER_REGISTRATION_NUMBER",COLLECTIONS.members,id,{memberNumber,legacyEmployeeNumber:data.employeeNumber||null});return memberNumber;}
export async function createMemberProfile(uid,data){if(!uid)throw new Error("A Firebase Authentication UID is required.");const existing=await getRecord(COLLECTIONS.members,uid);const memberNumber=existing?.memberNumber||data.memberNumber||await generateMemberNumber();await setDoc(doc(db,COLLECTIONS.members,uid),{...data,uid,memberNumber,memberType:data.memberType||"Governance Member",createdAt:data.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});await writeAudit(existing?"UPDATE_MEMBER_PROFILE":"CREATE_MEMBER_PROFILE",COLLECTIONS.members,uid,{...data,uid,memberNumber});return uid;}
export async function generateEmployeeNumber(){const highestExisting=await getHighestRegistrationNumber(COLLECTIONS.employees,"employeeNumber");const ref=doc(db,COLLECTIONS.employeeCounters,"employees");return runTransaction(db,async tx=>{const snap=await tx.get(ref);const counterNext=snap.exists()?Number(snap.data().nextNumber||1):1;const next=Math.max(counterNext,highestExisting+1);tx.set(ref,{nextNumber:next+1,currentNumber:next,updatedAt:serverTimestamp(),source:"automatic-from-existing-employee-numbers"},{merge:true});return`IRPA-EMP-${String(next).padStart(5,"0")}`;});}
export async function createEmployee(data){const cleanEmail=(data.email||"").trim().toLowerCase();if(!cleanEmail)throw new Error("Official Email is required.");const duplicateQuery=await getDocs(query(collection(db,COLLECTIONS.employees),where("email","==",cleanEmail)));if(!duplicateQuery.empty){const existing=duplicateQuery.docs[0];const existingData=existing.data();await writeAudit("DUPLICATE_EMPLOYEE_REGISTRATION_BLOCKED",COLLECTIONS.employees,existing.id,{employeeNumber:existingData.employeeNumber||null,email:cleanEmail});throw new Error(`An employee is already registered with ${cleanEmail}. Employee Number: ${existingData.employeeNumber||"not available"}. No new Employee Number was generated.`);}const employeeNumber=await generateEmployeeNumber();const ref=await addDoc(collection(db,COLLECTIONS.employees),{...data,email:cleanEmail,uid:data.uid||null,employeeNumber,recordOrigin:String(data.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION",trialData:String(data.recordOrigin||"").toUpperCase()==="TRIAL"||data.trialData===true,status:data.employmentStatus||data.status||"Active",registrationStatus:"Registered",registrationDate:serverTimestamp(),registeredByUid:auth.currentUser?.uid||null,registeredByEmail:auth.currentUser?.email||null,registrationEmailStatus:"Pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await writeAudit("EMPLOYEE_REGISTRATION_SUCCESS",COLLECTIONS.employees,ref.id,{employeeNumber,email:cleanEmail,registrationEmailStatus:"Pending",numberAssignment:"automatic"});try{const emailResult=await sendEmployeeRegistrationEmail(cleanEmail,employeeNumber);await updateDoc(ref,{registrationEmailStatus:"Queued",registrationEmailQueuedAt:serverTimestamp(),registrationEmailError:null,registrationEmailProvider:"Firebase Authentication",registrationEmailAccountCreated:emailResult.accountCreated,updatedAt:serverTimestamp()});await writeAudit("EMPLOYEE_REGISTRATION_EMAIL_QUEUED",COLLECTIONS.employees,ref.id,{employeeNumber,email:cleanEmail,provider:"Firebase Authentication",accountCreated:emailResult.accountCreated});return{employeeNumber,id:ref.id,registrationEmailStatus:"Queued",emailResult};}catch(error){await updateDoc(ref,{registrationEmailStatus:"Failed",registrationEmailError:error.message||"Unable to send registration email",updatedAt:serverTimestamp()});await writeAudit("EMPLOYEE_REGISTRATION_EMAIL_FAILED",COLLECTIONS.employees,ref.id,{employeeNumber,email:cleanEmail,error:error.message||"Unable to send registration email"});return{employeeNumber,id:ref.id,registrationEmailStatus:"Failed",registrationEmailError:error.message||"Unable to send registration email"};}}
export async function retryEmployeeRegistrationEmail(employee){if(!employee?.id||!employee.employeeNumber)throw new Error("A valid employee record is required.");if(!employee.email)throw new Error("This employee has no official email address.");const emailResult=await sendEmployeeRegistrationEmail(employee.email,employee.employeeNumber);await updateDoc(doc(db,COLLECTIONS.employees,employee.id),{registrationEmailStatus:"Queued",registrationEmailQueuedAt:serverTimestamp(),registrationEmailError:null,registrationEmailProvider:"Firebase Authentication",registrationEmailAccountCreated:emailResult.accountCreated,updatedAt:serverTimestamp()});await writeAudit("RETRY_EMPLOYEE_REGISTRATION_EMAIL",COLLECTIONS.employees,employee.id,{employeeNumber:employee.employeeNumber,email:employee.email,provider:"Firebase Authentication",accountCreated:emailResult.accountCreated});return emailResult;}
export async function updateEmployee(id,data){if(!id)throw new Error("An employee record ID is required.");const existing=await getRecord(COLLECTIONS.employees,id);if(!existing)throw new Error("The employee record could not be found.");const email=data.email?.trim().toLowerCase();if(email&&email!==String(existing.email||"").toLowerCase()){const q=await getDocs(query(collection(db,COLLECTIONS.employees),where("email","==",email)));if(q.docs.some(x=>x.id!==id))throw new Error(`Another employee is already registered with ${email}.`);}const changes={name:data.name,email,role:data.role,department:data.department,employmentType:data.employmentType,status:data.status,phone:data.phone,startDate:data.startDate,updatedAt:serverTimestamp()};await updateDoc(doc(db,COLLECTIONS.employees,id),changes);await writeAudit("UPDATE_EMPLOYEE_PROFILE",COLLECTIONS.employees,id,{...changes,employeeNumber:existing.employeeNumber});}
export async function createEmployeeProfile(data){const uid=data.uid||auth.currentUser?.uid;if(!uid)throw new Error("A Firebase Authentication UID is required.");const existing=await getRecord(COLLECTIONS.employees,uid);if(existing)return existing;const email=data.email?.trim().toLowerCase();if(email){const q=await getDocs(query(collection(db,COLLECTIONS.employees),where("email","==",email)));if(!q.empty)return q.docs[0]&&{id:q.docs[0].id,...q.docs[0].data()};}const employeeNumber=data.employeeNumber||await generateEmployeeNumber();await setDoc(doc(db,COLLECTIONS.employees,uid),{...data,uid,email,employeeNumber,status:data.status||"Active",createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:false});await writeAudit("CREATE_EMPLOYEE_PROFILE",COLLECTIONS.employees,uid,{employeeNumber,role:data.role||"",department:data.department||""});return getRecord(COLLECTIONS.employees,uid);}
export async function provisionCurrentMemberFromInvitation(invitationId){const uid=auth.currentUser?.uid;const email=auth.currentUser?.email?.trim().toLowerCase();if(!uid||!email||!invitationId)return null;const invitation=await getRecord(COLLECTIONS.invitations,invitationId);if(!invitation)throw new Error("The member invitation could not be found.");if(invitation.email?.trim().toLowerCase()!==email)throw new Error("This invitation is not assigned to the authenticated email address.");if(invitation.status==="Cancelled")throw new Error("This member invitation has been cancelled.");const role=invitation.role||"Board Member";const memberType=invitation.memberType||"Governance Member";const member=await createMemberProfile(uid,{invitationId,email,name:invitation.name||"",role,memberType,status:"Active"});const employeeRoles=["Executive Director","Director Human Resources","HR Manager","Director Finance & Administration","Finance Personnel","Finance Manager","Accountant","Finance Officer","Director Internal Oversight","Internal Oversight Officer","Secretariat","Procurement Officer","Programme/Technical Officer","Management","Operations Manager","Rangeland Officer","Livestock Officer","Outreach Officer","Community Development Officer","Environment Officer","HR Officer","Employee"];if(employeeRoles.includes(role))await createEmployeeProfile({uid,email,name:invitation.name||"",role,department:invitation.department||"",employmentType:invitation.employmentType||"Employee",status:"Active",invitationId});return member;}
export async function getRecord(collectionName,id){const s=await getDoc(doc(db,collectionName,id));return s.exists()?{id:s.id,...s.data()}:null;}
export async function getRecords(collectionName){const s=await getDocs(query(collection(db,collectionName),orderBy("createdAt","desc")));return s.docs.map(x=>({id:x.id,...x.data()}));}

// Signing uses a dedicated document read path rather than the generic ordered
// query. This keeps the Signature Portal resilient to legacy document records
// that may not contain createdAt, while preserving the existing Firestore
// authorization rules on the documents collection.
export async function getControlledDocumentsForSigning(){
  if(!auth.currentUser)throw new Error("Authentication is required.");
  const uid=auth.currentUser.uid;
  const queries=[
    query(collection(db,COLLECTIONS.documents),where("authorizedUids","array-contains",uid)),
    query(collection(db,COLLECTIONS.documents),where("uploadedByUid","==",uid))
  ];
  const results=await Promise.all(queries.map(async q=>{
    const snap=await getDocs(q);
    return snap.docs.map(x=>({id:x.id,...x.data()}));
  }));
  const byId=new Map(results.flat().map(d=>[d.id,d]));
  const usable=[...byId.values()].filter(d=>{
    if(String(d?.recordOrigin||"PRODUCTION").toUpperCase()==="TRIAL"||d?.trialData===true||d?.isTrial===true)return false;
    const contentType=String(d?.contentType||"application/pdf").toLowerCase();
    if(contentType!=="application/pdf")return false;
    const link=String(d?.webViewLink||"");
    const driveId=d?.fileId||((link.match(/\/d\/([a-zA-Z0-9_-]+)/)||[])[1])||((link.match(/[?&]id=([a-zA-Z0-9_-]+)/)||[])[1])||"";
    return Boolean(d?.fileUrl||d?.documentUrl||d?.storageUrl||d?.pdfUrl||driveId);
  });
  return usable.sort((a,b)=>{
    const at=a.createdAt?.seconds?Number(a.createdAt.seconds):Date.parse(a.createdAt||0)||0;
    const bt=b.createdAt?.seconds?Number(b.createdAt.seconds):Date.parse(b.createdAt||0)||0;
    return bt-at;
  });
}
export async function getEmployeePaymentRequests(employeeUid){const s=await getDocs(query(collection(db,COLLECTIONS.staffPaymentRequests),where("employeeUid","==",employeeUid),orderBy("createdAt","desc")));return s.docs.map(x=>({id:x.id,...x.data()}));}
async function digestKey(value){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");}
export async function openVotingIssue({meetingId,meetingReference,resolutionId=null,resolutionReference=null,votingReference}){if(!auth.currentUser)throw new Error("Authentication is required.");if(!meetingId)throw new Error("A meeting is required for every voting issue.");const origin=String(votingReference||"").trim();if(!origin)throw new Error("The voting origin / issue requiring voting action is required.");const meeting=await getRecord(COLLECTIONS.meetings,meetingId);if(!meeting)throw new Error("The originating meeting could not be found.");if(resolutionId){const resolution=await getRecord(COLLECTIONS.resolutions,resolutionId);if(!resolution)throw new Error("The linked resolution could not be found.");if(resolution.meetingId!==meetingId)throw new Error("A resolution can only be voted on within its originating meeting.");}const issueKey=await digestKey(`${meetingId}|${resolutionId||""}|${origin.toLowerCase()}`);const ref=doc(db,COLLECTIONS.votingIssues,issueKey);return runTransaction(db,async tx=>{const existing=await tx.get(ref);if(existing.exists()){const status=existing.data().status||"Open";if(status!=="Cancelled")return{...existing.data(),id:existing.id,alreadyOpen:true};}const data={meetingId,meetingReference:meetingReference||meeting.title||meetingId,resolutionId,resolutionReference,votingReference:origin,status:"Open",result:"Pending",anonymous:true,openedAt:serverTimestamp(),openedByProcess:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};tx.set(ref,data);return{...data,id:ref.id,alreadyOpen:false};});}
export async function castAnonymousVote({votingIssueId,outcome,votingMethod="Meeting Vote"}){const uid=auth.currentUser?.uid;if(!uid)throw new Error("Authentication is required to cast a vote.");if(!votingIssueId)throw new Error("A voting issue is required.");if(!["For","Against","Abstain"].includes(outcome))throw new Error("Invalid voting outcome.");const issueRef=doc(db,COLLECTIONS.votingIssues,votingIssueId);const participationRef=doc(db,COLLECTIONS.votingIssues,votingIssueId,"participants",uid);const voteRef=doc(collection(db,COLLECTIONS.votes));const auditRef=doc(collection(db,COLLECTIONS.audit));await runTransaction(db,async tx=>{const issueSnap=await tx.get(issueRef);const participationSnap=await tx.get(participationRef);if(!issueSnap.exists())throw new Error("This voting issue does not exist.");const issue=issueSnap.data();if(issue.status!=="Open")throw new Error("Voting is closed for this issue.");if(participationSnap.exists())throw new Error("You have already voted on this issue. Duplicate voting is not permitted.");tx.set(participationRef,{uid,issueId:votingIssueId,createdAt:serverTimestamp()});tx.set(voteRef,{voteReference:`IRPA-VOTE-${voteRef.id}`,votingIssueId,meetingId:issue.meetingId,meetingReference:issue.meetingReference||issue.meetingId,resolutionId:issue.resolutionId||null,resolutionReference:issue.resolutionReference||null,votingReference:issue.votingReference,outcome,result:"Pending",status:"Locked",votingMethod,anonymous:true,votedAt:serverTimestamp(),createdAt:serverTimestamp()});tx.set(auditRef,auditData("ANONYMOUS_VOTE_CAST",COLLECTIONS.votes,voteRef.id,{votingIssueId,outcome,votingMethod,anonymous:true}));});return voteRef.id;}
export async function hasVotedOnIssue(votingIssueId){const uid=auth.currentUser?.uid;if(!uid||!votingIssueId)return false;const snap=await getDoc(doc(db,COLLECTIONS.votingIssues,votingIssueId,"participants",uid));return snap.exists();}
export async function closeVotingIssue(votingIssueId,result="Pending"){if(!votingIssueId)throw new Error("A voting issue is required.");const ref=doc(db,COLLECTIONS.votingIssues,votingIssueId);const resultValue=["Passed","Rejected","Pending"].includes(result)?result:"Pending";let issue;await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error("Voting issue not found.");issue=snap.data();if(issue.status!=="Open")throw new Error("This voting issue is already closed.");tx.update(ref,{status:"Closed",result:resultValue,closedAt:serverTimestamp(),updatedAt:serverTimestamp()});if(issue.resolutionId){const resolutionRef=doc(db,COLLECTIONS.resolutions,issue.resolutionId);const resolutionSnap=await tx.get(resolutionRef);if(!resolutionSnap.exists())throw new Error("The linked resolution no longer exists.");tx.update(resolutionRef,{status:resultValue,votingStatus:"Completed",votingResult:resultValue,votingIssueId,updatedAt:serverTimestamp()});}});await writeAudit("VOTING_ISSUE_CLOSED",COLLECTIONS.votingIssues,votingIssueId,{result:resultValue,resolutionId:issue?.resolutionId||null});return resultValue;}
export async function createVoteCorrection({voteId,reason,correctionNote}){if(!voteId||!reason?.trim()||!correctionNote?.trim())throw new Error("Vote, correction reason and correction note are required.");const ref=doc(collection(db,COLLECTIONS.voteCorrections));const auditRef=doc(collection(db,COLLECTIONS.audit));await runTransaction(db,async tx=>{const voteSnap=await tx.get(doc(db,COLLECTIONS.votes,voteId));if(!voteSnap.exists())throw new Error("The original vote could not be found.");tx.set(ref,{voteId,reason:reason.trim(),correctionNote:correctionNote.trim(),originalVotePreserved:true,auditRequired:true,requestedByUid:auth.currentUser?.uid||null,requestedAt:serverTimestamp(),status:"Administrative Review",createdAt:serverTimestamp()});tx.set(auditRef,auditData("VOTE_CORRECTION_REQUEST_CREATED",COLLECTIONS.voteCorrections,ref.id,{voteId,reason:reason.trim(),originalVotePreserved:true,auditRequired:true}));});return ref.id;}
export async function updateRecord(collectionName,id,data,options={}){const touchUpdatedAt=options.touchUpdatedAt!==false;const audit=options.audit!==false;const payload=touchUpdatedAt?{...data,updatedAt:serverTimestamp()}:data;await updateDoc(doc(db,collectionName,id),payload);if(audit)await writeAudit("UPDATE",collectionName,id,data);}
export async function processPaymentRequest(id,changes){const actor=currentActor();await updateDoc(doc(db,COLLECTIONS.staffPaymentRequests,id),{...changes,actionByUid:actor.uid,actionByEmail:actor.email,actionAt:serverTimestamp(),updatedAt:serverTimestamp()});await writeAudit("PAYMENT_WORKFLOW_ACTION",COLLECTIONS.staffPaymentRequests,id,{...changes,actorUid:actor.uid,actorEmail:actor.email});}
export async function deleteRecord(collectionName,id){await deleteDoc(doc(db,collectionName,id));await writeAudit("DELETE",collectionName,id);}
export async function getAdminProfile(uid){return uid?getRecord(COLLECTIONS.adminProfiles,uid):null;}
function institutionalRoleValues(record){
  if(!record)return[];
  return [
    record.role,
    ...(Array.isArray(record.roles)?record.roles:[]),
    ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
    ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
    ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
  ].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
}
function hasInstitutionalRole(record){
  return institutionalRoleValues(record).length>0;
}
function mergeInstitutionalRecords(records=[]){
  const valid=records.filter(Boolean);
  if(!valid.length)return null;
  const base=valid.find(hasInstitutionalRole)||valid[0];
  const roles=[...new Set(valid.flatMap(institutionalRoleValues))];
  const merged={...base};
  if(roles.length){
    merged.roles=roles;
    if(!merged.role)merged.role=roles[0];
  }
  return merged;
}

export async function getCurrentMemberProfile(){const uid=auth.currentUser?.uid;const email=String(auth.currentUser?.email||"").trim().toLowerCase();if(!uid)return null;const records=[];const direct=await getRecord(COLLECTIONS.members,uid).catch(()=>null);if(direct)records.push(direct);if(email){const snap=await getDocs(query(collection(db,COLLECTIONS.members),where("email","==",email))).catch(()=>null);if(snap)records.push(...snap.docs.map(x=>({id:x.id,...x.data()})));}return mergeInstitutionalRecords(records);}
export async function getCurrentEmployeeProfile(){const uid=auth.currentUser?.uid;const email=String(auth.currentUser?.email||"").trim().toLowerCase();if(!uid)return null;const records=[];const direct=await getRecord(COLLECTIONS.employees,uid).catch(()=>null);if(direct)records.push(direct);if(email){const snap=await getDocs(query(collection(db,COLLECTIONS.employees),where("email","==",email))).catch(()=>null);if(snap)records.push(...snap.docs.map(x=>({id:x.id,...x.data()})));}return mergeInstitutionalRecords(records);}

// Returns every active institutional register entry linked to the authenticated
// member, including separate Member and Employee records. This is intentionally
// not merged: a dual-role person must be able to select the exact registered
// department/unit/capacity used for signing.
export async function getCurrentSigningAuthorityRegisterEntries(){
 const uid=auth.currentUser?.uid;
 const email=String(auth.currentUser?.email||"").trim().toLowerCase();
 if(!uid)return[];
 const entries=[];
 const collect=(record,sourceCollection)=>{
   if(!record)return;
   const active=String(record.status||record.employmentStatus||"Active").trim().toLowerCase()!=="inactive";
   if(active)entries.push({id:record.id||record.uid||uid,...record,sourceCollection});
 };
 collect(await getRecord(COLLECTIONS.members,uid).catch(()=>null),"members");
 collect(await getRecord(COLLECTIONS.employees,uid).catch(()=>null),"employees");
 if(email){
   const [memberSnap,employeeSnap]=await Promise.all([
     getDocs(query(collection(db,COLLECTIONS.members),where("email","==",email))).catch(()=>null),
     getDocs(query(collection(db,COLLECTIONS.employees),where("email","==",email))).catch(()=>null)
   ]);
   memberSnap?.docs.forEach(x=>collect({id:x.id,...x.data()},"members"));
   employeeSnap?.docs.forEach(x=>collect({id:x.id,...x.data()},"employees"));
 }
 const seen=new Set();
 return entries.filter(entry=>{const key=entry.sourceCollection+":"+entry.id;if(seen.has(key))return false;seen.add(key);return true;});
}


export async function getCurrentInductionContext(){
  const applicantUser=applicantAuth.currentUser;
  const isAnonymousApplicant=Boolean(applicantUser?.isAnonymous);
  const activeAuth=isAnonymousApplicant?applicantAuth:auth;
  const activeDb=isAnonymousApplicant?applicantDb:db;
  const uid=activeAuth.currentUser?.uid;
  const email=String(activeAuth.currentUser?.email||"").trim().toLowerCase();
  if(!uid) throw new Error("An induction session could not be established.");

  if(isAnonymousApplicant){
    const params=new URLSearchParams(window.location.search);
    const invitationId=String(params.get("memberInvite")||"").trim();
    let invitation=null;
    if(invitationId){
      const snap=await getDoc(doc(activeDb,COLLECTIONS.invitations,invitationId));
      if(snap.exists()){
        const value=snap.data();
        if(String(value.status||"").toLowerCase()!=="cancelled") invitation={id:snap.id,...value};
      }
    }
    const existingSnap=await getDoc(doc(activeDb,COLLECTIONS.registrationRequests,uid));
    const existingRequest=existingSnap.exists()?existingSnap.data():null;
    const invitationEmail=String(invitation?.email||"").trim().toLowerCase();
    const invitationName=String(invitation?.name||"").trim();
    let registerMatches={employees:[],members:[],exactNameMatch:false};
    if(invitation?.id){
      try{
        const call=httpsCallable(getFunctions(undefined,"us-central1"),"fetchInductionMatchingRecords");
        const result=await call({invitationId:invitation.id});
        registerMatches=result.data||registerMatches;
      }catch(error){
        console.warn("Induction register matching unavailable; invitation data will remain available.",error);
      }
    }
    const matchedEmployees=Array.isArray(registerMatches.employees)?registerMatches.employees:[];
    const matchedMembers=Array.isArray(registerMatches.members)?registerMatches.members:[];
    const roles=uniqueInductionValues([
      invitation?.role,
      ...(Array.isArray(invitation?.roles)?invitation.roles:[]),
      ...matchedEmployees.flatMap(x=>[x.role,...(x.roles||[])]),
      ...matchedMembers.flatMap(x=>[x.role,...(x.roles||[])])
    ]);
    const accountType=matchedEmployees.length&&matchedMembers.length?"Employee & Member":matchedEmployees.length?"Employee":matchedMembers.length?"Member":String(invitation?.accountType||invitation?.memberType||"").trim();
    return {
      uid,email:invitationEmail,fullName:invitationName,
      roles:roles.length?roles:["Board Member","Executive Director","Director","Finance","Procurement","Human Resources","Programme & Technical","Operations","Field","General Employee"],
      role:roles.join(" • "),department:String(invitation?.department||"").trim(),
      unit:String(invitation?.unit||"").trim(),registrationNumber:"",
      accountType,accountTypeOptions:accountType?[accountType]:["Member","Employee"],
      memberType:String(matchedMembers[0]?.memberType||invitation?.memberType||"").trim(),
      employmentType:String(matchedEmployees[0]?.employmentType||invitation?.employmentType||"").trim(),
      boardMember:Boolean(invitation?.boardMember||matchedMembers.some(x=>x.boardMember)||roles.some(r=>/board member/i.test(r))),
      member:matchedMembers[0]||null,employee:matchedEmployees[0]||null,registerMatches,invitation,invitations:invitation?[invitation]:[],
      invitationId:invitation?.id||invitationId||null,existingRequest,anonymous:true
    };
  }

  if(!email) throw new Error("Authentication is required to load the induction form.");
  const [member,employee,existingRequest]=await Promise.all([
    getRecord(COLLECTIONS.members,uid),
    getRecord(COLLECTIONS.employees,uid),
    getRecord(COLLECTIONS.registrationRequests,uid)
  ]);
  const invitationSnap=await getDocs(query(collection(db,COLLECTIONS.invitations),where("email","==",email)));
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
  return {uid,email,fullName,roles:uniqueRoles,role:uniqueRoles.join(" • "),department,unit,registrationNumber,accountType,accountTypeOptions,
    memberType:member?.memberType||invitation?.memberType||"",employmentType:employee?.employmentType||invitation?.employmentType||"",
    boardMember,member,employee,invitation,invitations,invitationId:invitation?.id||invitationId||null,existingRequest};
}

export async function submitInductionApplication(form,context){
  const activeAuth=context?.anonymous?applicantAuth:auth;
  const uid=activeAuth.currentUser?.uid;
  if(!uid||uid!==context?.uid) throw new Error("Authenticated registration identity could not be verified.");
  if(!context?.roles?.length) throw new Error("No registered role could be retrieved. The induction application is blocked.");
  const email=String(form.verifiedEmail||context.email||"").trim().toLowerCase();
  if(!email) throw new Error("An email address is required before the application can be verified.");
  if(context.existingRequest?.status==="Linked"||context.existingRequest?.roleAssignmentStatus==="Linked") return {alreadyLinked:true,requestId:uid};

  // Root submission path: the browser no longer writes registrationRequests/inductionRecords
  // and no longer performs a second client-side routing call. One authenticated callable
  // is the authoritative receiver, scorer, reporter and router.
  const call=httpsCallable(getFunctions(context?.anonymous?applicantApp:undefined,"us-central1"),"submitInductionApplication");
  try{
    const result=await call({
      form:{...form,verifiedEmail:email,verifiedFullName:String(form.verifiedFullName||context.fullName||"").trim()},
      context:{
        uid,email,fullName:String(form.verifiedFullName||context.fullName||"").trim(),
        anonymous:Boolean(context.anonymous),roles:context.roles,role:context.role,
        department:context.department,unit:context.unit,employmentType:context.employmentType,
        accountType:context.accountType,boardMember:Boolean(context.boardMember),
        invitationId:context.invitationId||""
      }
    });
    return result.data||{ok:true,requestId:uid};
  }catch(error){
    throw new Error(error?.message||"The Induction & Orientation application could not be received by the administrator system.");
  }
}

export async function getInductionRegistrationRequests(){
  await requireActiveAdmin();
  const call=httpsCallable(getFunctions(undefined,"us-central1"),"getInductionApplicationReception");
  try{
    const result=await call({});
    return Array.isArray(result.data?.applications)?result.data.applications:[];
  }catch(error){
    throw new Error(error?.message||"The administrator application reception could not be loaded.");
  }
}

export async function processInductionRegistrationAdmin(requestId){
  await requireActiveAdmin();
  if(!requestId) throw new Error("An induction registration request is required.");
  const call=httpsCallable(getFunctions(undefined,"us-central1"),"processInductionApplicationAdmin");
  try{
    const result=await call({requestId});
    return result.data;
  }catch(error){
    throw new Error(error?.message||"The administrator could not process the pending induction application.");
  }
}

export async function rejectInductionRegistration(requestId,reason){
  await requireActiveAdmin();
  if(!requestId) throw new Error("An induction registration request is required.");
  if(!reason||!String(reason).trim()) throw new Error("A decision reason is required.");
  const call=httpsCallable(getFunctions(undefined,"us-central1"),"rejectInductionApplication");
  try{
    const result=await call({requestId,reason:String(reason).trim()});
    return result.data;
  }catch(error){
    throw new Error(error?.message||"The administrator rejection could not be recorded.");
  }
}

export async function linkInductionRegistration(requestId){
  await requireActiveAdmin();
  if(!requestId) throw new Error("An induction registration request is required.");
  const functions=getFunctions(undefined,"us-central1");
  try{
    const call=httpsCallable(functions,"approveInductionApplication");
    const result=await call({requestId});
    return result.data;
  }catch(error){
    throw new Error(error?.message||"The administrator LINK could not provision the approved applicant.");
  }
}
