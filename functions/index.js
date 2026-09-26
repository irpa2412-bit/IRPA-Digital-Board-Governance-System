const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");
initializeApp(); const db = getFirestore();
async function stableId(v){return crypto.createHash("sha256").update(String(v)).digest("hex");}
async function writeServerAuditEvent(event){
  const path=String(event.params?.document||"");
  const parts=path.split("/").filter(Boolean);
  if(parts.length<2)return null;
  const collectionName=parts[parts.length-2];
  const recordId=parts[parts.length-1];
  if(["audit","systemResetPlans"].includes(collectionName))return null;
  const before=event.data?.before;
  const after=event.data?.after;
  const beforeExists=Boolean(before?.exists);
  const afterExists=Boolean(after?.exists);
  if(!beforeExists&&!afterExists)return null;
  const beforeData=beforeExists?(before.data()||{}):{};
  const afterData=afterExists?(after.data()||{}):{};
  const changedKeys=[...new Set([...Object.keys(beforeData),...Object.keys(afterData)])]
    .filter(key=>JSON.stringify(beforeData[key])!==JSON.stringify(afterData[key]))
    .slice(0,120);
  const action=!beforeExists&&afterExists?"SERVER_CREATE":beforeExists&&!afterExists?"SERVER_DELETE":"SERVER_UPDATE";
  await db.collection("audit").add({
    action,collection:collectionName,recordId,
    details:{source:"SERVER_FIRESTORE_TRIGGER",changedKeys,beforeExists,afterExists},
    actorUid:afterData.updatedByUid||afterData.createdByUid||beforeData.updatedByUid||beforeData.createdByUid||null,
    actorEmail:afterData.updatedByEmail||afterData.createdByEmail||beforeData.updatedByEmail||beforeData.createdByEmail||null,
    createdAt:FieldValue.serverTimestamp()
  });
  return null;
}
exports.captureServerAuditEvent=onDocumentWritten({document:"{document=**}",region:"us-central1"},writeServerAuditEvent);
async function notify({recipientUids,type,title,body,module,recordId,route="/",priority="normal",eventKey}){for(const recipientUid of [...new Set((recipientUids||[]).filter(Boolean).map(String))]){const id=await stableId(`${eventKey}|${recipientUid}`);await db.collection("notifications").doc(id).set({recipientUid,type,title,body,module,recordId:recordId||null,route,priority,read:false,createdByUid:"system",createdAt:FieldValue.serverTimestamp()},{merge:true});}}

// Central financial reference control. References are issued only after an approval
// state is reached, by a server-side Firestore trigger. A yearly counter is updated
// transactionally so concurrent approvals cannot receive the same reference.
const FINANCIAL_APPROVALS={
  staffPaymentRequests:data=>data?.status==="Authorized",
  financeTransactions:data=>data?.status==="Approved",
  financeApprovals:data=>data?.status==="Approved",
  financeBudgets:data=>data?.status==="Board Approved",
  financeReports:data=>data?.status==="Approved"
};
function financialApprovalLabel(collectionName,data){
  return FINANCIAL_APPROVALS[collectionName]?.(data)===true;
}
async function assignFinancialReference(collectionName,docId){
  const sourceRef=db.collection(collectionName).doc(docId);
  const sourceSnap=await sourceRef.get();
  if(!sourceSnap.exists)return null;
  const source=sourceSnap.data()||{};
  if(!financialApprovalLabel(collectionName,source))return null;
  if(String(source.referenceNumber||"").trim())return String(source.referenceNumber).trim();

  const year=new Date().getUTCFullYear();
  const counterRef=db.collection("financialReferenceCounters").doc(String(year));
  return db.runTransaction(async tx=>{
    const currentSource=await tx.get(sourceRef);
    if(!currentSource.exists)return null;
    const current=currentSource.data()||{};
    if(String(current.referenceNumber||"").trim())return String(current.referenceNumber).trim();
    const counterSnap=await tx.get(counterRef);
    let nextNumber=Math.max(1,Number(counterSnap.exists?(counterSnap.data()?.nextNumber||1):1));
    let reference="";
    let registryRef=null;
    let registrySnap=null;
    for(let attempt=0;attempt<25;attempt++){
      reference=`IRPA-FIN-${year}-${String(nextNumber).padStart(5,"0")}`;
      registryRef=db.collection("financeReferenceRegistry").doc(reference);
      registrySnap=await tx.get(registryRef);
      if(!registrySnap.exists)break;
      nextNumber++;
    }
    if(registrySnap?.exists)throw new Error("Financial reference registry collision could not be resolved.");
    const issuedAt=FieldValue.serverTimestamp();
    tx.set(sourceRef,{referenceNumber:reference,referenceStatus:"System Generated",referenceIssuedAt:issuedAt,referenceIssuedBy:"SYSTEM",financialReferenceVersion:"1.0"},{merge:true});
    tx.set(registryRef,{
      referenceNumber:reference,referenceYear:year,sequenceNumber:nextNumber,
      sourceCollection:collectionName,sourceRecordId:docId,
      sourceTitle:current.title||current.description||current.type||current.employeeName||null,
      employeeUid:current.employeeUid||null,employeeNumber:current.employeeNumber||null,employeeName:current.employeeName||null,
      payee:current.payee||null,amount:Number(current.amount||0),currency:current.currency||"TZS",
      approvalStatus:current.status||null,workflowStage:current.workflowStage||null,
      issuedAt,issuedBy:"SYSTEM",controlStatus:"Active",createdAt:issuedAt,updatedAt:issuedAt
    });
    tx.set(counterRef,{nextNumber:nextNumber+1,currentNumber:nextNumber,updatedAt:issuedAt},{merge:true});
    return reference;
  });
}
async function financialReferenceTrigger(event,collectionName){
  const after=event.data?.after?.data?.()||{};
  if(!event.data?.after?.exists)return null;
  if(String(after.referenceNumber||"").trim())return null;
  if(!financialApprovalLabel(collectionName,after))return null;
  try{
    await assignFinancialReference(collectionName,event.params.docId);
    return null;
  }catch(error){
    console.error(`Financial reference allocation failed for ${collectionName}/${event.params.docId}`,error);
    throw error;
  }
}
exports.assignStaffPaymentFinancialReference=onDocumentUpdated({document:"staffPaymentRequests/{docId}",region:"us-central1"},event=>financialReferenceTrigger(event,"staffPaymentRequests"));
exports.assignFinanceTransactionFinancialReference=onDocumentUpdated({document:"financeTransactions/{docId}",region:"us-central1"},event=>financialReferenceTrigger(event,"financeTransactions"));
exports.assignFinanceApprovalFinancialReference=onDocumentUpdated({document:"financeApprovals/{docId}",region:"us-central1"},event=>financialReferenceTrigger(event,"financeApprovals"));
exports.assignFinanceBudgetFinancialReference=onDocumentUpdated({document:"financeBudgets/{docId}",region:"us-central1"},event=>financialReferenceTrigger(event,"financeBudgets"));
exports.assignFinanceReportFinancialReference=onDocumentUpdated({document:"financeReports/{docId}",region:"us-central1"},event=>financialReferenceTrigger(event,"financeReports"));

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


async function requirePrimaryAdministratorCallable(request){
  const uid=request.auth?.uid;
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  if(email==="irpa2412@gmail.com" || request.auth?.token?.admin===true) return {uid,email};
  throw new HttpsError("permission-denied","Primary administrator authorization is required.");
}

exports.nextDocumentReference = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required to generate a document reference.");
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  const year=new Date().getUTCFullYear();
  const counterRef=db.collection("systemSettings").doc("documentCounters");
  const registryRefPrefix="IRPA-DOC-"+year+"-";
  const reference=await db.runTransaction(async tx=>{
    const counterSnap=await tx.get(counterRef);
    let nextNumber=Math.max(1,Number(counterSnap.exists?(counterSnap.data()?.documentReference||0):0)+1);
    let candidate="";
    let candidateRef=null;
    let candidateSnap=null;
    for(let attempt=0;attempt<25;attempt++){
      candidate=registryRefPrefix+String(nextNumber).padStart(5,"0");
      candidateRef=db.collection("documentReferenceRegistry").doc(candidate);
      candidateSnap=await tx.get(candidateRef);
      if(!candidateSnap.exists)break;
      nextNumber++;
    }
    if(candidateSnap?.exists) throw new Error("Document reference registry collision could not be resolved.");
    const issuedAt=FieldValue.serverTimestamp();
    tx.set(counterRef,{documentReference:nextNumber,updatedAt:issuedAt},{merge:true});
    tx.set(candidateRef,{
      referenceNumber:candidate,referenceYear:year,sequenceNumber:nextNumber,
      issuedByUid:uid,issuedByEmail:email||null,issuedBy:"SYSTEM",
      controlStatus:"Active",createdAt:issuedAt,updatedAt:issuedAt
    });
    return candidate;
  });
  return {ok:true,reference,year,issuedBy:"SYSTEM"};
});

exports.setAdministratorAccess = onCall({region:"us-central1"}, async request => {
  const actor=await requirePrimaryAdministratorCallable(request);
  const targetEmail=String(request.data?.email||"").trim().toLowerCase();
  const enabled=request.data?.enabled===true;
  const reason=String(request.data?.reason||"").trim();
  if(!targetEmail || !targetEmail.includes("@")) throw new HttpsError("invalid-argument","A valid administrator email is required.");
  if(!reason) throw new HttpsError("invalid-argument","A reason is required for administrator access changes.");
  if(targetEmail==="irpa2412@gmail.com" && enabled===false) throw new HttpsError("failed-precondition","The designated primary administrator cannot be disabled by this workflow.");
  const authAdmin=getAuth();
  let target;
  try { target=await authAdmin.getUserByEmail(targetEmail); }
  catch(error) {
    if(error?.code==="auth/user-not-found") throw new HttpsError("not-found","The target administrator must already have a Firebase Authentication account.");
    throw error;
  }
  const existingClaims=target.customClaims||{};
  const nextClaims={...existingClaims,admin:enabled};
  if(!enabled) delete nextClaims.irpaRoles;
  await authAdmin.setCustomUserClaims(target.uid,nextClaims);
  await db.collection("adminProfiles").doc(target.uid).set({
    uid:target.uid,email:targetEmail,active:enabled,role:"Administrator",
    accessSource:"Server-controlled administrator access",
    changedByUid:actor.uid,changedByEmail:actor.email,
    changeReason:reason,updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await db.collection("audit").add({
    action:enabled?"ADMINISTRATOR_ACCESS_GRANTED":"ADMINISTRATOR_ACCESS_REVOKED",
    collection:"adminProfiles",recordId:target.uid,
    details:{targetEmail,enabled,reason,serverControlled:true},
    actorUid:actor.uid,actorEmail:actor.email,createdAt:FieldValue.serverTimestamp()
  });
  return {ok:true,uid:target.uid,email:targetEmail,enabled};
});

async function requireActiveAdministratorCallable(request){
  const uid=request.auth?.uid;
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  // Continuity safeguard: an existing server-controlled admin claim remains a valid
  // administrator session even if the profile registry is temporarily incomplete.
  if(email==="irpa2412@gmail.com" || request.auth?.token?.admin===true) return {uid,email};
  const snap=await db.collection("adminProfiles").doc(uid).get();
  if(!snap.exists||snap.data()?.active!==true) throw new HttpsError("permission-denied","Administrator authorization is required.");
  return {uid,email};
}

exports.synchronizeRegisteredIdentityUids = onCall({region:"us-central1",timeoutSeconds:120}, async request => {
  const actor=await requireActiveAdministratorCallable(request);
  const [memberSnap,employeeSnap]=await Promise.all([
    db.collection("members").get(),
    db.collection("employees").get()
  ]);
  const results=[];
  const emailCache=new Map();
  const processedUids=new Set();

  async function authForEmail(email,name){
    if(emailCache.has(email)) return emailCache.get(email);
    let user=null,created=false;
    try{
      user=await getAuth().getUserByEmail(email);
    }catch(error){
      if(error?.code!=="auth/user-not-found") throw error;
      user=await getAuth().createUser({
        email,
        emailVerified:false,
        displayName:name||email.split("@")[0],
        disabled:false
      });
      created=true;
    }
    const value={user,created};
    emailCache.set(email,value);
    return value;
  }

  async function syncCollection(snapshot,collectionName){
    for(const item of snapshot.docs){
      const data=item.data()||{};
      const email=String(data.email||"").trim().toLowerCase();
      const currentUid=String(data.uid||"").trim();
      if(!email||!email.includes("@")){
        results.push({collection:collectionName,id:item.id,name:data.name||"",email:"",uid:null,status:"UID Pending — Invalid or missing email",action:"blocked"});
        continue;
      }
      try{
        let user=null,created=false;
        if(currentUid){
          try{
            user=await getAuth().getUser(currentUid);
            const authEmail=String(user.email||"").trim().toLowerCase();
            if(authEmail&&authEmail!==email){
              user=null;
              results.push({collection:collectionName,id:item.id,name:data.name||"",email,uid:currentUid,status:"UID Conflict — UID belongs to another email",action:"conflict"});
              continue;
            }
          }catch(error){
            if(error?.code!=="auth/user-not-found") throw error;
          }
        }
        if(!user){
          const resolved=await authForEmail(email,data.name);
          user=resolved.user;
          created=resolved.created;
        }
        if(processedUids.has(user.uid)){
          // The same Firebase identity may legitimately be represented in both
          // the member and employee registers. Keep both records linked.
        }
        processedUids.add(user.uid);
        const status=String(data.status||data.employmentStatus||"Active");
        const assignmentStatus=created?"UID Assigned — Firebase Account Created":"UID Linked — Existing Firebase Account";
        const patch={
          uid:user.uid,
          uidAssignmentStatus:assignmentStatus,
          uidAssignedAt:FieldValue.serverTimestamp(),
          uidAssignedByUid:actor.uid,
          uidAssignedByEmail:actor.email||null,
          firebaseAuthEmail:String(user.email||email).trim().toLowerCase(),
          firebaseAuthDisabled:user.disabled===true,
          updatedAt:FieldValue.serverTimestamp()
        };
        if(collectionName==="employees" && !data.registrationEmailStatus){
          patch.registrationEmailStatus=created?"UID Assigned — Activation Pending":"UID Linked";
        }
        await db.collection(collectionName).doc(item.id).set(patch,{merge:true});
        await db.collection("audit").add({
          action:"REGISTERED_IDENTITY_UID_SYNCHRONIZED",
          collection:collectionName,
          recordId:item.id,
          details:{uid:user.uid,email,createdAuthAccount:created,existingStatus:status,uidAssignmentStatus:assignmentStatus},
          actorUid:actor.uid,actorEmail:actor.email||null,createdAt:FieldValue.serverTimestamp()
        });
        results.push({collection:collectionName,id:item.id,name:data.name||"",email,uid:user.uid,status,action:created?"created":"linked"});
      }catch(error){
        console.error("UID synchronization failed",collectionName,item.id,error);
        results.push({collection:collectionName,id:item.id,name:data.name||"",email,uid:null,status:"UID Pending — Synchronization error",action:"error",error:String(error?.message||error)});
      }
    }
  }

  await syncCollection(memberSnap,"members");
  await syncCollection(employeeSnap,"employees");

  const summary={
    members:results.filter(x=>x.collection==="members"),
    employees:results.filter(x=>x.collection==="employees"),
    total:results.length,
    linked:results.filter(x=>x.action==="linked").length,
    created:results.filter(x=>x.action==="created").length,
    conflicts:results.filter(x=>x.action==="conflict").length,
    blocked:results.filter(x=>x.action==="blocked").length,
    errors:results.filter(x=>x.action==="error").length
  };
  await db.collection("audit").add({
    action:"REGISTERED_IDENTITY_UID_SYNCHRONIZATION_COMPLETED",
    collection:"members+employees",
    recordId:"UID_SYNC",
    details:{total:summary.total,linked:summary.linked,created:summary.created,conflicts:summary.conflicts,blocked:summary.blocked,errors:summary.errors},
    actorUid:actor.uid,actorEmail:actor.email||null,createdAt:FieldValue.serverTimestamp()
  });
  return {ok:true,summary};
});

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

exports.updateSignerAuthority = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required.");

  const requestedRole=String(request.data?.authorityRole||"").trim();
  const requestedDepartment=String(request.data?.authorityDepartment||"").trim();
  const requestedUnit=String(request.data?.authorityUnit||"").trim();
  const authorityStatus=String(request.data?.authorityStatus||"Current").trim();
  const authorityReference=String(request.data?.authorityReference||"").trim();
  const authorityEffectiveAt=String(request.data?.authorityEffectiveAt||"").trim()||null;
  const authorityExpiresAt=String(request.data?.authorityExpiresAt||"").trim()||null;
  const allowedStatuses=["Current","Pending Verification","Expired","Not yet assigned"];
  if(!requestedRole) throw new HttpsError("invalid-argument","Select the current signing authority before saving.");
  if(!allowedStatuses.includes(authorityStatus)) throw new HttpsError("invalid-argument","Select a valid signing authority status.");
  if(authorityEffectiveAt&&authorityExpiresAt&&authorityExpiresAt<authorityEffectiveAt)
    throw new HttpsError("invalid-argument","Authority expiry date cannot be earlier than the effective date.");

  const records=[];
  const addSnapshot=(snap,sourceCollection)=>{
    snap.forEach(docSnap=>{
      if(docSnap.exists) records.push({id:docSnap.id,...docSnap.data(),sourceCollection});
    });
  };
  const [memberByUid,employeeByUid,memberByEmail,employeeByEmail]=await Promise.all([
    db.collection("members").doc(uid).get(),
    db.collection("employees").doc(uid).get(),
    email?db.collection("members").where("email","==",email).get():null,
    email?db.collection("employees").where("email","==",email).get():null
  ]);
  if(memberByUid.exists)records.push({id:memberByUid.id,...memberByUid.data(),sourceCollection:"members"});
  if(employeeByUid.exists)records.push({id:employeeByUid.id,...employeeByUid.data(),sourceCollection:"employees"});
  if(memberByEmail)addSnapshot(memberByEmail,"members");
  if(employeeByEmail)addSnapshot(employeeByEmail,"employees");

  const uniqueRecords=[...new Map(records.map(item=>[item.sourceCollection+":"+item.id,item])).values()]
    .filter(item=>String(item.status||item.employmentStatus||"Active").toLowerCase()!=="inactive");
  if(!uniqueRecords.length) throw new HttpsError("permission-denied","No active IRPA member or employee register entry was found for this account.");

  const valuesFor=record=>[
    record.role,record.boardPosition,record.unit,record.unitName,
    ...(Array.isArray(record.roles)?record.roles:[]),
    ...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),
    ...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),
    ...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])
  ].flatMap(value=>String(value||"").split(",").map(value=>value.trim()).filter(Boolean));

  const allowedRoles=[...new Set(uniqueRecords.flatMap(valuesFor))];
  if(!allowedRoles.includes(requestedRole))
    throw new HttpsError("permission-denied","The selected signing authority is not registered to this IRPA member/employee account.");

  const matchingRecords=uniqueRecords.filter(record=>{
    if(!valuesFor(record).includes(requestedRole)) return false;
    if(requestedDepartment&&String(record.department||"").trim()!==requestedDepartment) return false;
    if(requestedUnit){
      const recordUnit=String(record.unit||record.unitName||"").trim()||authorityDepartment||requestedDepartment;
      if(recordUnit!==requestedUnit) return false;
    }
    return true;
  });
  if(!matchingRecords.length)
    throw new HttpsError("permission-denied","The selected department, unit and signing authority do not match an active IRPA register entry for this account.");
  const source=matchingRecords[0];
  const authorityDepartment=String(source.department||"").trim();
  const authorityUnit=String(source.unit||source.unitName||"").trim()||authorityDepartment;

  const identityRef=db.collection("signerIdentities").doc(uid);
  const identitySnap=await identityRef.get();
  if(!identitySnap.exists) throw new HttpsError("failed-precondition","Signer Identity record is not available. Restore the Signer Identity link before updating signing authority.");

  const actorEmail=email||String(identitySnap.data()?.email||"").trim().toLowerCase();
  const now=FieldValue.serverTimestamp();
  await identityRef.update({
    authorityRole:requestedRole,
    authorityStatus,
    authorityReference,
    authorityEffectiveAt,
    authorityExpiresAt,
    authorityDepartment,
    authorityUnit,
    authoritySourceCollection:source.sourceCollection,
    authoritySourceRecordId:source.id,
    authorityUpdatedAt:now,
    updatedAt:now
  });
  await db.collection("audit").add({
    action:"UPDATE_SIGNER_AUTHORITY",
    collection:"signerIdentities",
    recordId:uid,
    details:{
      authorityRole:requestedRole,
      authorityStatus,
      authorityDepartment,
      authorityUnit,
      authoritySourceCollection:source.sourceCollection,
      authoritySourceRecordId:source.id
    },
    actorUid:uid,
    actorEmail:actorEmail||null,
    createdAt:now
  });
  return {ok:true,uid,authorityRole:requestedRole,authorityStatus,authorityReference,authorityEffectiveAt,authorityExpiresAt,authorityDepartment,authorityUnit,authoritySourceCollection:source.sourceCollection,authoritySourceRecordId:source.id};
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
  if(!name) throw new HttpsError("invalid-argument","The new administrator's name is required.");
  if(email===actorEmail) throw new HttpsError("failed-precondition","The current administrator is already an administrator.");

  const adminAuth=getAuth();
  let target=null;
  let accountCreated=false;
  try {
    try {
      target=await adminAuth.getUserByEmail(email);
    } catch(error) {
      if(error?.code!=="auth/user-not-found") throw new HttpsError("internal","Firebase Authentication could not verify the new administrator email address.");
      target=await adminAuth.createUser({email,emailVerified:false,displayName:name});
      accountCreated=true;
    }
    if(target.disabled===true){
      await adminAuth.updateUser(target.uid,{disabled:false,displayName:name||target.displayName});
      target=await adminAuth.getUser(target.uid);
    }
    await adminAuth.setCustomUserClaims(target.uid,{...(target.customClaims||{}),admin:true});
    await db.collection("adminProfiles").doc(target.uid).set({
      uid:target.uid,email,name:name||target.displayName||email.split("@")[0],
      role:"Administrator",active:true,createdByUid:uid,createdByEmail:actorEmail||null,
      createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()
    },{merge:true});
    await db.collection("audit").add({
      action:"ADMINISTRATOR_CREATED_OR_ACTIVATED",collection:"adminProfiles",recordId:target.uid,
      details:{targetEmail:email,targetUid:target.uid,createdByUid:uid,createdByEmail:actorEmail||null,accountCreated},
      actorUid:uid,actorEmail:actorEmail||null,createdAt:FieldValue.serverTimestamp()
    });
    return {ok:true,uid:target.uid,email,name:name||target.displayName||email.split("@")[0],accountCreated};
  } catch(error) {
    if(error instanceof HttpsError) throw error;
    console.error("createAdministrator failed",error);
    const code=String(error?.code||"");
    if(code==="auth/email-already-exists") throw new HttpsError("already-exists","That email address is already registered. Use the existing account or choose another administrator email address.");
    if(code==="auth/invalid-email") throw new HttpsError("invalid-argument","The administrator email address is invalid.");
    throw new HttpsError("internal","Administrator creation failed on the Firebase server. No success confirmation was issued.");
  }
});

exports.listAdministrators = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const actorSnap=await db.collection("adminProfiles").doc(uid).get();
  const actor=actorSnap.exists?actorSnap.data():null;
  const actorEmail=String(request.auth?.token?.email||actor?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!actor || actor.active!==true))
    throw new HttpsError("permission-denied","Administrator authorization is required.");
  const snap=await db.collection("adminProfiles").where("active","==",true).get();
  return {ok:true, administrators:snap.docs.map(d=>({uid:d.id,email:d.data()?.email||"",name:d.data()?.name||"",role:d.data()?.role||"Administrator",active:d.data()?.active===true,primary:String(d.data()?.email||"").trim().toLowerCase()==="irpa2412@gmail.com"}))};
});

exports.removeAdministrator = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const actorSnap=await db.collection("adminProfiles").doc(uid).get();
  const actor=actorSnap.exists?actorSnap.data():null;
  const actorEmail=String(request.auth?.token?.email||actor?.email||"").trim().toLowerCase();
  const primaryAdministrator=actorEmail==="irpa2412@gmail.com";
  if(!primaryAdministrator && (!actor || actor.active!==true))
    throw new HttpsError("permission-denied","Administrator authorization is required.");

  const targetUid=String(request.data?.uid||"").trim();
  if(!targetUid) throw new HttpsError("invalid-argument","The Administrator to remove is required.");
  if(targetUid===uid) throw new HttpsError("failed-precondition","You cannot remove your own Administrator access.");
  const targetRef=db.collection("adminProfiles").doc(targetUid);
  const targetSnap=await targetRef.get();
  if(!targetSnap.exists) throw new HttpsError("not-found","The selected Administrator was not found.");
  const target=targetSnap.data()||{};
  const targetEmail=String(target.email||"").trim().toLowerCase();
  if(targetEmail==="irpa2412@gmail.com")
    throw new HttpsError("failed-precondition","The primary IRPA Administrator cannot be removed.");
  if(target.active!==true)
    return {ok:true,uid:targetUid,email:targetEmail,alreadyRemoved:true};

  await targetRef.set({
    active:false,
    removedAt:FieldValue.serverTimestamp(),
    removedByUid:uid,
    removedByEmail:actorEmail||null,
    updatedAt:FieldValue.serverTimestamp()
  },{merge:true});

  try {
    const adminAuth=getAuth();
    const targetUser=await adminAuth.getUser(targetUid);
    await adminAuth.setCustomUserClaims(targetUid,{...(targetUser.customClaims||{}),admin:false});
  } catch(error) {
    console.error("removeAdministrator claim update failed",error);
    throw new HttpsError("internal","Administrator access was not fully revoked at Firebase Authentication level.");
  }

  await db.collection("audit").add({
    action:"ADMINISTRATOR_REMOVED",
    collection:"adminProfiles",
    recordId:targetUid,
    details:{targetEmail,targetUid,removedByUid:uid,removedByEmail:actorEmail||null},
    actorUid:uid,
    actorEmail:actorEmail||null,
    createdAt:FieldValue.serverTimestamp()
  });
  return {ok:true,uid:targetUid,email:targetEmail,name:target.name||"",removed:true};
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

exports.sendMemberInvitation = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  const actorEmail=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists || adminSnap.data()?.active!==true)){
    throw new HttpsError("permission-denied","Administrator authorization is required.");
  }
  const invitationId=String(request.data?.invitationId||"").trim();
  if(!invitationId) throw new HttpsError("invalid-argument","Invitation ID is required.");
  const ref=db.collection("invitations").doc(invitationId);
  const snap=await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","The invitation record could not be found.");
  const invitation={id:snap.id,...snap.data()};
  const email=String(invitation.email||"").trim().toLowerCase();
  const name=String(invitation.name||"").trim();
  if(!email||!email.includes("@")) throw new HttpsError("failed-precondition","The invitation has no valid addressee email.");
  if(!name) throw new HttpsError("failed-precondition","The invitation has no addressee name.");

  let role=String(invitation.role||"").trim();
  let memberType=String(invitation.memberType||"").trim();
  let department=String(invitation.department||"").trim();
  let unit=String(invitation.unit||"").trim();
  let sourceLabel="Invitation Register";

  if(invitation.boardMemberId || invitation.institutionalRecordType==="Board Member"){
    const sourceId=invitation.boardMemberId||invitation.institutionalRecordId;
    const source=sourceId?await db.collection("members").doc(sourceId).get():null;
    if(!source?.exists) throw new HttpsError("failed-precondition","The linked Board Member record could not be found.");
    const data=source.data();
    if(String(data.email||"").trim().toLowerCase()!==email) throw new HttpsError("failed-precondition","The invitation email does not match the linked Board Member record.");
    role=String(data.boardPosition||data.role||role||"Board Member").trim();
    memberType=String(data.memberType||memberType||"Governance Member").trim();
    department=String(data.department||"Board of Directors").trim();
    unit=String(data.unit||"").trim();
    sourceLabel="Board Members' Register";
  } else if(invitation.employeeId){
    const source=await db.collection("employees").doc(invitation.employeeId).get();
    if(!source.exists) throw new HttpsError("failed-precondition","The linked Employee record could not be found.");
    const data=source.data();
    if(String(data.email||"").trim().toLowerCase()!==email) throw new HttpsError("failed-precondition","The invitation email does not match the linked Employee record.");
    role=String(data.role||role||"Employee").trim();
    memberType=String(data.memberType||memberType||"Management").trim();
    department=String(data.department||"").trim();
    unit=String(data.unit||"").trim();
    sourceLabel="Employees' Register";
  }
  if(!role) role="Board Member";
  if(!memberType) memberType="Governance Member";

  const origin=process.env.IRPA_LOGIN_URL||"https://irpa-digital-board-governance.web.app";
  const invitationSecret=crypto.randomBytes(32).toString("base64url");
  const invitationSecretHash=crypto.createHash("sha256").update(invitationSecret).digest("hex");
  const invitationExpiresAt=new Date(Date.now()+72*60*60*1000);
  const invitationUrl=origin+"/?invitationToken="+encodeURIComponent(invitationId+"."+invitationSecret);
  const subscriptionLink=invitationUrl;
  const assistanceLink=origin+"/?induction=1&applicant=1&route=assistance&memberInvite="+encodeURIComponent(invitationId);
  const loginLink=origin+"/?induction=1&applicant=1&route=login";
  const subject="IRPA Invitation — "+role;
  const text="Dear "+name+",\\n\\nYou have been invited to access the IRPA Digital Board Governance System.\\n\\nAssigned IRPA role: "+role+"\\nMember type: "+memberType+"\\nSource register: "+sourceLabel+(department?"\\nDepartment: "+department:"")+(unit?"\\nUnit: "+unit:"")+"\\n\\nComplete your Induction & Orientation / subscription pathway here:\\n"+subscriptionLink+"\\n\\nIf you need login assistance:\\n"+assistanceLink+"\\n\\nNormal login route:\\n"+loginLink+"\\n\\nThis invitation is addressed to "+email+".\\n\\nImprovement of Rangeland in Pastoral Areas (IRPA)";
  const html="<p>Dear "+name+",</p><p>You have been invited to access the IRPA Digital Board Governance System.</p><p><strong>Assigned IRPA role:</strong> "+role+"<br><strong>Member type:</strong> "+memberType+"<br><strong>Source register:</strong> "+sourceLabel+(department?"<br><strong>Department:</strong> "+department:"")+(unit?"<br><strong>Unit:</strong> "+unit:"")+"</p><p><a href='"+subscriptionLink+"'>Complete Induction &amp; Orientation / Subscription</a></p><p><a href='"+assistanceLink+"'>Login assistance</a></p><p><a href='"+loginLink+"'>Normal login</a></p><p>This invitation is addressed to "+email+".</p><p>Improvement of Rangeland in Pastoral Areas (IRPA)</p>";
  const mailId=await queueInductionEmail(email,subject,text,html);
  await ref.set({
    role,memberType,department:department||null,unit:unit||null,
    invitationTokenHash:invitationSecretHash,
    invitationExpiresAt:invitationExpiresAt,
    invitationRedeemedAt:null,
    invitationRedeemedUid:null,
    invitationTokenVersion:"2",
    status:"Queued",deliveryStatus:"Queued — awaiting SMTP transport",
    deliveryProvider:"Firebase Firestore mail queue → SMTP transport",
    mailQueueId:mailId,mailQueuedAt:FieldValue.serverTimestamp(),
    invitationRoleSource:sourceLabel,updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await db.collection("audit").add({
    action:"MEMBER_INVITATION_EMAIL_QUEUED",collection:"invitations",recordId:invitationId,
    details:{email,role,memberType,sourceLabel,mailQueueId:mailId},
    actorUid:uid,actorEmail,createdAt:FieldValue.serverTimestamp()
  });
  return {ok:true,email,role,memberType,sourceLabel,deliveryStatus:"Queued — awaiting SMTP transport",mailQueueId:mailId};
});

exports.redeemInvitationToken = onCall({region:"us-central1"}, async request => {
  const raw=String(request.data?.token||"").trim();
  const parts=raw.split(".");
  if(parts.length!==2) throw new HttpsError("invalid-argument","The invitation token is invalid.");
  const invitationId=parts[0];
  const secret=parts[1];
  if(!invitationId||!secret) throw new HttpsError("invalid-argument","The invitation token is invalid.");
  const ref=db.collection("invitations").doc(invitationId);
  const snap=await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","This IRPA invitation no longer exists.");
  const invitation=snap.data()||{};
  if(invitation.status==="Cancelled") throw new HttpsError("failed-precondition","This IRPA invitation has been cancelled.");
  if(invitation.invitationRedeemedAt) throw new HttpsError("already-exists","This IRPA invitation token has already been redeemed. Ask an administrator to issue a fresh invitation.");
  if(invitation.invitationTokenVersion!=="2"||!invitation.invitationTokenHash) throw new HttpsError("failed-precondition","This invitation was issued under an older invitation mechanism. Ask an administrator to issue a fresh invitation.");
  const expiresAt=invitation.invitationExpiresAt?.toDate?invitation.invitationExpiresAt.toDate():new Date(invitation.invitationExpiresAt||0);
  if(!expiresAt.getTime()||expiresAt.getTime()<=Date.now()) throw new HttpsError("deadline-exceeded","This IRPA invitation has expired. Ask an administrator to issue a fresh invitation.");
  const suppliedHash=crypto.createHash("sha256").update(secret).digest("hex");
  const expectedHash=String(invitation.invitationTokenHash||"");
  if(expectedHash.length!==suppliedHash.length || !crypto.timingSafeEqual(Buffer.from(suppliedHash),Buffer.from(expectedHash))) throw new HttpsError("permission-denied","The invitation token is invalid.");
  const email=String(invitation.email||"").trim().toLowerCase();
  if(!email||!email.includes("@")) throw new HttpsError("failed-precondition","The invitation has no valid recipient email.");
  const authAdmin=getAuth();
  let user;
  try {
    user=await authAdmin.getUserByEmail(email);
  } catch(error) {
    if(error?.code!=="auth/user-not-found") throw error;
    user=await authAdmin.createUser({email,emailVerified:false,displayName:String(invitation.name||email.split("@")[0]),disabled:false});
  }
  if(invitation.invitationRedeemedUid && invitation.invitationRedeemedUid!==user.uid) {
    throw new HttpsError("already-exists","This invitation has already been redeemed for another Firebase account.");
  }
  await ref.set({
    invitationRedeemedUid:user.uid,
    invitationRedeemedAt:invitation.invitationRedeemedAt||FieldValue.serverTimestamp(),
    invitationRedemptionStatus:"Redeemed — Awaiting Activation",
    updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  const customToken=await authAdmin.createCustomToken(user.uid,{irpaInvitationId:invitationId,irpaInvitationRedeemed:true});
  return {ok:true,customToken,invitationId,uid:user.uid,email};
});

exports.submitInductionApplication = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","The induction application session is not authenticated.");
  const form=request.data?.form||{};
  const suppliedContext=request.data?.context||{};
  const clean=v=>String(v||"").trim().toLowerCase();
  const anonymous=request.auth?.token?.firebase?.sign_in_provider==="anonymous";
  const authEmail=clean(request.auth?.token?.email||"");
  const email=clean(form.verifiedEmail||suppliedContext.email||authEmail);
  const fullName=String(form.verifiedFullName||suppliedContext.fullName||request.auth?.token?.name||"").trim();
  if(!email||!email.includes("@")) throw new HttpsError("invalid-argument","An email address is required before the application can be received.");
  if(!fullName) throw new HttpsError("invalid-argument","Applicant full name is required before the application can be received.");
  if(!anonymous && authEmail && email!==authEmail) throw new HttpsError("permission-denied","The submitted email must match the authenticated IRPA account.");
  if(!Array.isArray(suppliedContext.roles)||!suppliedContext.roles.length) throw new HttpsError("failed-precondition","No registered role could be retrieved. The induction application is blocked.");

  const invitationId=String(suppliedContext.invitationId||"").trim();
  let invitation=null;
  if(invitationId){
    const snap=await db.collection("invitations").doc(invitationId).get();
    if(snap.exists) invitation={id:snap.id,...snap.data()};
  } else {
    const snap=await db.collection("invitations").where("email","==",email).get();
    if(!snap.empty) invitation={id:snap.docs[0].id,...snap.docs[0].data()};
  }
  const [employeeSnap,memberSnap]=await Promise.all([
    db.collection("employees").where("email","==",email).limit(10).get(),
    db.collection("members").where("email","==",email).limit(10).get()
  ]);
  const employees=employeeSnap.docs.map(d=>({id:d.id,...d.data()}));
  const members=memberSnap.docs.map(d=>({id:d.id,...d.data()}));

  const requestedRole=String(form.primaryRole||suppliedContext.role||"").trim();
  const requestedDepartment=String(form.department||suppliedContext.department||"").trim();
  const requestedUnit=String(form.unit||suppliedContext.unit||"").trim();
  if(invitation){
    const records=[...employees,...members];
    const roleMatch=records.some(x=>[x.role,...(x.roles||[])].some(v=>clean(v)===clean(requestedRole)))||clean(invitation.role)===clean(requestedRole);
    const departmentMatch=records.some(x=>clean(x.department)===clean(requestedDepartment))||clean(invitation.department)===clean(requestedDepartment);
    const unitMatch=records.some(x=>clean(x.unit)===clean(requestedUnit))||clean(invitation.unit)===clean(requestedUnit);
    if(!roleMatch||!departmentMatch||!unitMatch) throw new HttpsError("failed-precondition","The application information does not sufficiently match the retrieved IRPA records. Please review the prompted role, department and unit before submitting.");
  }

  const requestRef=db.collection("registrationRequests").doc(uid);
  const existingSnap=await requestRef.get();
  const existing=existingSnap.exists?existingSnap.data():{};
  if(existing.status==="Linked"||existing.roleAssignmentStatus==="Linked") return {alreadyLinked:true,requestId:uid};

  const matchedEmployee=employees[0]||null;
  const matchedMember=members[0]||null;
  const systemRoles=Array.isArray(suppliedContext.roles)&&suppliedContext.roles.length?suppliedContext.roles:[requestedRole].filter(Boolean);
  const systemRole=suppliedContext.role||matchedEmployee?.role||matchedMember?.role||requestedRole||null;
  const systemDepartment=suppliedContext.department||matchedEmployee?.department||matchedMember?.department||requestedDepartment||null;
  const systemUnit=suppliedContext.unit||matchedEmployee?.unit||matchedMember?.unit||requestedUnit||null;
  const boardMember=Boolean(suppliedContext.boardMember||matchedMember?.boardMember||matchedMember?.role==="Board Member");
  const submittedAt=FieldValue.serverTimestamp();
  const answers={
    identityConfirmation:form.identityConfirmation||"",
    verifiedEmail:email,
    verifiedFullName:fullName,
    accountType:form.accountType||"",
    primaryRole:requestedRole,
    department:requestedDepartment,
    unit:requestedUnit,
    employmentType:form.employmentType||"",
    orientationModules:Array.isArray(form.orientationModules)?form.orientationModules:[],
    selectedRoles:Array.isArray(form.selectedRoles)?form.selectedRoles:systemRoles,
    credentialCapacity:form.credentialCapacity||"",
    credentialRole:form.credentialRole||"",
    credentialInvitationReference:String(form.credentialInvitationReference||"").trim(),
    q1:form.q1||"",q2:form.q2||"",q3:form.q3||"",q4:form.q4||"",q5:form.q5||"",q6:form.q6||"",
    comments:String(form.comments||"").trim()
  };
  const payload={
    uid,email,fullName,memberProfileUid:matchedMember?.uid||uid,employeeProfileUid:matchedEmployee?.uid||uid,
    memberEmployeeNumber:null,registrationNumberStatus:"Issued after administrator LINK",
    invitationId:invitation?.id||null,
    invitationReference:invitation?.invitationReference||invitation?.reference||null,
    invitationStatus:invitation?"Registered invitation":"Subscription / registration email",
    enrollmentSource:invitation?"invitation":"subscription",
    systemRoles,systemRole,systemDepartment,systemUnit,boardMember,
    accountType:String(form.accountType||suppliedContext.accountType||"").trim(),
    requestedRole,requestedDepartment,requestedUnit,
    employmentType:String(form.employmentType||suppliedContext.employmentType||"").trim(),
    orientationModules:answers.orientationModules,answers,
    completedSteps:Array.isArray(form.completedSteps)?form.completedSteps:[],
    declaration:form.declaration===true,
    status:"Submitted",roleAssignmentStatus:"Pending",inductionStatus:"Submitted",
    submittedAt:existing.submittedAt||submittedAt,lastSubmittedAt:submittedAt,updatedAt:submittedAt,
    recoveredFromInductionRecord:false
  };
  await requestRef.set(payload,{merge:true});
  await db.collection("inductionRecords").doc(uid).set({
    ...payload,status:"Submitted",inductionStatus:"Submitted",roleAssignmentStatus:"Pending",
    submittedAt:existing.submittedAt||submittedAt,lastSubmittedAt:submittedAt,updatedAt:submittedAt
  },{merge:true});

  const score=scoreInductionApplication(payload,{invitation,employees,members});
  const routingStatus=score.advanced?"Advanced to Administrator":"Filtered — Below 75% Accuracy";
  const status=score.advanced?"Pending Administrator Decision":"Filtered — Applicant Feedback Required";
  const summary=(score.advanced?"Advanced for administrator review. ":"Filtered pending applicant correction. ")+`Accuracy: ${score.percentage}% (${score.correct}/${score.total}).`+(score.issues.length?` Review items: ${score.issues.join(", ")}.`:" All scored items are consistent.");
  const capturedSystemInformation={
    position:systemRole,assignedRoles:systemRoles,selectedRoles:Array.isArray(form.selectedRoles)?form.selectedRoles:systemRoles,department:systemDepartment,unit:systemUnit,
    capacity:form.credentialCapacity||form.accountType||suppliedContext.accountType||null,
    employmentType:payload.employmentType,memberType:matchedMember?.memberType||null,
    boardMember,registrationNumber:matchedEmployee?.employeeNumber||matchedMember?.memberNumber||null,
    invitationReference:payload.invitationReference,invitationId:payload.invitationId
  };
  const report={
    reportType:"IRPA Induction & Orientation Submission Report",reportVersion:"1.0",applicationId:uid,
    receivedAt:FieldValue.serverTimestamp(),applicant:{fullName,email},
    score:{percentage:score.percentage,correct:score.correct,total:score.total,threshold:score.threshold,advanced:score.advanced},
    routingStatus,decisionStatus:status,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,
    submittedAnswers:answers,capturedSystemInformation,administratorAction:"Review in Induction & Orientation Administrator Applications"
  };
  await requestRef.set({
    accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,
    accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,
    status,inductionStatus:score.advanced?"Advanced":"Filtered",
    roleAssignmentStatus:score.advanced?"Pending Administrator Decision":"Filtered",
    feedbackStatus:"Queued",inductionOrientationReport:report,
    administratorReportStatus:"Available in Application Reception",auditStatus:"Recorded",
    systemCapturedProfile:capturedSystemInformation,updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await db.collection("inductionRecords").doc(uid).set({
    accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,
    accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,status:score.advanced?"Advanced":"Filtered",
    inductionStatus:score.advanced?"Advanced":"Filtered",systemCapturedProfile:capturedSystemInformation,
    updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await db.collection("audit").add({
    action:"INDUCTION_ORIENTATION_SUBMISSION_RECEIVED",collection:"registrationRequests",recordId:uid,
    details:{reportType:report.reportType,reportVersion:report.reportVersion,accuracyPercentage:score.percentage,
      routingStatus,administratorReportStatus:"Available in Application Reception",auditStatus:"Recorded",source:"server-side submission gateway"},
    actorUid:uid,actorEmail:email,createdAt:FieldValue.serverTimestamp()
  });
  const applicantSubject=score.advanced?"IRPA Induction & Orientation — Application Advanced to Administrator":"IRPA Induction & Orientation — Application Feedback";
  const applicantText=score.advanced
    ?`Dear ${fullName},\\n\\nYour IRPA Induction and Orientation application has been received and advanced to the Administrator decision queue with ${score.percentage}% accuracy.\\n\\nNo administrator decision is granted by this message.\\n\\nIRPA Digital Board Governance System`
    :`Dear ${fullName},\\n\\nYour IRPA Induction and Orientation application has been received. The automated accuracy check recorded ${score.percentage}% (${score.correct}/${score.total}), below the 75% advancement threshold.\\n\\nSystem feedback: ${summary}\\n\\nPlease return to the induction form, correct the indicated items and resubmit.\\n\\nIRPA Digital Board Governance System`;
  const emailId=await queueInductionEmail(email,applicantSubject,applicantText,applicantText.replace(/\\n/g,"<br>"));
  const activeAdminSnap=await db.collection("adminProfiles").where("active","==",true).get();
  const adminProfiles=activeAdminSnap.docs.map(d=>({uid:d.id,...d.data()}));
  if(score.advanced){
    await notify({recipientUids:adminProfiles.map(d=>d.uid),type:"INDUCTION_APPLICATION_ADVANCED",title:"Induction application advanced for decision",body:`${fullName} — ${score.percentage}% accuracy. The full Induction & Orientation Submission Report is available directly in Application Reception and is audit-traceable.`,module:"Induction & Orientation",recordId:uid,route:"/induction-admin",priority:"high",eventKey:`INDUCTION_APPLICATION_ADVANCED|${uid}`});
  }
  return {ok:true,alreadyLinked:false,requestId:uid,status:"Submitted",routingStatus,accuracyPercentage:score.percentage,systemSummary:summary,feedbackQueued:Boolean(emailId),advanced:score.advanced};
});

exports.routeInductionApplication = onCall({region:"us-central1"}, async request => {
  const callerUid=request.auth?.uid;
  const requestId=String(request.data?.requestId||"").trim();
  if(!callerUid) throw new HttpsError("unauthenticated","The induction application session is not authenticated.");
  if(!requestId) throw new HttpsError("invalid-argument","Induction application ID is required.");
  if(requestId!==callerUid) throw new HttpsError("permission-denied","This induction application does not belong to the current applicant session.");
  const requestRef=db.collection("registrationRequests").doc(requestId);
  let snap=await requestRef.get();
  if(!snap.exists){
    const recoverySnap=await db.collection("inductionRecords").doc(requestId).get();
    if(!recoverySnap.exists) throw new HttpsError("not-found","The induction application could not be found in the application reception or induction recovery records.");
    const recovered=recoverySnap.data()||{};
    const recoveredItem={uid:requestId,email:recovered.email||recovered.verifiedEmail||"",fullName:recovered.fullName||recovered.verifiedFullName||"",systemRoles:recovered.systemRoles||[],systemRole:recovered.systemRole||null,systemDepartment:recovered.systemDepartment||null,systemUnit:recovered.systemUnit||null,boardMember:Boolean(recovered.boardMember),accountType:recovered.accountType||"",orientationModules:Array.isArray(recovered.orientationModules)?recovered.orientationModules:[],answers:recovered.answers||{},declaration:recovered.declaration===true,status:"Pending Department & Unit Review",roleAssignmentStatus:"Pending",inductionStatus:"Submitted",submittedAt:recovered.submittedAt||FieldValue.serverTimestamp(),lastSubmittedAt:recovered.lastSubmittedAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),recoveredFromInductionRecord:true};
    await requestRef.set(recoveredItem,{merge:true});
    snap=await requestRef.get();
  }
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
  const inductionOrientationReport={
    reportType:"IRPA Induction & Orientation Submission Report",reportVersion:"1.0",applicationId:requestId,receivedAt:FieldValue.serverTimestamp(),
    applicant:{fullName:item.fullName||item.answers?.verifiedFullName||"",email},
    score:{percentage:score.percentage,correct:score.correct,total:score.total,threshold:score.threshold,advanced:score.advanced},
    routingStatus,decisionStatus:status,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,
    submittedAnswers:item.answers||{},capturedSystemInformation:item.systemCapturedProfile||{},
    administratorAction:"Review in Induction & Orientation Administrator Applications"
  };
  await requestRef.set({accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,status,inductionStatus:score.advanced?"Advanced":"Filtered",roleAssignmentStatus:score.advanced?"Pending Administrator Decision":"Filtered",feedbackStatus:"Queued",inductionOrientationReport,administratorReportStatus:"Available in Application Reception",auditStatus:"Recorded",updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("inductionRecords").doc(requestId).set({accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,status:score.advanced?"Advanced":"Filtered",inductionStatus:score.advanced?"Advanced":"Filtered",updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("audit").add({action:"INDUCTION_ORIENTATION_SUBMISSION_RECEIVED",collection:"registrationRequests",recordId:requestId,details:{reportType:inductionOrientationReport.reportType,reportVersion:inductionOrientationReport.reportVersion,accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,routingStatus,administratorReportStatus:"Available in Application Reception"},actorUid:request.auth?.uid||null,actorEmail:email||null,createdAt:FieldValue.serverTimestamp()});

  const applicantSubject=score.advanced?"IRPA Induction Application — Advanced to Administrator":"IRPA Induction Application — Further Information Required";
  const applicantText=score.advanced
    ? `Dear ${item.fullName||"Applicant"},\\n\\nYour IRPA Induction and Orientation application has been received and scored at ${score.percentage}% (${score.correct}/${score.total}). It has therefore been advanced to the Administrator for decision.\\n\\nSystem summary: ${summary}\\n\\nNo login account is authorised until the Administrator completes the decision.\\n\\nIRPA Digital Board Governance System`
    : `Dear ${item.fullName||"Applicant"},\\n\\nYour IRPA Induction and Orientation application has been received. The automated accuracy check recorded ${score.percentage}% (${score.correct}/${score.total}), below the 75% advancement threshold.\\n\\nSystem feedback: ${summary}\\n\\nPlease return to the induction form, correct the indicated items and resubmit.\\n\\nIRPA Digital Board Governance System`;
  const emailId=await queueInductionEmail(email,applicantSubject,applicantText,applicantText.replace(/\\n/g,"<br>"));
  const activeAdminSnap=await db.collection("adminProfiles").where("active","==",true).get();
  const adminProfiles=activeAdminSnap.docs.map(d=>({uid:d.id,...d.data()}));
  if(score.advanced){
    await notify({recipientUids:adminProfiles.map(d=>d.uid),type:"INDUCTION_APPLICATION_ADVANCED",title:"Induction application advanced for decision",body:`${item.fullName||"Applicant"} — ${score.percentage}% accuracy. The full Induction & Orientation Submission Report is available directly in Application Reception and is audit-traceable.`,module:"Induction & Orientation",recordId:requestId,route:"/induction-admin",priority:"high",eventKey:`INDUCTION_APPLICATION_ADVANCED|${requestId}`});
  }
  return {ok:true,routingStatus,accuracyPercentage:score.percentage,systemSummary:summary,feedbackQueued:Boolean(emailId),advanced:score.advanced};
});

exports.getInductionApplicationReception = onCall({region:"us-central1"}, async request => {
  const adminUid=request.auth?.uid;
  if(!adminUid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(adminUid).get();
  const actorEmail=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists || adminSnap.data()?.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");

  const [requestSnap,inductionSnap]=await Promise.all([
    db.collection("registrationRequests").orderBy("lastSubmittedAt","desc").limit(100).get(),
    db.collection("inductionRecords").orderBy("lastSubmittedAt","desc").limit(100).get()
  ]);
  const rows=new Map();
  for(const d of requestSnap.docs) rows.set(d.id,{id:d.id,...d.data(),_source:"registrationRequests"});
  for(const d of inductionSnap.docs){
    if(!rows.has(d.id)) rows.set(d.id,{id:d.id,...d.data(),_source:"inductionRecords",recoveryRequired:true,status:d.data()?.status||"Submitted",routingStatus:d.data()?.routingStatus||null});
  }
  const applications=[...rows.values()].sort((a,b)=>{
    const ta=a.lastSubmittedAt?.toMillis?.()||a.submittedAt?.toMillis?.()||0;
    const tb=b.lastSubmittedAt?.toMillis?.()||b.submittedAt?.toMillis?.()||0;
    return tb-ta;
  });
  return {ok:true,applications,checkedCollections:["registrationRequests","inductionRecords"],retrievedAt:new Date().toISOString()};
});

exports.processInductionApplicationAdmin = onCall({region:"us-central1"}, async request => {
  const adminUid=request.auth?.uid;
  if(!adminUid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(adminUid).get();
  const actorEmail=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists || adminSnap.data()?.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");
  const requestId=String(request.data?.requestId||"").trim();
  if(!requestId) throw new HttpsError("invalid-argument","Induction application ID is required.");
  const requestRef=db.collection("registrationRequests").doc(requestId);
  const snap=await requestRef.get();
  if(!snap.exists) throw new HttpsError("not-found","The induction application could not be found.");
  const item=snap.data();
  const email=String(item.email||item.answers?.verifiedEmail||"").trim().toLowerCase();
  const invitationId=String(item.invitationId||"").trim();
  let invitation=null;
  if(invitationId){const inv=await db.collection("invitations").doc(invitationId).get();if(inv.exists) invitation={id:inv.id,...inv.data()};}
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
  const inductionOrientationReport={reportType:"IRPA Induction & Orientation Submission Report",reportVersion:"1.0",applicationId:requestId,receivedAt:FieldValue.serverTimestamp(),applicant:{fullName:item.fullName||item.answers?.verifiedFullName||"",email},score:{percentage:score.percentage,correct:score.correct,total:score.total,threshold:score.threshold,advanced:score.advanced},routingStatus,decisionStatus:status,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,submittedAnswers:item.answers||{},capturedSystemInformation:item.systemCapturedProfile||{},administratorAction:"Review in Induction & Orientation Administrator Applications"};
  await requestRef.set({accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,accuracyIssues:score.issues,accuracyReasons:score.reasons,status,inductionStatus:score.advanced?"Advanced":"Filtered",roleAssignmentStatus:score.advanced?"Pending Administrator Decision":"Filtered",feedbackStatus:"Queued",inductionOrientationReport,administratorReportStatus:"Available in Application Reception",auditStatus:"Recorded",updatedAt:FieldValue.serverTimestamp(),adminProcessedByUid:adminUid,adminProcessedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("inductionRecords").doc(requestId).set({accuracyPercentage:score.percentage,accuracyCorrect:score.correct,accuracyTotal:score.total,accuracyThreshold:score.threshold,accuracyAdvanced:score.advanced,routingStatus,systemSummary:summary,status:score.advanced?"Advanced":"Filtered",inductionStatus:score.advanced?"Advanced":"Filtered",updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("audit").add({action:"INDUCTION_ORIENTATION_ADMIN_PROCESSING",collection:"registrationRequests",recordId:requestId,details:{reportType:inductionOrientationReport.reportType,reportVersion:inductionOrientationReport.reportVersion,accuracyPercentage:score.percentage,routingStatus,administratorReportStatus:"Available in Application Reception",processedByUid:adminUid},actorUid:adminUid,actorEmail:actorEmail||null,createdAt:FieldValue.serverTimestamp()});
  if(email) await queueInductionEmail(email,score.advanced?"IRPA Induction Application — Advanced to Administrator":"IRPA Induction Application — Further Information Required",`Dear ${item.fullName||"Applicant"},\\n\\n${summary}\\n\\nIRPA Digital Board Governance System`,`<strong>IRPA Induction Application</strong><br>${summary.replace(/</g,"&lt;")}`);
  const activeAdminSnap=await db.collection("adminProfiles").where("active","==",true).get();
  const adminProfiles=activeAdminSnap.docs.map(d=>({uid:d.id,...d.data()}));
  if(score.advanced){
    await notify({recipientUids:adminProfiles.map(d=>d.uid),type:"INDUCTION_APPLICATION_ADVANCED",title:"Induction application advanced for decision",body:`${item.fullName||"Applicant"} — ${score.percentage}% accuracy. The full Induction & Orientation Submission Report is available directly in Application Reception and is audit-traceable.`,module:"Induction & Orientation",recordId:requestId,route:"/induction-admin",priority:"high",eventKey:`INDUCTION_APPLICATION_ADVANCED|${requestId}`});
  }
  return {ok:true,routingStatus,accuracyPercentage:score.percentage,systemSummary:summary};
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

exports.rejectInductionApplication = onCall({region:"us-central1"}, async request => {
  const adminUid=request.auth?.uid;
  if(!adminUid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(adminUid).get();
  const actorEmail=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists||adminSnap.data()?.active!==true)) throw new HttpsError("permission-denied","Administrator authorization is required.");
  const requestId=String(request.data?.requestId||"").trim();
  const reason=String(request.data?.reason||"").trim();
  if(!requestId) throw new HttpsError("invalid-argument","Induction application ID is required.");
  if(!reason) throw new HttpsError("invalid-argument","A decision reason is required.");
  const ref=db.collection("registrationRequests").doc(requestId);
  const snap=await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","The induction application could not be found.");
  const item=snap.data();
  const email=String(item.email||item.answers?.verifiedEmail||"").trim().toLowerCase();
  await ref.set({status:"Rejected",inductionStatus:"Rejected",roleAssignmentStatus:"Rejected",routingStatus:"Administrator Decision — Rejected",decision:"Rejected",decisionReason:reason,decidedByUid:adminUid,decidedByEmail:actorEmail,decidedAt:FieldValue.serverTimestamp(),feedbackStatus:"Queued",updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await db.collection("inductionRecords").doc(requestId).set({status:"Rejected",inductionStatus:"Rejected",roleAssignmentStatus:"Rejected",routingStatus:"Administrator Decision — Rejected",decision:"Rejected",decisionReason:reason,decidedByUid:adminUid,decidedByEmail:actorEmail,decidedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  if(email) await queueInductionEmail(email,"IRPA Induction Application — Administrator Decision",`Dear ${item.fullName||"Applicant"},\\n\\nThe Administrator has reviewed your IRPA Induction and Orientation application and recorded a decision of REJECTED.\\n\\nReason: ${reason}\\n\\nYou may contact IRPA for clarification or submit a new application when appropriate.\\n\\nIRPA Digital Board Governance System`,`<strong>IRPA Induction Application — Administrator Decision</strong><p>Dear ${item.fullName||"Applicant"},</p><p>The Administrator has reviewed your application and recorded a decision of <strong>REJECTED</strong>.</p><p><strong>Reason:</strong> ${reason}</p><p>You may contact IRPA for clarification or submit a new application when appropriate.</p>`);
  await db.collection("audit").add({action:"INDUCTION_APPLICATION_REJECTED",collection:"registrationRequests",recordId:requestId,details:{email,reason},actorUid:adminUid,actorEmail,createdAt:FieldValue.serverTimestamp()});
  return {ok:true,decision:"Rejected",requestId,email};
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
  const employeeRecords=employeeSnap.docs.map(d=>({id:d.id,...d.data()}));
  const memberRecords=memberSnap.docs.map(d=>({id:d.id,...d.data()}));
  const roles=[...employeeRecords.flatMap(d=>Array.isArray(d.roles)?d.roles:[d.role]),...memberRecords.flatMap(d=>Array.isArray(d.roles)?d.roles:[d.role]),invitation?.role||"",...(Array.isArray(invitation?.roles)?invitation.roles:[])].flatMap(v=>String(v||"").split(",").map(x=>x.trim()).filter(Boolean));
  const capturedProfile={
    position:requestedRole||invitation?.role||employeeRecords[0]?.role||memberRecords[0]?.role||"Not yet assigned",
    assignedRoles:[...new Set(roles)],
    department:invitation?.department||employeeRecords[0]?.department||memberRecords[0]?.department||"",
    unit:invitation?.unit||employeeRecords[0]?.unit||memberRecords[0]?.unit||"",
    capacity:requestedCapacity||invitation?.accountType||invitation?.memberType||"",
    employmentType:invitation?.employmentType||employeeRecords[0]?.employmentType||"",
    memberType:invitation?.memberType||memberRecords[0]?.memberType||"",
    boardMember:Boolean(invitation?.boardMember||memberRecords.some(x=>x.boardMember)),
    registrationNumber:invitation?.registrationNumber||employeeRecords[0]?.employeeNumber||memberRecords[0]?.memberNumber||"",
    invitationReference:invitation?.invitationReference||invitation?.reference||invitationReference||"",
    invitationId:invitation?.id||null
  };
  const ref=db.collection("credentialInterviewRequests").doc();
  await ref.set({email,name,invitationId:invitation?.id||null,invitationReference:capturedProfile.invitationReference,requestedCapacity:requestedCapacity||null,requestedRole:requestedRole||null,registeredRoles:capturedProfile.assignedRoles,systemCapturedProfile:capturedProfile,status:"Pending Login Approval",loginApproved:false,emailReleaseStatus:"Queued",createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  const systemText=`Preliminary IRPA registration received. The following information was captured from the IRPA invitation/registration system for your awareness:\\n\\nName: ${name}\\nEmail: ${email}\\nPosition: ${capturedProfile.position}\\nAssigned roles: ${capturedProfile.assignedRoles.join(", ")||"Not yet assigned"}\\nDepartment: ${capturedProfile.department||"Not specified"}\\nUnit: ${capturedProfile.unit||"Not specified"}\\nCapacity: ${capturedProfile.capacity||"Not specified"}\\nEmployment/member type: ${capturedProfile.employmentType||capturedProfile.memberType||"Not specified"}\\nBoard Member status: ${capturedProfile.boardMember?"Yes":"No"}\\nRegistration number: ${capturedProfile.registrationNumber||"Not yet issued"}\\nInvitation reference: ${capturedProfile.invitationReference||"Not available"}\\n\\nStatus: Pending Login Approval. This preliminary registration does not itself authorise system access.`;
  await queueInductionEmail(email,"IRPA Preliminary Registration — Captured System Information",systemText,systemText.replace(/\\n/g,"<br>"));
  const adminEmails=(await db.collection("adminProfiles").where("active","==",true).get()).docs.map(d=>String(d.data()?.email||"").trim().toLowerCase()).filter(Boolean);
  for(const adminEmail of [...new Set(adminEmails)]) await queueInductionEmail(adminEmail,"IRPA Preliminary Registration — Invitee Captured Profile",`Invitee: ${name}\\nEmail: ${email}\\nPosition: ${capturedProfile.position}\\nAssigned roles: ${capturedProfile.assignedRoles.join(", ")||"Not yet assigned"}\\nDepartment: ${capturedProfile.department||"Not specified"}\\nUnit: ${capturedProfile.unit||"Not specified"}\\nInvitation reference: ${capturedProfile.invitationReference||"Not available"}\\nRequest ID: ${ref.id}`,`<strong>IRPA Preliminary Registration — Invitee Captured Profile</strong><p>Invitee: ${name}<br>Email: ${email}<br>Position: ${capturedProfile.position}<br>Assigned roles: ${capturedProfile.assignedRoles.join(", ")||"Not yet assigned"}<br>Department: ${capturedProfile.department||"Not specified"}<br>Unit: ${capturedProfile.unit||"Not specified"}<br>Invitation reference: ${capturedProfile.invitationReference||"Not available"}<br>Request ID: ${ref.id}</p>`);
  return {ok:true,requestId:ref.id,status:"Pending Login Approval",emailReleaseStatus:"Queued",systemCapturedProfile:capturedProfile};
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


exports.reconcileRegisteredIdentityUids = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  const actorEmail=String(request.auth?.token?.email||adminSnap.data()?.email||"").trim().toLowerCase();
  if(actorEmail!=="irpa2412@gmail.com" && (!adminSnap.exists||adminSnap.data()?.active!==true)){
    throw new HttpsError("permission-denied","Administrator authorization is required.");
  }

  const [memberSnap,employeeSnap]=await Promise.all([
    db.collection("members").get(),
    db.collection("employees").get()
  ]);
  const authUsers=[];
  let pageToken;
  do{
    const page=await getAuth().listUsers(1000,pageToken);
    authUsers.push(...page.users);
    pageToken=page.pageToken;
  }while(pageToken);

  const byEmail=new Map();
  for(const user of authUsers){
    const email=String(user.email||"").trim().toLowerCase();
    if(email){
      const list=byEmail.get(email)||[];
      list.push(user);
      byEmail.set(email,list);
    }
  }

  const summary={
    members:{total:memberSnap.size,alreadyAssigned:0,assigned:0,unmatched:0,conflicts:0},
    employees:{total:employeeSnap.size,alreadyAssigned:0,assigned:0,unmatched:0,conflicts:0},
    authUsers:authUsers.length,assignedRecords:[],unresolvedRecords:[],conflictRecords:[]
  };

  async function reconcile(collectionName,docs,kind){
    for(const record of docs){
      const data=record.data()||{};
      const recordEmail=String(data.email||"").trim().toLowerCase();
      const existingUid=String(data.uid||"").trim();
      const bucket=summary[kind];

      if(existingUid){
        const existingUser=authUsers.find(user=>user.uid===existingUid);
        if(existingUser){
          const authEmail=String(existingUser.email||"").trim().toLowerCase();
          if(!recordEmail||authEmail===recordEmail) bucket.alreadyAssigned++;
          else{
            bucket.conflicts++;
            summary.conflictRecords.push({collection:collectionName,recordId:record.id,name:data.name||"",email:recordEmail,existingUid,reason:"Existing UID belongs to a different Firebase Authentication email. No change made."});
          }
        }else{
          bucket.conflicts++;
          summary.conflictRecords.push({collection:collectionName,recordId:record.id,name:data.name||"",email:recordEmail,existingUid,reason:"Existing UID is not present in Firebase Authentication. No change made."});
        }
        continue;
      }

      if(!recordEmail){
        bucket.unmatched++;
        summary.unresolvedRecords.push({collection:collectionName,recordId:record.id,name:data.name||"",email:"",reason:"No email address is recorded, so a safe identity match is impossible."});
        continue;
      }

      const matches=byEmail.get(recordEmail)||[];
      if(matches.length!==1){
        bucket.unmatched++;
        summary.unresolvedRecords.push({collection:collectionName,recordId:record.id,name:data.name||"",email:recordEmail,reason:matches.length===0?"No Firebase Authentication account exists for this email.":"Multiple Firebase Authentication identities were returned for this email; no automatic assignment was made."});
        continue;
      }

      const matched=matches[0];
      await record.ref.set({
        uid:matched.uid,
        uidAssignedAt:FieldValue.serverTimestamp(),
        uidAssignedByUid:uid,
        uidAssignedByEmail:actorEmail||null,
        uidAssignmentMethod:"ADMIN_RECONCILIATION_EXACT_EMAIL_MATCH"
      },{merge:true});
      bucket.assigned++;
      summary.assignedRecords.push({collection:collectionName,recordId:record.id,name:data.name||"",email:recordEmail,uid:matched.uid});
    }
  }

  await reconcile("members",memberSnap.docs,"members");
  await reconcile("employees",employeeSnap.docs,"employees");

  const auditRef=db.collection("audit").doc();
  await auditRef.set({
    action:"REGISTERED_IDENTITY_UID_RECONCILIATION",
    category:"SYSTEM_ADMINISTRATION",
    description:"Administrator-controlled reconciliation of registered Member and Employee records to existing Firebase Authentication UIDs using exact email matching.",
    performedByUid:uid,performedByEmail:actorEmail||null,
    memberSummary:summary.members,employeeSummary:summary.employees,authUsersScanned:summary.authUsers,
    assignedRecords:summary.assignedRecords,unresolvedRecords:summary.unresolvedRecords,conflictRecords:summary.conflictRecords,
    accountCreationPerformed:false,existingUidsOverwritten:false,createdAt:FieldValue.serverTimestamp()
  });
  return {success:true,auditId:auditRef.id,...summary,safety:{accountCreationPerformed:false,existingUidsOverwritten:false,exactEmailMatchOnly:true}};
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
  const isTrialRecord=data=>String(data?.recordOrigin||"").trim().toUpperCase()==="TRIAL"||data?.trialData===true||data?.isTrial===true;
  const trialMembers=memberSnap.docs.filter(d=>isTrialRecord(d.data())&&!(d.data()?.boardMember===true||d.data()?.role==="Board Member"||d.data()?.boardPosition));
  const trialEmployees=employeeSnap.docs.filter(d=>isTrialRecord(d.data()));
  const memberCount=trialMembers.length;
  const employeeCount=trialEmployees.length;
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
    trialOnly:true,
    boardMembersPreserved:true,
    createdAt:FieldValue.serverTimestamp()
  });

  try{
    let membersDeleted=0;
    let employeesDeleted=0;
    for(const d of trialMembers){await d.ref.delete();membersDeleted++;}
    for(const d of trialEmployees){await d.ref.delete();employeesDeleted++;}
    // Trial resets must never rewrite production numbering counters. Existing production
    // counters are intentionally preserved; the next registration continues from the
    // established sequence rather than being recycled to 1.
    await auditRef.update({status:"Completed",membersDeleted,employeesDeleted,completedAt:FieldValue.serverTimestamp()});
    return {success:true,membersDeleted,employeesDeleted,trialOnly:true,boardMembersPreserved:true};
  }catch(error){
    await auditRef.update({status:"Failed",error:String(error?.message||error),failedAt:FieldValue.serverTimestamp()});
    throw new HttpsError("internal","The trial-data reset failed. The audit record has been retained.");
  }
});
