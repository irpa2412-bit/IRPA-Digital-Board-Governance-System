const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { authorize, grantPermission, revokePermission, listPermissions, getEffectivePermissions } = require("./authorizationService");
const { evaluateAuthorizationWorkflowTransition } = require("./authorizationPolicy");
const { getFirestore } = require("firebase-admin/firestore");
const db = getFirestore();

exports.authorizeAction = onCall({region:"us-central1"}, async request => {
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required.");
  try {
    return await authorize({
      uid,
      action:request.data?.action,
      resource:request.data?.resource||{},
      context:request.data?.context||{},
      auditDecision:request.data?.auditDecision===true
    });
  } catch(error) {
    console.error("authorizeAction failed",error);
    throw new HttpsError("permission-denied",error?.message||"Authorization decision failed.");
  }
});

exports.grantAuthorizationPermission = onCall({region:"us-central1"}, async request => {
  const actorUid=request.auth?.uid;
  if(!actorUid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  try {
    return await grantPermission({
      actorUid,
      targetUid:request.data?.targetUid,
      permission:request.data?.permission,
      scope:request.data?.scope||{},
      reason:request.data?.reason||""
    });
  } catch(error) {
    const code=String(error?.code||"");
    const mapped=code==="invalid-argument"?"invalid-argument":code==="failed-precondition"?"failed-precondition":"permission-denied";
    throw new HttpsError(mapped,error?.message||"Permission grant was denied.");
  }
});

exports.revokeAuthorizationPermission = onCall({region:"us-central1"}, async request => {
  const actorUid=request.auth?.uid;
  if(!actorUid) throw new HttpsError("unauthenticated","Administrator authentication is required.");
  try {
    return await revokePermission({
      actorUid,
      targetUid:request.data?.targetUid,
      permission:request.data?.permission,
      scope:request.data?.scope||{},
      reason:request.data?.reason||""
    });
  } catch(error) {
    const code=String(error?.code||"");
    const mapped=code==="invalid-argument"?"invalid-argument":code==="failed-precondition"?"failed-precondition":"permission-denied";
    throw new HttpsError(mapped,error?.message||"Permission revocation was denied.");
  }
});

exports.getEffectiveAuthorizationPermissions = onCall({region:"us-central1"}, async request => {
  const actorUid=request.auth?.uid;
  if(!actorUid) throw new HttpsError("unauthenticated","Authentication is required.");
  try {
    const targetUid=String(request.data?.targetUid||"").trim();
    return await listPermissions({actorUid,targetUid:targetUid||actorUid});
  } catch(error) {
    throw new HttpsError("permission-denied",error?.message||"Permission register access was denied.");
  }
});


exports.authorizeWorkflowTransition = onCall({region:"us-central1"}, async request => {
  const actorUid=request.auth?.uid;
  if(!actorUid) throw new HttpsError("unauthenticated","Authentication is required.");
  const workflowId=String(request.data?.workflowId||"").trim();
  const nextStatus=String(request.data?.nextStatus||"").trim();
  const decisionReason=String(request.data?.decisionReason||"").trim();
  if(!workflowId || !nextStatus) throw new HttpsError("invalid-argument","A workflow record and target stage are required.");
  try {
    const snap=await db.collection("workflowActions").doc(workflowId).get();
    if(!snap.exists) throw new HttpsError("not-found","Authorization request not found.");
    const workflow=snap.data()||{};
    const effective=await getEffectivePermissions(actorUid);
    const decision=evaluateAuthorizationWorkflowTransition({
      actor:{uid:actorUid,active:effective.active===true,organisation:"Improvement of Rangeland in Pastoral Areas"},
      workflow,
      nextStatus,
      decisionReason,
      effectivePermissions:effective.permissions||[]
    });
    return { ...decision, workflowId, decisionReason:decisionReason||null };
  } catch(error) {
    if(error instanceof HttpsError) throw error;
    console.error("authorizeWorkflowTransition failed",error);
    throw new HttpsError("permission-denied",error?.message||"Authorization workflow decision failed.");
  }
});
