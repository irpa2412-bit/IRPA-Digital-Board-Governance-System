const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();
const resetDeveloperSecret = defineSecret("IRPA_RESET_DEVELOPER_SECRET");

const RESETTABLE_COLLECTIONS = [
  "members","employees","meetings","meetingSubscriptions","meetingRoomEvents","transcriptions",
  "resolutions","votes","voteCorrections","votingIssues","actions","documents","signatures","decisions",
  "risks","reports","authorizationRequests","workflowActions","staffPaymentRequests","financeBudgets",
  "financeTransactions","financeFunding","financeApprovals","financeCommitments","financeGrants",
  "financeBankAccounts","financeReconciliations","financeAssets","financeRisks","financeReports",
  "financeChartOfAccounts","financeJournalBatches","financePeriods","financeLedgerJournals",
  "financeLedgerEntries","financePaymentMatches","financePaymentTrace","financeReferenceRegistry",
  "procurementVendors","procurementRequests","procurementVendorScores","procurementVendorBlacklist",
  "procurementVendorProbation","donorFunders","grantReportingObligations","participants"
];

const PROTECTED_COLLECTIONS = new Set([
  "audit","adminProfiles","systemResetPlans","systemSettings","invitations","registrationRequests",
  "inductionRecords","memberCounters","employeeCounters","signatureProfiles","signatureEnvelopes",
  "signatureEvents","signerIdentities","notifications","mail","financialReferenceCounters"
]);

function requireAdministrator(request){
  const uid=request.auth?.uid;
  const email=String(request.auth?.token?.email||"").trim().toLowerCase();
  if(!uid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  if(email==="irpa2412@gmail.com" || request.auth?.token?.admin===true) return {uid,email};
  throw new HttpsError("permission-denied","Administrator authorization is required.");
}

function cleanSelections(values){
  const list=[...new Set((Array.isArray(values)?values:[]).map(v=>String(v||"").trim()).filter(Boolean))];
  if(!list.length) throw new HttpsError("invalid-argument","Select at least one data collection.");
  const invalid=list.filter(name=>!RESETTABLE_COLLECTIONS.includes(name)||PROTECTED_COLLECTIONS.has(name));
  if(invalid.length) throw new HttpsError("failed-precondition","Protected or unsupported collection selected: "+invalid.join(", "));
  return list;
}

function cleanMode(value){
  const mode=String(value||"TRIAL_ONLY").trim().toUpperCase();
  if(!["TRIAL_ONLY","SELECTED_DATA"].includes(mode)) throw new HttpsError("invalid-argument","Invalid reset scope.");
  return mode;
}

async function verifyDeveloperSecret(request){
  const supplied=String(request.data?.developerSecret||"");
  const expected=String(resetDeveloperSecret.value()||"");
  if(!expected || !supplied || supplied!==expected){
    throw new HttpsError("permission-denied","The developer-provided reset authorization was not accepted.");
  }
}

async function writeResetAudit(action, planId, actor, details={}){
  await db.collection("audit").add({
    action,collection:"systemResetPlans",recordId:planId,
    details:{...details,serverControlled:true},
    actorUid:actor.uid,actorEmail:actor.email,createdAt:FieldValue.serverTimestamp()
  });
}

async function deleteMatchingDocs(collectionName, mode){
  const ref=db.collection(collectionName);
  let deleted=0;
  let cursor=null;
  while(true){
    let q=ref.orderBy("__name__").limit(400);
    if(cursor) q=q.startAfter(cursor);
    const snap=await q.get();
    if(snap.empty) break;
    const batch=db.batch();
    let batchDeletes=0;
    for(const item of snap.docs){
      const data=item.data()||{};
      const isTrial=String(data.recordOrigin||"").toUpperCase()==="TRIAL"||data.trialData===true||data.isTrial===true;
      if(mode==="TRIAL_ONLY" && !isTrial) continue;
      batch.delete(item.ref);
      batchDeletes++;
    }
    if(batchDeletes) await batch.commit();
    deleted+=batchDeletes;
    cursor=snap.docs[snap.docs.length-1];
    if(snap.size<400) break;
  }
  return deleted;
}

exports.requestDataReset = onCall({region:"us-central1",secrets:[resetDeveloperSecret]}, async request=>{
  const actor=requireAdministrator(request);
  await verifyDeveloperSecret(request);
  const collections=cleanSelections(request.data?.collections);
  const mode=cleanMode(request.data?.scope);
  const graceMinutes=Math.min(1440,Math.max(30,Number(request.data?.graceMinutes||30)));
  const reason=String(request.data?.reason||"").trim();
  if(!reason) throw new HttpsError("invalid-argument","A reset reason is required.");

  const planRef=db.collection("systemResetPlans").doc();
  const executeAfterMs=Date.now()+graceMinutes*60*1000;
  await planRef.set({
    planId:planRef.id,status:"PENDING_GRACE",scope:mode,collections,
    graceMinutes,reason,requestedByUid:actor.uid,requestedByEmail:actor.email,
    requestedAt:FieldValue.serverTimestamp(),executeAfter:new Date(executeAfterMs),
    cancelledAt:null,executedAt:null,executedByUid:null,executedByEmail:null,
    developerAuthorizationVerified:true,protectedCollections:[...PROTECTED_COLLECTIONS]
  });
  await writeResetAudit("SYSTEM_RESET_SCHEDULED",planRef.id,actor,{scope:mode,collections,graceMinutes,reason});
  return {ok:true,planId:planRef.id,status:"PENDING_GRACE",executeAfter:executeAfterMs,graceMinutes,collections,scope:mode};
});

exports.cancelDataReset = onCall({region:"us-central1",secrets:[resetDeveloperSecret]}, async request=>{
  const actor=requireAdministrator(request);
  await verifyDeveloperSecret(request);
  const planId=String(request.data?.planId||"").trim();
  if(!planId) throw new HttpsError("invalid-argument","A reset plan ID is required.");
  const ref=db.collection("systemResetPlans").doc(planId);
  const snap=await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","Reset plan not found.");
  const plan=snap.data()||{};
  if(plan.status!=="PENDING_GRACE") throw new HttpsError("failed-precondition","Only a pending reset can be cancelled.");
  await ref.update({status:"CANCELLED",cancelledAt:FieldValue.serverTimestamp(),cancelledByUid:actor.uid,cancelledByEmail:actor.email});
  await writeResetAudit("SYSTEM_RESET_CANCELLED",planId,actor,{scope:plan.scope,collections:plan.collections});
  return {ok:true,planId,status:"CANCELLED"};
});

exports.executeDataReset = onCall({region:"us-central1",timeoutSeconds:540,secrets:[resetDeveloperSecret]}, async request=>{
  const actor=requireAdministrator(request);
  await verifyDeveloperSecret(request);
  const planId=String(request.data?.planId||"").trim();
  if(!planId) throw new HttpsError("invalid-argument","A reset plan ID is required.");
  const ref=db.collection("systemResetPlans").doc(planId);
  const snap=await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","Reset plan not found.");
  const plan=snap.data()||{};
  if(plan.status!=="PENDING_GRACE") throw new HttpsError("failed-precondition","Reset plan is no longer pending.");
  const executeAfter=plan.executeAfter?.toDate?.()||new Date(plan.executeAfter||0);
  if(Date.now()<executeAfter.getTime()) throw new HttpsError("failed-precondition","The reset grace period has not expired.");
  if(plan.requestedByUid!==actor.uid) throw new HttpsError("permission-denied","Only the administrator who scheduled this reset may execute it.");

  const results={};
  for(const collectionName of cleanSelections(plan.collections)){
    results[collectionName]=await deleteMatchingDocs(collectionName,plan.scope);
  }
  await ref.update({status:"EXECUTED",executedAt:FieldValue.serverTimestamp(),executedByUid:actor.uid,executedByEmail:actor.email,results});
  await writeResetAudit("SYSTEM_RESET_EXECUTED",planId,actor,{scope:plan.scope,collections:plan.collections,results});
  return {ok:true,planId,status:"EXECUTED",results};
});

exports.getDataResetStatus = onCall({region:"us-central1",secrets:[resetDeveloperSecret]}, async request=>{
  requireAdministrator(request);
  await verifyDeveloperSecret(request);
  const snap=await db.collection("systemResetPlans").where("status","==","PENDING_GRACE").orderBy("requestedAt","desc").limit(10).get();
  return {ok:true,plans:snap.docs.map(d=>({id:d.id,...d.data(),executeAfter:d.data().executeAfter?.toDate?.()?.toISOString?.()||null}))};
});
