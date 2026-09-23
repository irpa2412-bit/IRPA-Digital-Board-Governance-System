const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");
initializeApp(); const db = getFirestore();
async function stableId(v){return crypto.createHash("sha256").update(String(v)).digest("hex");}
async function notify({recipientUids,type,title,body,module,recordId,route="/",priority="normal",eventKey}){for(const recipientUid of [...new Set((recipientUids||[]).filter(Boolean).map(String))]){const id=await stableId(`${eventKey}|${recipientUid}`);await db.collection("notifications").doc(id).set({recipientUid,type,title,body,module,recordId:recordId||null,route,priority,read:false,createdByUid:"system",createdAt:FieldValue.serverTimestamp()},{merge:true});}}
async function meetingRecipients(meetingId,meeting={}){if(!meetingId)return[];const ids=new Set([...(meeting.participantUids||[]),...(meeting.attendeeUids||[]),...(meeting.memberUids||[])].filter(Boolean));const snap=await db.collection("meetingSubscriptions").where("meetingId","==",meetingId).get();snap.forEach(d=>{const x=d.data();[x.uid,x.userId,x.memberUid].filter(Boolean).forEach(v=>ids.add(v));});return[...ids];}

async function deleteCollectionDocs(collectionName){
  const ref=db.collection(collectionName);
  let deleted=0;
  while(true){
    const snap=await ref.limit(400).get();
    if(snap.empty)break;
    const batch=db.batch();
    snap.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
    deleted+=snap.size;
    if(snap.size<400)break;
  }
  return deleted;
}

exports.bootstrapPrimaryAdministrator = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Google authentication is required.");
  if(email!=="irpa2412@gmail.com") throw new HttpsError("permission-denied","This Google account is not the designated IRPA primary administrator.");
  const user=await require("firebase-admin/auth").getAuth().getUser(uid);
  await db.collection("adminProfiles").doc(uid).set({
    uid,
    email,
    name:user.displayName||"IRPA Primary Administrator",
    role:"Administrator",
    active:true,
    createdByUid:uid,
    createdByEmail:email,
    updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await require("firebase-admin/auth").getAuth().setCustomUserClaims(uid,{...(user.customClaims||{}),admin:true});
  return {ok:true,uid,email};
});

exports.createAdministrator = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const actorSnap=await db.collection("adminProfiles").doc(uid).get();
  const actor=actorSnap.exists?actorSnap.data():null;
  const actorEmail=String(request.auth?.token?.email||actor?.email||"").trim().toLowerCase();
  const primaryAdministrator=actorEmail==="irpa2412@gmail.com";
  if(!primaryAdministrator && (!actor || actor.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");

  const email=String(request.data?.email||"").trim().toLowerCase();
  const name=String(request.data?.name||"").trim();
  if(!email || !email.includes("@")) throw new HttpsError("invalid-argument","A valid administrator email address is required.");
  if(email===String(request.auth.token?.email||actor.email||"").trim().toLowerCase()) throw new HttpsError("failed-precondition","The current administrator is already an administrator.");

  let target;
  try {
    target=await require("firebase-admin/auth").getAuth().getUserByEmail(email);
  } catch(error) {
    if(error?.code!=="auth/user-not-found") throw new HttpsError("internal","Unable to look up the administrator account.");
    const tempPassword="IRPA-"+crypto.randomBytes(24).toString("base64url")+"-9!aQ";
    target=await require("firebase-admin/auth").getAuth().createUser({email,password:tempPassword,emailVerified:false,displayName:name||undefined});
  }

  await require("firebase-admin/auth").getAuth().setCustomUserClaims(target.uid,{...(target.customClaims||{}),admin:true});
  await db.collection("adminProfiles").doc(target.uid).set({
    uid:target.uid,
    email,
    name:name||target.displayName||email.split("@")[0],
    role:"Administrator",
    active:true,
    createdByUid:uid,
    createdByEmail:request.auth.token?.email||actor.email||null,
    createdAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await db.collection("audit").add({
    action:"ADMINISTRATOR_CREATED_OR_ACTIVATED",
    collection:"adminProfiles",
    recordId:target.uid,
    details:{targetEmail:email,targetUid:target.uid,createdByUid:uid,createdByEmail:request.auth.token?.email||actor.email||null,accountCreated:!target.metadata?.creationTime||target.metadata.creationTime===target.metadata.lastSignInTime},
    actorUid:uid,
    actorEmail:request.auth.token?.email||actor.email||null,
    createdAt:FieldValue.serverTimestamp()
  });
  return {ok:true,uid:target.uid,email,name:name||target.displayName||email.split("@")[0],accountCreated:!target.metadata?.lastSignInTime};
});

exports.fetchInductionMatchingRecords = onCall({region:"us-central1"}, async request => {
  const invitationId=String(request.data?.invitationId||"").trim();
  const suppliedEmail=String(request.data?.email||"").trim().toLowerCase();
  let invitation=null;
  if(invitationId){
    const snap=await db.collection("invitations").doc(invitationId).get();
    if(snap.exists) invitation={id:snap.id,...snap.data()};
  }else if(suppliedEmail){
    const snap=await db.collection("invitations").where("email","==",suppliedEmail).get();
    if(!snap.empty) invitation={id:snap.docs[0].id,...snap.docs[0].data()};
  }
  const email=String(invitation?.email||suppliedEmail).trim().toLowerCase();
  const name=String(invitation?.name||"").trim().toLowerCase();
  const [employeeSnap,memberSnap]=await Promise.all([
    email?db.collection("employees").where("email","==",email).get():Promise.resolve({docs:[]}),
    email?db.collection("members").where("email","==",email).get():Promise.resolve({docs:[]})
  ]);
  const clean=docSnap=>({id:docSnap.id,...docSnap.data()});
  const employees=employeeSnap.docs.map(clean);
  const members=memberSnap.docs.map(clean);
  return {
    invitation,
    employees:employees.map(x=>({id:x.id,uid:x.uid||null,name:x.name||"",email:x.email||email,employeeNumber:x.employeeNumber||"",role:x.role||"",roles:Array.isArray(x.roles)?x.roles:[],department:x.department||"",unit:x.unit||"",employmentType:x.employmentType||"",status:x.status||"",registrationStatus:x.registrationStatus||""})),
    members:members.map(x=>({id:x.id,uid:x.uid||null,name:x.name||"",email:x.email||email,memberNumber:x.memberNumber||"",memberType:x.memberType||"",role:x.role||"",roles:Array.isArray(x.roles)?x.roles:[],department:x.department||"",unit:x.unit||"",boardMember:Boolean(x.boardMember),status:x.status||"",registrationStatus:x.registrationStatus||""})),
    exactNameMatch:Boolean([...employees,...members].some(x=>String(x.name||"").trim().toLowerCase()===name))
  };
});

async function queueInductionEmail(to,subject,text,html){
  const recipient=String(to||"").trim().toLowerCase();
  if(!recipient||!recipient.includes("@")) return null;
  const ref=await db.collection("mail").add({
    to:recipient,
    message:{subject,text,html},
    source:"IRPA Induction & Orientation",
    createdAt:FieldValue.serverTimestamp()
  });
  return ref.id;
}

function scoreInductionApplication(item, records){
  const clean=v=>String(v||"").trim().toLowerCase();
  const answers=item.answers||{};
  const employees=records.employees||[];
  const members=records.members||[];
  const invitation=records.invitation||null;
  const all=[...employees,...members];
  const expectedNames=[invitation?.name,...all.map(x=>x.name)].filter(Boolean).map(clean);
  const expectedEmails=[invitation?.email,...all.map(x=>x.email)].filter(Boolean).map(clean);
  const expectedRoles=[invitation?.role,...all.flatMap(x=>[x.role,...(x.roles||[])])].filter(Boolean).map(clean);
  const expectedDepartments=[invitation?.department,...all.map(x=>x.department)].filter(Boolean).map(clean);
  const expectedUnits=[invitation?.unit,...all.map(x=>x.unit)].filter(Boolean).map(clean);
  const expectedEmployment=[invitation?.employmentType,...employees.map(x=>x.employmentType)].filter(Boolean).map(clean);
  const expectedMemberTypes=[invitation?.memberType,...members.map(x=>x.memberType)].filter(Boolean).map(clean);
  const expectedNumbers=[...employees.map(x=>x.employeeNumber),...members.map(x=>x.memberNumber),invitation?.registrationNumber].filter(Boolean).map(clean);
  const expectedRefs=[invitation?.invitationReference,invitation?.reference].filter(Boolean).map(clean);
  const expectedCapacity=[...new Set([
    employees.length?"employee":"",
    members.length?"member":"",
    employees.length&&members.length?"employee & member":"",
    invitation?.accountType||""
  ].filter(Boolean).map(clean))];
  const scoreItems=[];
  const add=(label,ok,reason)=>scoreItems.push({label,ok:Boolean(ok),reason:reason||""});
  add("Identity confirmation",answers.identityConfirmation==="Yes","Applicant did not confirm identity/information.");
  add("Full name",answers.verifiedFullName && (!expectedNames.length||expectedNames.includes(clean(answers.verifiedFullName)),"Name does not match the available IRPA record."));
  add("Email",answers.verifiedEmail && (!expectedEmails.length||expectedEmails.includes(clean(answers.verifiedEmail)),"Email does not match the available IRPA record."));
  add("Capacity",answers.accountType && (!expectedCapacity.length||expectedCapacity.includes(clean(answers.accountType)),"Capacity is not consistent with the available record."));
  add("Role / position",answers.primaryRole && (!expectedRoles.length||expectedRoles.includes(clean(answers.primaryRole)),"Role is not consistent with the available record."));
  add("Department",answers.department && (!expectedDepartments.length||expectedDepartments.includes(clean(answers.department)),"Department is not consistent with the available record."));
  add("Unit",answers.unit && (!expectedUnits.length||expectedUnits.includes(clean(answers.unit)),"Unit is not consistent with the available record."));
  add("Employment / membership",answers.employmentType && (!expectedEmployment.length||expectedEmployment.includes(clean(answers.employmentType)||expectedMemberTypes.includes(clean(answers.employmentType))),"Employment or membership detail is not consistent with the available record."));
  add("Q1 — name",answers.q1 && (!expectedNames.length||expectedNames.includes(clean(answers.q1))),"Q1 does not match the available name.");
  add("Q2 — email",answers.q2 && (!expectedEmails.length||expectedEmails.includes(clean(answers.q2))),"Q2 does not match the available email.");
  add("Q3 — registration number",answers.q3 && (!expectedNumbers.length||expectedNumbers.includes(clean(answers.q3))||/no registration number/i.test(String(answers.q3))),"Q3 does not match the available registration number.");
  add("Q4 — role",answers.q4 && (!expectedRoles.length||expectedRoles.includes(clean(answers.q4))),"Q4 does not match the available role.");
  add("Q5 — department/unit",answers.q5 && (!expectedDepartments.length||expectedDepartments.some(v=>clean(answers.q5).includes(v))||expectedUnits.some(v=>clean(answers.q5).includes(v))),"Q5 does not match the available department/unit.");
  add("Q6 — membership/invitation",answers.q6 && (!expectedRefs.length&&!expectedEmployment.length||expectedRefs.includes(clean(answers.q6))||expectedEmployment.includes(clean(answers.q6))||expectedMemberTypes.includes(clean(answers.q6))),"Q6 does not match the available membership/employment or invitation detail.");
  add("Orientation modules",Array.isArray(answers.orientationModules)&&answers.orientationModules.length>0,"No orientation modules were selected.");
  add("Declaration",item.declaration===true,"The declaration was not accepted.");
  const total=scoreItems.length;
  const correct=scoreItems.filter(x=>x.ok).length;
  const percentage=Math.round((correct/total)*100);
  const threshold=75;
  const issues=scoreItems.filter(x=>!x.ok).map(x=>x.label);
  const reasons=scoreItems.filter(x=>!x.ok).map(x=>x.reason).filter(Boolean);
  return {percentage,correct,total,threshold,advanced:percentage>=threshold,issues,reasons,scoreItems};
}

exports.routeInductionApplication = onCall({region:"us-central1"}, async request => {
  const requestId=String(request.data?.requestId||"").trim();
  if(!requestId) throw new HttpsError("invalid-argument","Induction application ID is required.");
  const requestRef=db.collection("registrationRequests").doc(requestId);
  const snap=await requestRef.get();
  if(!snap.exists) throw new HttpsError("not-found","The induction application could not be found.");
  const item=snap.data();
  if(item.routingStatus==="Advanced to Administrator"||item.routingStatus==="Filtered — Below 75% Accuracy"){
    return {ok:true,routingStatus:item.routingStatus,accuracyPercentage:item.accuracyPercentage,systemSummary:item.systemSummary||""};
  }

  const email=String(item.email||item.answers?.verifiedEmail||"").trim().toLowerCase();
  const invitationId=String(item.invitationId||"").trim();
  let invitation=null;
  if(invitationId){const s=await db.collection("invitations").doc(invitationId).get();if(s.exists)invitation={id:s.id,...s.data()};}
  const [employeeSnap,memberSnap]=await Promise.all([
    email?db.collection("employees").where("email","==",email).limit(10).get():Promise.resolve({docs:[]}),
    email?db.collection("members").where("email","==",email).limit(10).get():Promise.resolve({docs:[]})
  ]);
  const employees=employeeSnap.docs.map(d=>({id:d.id,...d.data()}));
  const members=memberSnap.docs.map(d=>({id:d.id,...d.data()}));
  const score=scoreInductionApplication(item,{invitation,employees,members});
  const routingStatus=score.advanced?"Advanced to Administrator":"Filtered — Below 75% Accuracy";
  const status=score.advanced?"Pending Administrator Decision":"Filtered — Applicant Feedback Required";
  const summary=(score.advanced?"Advanced for administrator review. ":"Filtered pending applicant correction. ")+`Accuracy: ${score.percentage}% (${score.correct}/${score.total}).`+(score.issues.length?` Review items: ${score.issues.join(", ")}.`:" All scored items are consistent.");
  await requestRef.set({accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,status,inductionStatus:score.advanced?"Advanced":"Filtered",roleAssignmentStatus:score.advanced?"Pending Administrator Decision":"Filtered",feedbackStatus:"Queued",updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("inductionRecords").doc(requestId).set({accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,status:score.advanced?"Advanced":"Filtered",inductionStatus:score.advanced?"Advanced":"Filtered",updatedAt:FieldValue.serverTimestamp()},{merge:true});

  const applicantSubject=score.advanced?"IRPA Induction Application — Advanced to Administrator":"IRPA Induction Application — Further Information Required";
  const applicantText=score.advanced
    ? `Dear ${item.fullName||"Applicant"},\\n\\nYour IRPA Induction and Orientation application has been received and scored at ${score.percentage}% (${score.correct}/${score.total}). It has therefore been advanced to the Administrator for decision.\\n\\nSystem summary: ${summary}\\n\\nNo login account is authorised until the Administrator completes the decision.\\n\\nIRPA Digital Board Governance System`
    : `Dear ${item.fullName||"Applicant"},\\n\\nYour IRPA Induction and Orientation application has been received. The automated accuracy check recorded ${score.percentage}% (${score.correct}/${score.total}), below the 75% advancement threshold.\\n\\nSystem feedback: ${summary}\\n\\nPlease return to the induction form, correct the indicated items and resubmit.\\n\\nIRPA Digital Board Governance System`;
  const emailId=await queueInductionEmail(email,applicantSubject,applicantText,applicantText.replace(/\\n/g,"<br>"));
  const adminEmails=(await db.collection("adminProfiles").where("active","==",true).get()).docs.map(d=>String(d.data()?.email||"").trim().toLowerCase()).filter(Boolean);
  if(score.advanced){
    for(const adminEmail of [...new Set(adminEmails)]) await queueInductionEmail(adminEmail,"IRPA Induction Application Advanced for Decision",`Applicant: ${item.fullName||"Unnamed"}\\nEmail: ${email}\\n${summary}\\nApplication ID: ${requestId}`,`<strong>IRPA Induction Application Advanced for Decision</strong><br>Applicant: ${item.fullName||"Unnamed"}<br>Email: ${email}<br>${summary}<br>Application ID: ${requestId}`);
  }
  return {ok:true,routingStatus,accuracyPercentage:score.percentage,systemSummary:summary,feedbackQueued:Boolean(emailId),advanced:score.advanced};
});

exports.approveInductionApplication = onCall({region:"us-central1"}, async request => {
  const adminUid=request.auth?.uid;
  if(!adminUid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(adminUid).get();
  const actorEmail=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists || adminSnap.data()?.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");

  const requestId=String(request.data?.requestId||"").trim();
  if(!requestId) throw new HttpsError("invalid-argument","Induction application ID is required.");
  const requestRef=db.collection("registrationRequests").doc(requestId);
  const requestSnap=await requestRef.get();
  if(!requestSnap.exists) throw new HttpsError("not-found","The induction application could not be found.");
  const item=requestSnap.data();
  if(item.status==="Linked" && item.authUid) return {ok:true,alreadyLinked:true,uid:item.authUid,email:item.email||null};

  const email=String(item.email||item.answers?.verifiedEmail||"").trim().toLowerCase();
  const name=String(item.fullName||item.answers?.verifiedFullName||"").trim();
  if(!email || !email.includes("@")) throw new HttpsError("failed-precondition","The approved applicant has no valid email address.");
  if(!name) throw new HttpsError("failed-precondition","The approved applicant has no full name.");

  const capacity=String(item.accountType||item.answers?.accountType||"").trim().toLowerCase();
  const role=String(item.requestedRole||item.answers?.primaryRole||item.systemRole||"General Employee").trim();
  const roles=Array.isArray(item.systemRoles)&&item.systemRoles.length?item.systemRoles:[role];
  const department=String(item.requestedDepartment||item.answers?.department||item.systemDepartment||"").trim();
  const unit=String(item.requestedUnit||item.answers?.unit||item.systemUnit||"").trim();
  const employmentType=String(item.employmentType||item.answers?.employmentType||"").trim();
  const wantsMember=["member","employee & member","member & employee"].includes(capacity);
  const wantsEmployee=["employee","employee & member","member & employee"].includes(capacity);
  if(!wantsMember&&!wantsEmployee) throw new HttpsError("failed-precondition","The approved applicant capacity must be Member or Employee.");

  const authAdmin=require("firebase-admin/auth").getAuth();
  let user,accountCreated=false;
  try { user=await authAdmin.getUserByEmail(email); await authAdmin.updateUser(user.uid,{disabled:false,displayName:name}); }
  catch(error) {
    if(error?.code!=="auth/user-not-found") throw new HttpsError("internal","Firebase Authentication could not retrieve the applicant account.");
    user=await authAdmin.createUser({email,displayName:name,emailVerified:false,disabled:false}); accountCreated=true;
  }
  await authAdmin.setCustomUserClaims(user.uid,{...(user.customClaims||{}),loginApproved:true,irpaMember:true});

  const nextNumber=async(collectionName,counterName,prefix,field)=>{
    const counterRef=db.collection(counterName).doc("current");
    const existing=await db.collection(collectionName).select().get();
    let highest=0;
    existing.forEach(d=>{const n=Number(String(d.data()?.[field]||"").split("-").pop());if(Number.isInteger(n)&&n>highest)highest=n;});
    return db.runTransaction(async tx=>{
      const snap=await tx.get(counterRef); const current=Number(snap.exists?(snap.data().nextNumber||1):1);
      const next=Math.max(current,highest+1);
      tx.set(counterRef,{nextNumber:next+1,currentNumber:next,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      return prefix+String(next).padStart(5,"0");
    });
  };

  const common={uid:user.uid,email,name,role,roles,department,unit,employmentType,status:"Active",registrationStatus:"Activated",inductionStatus:"Approved",invitationId:item.invitationId||null,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()};
  const existingMembers=await db.collection("members").where("email","==",email).limit(10).get();
  const existingEmployees=await db.collection("employees").where("email","==",email).limit(10).get();

  if(wantsMember){
    const number=existingMembers.docs[0]?.data()?.memberNumber||await nextNumber("members","memberCounters","IRPA-MEM-","memberNumber");
    if(existingMembers.empty) await db.collection("members").doc(user.uid).set({...common,memberNumber:number,memberType:item.memberType||"Governance Member",boardMember:Boolean(item.boardMember),activatedAt:FieldValue.serverTimestamp()},{merge:true});
    else for(const d of existingMembers.docs) await d.ref.set({...common,memberNumber:d.data()?.memberNumber||number,boardMember:Boolean(item.boardMember),activatedAt:FieldValue.serverTimestamp()},{merge:true});
  }
  if(wantsEmployee){
    const number=existingEmployees.docs[0]?.data()?.employeeNumber||await nextNumber("employees","employeeCounters","IRPA-EMP-","employeeNumber");
    if(existingEmployees.empty) await db.collection("employees").doc(user.uid).set({...common,employeeNumber:number,accountActivated:true,registrationEmailStatus:"Pending",activatedAt:FieldValue.serverTimestamp()},{merge:true});
    else for(const d of existingEmployees.docs) await d.ref.set({...common,employeeNumber:d.data()?.employeeNumber||number,accountActivated:true,registrationEmailStatus:"Pending",activatedAt:FieldValue.serverTimestamp()},{merge:true});
  }

  const passwordSetupLink=await authAdmin.generatePasswordResetLink(email,{url:process.env.IRPA_LOGIN_URL||"https://irpa-digital-board-governance.web.app/",handleCodeInApp:false});
  await requestRef.set({status:"Linked",inductionStatus:"Approved",roleAssignmentStatus:"Linked",authUid:user.uid,memberProfileUid:wantsMember?user.uid:null,employeeProfileUid:wantsEmployee?user.uid:null,approvedRole:role,approvedRoles:roles,approvedDepartment:department||null,approvedUnit:unit||null,boardMember:Boolean(item.boardMember),routingStatus:"Approved & Linked",loginApproved:true,accountCreated,credentialStatus:"Firebase account provisioned — password setup required",passwordSetupLink,linkedByUid:adminUid,linkedByEmail:actorEmail,linkedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("inductionRecords").doc(requestId).set({uid:user.uid,originalApplicantUid:item.uid||requestId,email,name,status:"Approved",inductionStatus:"Approved",roleAssignmentStatus:"Linked",approvedRole:role,approvedDepartment:department||null,approvedUnit:unit||null,boardMember:Boolean(item.boardMember),linkedByUid:adminUid,linkedByEmail:actorEmail,linkedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  if(item.invitationId) await db.collection("invitations").doc(item.invitationId).set({status:"Activated",authUid:user.uid,activatedUid:user.uid,activatedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("audit").add({action:"INDUCTION_APPLICATION_APPROVED_AND_SUBSCRIBED",collection:"registrationRequests",recordId:requestId,details:{email,authUid:user.uid,accountCreated,wantsMember,wantsEmployee},actorUid:adminUid,actorEmail,createdAt:FieldValue.serverTimestamp()});
  await queueInductionEmail(email,"IRPA Induction Application — Approved",`Dear ${name},\\n\\nYour IRPA Induction and Orientation application has been approved by the Administrator. Your IRPA account has been provisioned and login authorisation has been granted. Use the password setup route provided below to establish your password:\\n\\n${passwordSetupLink}\\n\\nApproved role: ${role}\\nDepartment: ${department||"Not specified"}\\nUnit: ${unit||"Not specified"}\\n\\nIRPA Digital Board Governance System`, `<strong>IRPA Induction Application — Approved</strong><p>Dear ${name},</p><p>Your application has been approved by the Administrator. Your IRPA account has been provisioned and login authorisation has been granted.</p><p><a href="${passwordSetupLink}">Set up your password</a></p><p>Approved role: ${role}<br>Department: ${department||"Not specified"}<br>Unit: ${unit||"Not specified"}</p>`);
  return {ok:true,alreadyLinked:false,uid:user.uid,email,accountCreated,memberSubscribed:wantsMember,employeeSubscribed:wantsEmployee,passwordSetupLink};
});

exports.submitCredentialInterview = onCall({region:"us-central1"}, async request => {
  const data=request.data||{};
  const email=String(data.email||"").trim().toLowerCase();
  const name=String(data.name||"").trim();
  const invitationReference=String(data.invitationReference||"").trim();
  const requestedCapacity=String(data.requestedCapacity||"").trim();
  const requestedRole=String(data.requestedRole||"").trim();
  if(!email||!email.includes("@")||!name) throw new HttpsError("invalid-argument","Name and a valid email address are required.");
  const invitationSnap=await db.collection("invitations").where("email","==",email).limit(10).get();
  const invitations=invitationSnap.docs.map(d=>({id:d.id,...d.data()}));
  const invitation=invitations.find(x=>!invitationReference||x.invitationReference===invitationReference||x.reference===invitationReference)||invitations[0]||null;
  const [memberSnap,employeeSnap]=await Promise.all([
    db.collection("members").where("email","==",email).limit(5).get(),
    db.collection("employees").where("email","==",email).limit(5).get()
  ]);
  if(!invitation&&!memberSnap.size&&!employeeSnap.size) throw new HttpsError("not-found","No matching IRPA invitation, Member or Employee registration could be retrieved for this email. The credential interview is blocked.");
  const roles=[...employeeSnap.docs.flatMap(d=>Array.isArray(d.data().roles)?d.data().roles:[d.data().role]),...memberSnap.docs.flatMap(d=>Array.isArray(d.data().roles)?d.data().roles:[d.data().role]),invitation?.role||""].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
  const ref=db.collection("credentialInterviewRequests").doc();
  await ref.set({email,name,invitationId:invitation?.id||null,invitationReference:invitation?.invitationReference||invitation?.reference||invitationReference||null,requestedCapacity:requestedCapacity||null,requestedRole:requestedRole||null,registeredRoles:[...new Set(roles)],status:"Pending Login Approval",loginApproved:false,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  return {ok:true,requestId:ref.id,status:"Pending Login Approval"};
});

exports.getCredentialInterviewRequests = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  const email=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(email!=="irpa2412@gmail.com" && (!adminSnap.exists||adminSnap.data()?.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");
  const snap=await db.collection("credentialInterviewRequests").orderBy("createdAt","desc").limit(100).get();
  return {requests:snap.docs.map(d=>({id:d.id,...d.data()}))};
});

exports.approveCredentialInterview = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  const actorEmail=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists||adminSnap.data()?.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");
  const requestId=String(request.data?.requestId||"").trim();
  if(!requestId) throw new HttpsError("invalid-argument","Credential interview request ID is required.");
  const ref=db.collection("credentialInterviewRequests").doc(requestId);
  const snap=await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","Credential interview request not found.");
  const item=snap.data();
  if(item.loginApproved===true) return {ok:true,alreadyApproved:true,email:item.email,uid:item.authUid||null};
  const authAdmin=require("firebase-admin/auth").getAuth();
  let user;
  try { user=await authAdmin.getUserByEmail(item.email); }
  catch(error) {
    if(error?.code!=="auth/user-not-found") throw new HttpsError("internal","Unable to retrieve the Firebase account.");
    user=await authAdmin.createUser({email:item.email,displayName:item.name,emailVerified:false});
  }
  await authAdmin.updateUser(user.uid,{disabled:false,displayName:item.name||user.displayName||undefined});
  await authAdmin.setCustomUserClaims(user.uid,{...(user.customClaims||{}),loginApproved:true});
  const invitation=item.invitationId?((await db.collection("invitations").doc(item.invitationId).get()).data()||{}):{};
  const employeeSnap=await db.collection("employees").where("email","==",item.email).limit(5).get();
  const memberSnap=await db.collection("members").where("email","==",item.email).limit(5).get();
  const employeeRole=item.requestedRole||invitation.role||"Employee";
  if(employeeSnap.empty && employeeRole!=="Board Member"){
    await db.collection("employees").doc(user.uid).set({uid:user.uid,email:item.email,name:item.name,role:employeeRole,roles:item.registeredRoles||[employeeRole],department:invitation.department||"",unit:invitation.unit||"",employmentType:invitation.employmentType||"Employee",status:"Active",accountActivated:true,registrationStatus:"Activated",registrationEmailStatus:"Pending",invitationId:item.invitationId||null,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  }else{for(const d of employeeSnap.docs) await d.ref.set({uid:user.uid,accountActivated:true,registrationStatus:"Activated",updatedAt:FieldValue.serverTimestamp()},{merge:true});}
  if(memberSnap.empty){
    await db.collection("members").doc(user.uid).set({uid:user.uid,email:item.email,name:item.name,role:employeeRole,roles:item.registeredRoles||[employeeRole],memberType:invitation.memberType||"Governance Member",status:"Active",invitationId:item.invitationId||null,activatedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  }else{for(const d of memberSnap.docs) await d.ref.set({uid:user.uid,status:"Active",updatedAt:FieldValue.serverTimestamp()},{merge:true});}
  await ref.update({status:"Login Approved",loginApproved:true,authUid:user.uid,approvedByUid:uid,approvedByEmail:actorEmail,approvedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  await db.collection("audit").add({action:"CREDENTIAL_INTERVIEW_LOGIN_APPROVED",collection:"credentialInterviewRequests",recordId:requestId,details:{email:item.email,authUid:user.uid},actorUid:uid,actorEmail,createdAt:FieldValue.serverTimestamp()});
  return {ok:true,email:item.email,uid:user.uid,loginApproved:true};
});

exports.resetTrialData = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  const admin=adminSnap.exists ? adminSnap.data() : null;
  const adminEmail=String(request.auth?.token?.email||admin?.email||"").trim().toLowerCase();
  const primaryAdministrator=adminEmail==="irpa2412@gmail.com";
  if(!primaryAdministrator && (!admin || admin.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");
  if(request.data?.confirmation!=="RESET IRPA TRIAL DATA") throw new HttpsError("failed-precondition","The exact confirmation phrase is required.");

  const [memberSnap,employeeSnap]=await Promise.all([
    db.collection("members").get(),
    db.collection("employees").get()
  ]);
  const memberCount=memberSnap.size;
  const employeeCount=employeeSnap.size;
  const auditRef=db.collection("audit").doc();
  await auditRef.set({
    action:"RESET_TRIAL_DATA",
    category:"SYSTEM_ADMINISTRATION",
    description:"Controlled administrator-only reset of trial member and employee data.",
    performedByUid:uid,
    performedByEmail:request.auth.token?.email||admin.email||null,
    memberRecordsTargeted:memberCount,
    employeeRecordsTargeted:employeeCount,
    status:"Started",
    createdAt:FieldValue.serverTimestamp()
  });