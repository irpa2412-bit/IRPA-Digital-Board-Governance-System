const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { authorize, grantPermission, revokePermission, listPermissions } = require("./authorizationService");

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
    if(targetUid && targetUid!==actorUid) await listPermissions({actorUid,targetUid});
    return await listPermissions({actorUid,targetUid:targetUid||actorUid});
  } catch(error) {
    throw new HttpsError("permission-denied",error?.message||"Permission register access was denied.");
  }
});
